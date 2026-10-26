#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/dev-common.sh"
start_dev_services
printf 'Development stack ready: https://caddy.abizeitung-portal.orb.local\nStop it with: make down\n'
