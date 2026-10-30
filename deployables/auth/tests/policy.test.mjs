import test from "node:test";
import assert from "node:assert/strict";
import { cookiePrefixFor, hasServiceAuthorization, isUUID, normalizeEmail, resolveMode } from "../policy.mjs";

const secret = "s".repeat(40);

test("real auth defaults only in production and mock is development-only", () => {
  const production = resolveMode({
    APP_ENV: "production",
    DATABASE_URL: "postgres://localhost/portal",
    AUTH_SERVICE_SECRET: secret,
    BETTER_AUTH_SECRET: "b".repeat(40),
    BETTER_AUTH_URL: "https://portal.example.org",
    PORTAL_INTERNAL_URL: "http://portal:8080",
  });
  assert.equal(production.mode, "better_auth");

  assert.throws(() => resolveMode({
    APP_ENV: "production",
    AUTH_MODE: "mock",
    DATABASE_URL: "postgres://localhost/portal",
    AUTH_SERVICE_SECRET: secret,
    MOCK_AUTH_SECRET: "m".repeat(40),
    BETTER_AUTH_URL: "https://portal.example.org",
  }), /Production requires AUTH_MODE=better_auth/u);
  assert.throws(() => resolveMode({
    APP_ENV: "test",
    AUTH_MODE: "mock",
    DATABASE_URL: "postgres://localhost/test",
    AUTH_SERVICE_SECRET: secret,
    MOCK_AUTH_SECRET: "m".repeat(40),
    BETTER_AUTH_URL: "http://localhost:3000",
  }), /only available in development/u);
});

test("development mock requires explicit mode and a separate secret", () => {
  const env = {
    APP_ENV: "development",
    AUTH_MODE: "mock",
    DATABASE_URL: "postgres://localhost/portal_test",
    AUTH_SERVICE_SECRET: secret,
    MOCK_AUTH_SECRET: "m".repeat(40),
    BETTER_AUTH_URL: "http://localhost:3000",
  };
  assert.equal(resolveMode(env).mode, "mock");
  assert.throws(() => resolveMode({ ...env, AUTH_MODE: undefined }), /explicitly set/u);
  assert.throws(() => resolveMode({ ...env, MOCK_AUTH_SECRET: secret }), /must be separate/u);
});

test("email normalization trims and compares full addresses case-insensitively", () => {
  assert.equal(normalizeEmail("  Sam.Example+Abi@EXAMPLE.org \n"), "sam.example+abi@example.org");
  assert.equal(normalizeEmail("sam@example.org\u0000"), null);
  assert.equal(normalizeEmail("sam@example"), null);
  assert.equal(normalizeEmail("sam..example@example.org"), "sam..example@example.org");
});

test("service bearer comparison, UUID validation, and cookies are mode-bound", () => {
  assert.equal(hasServiceAuthorization("Bearer " + secret, secret), true);
  assert.equal(hasServiceAuthorization("Bearer wrong", secret), false);
  assert.equal(hasServiceAuthorization("Basic " + secret, secret), false);
  assert.equal(isUUID("a9e4471b-f303-42fb-a563-51cb90ac34da"), true);
  assert.equal(isUUID("alex_admin"), false);
  assert.notEqual(cookiePrefixFor("mock"), cookiePrefixFor("better_auth"));
});
