#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/dev-common.sh"
if [[ ! -d web/node_modules ]]; then (cd web && npm ci); fi
printf 'Starting Vite at http://localhost:5173 (API proxy: http://localhost:8080)\n'
cd web
exec node node_modules/vite/bin/vite.js --host 127.0.0.1
