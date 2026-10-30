# Email and authentication implementation plan

Status: first release implemented, 30 October 2026. Better Auth, provisioning, Brevo, admin quota/audit and opt-in reminders are available; Google and passkeys remain optional later additions. See [operating instructions](auth-email-operations.md) and implementation-contract.md for the runtime contract. Provider credentials/sender verification are required before real delivery.

## Decisions

- **Authentication:** use the maintained Better Auth dependency in a small Node.js/TypeScript `auth` container. The owner has approved a separate container. Better Auth owns magic-link tokens, verification, sessions, OAuth and future passkeys; do not implement an authentication protocol in Go.
- **Email:** use Brevo's transactional API for login messages and deadline reminders.
- **Users:** keep one PostgreSQL person record per student, using the existing `users.id` UUID. Map the dependency's user model to that table instead of creating another directory. Provision users through CLI or PostgreSQL, without a creation GUI.
- **Permissions:** the Go backend continues checking current admission, roles, category grants and ownership on every request.
- **Administration:** add **Verwaltung → E-Mail** for quota, sending controls and a restricted delivery audit log.
- **Development:** keep a lightweight dev-only account picker over the same development user table, with explicit mode selection and no automatic fallback.

[Better Auth is MIT licensed](https://github.com/better-auth/better-auth), supports [custom table/column mappings and UUIDs](https://better-auth.com/docs/concepts/database), and provides [magic links](https://better-auth.com/docs/plugins/magic-link), [Google](https://better-auth.com/docs/authentication/google) and [passkeys](https://better-auth.com/docs/plugins/passkey). No hosted auth subscription is required. Existing hosting/domain costs and the extra container's resource use remain.

## Current system and intended boundaries

Today Go consumes external OIDC, validates tokens and creates hashed server-side sessions. Its middleware reloads `users` on every request. Users have a required issuer/subject binding and no email field. Mock identities are duplicated between YAML and seed data. Categories already enforce deadlines without a scheduler; email delivery and reminder jobs do not exist.

The new production boundary is:

```text
Browser -- same-origin proxy --> Better Auth: login, logout, credentials
Browser -- same-origin proxy --> Go portal: application API and admin email page
Go portal -- private session lookup --> Better Auth server API
Better Auth -- private mail request --> Go Brevo sender
Go Brevo sender --------------------> Brevo transactional API
Both services ---------------------> PostgreSQL: one users table
```

Better Auth validates cookies using its supported server API; Go does not decode dependency cookies or mint a second production session. An internal session endpoint calls `auth.api.getSession` and returns only a validated user UUID, session ID and expiry to Go. Forward the original Cookie header only to this trusted internal endpoint. Never trust browser-supplied user/role headers. An unavailable auth service causes authentication to fail closed.

Use dependency-backed database sessions, disable cookie/session caching and stateless JWT authorization, and initially configure a 24-hour lifetime without sliding refresh. This avoids a second session system and lets each request observe revocation. Replace the old session-row CSRF coupling with maintained Go CSRF middleware such as [gorilla/csrf](https://github.com/gorilla/csrf), preserving the `/api/v1/me` csrf_token and X-CSRF-Token contract. Better Auth only protects its own endpoints; a validated auth session must not bypass CSRF checks on Go mutations. Test this integration explicitly without minting another login session. See [session management](https://better-auth.com/docs/concepts/session-management).

Only explicitly enabled auth endpoints are proxied publicly. Internal session/mail operations are service-authenticated, reachable only on the private network, and never routed from public URLs. Public auth responses must not disclose portal permission columns, stored session tokens, OAuth tokens or verification records. Do not enable Better Auth's admin plugin or a competing permission system. Keep the dependency's public profile mutation/deletion endpoints disabled or blocked; student names/emails and deletion retain the portal's roster/content safeguards.

## One PostgreSQL user directory

`users.id` is a PostgreSQL **UUID**, not a slug. Preserve every existing UUID and all contribution, vote, audit and grant references when authentication changes. Display names, email addresses and provider subjects may change without changing that ID.

Use Better Auth's supported `modelName`, field mappings and UUID ID generation. Map core user fields onto `users`: name, login email, email-verified boolean, created/updated timestamps and optional image. Existing role/admission/cohort/category fields remain application-owned. Do not add them to writable auth API fields or return them through public auth responses; if hooks require additional fields, set `input: false` and `returned: false`. Use database column privileges as a second boundary where practical. Better Auth must not change local roles or grants through profile mapping or social login.

Add the dependency-required session/account/verification tables using distinct names such as `auth_sessions`, `auth_accounts`, and `auth_verifications`; these are credential records referring to users.id, not another user directory. Add passkey tables only when that plugin is enabled. Generate the dependency schema for the pinned version, review it, and integrate it into the portal's versioned migrations. Never run unattended dependency schema migration in production startup. Do not repurpose the existing incompatible Go `sessions` schema or invent a custom token table.

Stage migration around existing rows without emails: allow backfill first, require reviewed addresses for enabled real-auth accounts, then tighten the mapped schema's constraints. Preserve old issuer/subject bindings during the pilot. Explicitly migrate trusted provider bindings into dependency account records only after verifying provider configuration and subject mapping; do not synthesize a Google account from an email or merge people by name. Existing production sessions are revoked at cutover.

Use a shared normalization policy: trim whitespace and compare the complete email case-insensitively; reject malformed addresses, controls and normalization collisions. Never strip plus suffixes or Gmail dots. An imported address is allowlisted but not mailbox-verified. The dependency owns its verification field; successful magic-link verification establishes mailbox ownership.

Provide these planned commands in the portal image:

```sh
portal users import --file /run/private/roster.csv --dry-run
portal users import --file /run/private/roster.csv --apply
portal users set-email --id USER_UUID --email student@example.org --apply
portal users disable --id USER_UUID --apply
portal users revoke-sessions --id USER_UUID --apply
```

CSV fields: `id,email,name,role,admitted,cohort_member,login_enabled`. New rows may omit id; existing-person migration rows must give the existing UUID. New accounts default to student, unadmitted and login disabled unless explicitly enabled. A student roster may explicitly enable all three eligibility flags. Reimports are idempotent, collisions abort the transaction, omitted people are not deleted, and existing permissions change only when explicitly requested. Elevated-role provisioning requires an explicit option. Imports do not implicitly send invitations.

The CLI and existing admin mutations share the same management rules. Offer a documented SQL function for provisioning, email changes and disabling, so an owner connected with psql can use the same supported operation. Database-owner raw writes can bypass application rules and are not the supported interface. Use local PostgreSQL access or an SSH tunnel. Keep real CSVs/addresses out of Git, command output and general logs.

Preserve at least one admitted, login-enabled admin with a usable configured sign-in method, including concurrent disable/demotion/unlink operations. Allow explicit first-admin provisioning. Operator changes use an operator audit identity rather than inventing a student actor.

Dependency-backed verification/session handling must survive direct supported SQL management: disabling access immediately affects the Go eligibility check and dependency session-creation hooks. Email changes reset dependency verification, revoke that user's sessions and invalidate outstanding login verifications for the old address through reviewed dependency-compatible operations. Check eligibility again before issuing any real session. Do not design a parallel auth_version/challenge protocol. Pin and test the exact dependency schema/adapter behavior needed for provisioning and invalidation. The magic-link plugin resolves an email to the current user at redemption, so never reassign a retired address to another UUID while an older link could still be valid. Enforce a retirement/quarantine interval covering the maximum token lifetime plus clock skew and any pending delivery handoff; safely invalidate pending old-address verifications and cancel unsent handoffs on address changes. Supported CLI/SQL operations enforce this together. Test user A receiving a link, address reassignment to B, and attempted redemption: the old link must never sign in as B.

## Authentication dependency configuration

Start with Better Auth's magic-link plugin, PostgreSQL adapter and a fixed canonical base URL. Disable password login, anonymous signup, unrequested plugins and self-service user deletion/email changes. Set `disableSignUp: true` for magic links. Deny unprovisioned user creation across every enabled login method, not only the email form. The send/session hooks check the shared user's current admission and login_enabled state.

Configure hashed magic-link storage (`storeToken: "hashed"`), a short expiration (initially 15 minutes), and dependency-owned atomic single-use redemption. Use the maintained token generator and verifier. Do not add custom signing keys, token formats or a second redemption database. The dependency's session storage format differs from the old Go token hashes; restrict credential-table access and encrypt backups rather than silently changing its adapter's token semantics.

The `sendMagicLink` hook sends through the portal's private Brevo sender, which owns the shared quota and audit records. The credential-bearing URL lives only in memory and the transactional email, never in the delayed reminder queue. Handle unknown/disabled accounts with identical status, headers, cookie behavior and provider-independent timing. Use a bounded background delivery handoff with a short lifetime; restarts may lose an unsent request, and the student can request a new link. Avoid account-existence timing differences before handoff as well as during delivery.

Use dependency-supported custom-link delivery/verification for an email-scanner-safe confirmation page: GET only displays confirmation; explicit user action calls the dependency verifier through a narrow protected adapter. Prefer a fragment to carry the emailed token into that page, clear it immediately, and do not expose the dependency's consuming GET as an alternate public URL. The adapter delegates verification/session creation to Better Auth; it does not verify tokens itself. Fix callback destinations, apply origin/CSRF checks, and preserve cookies/headers required by the library. Verify login-CSRF and account-confirmation behavior in the integration spike; do not assume the plugin defaults implement a custom browser-bound protocol.

Apply dependency request limits with supported persistent storage, trusted proxy IP handling and per-address resend protection. **Programmatic `auth.api` calls bypass Better Auth's HTTP rate limiter**: wrappers must enforce equivalent limits before forwarding. Unknown addresses need the same limit behavior. The same applies to an interstitial verification adapter. Sources: [rate limits](https://better-auth.com/docs/concepts/rate-limit), [magic-link plugin/API](https://better-auth.com/docs/plugins/magic-link), [verification implementation](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/magic-link/index.ts).

Auth pages use no-store/no-referrer and no third-party resources. Redact auth query strings, cookies, bodies, redirects and provider payloads in proxy/application logs. Never return a full dependency account/session object from the internal lookup. Keep dependency security updates and regression tests in routine maintenance; require independent security review before rollout.

## Configurable real auth and mock

Proposed real deployment:

```dotenv
APP_ENV=production
AUTH_MODE=better_auth
AUTH_INTERNAL_URL=http://auth:3000
BETTER_AUTH_URL=https://portal.example.org
BETTER_AUTH_SECRET=runtime-secret
MAIL_PROVIDER=brevo
BREVO_API_KEY=runtime-secret
MAIL_FROM=AbiZeitBetrug <login@notify.example.org>
MAIL_REPLY_TO=organisers@example.org
MAIL_DAILY_LIMIT=300
REMINDER_DAILY_LIMIT=150
REMINDERS_ENABLED=false
```

Development uses `APP_ENV=development`, `AUTH_MODE=mock`, and local capture delivery. A small dev-only Node account picker reads the same synthetic local users and uses dependency-owned [test login helpers](https://better-auth.com/docs/plugins/test-utils) to establish dependency sessions/cookies. No second Go session implementation, YAML directory, provider key management or account import is needed. Build the mock configuration separately, with privileged test helpers and picker routes excluded from the production entrypoint. Run this image as auth-mock in place of the real auth service; both use the same private session-lookup contract. Configure separate mock/real cookie names and secrets, validate the service mode internally, and never accept mock cookies in production. Tests must verify that no production auth request reaches mock handlers.

Select the mode explicitly and restart/recreate services. Stopping auth-mock does not automatically select a trusted replacement. Production refuses mock/capture and missing auth secrets. Use a persisted cutover operation that revokes all dependency sessions for the prior configuration and outstanding verifications before changing modes, so switching away and back cannot revive old sessions. Do not add a custom auth token epoch to replace the dependency's revocation mechanism. Handle mixed-mode rolling deployment by rejecting outdated service configurations.

Remove the old OIDC mock from the default development stack; retain only isolated synthetic protocol fixtures while legacy OIDC tests need them. Existing school OIDC may remain as a rollout fallback until Better Auth's supported provider integration is explicitly configured and tested. There is no permanent requirement to maintain two production auth systems or two user lists.

## Brevo delivery and quota

Brevo is the selected provider. Its [free plan includes 300 email sends per day](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), with free-tier branding. Login and reminders share the allowance. Start with a 300/day local safety ceiling and a 150/day reminder budget, leaving capacity for sign-in. This is a ceiling, not an inbox-delivery guarantee. The admin page changes local budgets; it cannot increase Brevo's actual allowance or buy a plan.

Verify a sending subdomain, DKIM/SPF/DMARC, reply address and sender approval before delivery. Use separate German text/HTML messages per recipient. Disable open/click tracking. Do not maintain a marketing contact directory or send contribution contents/photos/ballots to Brevo. Minimize provider retention where supported; magic-link messages temporarily contain a login credential.

One Go sender is used by auth hooks and reminder workers, with atomic PostgreSQL quota reservations. Record provider acceptance separately from delivery. Ambiguous network timeouts retain a conservative reservation until reconciled; failed deliveries do not automatically refund a send that Brevo already accepted. Classify attempts, accepted messages and delivery events separately to avoid double counting.

Reconcile provider account/credit information through authenticated [GET /v3/account](https://developers.brevo.com/reference/get-account), and delivery events through [GET /v3/smtp/statistics/events](https://developers.brevo.com/reference/get-email-event-report) or authenticated webhooks. Map only the applicable email credit type. Verify the account's exact credit/reset semantics; do not interpret every returned credits value as a daily remaining-email number. Unknown or unsupported values stay null and visibly unavailable. Never proxy the raw account response, which can include unrelated account data and keys.

Show provider-reported allowance/credits separately from the portal's local budget and usage. Other applications/manual Brevo sends can consume account quota; local counts are not an exact account balance. Prefer a dedicated Brevo account. Where provider remaining credits are verified, cap sends by the lower available budget. Persist rate limits and reservations across workers/restarts; stale provider data must be labeled and must not authorize raising the local safety cap. Confirm reset timezone before showing a countdown; do not assume browser midnight equals Brevo reset.

## Admin page: Verwaltung → E-Mail

Add an admin-only `/verwaltung/email` page and navigation item, with an email-status summary on the admin dashboard. Direct bookmarks activate the existing Redaktion/Verwaltung view. Managers and students cannot read its APIs, logs or settings.

The page contains:

- **Quota:** configured daily ceiling, used/remaining local budget, pending reservations, login/reminder usage, reminder cap and protected login capacity. Show Brevo plan/credit data when verified, its observation timestamp and stale/unavailable/error state. Do not display zero for missing data. Use clear labels for account-wide credits versus portal-only usage.
- **Health:** sender identity, API connection/relay state where available, quota/rate-limit warnings, worker heartbeat, next scan, pending/suppressed/failed counts and last successful reconciliation. Expose configured/not-configured status for credentials, never their values.
- **Controls:** pause/resume reminders; edit local daily/reminder budgets and protected login reserve within deployment safety ceilings; preview reminder counts without sending; refresh provider status with cooldown. Keep login available while reminders are paused. An emergency pause-all control must explicitly warn that magic-link delivery stops; it cannot disable quota accounting or auth checks. Raising Brevo quota requires changing the actual provider plan outside this page.
- **Delivery audit:** paginated messages filtered by time range, message type, status and opaque user ID. Show timestamp, recipient display name/ID with masked destination, purpose/template, related collection where authorized, provider message ID, attempt count, accepted/delivered/deferred/bounced/failed/suppressed/cancelled/unknown state and sanitized failure code. Distinguish not-attempted, provider-accepted and confirmed-delivered; retain an event history for state changes.

Persist one message record, attempt records and deduplicated delivery events; do not rely on Brevo log retention as the application's history. A destination snapshot may be stored in a separately protected delivery record, with masking in normal list responses, to avoid attributing an older delivery to a user's newer email address. Retain metadata for a configurable period (initially 90 days); purge destination snapshots/events according to that policy while keeping minimal non-identifying operational counters. General app logs/audit contain only message IDs and action metadata.

Never store/render message bodies, magic-link URLs/tokens, preview/mirror URLs, raw provider errors, cookies, choice lists or contribution contents. No generic 'resend magic link' or provider-preview action: authentication must initiate a fresh library flow. No direct retry of stale reminders; a deliberate reminder retry rechecks present eligibility, missing work, deadline, budget and deduplication policy. Do not create a bulk-mail composer or user-creation GUI.

Persist policy settings with version checks; validate daily budget, reminder cap and login reserve together. Policy changes cannot reset counters, erase history, exceed deployment ceilings or release uncertain reservations. Record actor ID, timestamp and before/after non-secret values in the general admin audit. All mutations require an admitted admin plus CSRF; APIs recheck current permission, including after demotion.

Planned Go contracts (not implemented routes):

- `GET /api/v1/admin/email/status`: local usage/reservations, provider observations with nullable credits/reset, health, effective policy and policy version.
- `PATCH /api/v1/admin/email/settings`: versioned pause/budget/reserve changes, returning validated effective policy.
- `GET /api/v1/admin/email/messages`: bounded filters and stable pagination; metadata only.
- `GET /api/v1/admin/email/messages/{id}`: sanitized attempt/delivery-event history, no email content or login token.
- `POST /api/v1/admin/email/reconcile`: rate-limited provider-status refresh.
- `POST /api/v1/admin/email/reminders/preview`: aggregate counts under current policy; no delivery or named nonvoter list.

Add schemas to OpenAPI only when implementing them. Provider webhook ingestion is outside these browser-admin contracts and requires separate authentication, payload limits, replay/deduplication controls and a strict metadata allowlist. If a trustworthy webhook mechanism is unavailable, use authenticated API reconciliation. Provider event payloads can contain links/addresses, so filter before persistence or logging.

## Deadline reminders

Go selects recipients because it knows completion and permissions; Brevo only delivers. Use a small `portal reminders run` command and persistent jobs, run hourly using the portal image. No queue broker is needed. Offer a dry-run with counts/opaque IDs, then enable scheduling explicitly. Deployment starts with reminders disabled.

Default policy is opt-in per collection, 72 and 24 hours before a deadline. A late scan picks the most urgent milestone rather than sending both together. Only currently open bounded collections and admitted, login-enabled cohort members with an owner-confirmed roster address and reminders enabled are eligible. This can reach someone who has never signed in; an imported email still is not mailbox-verified.

Completion rules:

- Ballots: a current ballot exists; do not inspect named choices/history or expose lists of nonvoters to managers.
- One-off text/photo: any non-withdrawn contribution exists, including pending/rejected. Editorial rejection alone does not trigger reminders. Withdrawn-only work counts as missing.
- Repeatable contributions: reminders off by default, because there is no inherent finished state. A future explicit policy can require one contribution.
- Hidden, closed, expired, ongoing or deleted collections never generate reminders. June 2027 has no special behavior.

Deduplicate by `(user_id, category_id, closes_at, milestone)` and enforce a per-user/category cooldown across deadline changes (initially 24 hours). Lease jobs atomically for crash/concurrency safety. Group simultaneous jobs into a daily student digest where appropriate. Before dispatch, recheck recipient, preference, completion, eligibility, exact deadline and current policy. A submission may still race an already in-flight provider request; do not promise otherwise. Cancel stale jobs and discard expired work.

Retry temporary failures with backoff/Retry-After, suppress permanent bounces/complaints, and respect protected login capacity. Keep current recipient lookup separate from immutable dispatch audit snapshots. Reminder retries are at-least-once; use supported provider idempotency within its documented window but do not claim exactly-once delivery after a network timeout. Ordinary restarts/duplicate scans must not intentionally resend accepted jobs.

Messages contain a generic notice, optional collection title/deadline and ordinary portal link. No pre-generated login credential, contribution text, photos, choices or peer lists. Offer authenticated reminder opt-out separate from essential sign-in messages.

## Google and passkeys

Enable these later through Better Auth, using the same UUID and session integration.

Google requires configured provider credentials and exact callback origins. Disable signup across explicit/implicit OAuth signup paths and enable `account.accountLinking.disableImplicitLinking`; a matching Google email must not silently attach to an existing person. Link a provider explicitly from an already authenticated account after recent reauthentication, then resolve future sign-in through the dependency's provider account binding. See [account linking](https://better-auth.com/docs/concepts/users-accounts) and [options](https://better-auth.com/docs/reference/options).

Use Better Auth's passkey plugin for registration, verification and credentials. Require authenticated enrollment and recent reauthentication; fix the production RP ID/origin first. Support multiple authenticators and protected removal. Magic links remain recovery unless a stricter admin policy is separately chosen. A passkey with unrestricted email recovery does not make the entire account phishing-resistant. Do not add an independent Go WebAuthn stack.

## Delivery sequence and acceptance

The lead owns docs/API contracts and integration. Assign separate ownership for the Node auth service, Go provisioning/email/admin APIs, and UI/ops as phases permit; do not let workers overlap files. Keep at most three workers plus the lead. Architecture and critical independent review use the architecture tier; implementation follows repository model tiers. Reviewers must not approve their own implementation.

| Phase | Contract / required result | Invariant acceptance |
| --- | --- | --- |
| 0. Dependency integration spike | Pin Better Auth; map a synthetic existing UUID; use server session lookup and magic-link adapter with local capture | No second person directory or bespoke session system; no signup/profile/role escalation route; dependency consumes links atomically; internal session/mail APIs inaccessible publicly; API wrappers cannot bypass rate limits; no secrets in public responses/logs. |
| 1. Schema/provisioning | Reviewed migrations, one users model, CLI/SQL functions, old-provider mapping | Reimport idempotent; collisions roll back; explicit mapping preserves all person IDs/content/votes/history/grants; last usable admin protected under concurrency; email changes/disablement invalidate sessions and old verifications; retired-address reassignment cannot redirect an old link to a different UUID. |
| 2. Brevo and admin page | Shared sender/reservations, settings, status, message audit and Verwaltung navigation | Students/managers denied; admitted-admin/CSRF/version checks; missing credits stay unknown; local/provider quantities distinguished; concurrent sends cannot overspend; pauses/budget edits cannot reset counters or bypass login reserve; duplicate/out-of-order events do not duplicate or regress delivery facts; no credential-bearing previews or raw payloads. |
| 3. Real auth and dev mode | Dependency-owned login/session/logout, Go authorization/maintained CSRF middleware, dependency-backed shared-user dev picker | Unknown/unadmitted/disabled accounts never authenticate; generic requests leak no eligibility; GET scanner does not consume; replay/expiry/parallel redemption safe; login CSRF checked; roles/grants/admission current per request; provider outage never activates mock; mode away-and-back cannot revive sessions. |
| 4. Reminders | Policy, hourly jobs, preview, opt-out and Brevo audit integration | Correct incomplete recipients only; no named choice processing; completion/deadline/preference changes cancel stale jobs; expiry/cooldown/deduplication/restart rules enforced; login budget protected; opt-out stops reminders without breaking sign-in. |
| 5. Independent review and cutover | Pilot, schema-compatible rollback, restore exercise and operational docs | Recovery preserves users/content/history, revokes dependency sessions and verifications for both runtime configurations before serving, and reconciles/cancels queued sends before worker restart; auth outages fail closed; no old credential/message revived by restore. |

Update `docs/implementation-contract.md`, `docs/openapi.json` and TypeScript contracts as implementation lands; regenerate with `node scripts/check-contract.mjs --write`. Keep auth-service endpoints, public proxy allowlists, private service contracts and CSRF boundaries explicit. Update the repo map, school-login/ops/dev docs and launch scripts in the same commits. Add a dedicated `deployables/auth/` complete build context; the development mock target uses the same dependency with a separate entrypoint and does not require the real auth service to be running.

Run focused dependency/browser/invariant tests and `make check`, using TEST_DATABASE_URL only for a disposable PostgreSQL database. Extend checks to the new auth module. Use captured synthetic mail for most tests; validate sender setup with one controlled mailbox. Exercise migrations, database/file backup and restore together, not just backup creation. Review dependency upgrades and the generated schema before applying them.

Rollout: integration spike; migrate/backfill reviewed UUID mappings; configure sender/DNS; dry-run/apply roster import; pilot dependency login; explicitly switch production mode; verify admin quota/audit page; preview reminder counts; finally enable the worker. Rollback disables sending and selects a tested real auth path, never production mock. Commit logical phases, merge completed work into main, push main and remove its worktree according to repository policy.
