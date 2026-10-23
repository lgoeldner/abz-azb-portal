#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

while IFS= read -r -d '' template; do
  target="${template%.dist}"
  if [[ ! -e "$target" && ! -L "$target" ]]; then
    cp -n "$template" "$target"
    printf 'WARNING: Created %s from %s. Review the defaults before use.\n' "$target" "$template" >&2
  fi
done < <(find . -type d \( -name .git -o -name node_modules \) -prune -o -type f -name '.env*.dist' -print0)
