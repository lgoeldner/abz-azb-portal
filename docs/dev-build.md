# Incremental development builds

`make dev` builds and starts the development containers in the background,
waits for readiness, and exits. Open `https://caddy.abizeitung-portal.orb.local`; the
containers keep running after the command exits. Use `make down` to stop them.
Compose checks every selected image and reuses cached build steps. Vite is
refreshed on each invocation to load dependencies from its image; other
containers are reused when their image and configuration are unchanged. There is no need to run `make down` between rebuilds.

The portal image contains both the Go API and the production frontend:

| Change | Build work |
| --- | --- |
| Portal Go source or embedded migrations | Compile affected Go packages and relink; reuse frontend output |
| Frontend source | Rebuild frontend; reuse the compiled Go binary |
| Auth mock Go source | Compile affected auth mock packages and relink; reuse portal image |
| No source/configuration change | Reuse build steps and other containers; refresh Vite |

Both Go Docker builds keep module downloads and compiled packages in BuildKit
cache mounts. The first build warms these caches; later edits compile only
affected packages. Clearing the builder cache makes the next build cold again.
Use Docker Compose with BuildKit enabled (the default on current Docker engines).

A changed portal image replaces the portal container, including when only its
frontend changes. Database, authentication and proxy services have their own
images and lifecycle. Configuration changes can also cause container recreation.

The development `frontend` container runs Vite with the web directory bind-mounted,
including atomic editor saves. Its Linux dependencies live in a separate anonymous
volume, refreshed from the image on each `make dev`; host
`node_modules` stays separate. Named data volumes are preserved.
Caddy forwards pages and hot-reload WebSockets to Vite, and API/authentication
requests to the Go portal. Hot reload keeps working on the OrbStack domain after
`make dev` exits. No host Vite process or published frontend port is needed.
Rerun `make dev` after dependency or Go changes. Migration and seed commands run
inside the development portal container at startup. Production still serves
built static frontend files from Go without a Vite runtime.

For host development, run `make dev:backend` and `make dev:frontend` in separate
terminals. They stay in the foreground. Vite updates the host frontend, starting
at port 5173 with automatic free-port fallback; the host Go API uses port 8080
and does not watch source files. Restart `make dev:backend` after Go edits.
Its native Go cache is separate from the Linux container build cache.

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
The optional host Go API and Vite use `make dev:backend` and `make dev:frontend`.

Run `bash scripts/test-compose-startup.sh` for a disposable regression drill:
it starts the portal before PostgreSQL on both fresh and existing containers,
then restarts the whole stack through Compose and checks API and Vite readiness. It uses
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
not host API/Vite startup or a cold build. These timings predate the detached
Vite container.

`make check` also passed with `TEST_DATABASE_URL` targeting a separate disposable
PostgreSQL container. Independent Dockerfile review found no remaining defects.

The startup regression drill also passed on OrbStack: fresh-container and
existing-container starts kept the portal running while PostgreSQL was stopped,
then reached readiness after PostgreSQL started. A full Compose restart reached
readiness too. `make check` passed again against a separate disposable test DB.

The detached Vite workflow was verified with an isolated stack: HTTPS HMR
updated CSS without navigation, atomic CSS and HTML saves reached the browser,
and the browser reconnected after a Vite restart. API/authentication routing
remained on Go. Refreshing only Vite's dependency volume preserved the database
and portal containers. The updated cold-start/restart drill checked both API
and Vite readiness. `make dev` orchestration checks verified prompt exit after
readiness and failure propagation without starting host Go or Vite processes.
