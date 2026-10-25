# Repo map

One line per fact, built for `rg`. Search it before exploring the tree:

    rg -i 'ballot|vote' docs/repo-map.md
    rg '^route' docs/repo-map.md

Line format: `<kind> <path or name> :: <what it is> [keywords]`. Kinds: `dir`, `file`, `route` (HTTP API), `page` (frontend route), `test`, `cmd`, `rule`. Every backticked path must exist; `make check` enforces it via `scripts/check-repo-map.sh`. Update this file in the same commit as any change that adds, moves, renames or repurposes a file, route or page.

## Layout

dir `deployables/` :: one folder per Docker image, each folder is the complete build context [docker, compose, build]
dir `deployables/portal/` :: portal image: Go API + built frontend [Dockerfile, .dockerignore]
dir `deployables/portal/server/` :: Go module abizeitbetrug/server [backend, api, go]
dir `deployables/portal/web/` :: React + TypeScript + Vite + Tailwind frontend [ui, frontend]
dir `deployables/auth-mock/` :: dev-only OIDC provider, own Go module abizeitbetrug/auth-mock [login, mock, oidc, identities]
dir `deployables/backup/` :: restic backup image, backup.sh/restore.sh plus their shell tests [backup, restore, recovery]
dir `deployables/caddy/` :: Caddyfile, mounted into the stock caddy image [tls, https, proxy]
file `go.work` :: joins portal and auth-mock modules for dev/tests only; Docker builds use GOWORK=off [workspace]
file `compose.yaml` :: production stack: db, portal, caddy, backup [deploy, production]
file `compose.dev.yaml` :: dev overrides: auth-mock, local ports, dev bind mounts [dev, docker]
file `Makefile` :: dev, check, lint, audit, backup, restore, migrate targets [make, ci]
file `.github/workflows/ci.yaml` :: CI: lint, audit, Go/web tests, e2e [ci, github]
file `.githooks/pre-commit` :: prettier and gofmt on staged files [hook, format]
file `docs/implementation-contract.md` :: binding API/permission contract, lead-owned [contract, permissions, types]
file `docs/openapi.json` :: OpenAPI spec; source of generated TS types [openapi, schema]
file `docs/verification.md` :: how the system was verified [verification]
file `docs/school-login.md` :: school OIDC integration notes [login, oidc, production]
file `docs/dev-debug.md` :: DevDebug overlay and its browser checks [debug]
file `ops/README.md` :: operations, backup, restore, tidy caveat [ops, restore, production]

## Scripts

cmd `scripts/dev.sh` :: `make dev`: containers + host Go API :8080 + Vite :5173 [dev, start]
cmd `scripts/dev-common.sh` :: dev env vars (DATABASE_URL, UPLOAD_DIR), start_dev_services, prepare_dev_database (migrate+seed) [env, dev]
cmd `scripts/dev-backend.sh` :: builds and runs the host Go API; SKIP_DEV_DB_SETUP=1 skips containers/migrate/seed [backend, dev]
cmd `scripts/dev-frontend.sh` :: Vite dev server [frontend, dev]
cmd `scripts/doctor.sh` :: checks local prerequisites [setup]
cmd `scripts/env.sh` :: creates .env.dev [env]
cmd `scripts/check-contract.mjs` :: routes in http.go vs openapi.json; `--write` regenerates `deployables/portal/web/src/generated/api.d.ts` [contract, codegen]
cmd `scripts/check-repo-map.sh` :: fails if a path in this map no longer exists [map, stale]
cmd `scripts/test-recovery.sh` :: backup/restore against throwaway containers [recovery, backup]

## Backend (deployables/portal/server)

file `deployables/portal/server/cmd/portal/main.go` :: CLI: `portal migrate|seed|serve` [entrypoint]
file `deployables/portal/server/migrations/migrations.go` :: embeds numbered SQL files [migration]
file `deployables/portal/server/migrations/001_initial.sql` :: base schema: users, categories, submissions, revisions, attachments, corrections, poll_options, ballots, ballot_audit, audit_events [schema, tables]
file `deployables/portal/server/migrations/004_polls_become_categories.sql` :: polls merged into categories (single-answer kinds), polls table dropped [sammlung, poll, migration]
file `deployables/portal/server/migrations/005_people_multiselect.sql` :: preserves existing votes and candidates; people mode, choice cap, unique multi-selection and grouped audit snapshots [migration, poll]
file `deployables/portal/server/internal/portal/http.go` :: App, router (all `bind(` routes), errors, canEdit/canRead/canMutate, CSRF/session middleware [routes, permissions, middleware]
file `deployables/portal/server/internal/portal/types.go` :: JSON types: User, Category, Submission, Revision, Correction, PollOption, PollResult, BallotAudit, AuditEvent [types, json]
file `deployables/portal/server/internal/portal/categories.go` :: Category = Sammlung: kinds, repeatable vs single-answer, list/create/patch/status, ballot fill [sammlung, category, poll, lifecycle, draft]
file `deployables/portal/server/internal/portal/polls.go` :: vote (row lock, atomic bounded multi-selection), results, grouped ballot audit, roster [ballot, vote, results, roster]
file `deployables/portal/server/internal/portal/submissions.go` :: author-owned submission CRUD, author search, status transitions, revisions, editorial annotations/correction requests [beitrag, submission, revision, correction]
file `deployables/portal/server/internal/portal/files.go` :: uploads, previews, downloads, ZIP export, disk usage [attachment, upload, export, zip]
file `deployables/portal/server/internal/portal/admin.go` :: user list/edit/delete, audit log, system status [admin, users, audit, backup status]
file `deployables/portal/server/internal/portal/auth.go` :: OIDC login/callback/logout, sessions [auth, oidc, session, cookie]
file `deployables/portal/server/internal/portal/config.go` :: env config and production validation [config, env]
file `deployables/portal/server/internal/portal/db.go` :: DB interface, Migrate, IDs, audit and revision helpers [db, pgx]
file `deployables/portal/server/internal/portal/seed.go` :: dev fixtures: users (fixtureSlugs), categories, single-answer Sammlungen [seed, fixtures]

## Backend tests (need TEST_DATABASE_URL to a disposable DB)

test `deployables/portal/server/internal/portal/access_matrix_test.go` :: every contract route enforces session, admission, CSRF, roles [permissions, matrix]
test `deployables/portal/server/internal/portal/categories_test.go` :: Sammlung invariants, all-status default exports and migration 004 [sammlung, migration]
test `deployables/portal/server/internal/portal/poll_timeline_test.go` :: opened_at and ballot_count rules [poll, timeline]
test `deployables/portal/server/internal/portal/people_polls_test.go` :: roster snapshots, explicit candidates, bounded atomic selections, audit and migration preservation [poll, invariants]
test `deployables/portal/server/internal/portal/portal_test.go` :: pure invariants, integrationPool/emptySchemaPool helpers, author-only original mutations, annotation grants, lifecycle + ballots [helpers, lifecycle]
test `deployables/portal/server/internal/portal/auth_test.go` :: OIDC trust/enrollment via authmock [auth]
test `deployables/portal/server/internal/portal/user_delete_test.go` :: user delete guards [admin, delete]
test `deployables/portal/server/internal/portal/user_created_at_test.go` :: users.created_at backfill [migration]
test `deployables/portal/server/internal/portal/seed_subject_test.go` :: seeded accounts match `deployables/auth-mock/users.yaml` [seed, identities]

## Auth mock (dev only)

file `deployables/auth-mock/main.go` :: env -> handler, refuses non-development [entrypoint]
file `deployables/auth-mock/authmock/provider.go` :: discovery, keys, authorize picker, token (PKCE, RS256) [oidc, pkce, jwt]
file `deployables/auth-mock/authmock/users.go` :: LoadUsers, SubjectForSlug (UUIDv5 of display_slug) [subject, slug]
file `deployables/auth-mock/users.yaml` :: dev identities; fixture slugs alex_admin, sam_redaktion, mia_weber, leon_fischer, kim_gast, pat_ausstehend [identities, login, fixtures]

## API routes (prefix /api/v1, handlers in internal/portal)

route GET /me :: session user + csrf_token (http.go)
route GET|POST /categories, PATCH /categories/{id} :: list/create/edit Sammlungen (categories.go) [sammlung]
route POST /categories/{id}/status :: single-answer draft->open->closed (categories.go) [lifecycle]
route PUT /categories/{id}/ballot :: cast/change vote (polls.go) [vote]
route GET /categories/{id}/results :: editors only (polls.go) [results]
route GET /categories/{id}/audit :: named ballots, admins only (polls.go) [ballot audit]
route GET /categories/{id}/export :: ZIP of a repeatable Sammlung (files.go) [export]
route GET|POST /submissions, GET|PATCH /submissions/{id}, POST /submissions/{id}/status :: Beiträge (submissions.go) [beitrag]
route GET /submissions/{id}/revisions, GET|POST /submissions/{id}/corrections, POST .../corrections/{correctionID}/resolve (submissions.go) [revision, correction]
route POST /submissions/{id}/attachments, DELETE .../attachments/{attachmentID}, GET /attachments/{id}[/preview] (files.go) [upload]
route GET /roster :: admitted cohort names (polls.go) [roster, candidates]
route GET /admin/users, PATCH|DELETE /admin/users/{id}, GET /admin/audit, GET /admin/status (admin.go) [admin]
route GET /auth/login, GET /auth/callback, POST /auth/logout :: outside /api/v1 (auth.go) [auth]

## Frontend (deployables/portal/web)

file `deployables/portal/web/src/App.tsx` :: router, Layout, nav (StudentNav, EditorNav, AdminNav), StudentHome, EditorHome, AdminHome dashboard with one widget per class [routes, nav, dashboard, home]
file `deployables/portal/web/src/sammlungen.tsx` :: Shared Sammlungen workspace (Fortlaufend section, status groups, ?klasse filter), all-kind editor creation and grant-controlled definition edits, admin manager assignments in SammlungForm, SammlungDetail, all-submission editorial collection reader, read-only ballot options/results and student voting [sammlung, poll, vote, form]
file `deployables/portal/web/src/PeoplePicker.tsx` :: shared candidate/vote search with removable chips above search and selection limits [person, picker, chips]
file `deployables/portal/web/src/pages.tsx` :: Contributions, NewContribution, author detail and read-only editorial reader with annotations, all-submissions list, NotFound [beitrag, redaktion, export]
file `deployables/portal/web/src/admin.tsx` :: Verwaltung: People, ActivityLog, audit action labels [verwaltung, admin, personen, protokoll]
file `deployables/portal/web/src/ui.tsx` :: shared workspace view context, editorial/author submission links and UI: kindIcon/kindLabel (six classes), Badge, PageHead, Failure, Loading, Empty, SubmissionList, plural, newestOpened [components, icons]
file `deployables/portal/web/src/styles.css` :: student brand tokens and cobalt-accented Redaktion reading-desk theme including Verwaltung, rounded list hover surfaces and distinct chip hover states [styles, theme, redaktion]
file `deployables/portal/web/public/favicon.svg` :: tab icon, the sidebar Mark with fixed colors; fonts are self-hosted via @fontsource-variable (imported in main.tsx), never Google Fonts [favicon, fonts, gdpr]
file `deployables/portal/web/src/api.ts` :: fetch wrapper, CSRF header, shared user PATCH payload [api, fetch, grants]
file `deployables/portal/web/src/api-types.ts` :: aliases over generated types [types]
file `deployables/portal/web/src/generated/api.d.ts` :: generated from openapi.json, never edit by hand [codegen]
file `deployables/portal/web/src/DevDebug.tsx` :: dev-only debug overlay [debug]
test `deployables/portal/web/src/editorial.test.tsx` :: editorial readers, annotation grants, mode changes and collection defaults [test, redaktion, permissions]
test `deployables/portal/web/src/App.test.tsx` :: component tests (vitest) [test, ui]
test `deployables/portal/web/src/PeoplePicker.test.tsx` :: search, chip placement/removal, limits and disabled candidates [person, picker]
test `deployables/portal/web/src/sammlungen.test.tsx` :: people-poll defaults, candidate mode and multi-vote behavior [poll, ui]
test `deployables/portal/web/e2e/portal.spec.ts` :: Playwright journeys against a running seeded app [e2e]
test `deployables/portal/web/e2e/verwaltung.spec.ts` :: Verwaltung e2e [e2e, admin]
test `deployables/portal/web/e2e/responsive.spec.ts` :: phone-width layout checks [e2e, responsive]

## Frontend routes

page / :: Overview (StudentHome/EditorHome/AdminHome by role and view) [home]
page /sammlungen, /sammlungen/:id :: Sammlungen list and detail; ?klasse=<kind>, ?neu [sammlung]
page /beitraege, /beitraege/neu, /beitraege/:id :: own submissions [beitrag]
page /redaktion, /redaktion/beitraege/:id :: all collected submissions, ?sammlung= filter [redaktion]
page /verwaltung/personen, /verwaltung/protokoll :: admin-only within Redaktion; direct bookmarks activate editorial mode and theme [verwaltung]
page /abstimmungen[/:id], /verwaltung/sammlungen, /verwaltung/rubriken, /admin :: redirects to the new routes [redirect, legacy]

## Domain rules

rule Sammlung = categories row; kind is its class: repeatable idea/quote/memory/photo (submissions), person/proposal ballots (person: all or selected candidates, bounded multi-selection; proposal: one choice; draft->open->closed) [sammlung, class, kind, rubrik, poll]
rule Managers create all six kinds with atomic creator grants, read all submissions and manage/annotate assigned categories; admins manage all categories and assign grants; only authors mutate pending originals and only admins see named ballots [permissions]
rule Dev identities: subject = UUIDv5(display_slug); seeded fixtures map via fixtureSlugs in seed.go [login, fixtures]
rule Integration tests: TEST_DATABASE_URL to a disposable DB only; never the dev `portal` DB [test, database]

rule Redaktion is a read-only collection desk: originals and photos are author-owned, annotations require category grants, all statuses listed/exported by default, moderation after collection [redaktion, permissions, workflow]

rule People polls: new definitions default all_people; roster refreshed on opening then fixed. max_choices 1–500; votes atomically replace full selection. Existing polls retain explicit candidate sets [poll, candidates, invariant]
