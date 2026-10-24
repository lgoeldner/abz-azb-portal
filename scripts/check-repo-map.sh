#!/usr/bin/env bash
# Fails when a path listed in docs/repo-map.md no longer exists.
# ponytail: checks existence only; new files missing from the map are caught by the AGENTS.md rule, not here.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
missing=0
while read -r path; do
  [[ -e "$path" ]] || { echo "repo-map: missing $path" >&2; missing=1; }
done < <(sed -nE 's/^(dir|file|cmd|test) `([^`]+)`.*/\2/p' docs/repo-map.md)
exit "$missing"
