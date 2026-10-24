# AbiZeitBetrug implementation workflow

## Product boundaries

German private portal for LMGU Jahrgang 2027. June 2027 does not automatically close anything. Students read their own submissions. Managers read all categories and edit assigned categories. Only admins inspect named ballot history. Never introduce public uploads, production mock login, or AI processing of real contributions by default.

## Agent tiers

Use bounded delegation for implementation, as requested by the owner. Coordinate at most three workers with one lead. Model assignments: GPT-6.1 Sol/high or Opus 5.5 for architecture and critical independent review; GPT-6 Luna xhigh / Sonnet 5.5 for feature implementation; GPT-6 Luna/medium / Haiku 5.5 xhigh for routine fixtures, UI work under fixed contracts, and documentation. Escalate ambiguous security or data-integrity work to the architecture tier.

Give each worker file ownership, an API contract, and acceptance tests. Do not let two workers edit the same files concurrently. The lead owns integration and changes to shared contracts. Reviewers must be independent of the code they approve.

## Contracts and validation

- Start with docs/repo-map.md: `rg -i '<topic>' docs/repo-map.md` before exploring the tree.
- Read docs/implementation-contract.md and docs/openapi.json before API work.
- Update OpenAPI and regenerate TypeScript with `node scripts/check-contract.mjs --write` after contract changes. Do not edit generated types by hand.
- Run `make check`; use TEST_DATABASE_URL pointing only to a disposable PostgreSQL database for integration tests. Never run seed against production.
- New permission, lifecycle, voting, or persistence behavior requires invariant-focused tests. Assert observable guarantees; avoid implementation-mirroring tests.
- Verify migrations, backup and restore together. Never claim recovery is tested merely because a backup file exists.
- Keep credentials, identity tokens, named ballots, and private submission contents out of logs.

## Commits and completion

- Before every commit, check whether docs/repo-map.md is stale for the change (added, moved, renamed or repurposed files, routes, pages, rules) and update it in the same commit. `make check` fails on map paths that no longer exist.
- Split larger changes into sensible commits.
- Commit everything that belongs in the repository and push at the end of the task. Do not ask whether to commit or push.
- Work done in a worktree is merged into main once it is finished and checks pass; then push main and remove the worktree. Do not leave finished worktree branches unmerged. Do not push the worktree.
- Proceed autonomously within the authorized task. Avoid unnecessary questions and permission prompts; use required approvals only when needed.
- Do not be afraid to work on the running development system.
