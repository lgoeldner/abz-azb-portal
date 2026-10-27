#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/dev-common.sh"
start_dev_services
printf 'Development stack ready: %s\nStop it with: make down\n' "$(sed -n 's/^PUBLIC_URL=//p' .env.dev)"
