import { createEmailHandoff } from "./email-handoff.mjs";
import { normalizeEmail, resolveMode } from "./policy.mjs";

export async function createAuth({
  mode,
  pool,
  env = process.env,
  extraPlugins = [],
  testSendMagicLink,
  fetchImpl = fetch,
}) {
  const config = resolveMode(env);
  if (config.mode !== mode) throw new Error("Auth mode does not match validated runtime mode");
  if (testSendMagicLink && config.appEnv !== "test") {
    throw new Error("Test magic-link delivery is only available with APP_ENV=test");
  }

  const [{ betterAuth }, { magicLink }] = await Promise.all([
    import("better-auth"),
    import("better-auth/plugins"),
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

  const auth = betterAuth({
    appName: "AbiZeitBetrug",
    baseURL: config.authOrigin,
    basePath: "/api/auth",
    secret,
    database: pool,
    trustedOrigins: [config.authOrigin],
    emailAndPassword: { enabled: false },
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
      accountLinking: { enabled: false },
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
      cookiePrefix: mode === "mock" ? "abz-mock" : "abz-auth",
      useSecureCookies: secureCookies,
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
    },
    plugins: [...extraPlugins, plugin],
  });

  const context = await auth.$context;
  return { auth, context, handoff, hasLoginAccess, hasSessionAccess };
}

function requirePortalURL(value) {
  const parsed = new URL(value ?? "");
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("PORTAL_INTERNAL_URL must be an internal HTTP(S) origin");
  }
  return parsed.origin;
}
