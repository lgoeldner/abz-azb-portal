# Implementation contract

This file is the integration boundary for the initial implementation. The lead owns changes here.

## Runtime

- Go module `abizeitbetrug/server`, executable `server/cmd/portal`, PostgreSQL via pgx. Listen `:8080` by default.
- Runtime env: `APP_ENV=development|production`, `ADDR`, `DATABASE_URL`, `PUBLIC_URL`, `UPLOAD_DIR`, `STATIC_DIR`, `AUTH_MODE=mock|oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET`, `BOOTSTRAP_ADMIN_SUBJECT` (explicit issuer subject, never display name), `BACKUP_STATUS_FILE`.
- Production rejects mock auth and insecure/missing configuration. Go serves built frontend from STATIC_DIR, fallback index.html only outside API/auth routes.
- `portal migrate` runs versioned migrations, `portal seed` inserts deterministic development fixtures only, `portal serve` starts HTTP (default). Fixtures include users and sample content/polls. No production data is seeded.
- `/healthz` liveness; `/readyz` database readiness.

## HTTP

JSON API under `/api/v1`. Errors `{ "error": { "code": "...", "message": "..." } }`. UUID IDs; RFC3339 UTC timestamps. List endpoints return arrays; ordinary mutations return the resulting object. Authentication failure 401, permission failure 403, missing/inaccessible private record 404, stale version/invalid transition/closed poll 409, validation 400, too large 413. All non-auth unsafe API requests require `X-CSRF-Token` obtained from GET /me. Cookies carry sessions, never browser token storage. Fetch uses same origin.

Types (snake_case JSON):

```
User { id, name, role: 'student'|'manager'|'admin', admitted: boolean, cohort_member: boolean, category_ids: string[] }
Me { user: User, csrf_token: string }
Category { id, name, description, kind: 'idea'|'quote'|'memory'|'photo' }
Attachment { id, filename, mime_type, size_bytes, url, preview_url }
Submission { id, category_id, author_id, author_name, title, body, context, status: 'pending'|'accepted'|'rejected'|'withdrawn', version: number, created_at, updated_at, attachments: Attachment[] }
Revision { id, version, actor_name, title, body, context, status, created_at }
Correction { id, submission_id, author_name, body, created_at, resolved: boolean }
PollOption { id, label, user_id?: string }
Poll { id, category_id, title, description, kind: 'person'|'proposal', format: 'single_choice', status: 'draft'|'open'|'closed', allow_self_vote: boolean, options: PollOption[], my_option_id: string|null, version: number }
PollResult { option_id, label, count: number }
BallotAudit { user_id, user_name, option_id, option_label, created_at }
AuditEvent { id, actor_name, action, entity_id, created_at }
```

Endpoints:

- `GET /me` -> Me. `POST /auth/logout` (outside prefix) logs out with CSRF header, then client reloads login.
- `GET /auth/mock/users` -> `{id,name,role}[]` development only. `GET /auth/login?user=<fixture-id>` initiates mock OIDC login; actual callback exercises signed token validation/state/nonce. Real OIDC uses `/auth/login` and `/auth/callback`. Mock provider endpoints are isolated under `/dev/oidc/`, never present in production.
- `GET /categories` -> Category[]. Admin `POST /categories` `{name,description,kind}`; `PATCH /categories/{id}` same fields.
- `GET /submissions?category_id=&status=&q=` -> Submission[]. Students automatically restricted to own; editors all. `POST /submissions` `{idempotency_key,category_id,title,body,context}` creates pending. `GET /submissions/{id}` -> Submission.
- `PATCH /submissions/{id}` `{version,title,body,context,category_id}`. Author only while pending; category edit restrictions for managers. Revision and audit transaction.
- `POST /submissions/{id}/status` `{version,status}`. Author pending->withdrawn. Editors pending->accepted/rejected, accepted/rejected/withdrawn->pending. No other transitions.
- `GET /submissions/{id}/revisions` -> Revision[]. Same read permission as submission.
- `POST /submissions/{id}/attachments` multipart `file`, `version` field. `DELETE /submissions/{id}/attachments/{attachmentID}` with `{version}`. Return Submission with incremented version. Same mutation permissions as text; originals immutable. `GET /attachments/{id}` original and `/attachments/{id}/preview` authorized image response.
- `GET /submissions/{id}/corrections` -> Correction[]. `POST /submissions/{id}/corrections` `{body}` author on locked contribution. `POST /submissions/{id}/corrections/{correctionID}/resolve` editorial permission.
- `GET /polls` -> Poll[]. Students see open/closed only, editors also drafts. `POST /polls` `{category_id,title,description,kind,allow_self_vote,options:[{label,user_id?}]}`. Format is fixed single_choice for v1.
- `PATCH /polls/{id}` same definition plus version; draft only. `POST /polls/{id}/status` `{version,status:'open'|'closed'}` draft->open, open->closed.
- `PUT /polls/{id}/ballot` `{option_id}` -> `{option_id}`. One current vote, changes permitted while open; eligible active admitted cohort only, option belongs to poll, self vote rejected by default. Row lock poll against closing; UNIQUE(poll_id,user_id). Do not bump poll definition version for votes.
- `GET /polls/{id}/results` -> PollResult[] editors only. `GET /polls/{id}/audit` -> BallotAudit[] admins only, includes changes. Never in generic poll payload.
- `GET /roster` -> `{id,name}[]` admitted cohort only (minimal candidate names required for polling).
- `GET /categories/{id}/export?status=accepted` -> ZIP, editors all categories. Status 'all' explicitly includes other statuses. CSV and originals plus JSON manifest. No ballots.
- Admin: `GET /admin/users` -> User[]; `PATCH /admin/users/{id}` `{name,role,admitted,cohort_member,category_ids}`. Do not allow removal of the last admitted admin.
- Admin: `GET /admin/audit` -> AuditEvent[] (recent 200); `GET /admin/status` -> `{backup_last_success: string|null, backup_stale:boolean, upload_bytes:number}`.

## Ownership and quality

- Backend agent owns server/, migrations, backend tests. UI agent owns web/. Ops agent owns ops/, Dockerfile, compose files, Makefile, .github/workflows/.
- Root owns docs/, README, .gitignore, integration fixes. Shared changes coordinated before edits.
- Every data read enforces role/ownership, including files, revision history, exports and poll data. Managers read all submissions but mutate only granted categories. Student pending edits preserve history. No audit or system log stores credentials.
- Production never enables mock login. Mock seed identities are deterministic. Admin privileges remain local to the application.
- Backend integration tests use TEST_DATABASE_URL and a disposable isolated database/schema; tests must skip clearly if unavailable, never touch real data. UI includes component tests and Playwright journeys configured for a running seeded app.
- Database + immutable files are backed up as one recovery set. File removal is soft deletion; no physical GC in v1. All acknowledged uploads are finalized on disk before database references commit.
