#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/dev-common.sh"
start_dev_services
prepare_dev_database

children=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${children[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${children[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup INT TERM EXIT

SKIP_DEV_DB_SETUP=1 bash scripts/dev-backend.sh & children+=("$!")
bash scripts/dev-frontend.sh & children+=("$!")
status=0
while [[ "$(jobs -pr | wc -l | tr -d ' ')" -ge 2 ]]; do sleep 1; done
for pid in "${children[@]}"; do
  if ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid" || status=$?
    break
  fi
done
exit "$status"
