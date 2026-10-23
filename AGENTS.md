# AbiZeitBetrug implementation workflow

## Product boundaries

German private portal for LMGU Jahrgang 2027. June 2027 does not automatically close anything. Students read their own submissions. Managers read all categories and edit assigned categories. Only admins inspect named ballot history. Never introduce public uploads, production mock login, or AI processing of real contributions by default.

## Agent tiers

Use bounded delegation for implementation, as requested by the owner. Coordinate at most three workers with one lead. Model assignments: GPT-6 Astra/high for architecture and critical independent review; GPT-6.1 Sol/high for feature implementation; GPT-6 Luna/medium for routine fixtures, UI work under fixed contracts, and documentation. Escalate ambiguous security or data-integrity work to the architecture tier.

Give each worker file ownership, an API contract, and acceptance tests. Do not let two workers edit the same files concurrently. The lead owns integration and changes to shared contracts. Reviewers must be independent of the code they approve.

## Contracts and validation

- Read docs/implementation-contract.md and docs/openapi.json before API work.
- Update OpenAPI and regenerate TypeScript with `node scripts/check-contract.mjs --write` after contract changes. Do not edit generated types by hand.
- Run `make check`; use TEST_DATABASE_URL pointing only to a disposable PostgreSQL database for integration tests. Never run seed against production.
- New permission, lifecycle, voting, or persistence behavior requires invariant-focused tests. Assert observable guarantees; avoid implementation-mirroring tests.
- Verify migrations, backup and restore together. Never claim recovery is tested merely because a backup file exists.
- Keep credentials, identity tokens, named ballots, and private submission contents out of logs.
