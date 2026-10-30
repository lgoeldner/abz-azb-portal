# Repo map

One line per fact, built for `rg`. Search it before exploring the tree:

    rg -i 'ballot|vote' docs/repo-map.md
    rg '^route' docs/repo-map.md

Line format: `<kind> <path or name> :: <what it is> [keywords]`. Kinds: `dir`, `file`, `route` (HTTP API), `page` (frontend route), `test`, `cmd`, `rule`. Every backticked path must exist; `make check` enforces it via `scripts/check-repo-map.sh`. Update this file in the same commit as any change that adds, moves, renames or repurposes a file, route or page.

## Layout

dir `deployables/` :: one folder per Docker image, each folder is the complete build context [docker, compose, build]
dir `deployables/portal/` :: portal image: Go API + built frontend; web-dev image target for container hot reload [Dockerfile, .dockerignore]
dir `deployables/portal/server/` :: Go module abizeitbetrug/server [backend, api, go]
dir `deployables/portal/web/` :: React + TypeScript + Vite + Tailwind frontend [ui, frontend]
dir `deployables/auth-mock/` :: legacy OIDC test fixture, own Go module abizeitbetrug/auth-mock [login, mock, oidc, identities]
dir `deployables/backup/` :: restic backup image, backup.sh/restore.sh plus their shell tests [backup, restore, recovery]
dir `deployables/caddy/` :: Caddyfile, mounted into the stock caddy image [tls, https, proxy]
file `go.work` :: joins portal and auth-mock modules for dev/tests only; Docker builds use GOWORK=off [workspace]
file `compose.yaml` :: production stack: db, portal, Better Auth, caddy, backup and opt-in reminder worker [deploy, production]
file `deployables/caddy/Caddyfile.dev` :: development proxy: pages/HMR to Vite, API/auth/health to Go [dev, caddy, proxy, hot reload]
file `compose.dev.yaml` :: dev overrides: dependency-backed Node mock picker, detached Vite hot reload, local ports, dev bind mounts; runtime services recover with unless-stopped [dev, docker, restart]
file `Makefile` :: dev, check, lint, audit, backup, restore, migrate targets [make, ci]
file `.github/workflows/ci.yaml` :: CI: lint, audit, Go/web tests, e2e [ci, github]
file `.githooks/pre-commit` :: prettier/gofmt on staged files, tests for touched deployables [hook, format, test]
file `docs/implementation-contract.md` :: binding API/permission contract, lead-owned [contract, permissions, types]
file `docs/poll-implementation-plans.md` :: nine proposed poll formats and the implemented configurable word portrait with implementation steps and invariant tests [poll, plan, voting]
file `docs/openapi.json` :: OpenAPI spec; source of generated TS types [openapi, schema]
file `docs/verification.md` :: how the system was verified [verification]
file `docs/school-login.md` :: school OIDC integration notes [login, oidc, production]
file `docs/auth-email-implementation-plan.md` :: implemented first-release design: Better Auth/shared UUID users, CLI/SQL provisioning, Brevo quota/delivery audit, dev picker and reminders; optional Google/passkeys later [auth, email, notifications, plan]
file `docs/dev-debug.md` :: DevDebug overlay and its browser checks [debug]
file `docs/dev-build.md` :: detached make dev builds, Go caches, container reuse and optional host development [dev, docker, cache]
file `ops/README.md` :: operations, backup, restore, tidy caveat [ops, restore, production]

## Scripts

cmd `scripts/dev.sh` :: `make dev`: build/start containers, wait for readiness, print `PUBLIC_URL` and exit [dev, start]
cmd `scripts/dev-common.sh` :: dev env vars (DATABASE_URL, UPLOAD_DIR), start_dev_services (detached Vite, fresh dependency volumes), prepare_dev_database (migrate+seed) [env, dev]
cmd `scripts/dev-backend.sh` :: builds and runs the host Go API; SKIP_DEV_DB_SETUP=1 skips containers/migrate/seed [backend, dev]
cmd `scripts/dev-frontend.sh` :: Vite dev server starts at 5173 and uses the next free port if occupied [frontend, dev, port]
cmd `scripts/doctor.sh` :: checks local prerequisites [setup]
cmd `scripts/env.sh` :: creates .env.dev [env]
cmd `scripts/check-contract.mjs` :: routes in http.go vs openapi.json; `--write` regenerates `deployables/portal/web/src/generated/api.d.ts` [contract, codegen]
cmd `scripts/check-repo-map.sh` :: fails if a path in this map no longer exists [map, stale]
cmd `scripts/test-recovery.sh` :: backup/restore against throwaway containers, including word originals, moderation, ballots and history [recovery, backup, words]
cmd `scripts/test-compose-startup.sh` :: disposable cold/existing runtime starts before PostgreSQL, then Compose restart and API/Vite readiness checks [docker, startup, restart, regression]

## Backend (deployables/portal/server)

file `deployables/portal/server/cmd/portal/main.go` :: CLI: `portal migrate|seed|serve`, bounded cancellable database startup wait [entrypoint, startup, retry]
test `deployables/portal/server/cmd/portal/main_test.go` :: startup readiness recovery, timeout, cancellation and error privacy [startup, database, retry]
file `deployables/portal/server/migrations/migrations.go` :: embeds numbered SQL files [migration]
file `deployables/portal/server/migrations/001_initial.sql` :: base schema: users, categories, submissions, revisions, attachments, corrections, poll_options, ballots, ballot_audit, audit_events [schema, tables]
file `deployables/portal/server/migrations/004_polls_become_categories.sql` :: polls merged into categories (single-answer kinds), polls table dropped [sammlung, poll, migration]
file `deployables/portal/server/migrations/005_people_multiselect.sql` :: preserves existing votes and candidates; people mode, choice cap, unique multi-selection and grouped audit snapshots [migration, poll]
file `deployables/portal/server/migrations/007_word_polls.sql` :: word category kind and reversible option-label moderation without rewriting originals [migration, words, moderation]
file `deployables/portal/server/migrations/006_proposal_multiselect.sql` :: allows proposal selection caps while preserving existing poll definitions and ballots [migration, proposal, choices]
file `deployables/portal/server/internal/portal/http.go` :: App, router (all `bind(` routes), errors, canEdit/canRead/canMutate, CSRF/session middleware [routes, permissions, middleware]
file `deployables/portal/server/internal/portal/types.go` :: JSON types: User, Category, Submission, Revision, Correction, PollOption, PollResult, BallotAudit, AuditEvent [types, json]
file `deployables/portal/server/internal/portal/categories.go` :: Category = Sammlung: kinds, repeatable vs single-answer, list/create/patch/status, hide with preserved ballots, admin poll deletion and grant cleanup, ballot fill and editor-only eligible voting participation [sammlung, category, poll, lifecycle, draft, participation]
file `deployables/portal/server/internal/portal/words.go` :: normalized word ballots helpers, editorial anonymous moderation, distinct merged counts and formula-safe CSV export [words, moderation, cloud, export]
file `deployables/portal/server/internal/portal/my_ballots.go` :: private own poll-entry summaries grouped by ballot key across option/word choices, including hidden and closed collections [ballot, submissions, privacy]
test `deployables/portal/server/internal/portal/my_ballots_test.go` :: own-entry isolation across roles, grouping, repeatable entries/retries, replacements and lifecycle states [ballot, invariant, privacy]
file `deployables/portal/server/internal/portal/polls.go` :: vote (row lock, atomic bounded multi-selection), results, grouped ballot audit, roster [ballot, vote, results, roster]
file `deployables/portal/server/internal/portal/submissions.go` :: author-owned submission CRUD, author search, status transitions, revisions, editorial annotations/correction requests [beitrag, submission, revision, correction]
file `deployables/portal/server/internal/portal/files.go` :: photo-collection-only uploads, previews, downloads, ZIP export, disk usage [attachment, upload, export, zip]
file `deployables/portal/server/internal/portal/admin.go` :: user list/edit/delete, audit log, system status; database triggers enforce identity revocation/last usable admin [admin, users, audit, backup status]
file `deployables/portal/server/internal/portal/auth.go` :: legacy OIDC login/callback/sessions plus dependency login/logout forwarding and cutover mode checks [auth, oidc, session, cookie]
file `deployables/portal/server/internal/portal/config.go` :: env config and production validation [config, env]
file `deployables/portal/server/internal/portal/db.go` :: DB interface, Migrate, IDs, audit and revision helpers [db, pgx]
file `deployables/portal/server/internal/portal/seed.go` :: dev fixtures: users (fixtureSlugs), categories, single-answer Sammlungen [seed, fixtures]

## Backend tests (need TEST_DATABASE_URL to a disposable DB)

test `deployables/portal/server/internal/portal/access_matrix_test.go` :: every contract route enforces session, admission, CSRF, roles [permissions, matrix]
test `deployables/portal/server/internal/portal/categories_test.go` :: Sammlung invariants, all-status default exports and migration 004 [sammlung, migration]
test `deployables/portal/server/internal/portal/poll_lifecycle_test.go` :: granted-editor hide/reopen, locked definitions, vote/history preservation, admin-only deletion and grant cleanup [poll, hidden, lifecycle, delete, permissions]
test `deployables/portal/server/internal/portal/poll_timeline_test.go` :: opened_at, ballot_count and eligible participation rules, including preserved votes after eligibility changes [poll, timeline, participation]
test `deployables/portal/server/internal/portal/people_polls_test.go` :: roster snapshots, explicit candidates, bounded atomic selections, distinct participation, audit and migration preservation [poll, invariants, participation]
test `deployables/portal/server/internal/portal/word_polls_test.go` :: lowercase Unicode word replacement, privacy, grant-controlled versioned moderation, merged counts, lifecycle and CSV [words, invariants, permissions]
test `deployables/portal/server/internal/portal/proposal_polls_test.go` :: choice-poll caps, atomic votes, results, audit privacy and exact migration preservation [proposal, invariant]
test `deployables/portal/server/internal/portal/portal_test.go` :: pure invariants, integrationPool/emptySchemaPool helpers, author-only original mutations, annotation grants, lifecycle + ballots [helpers, lifecycle]
test `deployables/portal/server/internal/portal/auth_test.go` :: OIDC trust/enrollment via authmock [auth]
test `deployables/portal/server/internal/portal/user_delete_test.go` :: user delete guards [admin, delete]
test `deployables/portal/server/internal/portal/user_created_at_test.go` :: users.created_at backfill [migration]
test `deployables/portal/server/internal/portal/seed_subject_test.go` :: seeded accounts match `deployables/auth-mock/users.yaml` [seed, identities]

## Legacy OIDC test fixture

file `deployables/auth-mock/main.go` :: env -> handler, refuses non-development [entrypoint]
file `deployables/auth-mock/authmock/provider.go` :: discovery, keys, authorize picker, token (PKCE, RS256) [oidc, pkce, jwt]
file `deployables/auth-mock/authmock/users.go` :: LoadUsers, SubjectForSlug (UUIDv5 of display_slug) [subject, slug]
file `deployables/auth-mock/users.yaml` :: dev identities; fixture slugs alex_admin, sam_redaktion, mia_weber, leon_fischer, kim_gast, pat_ausstehend [identities, login, fixtures]

## API routes (prefix /api/v1, handlers in internal/portal)

route GET /me :: session user + csrf_token (http.go)
route GET /me/ballots :: current viewer’s own current poll entries only; repeatable entries separate, selections grouped, no named history (my_ballots.go) [ballot, submissions, privacy]
route GET|POST /categories, PATCH /categories/{id} :: list/create/edit Sammlungen (categories.go) [sammlung]
route POST /categories/{id}/status :: granted-editor open/close/hide, draft->open->closed and open/closed->draft with votes preserved (categories.go) [lifecycle, hidden]
route DELETE /categories/{id} :: admin-only versioned poll deletion, including ballots/history/options and manager grants (categories.go) [poll, delete, admin]
route PUT /categories/{id}/ballot :: cast/change vote (polls.go) [vote]
route GET /categories/{id}/results :: editors only (polls.go) [results]
route GET /categories/{id}/words :: editorial anonymous original-word counts and moderation state (words.go) [words, moderation, permissions]
route PATCH /categories/{id}/words/{optionID} :: assigned-editor/admin versioned exclude/restore/correct/merge preserving originals (words.go) [words, moderation, grants]
route GET /categories/{id}/words/export :: editorial-only moderated distinct-voter word CSV (words.go) [words, csv, export]
route GET /categories/{id}/audit :: named ballots, admins only (polls.go) [ballot audit]
route GET /categories/{id}/export :: ZIP of a repeatable Sammlung (files.go) [export]
route GET|POST /submissions, GET|PATCH /submissions/{id}, POST /submissions/{id}/status :: Beiträge; atomic multipart creation requires the first photo in photo collections (submissions.go) [beitrag]
route GET /submissions/{id}/revisions, GET|POST /submissions/{id}/corrections, POST .../corrections/{correctionID}/resolve (submissions.go) [revision, correction]
route POST /submissions/{id}/attachments, PATCH|DELETE .../attachments/{attachmentID}, GET /attachments/{id}[/preview] (files.go) [upload]
route GET /roster :: admitted cohort names (polls.go) [roster, candidates]
route GET /admin/users, PATCH|DELETE /admin/users/{id}, GET /admin/audit, GET /admin/status (admin.go) [admin]
route GET /auth/login, GET /auth/callback, POST /auth/logout :: outside /api/v1 (auth.go) [auth]

## Frontend (deployables/portal/web)
file `deployables/portal/web/vite.config.ts` :: Vite dev server allows `PUBLIC_HOST` proxy host; localhost at 5173 with free-port fallback [frontend, dev, port]

file `deployables/portal/web/src/App.tsx` :: router, Layout, nav (StudentNav retains open contribution links after own submissions, EditorNav, AdminNav), StudentHome unanswered voting/one-off contribution stack and always-visible open repeatable contribution cards, unified own contribution/poll list capped at ten rows with full-list link, shared EditorialHome dashboard with class widgets, admin admissions, manager writable polls and recent assigned contributions, voting participation bars [routes, nav, dashboard, home, participation, grants]
file `deployables/portal/web/src/sammlungen.tsx` :: Shared Sammlungen workspace (one-off collections by deadline, repeatable collections, collapsible ended polls, deadline chips, own-submissions footer link, ?klasse filter), editor creation with independent Wiederholbar/Fortlaufend switches and required bounded end date with German calendar/time picker and 1d/1w/4w shortcuts, editable published ballot deadlines, proposal option chips and person-only self-vote switch, grant-controlled definition edits and poll hiding, admin-confirmed poll deletion, admin manager assignments in SammlungForm, SammlungDetail, all-submission editorial collection reader, unified private photo gallery with in-place captions and detail/history links, read-only ballot options/results with word cloud/CSV and anonymous word moderation with chip context menus, and an inline student voting stack [sammlung, poll, vote, form]
file `deployables/portal/web/src/PeoplePicker.tsx` :: shared candidate/choice voting with removable chips, selection limits, and search only for 10+ options [person, picker, chips]
file `deployables/portal/web/src/pages.tsx` :: Contributions unified own text/photo/poll list with search and status filters, NewContribution locked to the linked collection without a picker, with paper-style quote composer, inline attribution and optional context, photo-first multi-image creation and one-time collection appends with per-image captions and collection return, author detail photo album and caption editing, read-only editorial reader with annotations, all-submissions list, NotFound [beitrag, redaktion, export]
file `deployables/portal/web/src/admin.tsx` :: Verwaltung: People, ActivityLog, audit action labels [verwaltung, admin, personen, protokoll]
file `deployables/portal/web/src/ui.tsx` :: shared workspace view context, editorial/author submission links, author photo grouping with counts before row limits, own poll-entry rows merged by date before row limits, and UI: kindIcon/kindLabel (seven classes), Badge, PageHead, Failure, Loading, Empty, SubmissionList, plural, newestOpened [components, icons]
file `deployables/portal/web/src/styles.css` :: student brand tokens, responsive quote paper and attribution field states, and cobalt-accented Redaktion reading-desk theme including Verwaltung, rounded list hover surfaces and distinct chip hover states [styles, theme, redaktion]
file `deployables/portal/web/public/favicon.svg` :: tab icon, the sidebar Mark with fixed colors; fonts are self-hosted via @fontsource-variable (imported in main.tsx), never Google Fonts [favicon, fonts, gdpr]
file `deployables/portal/web/src/api.ts` :: fetch wrapper, CSRF header, shared user PATCH payload [api, fetch, grants]
file `deployables/portal/web/src/api-types.ts` :: aliases over generated types [types]
file `deployables/portal/web/src/generated/api.d.ts` :: generated from openapi.json, never edit by hand [codegen]
file `deployables/portal/web/src/BallotForm.tsx` :: shared voting form with wrapping proposal choice chips and named-vote notice; repeatable ballot keys survive failed-save card navigation; bounded valid choices, eligibility/self-vote guards, save errors and cache refresh [poll, vote, privacy]
test `deployables/portal/web/src/BallotForm.test.tsx` :: successful PUT/refresh, repeatable ballot idempotency, failed-save choices and submit-time eligibility/selection/pending guards [poll, vote, invariants]
file `deployables/portal/web/src/PollStack.tsx` :: inline student voting queue: top arrow controls, choices and submit on each card, drafts retained across arrows, save-then-advance, guarded navigation while saving and live position [poll, stack, navigation, accessibility]
file `deployables/portal/web/src/PollStack.css` :: responsive layered cards, directional animations and reduced-motion fallback [poll, stack, animation]
test `deployables/portal/web/src/PollStack.test.tsx` :: inline save/advance, failed-save preservation, draft retention, bounded navigation and active-card removal/reorder [poll, stack, ui]
file `deployables/portal/web/src/DevDebug.tsx` :: dev-only debug overlay [debug]
test `deployables/portal/web/src/editorial.test.tsx` :: editorial readers, annotation grants, mode changes and collection-locked submission creation [test, redaktion, permissions]
test `deployables/portal/web/src/own-contributions.test.tsx` :: unified student text/photo/poll lists, newest-ten dashboard limit, unlimited full list, own-entry filtering, search/status and ballot load failures [test, ui, ballot, contributions]
test `deployables/portal/web/src/App.test.tsx` :: component tests (vitest), unanswered polls, one-off contribution queues, persistent repeatable homepage cards and sidebar links after own submissions, dashboard voting participation against admitted cohort members, manager assignment scoping and loading/error states [test, ui, dashboard, participation, grants]
test `deployables/portal/web/src/PeoplePicker.test.tsx` :: search, chip placement/removal, limits and disabled candidates [person, picker]
test `deployables/portal/web/src/sammlungen.test.tsx` :: overview repeatability groups, deadline order/chips, ended-poll collapse and class filtering; poll defaults, independent repeatability switches, proposal option authoring chips, candidate mode, count stepper, person/proposal multi-vote behavior, hide/delete permissions, saved-choice revisits, word-chip context menus and editorial isolation from the student stack [poll, ui]
test `deployables/portal/web/e2e/portal.spec.ts` :: Playwright journeys against a running seeded app [e2e]
test `deployables/portal/web/e2e/verwaltung.spec.ts` :: Verwaltung e2e [e2e, admin]
test `deployables/portal/web/e2e/responsive.spec.ts` :: phone-width layout checks [e2e, responsive]

## Frontend routes

page / :: Overview (StudentHome/EditorHome/AdminHome by role and view) [home]
page /sammlungen, /sammlungen/:id :: Sammlungen list and detail; ?klasse=<kind>, ?neu [sammlung]
page /beitraege, /beitraege/neu, /beitraege/:id :: own submissions; /beitraege combines all own text/photo/poll entries [beitrag, ballot]
page /redaktion, /redaktion/beitraege/:id :: all collected submissions, ?sammlung= filter [redaktion]
page /verwaltung/personen, /verwaltung/protokoll, /verwaltung/email :: admin-only within Redaktion; direct bookmarks activate editorial mode and theme [verwaltung]
page /abstimmungen[/:id], /verwaltung/sammlungen, /verwaltung/rubriken, /admin :: redirects to the new routes [redirect, legacy]

## Domain rules

test `deployables/portal/web/e2e/words.spec.ts` :: live word creation/cap, lowercase chips, student privacy, distinct merged counts, chip context menus for rename/exclude/restore, read-only manager CSV and responsive cloud [words, e2e, permissions]
rule Sammlung = categories row; kind selects contribution or ballot content; independent repeatable permits one or many contributions/ballot entries per person; ongoing means manual close, otherwise required closes_at automatically closes; all kinds support draft/open/closed and hiding preserves data [sammlung, kind, repeatable, ongoing, deadline, lifecycle]
rule Managers create all seven kinds with atomic creator grants, read all submissions and manage/annotate assigned categories; admins manage all categories and assign grants; only authors mutate pending originals and only admins see named ballots [permissions]
rule Default dev login uses existing users.id UUIDs; legacy OIDC protocol fixtures derive subject=UUIDv5(display_slug) [login, fixtures]
rule Integration tests: TEST_DATABASE_URL to a disposable DB only; never the dev `portal` DB [test, database]

rule Redaktion is a read-only collection desk: originals and photos are author-owned, annotations require category grants, all statuses listed/exported by default, moderation after collection [redaktion, permissions, workflow]

rule People polls: new definitions default all_people; roster refreshed on first opening then fixed, including hiding/reopening. max_choices 1–500; nonrepeatable votes atomically replace full selection; repeatable casts append idempotent entries. Existing polls retain explicit candidate sets [poll, candidates, invariant]

file `deployables/portal/server/migrations/008_collection_repeatability.sql` :: independent repeatability/scheduling and ballot entry keys, legacy data preserved [migration, one-off, photo]
test `deployables/portal/server/internal/portal/collection_repeatability_test.go` :: one-off cardinality, repeated ballots, bounded lifecycle, concurrency, idempotency and migration preservation [invariant, photo, repeatable]
rule Word portraits: configurable max_choices default 3 (1–500); original NFC lowercase words remain private to their voter, anonymous moderation and word cloud/CSV editorial-only, changes grant-controlled, merged labels count each ballot entry once, named history admin-only [words, permissions, moderation, cloud, csv]

file `deployables/portal/web/src/PeoplePicker.tsx` :: shared searchable person list and wrapping proposal toggle chips, cap enforcement and accessible pressed states [choice, chips, vote]
file `deployables/portal/web/src/PhotoGallery.tsx` :: flattened private photo album, captions and author-only caption/remove controls [photo, gallery, caption]
file `deployables/portal/web/src/PhotoGallery.css` :: wide three-column photo grid (two columns on phones), consistent thumbnails and accessible caption controls [photo, gallery, style]
test `deployables/portal/web/src/PeoplePicker.test.tsx` :: search, chip toggles, selection limits and self-vote guards [choice, chips, invariant]
file `deployables/portal/server/migrations/009_photo_captions.sql` :: additive per-image captions and attachment metadata in revision snapshots, old records preserved with empty defaults [migration, photo, caption, history]
test `deployables/portal/server/internal/portal/photo_submissions_test.go` :: atomic photo create/retry/rollback, photo-only upload and category-move/type invariants, caption ownership/version/history/export, last-photo retention and legacy migration preservation [photo, caption, invariant]
rule Only photo collections accept new images; image-bearing contributions cannot move into non-photo collections or change collection type away from photo; legacy non-photo images remain accessible. Photo collections require a validated image on creation and retain their last image; optional per-photo captions stay author-owned and versioned; legacy image-less originals remain accessible [photo, persistence, permissions]
test `deployables/portal/web/src/quote.test.tsx` :: quote attribution/body/context payload, failed-save retry preservation and linked non-quote collection forms [quote, form, retry]
test `deployables/portal/web/src/photo.test.tsx` :: photo-only creation/upload controls, multipart batch creation, retry safety, captions/history, per-photo version routing, one-time collection appends, grouped counts, own-photo privacy and read-only editorial gallery [photo, gallery, invariant]
test `deployables/portal/web/e2e/photos.spec.ts` :: synthetic multi-batch collection gallery, responsive columns/no overflow, batch upload return and single collection list entry [photo, gallery, e2e]
rule Photo collection navigation unifies upload batches: author lists link once per collection, uploads return to the collection gallery, photos open full size and pending captions remain editable in place [photo, collection, batch]

file `deployables/portal/web/src/EndDatePicker.tsx` :: accessible German DayPicker calendar, local time and today-relative 1d/1w/4w shortcuts, touch controls [date, calendar, poll, form]
file `deployables/portal/web/src/EndDatePicker.css` :: responsive calendar grid and date/time controls using workspace tokens [date, mobile, ui]
test `deployables/portal/web/src/EndDatePicker.test.tsx` :: calendar keyboard navigation, leap day, shortcuts across DST/year boundaries, local time and disabled controls [date, invariant, accessibility]
test `deployables/portal/server/internal/portal/poll_deadline_test.go` :: grant/version/future-date checks, draft/open/expired/closed/hidden deadline edits with definition, candidates, votes and history preserved [poll, deadline, lifecycle, invariant]

## Better Auth, provisioning and email delivery

dir `deployables/auth/` :: maintained Better Auth 1.7.14 service and dependency-backed synthetic development picker, complete image context [auth, node, mock]
file `deployables/auth/auth-config.mjs` :: dependency user/credential mappings, closed signup, eligibility hooks, hashed magic links, fixed sessions [auth, schema, permissions]
file `deployables/auth/server-core.mjs` :: same-origin endpoint allowlist, scanner-safe confirmation and private minimal session lookup, identity lock, persistent request limits [auth, routes, csrf, proxy]
file `deployables/auth/server.mjs` :: production entrypoint with lazy schema initialization and dedicated identity-lock pool [auth, runtime]
file `deployables/auth/mock-server.mjs` :: development-only UUID picker using dependency test helpers; excluded from production image [auth, mock]
file `deployables/auth/policy.mjs` :: runtime mode, secrets, canonical origin and service bearer validation [auth, config]
file `deployables/auth/email-handoff.mjs` :: bounded in-memory credential delivery handoff with current-identity recheck and no raw URL persistence [auth, email]
test `deployables/auth/tests/auth.integration.test.mjs` :: disposable PostgreSQL real dependency session/verification, concurrent redemption, identity-change serialization, A/B reassignment and public/private boundary invariants [auth, security, migration]
test `deployables/auth/tests/policy.test.mjs` :: production mock refusal, strict URLs, token-free handoff error handling [auth, config]
file `deployables/portal/server/internal/portal/better_auth.go` :: private dependency session verification, maintained CSRF integration, trusted proxy normalization and persisted mode cutovers [auth, session, csrf, proxy]
test `deployables/portal/server/internal/portal/better_auth_test.go` :: real Go boundary against fake identity service, eligibility, CSRF, forged headers, mode revocation and proxy trust [auth, invariant]
file `deployables/portal/server/internal/portal/provisioning.go` :: transactional CSV dry-run/apply and SQL-backed user management, explicit elevated roles and generic errors [users, cli]
test `deployables/portal/server/internal/portal/provisioning_test.go` :: stable UUIDs/content, rollback, idempotence, safe address reuse and last-admin guards [users, migration, invariant]
file `deployables/portal/server/internal/portal/email.go` :: Brevo/capture sender, atomic shared budgets, masked audit/status/settings, paginated provider reconciliation and permanent suppression [email, quota, admin]
file `deployables/portal/server/internal/portal/reminders.go` :: collection opt-in CLI, current-work selection, preference, leased jobs, deadline/cooldown rechecks and address-wide suppression [email, deadline, notifications]
test `deployables/portal/server/internal/portal/email_test.go` :: quota concurrency, contract/version/access, provider limits/events/suppression, reminder completion/dedup and CLI dry-run invariants [email, security, invariant]
file `deployables/portal/server/migrations/010_better_auth.sql` :: preserve UUID users; dependency session/account/verification/rate-limit tables [schema, auth]
file `deployables/portal/server/migrations/011_email.sql` :: mail policy, isolated destination snapshots, attempts/events/reservations and reminder jobs [schema, email, quota]
file `deployables/portal/server/migrations/012_user_provisioning.sql` :: supported operator functions, mode record, guarded identity changes/credential revocation and retired-email quarantine [schema, users, permissions]
file `deployables/portal/web/src/EmailAdmin.tsx` :: admitted-admin quota/settings/health and paginated masked delivery audit [admin, email, quota]
test `deployables/portal/web/src/EmailAdmin.test.tsx` :: denied-role no fetch, unknown provider quota, versioned settings/pause warning and request retry [admin, email]
file `deployables/portal/web/src/ReminderSettings.tsx` :: lazy account reminder opt-out, preserving essential login mail [email, account]
test `deployables/portal/web/src/ReminderSettings.test.tsx` :: authenticated preference update contract [email, account]
file `docs/auth-email-operations.md` :: sender/tracking setup, CLI/SQL roster management, quota controls, reminders and safe restore [auth, email, ops]
route GET|PATCH /me/email-reminders :: own reminder preference, independent of login delivery (reminders.go) [email, account]
route GET /admin/email/status, PATCH /admin/email/settings :: admin-only observed quota and versioned sending policy (email.go) [email, admin, quota]
route GET /admin/email/messages, GET /admin/email/messages/{id} :: masked send audit and sanitized delivery/attempt history (email.go) [email, admin, audit]
route POST /admin/email/reconcile, POST /admin/email/reminders/preview :: bounded provider refresh and aggregate non-sending preview (email.go) [email, admin]
rule One UUID user directory; authentication dependency owns real/dev sessions; Go enforces current local admission/grants/ownership; production rejects mock and capture [auth, permissions]
rule Mail uses one persisted shared budget; callbacks never log/store login links in audits; reminder suppression follows recipient address across collections [email, privacy, quota]

test `deployables/portal/web/e2e/email.spec.ts` :: real development dependency login/logout, admin quota versioned settings and student reminder opt-out with denied admin API [email, auth, e2e]
