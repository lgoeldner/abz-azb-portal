# AbiZeitBetrug

**Unsere Königsdisziplin · LMGU Jahrgang 2027**

A private, German-language collection and editorial portal for the Abizeitung. June 2027 is project context, not an automatic closing date.

## Run locally

Install and start OrbStack, then run:

```sh
make doctor
make dev
```

Open [localhost:5173](http://localhost:5173). The Go API runs at `localhost:8080`; Vite proxies API, authentication, and mock OIDC routes to it. The development login provides seeded student, manager, admin, and pending accounts. These are fake identities; development must never hold real school data on a publicly accessible host.

The workflow starts PostgreSQL through OrbStack's `orbstack` Docker context, then runs the Go API and Vite on the host. It migrates and seeds the development database. `make down` stops the PostgreSQL container without deleting collected data. Docker volumes are persistent; never use `down -v` on a database you need. The current Docker context is left unchanged, so Docker Desktop is never selected implicitly.

You can also start either host service separately. `make 'dev:backend'` starts OrbStack PostgreSQL, migrates and seeds the development database, then starts Go. `make 'dev:frontend'` installs web dependencies with `npm ci` when needed and starts Vite. The frontend target expects the API to be running in another terminal.

`make doctor` checks OrbStack, Docker Compose through the explicit `orbstack` context, Go, Node/npm, and `.env.dev`, and gives setup guidance for missing prerequisites. Local development uses `PUBLIC_URL=http://localhost:5173`. Production builds and deployment continue to use Docker Compose on Linux; OrbStack is not a production dependency.

## Workflows

- **Students:** submit categorized text and photos; see their own contributions; edit or withdraw pending material; request corrections after editorial acceptance; cast or change votes while polls are open.
- **Managers / writers:** read material across categories; edit, review, and manage polls in assigned categories; view aggregate results and export editorial material.
- **Admins:** manage admission, names, roles, category grants and categories; inspect named ballot history and administrative events; check backup freshness.
- **Polls:** single-choice people or proposal polls. Individual votes are named for admin auditing. Editors see aggregates, students see their own vote. The portal does not publish results to students.
- **Exports:** category ZIPs with CSV, original photos, and a linking manifest; accepted material by default. Print layout remains outside the portal.

Original submissions and revisions are retained. Uploaded originals are private and immutable; previews are generated separately. Ordinary removal is soft deletion. There is no automatic physical cleanup in this first release.

## Architecture

React + TypeScript + Vite, React Router, and TanStack Query in `web/`; Go `net/http` and PostgreSQL in `server/`; Caddy and Docker Compose for deployment. Go serves the production frontend and owns authentication and application rules. Photos live on a private persistent volume. No Node server is needed at runtime.

The [OpenAPI contract](docs/openapi.json) generates the frontend DTOs. [Implementation contracts](docs/implementation-contract.md) describe permissions, endpoints, and invariants. [Agent workflow](AGENTS.md) describes model tiers and ownership.

```sh
node scripts/check-contract.mjs --write  # after editing the API contract
node scripts/check-contract.mjs          # reject route/type drift
```

## Verification

```sh
make check
```

Database integration tests require `TEST_DATABASE_URL` pointing to a disposable PostgreSQL database. Without it, those tests explicitly skip; unit tests alone do not verify database concurrency or persistence. Never use a production URL.

```sh
TEST_DATABASE_URL='postgres://portal:portal-dev@localhost:5432/portal_test?sslmode=disable' make check
cd web
npm run test:e2e
```

To exercise backup and restore end to end against disposable containers, run `DOCKER_CONTEXT=orbstack bash scripts/test-recovery.sh`. The script builds the portal and backup images, creates temporary database, upload, and repository volumes, verifies restored contents, then removes the resources it created.

Tests focus on ownership, category permissions, accepted-content immutability, idempotent retries, concurrent voting, private files, real OIDC mock flow, and backup/restore safety. CI also builds the production artifacts and runs browser journeys.

## Production and recovery

See [operations and restore instructions](ops/README.md) and [school login integration](docs/school-login.md).

Production uses configurable OIDC and refuses mock login. School login availability and student-name claims still need confirmation with school IT. New accounts remain pending unless explicitly bootstrapped as the first administrator; school roles never grant portal administration.

Nightly encrypted Restic backups combine a consistent PostgreSQL dump with the immutable upload tree. Retention is 14 daily, eight weekly, and twelve monthly snapshots. Target data loss is approximately 24 hours under healthy backup operation; the intended recovery-time target is four hours and must be measured for the actual hosting/storage configuration. Independent storage, an external missed-backup alert, and a successful restore drill are required before collecting real material.

AI classification/summarization, additional voting formats, and print-document generation are deliberately deferred. No submitted content is sent to an AI service.
