# School identity integration

The portal uses an OIDC authorization-code flow with PKCE. Go validates identity tokens and holds the browser session; React never stores provider tokens. A development-only OIDC provider exercises the same flow with fake users.

## Confirm with school IT

1. Which identity provider serves the Jahrgang 2027, and can the school register an external OIDC client?
2. Is a direct school-managed provider available, or would this require ByCS/VIDIS sponsorship and onboarding?
3. Which verified attributes are released: stable subject, name, school, class/cohort? Are names available for students?
4. Who can verify the cohort roster and approve the portal's users?
5. What are the discovery URL, client ID/secret, test identities, and supported logout endpoint?

ByCS documents external applications through [VIDIS](https://www.bycs.de/uebersicht-und-funktionen/vidis/index.html). [VIDIS onboarding](https://www.vidis.schule/teilnahmeprozess/) involves institutional steps. Its [published technical interface](https://www.vidis.schule/Whitepaper-Service-Provider) does not guarantee student names or cohort attributes. Do not assume an existing school login automatically grants this portal access.

## Configuration

Register `https://YOUR-DOMAIN/auth/callback` as the exact redirect URI. Configure `AUTH_MODE=oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `PUBLIC_URL`, and a strong `SESSION_SECRET` outside Git. Set `BOOTSTRAP_ADMIN_SUBJECT` to the verified provider subject of the first admin, never their name or email. The issuer must match the configured provider.

Verify valid login, declined login, invalid state/nonce/token, session expiry, logout, pending admission, permission revocation, and the first admin's roster checks in a staging deployment. Remove bootstrap configuration after initial provisioning.

If the provider does not release names, an admin assigns verified roster names during admission. If school IT offers only SAML, stop at that boundary and plan an OIDC broker; do not hand-roll a SAML parser or substitute a public mock login.
