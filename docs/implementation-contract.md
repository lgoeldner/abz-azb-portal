# Implementation contract

This file is the integration boundary for the initial implementation. The lead owns changes here.

## Runtime

- Every Docker image owns one folder under `deployables/` that is its complete build context: `portal/` (Dockerfile, Go module `abizeitbetrug/server` in `portal/server`, frontend in `portal/web`), `auth-mock/` (own Go module `abizeitbetrug/auth-mock`, package `authmock`, `users.yaml`), `backup/`, `caddy/`. No Dockerfile copies from outside its folder.
- A root `go.work` joins the two Go modules for development and tests only; portal tests may import `abizeitbetrug/auth-mock/authmock`, portal production code must not. Docker builds run without the workspace.
- Executable `deployables/portal/server/cmd/portal`, PostgreSQL via pgx. Listen `:8080` by default.
- Runtime env: `APP_ENV=development|production`, `ADDR`, `DATABASE_URL`, `PUBLIC_URL`, `UPLOAD_DIR`, `STATIC_DIR`, `AUTH_MODE=mock|oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET`, `BOOTSTRAP_ADMIN_SUBJECT` (explicit issuer subject, never display name), `BACKUP_STATUS_FILE`. `OIDC_BACKCHANNEL_URL` is an optional origin override only for development mock mode, allowing container requests to reach the provider while preserving its canonical issuer.
- Production rejects mock auth and insecure/missing configuration. Go serves built frontend from STATIC_DIR, fallback index.html only outside API/auth routes.
- `portal migrate` runs versioned migrations, `portal seed` inserts deterministic development fixtures only, `portal serve` starts HTTP (default). Fixtures include users and sample content/polls. No production data is seeded.
- `/healthz` liveness; `/readyz` database readiness.

## HTTP

JSON API under `/api/v1`. Errors `{ "error": { "code": "...", "message": "..." } }`. UUID IDs; RFC3339 UTC timestamps. List endpoints return arrays; ordinary mutations return the resulting object. Authentication failure 401, permission failure 403, missing/inaccessible private record 404, stale version/invalid transition/closed poll 409, validation 400, too large 413. All non-auth unsafe API requests require `X-CSRF-Token` obtained from GET /me. Cookies carry sessions, never browser token storage. Fetch uses same origin.

Types (snake_case JSON):

```
User { id, name, role: 'student'|'manager'|'admin', admitted: boolean, cohort_member: boolean, category_ids: string[], created_at: string }
Me { user: User, csrf_token: string }
Category { id, name, description, kind: 'idea'|'quote'|'memory'|'photo'|'person'|'proposal', repeatable: boolean, status: 'draft'|'open'|'closed', allow_self_vote: boolean, options: PollOption[], my_option_id: string|null, version: number, created_at, opened_at: string|null, ballot_count: number|null, participation: {voted: number, eligible: number}|null }
Attachment { id, filename, mime_type, size_bytes, url, preview_url }
Submission { id, category_id, author_id, author_name, title, body, context, status: 'pending'|'accepted'|'rejected'|'withdrawn', version: number, created_at, updated_at, attachments: Attachment[] }
Revision { id, version, actor_name, title, body, context, status, created_at }
Correction { id, submission_id, author_name, body, created_at, resolved: boolean }
PollOption { id, label, user_id?: string }
PollResult { option_id, label, count: number }
BallotAudit { user_id, user_name, option_id, option_label, created_at }
AuditEvent { id, actor_name, action, entity_id, created_at }
```

Endpoints:

- `GET /me` -> Me. `POST /auth/logout` (outside prefix) logs out with CSRF header, then client reloads login.
- `GET /auth/login` redirects to the external OIDC provider; `GET /auth/callback` exchanges a one-use authorization code with PKCE and verifies the signed ID token, issuer, audience, expiry and nonce before creating the session. Both auth modes use this same consumer flow. The portal exposes no identity-list or mock-provider routes.
- Development only: the separate `auth-mock` service at `http://localhost:9090` reads `deployables/auth-mock/users.yaml` (`users: [{name, display_slug}]`; the OIDC subject is a UUIDv5 of the slug under a fixed namespace, never configured by hand). Its `/authorize` page lists every configured identity; `POST /authorize` selects one. Discovery, `/keys` and `/token` implement OIDC authorization-code flow with S256 PKCE and short-lived RS256 JWTs. Exact callback allowlists prevent open redirects. The provider has no database access or portal role claims. Seeded accounts use the subjects derived from their slugs and retain local fixture permissions; new slugs become pending local accounts. The provider refuses to run unless `APP_ENV=development` and is absent from production Compose.
- A Category (UI term: Sammlung) is the only class of data collection. Its `kind` is its class. Repeatable kinds `idea`, `quote`, `memory`, `photo` (`repeatable: true`) collect any number of submissions per person; their `status` is always `open`, `options` empty, `my_option_id`, `ballot_count` and `participation` null. Single-answer kinds `person`, `proposal` (`repeatable: false`) are single_choice ballots with lifecycle draft -> open -> closed. Polls are no separate entity.
- `GET /categories` -> Category[]. Students see no drafts. `ballot_count` and `participation` only for editors, null for students and repeatable categories. `ballot_count` includes all preserved current ballots. `participation.voted` counts only current ballots from currently admitted cohort members; `participation.eligible` counts the same population, regardless of role. Both participation counts use one database snapshot, so revoking admission or cohort membership excludes that person from both without deleting ballots or named history. Zero eligible people means zero participation. The Redaktion dashboard shows voted/eligible with a proportional gray-to-green bar and rounded percentage.
- `POST /categories` `{name,description,kind,allow_self_vote,options:[{label,user_id?}]}`. Repeatable kinds: admin only, options must be empty. Single-answer kinds: admins, and managers (the new id is added to the manager's `category_ids` in the same transaction); created as draft; option rules unchanged from the former poll validation (2-500 options, unique, person options carry a user_id).
- `PATCH /categories/{id}` same fields plus `version`; stale version 409. Repeatable: admin only. Single-answer: `canEdit`, draft only. `kind` may change only within its group (repeatable vs single-answer), otherwise 400.
- `POST /categories/{id}/status` `{version,status:'open'|'closed'}` single-answer only (400 otherwise): draft->open, open->closed.
- `GET /submissions?category_id=&status=&q=` -> Submission[]. Students automatically restricted to own; editors all. Search q matches title, body and author name. `POST /submissions` `{idempotency_key,category_id,title,body,context}` creates pending (UI: Eingereicht). Collection has no review/release gate; all contributions remain visible to authorized readers before post-collection moderation. Submissions (create and category edit) require a repeatable category, otherwise 400. `GET /submissions/{id}` -> Submission.
- `PATCH /submissions/{id}` `{version,title,body,context,category_id}`. Author only while pending, including admins/managers editing their own contributions; editorial roles cannot change other authors’ text or photos. Redaktion mode exposes no content mutations, including on own contributions. Revision and audit transaction.
- `POST /submissions/{id}/status` `{version,status}`. Author pending->withdrawn. Editors pending->accepted/rejected, accepted/rejected/withdrawn->pending. No other transitions.
- `GET /submissions/{id}/revisions` -> Revision[]. Same read permission as submission.
- `POST /submissions/{id}/attachments` multipart `file`, `version` field. `DELETE /submissions/{id}/attachments/{attachmentID}` with `{version}`. Return Submission with incremented version. Same mutation permissions as text; originals immutable. `GET /attachments/{id}` original and `/attachments/{id}/preview` authorized image response.
- `GET /submissions/{id}/corrections` -> Correction[]. `POST /submissions/{id}/corrections` `{body}` author on locked contribution, or editor with category grant on any status (editorial annotation). Notes are separate from the original and readable by its author and editors. Editors without grants have read access only. `POST /submissions/{id}/corrections/{correctionID}/resolve` editorial permission.
- `PUT /categories/{id}/ballot` `{option_id}` -> `{option_id}`, single-answer only. One current vote, changes permitted while open; eligible active admitted cohort only, option belongs to poll, self vote rejected by default. Row lock poll against closing; UNIQUE(poll_id,user_id). Do not bump poll definition version for votes.
- `GET /categories/{id}/results` -> PollResult[] editors only. `GET /categories/{id}/audit` -> BallotAudit[] admins only, includes changes. Never in generic category payload. There are no `/polls` routes.
- `GET /roster` -> `{id,name}[]` admitted cohort only (minimal candidate names required for polling).
- `GET /categories/{id}/export?status=all` -> ZIP, editors all repeatable categories (single-answer 400). Default status is 'all', including pending, accepted, rejected and withdrawn originals; explicit status filters remain available for later moderation. CSV and originals plus JSON manifest. No ballots.
- Admin: `GET /admin/users` -> User[]; `PATCH /admin/users/{id}` `{name,role,admitted,cohort_member,category_ids}`. Do not allow removal of the last admitted admin. `DELETE /admin/users/{id}` -> 204; 404 unknown id; 409 `self_delete`, `last_admin`, or `has_content` (any submissions, revisions, corrections, ballots, ballot audit, audit events or poll-option links; block access instead). Deletes sessions and writes `user.deleted`.
- Admin: `GET /admin/audit` -> AuditEvent[] (recent 200); `GET /admin/status` -> `{backup_last_success: string|null, backup_stale:boolean, upload_bytes:number}`.

## Ownership and quality

- Backend agent owns deployables/portal/server/ and deployables/auth-mock/ Go code, migrations, backend tests. UI agent owns deployables/portal/web/. Ops agent owns ops/, Dockerfiles, compose files, Makefile, .github/workflows/.
- Root owns docs/, README, .gitignore, integration fixes. Shared changes coordinated before edits.
- Every data read enforces role/ownership, including files, revision history, exports and poll data. Managers read all submissions and annotate only granted categories. Only authors mutate pending original submissions and their attachments. Category/poll administration remains grant-controlled. Pending author edits preserve history. No audit or system log stores credentials.
- Production never enables mock login. Mock seed identities are deterministic. Admin privileges remain local to the application.
- Backend integration tests use TEST_DATABASE_URL and a disposable isolated database/schema; tests must skip clearly if unavailable, never touch real data. UI includes component tests and Playwright journeys configured for a running seeded app.
- Database + immutable files are backed up as one recovery set. File removal is soft deletion; no physical GC in v1. All acknowledged uploads are finalized on disk before database references commit.

## Migration 004: polls become categories

Each poll becomes a category row with the same id (title -> name, kind, status, allow_self_vote, version, created_at, opened_at). Existing repeatable categories get status `open`, version 1. `poll_options`, `ballots`, `ballot_audit` keep their rows and reference `categories`. Every user whose `category_ids` contained a poll's former category also gets the poll's id. The `polls` table is dropped. Audit actions keep their names (`poll.*` for single-answer operations, `category.*` for definitions).

## Redaktion collection workspace

Verwaltung navigation is available only to admins in Redaktion; direct Verwaltung bookmarks activate and remember Redaktion mode. Redaktion uses neutral gray chrome, white reading panels, and cobalt accents for actions, selection and focus; Schüler mode retains the yeargroup palette. Every repeatable collection opens a searchable list of all its submissions, with a read-only reader at `/redaktion/beitraege/:id`. The reader preserves originals, photos and revision history and allows optional category-granted annotations; no accept/reject/release action is required during collection. Single-answer collections show read-only options and aggregate results in Redaktion; voting stays in Schüler mode. Existing status endpoints and historical statuses remain available for later moderation, without changing or automatically releasing existing data.
