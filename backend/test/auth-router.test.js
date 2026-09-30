"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cookieParser = require("cookie-parser");
const express = require("express");
const { createAuthRouter } = require("../auth/router");
const { hashPassword } = require("../auth/passwords");
const { HttpError } = require("../lib/http-error");

function authConfig(overrides = {}) {
  return {
    enabled: false,
    secureCookie: true,
    isProduction: true,
    cookieName: "social_ege_session",
    sessionTtlHours: 168,
    allowedOrigins: new Set(),
    ...overrides,
  };
}

async function startAuthServer(pool, config) {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", createAuthRouter(pool, config));
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  });

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

test("disabled authentication exposes status but rejects login before database access", async () => {
  const pool = {
    query() {
      throw new Error("database must not be queried while authentication is disabled");
    },
  };
  const server = await startAuthServer(pool, authConfig());

  try {
    const statusResponse = await fetch(`${server.baseUrl}/api/auth/status`);
    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), { enabled: false, httpsRequired: true });
    assert.equal(statusResponse.headers.get("cache-control"), "no-store");

    const loginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "student", password: "not-a-real-password" }),
    });
    assert.equal(loginResponse.status, 503);
    assert.equal((await loginResponse.json()).error.code, "auth_unavailable");
  } finally {
    await server.close();
  }
});

test("enabled login requires HTTPS and an allowed exact origin", async () => {
  const config = authConfig({
    enabled: true,
    allowedOrigins: new Set(["https://social-ege.example"]),
  });
  const pool = { query: async () => ({ rows: [] }) };
  const server = await startAuthServer(pool, config);

  try {
    const insecureResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://social-ege.example",
      },
      body: JSON.stringify({ login: "student", password: "not-a-real-password" }),
    });
    assert.equal(insecureResponse.status, 426);

    const missingOriginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ login: "student", password: "not-a-real-password" }),
    });
    assert.equal(missingOriginResponse.status, 403);
  } finally {
    await server.close();
  }
});

test("successful login stores only a token hash and sets a secure cookie", async () => {
  const password = "a sufficiently long password";
  const passwordHash = await hashPassword(password);
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("FROM users")) {
        return {
          rows: [{
            id: 7,
            login: "student",
            display_name: "Ученица",
            password_hash: passwordHash,
            role: "student",
            is_active: true,
          }],
        };
      }
      return { rows: [] };
    },
  };
  const config = authConfig({
    enabled: true,
    allowedOrigins: new Set(["https://social-ege.example"]),
  });
  const server = await startAuthServer(pool, config);

  try {
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://social-ege.example",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ login: "student", password, remember: true }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).user, {
      id: "7",
      login: "student",
      name: "Ученица",
      role: "student",
    });

    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /^social_ege_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Strict/i);

    const sessionInsert = queries.find(({ sql }) => sql.includes("INSERT INTO auth_sessions"));
    assert.ok(sessionInsert);
    assert.match(sessionInsert.values[0], /^[a-f0-9]{64}$/);
    assert.equal(cookie.includes(sessionInsert.values[0]), false);
  } finally {
    await server.close();
  }
});
