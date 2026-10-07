"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cookieParser = require("cookie-parser");
const express = require("express");
const { createAuthRouter } = require("../auth/router");
const { hashPassword } = require("../auth/passwords");
const { createLearningRouter } = require("../learning/router");
const { HttpError } = require("../lib/http-error");

const ORIGIN = "https://social-ege.example";

function authConfig() {
  return {
    enabled: true,
    secureCookie: false,
    isProduction: false,
    cookieName: "social_ege_session",
    sessionTtlHours: 168,
    allowedOrigins: new Set([ORIGIN]),
  };
}

function createPool(users) {
  const state = {
    users,
    sessions: new Map(),
    progress: new Map(),
    drafts: new Map(),
    attempts: [],
    homework: [],
    messages: [],
    nextAttemptId: 1,
    nextHomeworkId: 1,
    nextMessageId: 1,
  };

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
    if (normalized.startsWith("UPDATE users SET last_login_at")) return { rows: [] };
    if (normalized.includes("FROM auth_sessions AS s")) {
      const session = state.sessions.get(values[0]);
      const user = session && state.users.find((item) => String(item.id) === session.userId);
      if (!session || session.revoked || session.expiresAt <= new Date() || !user?.is_active) return { rows: [] };
      return { rows: [{ id: user.id, login: user.login, display_name: user.display_name, role: user.role }] };
    }
    if (normalized.startsWith("UPDATE auth_sessions")) {
      const session = state.sessions.get(values[0]);
      if (session) session.revoked = true;
      return { rows: [] };
    }

    if (normalized.startsWith("SELECT topic_key") && normalized.includes("FROM user_progress")) {
      return { rows: [...state.progress.values()].filter((row) => row.user_id === String(values[0])) };
    }
    if (normalized.startsWith("INSERT INTO user_progress")) {
      const key = `${values[0]}:${values[1]}`;
      const previous = state.progress.get(key);
      const row = {
        user_id: String(values[0]),
        topic_key: values[1],
        test_completed_at: previous?.test_completed_at || values[2],
        homework_submitted_at: previous?.homework_submitted_at || values[3],
        updated_at: new Date(),
      };
      state.progress.set(key, row);
      return { rows: [row] };
    }

    if (normalized.startsWith("SELECT test_key") && normalized.includes("FROM test_drafts")) {
      return { rows: [...state.drafts.values()].filter((row) => row.user_id === String(values[0])) };
    }
    if (normalized.startsWith("INSERT INTO test_drafts")) {
      const row = {
        user_id: String(values[0]), test_key: values[1], topic_key: values[2],
        answers: JSON.parse(values[3]), updated_at: new Date(),
      };
      state.drafts.set(`${values[0]}:${values[1]}`, row);
      return { rows: [row] };
    }
    if (normalized.startsWith("DELETE FROM test_drafts")) {
      state.drafts.delete(`${values[0]}:${values[1]}`);
      return { rows: [] };
    }

    if (normalized.startsWith("SELECT id") && normalized.includes("FROM test_attempts") && normalized.includes("legacy_client_id")) {
      return { rows: state.attempts.filter((row) => row.user_id === String(values[0]) && row.legacy_client_id === values[1]) };
    }
    if (normalized.startsWith("SELECT id") && normalized.includes("FROM test_attempts")) {
      return { rows: state.attempts.filter((row) => row.user_id === String(values[0])) };
    }
    if (normalized.startsWith("INSERT INTO test_attempts")) {
      const duplicate = values[9] && state.attempts.find((row) => row.user_id === String(values[0]) && row.legacy_client_id === values[9]);
      if (duplicate) return { rows: [] };
      const row = {
        id: state.nextAttemptId++, user_id: String(values[0]), topic_key: values[1], test_key: values[2],
        score: values[3], max_score: values[4], percentage: values[5],
        submitted_answers: JSON.parse(values[6]), incorrect_question_ids: JSON.parse(values[7]),
        submitted_at: values[8] ? new Date(values[8]) : new Date(), legacy_client_id: values[9],
      };
      state.attempts.push(row);
      return { rows: [row] };
    }

    if (normalized.startsWith("SELECT id") && normalized.includes("FROM homework_submissions") && normalized.includes("legacy_client_id")) {
      return { rows: state.homework.filter((row) => row.user_id === String(values[0]) && row.legacy_client_id === values[1]) };
    }
    if (normalized.startsWith("SELECT id") && normalized.includes("FROM homework_submissions")) {
      return { rows: state.homework.filter((row) => row.user_id === String(values[0])) };
    }
    if (normalized.startsWith("INSERT INTO homework_submissions")) {
      const duplicate = values[7] && state.homework.find((row) => row.user_id === String(values[0]) && row.legacy_client_id === values[7]);
      if (duplicate) return { rows: [] };
      const row = {
        id: state.nextHomeworkId++, user_id: String(values[0]), topic_key: values[1],
        original_filename: values[2], student_comment: values[5], status: "submitted",
        teacher_comment: "", submitted_at: values[6] ? new Date(values[6]) : new Date(), legacy_client_id: values[7],
      };
      state.homework.push(row);
      return { rows: [row] };
    }

    if (normalized.startsWith("SELECT id") && normalized.includes("FROM teacher_messages") && normalized.includes("legacy_client_id")) {
      return { rows: state.messages.filter((row) => row.student_id === String(values[0]) && row.legacy_client_id === values[1]) };
    }
    if (normalized.startsWith("SELECT id") && normalized.includes("FROM teacher_messages")) {
      return { rows: state.messages.filter((row) => row.student_id === String(values[0])) };
    }
    if (normalized.startsWith("INSERT INTO teacher_messages")) {
      const row = {
        id: state.nextMessageId++, student_id: String(values[0]), category: values[1], body: values[2],
        teacher_reply: null, created_at: values[3] ? new Date(values[3]) : new Date(), legacy_client_id: values[4],
      };
      state.messages.push(row);
      return { rows: [row] };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  }

  return {
    state,
    query,
    async connect() {
      return { query, release() {} };
    },
  };
}

async function startServer(pool) {
  const config = authConfig();
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use("/api/auth", createAuthRouter(pool, config));
  app.use("/api/learning", createLearningRouter(pool, config));
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

function request(server, path, { method = "GET", cookie, body } = {}) {
  return fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "GET" ? {} : { origin: ORIGIN }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function login(server, loginName, password) {
  const response = await request(server, "/api/auth/login", {
    method: "POST",
    body: { login: loginName, password, remember: false },
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

async function fixture() {
  const password = "safe-test-password-123";
  const passwordHash = await hashPassword(password);
  const pool = createPool([
    { id: 1, login: "student_a", display_name: "Ученица А", password_hash: passwordHash, role: "student", is_active: true },
    { id: 2, login: "student_b", display_name: "Ученица Б", password_hash: passwordHash, role: "student", is_active: true },
  ]);
  const server = await startServer(pool);
  return { password, pool, server };
}

test("A/B: progress endpoints reject requests without a server session", async () => {
  const { server } = await fixture();
  try {
    assert.equal((await request(server, "/api/learning/progress")).status, 401);
    assert.equal((await request(server, "/api/learning/progress/soc1", { method: "PUT", body: { testCompleted: true } })).status, 401);
  } finally {
    await server.close();
  }
});

test("C/D: progress belongs to the authenticated user and survives a new login", async () => {
  const { server, pool, password } = await fixture();
  try {
    const firstCookie = await login(server, "student_a", password);
    const saved = await request(server, "/api/learning/progress/soc1", {
      method: "PUT", cookie: firstCookie, body: { testCompleted: true },
    });
    assert.equal(saved.status, 200);
    assert.equal(pool.state.progress.get("1:soc1").user_id, "1");

    const secondCookie = await login(server, "student_a", password);
    const loaded = await request(server, "/api/learning/progress", { cookie: secondCookie });
    assert.equal(loaded.status, 200);
    assert.equal((await loaded.json()).progress[0].topicId, "soc1");
  } finally {
    await server.close();
  }
});

test("E: a test attempt and its progress remain available in a new session", async () => {
  const { server, password } = await fixture();
  try {
    const cookie = await login(server, "student_a", password);
    const saved = await request(server, "/api/learning/test-attempts", {
      method: "POST", cookie,
      body: { topicId: "soc2", testId: "test-02", scorePoints: 7, scoreTotal: 10, submittedAnswers: { q1: ["ответ"] }, incorrectQuestionIds: ["q2"] },
    });
    assert.equal(saved.status, 201);
    const nextCookie = await login(server, "student_a", password);
    const loaded = await request(server, "/api/learning/test-attempts", { cookie: nextCookie });
    const payload = await loaded.json();
    assert.equal(payload.attempts.length, 1);
    assert.equal(payload.attempts[0].scorePercent, 70);
  } finally {
    await server.close();
  }
});

test("test drafts persist until a confirmed attempt removes them", async () => {
  const { server, password } = await fixture();
  try {
    const cookie = await login(server, "student_a", password);
    const draft = await request(server, "/api/learning/test-drafts/test-04", {
      method: "PUT", cookie, body: { topicId: "soc4", answers: { "test-04-q-001": ["1"] } },
    });
    assert.equal(draft.status, 200);
    assert.equal((await request(server, "/api/learning/test-drafts", { cookie }).then((response) => response.json())).drafts.length, 1);

    await request(server, "/api/learning/test-attempts", {
      method: "POST", cookie,
      body: { topicId: "soc4", testId: "test-04", scorePoints: 1, scoreTotal: 1, submittedAnswers: { "test-04-q-001": ["1"] }, incorrectQuestionIds: [] },
    });
    assert.equal((await request(server, "/api/learning/test-drafts", { cookie }).then((response) => response.json())).drafts.length, 0);
  } finally {
    await server.close();
  }
});

test("scoped legacy IDs make retrying a browser migration idempotent", async () => {
  const { server, pool, password } = await fixture();
  try {
    const cookie = await login(server, "student_a", password);
    const body = {
      topicId: "soc5", testId: "test-05", scorePoints: null, scoreTotal: null,
      submittedAnswers: {}, incorrectQuestionIds: [], legacyClientId: "legacy-attempt-1",
      legacyCreatedAt: "2026-09-01T10:00:00.000Z",
    };
    assert.equal((await request(server, "/api/learning/test-attempts", { method: "POST", cookie, body })).status, 201);
    assert.equal((await request(server, "/api/learning/test-attempts", { method: "POST", cookie, body })).status, 201);
    assert.equal(pool.state.attempts.length, 1);
  } finally {
    await server.close();
  }
});

test("F: homework metadata remains available in a new session", async () => {
  const { server, password } = await fixture();
  try {
    const cookie = await login(server, "student_a", password);
    const saved = await request(server, "/api/learning/homework-submissions", {
      method: "POST", cookie,
      body: { topicId: "law44", originalFilename: "answer.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 2048, studentComment: "Готово" },
    });
    assert.equal(saved.status, 201);
    const nextCookie = await login(server, "student_a", password);
    const loaded = await request(server, "/api/learning/homework-submissions", { cookie: nextCookie });
    assert.equal((await loaded.json()).submissions[0].fileName, "answer.docx");
  } finally {
    await server.close();
  }
});

test("G: one user cannot read another user's learning records", async () => {
  const { server, password } = await fixture();
  try {
    const cookieB = await login(server, "student_b", password);
    await request(server, "/api/learning/progress/law44", { method: "PUT", cookie: cookieB, body: { testCompleted: true } });
    const cookieA = await login(server, "student_a", password);
    const response = await request(server, "/api/learning/progress?user_id=2", { cookie: cookieA });
    assert.deepEqual((await response.json()).progress, []);
  } finally {
    await server.close();
  }
});

test("H/I: forged owner fields are rejected and never change record ownership", async () => {
  const { server, pool, password } = await fixture();
  try {
    const cookieA = await login(server, "student_a", password);
    const forgedProgress = await request(server, "/api/learning/progress/soc3", {
      method: "PUT", cookie: cookieA, body: { testCompleted: true, userId: "2" },
    });
    assert.equal(forgedProgress.status, 400);
    const forgedAttempt = await request(server, "/api/learning/test-attempts", {
      method: "POST", cookie: cookieA,
      body: { topicId: "soc3", testId: "test-03", scorePoints: 1, scoreTotal: 2, submittedAnswers: {}, incorrectQuestionIds: [], user_id: "2" },
    });
    assert.equal(forgedAttempt.status, 400);
    assert.equal(pool.state.progress.has("2:soc3"), false);
    assert.equal(pool.state.attempts.length, 0);
  } finally {
    await server.close();
  }
});

test("J: logout revokes access to all learning endpoints", async () => {
  const { server, password } = await fixture();
  try {
    const cookie = await login(server, "student_a", password);
    const logout = await request(server, "/api/auth/logout", { method: "POST", cookie });
    assert.equal(logout.status, 204);
    assert.equal((await request(server, "/api/learning/progress", { cookie })).status, 401);
  } finally {
    await server.close();
  }
});
