# UI style guide

Rules for the portal frontend (`deployables/portal/web`). New UI follows them; touch-ups move old UI toward them.

The look is interactive, inviting and paper-like: flat surfaces, clear tap targets, nothing frosted or floating without reason.

## Components

- Prefer Base UI components (`@base-ui/react`) over self-built widgets where they bring accessibility or behaviour for free (dialogs, popovers, menus, switches, tabs, selects). Use native elements when they already do the job.
- Prefer switches, pills and segmented controls to plain text links or bare text options. A choice should look tappable.

## Structure

- Do not duplicate features. Each action or destination has one place in the UI, unless a second one has a clear usability reason (for example a phone-only shortcut where the original is out of reach).

## Depth

- No drop shadows. Separate surfaces with background tone, a 1px line or spacing.
  Exception: the few floating pills over page content (Dock, ModeFab, and similar fixed controls) may use one shadow, and their buttons the hard hover lift.
- No blur: no `backdrop-filter`, `backdrop-blur-*`, `filter: blur()` or soft glows. Overlays use a flat translucent scrim.
