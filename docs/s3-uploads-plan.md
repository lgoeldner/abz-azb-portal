# S3 upload storage plan

Status: proposed. Nothing here is implemented.

## Goal

Store attachment originals and previews in IONOS S3 in production. Keep local disk as the default when no S3 config is set. Use S3Mock (adobe/s3mock) in dev and CI.

## Today

- Uploads live under `UPLOAD_DIR`. Keys are `<id>.original` and `<id>.preview.jpg` (`files.go`). The id is unique per attachment, so a key is never written twice.
- `immutableWrite` uses `O_EXCL`. Do not depend on S3 conditional writes (`If-None-Match`); IONOS support is unverified. Unique keys already give the same guarantee.
- Disk is touched in `files.go` (write, read, ZIP export), `erase.go` (remove), `admin.go` (`diskBytes`), `http.go` (`MkdirAll`).
- Backup and restore copy `UPLOAD_DIR` (restic, `RESTORE_UPLOAD_DIR`). S3 changes this.

## Steps

1. **Blob store.** Small interface in `files.go`: `Put(key, data)`, `Open(key)`, `Remove(key)`, `Bytes()`. Disk implementation is the current code. No other abstraction.
2. **S3 implementation.** AWS SDK for Go v2, path-style addressing. Config in `config.go`: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Unset means disk. Partly set is a startup error. Production requires S3 only if the owner decides so.
3. **Call sites.** Route write, read, export, erasure and usage through the interface. Remove `MkdirAll` for S3 mode.
4. **Dev.** S3Mock service in the dev compose file with a pinned image version and the bucket created on start. Env vars set in `scripts/dev-common.sh`. No mock login or public bucket access.
5. **Tests.** Run the existing upload, photo, Steckbrief and erasure invariants against both stores. Add: a failed upload leaves no object; erasure removes originals and previews; no key is overwritten.
6. **IONOS smoke test.** Opt-in (env-gated) put/get/delete against a throwaway bucket. No real contributions.
7. **Backup and restore (separate commit).** Decide whether restic copies the bucket, or bucket versioning/replication replaces it. Then extend `scripts/test-recovery.sh` to prove restore of S3 objects. A backup file alone is not a tested recovery.
8. **Docs.** Update `docs/repo-map.md`, config docs and operations notes. Run `make check`.

## Rules

- Bucket stays private. Images are served through the portal's permission checks only.
- No credentials, object keys with private names, or contents in logs.
- Erasure must still remove all objects and report failures like today (`failed_files`).
- Migrating existing disk uploads to the bucket is a one-off command, written when production data exists.

## Open decisions

- Does S3 replace disk in production, or stay optional?
- Backup strategy for the bucket (step 7).
- IONOS region and endpoint.
