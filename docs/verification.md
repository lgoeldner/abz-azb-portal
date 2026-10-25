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

## Redaktion collection workspace — 25 October 2026

The collection phase now lists every authorized contribution and exports all statuses by default. Redaktion reads originals and photos, adds optional annotations, and does not require individual acceptance. Original text/photo mutations require the pending submission's author. Existing historical statuses and later moderation endpoints are preserved; no migration or data rewrite was needed. Students keep their submission and voting flows in Schüler mode.

Validation:

- `make check` passed with `TEST_DATABASE_URL` targeting the disposable `portal_test` database: Go race tests and vet, backup-lock and restore-safety tests, TypeScript, 54 frontend tests, production build, generated API contract (28 routes), repo-map validation, and linters.
- Independent critical review found no remaining defects. The direct-editorial-link mode persistence issue found during review was fixed and regression-tested.
- Chromium journeys cover submitting, reading, annotations without content mutations, all-status export, aggregate ballot results, administration, private diagnostics, and supported widths from 320 to 1920px. Long ballot option wrapping was corrected after the first responsive run. Final result: 19 journeys passed; one production-only diagnostic check was skipped on the development server.
- No schema migration changed. The backup/restore safety tests ran; the full recovery drill above was not rerun for this UI/permission change.

Design record:

- Invoked design-taste-frontend, app-screen workflow. Direction: **Achromatic ledger**, seed **765100827**, existing Bricolage Grotesque kept. Neutral gray `#f4f5f6`, white reading panels, ink `#17191c`, data blue `#1d5fbf`. The collection ledger answers “Welche Beiträge liegen in dieser Sammlung vor?”; the reader answers “Was wurde eingereicht und welche Anmerkungen liegen dazu vor?”
- Face: the yeargroup's paper-and-ink reading desk. Signature element: a collection ledger preserving named originals, opening each reader in one click, with separate notes. The idea sentence: “The yeargroup's collected originals become the reading desk's ledger.”
- Two shell redraws: initial No sidebar could not carry the existing named collections; Icon rail also could not label those destinations; the second draw returned No sidebar. The existing labelled sidebar was retained under the restyle rule and app shell default. No palette redraw, new dependencies, external imagery, or production sample content.
- The inspector ran on static DOM snapshots captured from the authenticated local app (not a mock app); browser journeys separately exercised the live controls. All listed final screenshots, including full-page contact sheets, were opened. Source lint: 0 failures, 0 warnings. Collection inspector at 1440/768/390: 0 failures, 0 warnings. Reader: 0 failures and one desktop ragged-row warning; the independently sized annotation/history rail intentionally follows its real content rather than padding the short original.
- Before/after: title 48/48/36px → 28/28/24px; collection inspector 1 failure and 4 warnings → 0/0. The selected-nav contrast, oversized mobile title and phone row truncation were corrected across three visual rounds.

Final critique, round 3:

Seen in one second: a distinct Redaktion desk with a collection of named originals.

Idea: collected yeargroup originals form a readable ledger, with notes beside them.

Live thing: search by title/text/author, open a reader, record an annotation.

Layout words by section: shell=labelled collections / collection=searchable ledger / reader=original and notes / phone=single-column reading.

Scores (self-assessment): design 7.5 · usability 8.5 · creativity 7 · content 8 → overall 7.8. App-screen caps applied; no marketing imagery or motion floor.

Top three visual issues and outcomes:

1. Original student upload UI obscured collected submissions (before desktop/phone): replaced with the collection ledger.
2. Selected navigation and display-scale headings reduced readability (first after screenshots): neutral selection, readable ink, 28/24px titles.
3. Status tags cramped phone titles (collection mobile): metadata and status now wrap below the full title. A short original can still leave unused desktop space beside a longer notes rail; natural content height is retained.

### Verwaltung workspace and accent follow-up — 25 October 2026

Verwaltung navigation is now visible only for admins in Redaktion. Direct admin bookmarks activate and remember the editorial workspace, including its theme. Explicitly switching to Schüler returns home, removes Verwaltung, and remains selected after the browser navigation settles. A route-entry-only normalization effect and stable view setter prevent delayed navigation from overwriting the user's choice.

The existing reading-desk direction (seed 765100827, Bricolage Grotesque retained) now uses cobalt `#1d5fbf` on primary controls, branding, focus and selected states, with pale blue `#e8f0fc` on active sidebar links. This extends the original achromatic direction at the owner's request; no new draw or imagery was added. Independent review caught a hover selector that removed contrast; the selected-link hover rule now preserves the pale background, with a browser test requiring at least 4.5:1 contrast on all three Verwaltung destinations.

Final visual critique:

Seen in one second: Redaktion and Verwaltung belong to one workspace, identifiable by cobalt selection and branding.

Idea: the same yeargroup reading desk, with color marking actions and current location.

Live thing: switching to Schüler removes the Verwaltung menu; direct admin bookmarks return to Redaktion.

Layout words by section: sidebar=workspace-scoped destinations / Verwaltung=people and controls / collection=originals ledger.

Scores (self-assessment): design 7.8 · usability 8.5 · creativity 7 · content 8 → overall 7.9. Existing app direction retained; no imagery or motion caps apply.

Top three issues corrected: Verwaltung links leaking into Schüler mode; direct admin routes inheriting the student palette; selected-link hover contrast. Final inspector at 1440/768/390: 0 failures for both Personen and collection; the collection has no warnings. Personen retains one desktop empty-area warning because the real people list is short; no artificial data or panels were added. All viewport screenshots and contact sheets were opened. Source lint and `make check` passed, including 57 frontend tests and disposable PostgreSQL integration checks. Independent review found no remaining defects.

Final browser result for the follow-up: 20 journeys passed; one production-only diagnostic test was skipped on the development server. The Verwaltung journey verifies returning to `/`, persisted Schüler mode, hidden admin navigation, correct editorial theme on direct bookmarks, and selected-link hover contrast.

The follow-up also rounds collection and submission row hover surfaces and restores distinct hover colors for Sammlung filter chips (including an active-chip hover). A live Chrome smoke check verified changing chip backgrounds and nonzero row corner radii on desktop and phone; hover screenshots were opened. The final `make check` passed with 57 frontend tests, and the production build passed after the active-chip refinement.

## People polls — 25 October 2026

New person polls default to all admitted cohort members, refreshed at opening and fixed thereafter. Editors can switch to explicit candidates and set 1–500 selections per voter. Creation and voting share searchable candidates with removable chips above the search field. Migration 005 preserves existing explicit candidates, votes and named audit history. Changed selections create complete grouped history visible only to admins.

- `make check` passed against disposable PostgreSQL `portal_people_test_20261025`, including race tests, vet, 65 frontend tests, type checking, production build, generated contract, repo-map checks and all linters.
- Invariant tests cover bounded atomic replacement, concurrent multiple selections, self/foreign/duplicate/closed rejection, distinct voter counts, history snapshots, permissions, roster freezing and migration preservation. Independent review found no remaining defects. Full checks and integration review passed again after merging the concurrent Verwaltung/accent updates.
- Live Chromium against a separate seeded database exercised default switch, explicit candidate search/chips, opening, saving two choices, reloading, chip removal and empty search results. Desktop 1440px and phone 390px screenshots were inspected; phone and tablet 900px had no horizontal overflow.
- Full Docker recovery drill passed with current migrations, multiple current selections and both legacy and grouped audit rows. Table signatures and attachment hashes matched after restoring; a non-empty target was correctly refused. The throwaway Restic snapshot was `eb0250d73e343db2e34cd4abbd70dc567002f6c35c20a2dc2b82544c90ea8e94` and was cleaned up by the drill.
