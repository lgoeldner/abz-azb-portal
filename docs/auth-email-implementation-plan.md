# Email and authentication implementation plan

Status: proposed, 29 October 2026. This document does not enable email delivery or change authentication. It supplements the current implementation contract; that contract continues to describe the running application until implementation lands.

## Recommendation

Implement allowlisted magic-link login in the existing Go portal, reuse its PostgreSQL sessions, and send login emails and deadline reminders through Brevo's transactional API. Keep people and permissions in the portal database. Replace the default development OIDC mock with a development-only account picker reading that same development database. Keep the existing OIDC consumer available for deployments that choose an external identity provider.

This needs no paid authentication subscription, second user directory, Redis, or dedicated authentication container. Email delivery remains an external service. Owning the login implementation also means owning its security review, maintenance, and abuse controls.

An established self-hosted identity system is an alternative if authentication becomes a shared service for several applications. For example, [Ory Kratos](https://www.ory.com/kratos) lists magic links, Google OIDC, and passkeys. It would add an identity datastore and provisioning integration to this portal. Do not expand our development OIDC mock into a production identity provider.

## What exists today

- `auth.go` consumes OIDC authorization codes with PKCE, validates tokens, and establishes opaque 24-hour sessions. Session tokens are hashed in PostgreSQL and cookies are HttpOnly, SameSite=Lax, and Secure in production.
- `http.go` reloads the user from PostgreSQL on every authenticated request. Admission, roles, category grants, author ownership, and named-ballot access are application rules.
- `users.subject` is required and stores issuer plus provider subject. There is no email field. Unknown valid OIDC subjects currently create pending accounts.
- `deployables/auth-mock/users.yaml` and the development seed maintain separate representations of fixture identities. Production refuses mock authentication.
- Categories already have bounded deadlines and effective closing without a scheduler. There is no mail sender, reminder worker, or delivery ledger.

## Email provider and cost

Official published limits checked on 29 October 2026:

| Provider | Published allowance / price | Fit |
| --- | --- | --- |
| Brevo | Free, 300 emails per day, including transactional email; free messages carry Brevo branding | Recommended first provider: more daily room for a year-group login burst plus reminders. |
| Resend | Free, 3,000 emails per month and 100 per day | Straightforward alternative, but the daily ceiling is restrictive when students sign in together. |
| Amazon SES | A la carte outbound sending: USD 0.10 per 1,000 messages, plus applicable data charges | Low-cost option if daily free limits become awkward; requires AWS setup and production sending access. |

Sources: [Brevo free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [Brevo transactional email](https://www.brevo.com/products/transactional-email/), [Resend allowance](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [SES pricing](https://aws.amazon.com/ses/pricing/), [SES sandbox and production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html). These allowances are not delivery guarantees. Existing hosting and domain costs remain.

Both login and reminders use the same provider quota. For illustration, 150 reminder emails plus 150 magic-link requests exhaust a 300-email day before retries. Start with a configurable reminder budget of 150/day, reserving the rest for login, and adjust after measuring actual use. At SES's stated base rate, 3,000 outbound emails cost USD 0.30 before extras/taxes; implement that adapter only if needed.

Use a verified sending subdomain, DKIM/SPF and DMARC, a monitored reply address, and text plus HTML German templates. Disable click/open tracking for authentication and reminder messages. Send each recipient a separate transactional message; do not upload or maintain a parallel contact list in the provider's marketing tools. Provider setup, sender approval and DNS access are rollout prerequisites. Review the provider's processing terms and retention settings for student addresses; do not send contribution contents or named ballots.

## One user directory and provisioning

Preserve `users.id` as the permanent person identifier. All contributions, votes, grants, and audit references continue to use it.

Proposed additive schema:

- `users.login_email`, `users.login_email_normalized`, `users.email_verified_at`, `users.login_enabled`, `users.auth_version`, and a reminder preference. Enforce a unique normalized address when non-null. Imported addresses are not marked mailbox-verified.
- `auth_identities(user_id, issuer, subject)` with a unique `(issuer, subject)` binding. Migrate existing `users.subject` here without changing user IDs, then remove its mandatory status in a staged migration. This is a credential binding, not another person directory; native magic links use the user ID directly.
- `login_challenges(token_hash, user_id, auth_version, browser_nonce_hash, expires_at, consumed_at)`; never persist the raw link token.
- Add authentication origin (`mock`, `magic_link`, or `oidc`) and user auth version to sessions. Reject sessions from another configured mode or an outdated auth version. A persisted authentication-configuration epoch changes on each mode cutover; revoke sessions/challenges transactionally at cutover and check the epoch on session issuance and use. Switching away and back must not revive an old session. Serialize cutovers in PostgreSQL and reject authentication from a process running an obsolete epoch during deployment. Remove legacy sessions at initial cutover and require sign-in again.

Normalize addresses using one documented policy: trim surrounding whitespace and compare the complete address case-insensitively. Reject malformed addresses, display-name syntax, controls, and normalization collisions. Do not remove plus suffixes or Gmail dots. Preserve the original address for sending. No matching or merging by display name.

Provide these commands in the existing portal binary; examples below describe the planned interface, not commands available today:

```sh
portal users import --file /run/private/roster.csv --dry-run
portal users import --file /run/private/roster.csv --apply
portal users set-email --id USER_UUID --email student@example.org --apply
portal users disable --id USER_UUID --apply
portal users revoke-sessions --id USER_UUID --apply
```

CSV fields: `id,email,name,role,admitted,cohort_member,login_enabled`. New rows may omit `id`; migration rows must explicitly identify an existing user ID. New accounts default to student, unadmitted, and login disabled unless explicitly enabled. A normal student roster can explicitly set admitted/cohort_member/login_enabled true. Existing rows retain permissions unless the import explicitly requests a permission change. Reimports are idempotent; conflicting IDs/emails abort the transaction. Never automatically delete users missing from a CSV. Require an explicit admin-provisioning option for elevated roles. Extend the last-admin guard to preserve at least one admitted, login-enabled admin with a usable configured sign-in method, including when disabling login, changing addresses, or unlinking credentials. Serialize these mutations to prevent concurrent lockout. Allow explicit first-admin provisioning when none exists. Imports never send invitations implicitly.

The CLI and existing admin mutations must share the same user-management rules. No creation GUI is required. The existing GUI can continue editing the same records. CSVs, email exports, and real addresses stay outside Git and logs; command output reports counts and opaque IDs.

Direct PostgreSQL access remains possible. Supply a documented SQL function for provisioning/disabling/email changes, used by the CLI too, so a psql session gets identical normalization, conflict, last-admin, session-revocation, and audit behavior. Authenticate the operator as a database operator, not an invented student actor; use a small operator audit ledger with IDs/actions and no email contents. Direct table writes by a database owner can bypass application safeguards and are not the supported provisioning interface. Do not expose PostgreSQL publicly for this workflow; use local access or an SSH tunnel.

Use a database trigger to increment `auth_version` and clear email verification when the login email changes, and increment it when login is disabled. Challenge/session validation checks this version and current login eligibility, so even direct identity-field SQL updates cannot leave old login links valid. Existing per-request role/admission checks continue to apply. No routine maintenance commands should require a live OIDC provider or mail API; split CLI configuration validation from server authentication setup.

## Magic-link sign-in

1. `GET /auth/login` presents the email form in `magic_link` mode and establishes pre-login CSRF/browser state independently of the entered address. `POST /auth/magic/request` checks same-origin/pre-login CSRF and rate limits, then submits a short-lived task to a bounded in-process dispatcher before any allowlist lookup or provider call. Respond with the same generic accepted message, status, headers, and cookie behavior for unknown, disabled, unadmitted, and eligible addresses. The dispatcher discards the first three without email or account creation. Queue saturation is handled uniformly regardless of address; responses never wait on provider delivery.
2. Reuse a valid initiating-browser nonce across outstanding requests; do not overwrite it on every resend. Use a short-lived HttpOnly Secure SameSite cookie, with a lifetime covering outstanding 15-minute challenges. For an eligible address, the dispatcher generates a 32-byte cryptographically random token and stores only the token/nonce digests, user ID/auth version, and expiration. Set limits per normalized address (including unknown ones) and trusted client IP, a resend cooldown, and a small maximum of outstanding challenges. Do not invalidate somebody's previous usable link merely because a new request arrives. Requesting link B in the same browser must leave link A usable until success or expiry.
3. Dispatch promptly through the bounded-time mail sender, generating challenges only when ready to send. Do not persist raw magic links in a general email outbox. In-process tasks expire quickly; a process restart can lose an unsent request, and the user can request another after cooldown. A failed/ambiguous provider send may leave a valid expiring challenge. Do not retry a login message after its token expires. Record only redacted send metadata for quota accounting and operational status.
4. The link opens `/auth/magic#token=...`. Its frontend removes the fragment from the address bar and holds the token only in memory. GET performs no login or token consumption. Show an explicit confirmation button; POST `/auth/magic/consume` submits the token with the matching browser binding and CSRF/origin checks. This prevents ordinary link scanners from consuming it and binds login to the browser that requested it. A different browser shows instructions to request/open the link in the original browser; cross-device code entry is a later usability enhancement.
5. In one transaction, lock/consume the unexpired unused challenge, recheck current admission/login_enabled/auth_version, mark email verified, revoke sibling challenges, and create a fresh opaque session with fresh CSRF material. Concurrent redemption must yield exactly one session. Retain the current 24-hour session lifetime initially. Logout and revocation keep using server-side sessions.

Use fixed PUBLIC_URL-derived destinations; never build links from an untrusted Host header. Auth pages/responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; load no third-party assets. No tokens in query strings, analytics, browser storage, proxy logs, error messages, or provider tracking. Treat mail-provider message storage as containing a short-lived credential and minimize retention where supported. Keep generic request responses independent of account existence, including when provider delivery fails; report provider failures in aggregate health status.

OWASP's [token-handling guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) supports random, short-lived, single-use tokens, uniform request responses, and rate limits. Its password-reset example is guidance for these mechanics, not a complete magic-link login specification. Require an independent security review of the finished flow.

## Mock and production configuration

Use explicit startup selection:

```dotenv
# Real deployment
APP_ENV=production
AUTH_MODE=magic_link
MAIL_PROVIDER=brevo
BREVO_API_KEY=secret-from-runtime-configuration
MAIL_FROM=AbiZeitBetrug <login@notify.example.org>
MAIL_REPLY_TO=organisers@example.org
REMINDERS_ENABLED=false
MAIL_DAILY_LIMIT=300
REMINDER_DAILY_LIMIT=150

# Local development, separate database
APP_ENV=development
AUTH_MODE=mock
MAIL_PROVIDER=capture
```

Secrets never enter Git. `capture` delivers only to a local development mailbox; production rejects capture/off delivery for magic-link login, missing credentials, and every mock route. The mock is a small account-picker handler in the portal, enabled only by both development and mock mode. It reads current users from the local development database and creates mode-tagged sessions. It does not need YAML, provider signing keys, OIDC discovery, or a second account import. Never connect the picker to production student data.

The real login code runs in the existing portal container. Switching to real auth means changing configuration and restarting/recreating that service. Retain `AUTH_MODE=oidc` as an explicitly configured alternative, using only prebound, enabled/admitted local accounts rather than automatic pending enrollment. Preserve existing OIDC validation and external-provider bootstrap compatibility until explicit user provisioning is deployed; then disable/remove automatic bootstrap enrollment.

Do not select auth based on whether an auth-mock container happens to be alive. Availability is not proof of identity-provider trust. Never fall back to mock on provider failure. Remove the development Compose dependency on auth-mock and retire it from the default runtime. Keep its isolated protocol test fixture only while OIDC tests need it, with test-owned synthetic identities; it is not a second operational user directory. All development launch scripts and fixtures must use the same mode contract.

## Authorization stays in the Go application

Sessions establish only a user ID, authentication origin, expiry, and revocation state. The backend reloads current admission, role, cohort membership, category grants, and ownership on every request. React may hide controls but cannot grant access. An external identity provider's roles/email claims never grant portal privileges.

Preserve all current rules: students read their own contributions; managers read categories and manage assigned categories; authors own original edits; only admins inspect named ballot history. Demotion and revoked grants affect existing sessions immediately. Login disablement prevents both session use and future authentication. Keep named participation checks for reminders entirely server-side; do not expose a manager-facing list of nonvoters.

## Deadline reminders

The portal decides recipients because only it knows eligibility and completion. Brevo only delivers the messages. Start with a small `portal reminders run` command and persisted reminder jobs; run it hourly in a Compose service using the same portal image, with graceful termination and no OIDC startup dependency. No queue broker is needed. Provide `--dry-run` with counts/opaque IDs and no delivery before enabling the scheduled service.

Default policy is opt-in per collection, at 72 and 24 hours before a deadline. Initial implementation can manage this through CLI/SQL; collection controls in the GUI are optional. A late scan picks the most urgent unsent milestone, not both at once. The worker may queue reminders only for currently open, bounded collections and currently admitted, enabled cohort members with an owner-confirmed roster email and reminders enabled. It can reach a preprovisioned student who has never signed in; import is still not a claim that mailbox ownership was verified.

Define completion explicitly:

- Ballot collections: a current ballot exists, independent of choices or number of entries. Do not read/export named historical choices to make this decision.
- One-off text/photo collections: any non-withdrawn contribution exists, including pending or rejected; editorial rejection alone must not trigger automatic nagging. A withdrawn-only contribution counts as missing. Photo contents remain private and are not inspected for reminder content.
- Repeatable contribution collections have no natural finished state; reminders are off by default. An explicit future policy may require at least one non-withdrawn contribution.
- Hidden, closed, expired, ongoing, or deleted collections do not generate reminders. June 2027 has no special behavior.

Use a unique job key `(user_id, category_id, closes_at, milestone)` and a persisted per-user/category cooldown (initially 24 hours), including across deadline changes. Acquire jobs atomically with leases to handle crashes and concurrent workers. Budget/rate-limit email centrally across immediate login sends and reminders; pause reminder sends before consuming reserved login capacity. Retry temporary provider failures with backoff, respect Retry-After, stop at the deadline, and suppress permanent bounces/complaints. Verify webhook authentication using the provider's supported mechanism; if there is no trustworthy webhook authentication, reconcile suppression through authenticated provider APIs instead.

Immediately before dispatch, recheck current completion, eligibility, preference, status, and the exact deadline. Cancel stale jobs after submissions, disabling, hiding, or deadline edits; do not retain a recipient email snapshot across account changes. This suppresses already-completed work at the last check; a submission can still race a provider request already in flight. Deadline extensions create a new schedule but obey the cooldown. Expired unsent jobs are discarded rather than delivered late.

Messages contain a generic missing-work notice, optional collection title/deadline, and an ordinary portal link; no magic-link credential, contribution text, photos, choices, or missing-peer list. Prefer a daily per-student digest when several jobs coincide, marking the included jobs together. Offer authenticated reminder opt-out, separate from essential login delivery. Provider acceptance is not inbox delivery: expose aggregate pending/failed counts and last successful worker run without email addresses or contribution details.

Retries are at-least-once. Reuse provider idempotency support within its documented window, but do not claim exactly-once delivery after an ambiguous network timeout. Persist attempts and lease recovery so ordinary restarts and duplicate scans do not intentionally resend accepted jobs. Keep login sends out of this delayed reminder queue.

## Google and WebAuthn

Both are optional later additions to the same user IDs; neither requires a new user directory.

- Google: reuse the OIDC client libraries with `openid email profile`, PKCE, nonce/state, and issuer/audience/signature/expiry validation. Require magic-link authentication and recent reauthentication to explicitly link a Google identity to the current account. Do not automatically attach an existing account just because Google returns a matching email. Then resolve future logins by verified `(issuer, subject)` and current local eligibility. Unlinked Google accounts cannot register themselves. See [Google's OIDC documentation](https://developers.google.com/identity/openid-connect/openid-connect).
- Passkeys: use a maintained verifier such as [go-webauthn](https://github.com/go-webauthn/webauthn), never a custom WebAuthn parser. Enroll only after recent authentication; store credential public keys against users.id, validate RP ID/origin and one-use expiring challenges, require user verification, support multiple credentials and authenticated removal. Fix the production domain/RP ID before enrollment. Magic links remain recovery unless a stricter admin policy is separately chosen. Passkeys reduce email dependence; a passkey plus an unrestricted email fallback does not make the whole account phishing-resistant.

No Google credentials or passkey tables are required for the first magic-link release.

## Delivery sequence and acceptance

The lead owns docs, API contracts, and integration. Assign one backend implementation worker at a time to Go/auth/mock/migrations/CLI; a UI worker owns only web files after the endpoint contract is fixed; an ops worker owns Compose/Docker/scripts and deployment examples. Keep at most three workers plus the lead, avoid overlapping file ownership, and have an independent architecture-tier reviewer assess auth, migration, and permission changes. Reviews follow implementation workers rather than exceeding that concurrency limit.

| Phase | Scope / contract | Required acceptance |
| --- | --- | --- |
| 1. Identity and provisioning | Add fields/bindings, provisioning SQL + CLI, migrate existing subjects, separate command/server config loading | Reimport is idempotent; collisions and implicit privilege escalation fail atomically; disabling/unlinking/demoting the last usable admitted admin fails, including concurrent attempts; explicit UUID mapping preserves submissions, ballots, history and grants; maintenance commands run with auth/mail unavailable. |
| 2. Email delivery | Brevo sender, local capture, German templates, shared budget/send metadata and suppression | Synthetic mail reaches capture; external failures/timeouts are bounded and redacted; daily budgets survive restart and concurrent sends; missing configuration cannot silently activate a mock. Use one controlled real mailbox for delivery validation. |
| 3. Magic links and dev picker | Request/consume flow, shared session creation, login UI, mode validation, replace runtime mock YAML | Unknown/unadmitted/disabled accounts never authenticate; response/cookie/header behavior is identical and request timing does not wait on provider or allowlist lookup; A then B requests leave A usable; expiry/replay/concurrent redemption and email changes are enforced; scanner GET does not consume; cross-browser binding fails safely; logout/revocation and permissions affect existing sessions; production exposes no picker or capture. |
| 4. Reminders | Explicit collection policy, CLI preview, persistent jobs, hourly worker, opt-out | Only eligible incomplete users selected; pending work suppresses reminders; ballots use current existence only; duplicates/restarts/concurrency are bounded; completion/deadline/preference changes cancel stale jobs; reserves protect login; expired work is not sent. |
| 5. Cutover and independent review | Runtime scripts/config, docs, restore exercise, production smoke test | Existing OIDC path remains trusted and allowlisted; auth outages fail closed; switching modes away and back cannot revive prior sessions; restored data preserves all person IDs/content/history and does not replay live challenges or stale reminder sends. |

Update `docs/implementation-contract.md`, `docs/openapi.json`, and generated TypeScript when implementation changes API contracts. Include the public auth request/consume schemas, CSRF exemptions and compensating controls explicitly; they are outside the protected `/api/v1` router. Do not expose login emails through the roster or ordinary student/editor APIs. Regenerate with `node scripts/check-contract.mjs --write`; update the repo map and operations/school-login docs in the relevant commits.

Run invariant tests against only a disposable TEST_DATABASE_URL, then `make check`. Add real-browser tests for request, local mailbox link confirmation, reload, logout, expired link, blocked account and mock/real separation. Test migrations and backup/restore as a recovery set with synthetic identities and content. The restore procedure must revoke sessions/challenges and cancel or re-evaluate queued mail before serving or sending, so restoring a backup cannot resurrect a consumed credential or resend an old reminder.

Roll out in stages: migrate/backfill reviewed user mappings; configure and verify sender/DNS; import the roster in dry-run then apply; smoke-test magic links with a small pilot; switch auth explicitly; preview reminder counts; finally enable the worker. Keep reminder delivery disabled during deployment and rollback. Take and test a pre-cutover recovery set; retain schema compatibility for the previous OIDC binary through the pilot. Rollback selects a working real auth mode and disables sending, never production mock. Commit logical phases, merge completed work into main, push main, and remove the completed worktree according to repository policy.
