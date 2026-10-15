"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const cookieParser = require("cookie-parser");
const express = require("express");
const { createAdminRouter } = require("../admin/router");
const { HttpError } = require("../lib/http-error");

const ADMIN_TOKEN = "attempt-admin-token-00000000000000000000";
const STUDENT_TOKEN = "attempt-student-token-000000000000000000";

function tokenHash(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function config() {
  return { enabled: true, secureCookie: false, isProduction: false, cookieName: "social_ege_session", sessionTtlHours: 168, allowedOrigins: new Set(["https://social-ege.example"]) };
}

function attemptRow(overrides = {}) {
  return {
    id: 41, user_id: 1, topic_key: "pol29", test_key: "test-29",
    score: 1, max_score: 2, percentage: 50,
    submitted_answers: { q1: ["Ответ ученика"] }, incorrect_question_ids: ["q1"],
    test_version: 2,
    result_snapshot: { questionResults: { q1: { isCorrect: false, submittedAnswers: ["Ответ ученика"], acceptedAnswers: ["Верный ответ"] } } },
    submitted_at: new Date("2026-10-15T10:00:00Z"), attempt_number: 2,
    ...overrides,
  };
}

function poolFixture(rows = [attemptRow()]) {
  const sessions = new Map([
    [tokenHash(ADMIN_TOKEN), { id: 9, login: "teacher", display_name: "Дарья", role: "admin" }],
    [tokenHash(STUDENT_TOKEN), { id: 1, login: "student", display_name: "Ученица", role: "student" }],
  ]);
  return { async query(sql, values = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.includes("FROM auth_sessions AS s")) return { rows: sessions.has(values[0]) ? [sessions.get(values[0])] : [] };
    if (normalized.startsWith("SELECT id, user_id, topic_key") && normalized.includes("FROM test_attempts")) {
      return { rows: rows.filter((row) => String(row.id) === String(values[0]) && String(row.user_id) === String(values[1])) };
    }
    if (normalized.startsWith("SELECT id, login, display_name") && normalized.includes("FROM users")) {
      return { rows: String(values[0]) === "1" ? [{ id: 1, login: "student", display_name: "Ученица", first_name: "Ученица", last_name: "", middle_name: null, account_status: "active", created_at: new Date(), last_login_at: null, activated_at: null, disabled_at: null, archived_at: null }] : [] };
    }
    if (normalized.startsWith("SELECT s.id, s.user_id, s.topic_key") || normalized.startsWith("SELECT s.id, s.user_id, s.mock_id")) return { rows: [] };
    if (normalized.startsWith("SELECT topic_key, test_completed_at")) return { rows: [] };
    if (normalized.startsWith("SELECT id, topic_key, test_key") && normalized.includes("ROW_NUMBER()")) return { rows };
    throw new Error(`Unexpected query: ${normalized}`);
  } };
}

async function fixture(rows = [attemptRow()]) {
  const versions = [];
  const testService = {
    async getHistoricalTest(pool, testId, version) {
      versions.push({ testId, version });
      if (version === 99) return null;
      return { questions: [{ id: "q1", number: 1, type: "text", prompt: "Исторический текст вопроса", options: [], explanation: "Короткое пояснение" }] };
    },
  };
  const studyPlanService = { async getStudyPlan() { return { plan: null, events: [], nextLesson: null }; } };
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use("/api/admin", createAdminRouter(poolFixture(rows), config(), { directory: "/tmp/not-used", maxBytes: 1024 }, studyPlanService, testService));
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
    next(error);
  });
  const server = await new Promise((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  return { versions, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

function request(context, path, token) {
  return fetch(`${context.baseUrl}${path}`, { headers: token ? { cookie: `social_ege_session=${token}` } : {} });
}

test("attempt details require an authenticated admin", async (t) => {
  const context = await fixture(); t.after(context.close);
  assert.equal((await request(context, "/api/admin/students/1/test-attempts/41")).status, 401);
  assert.equal((await request(context, "/api/admin/students/1/test-attempts/41", STUDENT_TOKEN)).status, 403);
});

test("attempt detail is ownership-scoped and rejects IDOR", async (t) => {
  const context = await fixture(); t.after(context.close);
  assert.equal((await request(context, "/api/admin/students/2/test-attempts/41", ADMIN_TOKEN)).status, 404);
});

test("attempt detail uses the exact historical test version", async (t) => {
  const context = await fixture(); t.after(context.close);
  const response = await request(context, "/api/admin/students/1/test-attempts/41", ADMIN_TOKEN);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(context.versions, [{ testId: "test-29", version: 2 }]);
  assert.equal(payload.attempt.questions[0].prompt, "Исторический текст вопроса");
});

test("attempt detail returns student answer, correct answer and result read-only", async (t) => {
  const context = await fixture(); t.after(context.close);
  const payload = await (await request(context, "/api/admin/students/1/test-attempts/41", ADMIN_TOKEN)).json();
  const question = payload.attempt.questions[0];
  assert.deepEqual(question.studentAnswers, ["Ответ ученика"]);
  assert.deepEqual(question.correctAnswers, ["Верный ответ"]);
  assert.equal(question.isCorrect, false);
  assert.equal(question.explanation, "Короткое пояснение");
});

test("attempt detail endpoint has no mutation method", async (t) => {
  const context = await fixture(); t.after(context.close);
  const response = await fetch(`${context.baseUrl}/api/admin/students/1/test-attempts/41`, {
    method: "PATCH",
    headers: { cookie: `social_ege_session=${ADMIN_TOKEN}`, origin: "https://social-ege.example", "content-type": "application/json" },
    body: JSON.stringify({ score: 100, submittedAnswers: { q1: ["подмена"] } }),
  });
  assert.equal(response.status, 404);
});

test("pre-007 attempt degrades honestly without inventing answer details", async (t) => {
  const context = await fixture([attemptRow({ test_version: null, result_snapshot: null })]); t.after(context.close);
  const payload = await (await request(context, "/api/admin/students/1/test-attempts/41", ADMIN_TOKEN)).json();
  assert.equal(payload.attempt.detailsAvailable, false);
  assert.deepEqual(payload.attempt.questions, []);
  assert.match(payload.message, /старой попытки/);
  assert.deepEqual(context.versions, []);
});

test("missing historical version is reported instead of using the current test", async (t) => {
  const context = await fixture([attemptRow({ test_version: 99 })]); t.after(context.close);
  const payload = await (await request(context, "/api/admin/students/1/test-attempts/41", ADMIN_TOKEN)).json();
  assert.equal(payload.attempt.detailsAvailable, false);
  assert.match(payload.message, /Версия теста/);
});

test("student details list contains titles, sections and chronological attempt numbers", async (t) => {
  const rows = [attemptRow({ id: 42, submitted_at: new Date("2026-10-16T10:00:00Z"), attempt_number: 3 }), attemptRow()];
  const context = await fixture(rows); t.after(context.close);
  const response = await request(context, "/api/admin/students/1/details", ADMIN_TOKEN);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.tests[0].title, "Политика. Политическая деятельность");
  assert.equal(payload.tests[0].sectionId, "politics");
  assert.equal(payload.tests[0].attemptNumber, 3);
});
