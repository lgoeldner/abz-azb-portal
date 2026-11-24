import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const testDatabaseURL = process.env.TEST_DATABASE_URL;
const optIn = process.env.TEST_DATABASE_DISPOSABLE === "YES";
const skipReason = !testDatabaseURL
  ? "TEST_DATABASE_URL is unset; Google integration checks skipped"
  : !optIn
    ? "Set TEST_DATABASE_DISPOSABLE=YES only for a disposable PostgreSQL database"
    : false;

const LOGIN_FAILED = "/auth/login?google=failed";

function absorb(jar, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";", 1);
    const split = pair.indexOf("=");
    const value = pair.slice(split + 1);
    if (value) jar.set(pair.slice(0, split), value); else jar.delete(pair.slice(0, split));
  }
}
const cookieOf = (jar) => [...jar].map(([name, value]) => name + "=" + value).join("; ");

test("Google signs in only through an explicit, fresh, revocable binding", { skip: skipReason }, async () => {
  const { Pool } = await import("pg");
  const { resolveMode } = await import("../policy.mjs");
  const { createAuth } = await import("../auth-config.mjs");
  const { createAuthHTTPServer } = await import("../server-core.mjs");

  const adminPool = new Pool({ connectionString: testDatabaseURL, max: 2 });
  assert.match((await adminPool.query("SELECT current_database() AS name")).rows[0].name, /test|disposable/iu);
  const schemaName = "abz_google_test_" + randomUUID().replaceAll("-", "");
  await adminPool.query("CREATE SCHEMA \"" + schemaName + "\"");
  const pool = new Pool({ connectionString: testDatabaseURL, options: "-c search_path=" + schemaName, max: 4 });
  const identityLockPool = new Pool({ connectionString: testDatabaseURL, options: "-c search_path=" + schemaName, max: 2 });
  const env = {
    APP_ENV: "test",
    AUTH_MODE: "better_auth",
    DATABASE_URL: testDatabaseURL,
    AUTH_SERVICE_SECRET: "test-service-secret-" + "x".repeat(32),
    BETTER_AUTH_SECRET: "test-better-auth-secret-" + "y".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
    GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret-value",
  };
  const config = resolveMode(env);
  const migrationDir = new URL("../../portal/server/migrations/", import.meta.url);
  for (const name of (await readdir(migrationDir)).filter((entry) => entry.endsWith(".sql")).sort()) {
    await pool.query(await readFile(new URL(name, migrationDir), "utf8"));
  }
  await pool.query("INSERT INTO auth_runtime_state (singleton, mode) VALUES (true, 'better_auth')");

  // Google stand-in: the token endpoint echoes the code as access token; userinfo maps it to a profile.
  const profiles = new Map();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input?.url ?? input).startsWith("https://oauth2.googleapis.com/token")) {
      const code = new URLSearchParams(String(init.body)).get("code");
      return Response.json({ access_token: code, refresh_token: "refresh-" + code, id_token: "id-" + code, token_type: "Bearer", expires_in: 3600 });
    }
    return realFetch(input, init);
  };
  const testGoogleOptions = {
    getUserInfo: async ({ accessToken }) => {
      const profile = profiles.get(accessToken);
      return profile ? { user: { id: profile.sub, email: profile.email, name: "Google", emailVerified: true }, data: profile } : null;
    },
  };

  const suffix = randomUUID().slice(0, 8);
  const people = Object.fromEntries(["alice", "bob", "carl"].map((name) => [name, { id: randomUUID(), email: name + "-" + suffix + "@example.org" }]));
  const captures = [];
  let server;
  try {
    for (const [name, person] of Object.entries(people)) {
      await pool.query(
        `INSERT INTO users (id, subject, name, role, admitted, cohort_member, login_email, email_verified, login_enabled)
         VALUES ($1, NULL, $2, 'student', true, true, $3, false, true)`,
        [person.id, "Synthetic " + name, person.email],
      );
    }
    const { auth, hasSessionAccess, google } = await createAuth({ mode: "better_auth", pool, env, testGoogleOptions, testSendMagicLink: async (message) => captures.push(message) });
    assert.equal(google, true);
    server = createAuthHTTPServer({ auth, pool, identityLockPool, mode: "better_auth", authOrigin: config.authOrigin, serviceSecret: env.AUTH_SERVICE_SECRET, hasSessionAccess, google });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const serviceURL = "http://127.0.0.1:" + server.address().port;
    const headers = { origin: config.authOrigin, "content-type": "application/json", "x-forwarded-for": "192.0.2.78" };
    const post = (path, jar, body) => realFetch(serviceURL + "/api/auth/" + path, { method: "POST", redirect: "manual", headers: { ...headers, ...(jar ? { cookie: cookieOf(jar) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const get = (path, jar) => realFetch(serviceURL + "/api/auth/" + path, { redirect: "manual", headers: { "x-forwarded-for": "192.0.2.78", ...(jar ? { cookie: cookieOf(jar) } : {}) } });
    const sessionFor = async (jar) => {
      const response = await realFetch(serviceURL + "/internal/session", { headers: { cookie: cookieOf(jar), authorization: "Bearer " + env.AUTH_SERVICE_SECRET } });
      return response.status === 200 ? (await response.json()).user_id : null;
    };
    const login = async (person) => {
      const before = captures.length;
      assert.equal((await realFetch(serviceURL + "/api/auth/sign-in/magic-link", { method: "POST", headers, body: JSON.stringify({ email: person.email }) })).status, 200);
      const token = new URL(captures[before].url).hash.slice(1);
      const confirmed = await realFetch(serviceURL + "/api/auth/magic-link/confirm", { method: "POST", headers, body: JSON.stringify({ token }) });
      assert.equal(confirmed.status, 204);
      const jar = new Map();
      absorb(jar, confirmed);
      return jar;
    };
    // Runs one round trip through "Google" and returns the final redirect target.
    const viaGoogle = async (start, jar, profile) => {
      assert.equal(start.status, 200);
      const { url } = await start.json();
      const authorization = new URL(url);
      assert.equal(authorization.origin, "https://accounts.google.com");
      assert.equal(authorization.searchParams.get("redirect_uri"), config.authOrigin + "/api/auth/callback/google");
      absorb(jar, start);
      const code = "code-" + randomUUID();
      profiles.set(code, profile);
      const back = await get("callback/google?code=" + code + "&state=" + encodeURIComponent(authorization.searchParams.get("state")) + "&error_description=leak", jar);
      assert.equal(back.status, 303);
      absorb(jar, back);
      return back.headers.get("location");
    };
    const signInWithGoogle = async (profile) => {
      await pool.query("DELETE FROM auth_rate_limits"); // Better Auth allows few /sign-in/* calls per IP and window
      const jar = new Map();
      const location = await viaGoogle(await post("sign-in/social", null, { provider: "github", requestSignUp: true, callbackURL: "https://evil.example" }), jar, profile);
      return { jar, location };
    };
    const googleRows = async (userId) => (await pool.query("SELECT account_id, access_token, refresh_token, id_token FROM auth_accounts WHERE user_id = $1 AND provider_id = 'google'", [userId])).rows;
    const userCount = async () => Number((await pool.query("SELECT count(*) FROM users")).rows[0].count);

    // Unknown Google account: no user, no session. A matching email does not link implicitly. Same answer for both.
    const users = await userCount();
    const stranger = await signInWithGoogle({ sub: "google-stranger", email: "stranger-" + suffix + "@gmail.com", email_verified: true });
    assert.equal(stranger.location, LOGIN_FAILED);
    assert.equal(await userCount(), users, "no signup");
    const sameEmail = await signInWithGoogle({ sub: "google-bob", email: people.bob.email, email_verified: true });
    assert.equal(sameEmail.location, LOGIN_FAILED, "unknown and unlinked look identical");
    assert.equal(await sessionFor(sameEmail.jar), null);
    assert.equal((await googleRows(people.bob.id)).length, 0, "no implicit linking by email");

    // Account routes need a session; linking is same-origin only.
    assert.equal((await post("link-social")).status, 401);
    assert.equal((await get("list-accounts")).status, 401);
    const alice = await login(people.alice);
    assert.equal((await realFetch(serviceURL + "/api/auth/link-social", { method: "POST", headers: { ...headers, origin: "https://evil.example", cookie: cookieOf(alice) } })).status, 403);

    // A stale session cannot link.
    await pool.query("UPDATE auth_sessions SET created_at = now() - interval '2 hours' WHERE user_id = $1", [people.alice.id]);
    const stale = await post("link-social", alice);
    assert.equal(stale.status, 403);
    assert.deepEqual(await stale.json(), { error: "session_not_fresh" });
    await pool.query("UPDATE auth_sessions SET created_at = now() WHERE user_id = $1", [people.alice.id]);

    // Explicit link with a different Google address; tokens are not stored.
    const aliceGoogle = { sub: "google-alice", email: "alice.private-" + suffix + "@gmail.com", email_verified: true };
    assert.equal(await viaGoogle(await post("link-social", alice, { provider: "github", callbackURL: "https://evil.example" }), alice, aliceGoogle), "/einstellungen?google=linked");
    assert.deepEqual(await googleRows(people.alice.id), [{ account_id: "google-alice", access_token: null, refresh_token: null, id_token: null }]);
    const listed = await get("list-accounts", alice);
    const accounts = await listed.json();
    assert.equal(accounts.length, 1);
    assert.deepEqual(Object.keys(accounts[0]).sort(), ["created_at", "id"]);

    // The binding signs in; a second person cannot take the same Google account.
    const signedIn = await signInWithGoogle(aliceGoogle);
    assert.equal(signedIn.location, "/");
    assert.equal(await sessionFor(signedIn.jar), people.alice.id);
    const bob = await login(people.bob);
    assert.equal(await viaGoogle(await post("link-social", bob), bob, aliceGoogle), "/einstellungen?google=failed");
    assert.equal((await googleRows(people.bob.id)).length, 0);

    // A link started before revocation cannot finish afterwards.
    const carl = await login(people.carl);
    const started = await post("link-social", carl);
    await pool.query("UPDATE users SET login_enabled = false WHERE id = $1", [people.carl.id]);
    assert.equal(await viaGoogle(started, carl, { sub: "google-carl", email: people.carl.email, email_verified: true }), "/einstellungen?google=failed");
    assert.equal((await googleRows(people.carl.id)).length, 0);

    // A disabled or unadmitted holder of a binding gets no session.
    await pool.query("UPDATE users SET admitted = false WHERE id = $1", [people.alice.id]);
    assert.equal((await signInWithGoogle(aliceGoogle)).location, LOGIN_FAILED);
    await pool.query("UPDATE users SET admitted = true WHERE id = $1", [people.alice.id]);

    // Unlink needs a fresh session and only touches the caller's own Google bindings.
    const fresh = await login(people.alice);
    assert.equal((await post("unlink-account", bob, { id: accounts[0].id })).status, 404);
    assert.equal((await post("unlink-account", fresh, { id: accounts[0].id })).status, 204);
    assert.equal((await googleRows(people.alice.id)).length, 0);
    assert.equal((await signInWithGoogle(aliceGoogle)).location, LOGIN_FAILED);

    // A login email change deletes the binding.
    const again = await login(people.alice);
    assert.equal(await viaGoogle(await post("link-social", again), again, aliceGoogle), "/einstellungen?google=linked");
    await pool.query("UPDATE users SET login_email = $2 WHERE id = $1", [people.alice.id, "alice-new-" + suffix + "@example.org"]);
    assert.equal((await googleRows(people.alice.id)).length, 0);
    assert.equal((await signInWithGoogle(aliceGoogle)).location, LOGIN_FAILED);

    // Without credentials the routes stay outside the allowlist.
    const plain = createAuthHTTPServer({ auth, pool, identityLockPool, mode: "better_auth", authOrigin: config.authOrigin, serviceSecret: env.AUTH_SERVICE_SECRET, hasSessionAccess });
    await new Promise((resolve) => plain.listen(0, "127.0.0.1", resolve));
    const plainURL = "http://127.0.0.1:" + plain.address().port;
    assert.equal((await realFetch(plainURL + "/api/auth/sign-in/social", { method: "POST", headers })).status, 404);
    assert.ok(!(await (await realFetch(plainURL + "/auth/login")).text()).includes("Mit Google anmelden"));
    await new Promise((resolve) => plain.close(resolve));
    assert.ok((await (await realFetch(serviceURL + "/auth/login")).text()).includes("Mit Google anmelden"));
  } finally {
    globalThis.fetch = realFetch;
    if (server) await new Promise((resolve) => server.close(resolve));
    await identityLockPool.end();
    await pool.end();
    await adminPool.query("DROP SCHEMA IF EXISTS \"" + schemaName + "\" CASCADE").catch(() => {});
    await adminPool.end();
  }
});
