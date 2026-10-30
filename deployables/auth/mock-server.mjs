import { Pool } from "pg";
import { createAuth } from "./auth-config.mjs";
import { createAuthHTTPServer } from "./server-core.mjs";
import { resolveMode } from "./policy.mjs";

async function main() {
  const config = resolveMode(process.env);
  if (config.mode !== "mock" || config.appEnv !== "development") {
    throw new Error("Mock auth entrypoint is development-only");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000, application_name: "abizeitbetrug-auth-mock" });
  const identityLockPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 3000, application_name: "abizeitbetrug-auth-mock-identity-lock" });
  let runtimePromise;
  const getAuthRuntime = () => {
    if (!runtimePromise) {
      runtimePromise = (async () => {
        const { testUtils } = await import("better-auth/plugins");
        const value = await createAuth({ mode: "mock", pool, extraPlugins: [testUtils()] });
        const mockHelpers = {
          async login(userId) {
            if (!(await value.hasSessionAccess(userId))) throw new Error("login denied");
            const result = await value.context.test.login({ userId });
            if (Array.isArray(result.cookies)) return result.cookies;
            const cookieHeader = result.headers?.get("cookie");
            if (!cookieHeader) return [];
            return cookieHeader.split(/;\s*/u).map((pair) => {
              const split = pair.indexOf("=");
              return { name: pair.slice(0, split), value: pair.slice(split + 1), path: "/", httpOnly: true, secure: config.authURL.protocol === "https:", sameSite: "lax" };
            });
          },
        };
        return { auth: value.auth, hasSessionAccess: value.hasSessionAccess, mockHelpers };
      })().catch((error) => {
        runtimePromise = undefined;
        throw error;
      });
    }
    return runtimePromise;
  };
  const server = createAuthHTTPServer({
    getAuthRuntime,
    pool,
    identityLockPool,
    mode: "mock",
    authOrigin: config.authOrigin,
    serviceSecret: process.env.AUTH_SERVICE_SECRET,
  });
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  process.stdout.write("development mock auth ready\n");

  const shutdown = async () => {
    await new Promise((resolve) => server.close(resolve));
    await identityLockPool.end();
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
}

main().catch((error) => {
  process.stderr.write("development mock auth failed to start (" + String(error?.name || "Error") + "," + String(error?.code || "no_code") + ")\n");
  process.exit(1);
});
