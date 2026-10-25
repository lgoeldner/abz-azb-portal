# AbiZeitBetrug

A private, German-language collection and editorial portal for a school yearbook (Abizeitung). Students submit text and photos, editors review them by category, and admins manage access and polls.

This repository contains the portal's source code only. It holds no real school data.

## Features

- **Students:** submit categorized text and photos, track and edit their own contributions, vote in polls.
- **Managers:** read all categories, edit and review the ones they are assigned, view aggregate poll results, export material.
- **Admins:** manage admission, roles, categories and category grants; audit named ballots and administrative events; check backup freshness.
- **Exports:** per-category ZIP with CSV, original photos and a manifest.

Uploads are private and immutable, and removal is soft deletion. There are no public uploads, and no submitted content is sent to an AI service.

## Stack

React, TypeScript and Vite in `deployables/portal/web/`; Go (`net/http`) and PostgreSQL in `deployables/portal/server/`; Caddy and Docker Compose for deployment. Go serves the production frontend and owns authentication and application rules.

The API is described by [`docs/openapi.json`](docs/openapi.json), which generates the frontend types. See also [`docs/implementation-contract.md`](docs/implementation-contract.md).

```sh
node scripts/check-contract.mjs --write  # regenerate types after editing the API contract
node scripts/check-contract.mjs          # fail on route/type drift
```

## Run locally

Requires a Docker engine, Go and Node/npm.

```sh
make doctor   # check prerequisites
make dev      # start containers, migrate, seed, run API and Vite
make down     # stop all development containers (keeps data)
```

`make env` creates missing `.env*` files from their `.dist` templates and never overwrites existing ones. Review the generated defaults.

- Frontend: [localhost:5173](http://localhost:5173)
- API: `localhost:8080`
- Mock login provider: [localhost:9090](http://localhost:9090), development only. Its fake identities are listed in `deployables/auth-mock/users.yaml`.
- Full container stack behind Caddy: [https://caddy.abizeitung-portal.orb.local](https://caddy.abizeitung-portal.orb.local) (internal CA, so the browser warns).

Never keep real data on a publicly reachable development host, and never run `down -v` on a database you need.

## Tests

```sh
make check
```

Database integration tests need `TEST_DATABASE_URL` pointing to a **disposable** PostgreSQL database; without it they skip.

```sh
TEST_DATABASE_URL='postgres://portal:portal-dev@localhost:5432/portal_test?sslmode=disable' make check
cd deployables/portal/web && npm run test:e2e
bash scripts/test-recovery.sh   # backup/restore against throwaway containers
```

## Production

Production uses configurable OIDC and refuses mock login. New accounts stay pending until an admin admits them. Nightly encrypted Restic backups cover the database and uploads. See [`ops/README.md`](ops/README.md) for operations and restore, and [`docs/school-login.md`](docs/school-login.md) for login integration.

## Design
use the taste skill direction in the repo to keep a consistent, user friendly UX