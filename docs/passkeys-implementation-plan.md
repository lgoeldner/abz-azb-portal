# Passkey implementation plan

Status: planned, 16 November 2026. Not implemented. Follows the "Google and passkeys" section of [auth-email-implementation-plan.md](auth-email-implementation-plan.md).

## Approach

Use `@better-auth/passkey` 1.7.14 in the existing auth service. No Go WebAuthn code. Magic links stay as recovery. Sessions, UUID users and Go authorization are unchanged.

## Steps

1. **Dependency.** Pin `@better-auth/passkey` 1.7.14. Also pin `@better-auth/core` 1.7.14 explicitly; without it npm resolves the peer to 1.7.25 and fails.
2. **Migration `017_passkeys.sql`** (016 is taken by the Steckbrief work in progress; use the next free number).
   - Table `auth_passkeys` (public key, credential id, counter, `user_id` with `ON DELETE CASCADE`).
   - The existing erased-writer guard trigger, so an erased user cannot get a new passkey.
   - Replace `portal_user_auth_revoke` so a login email change also deletes that user's passkeys.
3. **`deployables/auth/auth-config.mjs`.**
   - Enable the plugin: RP ID is the hostname of `BETTER_AUTH_URL`, fixed origin, discoverable credentials required.
   - Map the plugin schema to `auth_passkeys`.
   - Set `session.freshAge` to 1 hour, so enrollment only works shortly after login.
4. **`deployables/auth/server-core.mjs`.**
   - Allowlist register options, verify registration, authenticate options, verify authentication, list and delete. `update-passkey` stays 404.
   - POSTs require same origin. Bodies are rebuilt so `createSession` cannot be passed.
   - Both verify calls run under identity lock 74120984.
   - Minimal responses: 204 plus cookies on sign-in, `{id, name, created_at}` for the list. No profile data, no public keys.
   - "Mit Passkey anmelden" button on both login pages, using native `PublicKeyCredential.parseRequestOptionsFromJSON` with no client library. Hidden when the browser lacks support.
5. **Go.** `erase.go` deletes the user's passkeys. The mode cutover in `better_auth.go` deletes all passkeys. No new Go routes, so OpenAPI is unchanged.
6. **Restore.** `restore.sh` deletes all passkeys, so a restore cannot resurrect a removed one. Update `test-restore-safety.sh` and `scripts/test-recovery.sh`.
7. **Web.** New `Passkeys.tsx` in the sidebar for all roles: list, add, remove. `api.ts` passes `/api/auth/` paths through.
8. **Tests.**
   - Node integration test with a software authenticator (`node:crypto`, hand-rolled CBOR): register then sign in; no profile in responses; another user cannot delete the passkey; a disabled user is refused; an email change revokes passkeys; a stale session cannot enroll; cross-origin POST is denied; non-allowlisted endpoints return 404.
   - Go: extend the erase and cutover tests.
   - Playwright: one journey with a Chromium virtual authenticator.
9. **Docs and completion.** Update the implementation contract, operations doc, plan status, `PRIVACY.md` and the repo map. Run `make check` and the recovery drill. Independent architecture-tier review of the auth changes.

## Decisions

- **Passkeys also work in mock mode.** This lets the Playwright test run in CI. The cutover wipe stops a mock-enrolled passkey from reaching real mode.
- **Enrollment window is 1 hour after login.** After that the UI says to log in again. The plugin default would be the full 24-hour session.
- **Restore and email change delete passkeys.** Users re-enroll through a magic link. Keeping them would leave the wrong person with access after a corrected wrong-email assignment.
- **No passkey naming or rename UI.** The list shows "Passkey vom <Datum>".

## Constraints

- Changing the production domain invalidates every passkey, because the RP ID is the hostname.
- A passkey with unrestricted email recovery does not make the account phishing-resistant.
