# AbiZeitBetrug

A private, German-language collection and editorial portal for a school yearbook (Abizeitung). Students submit text and photos, editors review them by category, and admins manage access and polls.

This repository contains the portal's source code only. It holds no real school data.

## Features

- **Students:** submit categorized text and photos, track and edit their own contributions, vote in polls.
- **Managers:** read all categories, edit and review the ones they are assigned, view aggregate poll results, export material.
- **Admins:** manage admission, roles, categories and category grants; audit named ballots and administrative events; check backup freshness; manage email quota and inspect delivery audits.
- **Exports:** per-category ZIP with CSV, original photos and a manifest.

Uploads are private and immutable, and removal is soft deletion. There are no public uploads, and no submitted content is sent to an AI service.

## Stack

React, TypeScript and Vite in `deployables/portal/web/`; Go (`net/http`) and PostgreSQL in `deployables/portal/server/`; Caddy and Docker Compose for deployment. Go serves the production frontend and enforces application rules. The maintained Better Auth dependency runs in `deployables/auth/`, sharing PostgreSQL UUID users and owning real/development sessions. Brevo delivers login links and opt-in reminders.

The API is described by [`docs/openapi.json`](docs/openapi.json), which generates the frontend types. See also [`docs/implementation-contract.md`](docs/implementation-contract.md).

```sh
node scripts/check-contract.mjs --write  # regenerate types after editing the API contract
node scripts/check-contract.mjs          # fail on route/type drift
```

## Run locally

Requires a Docker engine. Optional host development also requires Go and Node/npm.

```sh
make doctor   # optional: check Docker and host development tools
make dev      # build/start containers, wait until ready, then exit
make down     # stop all development containers (keeps data)
```

`make env` creates missing `.env*` files from their `.dist` templates and never overwrites existing ones. Review the generated defaults.

- Development login: `/auth/login` on the portal opens a lightweight UUID account picker backed by the same seeded PostgreSQL user records. The Node mock service is available locally on port 3000; no YAML roster maintenance is needed.
- Portal and API behind Caddy: `PUBLIC_URL` from `.env.dev`, by default [https://localhost](https://localhost) (internal CA, so the browser warns). OrbStack users may set `PUBLIC_URL`/`PUBLIC_HOST` to `caddy.abizeitung-portal.orb.local`.

For host development, run `make dev:backend` and `make dev:frontend` in separate terminals. These stay in the foreground: the API uses `localhost:8080`, and Vite starts at `localhost:5173` with automatic free-port fallback. The default container stack runs Vite with hot reload on that URL after `make dev` exits. Source edits update the page automatically; rerun `make dev` after dependency or Go changes. The production image serves built frontend files from Go.

Never keep real data on a publicly reachable development host, and never run `down -v` on a database you need.

## Tests

```sh
make check
```

Database integration tests need `TEST_DATABASE_URL` pointing to a **disposable** PostgreSQL database; without it they skip. Set `TEST_DATABASE_DISPOSABLE=YES` to include the Better Auth isolated-schema integration suite.

```sh
TEST_DATABASE_URL='postgres://portal:portal-dev@localhost:5432/portal_test?sslmode=disable' TEST_DATABASE_DISPOSABLE=YES make check
cd deployables/portal/web && npm run test:e2e
bash scripts/test-recovery.sh   # backup/restore against throwaway containers
```

## Production

Production uses allowlisted Better Auth magic links and refuses mock login. Provision the shared roster through CSV CLI or documented PostgreSQL functions; there is no second user directory. Configure a verified Brevo sender and disabled tracking before real delivery. Admins manage local budgets and inspect masked delivery history under **Verwaltung → E-Mail**. Reminders are opt-in and disabled initially. See [`docs/auth-email-operations.md`](docs/auth-email-operations.md) for setup/provisioning and [`ops/README.md`](ops/README.md) for encrypted database/files backup and safe restore. Explicit legacy OIDC remains available for a tested real-provider rollback.

## Design
use the taste skill direction in the repo to keep a consistent, user friendly UX
