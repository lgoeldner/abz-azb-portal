# Incremental development builds

`make dev` runs `docker compose up -d --build --wait`, then starts a host Go
API on port 8080 and Vite starting at port 5173 (automatically using the next
free port if it is occupied). Compose checks every selected image,
reuses cached build steps, and keeps containers whose image and configuration
are unchanged. There is no need to run `make down` between rebuilds.

The portal image contains both the Go API and the production frontend:

| Change | Build work |
| --- | --- |
| Portal Go source or embedded migrations | Compile affected Go packages and relink; reuse frontend output |
| Frontend source | Rebuild frontend; reuse the compiled Go binary |
| Auth mock Go source | Compile affected auth mock packages and relink; reuse portal image |
| No source/configuration change | Reuse all build steps and running containers |

Both Go Docker builds keep module downloads and compiled packages in BuildKit
cache mounts. The first build warms these caches; later edits compile only
affected packages. Clearing the builder cache makes the next build cold again.
Use Docker Compose with BuildKit enabled (the default on current Docker engines).

A changed portal image replaces the portal container, including when only its
frontend changes. Database, authentication and proxy services have their own
images and lifecycle. Configuration changes can also cause container recreation.

Vite updates the host frontend while `make dev` is running. The host Go API does
not watch source files; stop and rerun `make dev` after Go edits. Its native Go
cache is separate from the Linux container build cache. Migration and seed
commands still run at startup.

## Starting and restarting in OrbStack

The development containers use `restart: unless-stopped`, including the mock
identity provider. The portal commands (`migrate`, `seed`, `serve`) wait up to
60 seconds for PostgreSQL, with a two-second timeout per attempt. This covers
starting existing containers from OrbStack, where Compose dependency health
gates are not applied. The portal healthcheck probes `/readyz`, so `make dev`
waits for the API to be ready. Stopping the project explicitly keeps it stopped
until you start it again.

After changing startup code or Compose settings, run `make dev` once to rebuild
and recreate affected containers. Restarting an existing container alone does
not apply new code or settings. Subsequent starts and restarts can use OrbStack.
The host Go API and Vite still require `make dev`.

Run `bash scripts/test-compose-startup.sh` for a disposable regression drill:
it starts the portal before PostgreSQL on both fresh and existing containers,
then restarts the whole stack through Compose and checks API readiness. It uses
separate images, networks and volumes, publishes no ports, and removes its
resources afterward.

## Verified behavior — 26 October 2026

An isolated OrbStack Compose stack used the normal development files with a
separate project, disposable volumes and no published ports. A Go-only source
edit took 4.15 seconds for build/startup (0.9 seconds in `go build`); frontend
steps stayed cached. A frontend-only edit took 8.07 seconds and kept `go build`
cached. Both replaced only the portal container: database, auth mock and Caddy
kept their container IDs and start times. A final unchanged rebuild took 2.29
seconds and preserved every container. An HTTP request verified the changed
frontend reached the runtime image. These timings describe the container phase,
not host API/Vite startup or a cold build.

`make check` also passed with `TEST_DATABASE_URL` targeting a separate disposable
PostgreSQL container. Independent Dockerfile review found no remaining defects.

The startup regression drill also passed on OrbStack: fresh-container and
existing-container starts kept the portal running while PostgreSQL was stopped,
then reached readiness after PostgreSQL started. A full Compose restart reached
readiness too. `make check` passed again against a separate disposable test DB.
