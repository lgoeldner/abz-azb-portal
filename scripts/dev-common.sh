#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export APP_ENV=development
export ADDR=127.0.0.1:8080
export AUTH_MODE=mock
export PUBLIC_URL=http://localhost:5173
export DATABASE_URL='postgres://portal:portal-dev@localhost:5432/portal?sslmode=disable'
export UPLOAD_DIR="$ROOT_DIR/server/data/uploads"
export SESSION_SECRET=development-only-secret-change-for-production

start_dev_database() {
  docker compose --env-file .env.dev -f compose.yaml -f compose.dev.yaml up -d --wait db
}

prepare_dev_database() {
  (cd server && go run ./cmd/portal migrate && go run ./cmd/portal seed)
}
