import { Pool } from "pg";
import { createAuth } from "./auth-config.mjs";
import { createAuthHTTPServer } from "./server-core.mjs";
import { resolveMode } from "./policy.mjs";

async function main() {
  const config = resolveMode(process.env);
  if (config.mode !== "better_auth") throw new Error("Production auth entrypoint requires AUTH_MODE=better_auth");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 3000, application_name: "abizeitbetrug-auth" });
  const identityLockPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 3000, application_name: "abizeitbetrug-auth-identity-lock" });
  let runtimePromise;
  const getAuthRuntime = () => {
    if (!runtimePromise) {
      runtimePromise = createAuth({ mode: config.mode, pool })
        .then(({ auth, handoff, hasSessionAccess }) => ({ auth, handoff, hasSessionAccess }))
        .catch((error) => {
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
    mode: config.mode,
    authOrigin: config.authOrigin,
    serviceSecret: process.env.AUTH_SERVICE_SECRET,
  });

  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  process.stdout.write("auth service ready\n");

  const shutdown = async () => {
    const runtime = await runtimePromise?.catch(() => undefined);
    runtime?.handoff?.close();
    await new Promise((resolve) => server.close(resolve));
    await identityLockPool.end();
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
}

main().catch((error) => {
  process.stderr.write("auth service failed to start (" + String(error?.name || "Error") + "," + String(error?.code || "no_code") + ")\n");
  process.exit(1);
});
