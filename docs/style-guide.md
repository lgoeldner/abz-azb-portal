# UI style guide

Rules for the portal frontend (`deployables/portal/web`). New UI follows them; touch-ups move old UI toward them.

The look is interactive, inviting and paper-like: flat surfaces, clear tap targets, nothing frosted or floating without reason.

## Components

- Prefer Base UI components (`@base-ui/react`) over self-built widgets where they bring accessibility or behaviour for free (dialogs, popovers, menus, switches, tabs, selects). Use native elements when they already do the job.
- Prefer switches, pills and segmented controls to plain text links or bare text options. A choice should look tappable.

## Structure

- Do not duplicate features. Each action or destination has one place in the UI, unless a second one has a clear usability reason (for example a phone-only shortcut where the original is out of reach).

## Depth

- No soft (blurred) drop shadows. Separate surfaces with background tone, a 1px line or spacing.
  Exception: the floating containers over page content (Dock, ModeFab, the Redaktionsmenü trigger and popup) carry one soft shadow.
- Solid offset shadows without blur (the hover lift on buttons, e.g. `hover:shadow-[0_4px_0_var(--color-ink)]`) are part of the paper look and allowed anywhere.
- No blur: no `backdrop-filter`, `backdrop-blur-*`, `filter: blur()` or soft glows. Overlays use a flat translucent scrim.
