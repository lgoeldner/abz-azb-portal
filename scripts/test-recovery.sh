#!/usr/bin/env bash
set -Eeuo pipefail

# A real, local-only backup/restore drill. All names are unique and cleanup is
# limited to resources created by this invocation.
root=$(cd "$(dirname "$0")/.." && pwd)
# Uses the current Docker context; set DOCKER_CONTEXT to pick another.
dc() { docker "$@"; }

if ! dc info >/dev/null 2>&1; then
  echo "Docker engine is unavailable (context: $(docker context show 2>/dev/null))" >&2
  exit 2
fi

suffix="$(date +%s)-$$-${RANDOM}"
prefix="portal-recovery-${suffix}"
network="$prefix-net"
pg="$prefix-db"
db_volume="$prefix-db-data"
uploads_volume="$prefix-uploads"
repo_volume="$prefix-repo"
status_volume="$prefix-status"
restored_volume="$prefix-restored-uploads"
portal_image=${PORTAL_IMAGE:-"$prefix-portal:local"}
backup_image=${BACKUP_IMAGE:-"$prefix-backup:local"}
remove_portal_image=0
remove_backup_image=0

cleanup() {
  local code=$?
  dc rm -f "$pg" >/dev/null 2>&1 || true
  dc volume rm "$db_volume" "$uploads_volume" "$repo_volume" "$status_volume" "$restored_volume" >/dev/null 2>&1 || true
  dc network rm "$network" >/dev/null 2>&1 || true
  [[ "$remove_portal_image" == 0 ]] || dc image rm "$portal_image" >/dev/null 2>&1 || true
  [[ "$remove_backup_image" == 0 ]] || dc image rm "$backup_image" >/dev/null 2>&1 || true
  exit "$code"
}
trap cleanup EXIT INT TERM

if [[ -z "${PORTAL_IMAGE:-}" ]]; then
  dc build -t "$portal_image" -f "$root/deployables/portal/Dockerfile" "$root/deployables/portal"
  remove_portal_image=1
fi
if [[ -z "${BACKUP_IMAGE:-}" ]]; then
  dc build -t "$backup_image" -f "$root/deployables/backup/Dockerfile" "$root/deployables/backup"
  remove_backup_image=1
fi

dc network create "$network" >/dev/null
dc volume create "$db_volume" >/dev/null
dc volume create "$uploads_volume" >/dev/null
dc volume create "$repo_volume" >/dev/null
dc volume create "$status_volume" >/dev/null
dc volume create "$restored_volume" >/dev/null

dc run -d --name "$pg" --network "$network" \
  -e POSTGRES_DB=portal -e POSTGRES_USER=portal -e POSTGRES_PASSWORD=recovery-only \
  -v "$db_volume:/var/lib/postgresql" postgres:18-alpine >/dev/null
# Probe over TCP: during init the image runs a socket-only temporary server that pg_isready would accept.
for attempt in $(seq 1 60); do
  if dc exec "$pg" pg_isready -h 127.0.0.1 -U portal -d portal >/dev/null 2>&1; then break; fi
  if [[ "$attempt" == 60 ]]; then echo 'Disposable PostgreSQL did not become ready' >&2; exit 1; fi
  sleep 1
done

db_url="postgres://portal:recovery-only@${pg}:5432/portal?sslmode=disable"
app_env=(--network "$network" -e APP_ENV=development -e AUTH_MODE=mock \
  -e DATABASE_URL="$db_url" -e PUBLIC_URL=http://127.0.0.1:8080 \
  -e SESSION_SECRET=recovery-drill-only-secret-at-least-32-bytes)
dc run --rm "${app_env[@]}" "$portal_image" migrate
dc run --rm "${app_env[@]}" "$portal_image" seed

# Add a real immutable file and matching attachment row, plus a named ballot.
# The fixed fixture has no personal or production content.
attachment_id=50000000-0000-4000-8000-000000000001
original_key="$attachment_id.original"
preview_key="$attachment_id.preview.jpg"
original_hash=$(printf 'recovery drill attachment v1\n' | dc run --rm -i alpine:3.22 sha256sum | awk '{print $1}')
dc run --rm -i -v "$uploads_volume:/uploads" alpine:3.22 sh -c \
  'printf "recovery drill attachment v1\\n" > /uploads/50000000-0000-4000-8000-000000000001.original && printf "recovery drill preview v1\\n" > /uploads/50000000-0000-4000-8000-000000000001.preview.jpg && chown 10001:10001 /uploads/*'
dc exec -i "$pg" psql -X -v ON_ERROR_STOP=1 -U portal -d portal \
  -v attachment_id="$attachment_id" -v original_hash="$original_hash" \
  -v original_key="$original_key" -v preview_key="$preview_key" <<'SQL'
INSERT INTO attachments(id,submission_id,filename,mime_type,size_bytes,sha256,storage_key,preview_key)
VALUES (:'attachment_id','20000000-0000-4000-8000-000000000004','drill.png','image/png',29,:'original_hash',:'original_key',:'preview_key');
UPDATE categories SET max_choices=2 WHERE id='30000000-0000-4000-8000-000000000002';
INSERT INTO ballots(poll_id,user_id,option_id)
VALUES ('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000201');
INSERT INTO ballots(poll_id,user_id,option_id)
SELECT poll_id,'00000000-0000-4000-8000-000000000003',id FROM poll_options
WHERE poll_id='30000000-0000-4000-8000-000000000002' AND id<>'40000000-0000-4000-8000-000000000201' ORDER BY position LIMIT 1;
INSERT INTO ballot_audit(id,poll_id,user_id,option_id)
VALUES ('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000201');
INSERT INTO ballot_audit(id,poll_id,user_id,option_id,ballot_id)
SELECT gen_random_uuid(),poll_id,user_id,option_id,'50000000-0000-4000-8000-000000000003'
FROM ballots WHERE poll_id='30000000-0000-4000-8000-000000000002';
UPDATE categories SET max_choices=2 WHERE id='30000000-0000-4000-8000-000000000001';
INSERT INTO ballots(poll_id,user_id,option_id)
SELECT poll_id,'00000000-0000-4000-8000-000000000004',id FROM poll_options
WHERE poll_id='30000000-0000-4000-8000-000000000001' ORDER BY position LIMIT 2;
INSERT INTO ballot_audit(id,poll_id,user_id,option_id,ballot_id)
SELECT gen_random_uuid(),poll_id,user_id,option_id,'50000000-0000-4000-8000-000000000004'
FROM ballots WHERE poll_id='30000000-0000-4000-8000-000000000001';
-- Word portraits preserve originals, moderation (including merged/excluded
-- labels), current votes and named history as part of the same recovery set.
INSERT INTO categories(id,name,description,kind,status,max_choices,opened_at)
VALUES ('60000000-0000-4000-8000-000000000001','Recovery word portrait','','words','open',3,now());
INSERT INTO poll_options(id,poll_id,label,position,word_label,excluded,moderation_version) VALUES
('60000000-0000-4000-8000-000000000101','60000000-0000-4000-8000-000000000001','chaotisch',0,'chaos',false,2),
('60000000-0000-4000-8000-000000000102','60000000-0000-4000-8000-000000000001','chaos',1,NULL,false,1),
('60000000-0000-4000-8000-000000000103','60000000-0000-4000-8000-000000000001','ausgeblendet',2,NULL,true,2);
INSERT INTO ballots(poll_id,user_id,option_id)
SELECT poll_id,'00000000-0000-4000-8000-000000000003',id FROM poll_options
WHERE poll_id='60000000-0000-4000-8000-000000000001';
INSERT INTO ballot_audit(id,poll_id,user_id,option_id,ballot_id)
SELECT gen_random_uuid(),poll_id,user_id,option_id,'60000000-0000-4000-8000-000000000201'
FROM ballots WHERE poll_id='60000000-0000-4000-8000-000000000001';
SQL

capture_signature() {
  local database=$1 table
  for table in users categories sessions submissions revisions attachments corrections poll_options ballots ballot_audit audit_events schema_migrations; do
    dc exec -e PGDATABASE="$database" "$pg" psql -X -qAt -U portal -c \
      "SELECT '$table',count(*),COALESCE(md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)),'') FROM $table t" \
      | tr -d '\r'
  done
}

before_signature=$(capture_signature portal)
before_uploads=$(dc run --rm -v "$uploads_volume:/uploads:ro" alpine:3.22 sh -c 'cd /uploads && find . -type f -print0 | sort -z | xargs -0 sha256sum')

dc run --rm --network "$network" -v "$uploads_volume:/uploads:ro" \
  -v "$repo_volume:/repo" -v "$status_volume:/status" \
  -e RESTIC_REPOSITORY=/repo -e RESTIC_PASSWORD=recovery-drill-only \
  --entrypoint restic "$backup_image" init
dc run --rm --network "$network" -v "$uploads_volume:/uploads:ro" \
  -v "$repo_volume:/repo" -v "$status_volume:/status" \
  -e PGHOST="$pg" -e PGPORT=5432 -e PGDATABASE=portal -e PGUSER=portal \
  -e PGPASSWORD=recovery-only -e PGSSLMODE=disable \
  -e RESTIC_REPOSITORY=/repo -e RESTIC_PASSWORD=recovery-drill-only \
  -e BACKUP_HEARTBEAT_URL=file:///etc/hostname -e BACKUP_STATUS_FILE=/status/status.json \
  -e UPLOAD_DIR=/uploads -e BACKUP_ONCE=1 -e APP_VERSION=recovery-drill \
  "$backup_image"

snapshot=$(dc run --rm --network "$network" -v "$repo_volume:/repo" \
  -e RESTIC_REPOSITORY=/repo -e RESTIC_PASSWORD=recovery-drill-only \
  --entrypoint restic "$backup_image" snapshots --json \
  | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([a-f0-9]*\)".*/\1/p' | head -n 1)
if [[ -z "$snapshot" ]]; then echo 'Backup did not create a Restic snapshot' >&2; exit 1; fi

restore_env=(--network "$network" -v "$repo_volume:/repo" \
  -e RESTIC_REPOSITORY=/repo -e RESTIC_PASSWORD=recovery-drill-only \
  -e RESTORE_SNAPSHOT="$snapshot" -e RESTORE_ACK=I_CONFIRM_DISPOSABLE_RESTORE)

# Confirm the production safety gate with a deliberately non-empty disposable DB.
dc exec "$pg" createdb -U portal portal_restore_nonempty
dc exec -e PGDATABASE=portal_restore_nonempty "$pg" psql -X -v ON_ERROR_STOP=1 -U portal \
  -c 'CREATE TABLE sentinel(id integer PRIMARY KEY)'
if dc run --rm "${restore_env[@]}" -e RESTORE_DATABASE_URL="postgres://portal:recovery-only@${pg}:5432/portal_restore_nonempty?sslmode=disable" \
  -e RESTORE_UPLOAD_DIR=/restore-target -v "$restored_volume:/restore-target" \
  --entrypoint /usr/local/bin/restore.sh "$backup_image"; then
  echo 'Restore unexpectedly accepted a non-empty target database' >&2
  exit 1
fi

dc exec "$pg" createdb -U portal portal_restore
dc run --rm "${restore_env[@]}" -e RESTORE_DATABASE_URL="postgres://portal:recovery-only@${pg}:5432/portal_restore?sslmode=disable" \
  -e RESTORE_UPLOAD_DIR=/restore-target -v "$restored_volume:/restore-target" \
  --entrypoint /usr/local/bin/restore.sh "$backup_image"

after_signature=$(capture_signature portal_restore)
if [[ "$before_signature" != "$after_signature" ]]; then
  diff -u <(printf '%s\n' "$before_signature") <(printf '%s\n' "$after_signature") || true
  echo 'Restored table counts or contents differ from the source database' >&2
  exit 1
fi
after_uploads=$(dc run --rm -v "$restored_volume:/uploads:ro" alpine:3.22 sh -c 'cd /uploads && find . -type f -print0 | sort -z | xargs -0 sha256sum')
if [[ "$before_uploads" != "$after_uploads" ]]; then
  diff -u <(printf '%s\n' "$before_uploads") <(printf '%s\n' "$after_uploads") || true
  echo 'Restored upload file hashes differ from the source volume' >&2
  exit 1
fi
if ! dc exec "$pg" psql -X -qAt -U portal -d portal_restore -c \
  "SELECT count(*) FROM attachments a WHERE a.id='$attachment_id' AND a.sha256='$original_hash'" | grep -qx 1; then
  echo 'Restored attachment reference does not match its immutable file hash' >&2
  exit 1
fi

echo "Recovery drill passed for snapshot $snapshot (migrations, seed data, revisions, word moderation, ballots, and attachment files verified)."
