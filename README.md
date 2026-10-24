# AbiZeitBetrug

**Unsere Königsdisziplin · LMGU Jahrgang 2027**

A private, German-language collection and editorial portal for the Abizeitung. June 2027 is project context, not an automatic closing date.

## Run locally

Install and start a Docker engine (OrbStack, Docker Desktop, Colima, ...), then run:

```sh
make doctor
make dev
```

The tracked `.env.dev.dist` is a template; local `.env.dev` is ignored by Git. `make env` creates any missing `.env*` files from matching `.dist` templates, warns when it creates files, and never overwrites existing files. `make doctor`, `make dev`, `make dev:backend`, `make dev:frontend`, and `make down` run this setup automatically; you can also run `make env` explicitly. Review the generated defaults before using them.

Open [localhost:5173](http://localhost:5173). The Go API runs at `localhost:8080`; Vite proxies API and authentication routes to it. The login button redirects to the separate mock provider at [localhost:9090](http://localhost:9090), which lists all identities from `deployables/auth-mock/users.yaml` and returns signed JWTs through the OIDC authorization-code flow. These are fake identities; development must never hold real school data on a publicly accessible host.

The workflow starts PostgreSQL, the `auth-mock` container, the `portal` container and Caddy with `docker compose` on the current Docker context, then runs the Go API (port 8080) and Vite (5173) natively on the host for hot reload. It migrates and seeds the development database. The `portal` container has no host port; reach it through Caddy at `https://localhost`, which uses Caddy's internal CA (the browser warns unless you trust it). Its `PUBLIC_URL` is `https://localhost`, and that callback is allowed by `auth-mock`. Caddy binds `127.0.0.1:80` and `:443` only, so those ports must be free. The host Go API and the container share the development database (migrate and seed use advisory locks), the upload directory `server/data/uploads` (bind mount; on native Linux engines the container's uid 10001 needs write access to it) and, on `localhost`, browser cookies, so log in to only one of the two at a time. Portal, Caddy and backup do not restart on their own in development. The backup service runs only with `BACKUP_DEV=true make dev`; a run without the flag removes its container; it keeps its restic repository in the `restic_dev` volume (initialised automatically) and sends its heartbeat to `http://portal:8080/healthz`. `make down` stops all development containers, including Caddy and backup (it passes `--profile production`), without deleting collected data. Docker volumes are persistent; never use `down -v` on a database you need. Set `DOCKER_CONTEXT` to target a different engine.

You can also start either host service separately. `make 'dev:backend'` starts the same containers, migrates and seeds the development database, then starts Go. `make 'dev:frontend'` installs web dependencies with `npm ci` when needed and starts Vite. The frontend target expects the API to be running in another terminal.

`make doctor` checks the Docker engine, Docker Compose, Go, Node/npm, and `.env.dev`, and gives setup guidance for missing prerequisites. Local development uses `PUBLIC_URL=http://localhost:5173`. Production builds and deployment continue to use Docker Compose on Linux.

Edit `deployables/auth-mock/users.yaml` to add or rename fake identities, then restart the provider:

```sh
docker compose --env-file .env.dev -f compose.yaml -f compose.dev.yaml restart auth-mock
```

Each entry has a `name` and a unique `display_slug` (`[a-z0-9_]`, max 64). The OIDC subject is generated from the slug (UUIDv5, fixed namespace), so it stays stable across restarts and renames; typing a `subject:` key is rejected. The supplied slugs match the seeded portal accounts (including student, editor, administrator, guest and pending accounts). New slugs create pending student accounts; roles and admission remain under portal administration. JWTs are exchanged by the Go backend and never stored in browser storage. The provider starts only with `APP_ENV=development` and publishes its port on loopback.

The `portal` container at [https://localhost](https://localhost) is the full container stack. Its development-only `OIDC_BACKCHANNEL_URL` routes server requests to the container while retaining `http://localhost:9090` as the verified issuer and browser-facing provider URL.

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
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e   # installed Google Chrome; omit to use Playwright's bundled browser
```

`make lint` runs golangci-lint, ESLint and shellcheck; `make audit` runs govulncheck and `npm audit`. CI runs lint, audit, tests and browser checks on every branch, and the audit weekly.

To exercise backup and restore end to end against disposable containers, run `bash scripts/test-recovery.sh`. The script builds the portal and backup images, creates temporary database, upload, and repository volumes, verifies restored contents, then removes the resources it created.

Tests focus on ownership, category permissions, a route-by-route session/admission/CSRF matrix derived from `docs/openapi.json`, accepted-content immutability, idempotent retries, concurrent voting, private files, real OIDC mock flow, and backup/restore safety. CI also builds the production artifacts and runs browser journeys plus layout checks (no horizontal overflow, no uncaught page errors) against them. There is deliberately no pixel-snapshot testing.

## Production and recovery

See [operations and restore instructions](ops/README.md) and [school login integration](docs/school-login.md).

Production uses configurable OIDC and refuses mock login. School login availability and student-name claims still need confirmation with school IT. New accounts remain pending unless explicitly bootstrapped as the first administrator; school roles never grant portal administration.

Nightly encrypted Restic backups combine a consistent PostgreSQL dump with the immutable upload tree. Retention is 14 daily, eight weekly, and twelve monthly snapshots. Target data loss is approximately 24 hours under healthy backup operation; the intended recovery-time target is four hours and must be measured for the actual hosting/storage configuration. Independent storage, an external missed-backup alert, and a successful restore drill are required before collecting real material.

AI classification/summarization, additional voting formats, and print-document generation are deliberately deferred. No submitted content is sent to an AI service.
