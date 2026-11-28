# Design drafts (not functional)

Static HTML/CSS/JS sketches for the student poll cards. They exist only to try out
mechanics and visual directions before anything is built in the real portal.

- **Not part of the app.** Nothing here is imported by `deployables/portal/web` or the server.
- **Not functional.** No backend, no auth, no API calls. Polls, names and answers are
  hard-coded placeholders; nothing is saved (a reload resets everything).
- **Throwaway.** If a draft is kept, the relevant ideas get re-implemented in the portal
  code; these files are not meant to be maintained or reused as-is.

## Contents

| File | What it is |
| --- | --- |
| `index.html` | Entry page linking the drafts and visual styles |
| `01-carousel.html` | Card carousel (swipe/scrub/arrows, pull down to submit) |
| `02-swipe-stack.html` | Card stack (swipe either way to skip, pull down to submit) |
| `carousel.js`, `stack.js` | The two card decks (carousel, swipe-away stack) as shared components |
| `app.js` | Home screen with the Schüler / Redaktion mode switch, used by 01 and 02 |
| `tickets.js`, `redaktion.js`, `redaktion.css` | Redaktion mode: ticket cards, poll list, contributions, admin rows |
| `entwuerfe.html` | Poll drafts page, pushed from the Redaktion mode |
| `ios.css`, `chrome.js`, `cards.js` | Shared look, floating bars/menus and placeholder poll cards |
| `themes.css`, `themes.js` | Style variants: Basis, Jahrbuch, Abiball, Knast (only via `?v=` links on the index page) |

Open `index.html` directly in a browser.
