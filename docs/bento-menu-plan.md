# Redaktion bento menu (branch `ui/bento-menu`)

Replaces the Redaktion dashboard and the Schüler/Redaktion mode switch with one bento grid inside the Redaktionsmenü. Design variant A was chosen by the owner.

Mockups (Design canvas): <https://claude.ai/artifact/W2vBhB8YXD63WWmTXjKcAE>, files `project/Main.dc.html` (phone), `PhoneFull.dc.html`, `PhoneClosed.dc.html`, `DesktopA.dc.html`. `DesktopB.dc.html` was rejected. The mockups show sample data; this plan wins where they differ.

Frontend only. No API, schema or permission change.

## Behaviour

- **Dock**: one row (avatar, name, settings, logout) for every role. No view switch, no `ModeFab`.
- **Grip**: stays where it is, editors only, in both views. Red dot when any document is `unread`.
- **Phone**: bottom sheet opens partly, expands to full screen on scroll, header (handle, Mark, title) stays on top, the page never shows below the sheet.
- **From 651px**: floating 600px card above the Dock with its own scroll; the dark Grip close button stays on the trigger spot. No full screen. The `bottom-[150px]` offset follows the new one-row Dock.
- **No edit menu**: no add, remove or reorder of tiles.
- **Colours**: existing tokens and `StatusPill`/`AreaTag`. No yellow tiles. Meeting-style highlight is not needed in v1.

## Tiles

Phone 4 columns, 84px rows; desktop 6 columns, 88px rows. `grid-auto-flow: dense`, so hidden tiles leave as few gaps as possible. Order:

| Tile | Size (phone / desktop) | Data | Shown |
| --- | --- | --- | --- |
| Task carousel | 4×2 / 6×2 | `summarizeTickets().mine` | projects |
| Aufgaben (board) | 1×1 | link `/tickets` | projects |
| + Ticket | 1×1 | link `/tickets/neu` | projects |
| Alle Beiträge + count | 2×1 | `/submissions`, link `/redaktion/beitraege` | always |
| Abstimmungen, % abgestimmt + bar | 4×1 / 3×1 | Σ`participation.voted` / Σ`eligible` over open ballots the viewer can edit; link `/sammlungen` | always, "–" without open ballots |
| New documents count | 1×1 | `unread` in `/documents`, link `/dokumente` | projects |
| + Dokument | 1×1 | link `/dokumente/neu` | projects |
| Neue Abstimmung | 2×1 | link `/sammlungen?neu` | always |
| Zur Schüleransicht | 4×1 / 2×1 | view switch to `/` | always |
| N warten auf deine Freigabe | 2×1 | `summarizeTickets().waiting` | projects and `canReview` |
| Nächste Frist | 2×1 | earliest future `closes_at` of open collections the viewer can edit; link to it | when one exists |
| Neue Beiträge | 2×1 | submissions in editable collections created in the last 7 days; label "in 7 Tagen" | always |
| Zuletzt geändert | 2×1 | newest `updated_at` document | projects, when one exists |
| Abstimmungen offen / beendet | 4×1 / 2×1 | counts over editable ballots | always |
| Divider "Admin" (text with inline hairline) | full row | | admin |
| N warten auf Zugang | 2×1 | `/admin/users` not admitted | admin |
| E-Mails heute | 2×1 | `/admin/email/status`: `usage.used` / `policy.daily_limit` | admin |
| Personen, Protokoll, Bereiche, E-Mail | 1×1 each | existing `/verwaltung/*` links | admin; Bereiche needs projects |

Scoping matches today's `EditorialHome`: `canEdit` for managers, everything for admins.

**Carousel card**: status and Bereich badges (`StatusPill`, `AreaTag`, area position from `/areas`), title (one line, ~19px), "Ziel:" with `ticket.goal` clamped to two lines (omitted when empty). Cards are 88% wide so the next one peeks in. Native scroll snap for touch, drag with the mouse, dot buttons with accessible names, label "Meine Aufgaben · N offen" under the cards. At most 6 cards, then a "Zum Board" card. Empty state: "Dir ist gerade nichts zugewiesen" linking to the board.

**Loading and errors**: queries run only while the menu is open (`useData(path, open)`), except `/documents` for the Grip dot. A failed query shows "–" in its tile with a retry on the sheet; one failure never blanks the grid.

## Defaults for open points

The owner can change these after viewing the preview.

1. `/redaktion` stays as the editors' entry URL and redirects (replace) to `/tickets`, or to `/redaktion/beitraege` without project management. Fresh editor visits and the brand link keep working through it.
2. **Nächstes Treffen is left out.** The portal stores no meetings. Adding it later needs a migration, API route, contract regeneration, permission tests and a backup/restore check.
3. Dropped with the dashboard: per-kind class widgets, "Gesammelte Beiträge" list, the admissions name list. Their pages stay reachable through the tiles.
4. StudentHome keeps "Zum Redaktionsbereich" and "Neue Abstimmung".

## Steps (one commit each, `make check` passes after each)

1. **Spike, nothing committed**: Base UI 1.9 Drawer has `snapPoints`. Check in a touch viewport that a swipe up expands the sheet before its content scrolls, and that swipe down at scroll top collapses, then closes. If it does not behave, drive the snap point from the content's scroll position instead.
2. `BentoMenu.tsx` (new): drawer, tiles, carousel, data hook. `App.tsx` uses it instead of `NavDrawer`/`DrawerLink`. Today every link click in the drawer sets the view to `redaktion`; the Schüleransicht tile must be exempt.
3. Remove `ModeFab`, `ViewSwitch`, `modes`; one-row Dock. Keep `useSwitchView` for the tile.
4. Remove `EditorialHome`, `MyTasks`/`TaskList` (keep `summarizeTickets`, `isFinishedTicket`), `DocumentTiles`; add the `/redaktion` redirect; delete imports that became unused.
5. Docs: `docs/repo-map.md` (App, BentoMenu, TicketCards, Documents, `page /`, `page /redaktion`), `docs/style-guide.md` (shadow exception names `ModeFab`).

## Tests

New `bento.test.tsx`, asserting guarantees:

- students never get the Grip;
- admin tiles and admin requests only for admins;
- carousel lists only own unfinished tickets;
- no ticket or document tiles or requests without project management;
- a menu link from the Schüler view lands on the Redaktion page; the Schüleransicht tile lands on `/` in the Schüler view.

Rewrite what the change breaks:

- `App.test.tsx`: menu link list (keep an accessible group named "Verwaltung" for the admin tiles), Schüler-view menu navigation, back navigation restoring the view (uses the "Meine Abstimmungen" region and the Dock "Schüler" button).
- `e2e/responsive.spec.ts`: the `Ansicht:` and "Schüler" button assertions.
- `e2e/portal.spec.ts`: landing URL `/redaktion`, both flows through "Meine Abstimmungen", the Dock "Schüler" button.
- `tickets.test.tsx` and `Documents.test.tsx` if they render removed components.

## Ownership

The lead owns `App.tsx`, `TicketCards.tsx`, `Documents.tsx` and docs. A feature worker may own `BentoMenu.tsx`; a second one the test files. A reviewer who wrote none of it checks the diff, with attention to admin-only data and the removed navigation paths.

## Done

`make check` and e2e pass; checked in a browser at 360, 390, 800 and 1440px as student, manager and admin; PR from `ui/bento-menu` into `dev` so the preview workflow deploys it. Do not merge before the owner has seen the preview.
