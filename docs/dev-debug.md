# Development debug menus

Vite development mode shows the same small **Debug** disclosure beside each supported item. Open it with a click, Enter or Space. It expands in place, so long IDs remain readable on narrow screens. Production builds render no debug controls or diagnostic panels; URL parameters and browser storage cannot enable them.

## Useful places to inspect

| View or card | Question the metadata helps answer |
| --- | --- |
| Session/view context below the page content | Which role and presentation mode are active? Is this account admitted and eligible for voting? |
| Overview and poll list cards | Which poll and category does this card represent? What status and version are loaded? |
| Poll detail | Is the poll open, how many options exist, and are self votes allowed? |
| Contribution rows and detail | Which record/version is visible? What is its status and attachment count? |
| Category cards | Which category ID and content kind does this link or editor use? |

These are read-only diagnostics of data already loaded for the normal view. Opening a disclosure makes no API requests and grants no access. Existing server permissions continue to control which records the browser receives.

The browser checks in `deployables/portal/web/e2e/dev-debug.spec.ts` run against the Vite dev server by default. Keep trace output outside Vite's watched source tree, for example `npm run test:e2e -- e2e/dev-debug.spec.ts --output=/tmp/portal-debug-results`. For a production build served by Vite preview or Go, set `DEBUG_EXPECT_PRODUCTION=1` along with `PLAYWRIGHT_BASE_URL`; CI sets this flag for its built frontend.

## Adding a menu

Use the shared `DevDebug` component with a short label and an explicit map of scalar metadata. Place it beside navigation links, never inside a link or another control. Keep the default collapsed state and shared styling.

Do not pass whole API objects, session/CSRF tokens, names, contribution text, attachment URLs, ballot selections or named ballot history. Use counts and booleans where sufficient. Further candidates, if a concrete debugging need arises, are attachment MIME type/size, list-filter counts, and admin system-status timestamps. Avoid adding a disclosure to every decorative card or exposing raw response dumps.
