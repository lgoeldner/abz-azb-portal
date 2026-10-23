#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/dev-common.sh"

if [[ "${SKIP_DEV_DB_SETUP:-0}" != 1 ]]; then
  start_dev_services
  prepare_dev_database
fi
printf 'Starting Go API at http://localhost:8080 (PUBLIC_URL=%s)\n' "$PUBLIC_URL"
cd server
mkdir -p tmp
go build -o tmp/portal-dev ./cmd/portal
exec ./tmp/portal-dev serve
