# Authentication and email operations

## Runtime and one user directory

Production uses the Node Better Auth service and Brevo. The portal forwards same-origin login requests and asks the private service to validate sessions; Go reloads permissions from PostgreSQL on each application request. `users.id` remains the permanent UUID. Auth credential tables reference it; there is no second roster to maintain.

Copy `.env.example` into a private runtime environment and set the HTTPS public URL, database password, SESSION_SECRET, AUTH_SERVICE_SECRET and BETTER_AUTH_SECRET to independent random secrets. Keep those values outside Git and logs. `AUTH_MODE=better_auth` with AUTH_INTERNAL_URL selects the dependency; no outage or stopped container enables mock login. Production rejects mock and capture. `make dev` uses the Node development picker and synthetic addresses from the same seeded development users; it needs no YAML changes. The old Go OIDC mock remains an isolated protocol test fixture.

Caddy blocks `/internal/*` and overwrites a private proxy token; Go uses it to trust Caddy's sanitized client IP and strips it before forwarding to auth. Standalone Go also supports an explicit TRUSTED_PROXY_CIDRS allowlist. Leave that allowlist empty unless another trusted proxy overwrites forwarded headers. Do not expose Go or the auth service directly to the internet; publish only Caddy. Internal session and mail endpoints require AUTH_SERVICE_SECRET. Never log headers, request bodies or auth URLs.

The server performs migrations before serving. For an existing OIDC deployment, apply the schema, review the existing UUID/email mapping and provision the first usable admin before switching modes. The old subject column and explicit `AUTH_MODE=oidc` consumer are retained for a tested real-provider rollback. A mode change revokes both legacy and dependency sessions and outstanding verifications under the shared database lock. Use a coordinated restart, not mixed auth configurations. Logout through the portal remains CSRF protected.

## Provision users without a GUI

The existing portal image contains the CLI. It requires DATABASE_URL; maintenance commands do not require working mail/auth credentials. Never run `seed` against production.

CSV example (private file, never commit a real roster):

```csv
id,email,name,role,admitted,cohort_member,login_enabled
,student@example.org,Example Student,student,true,true,true
```

For an existing person, put their existing UUID in `id`. An omitted UUID matches an existing normalized email or creates a new person. Never infer an existing identity from a display name. Keep an explicit reviewed UUID mapping during migration.

```sh
docker compose run --rm --no-deps -v /absolute/private/roster.csv:/run/roster.csv:ro portal users import --file /run/roster.csv --dry-run
docker compose run --rm --no-deps -v /absolute/private/roster.csv:/run/roster.csv:ro portal users import --file /run/roster.csv --apply
```

Imports are transactional and idempotent. Missing people are not deleted. Empty optional role/flag cells preserve existing permissions; new records default to student, unadmitted and login disabled. Add `--allow-elevated` for explicitly assigned manager/admin roles. The first admin needs role=admin, admitted=true and login_enabled=true with an address they control. Imports do not send invitations. Output contains only counts and UUIDs.

```sh
portal users set-email --id USER_UUID --email corrected@example.org --dry-run
portal users set-email --id USER_UUID --email corrected@example.org --apply
portal users disable --id USER_UUID --apply
portal users revoke-sessions --id USER_UUID --apply
```

Without `--apply`, these commands roll back. Supported changes preserve the last usable admitted admin. An email change clears mailbox verification, revokes sessions/old links, and quarantines the retired address for 20 minutes before another UUID may use it. Magic links expire after 15 minutes. Confirmation and supported identity mutations share a database lock, so a completed email change cannot leave a concurrent old-proof session active.

From a trusted psql connection (local socket or SSH tunnel), use the same functions:

```sql
SELECT portal_provision_user(NULL, 'student@example.org', 'Example Student', 'student', true, true, true);
SELECT portal_set_user_email('USER_UUID'::uuid, 'corrected@example.org');
SELECT portal_disable_user('USER_UUID'::uuid);
```

Use BEGIN/ROLLBACK for a SQL dry-run and COMMIT only after reviewing the result. The database owner can bypass supported management safeguards with raw writes; use the functions for normal administration. Operator actions have an ID-only audit ledger separate from student activity.

## Brevo setup and sending safety

Verify the sending domain and sender in Brevo, configure DKIM/SPF/DMARC and a monitored reply address, and set BREVO_API_KEY, MAIL_FROM and MAIL_REPLY_TO. Disable open and click tracking in the Brevo account before setting `BREVO_TRACKING_DISABLED=true`. This attests an account setting; the consent flag on a message is not a substitute. Real delivery refuses to start without the attestation and valid configuration.

Default local ceilings are 300 messages/day, 150 reminders/day, and 150 protected login messages. MAIL_DAILY_LIMIT, REMINDER_DAILY_LIMIT and MAIL_LOGIN_RESERVE are deployment safety ceilings; change these only after confirming the actual provider plan. The admin page cannot buy or increase Brevo quota. Login and reminders use the same sender and persisted atomic quota reservations.

At **Verwaltung → E-Mail**, admitted admins can inspect local usage/reservations, observed Brevo credits, worker status and the masked delivery audit. Provider credits are distinct from portal counts and may be unavailable/stale; no daily reset countdown is invented from unspecified provider data. Manual sending or other apps on a shared Brevo account can consume allowance, so prefer a dedicated account.

Admins can lower budgets, protect login capacity, pause reminders, refresh provider state and preview eligible reminder counts. An explicit pause-all setting stops login email too. Policy changes never reset usage or erase history. The audit distinguishes queued, provider-accepted, delivered, deferred, bounced, failed, suppressed, cancelled and uncertain messages. It stores metadata and an isolated recipient snapshot, not message bodies, login links, cookies or provider preview URLs. Metadata is pruned after 90 days. Reconciliation is paginated and reports incomplete provider retrieval as a failure. Hard bounces/complaints suppress reminders to that address across collections; correcting the address does not inherit the old-address suppression.

`MAIL_PROVIDER=capture` is development-only. It records delivery metadata without calling Brevo or persisting the credential-bearing email body. Real mailbox delivery cannot be validated without a verified sender and credentials; test one controlled address before importing the full roster.

## Deadline reminders

Reminders start disabled. Only open bounded collections explicitly opted in and eligible admitted cohort users with a configured address are considered. Users can opt out under **E-Mail-Erinnerungen** in their account sidebar; this leaves login mail available. Collection policy can be configured through the CLI:

```sh
portal reminders --category COLLECTION_UUID --enabled=true
portal reminders --category COLLECTION_UUID --enabled=true --apply
portal reminders --dry-run
portal reminders --once
# Hourly worker, opt-in Compose profile:
docker compose --profile reminders up -d reminders
```

Set REMINDERS_ENABLED=true only after reviewing the preview. The worker scans at 72/24 hours before a deadline, skips completed current work, rechecks immediately before sending, and deduplicates/cools down across retries and deadline edits. It checks only current-ballot existence, never named choices. Non-withdrawn pending/rejected submissions count as filled. Repeatable/ongoing/hidden/expired collections do not generate automatic reminders. Nothing closes implicitly in June 2027.

Ordinary portal links in reminders require sign-in; no login credential, contribution text, photos or choice data goes to the mail provider. Provider acceptance is not delivery. Ambiguous network failures retain conservative quota reservations; delivery is at-least-once, not a promise of exactly-once inbox delivery.

## Validation, recovery and optional login methods

Run `make check` with TEST_DATABASE_URL pointing only at a disposable PostgreSQL database. Set TEST_DATABASE_DISPOSABLE=YES to opt into the dependency's isolated-schema integration tests. `scripts/test-recovery.sh` creates its own throwaway database, volumes and recovery repository, verifies the database/files together, and cleans only its resources.

Restore with application/worker access stopped. The restore command revokes legacy/dependency sessions and verifications, cancels pending reminder work, marks interrupted sends uncertain and preserves delivery audit plus conservative quota reservations before restarting. A restored backup must not resurrect a consumed link or resend an old job. Keep secrets outside recovery volumes and restore the configuration separately.

Google and passkeys remain optional follow-up features, as in the approved plan. Enable them through Better Auth, preserving the same UUID and Go authorization. Do not enable automatic registration/linking, a second admin-role system or a separate Go WebAuthn implementation.
