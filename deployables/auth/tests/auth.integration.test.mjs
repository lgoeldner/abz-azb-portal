import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const testDatabaseURL = process.env.TEST_DATABASE_URL;
const optIn = process.env.TEST_DATABASE_DISPOSABLE === "YES";
const skipReason = !testDatabaseURL
  ? "TEST_DATABASE_URL is unset; Better Auth integration checks skipped"
  : !optIn
    ? "Set TEST_DATABASE_DISPOSABLE=YES only for a disposable PostgreSQL database"
    : false;

test("magic links are allowlisted, single-use, and never expose a portal profile", { skip: skipReason }, async (t) => {
  const { Pool } = await import("pg");
  const { createAuth } = await import("../auth-config.mjs");
  const { createAuthHTTPServer } = await import("../server-core.mjs");
  const { resolveMode } = await import("../policy.mjs");

  const adminPool = new Pool({ connectionString: testDatabaseURL, max: 2, application_name: "abizeitbetrug-auth-test-admin" });
  const dbName = (await adminPool.query("SELECT current_database() AS name")).rows[0].name;
  assert.match(dbName, /test|disposable/iu, "TEST_DATABASE_URL must point at a disposable test database");
  const schemaName = "abz_auth_test_" + randomUUID().replaceAll("-", "");
  await adminPool.query("CREATE SCHEMA \"" + schemaName + "\"");
  const pool = new Pool({
    connectionString: testDatabaseURL,
    options: "-c search_path=" + schemaName,
    max: 4,
    application_name: "abizeitbetrug-auth-test",
  });
  const identityLockPool = new Pool({
    connectionString: testDatabaseURL,
    options: "-c search_path=" + schemaName,
    max: 2,
    application_name: "abizeitbetrug-auth-test-identity-lock",
  });

  const env = {
    APP_ENV: "test",
    AUTH_MODE: "better_auth",
    DATABASE_URL: testDatabaseURL,
    AUTH_SERVICE_SECRET: "test-service-secret-" + "x".repeat(32),
    BETTER_AUTH_SECRET: "test-better-auth-secret-" + "y".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
  };
  const config = resolveMode(env);
  const migrations = [
    "001_initial.sql",
    "002_poll_timeline.sql",
    "003_user_created_at.sql",
    "004_polls_become_categories.sql",
    "005_people_multiselect.sql",
    "006_proposal_multiselect.sql",
    "007_word_polls.sql",
    "008_collection_repeatability.sql",
    "009_photo_captions.sql",
    "010_better_auth.sql",
    "011_email.sql",
    "012_user_provisioning.sql",
  ];
  for (const name of migrations) {
    const sql = await readFile(new URL("../../portal/server/migrations/" + name, import.meta.url), "utf8");
    await pool.query(sql);
  }
  await pool.query("INSERT INTO auth_runtime_state (singleton, mode) VALUES (true, 'better_auth')");

  const userId = randomUUID();
  const disabledUserId = randomUUID();
  const raceUserId = randomUUID();
  const reassignmentUserId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const email = "auth-test-" + suffix + "@example.org";
  const disabledEmail = "auth-disabled-" + suffix + "@example.org";
  const raceEmail = "auth-race-" + suffix + "@example.org";
  const captures = [];
  const serviceFailures = [];
  let pauseVerification = false;
  let verificationPaused;
  let resumeVerification;
  const paused = new Promise((resolve) => { verificationPaused = resolve; });
  const release = new Promise((resolve) => { resumeVerification = resolve; });
  let server;

  try {
    await pool.query(
      `INSERT INTO users (id, subject, name, role, admitted, cohort_member, login_email, email_verified, login_enabled)
       VALUES ($1, NULL, 'Synthetic auth user', 'student', true, true, $2, false, true),
              ($3, NULL, 'Synthetic disabled user', 'student', true, true, $4, false, false),
              ($5, NULL, 'Synthetic race user', 'student', true, true, $6, false, true),
              ($7, NULL, 'Synthetic reassignment user', 'student', true, true, NULL, false, true)`,
      [userId, email, disabledUserId, disabledEmail, raceUserId, raceEmail, reassignmentUserId],
    );

    const { auth, hasSessionAccess } = await createAuth({
      mode: "better_auth",
      pool,
      env,
      testSendMagicLink: async (message) => captures.push(message),
    });
    server = createAuthHTTPServer({
      auth,
      pool,
      identityLockPool,
      mode: "better_auth",
      authOrigin: config.authOrigin,
      serviceSecret: env.AUTH_SERVICE_SECRET,
      hasSessionAccess,
      beforeMagicLinkVerify: async () => {
        if (!pauseVerification) return;
        pauseVerification = false;
        verificationPaused();
        await release;
      },
      onTestFailure: (step, error) => serviceFailures.push({ step, name: error?.name, code: error?.code, message: error?.message }),
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const serviceURL = "http://127.0.0.1:" + address.port;
    const headers = {
      origin: config.authOrigin,
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.15",
    };

    const requestLink = async (addressValue) => fetch(serviceURL + "/api/auth/sign-in/magic-link", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: addressValue, callbackURL: "https://example.net/steal" }),
    });
    const known = await requestLink(email.toUpperCase());
    assert.equal(known.status, 200, JSON.stringify(serviceFailures));
    assert.deepEqual(await known.json(), { status: true });
    assert.equal(known.headers.get("set-cookie"), null);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].user_id, userId);
    assert.equal(captures[0].email, email);
    assert.match(captures[0].url, /^http:\/\/localhost:3000\/auth\/magic-link#/u);

    const unknown = await requestLink("not-provisioned-" + suffix + "@example.org");
    const disabled = await requestLink(disabledEmail);
    assert.equal(unknown.status, known.status);
    assert.deepEqual(await unknown.json(), { status: true });
    assert.equal(disabled.status, known.status);
    assert.deepEqual(await disabled.json(), { status: true });
    assert.equal(captures.length, 1, "unknown and disabled users receive no mail handoff");

    const token = new URL(captures[0].url).hash.slice(1);
    const directGet = await fetch(serviceURL + "/api/auth/magic-link/verify?token=" + token, {
      headers: { origin: config.authOrigin },
      redirect: "manual",
    });
    assert.equal(directGet.status, 404, "scanner GET cannot consume the token");

    await pool.query("UPDATE users SET login_enabled = false WHERE id = $1", [userId]);
    const denied = await fetch(serviceURL + "/api/auth/magic-link/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ token }),
      redirect: "manual",
    });
    assert.equal(denied.status, 401, "session creation rechecks current login_enabled");
    assert.equal(denied.headers.get("set-cookie"), null);

    await pool.query("UPDATE users SET login_enabled = true WHERE id = $1", [userId]);
    const nextLink = await requestLink(email);
    assert.equal(nextLink.status, 200);
    const nextToken = new URL(captures[1].url).hash.slice(1);
    const confirmed = await fetch(serviceURL + "/api/auth/magic-link/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: nextToken }),
      redirect: "manual",
    });
    assert.equal(confirmed.status, 204);
    const setCookies = confirmed.headers.getSetCookie();
    assert.ok(setCookies.length > 0);
    const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");

    const internalMissingBearer = await fetch(serviceURL + "/internal/session", { headers: { cookie } });
    assert.equal(internalMissingBearer.status, 401);
    const internal = await fetch(serviceURL + "/internal/session", {
      headers: { cookie, authorization: "Bearer " + env.AUTH_SERVICE_SECRET },
    });
    assert.equal(internal.status, 200);
    const sessionInfo = await internal.json();
    assert.deepEqual(Object.keys(sessionInfo).sort(), ["expires_at", "mode", "session_id", "user_id"]);
    assert.equal(sessionInfo.user_id, userId);
    assert.equal(sessionInfo.mode, "better_auth");
    await pool.query("UPDATE auth_runtime_state SET mode = 'mock' WHERE singleton = true");
    const wrongMode = await fetch(serviceURL + "/internal/session", {
      headers: { cookie, authorization: "Bearer " + env.AUTH_SERVICE_SECRET },
    });
    assert.equal(wrongMode.status, 503, "sessions cannot be used by a service configured for a different runtime mode");
    await pool.query("UPDATE auth_runtime_state SET mode = 'better_auth' WHERE singleton = true");

    const replay = await fetch(serviceURL + "/api/auth/magic-link/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: nextToken }),
      redirect: "manual",
    });
    assert.equal(replay.status, 401, "the library token is single-use");

    const signup = await fetch(serviceURL + "/api/auth/sign-up/email", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "new-" + suffix + "@example.org", name: "No signup", password: "long-test-password" }),
    });
    assert.equal(signup.status, 404, "signup endpoint is not public");
    const profile = await fetch(serviceURL + "/api/auth/get-session", { headers: { origin: config.authOrigin, cookie } });
    assert.equal(profile.status, 404, "raw auth session/profile endpoint is not public");

    const raceLink = await requestLink(raceEmail);
    assert.equal(raceLink.status, 200);
    const staleAddressLink = await requestLink(raceEmail);
    assert.equal(staleAddressLink.status, 200);
    assert.equal(captures.length, 4);
    const raceToken = new URL(captures[2].url).hash.slice(1);
    const staleAddressToken = new URL(captures[3].url).hash.slice(1);
    pauseVerification = true;
    const racingConfirmation = fetch(serviceURL + "/api/auth/magic-link/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: raceToken }),
      redirect: "manual",
    });
    await paused;
    let emailChangeFinished = false;
    const emailChange = pool.query("SELECT portal_set_user_email($1, $2)", [raceUserId, "changed-" + suffix + "@example.org"])
      .then((result) => { emailChangeFinished = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(emailChangeFinished, false, "supported identity changes wait while Better Auth redeems a magic link");
    resumeVerification();
    const raceConfirmation = await racingConfirmation;
    assert.equal(raceConfirmation.status, 204);
    const raceCookies = raceConfirmation.headers.getSetCookie();
    assert.ok(raceCookies.length > 0);
    await emailChange;
    const staleCookie = raceCookies.map((value) => value.split(";", 1)[0]).join("; ");
    const staleSession = await fetch(serviceURL + "/internal/session", {
      headers: { cookie: staleCookie, authorization: "Bearer " + env.AUTH_SERVICE_SECRET },
    });
    assert.equal(staleSession.status, 401, "the email-change revocation removes a session created during redemption");
    await assert.rejects(
      pool.query("SELECT portal_set_user_email($1, $2)", [reassignmentUserId, raceEmail]),
      (error) => error.code === "23514",
      "a link sent to the retired address cannot be reassigned to another person",
    );
    await pool.query("UPDATE retired_login_emails SET reusable_after = now() - interval '1 second' WHERE email = $1", [raceEmail]);
    await pool.query("SELECT portal_set_user_email($1, $2)", [reassignmentUserId, raceEmail]);
    const reassignedLink = await requestLink(raceEmail);
    assert.equal(reassignedLink.status, 200);
    assert.equal(captures.length, 5);
    assert.equal(captures[4].user_id, reassignmentUserId, "the current address owner receives new links");
    const oldAddressReplay = await fetch(serviceURL + "/api/auth/magic-link/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: staleAddressToken }),
      redirect: "manual",
    });
    assert.equal(oldAddressReplay.status, 401, "an old-address token cannot sign in the reassigned owner after quarantine expires");
    assert.equal(oldAddressReplay.headers.get("set-cookie"), null);
    const reassignedToken = new URL(captures[4].url).hash.slice(1);
    const reassignedConfirmation = await fetch(serviceURL + "/api/auth/magic-link/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: reassignedToken }),
      redirect: "manual",
    });
    assert.equal(reassignedConfirmation.status, 204);
    const reassignedCookie = reassignedConfirmation.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    const reassignedSession = await fetch(serviceURL + "/internal/session", {
      headers: { cookie: reassignedCookie, authorization: "Bearer " + env.AUTH_SERVICE_SECRET },
    });
    assert.equal(reassignedSession.status, 200);
    assert.equal((await reassignedSession.json()).user_id, reassignmentUserId);

    const concurrentLink = await requestLink(email);
    assert.equal(concurrentLink.status, 200);
    assert.equal(captures.length, 6);
    const concurrentToken = new URL(captures[5].url).hash.slice(1);
    const concurrentResponses = await Promise.all(Array.from({ length: 3 }, () => fetch(serviceURL + "/api/auth/magic-link/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: concurrentToken }),
      redirect: "manual",
    })));
    const concurrentSuccesses = concurrentResponses.filter((response) => response.status === 204);
    assert.equal(concurrentSuccesses.length, 1, "parallel redemption creates exactly one successful session");
    assert.ok(concurrentSuccesses[0].headers.getSetCookie().length > 0, "the winner receives the only session cookie");
    for (const response of concurrentResponses.filter((response) => response !== concurrentSuccesses[0])) {
      assert.equal(response.status, 401, "parallel replay is rejected");
      assert.equal(response.headers.get("set-cookie"), null, "rejected parallel replay receives no cookie");
    }

    const { testUtils } = await import("better-auth/plugins");
    await pool.query("UPDATE auth_runtime_state SET mode = 'mock' WHERE singleton = true");
    const mockEnv = {
      ...env,
      APP_ENV: "development",
      AUTH_MODE: "mock",
      MOCK_AUTH_SECRET: "dev-only-mock-secret-at-least-32-bytes",
      BETTER_AUTH_URL: "https://portal.example.org",
    };
    const mockRuntime = await createAuth({ mode: "mock", pool, env: mockEnv, extraPlugins: [testUtils()] });
    const mockLogin = await mockRuntime.context.test.login({ userId });
    assert.equal(mockLogin.cookies.find((cookie) => cookie.name.endsWith("session_token"))?.secure, true,
      "development HTTPS mock cookies retain the Secure attribute");
    const mockSession = await mockRuntime.auth.api.getSession({ headers: mockLogin.headers });
    assert.equal(mockSession?.user?.id, userId, "the mock login cookie verifies with MOCK_AUTH_SECRET");
  } finally {
    resumeVerification();
    if (server) await new Promise((resolve) => server.close(resolve));
    await identityLockPool.end();
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userId, disabledUserId, raceUserId, reassignmentUserId]]).catch(() => {});
    await pool.end();
    await adminPool.query("DROP SCHEMA IF EXISTS \"" + schemaName + "\" CASCADE").catch(() => {});
    await adminPool.end();
  }
});
