#!/usr/bin/env bash
set -Eeuo pipefail

status_file=${BACKUP_STATUS_FILE:-/status/status.json}
upload_dir=${UPLOAD_DIR:-/uploads}
interval=${BACKUP_INTERVAL_SECONDS:-86400}

write_failure() {
  local message='Backup failed; inspect backup container logs and repository'
  local previous=null
  local tmp="${status_file}.tmp"
  mkdir -p "$(dirname "$status_file")"
  if [[ -f "$status_file" ]]; then
    previous=$(sed -n 's/.*"last_success":\([^,}]*\).*/\1/p' "$status_file" | head -n 1)
    [[ -n "$previous" ]] || previous=null
  fi
  printf '{"last_success":%s,"last_error":"%s"}\n' "$previous" "$message" > "$tmp"
  mv "$tmp" "$status_file"
}

backup_once() {
  local work=/tmp/portal-backup manifest_time tmp schema_version
  mkdir -p "$(dirname "$status_file")" || return 1
  exec 9>"${status_file}.lock"
  if ! flock -n 9; then
    echo 'Another backup is already running' >&2
    exec 9>&-
    return 1
  fi
  # A kernel lock is released even after SIGKILL or a container crash. The status
  # volume shares this lock with manual one-off backup containers.
  trap 'rm -rf "$work"; flock -u 9; exec 9>&-' RETURN
  rm -rf "$work"
  mkdir -p "$work/payload/uploads"

  # A database reference can only commit after its upload is finalized. Dumping
  # first and copying the immutable upload tree second includes every file the
  # dump can reference, even while new uploads arrive.
  pg_dump --format=custom --no-owner --no-acl --file "$work/payload/database.dump" || return 1
  cp -a "$upload_dir/." "$work/payload/uploads/" || return 1
  schema_version=$(psql --no-psqlrc --tuples-only --no-align --command "SELECT COALESCE(string_agg(version, ',' ORDER BY version), 'unknown') FROM schema_migrations") || return 1
  manifest_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"format":1,"created_at":"%s","app_version":"%s","schema_version":"%s","database":"database.dump","uploads":"uploads"}\n' "$manifest_time" "${APP_VERSION:-unknown}" "$schema_version" > "$work/payload/manifest.json" || return 1
  (cd "$work/payload" && find database.dump uploads manifest.json -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS) || return 1

  restic backup --host abizeitung-portal --tag abizeitung-portal "$work/payload" || return 1
  restic check --read-data-subset=5% || return 1
  restic forget --host abizeitung-portal --tag abizeitung-portal --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune || return 1

  # External heartbeat (for example an Uptime Kuma push URL) is updated only
  # after the backup and repository checks completed successfully.
  curl --fail --silent --show-error --max-time 15 "$BACKUP_HEARTBEAT_URL" >/dev/null || return 1
  tmp="${status_file}.tmp"
  mkdir -p "$(dirname "$status_file")"
  printf '{"last_success":"%s","last_error":null}\n' "$manifest_time" > "$tmp" || return 1
  mv "$tmp" "$status_file" || return 1
}

if [[ -z "${RESTIC_REPOSITORY:-}" || -z "${RESTIC_PASSWORD:-}" || -z "${BACKUP_HEARTBEAT_URL:-}" ]]; then
  echo 'RESTIC_REPOSITORY, RESTIC_PASSWORD and BACKUP_HEARTBEAT_URL are required' >&2
  exit 2
fi

if [[ "${BACKUP_ONCE:-0}" == 1 ]]; then
  backup_once
  exit $?
fi

while true; do
  started=$SECONDS
  if ! backup_once; then
    error='Backup failed; inspect backup container logs and repository'
    write_failure "$error" || true
    echo "$error" >&2
    sleep 300
    continue
  fi
  remaining=$((interval - (SECONDS - started)))
  (( remaining > 0 )) || remaining=60
  sleep "$remaining"
done
