import { createEmailHandoff } from "./email-handoff.mjs";
import { cookiePrefixFor, googleCredentials, normalizeEmail, resolveMode } from "./policy.mjs";

export async function createAuth({
  mode,
  pool,
  env = process.env,
  extraPlugins = [],
  testSendMagicLink,
  testGoogleOptions,
  fetchImpl = fetch,
}) {
  const config = resolveMode(env);
  if (config.mode !== mode) throw new Error("Auth mode does not match validated runtime mode");
  if (testSendMagicLink && config.appEnv !== "test") {
    throw new Error("Test magic-link delivery is only available with APP_ENV=test");
  }
  if (testGoogleOptions && config.appEnv !== "test") {
    throw new Error("Test Google options are only available with APP_ENV=test");
  }
  // Never in mock mode: the development picker must not create real provider bindings.
  const google = mode === "better_auth" ? googleCredentials(env) : null;

  const [{ betterAuth }, { magicLink }, { passkey }] = await Promise.all([
    import("better-auth"),
    import("better-auth/plugins"),
    import("@better-auth/passkey"),
  ]);
  const secret = mode === "mock" ? env.MOCK_AUTH_SECRET : env.BETTER_AUTH_SECRET;
  const secureCookies = config.authURL.protocol === "https:";
  const handoff = mode === "better_auth" && !testSendMagicLink
    ? createEmailHandoff({
        portalInternalURL: requirePortalURL(env.PORTAL_INTERNAL_URL),
        serviceSecret: env.AUTH_SERVICE_SECRET,
        isCurrent: async (message) => {
          try {
            const result = await pool.query(
              `SELECT u.id
                 FROM users u
                 JOIN auth_runtime_state state ON state.singleton = true
                WHERE u.id = $1
                  AND lower(u.login_email) = $2
                  AND u.login_enabled = true
                  AND u.admitted = true
                  AND state.mode = $3`,
              [message.user_id, message.email, mode],
            );
            return result.rowCount === 1;
          } catch {
            return false;
          }
        },
        fetchImpl,
      })
    : null;

  async function hasLoginAccess(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const result = await pool.query(
      `SELECT id, login_email
         FROM users
        WHERE lower(login_email) = $1
          AND login_enabled = true
          AND ($2::boolean OR admitted = true)
        LIMIT 1`,
      [normalized, mode === "mock"],
    );
    return result.rows[0] ?? null;
  }

  async function hasSessionAccess(userId) {
    const result = await pool.query(
      `SELECT u.login_enabled, u.admitted, state.mode
         FROM users u
         JOIN auth_runtime_state state ON state.singleton = true
        WHERE u.id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return Boolean(row?.login_enabled && row.mode === mode && (mode === "mock" || row.admitted));
  }

  const plugin = magicLink({
    expiresIn: 15 * 60,
    disableSignUp: true,
    storeToken: "hashed",
    rateLimit: { window: 60, max: 10 },
    async sendMagicLink({ email, token }) {
      try {
        const user = await hasLoginAccess(email);
        if (!user) return;
        const url = `${config.authOrigin}/auth/magic-link#${encodeURIComponent(token)}`;
        const message = { user_id: user.id, email: user.login_email, url };
        if (testSendMagicLink) {
          await testSendMagicLink(message);
        } else if (handoff) {
          handoff.enqueue(message);
        }
      } catch {
        // Keep account existence, mail health, addresses, and link tokens out of responses and logs.
      }
    },
  });

  const passkeyPlugin = passkey({
    rpID: config.authURL.hostname,
    rpName: "AbiZeitBetrug",
    origin: config.authOrigin,
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    schema: {
      passkey: {
        modelName: "auth_passkeys",
        fields: {
          publicKey: "public_key",
          userId: "user_id",
          credentialID: "credential_id",
          deviceType: "device_type",
          backedUp: "backed_up",
          createdAt: "created_at",
        },
      },
    },
  });

  // Sign-in only resolves an existing (provider, Google subject) binding. Unknown accounts never sign up and a
  // matching email never links implicitly; linking is an explicit, fresh-session action (server-core.mjs).
  const socialProviders = google
    ? { google: { ...google, disableSignUp: true, disableImplicitSignUp: true, prompt: "select_account", ...testGoogleOptions } }
    : {};

  // A binding is only created for a user who holds a current, fresh, admitted session. Revocation deletes sessions,
  // so a link flow started before an email change or disablement cannot finish afterwards.
  async function mayLink(userId) {
    const result = await pool.query(
      `SELECT 1
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.user_id = $1
          AND s.expires_at > now()
          AND s.created_at > now() - interval '1 hour'
          AND u.login_enabled = true
          AND u.admitted = true
        LIMIT 1`,
      [userId],
    );
    return result.rowCount === 1;
  }
  // Only the binding is needed; provider tokens are never stored.
  const withoutTokens = (account) => ({ data: { ...account, accessToken: null, refreshToken: null, idToken: null } });

  const auth = betterAuth({
    appName: "AbiZeitBetrug",
    // Message only: plugin error objects can carry credential ids and challenges.
    logger: { log: (level, message) => console.error(level, message) },
    baseURL: config.authOrigin,
    basePath: "/api/auth",
    secret,
    database: pool,
    trustedOrigins: [config.authOrigin],
    emailAndPassword: { enabled: false },
    socialProviders,
    user: {
      modelName: "users",
      fields: {
        email: "login_email",
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      modelName: "auth_sessions",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
      },
      expiresIn: 24 * 60 * 60,
      freshAge: 60 * 60,
      updateAge: 24 * 60 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      // enabled only for the explicit link-social route; allowUnlinkingAll because magic links have no account row.
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true, allowUnlinkingAll: true },
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      storeInDatabase: true,
      storeIdentifier: "plain",
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limits",
      fields: { lastRequest: "last_request" },
      window: 60,
      max: 60,
    },
    advanced: {
      // The library would prepend "__Secure-", which still allows a Domain attribute.
      // The prefix carries "__Host-" itself over HTTPS; Secure comes from the defaults.
      // Never set a cookie domain or crossSubDomainCookies.
      cookiePrefix: cookiePrefixFor(mode, secureCookies),
      useSecureCookies: false,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax",
        path: "/",
      },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      database: { generateId: "uuid", validateSchema: false },
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    databaseHooks: {
      user: {
        create: {
          before: async () => false,
        },
      },
      session: {
        create: {
          before: async (session) => await hasSessionAccess(session.userId),
        },
      },
      account: {
        create: {
          before: async (account) => account.providerId === "google" && await mayLink(account.userId) ? withoutTokens(account) : false,
        },
        update: {
          before: async (account) => withoutTokens(account),
        },
      },
    },
    plugins: [...extraPlugins, plugin, passkeyPlugin],
  });

  const context = await auth.$context;
  return { auth, context, handoff, hasLoginAccess, hasSessionAccess, google: Boolean(google) };
}

function requirePortalURL(value) {
  const parsed = new URL(value ?? "");
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("PORTAL_INTERNAL_URL must be an internal HTTP(S) origin");
  }
  return parsed.origin;
}
