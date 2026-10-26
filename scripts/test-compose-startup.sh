#!/usr/bin/env bash
set -Eeuo pipefail

# Exercise runtime starts (which bypass Compose health gates) with disposable data.
root=$(cd "$(dirname "$0")/.." && pwd)
project="portal-startup-$(date +%s)-$$"
config=$(mktemp)
compose=(docker compose -p "$project" -f "$config")
cleanup() {
  local code=$?
  "${compose[@]}" down -v --rmi local >/dev/null 2>&1 || true
  docker image rm "$project-portal:local" "$project-auth-mock:local" >/dev/null 2>&1 || true
  rm -f "$config"
  exit "$code"
}
trap cleanup EXIT

docker compose --env-file "$root/.env.dev.dist" -f "$root/compose.yaml" -f "$root/compose.dev.yaml" --profile production config --format json |
  STARTUP_TEST_PROJECT="$project" node -e '
    const fs = require("node:fs");
    const assert = require("node:assert/strict");
    const c = JSON.parse(fs.readFileSync(0, "utf8"));
    const project = process.env.STARTUP_TEST_PROJECT;
    delete c.services.backup;
    for (const [name, service] of Object.entries(c.services)) {
      assert.equal(service.restart, "unless-stopped", `${name} must recover after engine restart`);
      service.ports = [];
      delete service.profiles;
      if (service.build) service.image = `${project}-${name}:local`;
    }
    c.services.portal.volumes = c.services.portal.volumes.map(v =>
      v.target === "/var/lib/portal/uploads" ? {type: "volume", source: "uploads", target: v.target} : v);
    c.volumes.uploads = {};
    for (const [name, volume] of Object.entries(c.volumes)) volume.name = `${project}_${name}`;
    for (const [name, network] of Object.entries(c.networks)) network.name = `${project}_${name}`;
    process.stdout.write(JSON.stringify(c));
  ' > "$config"

"${compose[@]}" create --build db auth-mock portal caddy
portal=$("${compose[@]}" ps -aq portal)
db=$("${compose[@]}" ps -aq db)
auth=$("${compose[@]}" ps -aq auth-mock)
caddy=$("${compose[@]}" ps -aq caddy)

wait_ready() {
  local attempt
  for ((attempt = 0; attempt < 90; attempt++)); do
    if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$portal")" == healthy ]]; then
      echo 'Portal is ready'
      return
    fi
    sleep 1
  done
  echo 'Portal failed to become ready' >&2
  # Do not dump application logs: they could contain connection credentials.
  return 1
}

start_before_database() {
  docker start "$auth" "$portal" "$caddy" >/dev/null
  sleep 3
  [[ "$(docker inspect -f '{{.State.Status}}' "$portal")" == running ]]
  [[ "$(docker inspect -f '{{.RestartCount}}' "$portal")" == 0 ]]
  docker start "$db" >/dev/null
  wait_ready
}

echo 'Cold runtime start: portal starts before PostgreSQL'
start_before_database
"${compose[@]}" stop
echo 'Existing-container runtime start: portal starts before PostgreSQL'
start_before_database
echo 'Compose restart: all services'
"${compose[@]}" restart
wait_ready
echo 'Compose startup and restart checks passed'
