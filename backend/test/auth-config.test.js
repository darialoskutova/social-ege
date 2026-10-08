"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readAuthConfig } = require("../auth/config");

const managedNames = [
  "ALLOWED_ORIGINS",
  "ACCOUNT_TOKEN_TTL_HOURS",
  "AUTH_ENABLED",
  "COOKIE_SECURE",
  "NODE_ENV",
  "PUBLIC_ORIGIN",
  "SESSION_COOKIE_NAME",
  "SESSION_TTL_HOURS",
];

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(managedNames.map((name) => [name, process.env[name]]));
  for (const name of managedNames) delete process.env[name];
  Object.assign(process.env, values);
  try {
    return callback();
  } finally {
    for (const name of managedNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("authentication is disabled safely by default", () => {
  withEnvironment({ NODE_ENV: "production" }, () => {
    const config = readAuthConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.secureCookie, true);
    assert.equal(config.allowedOrigins.size, 0);
  });
});

test("production authentication requires HTTPS origins", () => {
  withEnvironment({
    NODE_ENV: "production",
    AUTH_ENABLED: "true",
    COOKIE_SECURE: "true",
    ALLOWED_ORIGINS: "http://example.test",
  }, () => {
    assert.throws(() => readAuthConfig(), /HTTPS origins/);
  });
});

test("production authentication accepts an exact HTTPS origin", () => {
  withEnvironment({
    NODE_ENV: "production",
    AUTH_ENABLED: "true",
    COOKIE_SECURE: "true",
    ALLOWED_ORIGINS: "https://example.test",
  }, () => {
    const config = readAuthConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.allowedOrigins.has("https://example.test"), true);
    assert.equal(config.publicOrigin, "https://example.test");
    assert.equal(config.accountTokenTtlHours, 72);
  });
});

test("public origin must be one of the exact allowed origins", () => {
  withEnvironment({
    NODE_ENV: "production",
    AUTH_ENABLED: "true",
    COOKIE_SECURE: "true",
    ALLOWED_ORIGINS: "https://example.test",
    PUBLIC_ORIGIN: "https://other.test",
  }, () => {
    assert.throws(() => readAuthConfig(), /also be present/);
  });
});

test("account token TTL rejects invalid configuration instead of silently changing it", () => {
  withEnvironment({ ACCOUNT_TOKEN_TTL_HOURS: "13.5" }, () => {
    assert.throws(() => readAuthConfig(), /ACCOUNT_TOKEN_TTL_HOURS/);
  });
  withEnvironment({ ACCOUNT_TOKEN_TTL_HOURS: "0" }, () => {
    assert.throws(() => readAuthConfig(), /ACCOUNT_TOKEN_TTL_HOURS/);
  });
  withEnvironment({ ACCOUNT_TOKEN_TTL_HOURS: "169" }, () => {
    assert.throws(() => readAuthConfig(), /ACCOUNT_TOKEN_TTL_HOURS/);
  });
});
