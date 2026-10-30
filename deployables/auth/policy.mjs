import { timingSafeEqual } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveMode(env = process.env) {
  const appEnv = env.APP_ENV;
  if (!new Set(["development", "production", "test"]).has(appEnv)) {
    throw new Error("APP_ENV must be development, production, or test");
  }

  const mode = env.AUTH_MODE ?? (appEnv === "production" ? "better_auth" : undefined);
  if (!new Set(["better_auth", "mock"]).has(mode)) {
    throw new Error("AUTH_MODE must be explicitly set to better_auth or mock");
  }
  if (appEnv === "production" && mode !== "better_auth") {
    throw new Error("Production requires AUTH_MODE=better_auth");
  }
  if (mode === "mock" && appEnv !== "development") {
    throw new Error("Mock authentication is only available in development");
  }
  if (!env.AUTH_SERVICE_SECRET || env.AUTH_SERVICE_SECRET.length < 32) {
    throw new Error("AUTH_SERVICE_SECRET must contain at least 32 characters");
  }

  if (mode === "better_auth") {
    if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
    }
    const authURL = new URL(env.BETTER_AUTH_URL ?? "");
    if (appEnv === "production" && authURL.protocol !== "https:") {
      throw new Error("BETTER_AUTH_URL must use HTTPS in production");
    }
    if (authURL.pathname !== "/" || authURL.username || authURL.password || authURL.search || authURL.hash) {
      throw new Error("BETTER_AUTH_URL must be a canonical origin without credentials, query, or fragment");
    }
    if (env.AUTH_SERVICE_SECRET === env.BETTER_AUTH_SECRET) {
      throw new Error("BETTER_AUTH_SECRET must be separate from AUTH_SERVICE_SECRET");
    }
    if (appEnv !== "test") {
      const senderURL = new URL(env.PORTAL_INTERNAL_URL ?? "");
      if (!new Set(["http:", "https:"]).has(senderURL.protocol) || senderURL.pathname !== "/" || senderURL.username || senderURL.password || senderURL.search || senderURL.hash) {
        throw new Error("PORTAL_INTERNAL_URL must be an internal HTTP(S) origin");
      }
    }
  } else {
    if (!env.MOCK_AUTH_SECRET || env.MOCK_AUTH_SECRET.length < 32) {
      throw new Error("MOCK_AUTH_SECRET must contain at least 32 characters");
    }
    if (env.MOCK_AUTH_SECRET === env.AUTH_SERVICE_SECRET) {
      throw new Error("MOCK_AUTH_SECRET must be separate from AUTH_SERVICE_SECRET");
    }
    if (env.BETTER_AUTH_SECRET && env.MOCK_AUTH_SECRET === env.BETTER_AUTH_SECRET) {
      throw new Error("MOCK_AUTH_SECRET must be separate from BETTER_AUTH_SECRET");
    }
    const authURL = new URL(env.BETTER_AUTH_URL ?? "");
    if (authURL.pathname !== "/" || authURL.username || authURL.password || authURL.search || authURL.hash) {
      throw new Error("BETTER_AUTH_URL must be a canonical origin without credentials, query, or fragment");
    }
  }

  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return { appEnv, mode, authURL: new URL(env.BETTER_AUTH_URL), authOrigin: new URL(env.BETTER_AUTH_URL).origin };
}

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (!email || /[\u0000-\u001f\u007f<>]/u.test(email) || email.length > 254) return null;
  const normalized = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) return null;
  return normalized;
}

export function isUUID(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function hasServiceAuthorization(header, secret) {
  if (typeof header !== "string" || !secret) return false;
  const match = /^Bearer ([^\s]+)$/u.exec(header);
  if (!match) return false;
  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function cookiePrefixFor(mode) {
  return mode === "mock" ? "abz-mock" : "abz-auth";
}
