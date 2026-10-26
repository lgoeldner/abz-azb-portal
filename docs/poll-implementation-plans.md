# Poll implementation plans

Items 1–9 are proposed formats. Item 10 is implemented. Reuse Sammlungen, authentication, and existing permissions: students read their own submissions, editors see aggregate results and can manage assigned categories, and only admins inspect named ballot history. Do not process real contributions with AI by default. Preserve the existing draft/open/closed lifecycle and ballot protections.

1. **Abi-Duell tournament.** Add a bracket with matchups, rounds, and ballots; advance winners transactionally and offer a runoff for ties. **Test:** repeated advancement is idempotent.
2. **Know your year group prediction.** Collect atomic yes/no answers with a 0–100 percent prediction; after close, show editors actual-versus-guess aggregates. Replacements must not count twice. **Test:** replacing a response leaves one current vote and correct aggregates.
3. **Year group as film casting.** Define roles and eligible candidates; save role-to-person mappings atomically, using the existing PeoplePicker. Optionally require distinct people. **Test:** enforce eligibility, self-voting rules, completeness, and optional distinctness.
4. **100 points allocation.** Let each voter assign integer points totaling exactly 100; show a budget in the UI and aggregate bars. **Test:** reject negative points and totals other than 100.
5. **School tier list.** Place each item in one tier with drag and keyboard controls; show distributions and modal tiers while preserving ties. **Test:** reject incomplete or duplicate item placement.
6. **Chaos map two axes.** Collect labelled, bounded coordinates for each event and show accessible controls and a scatterplot. **Test:** reject out-of-range coordinates.
7. **School hotspots image pins.** Use a private map with normalized coordinates, keyboard and text alternatives, and a heatmap. **Test:** resizing preserves locations, alternatives are accessible, and unauthorized image access fails.
8. **Caption contest.** Reuse author-owned submissions. Editors explicitly shortlist copies with author-hidden options linked to an approved private photo; voting uses the existing proposal ballot. **Test:** voter payloads omit author identities and unshortlisted entries; authors retain access to their own originals.
9. **Either/or comparisons.** Assign five balanced pairs per voter, with one replaceable choice per pair; show cards and pairwise results. **Test:** reload preserves assignments and does not add votes.
10. **Abi in three words (implemented, `words`).** Collect replaceable lowercase word chips with a configurable 1–500 word cap (default three). Redaktion and admins read a safe weighted word cloud and CSV export; granted editors can toggle exclusions and edit/merge labels without changing originals. Merged words count each current voter once. Students see only their own entries; named history stays admin-only. **Tests:** atomic replacement and validation, Unicode normalization, permission boundaries, immutable originals/history, reversible moderation, stale edits, distinct merged counts, safe text rendering, and CSV escaping.

## Shared implementation checklist

- Update OpenAPI and regenerate types with `node scripts/check-contract.mjs --write` when contracts change.
- Add invariant-focused tests; run `make check` with `TEST_DATABASE_URL` set only to a disposable PostgreSQL database.
- For storage changes, verify migrations, backup, and restore together. Update `docs/repo-map.md` for file or route changes.
- Commit changes, merge the finished worktree into main, push main, and remove the worktree.
