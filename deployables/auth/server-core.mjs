import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { hasServiceAuthorization, isUUID, normalizeEmail } from "./policy.mjs";

const BODY_LIMIT = 16 * 1024;
const IP_WINDOW_SECONDS = 60;
const IP_WINDOW_MAX = 10;
const EMAIL_WINDOW_SECONDS = 15 * 60;
const EMAIL_WINDOW_MAX = 3;

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
      return sendHTML(res, loginPage(mode));
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

    if (url.pathname.startsWith("/api/auth/")) return sendJSON(res, 404, { error: "not_found" });
    return sendJSON(res, 404, { error: "not_found" });
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

function loginPage(mode) {
  if (mode === "mock") {
    return makePage(
      "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Anmelden · AbiZeitBetrug</title><style nonce=\"__NONCE__\">" + pageCSS + "</style><main  class=\"wide\"><div class=\"panel\"><div class=\"brand\"><span class=\"mark\" aria-hidden=\"true\">27</span>AbiZeitBetrug</div><span class=\"badge\">Nur Entwicklung</span><h1>Entwicklungsanmeldung</h1><p class=\"hint\">Testkonto auswählen. Dies ist ein lokaler Mock ohne echte Konten.</p><div class=\"grid\" id=\"accounts\" aria-live=\"polite\">Lade Konten …</div><p id=\"message\" class=\"msg\" role=\"status\"></p><p class=\"small legal\"><a href=\"/impressum\">Impressum</a><a href=\"/datenschutz\">Datenschutz</a></p></div></main><script nonce=\"__NONCE__\">const root=document.querySelector(\"#accounts\");const message=document.querySelector(\"#message\");fetch(\"/auth/mock-users\",{credentials:\"same-origin\"}).then(r=>{if(!r.ok)throw new Error();return r.json()}).then(users=>{root.replaceChildren();for(const user of users){const button=document.createElement(\"button\");button.className=\"card\";button.type=\"button\";button.dataset.userId=user.id;const avatar=document.createElement(\"span\");avatar.className=\"avatar\";avatar.setAttribute(\"aria-hidden\",\"true\");avatar.textContent=(Array.from(user.name)[0]||\"?\").toUpperCase();const name=document.createElement(\"span\");name.className=\"name\";name.textContent=user.name;button.append(avatar,name);button.addEventListener(\"click\",async()=>{message.textContent=\"\";message.className=\"msg\";const response=await fetch(\"/auth/mock-login\",{method:\"POST\",credentials:\"same-origin\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({user_id:user.id})});if(response.ok){location.assign(\"/\")}else{message.textContent=\"Anmeldung derzeit nicht möglich.\";message.className=\"msg err\"}});root.append(button)}}).catch(()=>{root.textContent=\"Konten konnten nicht geladen werden.\"});</script></html>",
      pageCSP,
    );
  }
  return makePage(
    "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Anmelden · AbiZeitBetrug</title><style nonce=\"__NONCE__\">" + pageCSS + "</style><main><div class=\"panel\"><div class=\"brand\"><span class=\"mark\" aria-hidden=\"true\">27</span>AbiZeitBetrug</div><h1>Schön, dass du da bist.</h1><p class=\"hint\">Gib deine E-Mail-Adresse ein. Wir schicken dir einen Anmeldelink.</p><form id=\"login\"><label for=\"email\">E-Mail-Adresse</label><input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"email\" required maxlength=\"254\" placeholder=\"name@beispiel.de\"><button id=\"submit\" class=\"btn\" type=\"submit\">Anmeldelink anfordern</button></form><p id=\"message\" class=\"msg\" role=\"status\" aria-live=\"polite\"></p><p class=\"small\">Privater Bereich für den Jahrgang LMGU 2027. Nur zugelassene Konten erhalten einen Link.</p><p class=\"small legal\"><a href=\"/impressum\">Impressum</a><a href=\"/datenschutz\">Datenschutz</a></p></div></main><script nonce=\"__NONCE__\">document.querySelector(\"#login\").addEventListener(\"submit\",async event=>{event.preventDefault();const message=document.querySelector(\"#message\");const submit=document.querySelector(\"#submit\");const email=document.querySelector(\"#email\").value;message.className=\"msg\";message.textContent=\"Bitte warten …\";submit.disabled=true;try{const response=await fetch(\"/api/auth/sign-in/magic-link\",{method:\"POST\",credentials:\"same-origin\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({email})});if(response.status===503){message.className=\"msg err\";message.textContent=\"Der Anmeldedienst ist gerade nicht verfügbar.\";submit.disabled=false}else{message.className=\"msg ok\";message.textContent=\"Falls das Konto zugelassen ist, erhältst du einen Anmeldelink per E-Mail.\"}}catch{message.className=\"msg err\";message.textContent=\"Der Anmeldedienst ist gerade nicht verfügbar.\";submit.disabled=false}});</script></html>",
    pageCSP,
  );
}

function magicLinkPage() {
  return makePage(
    "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Anmeldung bestätigen · AbiZeitBetrug</title><style nonce=\"__NONCE__\">" + pageCSS + "</style><main><div class=\"panel\"><div class=\"brand\"><span class=\"mark\" aria-hidden=\"true\">27</span>AbiZeitBetrug</div><h1>Fast geschafft.</h1><p class=\"hint\">Tippe auf die Schaltfläche, um die Anmeldung abzuschließen.</p><button id=\"confirm\" class=\"btn\" type=\"button\">Anmeldung bestätigen</button><p id=\"message\" class=\"msg\" role=\"status\" aria-live=\"polite\"></p><p class=\"small legal\"><a href=\"/impressum\">Impressum</a><a href=\"/datenschutz\">Datenschutz</a></p></div></main><script nonce=\"__NONCE__\">let token=\"\";try{token=decodeURIComponent(location.hash.slice(1))}catch{}history.replaceState(null,\"\",location.pathname);const button=document.querySelector(\"#confirm\");const message=document.querySelector(\"#message\");if(!token){button.disabled=true;message.className=\"msg err\";message.textContent=\"Dieser Anmeldelink ist ungültig oder abgelaufen.\"}button.addEventListener(\"click\",async()=>{if(!token)return;button.disabled=true;message.className=\"msg\";message.textContent=\"Anmeldung wird geprüft …\";const value=token;token=\"\";try{const response=await fetch(\"/api/auth/magic-link/confirm\",{method:\"POST\",credentials:\"same-origin\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({token:value})});if(response.ok){location.replace(\"/\")}else{message.className=\"msg err\";message.textContent=\"Dieser Anmeldelink ist ungültig oder abgelaufen.\"}}catch{message.className=\"msg err\";message.textContent=\"Der Anmeldedienst ist gerade nicht verfügbar.\"}});</script></html>",
    pageCSP,
  );
}

function formatMockCookie(cookie) {
  const parts = [cookie.name + "=" + cookie.value, "Path=" + (cookie.path || "/"), "HttpOnly", "SameSite=Lax", "Max-Age=86400"];
  if (cookie.secure) parts.push("Secure");
  return parts.join("; ");
}

const pageCSP = (nonce) => "default-src 'none'; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
