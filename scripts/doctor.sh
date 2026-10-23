#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
failures=0

ok() { printf '✓ %s\n' "$1"; }
bad() { printf '✗ %s\n  %s\n' "$1" "$2" >&2; failures=$((failures + 1)); }

if command -v orbctl >/dev/null 2>&1; then
  if orbctl status >/dev/null 2>&1; then ok 'OrbStack is installed and running (orbctl)';
  else bad 'OrbStack is installed but not running' 'Start OrbStack.app, then rerun make doctor.'; fi
else bad 'orbctl is missing' 'Install/start OrbStack.app and ensure orbctl is on PATH.'; fi

if command -v docker >/dev/null 2>&1; then
  if docker context inspect orbstack >/dev/null 2>&1; then
    if docker --context orbstack info >/dev/null 2>&1; then ok 'Docker CLI reaches the explicit orbstack context';
    else bad 'Docker CLI cannot reach the orbstack context' 'Start OrbStack.app and check `docker context inspect orbstack`. This workflow never switches to Docker Desktop.'; fi
    if docker --context orbstack compose version >/dev/null 2>&1; then ok 'Docker Compose is available through orbstack';
    else bad 'Docker Compose is unavailable' 'Install a Docker CLI build with the Compose v2 plugin.'; fi
  else bad 'Docker context "orbstack" is missing' 'Install OrbStack and run its setup so it creates the orbstack Docker context.'; fi
else bad 'Docker CLI is missing' 'Install the Docker CLI; OrbStack provides the engine, and this workflow uses `--context orbstack`.'; fi

if command -v go >/dev/null 2>&1; then ok "Go is available ($(go version | awk '{print $3}'))";
else bad 'Go is missing' 'Install the Go version required by go.mod and put `go` on PATH.'; fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  ok "Node and npm are available ($(node --version), npm $(npm --version))"
else bad 'Node.js or npm is missing' 'Install Node.js 24 with npm and put both commands on PATH.'; fi

if [[ -f .env.dev ]]; then ok 'Local development configuration .env.dev exists';
else bad 'Local development configuration .env.dev is missing' 'Restore the checked-in .env.dev file; it contains development-only values.'; fi

if command -v docker >/dev/null 2>&1 && [[ -f .env.dev ]] && docker --context orbstack compose --env-file .env.dev -f compose.yaml -f compose.dev.yaml config --quiet >/dev/null 2>&1; then
  ok 'OrbStack development Compose configuration is valid'
elif command -v docker >/dev/null 2>&1 && [[ -f .env.dev ]]; then
  bad 'Development Compose configuration is invalid' 'Check compose.yaml, compose.dev.yaml, and .env.dev; run `docker --context orbstack compose --env-file .env.dev -f compose.yaml -f compose.dev.yaml config` for details.'
fi

if (( failures > 0 )); then
  printf '\nDoctor found %d issue(s). Fix the items above and rerun `make doctor`.\n' "$failures" >&2
  exit 1
fi
printf '\nOrbStack local development prerequisites are ready.\n'
