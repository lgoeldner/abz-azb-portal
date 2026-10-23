#!/usr/bin/env bash
set -Eeuo pipefail

# Restore only into a disposable database and a new, explicit upload directory.
# This replaces database objects and refuses an existing upload destination.
: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD:?Set RESTIC_PASSWORD}"
: "${RESTORE_SNAPSHOT:?Set RESTORE_SNAPSHOT to a restic snapshot ID}"
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to the disposable target DB}"
: "${RESTORE_UPLOAD_DIR:?Set RESTORE_UPLOAD_DIR to a new absolute path}"
: "${RESTORE_ACK:?Set RESTORE_ACK=I_CONFIRM_DISPOSABLE_RESTORE after checking both targets}"

if [[ "$RESTORE_ACK" != I_CONFIRM_DISPOSABLE_RESTORE ]]; then
  echo 'Refusing restore: RESTORE_ACK must exactly equal I_CONFIRM_DISPOSABLE_RESTORE' >&2
  exit 2
fi
if [[ "$RESTORE_UPLOAD_DIR" != /* || "$RESTORE_UPLOAD_DIR" == / ]]; then
  echo 'RESTORE_UPLOAD_DIR must be an absolute non-root path' >&2
  exit 2
fi
if [[ -e "$RESTORE_UPLOAD_DIR" && ! -d "$RESTORE_UPLOAD_DIR" ]]; then
  echo 'Refusing restore: RESTORE_UPLOAD_DIR exists and is not a directory' >&2
  exit 2
fi
if [[ -d "$RESTORE_UPLOAD_DIR" ]] && [[ -n "$(find "$RESTORE_UPLOAD_DIR" -mindepth 1 -print -quit)" ]]; then
  echo 'Refusing restore: RESTORE_UPLOAD_DIR must be empty' >&2
  exit 2
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
restic restore "$RESTORE_SNAPSHOT" --target "$work/restored"
payload=$(find "$work/restored" -type f -name database.dump -print -quit | sed 's|/database.dump$||')
if [[ ! -d "$payload" || ! -f "$payload/database.dump" || ! -d "$payload/uploads" || ! -f "$payload/manifest.json" || ! -f "$payload/SHA256SUMS" ]]; then
  echo 'Snapshot does not contain a complete recovery set' >&2
  exit 1
fi
(cd "$payload" && sha256sum --check --strict SHA256SUMS)

existing_relations=$(psql --no-psqlrc --tuples-only --no-align --dbname "$RESTORE_DATABASE_URL" \
  --command "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','S','f') AND n.nspname NOT IN ('pg_catalog','information_schema')")
if [[ "$existing_relations" != 0 ]]; then
  echo 'Refusing restore: target database contains user relations; use a new empty disposable database' >&2
  exit 2
fi

# The caller explicitly selects this disposable PostgreSQL URL. pg_restore
# drops/recreates objects represented in the backup, so never point it at live data.
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error \
  --dbname "$RESTORE_DATABASE_URL" "$payload/database.dump"
mkdir -p "$RESTORE_UPLOAD_DIR"
cp -a "$payload/uploads/." "$RESTORE_UPLOAD_DIR/"
echo "Restore complete. Validate application readiness and content at the disposable target before any cutover."
