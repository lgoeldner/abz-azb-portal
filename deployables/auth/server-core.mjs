import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { hasServiceAuthorization, isUUID, normalizeEmail } from "./policy.mjs";

const BODY_LIMIT = 16 * 1024;
const IP_WINDOW_SECONDS = 60;
const IP_WINDOW_MAX = 10;
const EMAIL_WINDOW_SECONDS = 15 * 60;
const EMAIL_WINDOW_MAX = 3;
const PASSKEY_METHODS = {
  "generate-register-options": "POST",
  "verify-registration": "POST",
  "generate-authenticate-options": "POST",
  "verify-authentication": "POST",
  "list-user-passkeys": "GET",
  "delete-passkey": "POST",
};
const GOOGLE_ORIGIN = "https://accounts.google.com";
const SETTINGS_PATH = "/einstellungen";
const LOGIN_FAILED = "/auth/login?google=failed";
const FRESH_SESSION_MS = 60 * 60 * 1000; // session.freshAge in auth-config.mjs
// The callback calls Google while holding the global identity lock; a hanging Google must not block other logins.
const GOOGLE_CALLBACK_TIMEOUT_MS = 10_000;

export function createAuthHTTPServer({
  auth,
  getAuthRuntime,
  pool,
  identityLockPool,
  mode,
  authOrigin,
  serviceSecret,
  hasSessionAccess,
  mockHelpers,
  google = false,
  beforeMagicLinkVerify,
  onTestFailure,
}) {
  const origin = new URL(authOrigin).origin;
  const getRuntime = getAuthRuntime || (async () => ({ auth, hasSessionAccess, mockHelpers }));
  const server = createServer((req, res) => {
    void route(req, res).catch((error) => {
      if (error?.message === "body too large") return sendJSON(res, 413, { error: "too_large" });
      return sendJSON(res, 503, { error: "service_unavailable" });
    });
  });

  async function route(req, res) {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", origin);
    if (method === "GET" && url.pathname === "/healthz") {
      try {
        await pool.query("SELECT 1");
        return sendJSON(res, 200, { status: "ok" });
      } catch {
        return sendJSON(res, 503, { status: "unavailable" });
      }
    }

    if (method === "GET" && url.pathname === "/internal/session") {
      if (!hasServiceAuthorization(req.headers.authorization, serviceSecret)) {
        return sendJSON(res, 401, { error: "unauthorized" });
      }
      try {
        const runtimeConfig = await getRuntime();
        const runtime = await pool.query("SELECT mode FROM auth_runtime_state WHERE singleton = true");
        if (runtime.rowCount !== 1 || runtime.rows[0].mode !== mode) {
          return sendJSON(res, 503, { error: "auth_mode_unavailable" });
        }
        const cookie = req.headers.cookie;
        if (!cookie) return sendJSON(res, 401, { error: "unauthorized" });
        const sessionData = await runtimeConfig.auth.api.getSession({ headers: new Headers({ cookie }) });
        if (!sessionData?.session || !sessionData?.user) {
          return sendJSON(res, 401, { error: "unauthorized" });
        }
        if (!(await runtimeConfig.hasSessionAccess(sessionData.user.id))) {
          return sendJSON(res, 401, { error: "unauthorized" });
        }
        return sendJSON(res, 200, {
          user_id: sessionData.user.id,
          session_id: sessionData.session.id,
          expires_at: new Date(sessionData.session.expiresAt).toISOString(),
          mode,
        });
      } catch {
        return sendJSON(res, 503, { error: "auth_unavailable" });
      }
    }

    if (method === "GET" && url.pathname === "/auth/login") {
      return sendHTML(res, loginPage(mode, google));
    }
    if (method === "GET" && url.pathname === "/auth/magic-link") {
      return sendHTML(res, magicLinkPage());
    }

    if (mode === "mock" && (mockHelpers || getAuthRuntime) && method === "GET" && url.pathname === "/auth/mock-users") {
      try {
        const result = await pool.query(
          "SELECT id, name FROM users WHERE login_enabled = true ORDER BY name, id",
        );
        return sendJSON(res, 200, result.rows.map((row) => ({ id: row.id, name: row.name })));
      } catch {
        return sendJSON(res, 503, { error: "auth_unavailable" });
      }
    }

    if (mode === "mock" && (mockHelpers || getAuthRuntime) && method === "POST" && url.pathname === "/auth/mock-login") {
      if (!isSameOrigin(req, origin)) return sendJSON(res, 403, { error: "origin_denied" });
      const body = await readJSON(req);
      if (!isUUID(body?.user_id)) return sendJSON(res, 400, { error: "invalid_request" });
      try {
        const runtimeConfig = await getRuntime();
        const cookies = await withIdentityLock(identityLockPool, () => runtimeConfig.mockHelpers.login(body.user_id));
        if (!cookies?.length) return sendJSON(res, 401, { error: "login_unavailable" });
        return sendJSON(res, 303, null, { location: "/", setCookie: cookies.map(formatMockCookie) });
      } catch {
        return sendJSON(res, 401, { error: "login_unavailable" });
      }
    }

    if (method === "POST" && url.pathname === "/api/auth/sign-in/magic-link") {
      if (!isSameOrigin(req, origin)) return sendJSON(res, 403, { error: "origin_denied" });
      const requestStarted = Date.now();
      const body = await readJSON(req);
      const email = normalizeEmail(body?.email);
      if (!email) return sendJSON(res, 400, { error: "invalid_request" });
      let withinAddressLimit = false;
      try {
        withinAddressLimit = await consumeLoginLimits(pool, serviceSecret, email, getClientIP(req));
      } catch (error) {
        onTestFailure?.("email_rate_limit", error);
        await minimumDelay(requestStarted, 150);
        return sendJSON(res, 503, { error: "auth_unavailable" });
      }
      if (!withinAddressLimit) {
        await minimumDelay(requestStarted, 150);
        return sendJSON(res, 429, { status: true }, { "retry-after": "900" });
      }

      const headers = requestHeaders(req);
      headers.delete("cookie");
      headers.set("content-type", "application/json");
      const authRequest = new Request(origin + "/api/auth/sign-in/magic-link", {
        method: "POST",
        headers,
        body: JSON.stringify({ email, callbackURL: "/", errorCallbackURL: "/auth/login" }),
      });
      try {
        const runtimeConfig = await getRuntime();
        const response = await runtimeConfig.auth.handler(authRequest);
        await minimumDelay(requestStarted, 150);
        if (response.status === 429) return sendJSON(res, 429, { status: true }, { "retry-after": "900" });
        if (response.status >= 500) {
          onTestFailure?.("better_auth_response", new Error("status " + response.status));
          return sendJSON(res, 503, { error: "auth_unavailable" });
        }
        return sendJSON(res, 200, { status: true });
      } catch (error) {
        onTestFailure?.("better_auth_handler", error);
        await minimumDelay(requestStarted, 150);
        return sendJSON(res, 503, { error: "auth_unavailable" });
      }
    }

    if (method === "POST" && url.pathname === "/api/auth/magic-link/confirm") {
      if (!isSameOrigin(req, origin)) return sendJSON(res, 403, { error: "origin_denied" });
      const body = await readJSON(req);
      if (typeof body?.token !== "string" || body.token.length < 20 || body.token.length > 512 || /[\u0000-\u001f\u007f]/u.test(body.token)) {
        return sendJSON(res, 400, { error: "invalid_link" });
      }
      const verifyURL = new URL("/api/auth/magic-link/verify", origin);
      verifyURL.searchParams.set("token", body.token);
      verifyURL.searchParams.set("callbackURL", "/");
      try {
        const runtimeConfig = await getRuntime();
        const verifyHeaders = new Headers({ origin, accept: "text/html,application/json" });
        if (req.headers["x-forwarded-for"]) verifyHeaders.set("x-forwarded-for", req.headers["x-forwarded-for"]);
        if (req.headers["user-agent"]) verifyHeaders.set("user-agent", req.headers["user-agent"]);
        const response = await withIdentityLock(identityLockPool, async () => {
          await beforeMagicLinkVerify?.({ token: body.token });
          return runtimeConfig.auth.handler(new Request(verifyURL, {
            method: "GET",
            headers: verifyHeaders,
          }));
        });
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
          const redirect = new URL(location, origin);
          if (redirect.origin !== origin || redirect.searchParams.has("error")) {
            return sendJSON(res, 401, { error: "invalid_link" });
          }
          return sendJSON(res, 204, null, { setCookie: response.headers.getSetCookie?.() || [] });
        }
        return sendJSON(res, 401, { error: "invalid_link" });
      } catch (error) {
        onTestFailure?.("magic_link_confirm", error);
        return sendJSON(res, 503, { error: "auth_unavailable" });
      }
    }

    if (method === "POST" && url.pathname === "/api/auth/sign-out") {
      if (!isSameOrigin(req, origin)) return sendJSON(res, 403, { error: "origin_denied" });
      try {
        const body = await readBody(req);
        const headers = requestHeaders(req);
        const request = new Request(origin + "/api/auth/sign-out", {
          method: "POST",
          headers,
          ...(body.length ? { body } : {}),
        });
        const runtimeConfig = await getRuntime();
        return await writeWebResponse(res, await runtimeConfig.auth.handler(request));
      } catch {
        return sendJSON(res, 503, { error: "auth_unavailable" });
      }
    }

    const passkeyName = url.pathname.startsWith("/api/auth/passkey/") ? url.pathname.slice("/api/auth/passkey/".length) : "";
    // The development mock is only an account picker: no passkeys, so none can reach real mode.
    if (mode !== "mock" && Object.hasOwn(PASSKEY_METHODS, passkeyName) && PASSKEY_METHODS[passkeyName] === method) {
      if (method === "POST" && !isSameOrigin(req, origin)) return sendJSON(res, 403, { error: "origin_denied" });
      try {
        return await passkeyRoute(passkeyName, req, res, await getRuntime());
      } catch (error) {
        if (error?.message === "body too large") throw error;
        onTestFailure?.("passkey_" + passkeyName, error);
        return sendJSON(res, 503, { error: "auth_unavailable" });
      }
    }

    // google is false in mock mode (auth-config.mjs never configures the provider there).
    if (google && url.pathname === "/api/auth/callback/google" && method === "GET") {
      try {
        return await googleCallback(req, res, url, await getRuntime());
      } catch (error) {
        onTestFailure?.("google_callback", error);
        return sendJSON(res, 303, null, { location: LOGIN_FAILED });
      }
    }
    const googleRoute = {
      "/api/auth/sign-in/social": "POST",
      "/api/auth/link-social": "POST",
      "/api/auth/list-accounts": "GET",
      "/api/auth/unlink-account": "POST",
    }[url.pathname];
    if (google && googleRoute === method) {
      if (method === "POST" && !isSameOrigin(req, origin)) return sendJSON(res, 403, { error: "origin_denied" });
      try {
        return await googleAccountRoute(url.pathname.slice("/api/auth/".length), req, res, await getRuntime());
      } catch (error) {
        if (error?.message === "body too large") throw error;
        onTestFailure?.("google_" + url.pathname, error);
        return sendJSON(res, 503, { error: "auth_unavailable" });
      }
    }

    if (url.pathname.startsWith("/api/auth/")) return sendJSON(res, 404, { error: "not_found" });
    return sendJSON(res, 404, { error: "not_found" });
  }

  // Google calls are rebuilt like passkey calls: fixed path and body, only the forwarding headers and the cookie.
  function googleCall(runtime, httpMethod, path, req, body) {
    const headers = new Headers({ origin });
    for (const key of ["x-forwarded-for", "user-agent", "cookie"]) if (req.headers[key]) headers.set(key, req.headers[key]);
    if (body) headers.set("content-type", "application/json");
    return runtime.auth.handler(new Request(origin + "/api/auth/" + path, {
      method: httpMethod,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
  }

  // Answers with the Google authorization URL; the page navigates there itself (form-action stays 'self').
  async function sendAuthorizationURL(res, response) {
    if (response.status === 429) return sendJSON(res, 429, { error: "rate_limited" }, { "retry-after": response.headers.get("x-retry-after") || "60" });
    const target = response.ok ? (await response.json())?.url : "";
    if (typeof target !== "string" || !target.startsWith(GOOGLE_ORIGIN + "/")) return sendJSON(res, 503, { error: "auth_unavailable" });
    return sendJSON(res, 200, { url: target }, { setCookie: response.headers.getSetCookie?.() || [] });
  }

  async function googleAccountRoute(name, req, res, runtime) {
    const body = method => method === "POST" ? readJSON(req) : null;
    if (name === "sign-in/social") {
      await body("POST");
      const response = await googleCall(runtime, "POST", name, { headers: { ...req.headers, cookie: undefined } }, {
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: LOGIN_FAILED,
        disableRedirect: true,
      });
      return sendAuthorizationURL(res, response);
    }
    if (name === "link-social") {
      await body("POST");
      // Better Auth only asks for a session here; linking a new way to sign in requires a recent login.
      const sessionData = req.headers.cookie
        ? await runtime.auth.api.getSession({ headers: new Headers({ cookie: req.headers.cookie }) })
        : null;
      if (!sessionData?.session || !(await runtime.hasSessionAccess(sessionData.user.id))) return sessionFailure(res, 401);
      if (Date.now() - new Date(sessionData.session.createdAt).getTime() >= FRESH_SESSION_MS) return sessionFailure(res, 403);
      const response = await googleCall(runtime, "POST", name, req, {
        provider: "google",
        callbackURL: SETTINGS_PATH,
        errorCallbackURL: SETTINGS_PATH,
        disableRedirect: true,
      });
      if (!response.ok && response.status !== 429) return sessionFailure(res, response.status);
      return sendAuthorizationURL(res, response);
    }
    const listed = await googleCall(runtime, "GET", "list-accounts", req);
    if (!listed.ok) return sessionFailure(res, listed.status);
    const accounts = (await listed.json()).filter((row) => row.providerId === "google");
    if (name === "list-accounts") {
      return sendJSON(res, 200, accounts.map((row) => ({ id: row.id, created_at: row.createdAt })));
    }
    const { id } = (await body("POST")) || {};
    if (!isUUID(id) || !accounts.some((row) => row.id === id)) return sendJSON(res, 404, { error: "not_found" });
    const response = await googleCall(runtime, "POST", "unlink-account", req, { accountId: id });
    if (response.ok) return sendJSON(res, 204, null);
    return response.status === 401 || response.status === 403 ? sessionFailure(res, response.status) : sendJSON(res, 404, { error: "not_found" });
  }

  // Top-level navigation back from Google: state cookie and PKCE protect it, so no Origin check. Every failure
  // lands on one fixed address, so the outcome never tells whether an email belongs to an account.
  async function googleCallback(req, res, url, runtime) {
    const callbackURL = new URL("/api/auth/callback/google", origin);
    for (const key of ["code", "state", "error", "iss"]) {
      const value = url.searchParams.get(key);
      if (value !== null) callbackURL.searchParams.set(key, value);
    }
    const headers = new Headers();
    for (const key of ["x-forwarded-for", "user-agent", "cookie"]) if (req.headers[key]) headers.set(key, req.headers[key]);
    const response = await withIdentityLock(identityLockPool, () => Promise.race([
      runtime.auth.handler(new Request(callbackURL, { method: "GET", headers })),
      new Promise((_, reject) => setTimeout(() => reject(new Error("google callback timeout")), GOOGLE_CALLBACK_TIMEOUT_MS).unref()),
    ]));
    const location = response.headers.get("location");
    const redirect = location ? new URL(location, origin) : null;
    const linking = redirect?.origin === origin && redirect.pathname === SETTINGS_PATH;
    const ok = redirect?.origin === origin && !redirect.searchParams.has("error") && response.status >= 300 && response.status < 400;
    const target = linking ? SETTINGS_PATH + (ok ? "?google=linked" : "?google=failed") : ok ? "/" : LOGIN_FAILED;
    return sendJSON(res, 303, null, { location: target, setCookie: response.headers.getSetCookie?.() || [] });
  }

  // Passkey calls are rebuilt from validated fields only: fixed headers, fixed paths, no query, and a body
  // containing nothing but the credential response or the passkey id.
  function passkeyCall(runtime, httpMethod, path, req, { cookie = true, body } = {}) {
    const headers = new Headers({ origin });
    for (const key of ["x-forwarded-for", "user-agent"]) if (req.headers[key]) headers.set(key, req.headers[key]);
    if (cookie && req.headers.cookie) headers.set("cookie", req.headers.cookie);
    if (body) headers.set("content-type", "application/json");
    return runtime.auth.handler(new Request(origin + "/api/auth/passkey/" + path, {
      method: httpMethod,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
  }

  function sessionFailure(res, status) {
    if (status === 401) return sendJSON(res, 401, { error: "unauthorized" });
    if (status === 403) return sendJSON(res, 403, { error: "session_not_fresh" });
    return sendJSON(res, 503, { error: "auth_unavailable" });
  }

  async function passkeyRoute(name, req, res, runtime) {
    const cookies = (response) => response.headers.getSetCookie?.() || [];
    if (name === "generate-register-options" || name === "generate-authenticate-options") {
      const registering = name === "generate-register-options";
      const response = await passkeyCall(runtime, "GET", name, req, { cookie: registering });
      if (!response.ok) return registering ? sessionFailure(res, response.status) : sendJSON(res, 503, { error: "auth_unavailable" });
      return sendJSON(res, 200, await response.json(), { setCookie: cookies(response) });
    }
    if (name === "list-user-passkeys") {
      const response = await passkeyCall(runtime, "GET", name, req);
      if (!response.ok) return sessionFailure(res, response.status);
      const rows = await response.json();
      return sendJSON(res, 200, rows.map((row) => ({ id: row.id, name: row.name ?? null, created_at: row.createdAt })));
    }
    const body = await readJSON(req);
    if (name === "delete-passkey") {
      if (!isUUID(body?.id)) return sendJSON(res, 404, { error: "not_found" });
      const listed = await passkeyCall(runtime, "GET", "list-user-passkeys", req);
      if (!listed.ok) return sessionFailure(res, listed.status);
      if (!(await listed.json()).some((row) => row.id === body.id)) return sendJSON(res, 404, { error: "not_found" });
      const response = await passkeyCall(runtime, "POST", name, req, { body: { id: body.id } });
      if (response.ok) return sendJSON(res, 204, null);
      return response.status === 401 ? sessionFailure(res, 401) : sendJSON(res, 404, { error: "not_found" });
    }
    const registering = name === "verify-registration";
    const credential = body?.response;
    if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
      return sendJSON(res, registering ? 400 : 401, { error: "invalid_passkey" });
    }
    // No challenge cookie, no verification: refuse before taking the shared identity lock.
    if (!/better-auth-passkey=/u.test(req.headers.cookie || "")) return sendJSON(res, registering ? 400 : 401, { error: "invalid_passkey" });
    const response = await withIdentityLock(identityLockPool, () => passkeyCall(runtime, "POST", name, req, { body: { response: credential } }));
    if (response.ok) return sendJSON(res, 204, null, registering ? {} : { setCookie: cookies(response) });
    if (registering && (response.status === 401 || response.status === 403)) return sessionFailure(res, response.status);
    return sendJSON(res, registering ? 400 : 401, { error: "invalid_passkey" });
  }

  return server;
}

async function withIdentityLock(pool, action) {
  if (!pool) throw new Error("identity lock pool is required");
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(74120984::bigint)");
    const result = await action();
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
    transactionStarted = false;
    throw error;
  } finally {
    client.release();
  }
}

function isSameOrigin(req, origin) {
  if (req.headers.origin !== origin) return false;
  const fetchSite = req.headers["sec-fetch-site"];
  return !fetchSite || fetchSite === "same-origin";
}

async function consumeLoginLimits(pool, secret, email, ip) {
  const ipHash = createHmac("sha256", secret).update("ip:" + ip).digest("hex");
  if (!(await consumeCounter(pool, ipHash, IP_WINDOW_SECONDS, IP_WINDOW_MAX))) return false;
  const emailHash = createHmac("sha256", secret).update("email:" + email).digest("hex");
  const withinEmailLimit = await consumeCounter(pool, emailHash, EMAIL_WINDOW_SECONDS, EMAIL_WINDOW_MAX);
  await pool.query("DELETE FROM auth_email_rate_limits WHERE window_started_at < now() - interval '1 day'");
  return withinEmailLimit;
}

async function consumeCounter(pool, keyHash, windowSeconds, limit) {
  const query = [
    "INSERT INTO auth_email_rate_limits (key_hash, window_started_at, count) VALUES ($1, now(), 1)",
    "ON CONFLICT (key_hash) DO UPDATE SET",
    "count = CASE WHEN auth_email_rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN 1 ELSE auth_email_rate_limits.count + 1 END,",
    "window_started_at = CASE WHEN auth_email_rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN now() ELSE auth_email_rate_limits.window_started_at END",
    "RETURNING count",
  ].join(" ");
  const result = await pool.query(query, [keyHash, windowSeconds]);
  return Number(result.rows[0].count) <= limit;
}

function getClientIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const candidate = forwarded.split(",", 1)[0].trim();
    if (isIP(candidate)) return candidate;
  }
  const remote = req.socket.remoteAddress;
  return remote && isIP(remote) ? remote : "unknown";
}

async function minimumDelay(startedAt, milliseconds) {
  const remaining = milliseconds - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJSON(req) {
  const body = await readBody(req);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
}

function requestHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === "connection" || key === "content-length" || key === "host" || key === "transfer-encoding") continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function sendJSON(res, statusCode, value, options = {}) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (options.location) res.setHeader("location", options.location);
  if (options.setCookie?.length) res.setHeader("set-cookie", options.setCookie);
  for (const [key, value] of Object.entries(options)) {
    if (key !== "location" && key !== "setCookie") res.setHeader(key, value);
  }
  setSecurityHeaders(res);
  if (statusCode === 204) return res.end();
  return res.end(JSON.stringify(value));
}

function sendHTML(res, html) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  setSecurityHeaders(res);
  res.setHeader("content-security-policy", html.policy(html.nonce));
  res.end(html.body);
}

async function writeWebResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  const setCookies = response.headers.getSetCookie?.() || [];
  if (setCookies.length) res.setHeader("set-cookie", setCookies);
  setSecurityHeaders(res);
  if (response.status === 204 || response.status === 304) return res.end();
  return res.end(Buffer.from(await response.arrayBuffer()));
}

function setSecurityHeaders(res) {
  res.setHeader("cache-control", "no-store, max-age=0");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("content-security-policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

function makePage(body, policy) {
  const nonce = randomBytes(18).toString("base64");
  return { body: body.replaceAll("__NONCE__", nonce), nonce, policy };
}

const pageCSS = `:root{color-scheme:light dark;--paper:#f5f6ec;--card:#fff;--ink:#15181f;--muted:#5d6270;--line:#d6dac0;--pop:#c8f23c;--accent:#d81e44;--chrome:#e4e8cc}
@media (prefers-color-scheme:dark){:root{--paper:#15181f;--card:#1f242e;--ink:#f5f6ec;--muted:#a3a99a;--line:#363c4a;--chrome:#1a1e27}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--chrome);color:var(--ink);font:16px/1.5 "Avenir Next","Segoe UI",system-ui,sans-serif}
main{width:100%;max-width:440px;margin:0 auto;padding:16px}
main.wide{max-width:720px}
.panel{padding:28px;border:2px solid var(--line);border-radius:24px;background:var(--paper)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:20px;font-weight:800;letter-spacing:-.02em}
.mark{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--pop);color:#15181f;font-size:1.1rem;font-weight:800;transform:rotate(-6deg)}
.badge{display:inline-block;margin-bottom:12px;padding:2px 12px;border-radius:999px;background:var(--pop);color:#15181f;font-size:.8rem;font-weight:700}
h1{margin:0 0 8px;font-size:clamp(1.6rem,6vw,2.2rem);font-weight:800;letter-spacing:-.025em;line-height:1.15}
.hint{margin:0 0 24px;color:var(--muted)}
label{display:block;margin:0 0 6px;font-weight:700;font-size:.9rem}
input{width:100%;padding:12px 14px;border:2px solid var(--line);border-radius:14px;background:var(--card);color:inherit;font:inherit}
input:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-color:var(--ink)}
.btn{display:block;width:100%;margin-top:14px;padding:13px 18px;border:2px solid var(--ink);border-radius:999px;background:var(--ink);color:var(--paper);font:inherit;font-weight:700;cursor:pointer;transition:transform .12s,box-shadow .12s}
.btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 4px 0 var(--accent)}
.btn:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
[hidden]{display:none!important}
.btn:disabled{opacity:.5;cursor:not-allowed}
.msg{min-height:1.5em;margin:16px 0 0;color:var(--muted);font-size:.95rem}
.msg.ok{padding:12px 14px;border-radius:14px;background:var(--pop);color:#15181f;font-weight:600}
.msg.err{color:var(--accent);font-weight:600}
.small{margin:20px 0 0;color:var(--muted);font-size:.85rem}
.legal{display:flex;gap:16px}.legal a{color:inherit}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,210px),1fr));gap:12px}
.card{display:flex;align-items:center;gap:12px;width:100%;padding:14px;border:2px solid var(--line);border-radius:16px;background:var(--card);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:transform .12s,border-color .12s,box-shadow .12s}
.card:hover{border-color:var(--ink);transform:translateY(-2px);box-shadow:0 4px 0 var(--ink)}
.card:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.avatar{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--pop);color:#15181f;font-weight:800;font-size:1.2rem}
.name{min-width:0;font-weight:700;overflow-wrap:anywhere}
@media (prefers-reduced-motion:reduce){.card,.btn{transition:none}.card:hover,.btn:hover:not(:disabled){transform:none}}`;

function loginPage(mode, google) {
  if (mode === "mock") {
    return makePage(
      "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Anmelden · AbiZeitBetrug</title><style nonce=\"__NONCE__\">" + pageCSS + "</style><main  class=\"wide\"><div class=\"panel\"><div class=\"brand\"><span class=\"mark\" aria-hidden=\"true\">27</span>AbiZeitBetrug</div><span class=\"badge\">Nur Entwicklung</span><h1>Entwicklungsanmeldung</h1><p class=\"hint\">Testkonto auswählen. Dies ist ein lokaler Mock ohne echte Konten.</p><div class=\"grid\" id=\"accounts\" aria-live=\"polite\">Lade Konten …</div><p id=\"message\" class=\"msg\" role=\"status\"></p><p class=\"small legal\"><a href=\"/impressum\">Impressum</a><a href=\"/datenschutz\">Datenschutz</a></p></div></main><script nonce=\"__NONCE__\">const root=document.querySelector(\"#accounts\");const message=document.querySelector(\"#message\");fetch(\"/auth/mock-users\",{credentials:\"same-origin\"}).then(r=>{if(!r.ok)throw new Error();return r.json()}).then(users=>{root.replaceChildren();for(const user of users){const button=document.createElement(\"button\");button.className=\"card\";button.type=\"button\";button.dataset.userId=user.id;const avatar=document.createElement(\"span\");avatar.className=\"avatar\";avatar.setAttribute(\"aria-hidden\",\"true\");avatar.textContent=(Array.from(user.name)[0]||\"?\").toUpperCase();const name=document.createElement(\"span\");name.className=\"name\";name.textContent=user.name;button.append(avatar,name);button.addEventListener(\"click\",async()=>{message.textContent=\"\";message.className=\"msg\";const response=await fetch(\"/auth/mock-login\",{method:\"POST\",credentials:\"same-origin\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({user_id:user.id})});if(response.ok){location.assign(\"/\")}else{message.textContent=\"Anmeldung derzeit nicht möglich.\";message.className=\"msg err\"}});root.append(button)}}).catch(()=>{root.textContent=\"Konten konnten nicht geladen werden.\"});</script></html>",
      pageCSP,
    );
  }
  return makePage(
    "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Anmelden · AbiZeitBetrug</title><style nonce=\"__NONCE__\">" + pageCSS + "</style><main><div class=\"panel\"><div class=\"brand\"><span class=\"mark\" aria-hidden=\"true\">27</span>AbiZeitBetrug</div><h1>Schön, dass du da bist.</h1><p class=\"hint\">Gib deine E-Mail-Adresse ein. Wir schicken dir einen Anmeldelink.</p><form id=\"login\"><label for=\"email\">E-Mail-Adresse</label><input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"email webauthn\" required maxlength=\"254\" placeholder=\"name@beispiel.de\"><button id=\"submit\" class=\"btn\" type=\"submit\">Anmeldelink anfordern</button></form><button id=\"passkey\" class=\"btn\" type=\"button\" hidden>Mit Passkey anmelden</button>" + (google ? "<button id=\"google\" class=\"btn\" type=\"button\">Mit Google anmelden</button>" : "") + "<p id=\"message\" class=\"msg\" role=\"status\" aria-live=\"polite\"></p><p class=\"small\">Privater Bereich für den Jahrgang LMGU 2027. Nur zugelassene Konten erhalten einen Link.</p><p class=\"small legal\"><a href=\"/impressum\">Impressum</a><a href=\"/datenschutz\">Datenschutz</a></p></div></main><script nonce=\"__NONCE__\">document.querySelector(\"#login\").addEventListener(\"submit\",async event=>{event.preventDefault();const message=document.querySelector(\"#message\");const submit=document.querySelector(\"#submit\");const email=document.querySelector(\"#email\").value;message.className=\"msg\";message.textContent=\"Bitte warten …\";submit.disabled=true;try{const response=await fetch(\"/api/auth/sign-in/magic-link\",{method:\"POST\",credentials:\"same-origin\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({email})});if(response.status===503){message.className=\"msg err\";message.textContent=\"Der Anmeldedienst ist gerade nicht verfügbar.\";submit.disabled=false}else{message.className=\"msg ok\";message.textContent=\"Falls das Konto zugelassen ist, erhältst du einen Anmeldelink per E-Mail.\"}}catch{message.className=\"msg err\";message.textContent=\"Der Anmeldedienst ist gerade nicht verfügbar.\";submit.disabled=false}});" + passkeyScript + (google ? googleScript : "") + "</script></html>",
    pageCSP,
  );
}

function magicLinkPage() {
  return makePage(
    "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Anmeldung bestätigen · AbiZeitBetrug</title><style nonce=\"__NONCE__\">" + pageCSS + "</style><main><div class=\"panel\"><div class=\"brand\"><span class=\"mark\" aria-hidden=\"true\">27</span>AbiZeitBetrug</div><h1>Fast geschafft.</h1><p class=\"hint\">Tippe auf die Schaltfläche, um die Anmeldung abzuschließen.</p><button id=\"confirm\" class=\"btn\" type=\"button\">Anmeldung bestätigen</button><p id=\"message\" class=\"msg\" role=\"status\" aria-live=\"polite\"></p><p class=\"small legal\"><a href=\"/impressum\">Impressum</a><a href=\"/datenschutz\">Datenschutz</a></p></div></main><script nonce=\"__NONCE__\">let token=\"\";try{token=decodeURIComponent(location.hash.slice(1))}catch{}history.replaceState(null,\"\",location.pathname);const button=document.querySelector(\"#confirm\");const message=document.querySelector(\"#message\");if(!token){button.disabled=true;message.className=\"msg err\";message.textContent=\"Dieser Anmeldelink ist ungültig oder abgelaufen.\"}button.addEventListener(\"click\",async()=>{if(!token)return;button.disabled=true;message.className=\"msg\";message.textContent=\"Anmeldung wird geprüft …\";const value=token;token=\"\";try{const response=await fetch(\"/api/auth/magic-link/confirm\",{method:\"POST\",credentials:\"same-origin\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({token:value})});if(response.ok){if(!localStorage.getItem(\"abizeit-passkey\"))localStorage.setItem(\"abizeit-passkey-offer\",\"1\");location.replace(\"/\")}else{message.className=\"msg err\";message.textContent=\"Dieser Anmeldelink ist ungültig oder abgelaufen.\"}}catch{message.className=\"msg err\";message.textContent=\"Der Anmeldedienst ist gerade nicht verfügbar.\"}});</script></html>",
    pageCSP,
  );
}

// Native WebAuthn only; the button stays hidden in browsers without JSON option parsing.
// Client script shared by the login pages. Runs in the browser, so no template placeholders or backticks inside.
// Flow: a passkey button, the email field's autofill ("conditional mediation"), and an automatic prompt in
// browsers that signed in with a passkey before (localStorage flag HINT, also set by the settings page).
const passkeyScript = `{
  const button = document.querySelector("#passkey");
  const message = document.querySelector("#message");
  const email = document.querySelector("#email");
  const HINT = "abizeit-passkey";

  if (window.PublicKeyCredential && PublicKeyCredential.parseRequestOptionsFromJSON) {
    button.hidden = false;
    let current; // only one browser prompt may be open; starting another aborts the previous one

    const post = (path, body) =>
      fetch("/api/auth/passkey/" + path, {
        method: "POST",
        credentials: "same-origin",
        ...(body && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });

    const showError = () => {
      message.className = "msg err";
      message.textContent = "Anmeldung mit Passkey nicht möglich.";
    };

    // mediation: undefined = browser dialog, "conditional" = suggestions in the email field.
    async function signIn(mediation) {
      const controller = new AbortController();
      current?.abort();
      current = controller;
      const options = await post("generate-authenticate-options");
      if (!options.ok) throw new Error("options");
      const credential = await navigator.credentials.get({
        publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(await options.json()),
        mediation,
        signal: controller.signal,
      });
      const result = await post("verify-authentication", { response: credential.toJSON() });
      if (result.status !== 204) throw new Error("verify");
      localStorage.setItem(HINT, "1");
      location.replace("/");
    }

    async function suggestInEmailField() {
      if (!(await PublicKeyCredential.isConditionalMediationAvailable?.())) return;
      try {
        await signIn("conditional");
      } catch (error) {
        // Aborted by the button or dismissed: stay quiet.
        if (error.name !== "AbortError" && error.name !== "NotAllowedError") showError();
      }
    }

    button.addEventListener("click", async () => {
      button.disabled = true;
      message.className = "msg";
      message.textContent = "";
      try {
        await signIn();
      } catch {
        showError();
        suggestInEmailField();
      }
      button.disabled = false;
    });

    (async () => {
      if (localStorage.getItem(HINT)) {
        try {
          await signIn();
          return;
        } catch {
          localStorage.removeItem(HINT); // cancelled or no longer valid: never nag twice
        }
      }
      suggestInEmailField();
    })();
  }
}`;

// Google sign-in only works for accounts that linked Google in the settings; the failure text says so for everyone.
const googleScript = `{
  const button = document.querySelector("#google");
  const message = document.querySelector("#message");
  if (new URLSearchParams(location.search).get("google") === "failed") {
    history.replaceState(null, "", location.pathname);
    message.className = "msg err";
    message.textContent = "Anmeldung mit Google nicht möglich. Google muss zuerst in den Einstellungen verknüpft werden; bis dahin hilft der Anmeldelink per E-Mail.";
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await fetch("/api/auth/sign-in/social", { method: "POST", credentials: "same-origin" });
      if (response.status === 429) {
        message.className = "msg err";
        message.textContent = "Zu viele Versuche. Bitte warte eine Minute.";
        button.disabled = false;
        return;
      }
      if (!response.ok) throw new Error("social");
      location.assign((await response.json()).url);
    } catch {
      message.className = "msg err";
      message.textContent = "Der Anmeldedienst ist gerade nicht verfügbar.";
      button.disabled = false;
    }
  });
}`;

// Always Path=/ and never a Domain (the test helper reports one), as __Host- cookies require.
function formatMockCookie(cookie) {
  const parts = [cookie.name + "=" + cookie.value, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=86400"];
  if (cookie.secure) parts.push("Secure");
  return parts.join("; ");
}

const pageCSP = (nonce) => "default-src 'none'; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
