# UI style guide

Rules for the portal frontend (`deployables/portal/web`). New UI follows them; touch-ups move old UI toward them.

The look is interactive, inviting and paper-like: flat surfaces, clear tap targets, nothing frosted or floating without reason.

## Type and colour

The portal follows the look of the Abizeitung article pages. Font sizes of the print guide do not apply here.

| Token | Font or value | Use |
|---|---|---|
| `font-serif` | Instrument Serif 400 | `h1` (the base style sets it; add no weight class), drop cap |
| `font-sans` | Figtree | everything else; `h2`/`h3` bold 700, `h3` in ink, not in accent |
| `font-display` | Poppins 600 / 800 | quotes (600), big numbers (800) |
| `font-body` | Merriweather 300 | contribution text as it will be printed (`.reading`) |
| `paper` / `ink` | `#fff` / `#141413` | page (pure white) and text |
| `ink-soft` / `muted` | `#2b2926` / `#5c5750` | subheadings / bylines, captions, placeholder text |
| `photo` | `#e4e0d6` | flat photo placeholder, no pattern |
| `accent` | `#d41f2b`, provisional | big number, drop cap, actions; change this one token to try another red |

- Fonts are self-hosted via fontsource, never Google Fonts.
- The Redaktion keeps its cobalt accent and neutral grey desk (`[data-workspace='redaktion']`).
- No all caps.
- No lines or frames around quotes, photos and placeholders. A quote stands free in display type, without quotation-mark ornaments.
- Text has at least 4.5:1 contrast.

## Components

- Prefer Base UI components (`@base-ui/react`) over self-built widgets where they bring accessibility or behaviour for free (dialogs, popovers, menus, switches, tabs, selects). Use native elements when they already do the job.
- Prefer switches, pills and segmented controls to plain text links or bare text options. A choice should look tappable.

## Structure

- Do not duplicate features. Each action or destination has one place in the UI, unless a second one has a clear usability reason (for example a phone-only shortcut where the original is out of reach).

## Depth

- No soft (blurred) drop shadows. Separate surfaces with background tone, a 1px line or spacing.
  Exception: the floating containers over page content (Dock, the Redaktionsmenü trigger and popup) carry one soft shadow.
- Solid offset shadows without blur (the hover lift on buttons, e.g. `hover:shadow-[0_4px_0_var(--color-ink)]`) are part of the paper look and allowed anywhere.
- No blur: no `backdrop-filter`, `backdrop-blur-*`, `filter: blur()` or soft glows. Overlays use a flat translucent scrim.
