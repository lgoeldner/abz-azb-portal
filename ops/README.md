# Deployment, backup and restore

Production runs PostgreSQL 18, the Go server with embedded React assets, Caddy, and a Restic backup sidecar. Only Caddy publishes ports 80 and 443. PostgreSQL is on a private network; the application and backup worker also have outbound access for OIDC and independent backup storage. Uploads and database data use separate Docker volumes.

1. Point the public DNS name at the VPS, copy `.env.example` to `.env`, and set real secrets, OIDC values, the public host, and independent backup storage credentials. Configure the OIDC provider callback at `https://<PUBLIC_HOST>/auth/callback`.
2. Build both images with `docker compose --profile production build`, then start the database with `docker compose up -d db`. Initialize a new backup repository once using `docker compose --profile production run --rm --no-deps --entrypoint restic backup init`. For an existing repository, use `snapshots` instead of `init` to verify access.
3. Run schema changes as a one-off command: `docker compose run --rm --no-deps portal migrate`. Then start the application, proxy, and backup worker with `docker compose --profile production up -d`. Check `https://<PUBLIC_HOST>/healthz` and `/readyz`.
4. Watch `docker compose logs -f portal caddy backup`. Backup status is published only after `pg_dump`, upload copy, Restic backup, repository integrity check, retention, and external heartbeat all succeed. An external heartbeat monitor must alert when no ping arrives for 26 hours. Restic retention keeps 14 daily, 8 weekly, and 12 monthly recovery points.

The backup takes a custom-format PostgreSQL dump before copying uploads. Uploads are immutable and are not physically collected in v1; each database reference therefore points to a file already finalized before the dump. The manifest records the application and migration versions, and the SHA-256 list is stored in the same Restic snapshot. Store Restic credentials and repository outside the VPS and test access to the independent repository periodically.

## Restore drill

Restore only into a disposable PostgreSQL database and a new upload directory. This command drops/recreates objects represented in the dump. Verify the database URL and upload destination before running it:

```sh
export RESTORE_SNAPSHOT='<restic snapshot ID>'
export RESTORE_DATABASE_URL='postgres://portal:...@disposable-host:5432/portal_restore?sslmode=disable'
export RESTORE_UPLOAD_DIR='/srv/portal-restore/uploads'
export RESTORE_ACK=I_CONFIRM_DISPOSABLE_RESTORE
mkdir -p /srv/portal-restore/uploads
make restore
```

The restore script checks that the snapshot contains a database dump, upload tree, manifest, and valid checksums before changing the target. The destination directory must be empty, and the script refuses to restore into a database that already has user tables. It restores upload contents directly into the selected directory, without an extra `uploads/` subdirectory. Then start a separate application instance with the disposable database and restored upload path, check readiness, open representative records and attachments, and verify login and exports. Record the snapshot ID, test date, validation results, and elapsed recovery time. The restore path has not been claimed as tested until this drill is run.

Local development uses any Docker engine via `make doctor` and `make dev`, with the frontend at `http://localhost:5173`, the Go API at `http://localhost:8080`, local mock login, and deterministic fixtures. The Make targets use the current Docker context (override with `DOCKER_CONTEXT`). Production remains Docker Compose on Linux. Never use the development compose file for production.
