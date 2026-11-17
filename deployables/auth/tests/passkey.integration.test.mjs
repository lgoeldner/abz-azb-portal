import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const testDatabaseURL = process.env.TEST_DATABASE_URL;
const optIn = process.env.TEST_DATABASE_DISPOSABLE === "YES";
const skipReason = !testDatabaseURL
  ? "TEST_DATABASE_URL is unset; passkey integration checks skipped"
  : !optIn
    ? "Set TEST_DATABASE_DISPOSABLE=YES only for a disposable PostgreSQL database"
    : false;

// Minimal CBOR (unsigned/negative ints, byte strings, text, maps) for the attestation object and COSE key.
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
}
function cbor(value) {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === "string") {
    const bytes = Buffer.from(value);
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}
const b64url = (buffer) => Buffer.from(buffer).toString("base64url");
const sha256 = (data) => createHash("sha256").update(data).digest();

// Software ES256 authenticator with a discoverable credential.
function createAuthenticator(origin, rpId) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(32);
  let counter = 0;
  let userHandle = "";
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    register(options) {
      userHandle = options.user.id;
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]);
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([sha256(rpId), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), idLength, credentialId, cbor(cose)]);
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64url(clientData("webauthn.create", options.challenge)),
          attestationObject: b64url(cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))),
          transports: ["internal"],
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
    sign(options) {
      counter += 1;
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const authData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), count]);
      const data = clientData("webauthn.get", options.challenge);
      const signature = createSign("sha256").update(Buffer.concat([authData, sha256(data)])).sign(privateKey);
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: "public-key",
        response: { clientDataJSON: b64url(data), authenticatorData: b64url(authData), signature: b64url(signature), userHandle },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
  };
}

function absorb(jar, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";", 1);
    const split = pair.indexOf("=");
    const name = pair.slice(0, split);
    const value = pair.slice(split + 1);
    if (value) jar.set(name, value); else jar.delete(name);
  }
}
const cookieOf = (jar) => [...jar].map(([name, value]) => name + "=" + value).join("; ");

function client(serviceURL, origin, serviceSecret) {
  const baseHeaders = { origin: origin, "content-type": "application/json", "x-forwarded-for": "192.0.2.77" };
  const send = (method, path, { jar, body, headers = {} } = {}) => fetch(serviceURL + "/api/auth/passkey/" + path, {
    method,
    headers: { ...baseHeaders, ...(jar ? { cookie: cookieOf(jar) } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
  const sessionFor = async (jar) => {
    const response = await fetch(serviceURL + "/internal/session", { headers: { cookie: cookieOf(jar), authorization: "Bearer " + serviceSecret } });
    return response.status === 200 ? (await response.json()).user_id : null;
  };
  const enroll = async (jar, authenticator, extra = {}) => {
    const options = await send("POST", "generate-register-options", { jar });
    assert.equal(options.status, 200);
    const optionBody = await options.json();
    absorb(jar, options);
    const verified = await send("POST", "verify-registration", { jar, body: { response: authenticator.register(optionBody), ...extra } });
    return { optionBody, verified };
  };
  const signIn = async (authenticator, extra = {}) => {
    const jar = new Map();
    const options = await send("POST", "generate-authenticate-options");
    assert.equal(options.status, 200);
    const optionBody = await options.json();
    absorb(jar, options);
    const assertion = authenticator.sign(optionBody);
    const verified = await send("POST", "verify-authentication", { jar, body: { response: assertion, ...extra } });
    return { jar, optionBody, assertion, verified };
  };
  return { baseHeaders, send, sessionFor, enroll, signIn };
}

// Isolated schema with all portal migrations applied, in the given auth mode.
async function openSchema(mode) {
  const { Pool } = await import("pg");
  const { resolveMode } = await import("../policy.mjs");
  const adminPool = new Pool({ connectionString: testDatabaseURL, max: 2, application_name: "abizeitbetrug-passkey-test-admin" });
  const dbName = (await adminPool.query("SELECT current_database() AS name")).rows[0].name;
  assert.match(dbName, /test|disposable/iu, "TEST_DATABASE_URL must point at a disposable test database");
  const schemaName = "abz_passkey_test_" + randomUUID().replaceAll("-", "");
  await adminPool.query("CREATE SCHEMA \"" + schemaName + "\"");
  const pool = new Pool({ connectionString: testDatabaseURL, options: "-c search_path=" + schemaName, max: 4, application_name: "abizeitbetrug-passkey-test" });
  const identityLockPool = new Pool({ connectionString: testDatabaseURL, options: "-c search_path=" + schemaName, max: 2, application_name: "abizeitbetrug-passkey-test-identity-lock" });
  const env = {
    APP_ENV: mode === "mock" ? "development" : "test",
    AUTH_MODE: mode,
    DATABASE_URL: testDatabaseURL,
    AUTH_SERVICE_SECRET: "test-service-secret-" + "x".repeat(32),
    BETTER_AUTH_SECRET: "test-better-auth-secret-" + "y".repeat(32),
    MOCK_AUTH_SECRET: "dev-only-mock-secret-at-least-32-bytes",
    BETTER_AUTH_URL: "http://localhost:3000",
  };
  const config = resolveMode(env);
  const migrationDir = new URL("../../portal/server/migrations/", import.meta.url);
  for (const name of (await readdir(migrationDir)).filter((entry) => entry.endsWith(".sql")).sort()) {
    await pool.query(await readFile(new URL(name, migrationDir), "utf8"));
  }
  await pool.query("INSERT INTO auth_runtime_state (singleton, mode) VALUES (true, $1)", [mode]);
  const close = async () => {
    await identityLockPool.end();
    await pool.end();
    await adminPool.query("DROP SCHEMA IF EXISTS \"" + schemaName + "\" CASCADE").catch(() => {});
    await adminPool.end();
  };
  return { pool, identityLockPool, env, config, close };
}

// Every inline page script must at least parse.
function assertScriptsParse(html) {
  const scripts = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/gu)];
  assert.ok(scripts.length > 0);
  for (const [, code] of scripts) new Function(code);
}

test("passkeys register, sign in, and stay inside the allowlist and identity rules", { skip: skipReason }, async () => {
  const { createAuth } = await import("../auth-config.mjs");
  const { createAuthHTTPServer } = await import("../server-core.mjs");

  const { pool, identityLockPool, env, config, close } = await openSchema("better_auth");
  const suffix = randomUUID().slice(0, 8);
  const people = Object.fromEntries(["alice", "bob", "dora", "emil"].map((name) => [name, { id: randomUUID(), email: name + "-" + suffix + "@example.org" }]));
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
    const { auth, hasSessionAccess } = await createAuth({ mode: "better_auth", pool, env, testSendMagicLink: async (message) => captures.push(message) });
    server = createAuthHTTPServer({ auth, pool, identityLockPool, mode: "better_auth", authOrigin: config.authOrigin, serviceSecret: env.AUTH_SERVICE_SECRET, hasSessionAccess });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const serviceURL = "http://127.0.0.1:" + server.address().port;
    const { baseHeaders, send, sessionFor, enroll, signIn } = client(serviceURL, config.authOrigin, env.AUTH_SERVICE_SECRET);
    const login = async (person) => {
      const before = captures.length;
      const requested = await fetch(serviceURL + "/api/auth/sign-in/magic-link", { method: "POST", headers: baseHeaders, body: JSON.stringify({ email: person.email }) });
      assert.equal(requested.status, 200);
      assert.equal(captures.length, before + 1);
      const token = new URL(captures[before].url).hash.slice(1);
      const confirmed = await fetch(serviceURL + "/api/auth/magic-link/confirm", { method: "POST", headers: baseHeaders, body: JSON.stringify({ token }) });
      assert.equal(confirmed.status, 204);
      const jar = new Map();
      absorb(jar, confirmed);
      return jar;
    };
    const passkeyCount = async (userId) => Number((await pool.query("SELECT count(*) FROM auth_passkeys WHERE user_id = $1", [userId])).rows[0].count);
    const sessionCount = async (userId) => Number((await pool.query("SELECT count(*) FROM auth_sessions WHERE user_id = $1", [userId])).rows[0].count);

    // Enrollment: needs a session, uses discoverable credentials, and ignores extra plugin options.
    assert.equal((await send("POST", "generate-register-options")).status, 401);
    const alice = people.alice;
    const aliceJar = await login(alice);
    const aliceKey = createAuthenticator(config.authOrigin, "localhost");
    const sessionsBefore = await sessionCount(alice.id);
    const { optionBody, verified } = await enroll(aliceJar, aliceKey, { name: "evil-name", createSession: true });
    assert.equal(optionBody.rp.id, "localhost");
    assert.equal(optionBody.authenticatorSelection.residentKey, "required");
    assert.equal(verified.status, 204);
    assert.equal(await verified.text(), "");
    assert.deepEqual(verified.headers.getSetCookie(), [], "createSession is not passed through");
    assert.equal(await sessionCount(alice.id), sessionsBefore);
    assert.equal(await passkeyCount(alice.id), 1);
    const stored = (await pool.query("SELECT name, public_key FROM auth_passkeys WHERE user_id = $1", [alice.id])).rows[0];
    assert.equal(stored.name, null, "a client-supplied name is not stored");

    // The list exposes id, name and creation time only.
    const listed = await send("GET", "list-user-passkeys", { jar: aliceJar });
    assert.equal(listed.status, 200);
    const listText = await listed.text();
    const list = JSON.parse(listText);
    assert.equal(list.length, 1);
    assert.deepEqual(Object.keys(list[0]).sort(), ["created_at", "id", "name"]);
    assert.ok(!listText.includes(stored.public_key), "public keys are never listed");
    assert.equal((await send("GET", "list-user-passkeys")).status, 401);

    // Sign-in with the discoverable credential: no session needed, no profile in the response.
    const signedIn = await signIn(aliceKey, { createSession: false, user: "x" });
    assert.equal(signedIn.optionBody.allowCredentials?.length ?? 0, 0);
    assert.equal(signedIn.verified.status, 204);
    assert.equal(await signedIn.verified.text(), "");
    absorb(signedIn.jar, signedIn.verified);
    assert.equal(await sessionFor(signedIn.jar), alice.id);
    // A captured assertion cannot be replayed: the challenge is single-use.
    const replay = await send("POST", "verify-authentication", { jar: signedIn.jar, body: { response: signedIn.assertion } });
    assert.equal(replay.status, 401);
    assert.deepEqual(await replay.json(), { error: "invalid_passkey" });
    assert.equal((await send("POST", "verify-authentication", { body: { response: "nope" } })).status, 401);
    assert.equal((await send("POST", "verify-authentication", { body: {} })).status, 401);

    // Another user cannot delete the passkey.
    const bobJar = await login(people.bob);
    const foreignDelete = await send("POST", "delete-passkey", { jar: bobJar, body: { id: list[0].id } });
    assert.equal(foreignDelete.status, 404);
    assert.deepEqual(await foreignDelete.json(), { error: "not_found" });
    assert.equal(await passkeyCount(alice.id), 1);
    assert.equal((await send("POST", "delete-passkey", { jar: bobJar, body: { id: "not-a-uuid" } })).status, 404);
    assert.equal((await send("POST", "delete-passkey", { body: { id: list[0].id } })).status, 401);

    // Origin and allowlist.
    for (const path of ["generate-register-options", "verify-registration", "generate-authenticate-options", "verify-authentication", "delete-passkey"]) {
      for (const headers of [{ origin: "https://evil.example" }, { origin: "" }]) {
        const denied = await send("POST", path, { jar: aliceJar, body: { response: {}, id: list[0].id }, headers });
        assert.equal(denied.status, 403, path);
        assert.deepEqual(await denied.json(), { error: "origin_denied" });
      }
    }
    assert.equal((await send("POST", "delete-passkey", { jar: aliceJar, body: { id: list[0].id }, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
    assert.equal(await passkeyCount(alice.id), 1);
    for (const [method, path] of [["POST", "update-passkey"], ["POST", "other"], ["POST", "constructor"], ["GET", "generate-register-options"], ["POST", "list-user-passkeys"], ["GET", "delete-passkey"]]) {
      const response = await send(method, path, { jar: aliceJar, ...(method === "POST" ? { body: { id: list[0].id, name: "renamed" } } : {}) });
      assert.equal(response.status, 404, method + " " + path);
      assert.deepEqual(await response.json(), { error: "not_found" });
    }
    assert.equal((await pool.query("SELECT name FROM auth_passkeys WHERE user_id = $1", [alice.id])).rows[0].name, null);

    // Disabled and non-admitted users are refused at passkey sign-in, and recover with the flags.
    const dora = people.dora;
    const doraKey = createAuthenticator(config.authOrigin, "localhost");
    const doraEnrollment = await enroll(await login(dora), doraKey);
    assert.equal(doraEnrollment.verified.status, 204);
    for (const change of ["login_enabled = false", "admitted = false"]) {
      await pool.query("UPDATE users SET " + change + " WHERE id = $1", [dora.id]);
      const refused = await signIn(doraKey);
      assert.equal(refused.verified.status, 401, change);
      assert.deepEqual(await refused.verified.json(), { error: "invalid_passkey" });
      assert.deepEqual(refused.verified.headers.getSetCookie(), []);
      await pool.query("UPDATE users SET login_enabled = true, admitted = true WHERE id = $1", [dora.id]);
    }
    const restored = await signIn(doraKey);
    assert.equal(restored.verified.status, 204);

    // A login email change revokes the passkeys.
    const emil = people.emil;
    const emilKey = createAuthenticator(config.authOrigin, "localhost");
    assert.equal((await enroll(await login(emil), emilKey)).verified.status, 204);
    assert.equal((await signIn(emilKey)).verified.status, 204);
    await pool.query("SELECT portal_set_user_email($1, $2)", [emil.id, "moved-" + suffix + "@example.org"]);
    assert.equal(await passkeyCount(emil.id), 0);
    assert.equal((await signIn(emilKey)).verified.status, 401);

    // Enrollment needs a recent login; the existing list and delete still work.
    await pool.query("UPDATE auth_sessions SET created_at = now() - interval '2 hours' WHERE user_id = $1", [alice.id]);
    const staleOptions = await send("POST", "generate-register-options", { jar: aliceJar });
    assert.equal(staleOptions.status, 403);
    assert.deepEqual(await staleOptions.json(), { error: "session_not_fresh" });
    const staleVerify = await send("POST", "verify-registration", { jar: aliceJar, body: { response: createAuthenticator(config.authOrigin, "localhost").register({ user: { id: "x" }, challenge: "x" }) } });
    assert.equal(staleVerify.status, 403);
    assert.equal(await passkeyCount(alice.id), 1);

    // Owner can delete; the passkey then stops working.
    const deleted = await send("POST", "delete-passkey", { jar: aliceJar, body: { id: list[0].id } });
    assert.equal(deleted.status, 204);
    assert.equal(await passkeyCount(alice.id), 0);
    assert.equal((await signIn(aliceKey)).verified.status, 401);

    // The login page offers the native passkey button (the mock picker has none, see the mock test).
    const html = await (await fetch(serviceURL + "/auth/login")).text();
    assert.match(html, /Mit Passkey anmelden/u);
    assert.match(html, /parseRequestOptionsFromJSON/u);
    assertScriptsParse(html);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await close();
  }
});

test("the development mock offers no passkeys", { skip: skipReason }, async () => {
  const { createAuth } = await import("../auth-config.mjs");
  const { createAuthHTTPServer } = await import("../server-core.mjs");
  const { testUtils } = await import("better-auth/plugins");
  const { pool, identityLockPool, env, config, close } = await openSchema("mock");
  let server;
  try {
    const runtime = await createAuth({ mode: "mock", pool, env, extraPlugins: [testUtils()] });
    server = createAuthHTTPServer({ getAuthRuntime: async () => ({ auth: runtime.auth, hasSessionAccess: runtime.hasSessionAccess }), pool, identityLockPool, mode: "mock", authOrigin: config.authOrigin, serviceSecret: env.AUTH_SERVICE_SECRET });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const serviceURL = "http://127.0.0.1:" + server.address().port;
    const route = await fetch(serviceURL + "/api/auth/passkey/generate-authenticate-options", { method: "POST", headers: { origin: config.authOrigin } });
    assert.equal(route.status, 404);
    const page = await (await fetch(serviceURL + "/auth/login")).text();
    assert.doesNotMatch(page, /Passkey/u);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await close();
  }
});
