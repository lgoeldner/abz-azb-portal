# Verification record — 23 October 2026

Local verification uses OrbStack's explicit `orbstack` context. Docker Desktop is not required by the development workflow.

## Application

- `make doctor` passed against OrbStack, Docker Compose, Go 1.27.1, Node 24 and the development configuration.
- Actual development startup served Go on port 8080 and Vite on port 5173. Termination stopped both application listeners; the development database persisted.
- PostgreSQL integration tests passed with the race detector in isolated schemas. They cover ownership, pending admission, category grants and revocation, immutable accepted submissions, revision history, idempotent retries, private image access and checksums, concurrent votes and poll closure, ballot auditing, and the mock OIDC flow.
- Frontend type checking, component tests, production build and API contract validation passed. Generated frontend types match all 30 application API routes.
- Real Chromium journeys passed for student submission, named voting, editorial acceptance and ZIP export, results access, and mobile administration.
- Desktop and 390-pixel mobile views were inspected; the mobile overview has no horizontal overflow.
- The production application and backup container images built successfully under OrbStack. The frontend dependency audit reported no known vulnerabilities at verification time.

## Recovery

Run the repeatable drill with:

```sh
DOCKER_CONTEXT=orbstack bash scripts/test-recovery.sh
```

The drill uses disposable containers, volumes, and generated test content. It migrates and seeds PostgreSQL, adds an attachment and named ballot history, makes an encrypted Restic backup, and restores it to an empty database and upload volume. Every application table's row count and content signature, the attachment reference, and all upload checksums matched after restore. Restoring into a database containing a sentinel table was correctly refused.

The successful local drill produced snapshot `0984f1b5c8d22a8b9eec691c7d16f44cbdeb5daea80c4efe399e2411eca393ef`. Its temporary repository was removed by the drill's cleanup; it is evidence from a test, not a production recovery point.

Separate tests verify backup-lock release after failure and restore refusal safeguards. The drill is also configured in CI.

## External launch dependencies

Actual school SSO needs the school's provider registration and credentials. Production hosting, independent backup storage, the external missed-backup monitor, and the four-hour recovery target must be verified in the chosen hosting environment. No public production deployment was performed during local verification.
