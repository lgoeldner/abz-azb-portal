#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export APP_ENV=development
export ADDR=127.0.0.1:8080
export AUTH_MODE=mock
export OIDC_ISSUER=http://localhost:9090
export OIDC_CLIENT_ID=portal-dev
export OIDC_CLIENT_SECRET=dev-only
unset OIDC_BACKCHANNEL_URL
export PUBLIC_URL=http://localhost:5173
export DATABASE_URL='postgres://portal:portal-dev@localhost:5432/portal?sslmode=disable'
export UPLOAD_DIR="$ROOT_DIR/deployables/portal/server/data/uploads"
export SESSION_SECRET=development-only-secret-change-for-production

start_dev_services() {
  local services=(db auth-mock portal frontend caddy)
  # Shell env beats --env-file; drop the host-dev PUBLIC_URL so .env.dev reaches the containers.
  local compose=(env -u PUBLIC_URL docker compose --env-file .env.dev -f compose.yaml -f compose.dev.yaml)
  if [[ "${BACKUP_DEV:-false}" == true ]]; then
    services+=(backup)
  else
    "${compose[@]}" --profile production rm -sf backup
  fi
  # ponytail: the portal container (uid 10001) shares this dir; fine on macOS engines,
  # native Linux needs matching ownership or a separate volume.
  mkdir -p "$UPLOAD_DIR"
  # Naming caddy and backup enables their production profile.
  # Refresh only Vite's anonymous dependency volume; keep other services reusable.
  "${compose[@]}" up -d --build --wait --renew-anon-volumes frontend
  "${compose[@]}" up -d --build --wait "${services[@]}"
}

prepare_dev_database() {
  (cd deployables/portal/server && go run ./cmd/portal migrate && go run ./cmd/portal seed)
}
