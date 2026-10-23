#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
failures=0

ok() { printf '✓ %s\n' "$1"; }
bad() { printf '✗ %s\n  %s\n' "$1" "$2" >&2; failures=$((failures + 1)); }

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then ok "Docker engine is reachable (context: $(docker context show))";
  else bad 'Docker engine is not reachable' 'Start your Docker engine (OrbStack, Docker Desktop, Colima, ...) and check `docker context show`.'; fi
  if docker compose version >/dev/null 2>&1; then ok 'Docker Compose is available';
  else bad 'Docker Compose is unavailable' 'Install a Docker CLI build with the Compose v2 plugin.'; fi
else bad 'Docker CLI is missing' 'Install Docker (any engine works, e.g. OrbStack or Docker Desktop).'; fi

if command -v go >/dev/null 2>&1; then ok "Go is available ($(go version | awk '{print $3}'))";
else bad 'Go is missing' 'Install the Go version required by go.mod and put `go` on PATH.'; fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  ok "Node and npm are available ($(node --version), npm $(npm --version))"
else bad 'Node.js or npm is missing' 'Install Node.js 24 with npm and put both commands on PATH.'; fi

if [[ -f .env.dev ]]; then ok 'Local development configuration .env.dev exists';
else bad 'Local development configuration .env.dev is missing' 'Restore the checked-in .env.dev file; it contains development-only values.'; fi

if command -v docker >/dev/null 2>&1 && [[ -f .env.dev ]] && docker compose --env-file .env.dev -f compose.yaml -f compose.dev.yaml config --quiet >/dev/null 2>&1; then
  ok 'Development Compose configuration is valid'
elif command -v docker >/dev/null 2>&1 && [[ -f .env.dev ]]; then
  bad 'Development Compose configuration is invalid' 'Check compose.yaml, compose.dev.yaml, and .env.dev; run `docker compose --env-file .env.dev -f compose.yaml -f compose.dev.yaml config` for details.'
fi

if (( failures > 0 )); then
  printf '\nDoctor found %d issue(s). Fix the items above and rerun `make doctor`.\n' "$failures" >&2
  exit 1
fi
printf '\nLocal development prerequisites are ready.\n'
