"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cookieParser = require("cookie-parser");
const express = require("express");
const { createAdminRouter } = require("../admin/router");
const { accountTokenState, createAccountRouter } = require("../auth/account-router");
const { createAuthRouter } = require("../auth/router");
const { hashPassword } = require("../auth/passwords");
const { HttpError } = require("../lib/http-error");

const ORIGIN = "https://social-ege.example";

function config() {
  return {
    enabled: true,
    secureCookie: false,
    isProduction: false,
    cookieName: "social_ege_session",
    sessionTtlHours: 168,
    accountTokenTtlHours: 72,
    publicOrigin: ORIGIN,
    allowedOrigins: new Set([ORIGIN]),
  };
}

function publicColumns(user) {
  return {
    id: user.id,
    login: user.login,
    display_name: user.display_name,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    middle_name: user.middle_name ?? null,
    account_status: user.account_status,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    activated_at: user.activated_at,
    disabled_at: user.disabled_at,
    archived_at: user.archived_at,
  };
}

function fakePool(initialUsers, initialNow = Date.now()) {
  const state = {
    users: initialUsers,
    sessions: new Map(),
    tokens: [],
    learning: new Map(),
    nextUserId: Math.max(...initialUsers.map((user) => Number(user.id))) + 1,
    nextTokenId: 1,
    nowMs: Number(initialNow),
  };
  state.now = () => new Date(state.nowMs);
  state.setNow = (value) => { state.nowMs = Number(value instanceof Date ? value.getTime() : value); };

  function uniqueLogin(login, exceptId = null) {
    if (state.users.some((user) => user.login === login && String(user.id) !== String(exceptId))) {
      const error = new Error("duplicate");
      error.code = "23505";
      throw error;
    }
  }

  async function query(sql, values = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rows: [] };

    if (normalized.includes("FROM users") && normalized.includes("WHERE login = $1")) {
      const user = state.users.find((item) => item.login === values[0]);
      return { rows: user ? [user] : [] };
    }
    if (normalized.startsWith("INSERT INTO auth_sessions")) {
      state.sessions.set(values[0], { userId: String(values[1]), expiresAt: values[2], revoked: false });
      return { rows: [] };
    }
    if (normalized.startsWith("UPDATE users SET last_login_at")) {
      const user = state.users.find((item) => String(item.id) === String(values[0]));
      if (user) user.last_login_at = new Date();
      return { rows: [] };
    }
    if (normalized.includes("FROM auth_sessions AS s")) {
      const session = state.sessions.get(values[0]);
      const user = session && state.users.find((item) => String(item.id) === session.userId);
      if (!session || session.revoked || session.expiresAt <= new Date()
        || !user?.is_active || user.account_status !== "active") return { rows: [] };
      return { rows: [{ id: user.id, login: user.login, display_name: user.display_name, role: user.role }] };
    }
    if (normalized.startsWith("UPDATE auth_sessions") && normalized.includes("WHERE token_hash = $1")) {
      const session = state.sessions.get(values[0]);
      if (session) session.revoked = true;
      return { rows: [] };
    }
    if (normalized.startsWith("UPDATE auth_sessions") && normalized.includes("WHERE user_id = $1")) {
      for (const session of state.sessions.values()) {
        if (session.userId === String(values[0])) session.revoked = true;
      }
      return { rows: [] };
    }

    if (normalized.includes("FROM users AS u") && normalized.includes("WHERE u.role = 'student'")
      && normalized.includes("ORDER BY")) {
      return { rows: state.users.filter((user) => user.role === "student").map((user) => {
        const activation = state.tokens
          .filter((token) => String(token.userId) === String(user.id) && token.purpose === "activation")
          .sort((left, right) => right.id - left.id)[0];
        let activationStatus = "none";
        if (activation?.usedAt) activationStatus = "used";
        else if (activation?.revokedAt) activationStatus = "revoked";
        else if (activation && activation.expiresAt <= state.now()) activationStatus = "expired";
        else if (activation) activationStatus = "valid";
        return {
          ...publicColumns(user),
          activation_expires_at: activation?.expiresAt ?? null,
          activation_link_status: activationStatus,
        };
      }) };
    }
    if (normalized.startsWith("INSERT INTO users") && normalized.includes("pending_activation")) {
      uniqueLogin(values[0]);
      const user = {
        id: state.nextUserId++, login: values[0], first_name: values[1], last_name: values[2],
        middle_name: values[3], display_name: values[4], password_hash: null,
        role: "student", is_active: false, password_changed_at: null,
        account_status: "pending_activation", created_at: state.now(), updated_at: state.now(),
        last_login_at: null, activated_at: null, disabled_at: null, archived_at: null,
      };
      state.users.push(user);
      return { rows: [publicColumns(user)] };
    }
    if (normalized.startsWith("UPDATE users") && normalized.includes("login = COALESCE")) {
      const user = state.users.find((item) => String(item.id) === String(values[6])
        && item.role === "student" && item.account_status !== "archived");
      if (!user) return { rows: [] };
      if (values[0] !== null) uniqueLogin(values[0], user.id);
      if (values[0] !== null) user.login = values[0];
      if (values[1]) {
        user.first_name = values[2];
        user.last_name = values[3];
        user.middle_name = values[4];
        user.display_name = values[5];
      }
      user.updated_at = new Date();
      return { rows: [publicColumns(user)] };
    }
    if (normalized.startsWith("SELECT id, password_hash, account_status") && normalized.includes("FOR UPDATE")) {
      const user = state.users.find((item) => String(item.id) === String(values[0]) && item.role === "student");
      return { rows: user ? [{ id: user.id, password_hash: user.password_hash, account_status: user.account_status }] : [] };
    }
    if (normalized.startsWith("SELECT id, login, account_status") && normalized.includes("FOR UPDATE")) {
      const user = state.users.find((item) => String(item.id) === String(values[0]) && item.role === "student");
      return { rows: user ? [{ id: user.id, login: user.login, account_status: user.account_status }] : [] };
    }
    if (normalized.startsWith("UPDATE users") && normalized.includes("SET account_status = $1")) {
      const user = state.users.find((item) => String(item.id) === String(values[1]));
      if (!user) return { rows: [] };
      user.account_status = values[0];
      user.is_active = values[0] === "active";
      user.disabled_at = ["blocked", "archived"].includes(values[0]) ? new Date() : null;
      if (values[0] === "archived") user.archived_at = new Date();
      user.updated_at = new Date();
      return { rows: [publicColumns(user)] };
    }

    if (normalized.startsWith("UPDATE account_tokens") && normalized.includes("WHERE user_id = $1")
      && normalized.includes("purpose = $2")) {
      for (const token of state.tokens) {
        if (String(token.userId) === String(values[0]) && token.purpose === values[1]
          && !token.usedAt && !token.revokedAt) token.revokedAt = state.now();
      }
      return { rows: [] };
    }
    if (normalized.startsWith("UPDATE account_tokens") && normalized.includes("WHERE user_id = $1")) {
      for (const token of state.tokens) {
        if (String(token.userId) === String(values[0]) && !token.usedAt && !token.revokedAt) token.revokedAt = state.now();
      }
      return { rows: [] };
    }
    if (normalized.startsWith("INSERT INTO account_tokens")) {
      const createdAt = state.now();
      const expiresAt = new Date(state.nowMs + Number(values[3]) * 60 * 60 * 1000);
      state.tokens.push({
        id: state.nextTokenId++, userId: values[0], tokenHash: values[1], purpose: values[2],
        expiresAt, createdAt, createdBy: values[4], usedAt: null, revokedAt: null,
      });
      return { rows: [{ created_at: createdAt, expires_at: expiresAt }] };
    }
    if (normalized.includes("FROM account_tokens AS t")) {
      const token = state.tokens.find((item) => item.tokenHash === values[0]);
      const user = token && state.users.find((item) => String(item.id) === String(token.userId));
      return { rows: token && user ? [{
        token_id: token.id, user_id: user.id, login: user.login, display_name: user.display_name,
        account_status: user.account_status, password_hash: user.password_hash,
        purpose: token.purpose, expires_at: token.expiresAt, used_at: token.usedAt,
        revoked_at: token.revokedAt, is_unexpired: token.expiresAt > state.now(),
      }] : [] };
    }
    if (normalized.startsWith("UPDATE users") && normalized.includes("password_hash = $1")
      && normalized.includes("account_status = 'active'")) {
      const user = state.users.find((item) => String(item.id) === String(values[1]));
      user.password_hash = values[0];
      user.password_changed_at = new Date();
      user.activated_at ||= new Date();
      user.account_status = "active";
      user.is_active = true;
      user.disabled_at = null;
      return { rows: [] };
    }
    if (normalized.startsWith("UPDATE users") && normalized.includes("password_hash = $1")) {
      const user = state.users.find((item) => String(item.id) === String(values[1]));
      user.password_hash = values[0];
      user.password_changed_at = new Date();
      return { rows: [] };
    }
    if (normalized.startsWith("UPDATE account_tokens SET used_at")) {
      const token = state.tokens.find((item) => String(item.id) === String(values[0]));
      if (token && !token.usedAt) token.usedAt = state.now();
      return { rows: [] };
    }
    if (normalized.startsWith("INSERT INTO audit_log")) return { rows: [] };

    throw new Error(`Unexpected fake database query: ${normalized}`);
  }

  return {
    state,
    query,
    async connect() { return { query, release() {} }; },
  };
}

async function fixture() {
  const adminPassword = "admin-password-123";
  const studentPassword = "student-password-123";
  const now = new Date();
  const pool = fakePool([
    { id: 1, login: "daria", display_name: "Дарья", first_name: null, last_name: null, middle_name: null, password_hash: await hashPassword(adminPassword), role: "admin", is_active: true, account_status: "active", created_at: now, activated_at: now, last_login_at: null, disabled_at: null, archived_at: null },
    { id: 2, login: "student", display_name: "Ученица", first_name: null, last_name: null, middle_name: null, password_hash: await hashPassword(studentPassword), role: "student", is_active: true, account_status: "active", created_at: now, activated_at: now, last_login_at: null, disabled_at: null, archived_at: null },
  ]);
  pool.state.learning.set("2", { topic: "soc1", completed: true });

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use("/api/auth", createAuthRouter(pool, config()));
  app.use("/api/account", createAccountRouter(pool, config()));
  app.use("/api/admin", createAdminRouter(pool, config()));
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
  return {
    pool, adminPassword, studentPassword,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function request(ctx, path, { method = "GET", cookie, body } = {}) {
  return fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "GET" ? {} : { origin: ORIGIN }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function login(ctx, loginName, password) {
  const response = await request(ctx, "/api/auth/login", {
    method: "POST", body: { login: loginName, password, remember: false },
  });
  return { response, cookie: response.ok ? response.headers.get("set-cookie").split(";", 1)[0] : null };
}

function rawToken(url) {
  return new URLSearchParams(new URL(url).hash.slice(1)).get("token");
}

async function createStudent(ctx, cookie, loginName = "new_student", identity = {}) {
  const response = await request(ctx, "/api/admin/students", {
    method: "POST", cookie, body: {
      login: loginName,
      firstName: identity.firstName || "Мария",
      lastName: identity.lastName || "Иванова",
      ...(Object.hasOwn(identity, "middleName") ? { middleName: identity.middleName } : {}),
    },
  });
  return { response, payload: await response.json() };
}

test("A/B: admin API rejects a student with 403 and a missing session with 401", async () => {
  const ctx = await fixture();
  try {
    assert.equal((await request(ctx, "/api/admin/students")).status, 401);
    const student = await login(ctx, "student", ctx.studentPassword);
    assert.equal(student.response.status, 200);
    assert.equal((await request(ctx, "/api/admin/students", { cookie: student.cookie })).status, 403);
  } finally { await ctx.close(); }
});

test("C-F/I: admin creates a passwordless pending student; activation is private and one-time", async () => {
  const ctx = await fixture();
  try {
    const admin = await login(ctx, "daria", ctx.adminPassword);
    const created = await createStudent(ctx, admin.cookie);
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.student.status, "pending_activation");
    assert.equal(created.payload.student.name, "Иванова Мария");
    assert.equal(created.payload.student.firstName, "Мария");
    assert.equal(created.payload.student.lastName, "Иванова");
    assert.equal(created.payload.student.middleName, null);
    const user = ctx.pool.state.users.find((item) => item.login === "new_student");
    assert.equal(user.password_hash, null);
    assert.equal((await login(ctx, "new_student", "some-password-123")).response.status, 401);

    const serialized = JSON.stringify(created.payload);
    assert.doesNotMatch(serialized, /password|hash/i);
    const token = rawToken(created.payload.activationUrl);
    assert.ok(token);
    assert.equal(ctx.pool.state.tokens.some((item) => item.tokenHash === token), false);

    const activation = await request(ctx, "/api/account/activate", {
      method: "POST", body: { token, password: "chosen-password-123" },
    });
    assert.equal(activation.status, 200);
    assert.equal((await request(ctx, "/api/account/activate", {
      method: "POST", body: { token, password: "another-password-123" },
    })).status, 400);
  } finally { await ctx.close(); }
});

test("G/H: an expired activation link fails; an activated student can log in", async () => {
  const ctx = await fixture();
  try {
    const admin = await login(ctx, "daria", ctx.adminPassword);
    const expired = await createStudent(ctx, admin.cookie, "expired_student");
    const expiredToken = rawToken(expired.payload.activationUrl);
    ctx.pool.state.tokens.at(-1).expiresAt = new Date(Date.now() - 1000);
    assert.equal((await request(ctx, "/api/account/activate/validate", {
      method: "POST", body: { token: expiredToken },
    })).status, 400);

    const created = await createStudent(ctx, admin.cookie, "active_student");
    const token = rawToken(created.payload.activationUrl);
    assert.equal((await request(ctx, "/api/account/activate", {
      method: "POST", body: { token, password: "chosen-password-123" },
    })).status, 200);
    assert.equal((await login(ctx, "active_student", "chosen-password-123")).response.status, 200);
  } finally { await ctx.close(); }
});

test("J: issuing a new activation link invalidates the old link", async () => {
  const ctx = await fixture();
  try {
    const admin = await login(ctx, "daria", ctx.adminPassword);
    const created = await createStudent(ctx, admin.cookie, "replace_link");
    const oldToken = rawToken(created.payload.activationUrl);
    const refreshed = await request(ctx, `/api/admin/students/${created.payload.student.id}/activation-link`, { method: "POST", cookie: admin.cookie });
    const newToken = rawToken((await refreshed.json()).url);
    assert.notEqual(oldToken, newToken);
    assert.equal((await request(ctx, "/api/account/activate/validate", {
      method: "POST", body: { token: oldToken },
    })).status, 400);
    assert.equal((await request(ctx, "/api/account/activate/validate", {
      method: "POST", body: { token: newToken },
    })).status, 200);
  } finally { await ctx.close(); }
});

test("K-M: reset link changes the password, invalidates sessions and works once", async () => {
  const ctx = await fixture();
  try {
    const admin = await login(ctx, "daria", ctx.adminPassword);
    const oldSession = await login(ctx, "student", ctx.studentPassword);
    const linkResponse = await request(ctx, "/api/admin/students/2/password-reset-link", { method: "POST", cookie: admin.cookie });
    const token = rawToken((await linkResponse.json()).url);
    assert.equal((await request(ctx, "/api/account/reset-password", {
      method: "POST", body: { token, password: "new-student-password-123" },
    })).status, 200);
    assert.equal((await login(ctx, "student", ctx.studentPassword)).response.status, 401);
    assert.equal((await login(ctx, "student", "new-student-password-123")).response.status, 200);
    assert.equal((await request(ctx, "/api/auth/me", { cookie: oldSession.cookie })).status, 401);
    assert.equal((await request(ctx, "/api/account/reset-password", {
      method: "POST", body: { token, password: "third-student-password-123" },
    })).status, 400);
  } finally { await ctx.close(); }
});

test("N/O: blocked student cannot log in; unblocked student can log in again", async () => {
  const ctx = await fixture();
  try {
    const admin = await login(ctx, "daria", ctx.adminPassword);
    assert.equal((await request(ctx, "/api/admin/students/2/block", { method: "POST", cookie: admin.cookie })).status, 200);
    assert.equal((await login(ctx, "student", ctx.studentPassword)).response.status, 401);
    assert.equal((await request(ctx, "/api/admin/students/2/unblock", { method: "POST", cookie: admin.cookie })).status, 200);
    assert.equal((await login(ctx, "student", ctx.studentPassword)).response.status, 200);
  } finally { await ctx.close(); }
});

test("archive is non-destructive, revokes access and preserves learning data", async () => {
  const ctx = await fixture();
  try {
    const admin = await login(ctx, "daria", ctx.adminPassword);
    const student = await login(ctx, "student", ctx.studentPassword);
    const archived = await request(ctx, "/api/admin/students/2/archive", { method: "POST", cookie: admin.cookie });
    assert.equal(archived.status, 200);
    assert.equal((await archived.json()).student.status, "archived");
    assert.equal((await login(ctx, "student", ctx.studentPassword)).response.status, 401);
    assert.equal((await request(ctx, "/api/auth/me", { cookie: student.cookie })).status, 401);
    assert.deepEqual(ctx.pool.state.learning.get("2"), { topic: "soc1", completed: true });
  } finally { await ctx.close(); }
});

test("P/Q: editing login keeps the user id and learning data; duplicate login is rejected", async () => {
  const ctx = await fixture();
  try {
    const admin = await login(ctx, "daria", ctx.adminPassword);
    const edit = await request(ctx, "/api/admin/students/2", {
      method: "PATCH", cookie: admin.cookie, body: {
        login: "student_new", firstName: "Мария", lastName: "Петрова", middleName: "Сергеевна",
      },
    });
    assert.equal(edit.status, 200);
    const editedStudent = (await edit.json()).student;
    assert.equal(editedStudent.id, "2");
    assert.equal(editedStudent.name, "Петрова Мария Сергеевна");
    assert.deepEqual(ctx.pool.state.learning.get("2"), { topic: "soc1", completed: true });
    assert.equal((await request(ctx, "/api/admin/students/2", {
      method: "PATCH", cookie: admin.cookie, body: { login: "daria" },
    })).status, 409);
  } finally { await ctx.close(); }
});

test("F-I: structured names allow optional patronymics and require unique logins", async () => {
  const ctx = await fixture();
  try {
    const admin = await login(ctx, "daria", ctx.adminPassword);
    const withoutMiddleName = await createStudent(ctx, admin.cookie, "maria_ivanova", {
      firstName: "Мария", lastName: "Иванова",
    });
    assert.equal(withoutMiddleName.response.status, 201);
    assert.equal(withoutMiddleName.payload.student.middleName, null);

    const sameFirstName = await createStudent(ctx, admin.cookie, "maria_petrova", {
      firstName: "Мария", lastName: "Петрова", middleName: "Сергеевна",
    });
    assert.equal(sameFirstName.response.status, 201);
    assert.equal(sameFirstName.payload.student.name, "Петрова Мария Сергеевна");

    const duplicateLogin = await createStudent(ctx, admin.cookie, "maria_ivanova", {
      firstName: "Анна", lastName: "Смирнова",
    });
    assert.equal(duplicateLogin.response.status, 409);
  } finally { await ctx.close(); }
});

test("R/S: neither payload role nor forged identity grants admin privileges", async () => {
  const ctx = await fixture();
  try {
    const student = await login(ctx, "student", ctx.studentPassword);
    assert.equal((await request(ctx, "/api/admin/students/2", {
      method: "PATCH", cookie: student.cookie, body: { role: "admin" },
    })).status, 403);
    assert.equal(ctx.pool.state.users.find((item) => item.id === 2).role, "student");
    assert.equal((await request(ctx, "/api/admin/students?role=admin", {
      cookie: "social_ege_session=this-is-a-forged-session-token-that-is-long-enough",
    })).status, 401);
  } finally { await ctx.close(); }
});

test("token state distinguishes expiry, use, revocation and account state internally", () => {
  const base = {
    purpose: "activation", account_status: "pending_activation",
    used_at: null, revoked_at: null, is_unexpired: true,
  };
  assert.equal(accountTokenState(null, "activation", "pending_activation"), "invalid");
  assert.equal(accountTokenState({ ...base, purpose: "password_reset" }, "activation", "pending_activation"), "wrong_purpose");
  assert.equal(accountTokenState({ ...base, used_at: new Date() }, "activation", "pending_activation"), "used");
  assert.equal(accountTokenState({ ...base, revoked_at: new Date() }, "activation", "pending_activation"), "revoked");
  assert.equal(accountTokenState({ ...base, is_unexpired: false }, "activation", "pending_activation"), "expired");
  assert.equal(accountTokenState({ ...base, account_status: "blocked" }, "activation", "pending_activation"), "account_blocked");
  assert.equal(accountTokenState({ ...base, account_status: "archived" }, "activation", "pending_activation"), "account_archived");
  assert.equal(accountTokenState(base, "activation", "pending_activation"), "valid");
});

test("TTL A-G: activation stays valid through 71h59m and expires at 72h", async () => {
  const ctx = await fixture();
  try {
    const baseTime = Date.parse("2026-10-08T00:00:00.000Z");
    ctx.pool.state.setNow(baseTime);
    const admin = await login(ctx, "daria", ctx.adminPassword);
    const created = await createStudent(ctx, admin.cookie, "ttl_student");
    const token = rawToken(created.payload.activationUrl);
    const stored = ctx.pool.state.tokens.at(-1);
    assert.equal(stored.expiresAt.getTime() - stored.createdAt.getTime(), 72 * 60 * 60 * 1000);
    const listedResponse = await request(ctx, "/api/admin/students", { cookie: admin.cookie });
    const listedPayload = await listedResponse.json();
    const listedStudent = listedPayload.students.find((student) => student.id === created.payload.student.id);
    assert.equal(listedStudent.activationLinkStatus, "valid");
    assert.equal(Date.parse(listedStudent.activationExpiresAt), stored.expiresAt.getTime());
    assert.doesNotMatch(JSON.stringify(listedPayload), /activationUrl|tokenHash|passwordHash/i);

    for (const elapsedMs of [
      0,
      12 * 60 * 60 * 1000,
      13 * 60 * 60 * 1000,
      24 * 60 * 60 * 1000,
      48 * 60 * 60 * 1000,
      (71 * 60 + 59) * 60 * 1000,
    ]) {
      ctx.pool.state.setNow(baseTime + elapsedMs);
      const response = await request(ctx, "/api/account/activate/validate", {
        method: "POST", body: { token },
      });
      assert.equal(response.status, 200, `expected valid token after ${elapsedMs}ms`);
    }

    ctx.pool.state.setNow(baseTime + 72 * 60 * 60 * 1000);
    assert.equal((await request(ctx, "/api/account/activate/validate", {
      method: "POST", body: { token },
    })).status, 400);
    const expiredList = await request(ctx, "/api/admin/students", { cookie: admin.cookie }).then((response) => response.json());
    assert.equal(
      expiredList.students.find((student) => student.id === created.payload.student.id).activationLinkStatus,
      "expired",
    );
  } finally { await ctx.close(); }
});

test("TTL J: process timezone does not change the database-defined lifetime", async () => {
  const ctx = await fixture();
  const originalTimezone = process.env.TZ;
  try {
    const baseTime = Date.parse("2026-03-29T00:30:00.000Z");
    ctx.pool.state.setNow(baseTime);
    const admin = await login(ctx, "daria", ctx.adminPassword);
    const created = await createStudent(ctx, admin.cookie, "timezone_student");
    const studentId = created.payload.student.id;
    const durations = [];

    for (const timezone of ["UTC", "Europe/Moscow", "Pacific/Honolulu"]) {
      process.env.TZ = timezone;
      const response = await request(ctx, `/api/admin/students/${studentId}/activation-link`, {
        method: "POST", cookie: admin.cookie,
      });
      assert.equal(response.status, 200);
      const stored = ctx.pool.state.tokens.at(-1);
      durations.push(stored.expiresAt.getTime() - stored.createdAt.getTime());
    }
    assert.deepEqual(durations, Array(3).fill(72 * 60 * 60 * 1000));
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
    await ctx.close();
  }
});

test("TTL K: password-reset token uses the same 72-hour database clock", async () => {
  const ctx = await fixture();
  try {
    const baseTime = Date.parse("2026-10-08T00:00:00.000Z");
    ctx.pool.state.setNow(baseTime);
    const admin = await login(ctx, "daria", ctx.adminPassword);
    const linkResponse = await request(ctx, "/api/admin/students/2/password-reset-link", {
      method: "POST", cookie: admin.cookie,
    });
    const token = rawToken((await linkResponse.json()).url);
    ctx.pool.state.setNow(baseTime + (71 * 60 + 59) * 60 * 1000);
    assert.equal((await request(ctx, "/api/account/reset-password/validate", {
      method: "POST", body: { token },
    })).status, 200);
    ctx.pool.state.setNow(baseTime + 72 * 60 * 60 * 1000);
    assert.equal((await request(ctx, "/api/account/reset-password/validate", {
      method: "POST", body: { token },
    })).status, 400);
  } finally { await ctx.close(); }
});
