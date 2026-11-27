# UI style guide

Rules for the portal frontend (`deployables/portal/web`). New UI follows them; touch-ups move old UI toward them.

## Depth

- No drop shadows. Separate surfaces with background tone, a 1px line or spacing.
  Exception: the few floating pills over page content (Dock, ModeFab, and similar fixed controls) may use one shadow, and their buttons the hard hover lift.
- No blur: no `backdrop-filter`, `backdrop-blur-*`, `filter: blur()` or soft glows. Overlays use a flat translucent scrim.
