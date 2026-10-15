"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const cookieParser = require("cookie-parser");
const express = require("express");
const { createAdminRouter } = require("../admin/router");
const { createLearningRouter } = require("../learning/router");
const { HttpError } = require("../lib/http-error");

const ORIGIN = "https://social-ege.example";
const ADMIN_TOKEN = "admin-test-editor-session-token-000000000000";
const STUDENT_TOKEN = "student-test-editor-session-token-0000000000";

function tokenHash(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

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

function memoryPool() {
  const state = {
    editable: new Map(),
    versions: [],
    attempts: [],
    progress: new Map(),
    audits: [],
    nextAttemptId: 1,
    sessions: new Map([
      [tokenHash(ADMIN_TOKEN), { id: 9, login: "teacher", display_name: "Дарья", role: "admin" }],
      [tokenHash(STUDENT_TOKEN), { id: 1, login: "student", display_name: "Ученица", role: "student" }],
    ]),
  };

  async function query(sql, values = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rows: [] };
    if (normalized.includes("FROM auth_sessions AS s")) {
      const user = state.sessions.get(values[0]);
      return { rows: user ? [user] : [] };
    }
    if (normalized.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
    if (normalized.startsWith("SELECT test_key, version, definition, answer_key")
      && normalized.includes("WHERE test_key = $1")) {
      const row = state.editable.get(values[0]);
      return { rows: row ? [row] : [] };
    }
    if (normalized.startsWith("SELECT test_key, version, definition, answer_key")) {
      return { rows: [...state.editable.values()] };
    }
    if (normalized.startsWith("INSERT INTO editable_tests")) {
      const row = {
        test_key: values[0], version: values[1], definition: JSON.parse(values[2]),
        answer_key: JSON.parse(values[3]), updated_at: new Date(), updated_by: values[4],
      };
      state.editable.set(values[0], row);
      return { rows: [row] };
    }
    if (normalized.startsWith("INSERT INTO editable_test_versions")) {
      state.versions.push({ testKey: values[0], version: values[1], definition: values[2], answerKey: values[3] });
      return { rows: [] };
    }
    if (normalized.startsWith("INSERT INTO audit_log") && normalized.includes("'test.updated'")) {
      state.audits.push({ actorId: values[0], testKey: values[1], metadata: JSON.parse(values[2]) });
      return { rows: [] };
    }
    if (normalized.startsWith("INSERT INTO test_attempts")) {
      const row = {
        id: state.nextAttemptId++, user_id: String(values[0]), topic_key: values[1], test_key: values[2],
        score: values[3], max_score: values[4], percentage: values[5], submitted_answers: JSON.parse(values[6]),
        incorrect_question_ids: JSON.parse(values[7]), submitted_at: values[8] ? new Date(values[8]) : new Date(),
        legacy_client_id: values[9], test_version: values[10], result_snapshot: values[11] ? JSON.parse(values[11]) : null,
      };
      state.attempts.push(row);
      return { rows: [row] };
    }
    if (normalized.startsWith("SELECT id, topic_key, test_key") && normalized.includes("FROM test_attempts")) {
      return { rows: state.attempts.filter((row) => row.user_id === String(values[0])) };
    }
    if (normalized.startsWith("INSERT INTO user_progress")) {
      const key = `${values[0]}:${values[1]}`;
      const previous = state.progress.get(key) || {};
      const row = {
        topic_key: values[1],
        test_completed_at: previous.test_completed_at || values[2],
        homework_submitted_at: previous.homework_submitted_at || values[3],
        updated_at: new Date(),
      };
      state.progress.set(key, row);
      return { rows: [row] };
    }
    if (normalized.startsWith("DELETE FROM test_drafts")) return { rows: [] };
    throw new Error(`Unexpected query: ${normalized}`);
  }

  return {
    state,
    query,
    async connect() { return { query, release() {} }; },
  };
}

async function fixture() {
  const pool = memoryPool();
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  const upload = { directory: "/tmp/not-used", maxBytes: 1024 };
  app.use("/api/admin", createAdminRouter(pool, config(), upload));
  app.use("/api/learning", createLearningRouter(pool, config(), upload));
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return {
    pool,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function request(context, path, { token, method = "GET", body } = {}) {
  return fetch(`${context.baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `social_ege_session=${token}` } : {}),
      ...(method === "GET" ? {} : { origin: ORIGIN }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function updatePayload(adminTest, mutate = () => {}) {
  const payload = {
    questions: adminTest.questions.map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      ...(question.type === "text"
        ? { acceptedAnswers: [...question.acceptedAnswers] }
        : { options: question.options.map((option) => ({ ...option })) }),
    })),
  };
  mutate(payload);
  return payload;
}

test("admin test editor is role-protected, persists edits and versions server-side scoring", async () => {
  const context = await fixture();
  try {
    const deniedRead = await request(context, "/api/admin/tests/test-01", { token: STUDENT_TOKEN });
    assert.equal(deniedRead.status, 403);

    const adminResponse = await request(context, "/api/admin/tests/test-01", { token: ADMIN_TOKEN });
    assert.equal(adminResponse.status, 200);
    const original = (await adminResponse.json()).test;
    assert.equal(original.version, 1);
    assert.ok(original.questions.some((question) => question.options.some((option) => option.correct)));

    const target = original.questions.find((question) => question.type === "checkbox" && question.points > 0);
    assert.ok(target);
    const oldCorrect = target.options.filter((option) => option.correct).map((option) => option.text);
    const oldAttemptResponse = await request(context, "/api/learning/test-attempts", {
      token: STUDENT_TOKEN,
      method: "POST",
      body: { topicId: "soc1", testId: "test-01", submittedAnswers: { [target.id]: oldCorrect } },
    });
    assert.equal(oldAttemptResponse.status, 201);
    const oldAttempt = (await oldAttemptResponse.json()).attempt;
    assert.equal(oldAttempt.review.questionResults[target.id].isCorrect, true);
    const storedBeforeEdit = JSON.stringify(context.pool.state.attempts[0]);

    const changedPrompt = `${target.prompt} (уточнено)`;
    const payload = updatePayload(original, (draft) => {
      const question = draft.questions.find((item) => item.id === target.id);
      question.prompt = changedPrompt;
      question.options.forEach((option, index) => { option.correct = index === 0; });
    });
    const saved = await request(context, "/api/admin/tests/test-01", {
      token: ADMIN_TOKEN, method: "PUT", body: payload,
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).test.version, 2);

    const reread = await request(context, "/api/admin/tests/test-01", { token: ADMIN_TOKEN });
    const persisted = (await reread.json()).test;
    assert.equal(persisted.questions.find((question) => question.id === target.id).prompt, changedPrompt);
    assert.equal(context.pool.state.versions.length, 1);
    assert.equal(context.pool.state.audits[0].metadata.version, 2);

    const studentDefinition = await request(context, "/api/learning/tests/test-01", { token: STUDENT_TOKEN });
    const studentPayload = await studentDefinition.json();
    assert.equal(studentDefinition.status, 200);
    assert.equal(JSON.stringify(studentPayload).includes("acceptedAnswers"), false);
    assert.equal(JSON.stringify(studentPayload).includes('"correct"'), false);

    const newCorrect = persisted.questions.find((question) => question.id === target.id).options[0].text;
    const newAttemptResponse = await request(context, "/api/learning/test-attempts", {
      token: STUDENT_TOKEN,
      method: "POST",
      body: { topicId: "soc1", testId: "test-01", submittedAnswers: { [target.id]: [newCorrect] } },
    });
    assert.equal(newAttemptResponse.status, 201);
    const newAttempt = (await newAttemptResponse.json()).attempt;
    assert.equal(newAttempt.testVersion, 2);
    assert.equal(newAttempt.review.questionResults[target.id].isCorrect, true);
    assert.equal(JSON.stringify(context.pool.state.attempts[0]), storedBeforeEdit);

    const forbiddenWrite = await request(context, "/api/admin/tests/test-01", {
      token: STUDENT_TOKEN, method: "PUT", body: payload,
    });
    assert.equal(forbiddenWrite.status, 403);

    const invalid = updatePayload(persisted, (draft) => {
      draft.questions[0].prompt = "";
    });
    const beforeInvalid = JSON.stringify(context.pool.state.editable.get("test-01"));
    const rejected = await request(context, "/api/admin/tests/test-01", {
      token: ADMIN_TOKEN, method: "PUT", body: invalid,
    });
    assert.equal(rejected.status, 400);
    assert.equal(JSON.stringify(context.pool.state.editable.get("test-01")), beforeInvalid);
  } finally {
    await context.close();
  }
});

test("test list supports all static tests without exposing answer keys to a student", async () => {
  const context = await fixture();
  try {
    const anonymous = await request(context, "/api/learning/tests");
    assert.equal(anonymous.status, 401);
    const admin = await request(context, "/api/admin/tests", { token: ADMIN_TOKEN });
    assert.equal(admin.status, 200);
    assert.equal((await admin.json()).tests.length, 56);
    const student = await request(context, "/api/learning/tests", { token: STUDENT_TOKEN });
    assert.equal(student.status, 200);
    const body = await student.text();
    assert.equal(body.includes("acceptedAnswers"), false);
  } finally {
    await context.close();
  }
});
