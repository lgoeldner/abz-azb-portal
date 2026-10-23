#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/uploads" "$tmp/repository" "$tmp/status"
cat > "$tmp/bin/pg_dump" <<'SH'
#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = --file ]; then printf 'disposable dump' > "$2"; exit 0; fi
  shift
done
exit 1
SH
cat > "$tmp/bin/psql" <<'SH'
#!/bin/sh
printf '001_initial.sql\n'
SH
cat > "$tmp/bin/restic" <<'SH'
#!/bin/sh
if [ "$1" = backup ] && [ ! -f "$FAIL_ONCE_MARKER" ]; then
  touch "$FAIL_ONCE_MARKER"
  exit 1
fi
exit 0
SH
cat > "$tmp/bin/curl" <<'SH'
#!/bin/sh
exit 0
SH
if ! command -v flock >/dev/null 2>&1; then
  cat > "$tmp/bin/flock" <<'SH'
#!/usr/bin/env python3
import fcntl, sys
operation = sys.argv[1]
fd = int(sys.argv[-1])
try:
    fcntl.flock(fd, fcntl.LOCK_UN if operation == '-u' else fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(1)
SH
fi
chmod +x "$tmp/bin/"*

export PATH="$tmp/bin:$PATH"
export RESTIC_REPOSITORY="$tmp/repository" RESTIC_PASSWORD=disposable
export BACKUP_HEARTBEAT_URL=file:///etc/hostname BACKUP_ONCE=1
export UPLOAD_DIR="$tmp/uploads" BACKUP_STATUS_FILE="$tmp/status/status.json"
export FAIL_ONCE_MARKER="$tmp/restic-failed-once"

if bash "$root/deployables/backup/backup.sh" >/dev/null 2>&1; then
  echo 'Expected the first disposable backup attempt to fail' >&2
  exit 1
fi
bash "$root/deployables/backup/backup.sh" >/dev/null
if [[ ! -s "$BACKUP_STATUS_FILE" ]]; then
  echo 'Retry after failed backup did not publish success status' >&2
  exit 1
fi
# The lock file remains to avoid inode races; a subsequent success proves that
# flock was released when the failed attempt returned.
bash "$root/deployables/backup/backup.sh" >/dev/null
echo 'backup lock release and retry checks passed'
