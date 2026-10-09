"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cookieParser = require("cookie-parser");
const express = require("express");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAdminRouter } = require("../admin/router");
const { createAuthRouter } = require("../auth/router");
const { hashPassword } = require("../auth/passwords");
const { createLearningRouter } = require("../learning/router");
const { HttpError } = require("../lib/http-error");

const ORIGIN = "https://social-ege.example";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

function config() {
  return {
    enabled: true,
    secureCookie: false,
    isProduction: false,
    cookieName: "social_ege_session",
    sessionTtlHours: 168,
    allowedOrigins: new Set([ORIGIN]),
  };
}

function poolFixture(users) {
  const state = {
    users, sessions: new Map(), mocks: [], homework: [], progress: new Map(),
    nextMockId: 1, nextHomeworkId: 1,
  };

  async function query(sql, values = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rows: [] };
    if (normalized.includes("FROM users") && normalized.includes("WHERE login = $1")) {
      const user = users.find((item) => item.login === values[0]);
      return { rows: user ? [user] : [] };
    }
    if (normalized.startsWith("INSERT INTO auth_sessions")) {
      state.sessions.set(values[0], { userId: String(values[1]), expiresAt: values[2], revoked: false });
      return { rows: [] };
    }
    if (normalized.startsWith("UPDATE users SET last_login_at")) return { rows: [] };
    if (normalized.includes("FROM auth_sessions AS s")) {
      const session = state.sessions.get(values[0]);
      const user = session && users.find((item) => String(item.id) === session.userId);
      if (!session || session.revoked || session.expiresAt <= new Date() || !user?.is_active) return { rows: [] };
      return { rows: [{ id: user.id, login: user.login, display_name: user.display_name, role: user.role }] };
    }
    if (normalized.startsWith("UPDATE auth_sessions")) {
      const session = state.sessions.get(values[0]);
      if (session) session.revoked = true;
      return { rows: [] };
    }
    if (normalized.startsWith("INSERT INTO user_progress")) {
      const row = {
        user_id: String(values[0]), topic_key: values[1], test_completed_at: values[2],
        homework_submitted_at: values[3], updated_at: new Date(),
      };
      state.progress.set(`${values[0]}:${values[1]}`, row);
      return { rows: [row] };
    }
    if (normalized.startsWith("SELECT id, object_key, status FROM mock_submissions")) {
      return { rows: state.mocks.filter((row) => row.user_id === String(values[0]) && row.mock_id === values[1] && row.mock_version === values[2]) };
    }
    if (normalized.startsWith("INSERT INTO mock_submissions")) {
      const row = {
        id: state.nextMockId++, user_id: String(values[0]), mock_id: values[1], mock_version: values[2],
        mock_snapshot: JSON.parse(values[3]), object_key: values[4], original_filename: values[5],
        mime_type: values[6], size_bytes: values[7], file_revision: 1, student_comment: values[8],
        status: "submitted", teacher_comment: "", submitted_at: new Date(), updated_at: new Date(),
      };
      state.mocks.push(row);
      return { rows: [row] };
    }
    if (normalized.startsWith("UPDATE mock_submissions")) {
      const row = state.mocks.find((item) => item.id === values[0] && item.user_id === String(values[1]) && item.mock_version === values[2]);
      Object.assign(row, {
        mock_snapshot: JSON.parse(values[3]), object_key: values[4], original_filename: values[5],
        mime_type: values[6], size_bytes: values[7], student_comment: values[8],
        file_revision: row.file_revision + 1, submitted_at: new Date(), updated_at: new Date(),
      });
      return { rows: [row] };
    }
    if (normalized.startsWith("SELECT id, mock_id") && normalized.includes("FROM mock_submissions")) {
      return { rows: state.mocks.filter((row) => row.user_id === String(values[0])) };
    }
    if (normalized.startsWith("SELECT object_key") && normalized.includes("FROM mock_submissions") && normalized.includes("user_id = $2")) {
      return { rows: state.mocks.filter((row) => String(row.id) === String(values[0]) && row.user_id === String(values[1])) };
    }
    if (normalized.startsWith("SELECT object_key") && normalized.includes("FROM mock_submissions")) {
      return { rows: state.mocks.filter((row) => String(row.id) === String(values[0])) };
    }
    if (normalized.startsWith("SELECT id, object_key, status FROM homework_submissions")) {
      return { rows: state.homework.filter((row) => row.user_id === String(values[0]) && row.topic_key === values[1]).slice(-1) };
    }
    if (normalized.startsWith("INSERT INTO homework_submissions") && normalized.includes("updated_at")) {
      const row = {
        id: state.nextHomeworkId++, user_id: String(values[0]), topic_key: values[1], object_key: values[2],
        original_filename: values[3], mime_type: values[4], size_bytes: values[5], student_comment: values[6],
        status: "submitted", teacher_comment: "", submitted_at: new Date(), updated_at: new Date(),
      };
      state.homework.push(row);
      return { rows: [row] };
    }
    if (normalized.startsWith("UPDATE homework_submissions")) {
      const row = state.homework.find((item) => item.id === values[0] && item.user_id === String(values[1]));
      Object.assign(row, { object_key: values[2], original_filename: values[3], mime_type: values[4], size_bytes: values[5], student_comment: values[6], submitted_at: new Date(), updated_at: new Date() });
      return { rows: [row] };
    }
    throw new Error(`Unexpected query: ${normalized}`);
  }

  return { state, query, async connect() { return { query, release() {} }; } };
}

async function startServer(pool, uploadConfig) {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use("/api/auth", createAuthRouter(pool, config()));
  app.use("/api/admin", createAdminRouter(pool, config(), uploadConfig));
  app.use("/api/learning", createLearningRouter(pool, config(), uploadConfig));
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
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function login(server, loginName, password) {
  const response = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ login: loginName, password, remember: false }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

function upload(server, route, cookie, body = PDF, headers = {}) {
  return fetch(`${server.baseUrl}${route}`, {
    method: "POST",
    headers: {
      origin: ORIGIN, ...(cookie ? { cookie } : {}), "content-type": "application/pdf",
      "x-file-name": encodeURIComponent("работа.pdf"), ...headers,
    },
    body,
  });
}

test("secure homework and mock uploads store real files with owner/admin access", async () => {
  const password = "safe-test-password-123";
  const passwordHash = await hashPassword(password);
  const pool = poolFixture([
    { id: 1, login: "student_a", display_name: "Ученица А", password_hash: passwordHash, role: "student", is_active: true, account_status: "active" },
    { id: 2, login: "student_b", display_name: "Ученица Б", password_hash: passwordHash, role: "student", is_active: true, account_status: "active" },
    { id: 3, login: "teacher", display_name: "Преподаватель", password_hash: passwordHash, role: "admin", is_active: true, account_status: "active" },
  ]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "social-ege-upload-test-"));
  const uploadConfig = { directory, maxBytes: 1024 };
  const server = await startServer(pool, uploadConfig);
  try {
    const headers = {
      "x-mock-id": "politics-1", "x-mock-version": "2027-draft-v1", "x-student-comment": "",
    };
    assert.equal((await upload(server, "/api/learning/mock-submissions/file", null, PDF, headers)).status, 401);

    const studentA = await login(server, "student_a", password);
    const studentB = await login(server, "student_b", password);
    const admin = await login(server, "teacher", password);
    const created = await upload(server, "/api/learning/mock-submissions/file", studentA, PDF, { ...headers, "x-user-id": "2" });
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    assert.equal(pool.state.mocks[0].user_id, "1");
    assert.equal(pool.state.mocks[0].mock_id, "politics-1");
    assert.equal(pool.state.mocks[0].mock_version, "2027-draft-v1");
    assert.ok(fs.existsSync(path.join(directory, pool.state.mocks[0].object_key)));

    const restored = await fetch(`${server.baseUrl}/api/learning/mock-submissions`, { headers: { cookie: studentA } });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).submissions[0].fileName, "работа.pdf");

    pool.state.mocks.push({
      id: pool.state.nextMockId++, user_id: "1", mock_id: "politics-1", mock_version: "2026-legacy-v1",
      mock_snapshot: { title: "Сохранённый пробник", maxScore: 58, contentVersion: "2026-legacy-v1" },
      object_key: pool.state.mocks[0].object_key, original_filename: "старая работа.pdf",
      mime_type: "application/pdf", size_bytes: PDF.length, file_revision: 1,
      student_comment: "", status: "accepted", teacher_comment: "Проверено",
      submitted_at: new Date("2026-06-01T10:00:00Z"), updated_at: new Date("2026-06-02T10:00:00Z"),
    });
    const restoredWithLegacy = await fetch(`${server.baseUrl}/api/learning/mock-submissions`, { headers: { cookie: studentA } });
    const restoredPayload = await restoredWithLegacy.json();
    assert.equal(restoredWithLegacy.status, 200);
    assert.equal(restoredPayload.submissions.find((item) => item.mockVersion === "2026-legacy-v1").mock.title, "Сохранённый пробник");

    const fileRoute = `/api/learning/mock-submissions/${createdPayload.submission.id}/file`;
    assert.equal((await fetch(`${server.baseUrl}${fileRoute}`, { headers: { cookie: studentB } })).status, 404);
    const ownFile = await fetch(`${server.baseUrl}${fileRoute}`, { headers: { cookie: studentA } });
    assert.equal(ownFile.status, 200);
    assert.deepEqual(Buffer.from(await ownFile.arrayBuffer()), PDF);
    const adminFile = await fetch(`${server.baseUrl}/api/admin/mock-submissions/${createdPayload.submission.id}/file`, { headers: { cookie: admin } });
    assert.equal(adminFile.status, 200);
    assert.deepEqual(Buffer.from(await adminFile.arrayBuffer()), PDF);

    const replaced = await upload(server, "/api/learning/mock-submissions/file", studentA, Buffer.concat([PDF, Buffer.from("revision")]), headers);
    assert.equal(replaced.status, 201);
    assert.equal((await replaced.json()).submission.fileRevision, 2);
    assert.equal(fs.readdirSync(directory).length, 1);

    pool.state.mocks[0].status = "in_review";
    assert.equal((await upload(server, "/api/learning/mock-submissions/file", studentA, PDF, headers)).status, 409);
    assert.equal(fs.readdirSync(directory).length, 1);

    assert.equal((await upload(server, "/api/learning/mock-submissions/file", studentA, Buffer.from("not pdf"), headers)).status, 415);
    assert.equal((await upload(server, "/api/learning/mock-submissions/file", studentA, Buffer.alloc(2048), headers)).status, 413);
    assert.equal((await upload(server, "/api/learning/mock-submissions/file", studentA, PDF, { ...headers, "x-file-name": encodeURIComponent("../bad.pdf") })).status, 400);

    const homework = await upload(server, "/api/learning/homework-submissions/file", studentA, PDF, {
      "x-topic-id": "pol29", "x-student-comment": encodeURIComponent("проверить задание 19"),
    });
    assert.equal(homework.status, 201);
    assert.equal(pool.state.homework[0].user_id, "1");
    assert.ok(fs.existsSync(path.join(directory, pool.state.homework[0].object_key)));
  } finally {
    await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("file-submission migration is additive and keeps uploads outside public data", () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, "../migrations/005_file_and_mock_submissions.sql"),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mock_submissions/);
  assert.match(migration, /UNIQUE \(user_id, mock_id, mock_version\)/);
  assert.match(migration, /mock_snapshot JSONB NOT NULL/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS file_revision/);
  assert.doesNotMatch(migration, /(?:^|\n)\s*(?:DROP|TRUNCATE|DELETE)\b/i);
});
