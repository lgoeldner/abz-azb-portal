#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"
cat > "$tmp/bin/restic" <<'SH'
#!/bin/sh
echo restic >> "$CALL_LOG"
if [ "$1" = restore ]; then
  target=
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --target ]; then target=$2; shift 2; else shift; fi
  done
  mkdir -p "$target/tmp/payload/uploads"
  printf db > "$target/tmp/payload/database.dump"
  printf '{}' > "$target/tmp/payload/manifest.json"
  (cd "$target/tmp/payload" && sha256sum database.dump manifest.json > SHA256SUMS)
fi
SH
cat > "$tmp/bin/psql" <<'SH'
#!/bin/sh
echo psql >> "$CALL_LOG"
printf 1
SH
cat > "$tmp/bin/pg_restore" <<'SH'
#!/bin/sh
echo pg_restore >> "$CALL_LOG"
SH
chmod +x "$tmp/bin/"*
export PATH="$tmp/bin:$PATH" CALL_LOG="$tmp/calls"
export RESTIC_REPOSITORY=unused RESTIC_PASSWORD=unused RESTORE_SNAPSHOT=unused
export RESTORE_DATABASE_URL=postgres://unused RESTORE_UPLOAD_DIR="$tmp/new-uploads"

expect_refusal() {
  local label=$1
  shift
  rm -f "$CALL_LOG"
  if "$@" >/dev/null 2>&1; then
    echo "Expected restore refusal: $label" >&2
    exit 1
  fi
  if [[ -s "$CALL_LOG" ]]; then
    echo "Restore reached an external command before refusing: $label" >&2
    exit 1
  fi
}

expect_refusal 'missing acknowledgement' env -u RESTORE_ACK bash "$root/ops/restore.sh"
expect_refusal 'incorrect acknowledgement' env RESTORE_ACK=wrong bash "$root/ops/restore.sh"
export RESTORE_ACK=I_CONFIRM_DISPOSABLE_RESTORE
mkdir "$RESTORE_UPLOAD_DIR"
touch "$RESTORE_UPLOAD_DIR/existing"
expect_refusal 'non-empty upload destination' bash "$root/ops/restore.sh"
rm -f "$CALL_LOG"
rm -rf "$RESTORE_UPLOAD_DIR"
mkdir "$RESTORE_UPLOAD_DIR"
if bash "$root/ops/restore.sh" >/dev/null 2>&1; then
  echo 'Expected restore refusal: non-empty database' >&2
  exit 1
fi
if ! grep -q '^psql$' "$CALL_LOG" || grep -q '^pg_restore$' "$CALL_LOG"; then
  echo 'Restore did not stop before pg_restore for a non-empty database' >&2
  exit 1
fi
echo 'restore safety checks passed'
