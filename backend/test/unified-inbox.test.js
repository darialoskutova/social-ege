"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const cookieParser = require("cookie-parser");
const express = require("express");
const { createAdminRouter } = require("../admin/router");
const { HttpError } = require("../lib/http-error");
const {
  buildUnifiedInbox,
  listUnseenTestAttempts,
  markTestAttemptSeen,
} = require("../inbox/service");

const ROOT = path.resolve(__dirname, "../..");
const ORIGIN = "https://social-ege.example";
const ADMIN_TOKEN = "unified-inbox-admin-token-00000000000000";
const STUDENT_TOKEN = "unified-inbox-student-token-000000000000";

function hashToken(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function attempt(overrides = {}) {
  return {
    id: "test:501", kind: "test", label: "Новый результат теста",
    studentId: "7", studentName: "Мария Иванова", studentLogin: "maria",
    attemptId: "501", attemptNumber: 1, testId: "test-44", topicId: "law44",
    title: "Право в системе социальных норм", sectionId: "law", sectionTitle: "Право",
    score: 8, maxScore: 10, percentage: 80, unreadMessageCount: 0,
    occurredAt: "2026-10-20T10:00:00.000Z", ...overrides,
  };
}

function submission(type = "homework", overrides = {}) {
  return {
    id: type === "mock" ? "201" : "101", type, studentId: "7",
    studentName: "Мария Иванова", studentLogin: "maria",
    topicId: type === "homework" ? "law44" : null,
    mockId: type === "mock" ? "law-1" : null,
    mock: type === "mock" ? { title: "Пробник по праву" } : null,
    fileName: "ответ.pdf", fileRevision: 1, teacherSeenRevision: 0,
    status: "submitted", updatedAt: "2026-10-20T11:00:00.000Z", ...overrides,
  };
}

function conversation(overrides = {}) {
  return {
    subjectType: "homework", subjectId: "101", studentId: "7",
    studentName: "Мария Иванова", studentLogin: "maria", unreadCount: 1,
    preview: "Подскажите, пожалуйста", attachmentFilename: null,
    topicId: "law44", subjectTitle: null, lastMessageAt: "2026-10-20T12:00:00.000Z",
    ...overrides,
  };
}

function build(input = {}) {
  return buildUnifiedInbox({
    attempts: input.attempts || [],
    submissions: input.submissions || [],
    conversations: input.conversations || [],
  });
}

test("1 a new completed test attempt is selected only while teacher_seen_at is null", async () => {
  let sql = "";
  await listUnseenTestAttempts({ query: async (statement) => { sql = statement; return { rows: [] }; } });
  assert.match(sql, /a\.teacher_seen_at IS NULL/);
});

test("2 an unseen attempt carries the exact student, score and attempt number", async () => {
  const rows = [{
    id: 501, user_id: 7, topic_key: "law44", test_key: "test-44", score: 8,
    max_score: 10, percentage: "80.00", submitted_at: new Date("2026-10-20T10:00:00Z"),
    login: "maria", display_name: "Мария Иванова", attempt_number: "2", unread_message_count: "0",
  }];
  const [item] = await listUnseenTestAttempts({ query: async () => ({ rows }) });
  assert.deepEqual([item.studentId, item.studentName, item.score, item.maxScore, item.attemptNumber], ["7", "Мария Иванова", 8, 10, 2]);
});

test("3 a test Inbox action targets the immutable exact attempt id", async () => {
  const rows = [{ id: 777, user_id: 7, topic_key: "law44", test_key: "test-44", score: 1, max_score: 2, percentage: 50, submitted_at: new Date(), login: "maria", display_name: "Мария", attempt_number: 3, unread_message_count: 0 }];
  const [item] = await listUnseenTestAttempts({ query: async () => ({ rows }) });
  assert.equal(item.attemptId, "777");
  assert.equal(item.id, "test:777");
});

test("4 opening an attempt marks it seen server-side without trusting a client flag", async () => {
  let values;
  const result = await markTestAttemptSeen({ query: async (sql, parameters) => {
    assert.match(sql, /SET teacher_seen_at = COALESCE\(teacher_seen_at, NOW\(\)\)/);
    values = parameters;
    return { rows: [{ id: 501, teacher_seen_at: new Date("2026-10-20T13:00:00Z") }] };
  } }, "501");
  assert.deepEqual(values, ["501"]);
  assert.equal(result.id, "501");
});

test("5 a missing attempt cannot be acknowledged", async () => {
  await assert.rejects(
    markTestAttemptSeen({ query: async () => ({ rows: [] }) }, "999"),
    (error) => error instanceof HttpError && error.status === 404,
  );
});

test("6 a second attempt for the same test remains a separate new Inbox item", () => {
  const result = build({ attempts: [attempt(), attempt({ id: "test:502", attemptId: "502", attemptNumber: 2 })] });
  assert.deepEqual(result.items.map((item) => item.attemptId).sort(), ["501", "502"]);
});

test("7 historical test attempts are backfilled as seen by migration 011", () => {
  const sql = fs.readFileSync(path.join(ROOT, "backend/migrations/011_unified_inbox.sql"), "utf8");
  assert.match(sql, /UPDATE test_attempts\s+SET teacher_seen_at = NOW\(\)\s+WHERE teacher_seen_at IS NULL;/);
});

test("8 a first homework submission is a new work item", () => {
  const [item] = build({ submissions: [submission()] }).items;
  assert.equal(item.kind, "work");
  assert.equal(item.label, "Новая работа");
});

test("9 a homework resubmission is labelled as a repeated submission", () => {
  const [item] = build({ submissions: [submission("homework", { fileRevision: 2, teacherSeenRevision: 1 })] }).items;
  assert.equal(item.label, "Повторная сдача");
});

test("10 a reviewed revision leaves the queue and a later revision enters again", () => {
  assert.equal(build({ submissions: [submission("homework", { fileRevision: 2, teacherSeenRevision: 2 })] }).items.length, 0);
  assert.equal(build({ submissions: [submission("homework", { fileRevision: 3, teacherSeenRevision: 2 })] }).items.length, 1);
});

test("11 a first thematic mock submission is a new work item", () => {
  const [item] = build({ submissions: [submission("mock")] }).items;
  assert.equal(item.submission.type, "mock");
  assert.equal(item.label, "Новая работа");
});

test("12 a thematic mock resubmission creates a repeated-submission item", () => {
  const [item] = build({ submissions: [submission("mock", { fileRevision: 4, teacherSeenRevision: 3 })] }).items;
  assert.equal(item.label, "Повторная сдача");
});

test("13 a new student text message appears as a message action", () => {
  const [item] = build({ conversations: [conversation()] }).items;
  assert.equal(item.kind, "message");
  assert.equal(item.preview, "Подскажите, пожалуйста");
});

test("14 an attachment-only student message keeps its protected file preview", () => {
  const [item] = build({ conversations: [conversation({ preview: "Прикреплён файл: ответ.pdf", attachmentFilename: null })] }).items;
  assert.match(item.preview, /ответ\.pdf/);
});

test("15 a text-plus-attachment message exposes both preview and filename", () => {
  const [item] = build({ conversations: [conversation({ preview: "Исправила", attachmentFilename: "ответ.pdf" })] }).items;
  assert.deepEqual([item.preview, item.attachmentFilename], ["Исправила", "ответ.pdf"]);
});

test("16 teacher replies are excluded from the admin unread query", () => {
  const source = fs.readFileSync(path.join(ROOT, "backend/conversations/service.js"), "utf8");
  assert.match(source, /unread\.sender_role = 'student'/);
  assert.match(source, /unread\.teacher_read_at IS NULL/);
});

test("17 a message on an already-seen test creates only the message action", () => {
  const result = build({ conversations: [conversation({ subjectType: "test_attempt", subjectId: "501" })] });
  assert.deepEqual(result.items.map((item) => item.kind), ["message"]);
});

test("18 rebuilding the Inbox does not duplicate stable action ids", () => {
  const input = { attempts: [attempt()], submissions: [submission()], conversations: [conversation()] };
  assert.deepEqual(build(input).items.map((item) => item.id), build(input).items.map((item) => item.id));
  assert.equal(new Set(build(input).items.map((item) => item.id)).size, 3);
});

test("19 the badge counts attempts, work revisions and each unread student message", () => {
  const result = build({ attempts: [attempt()], submissions: [submission()], conversations: [conversation({ unreadCount: 3 })] });
  assert.deepEqual(result.counts, { unseenTests: 1, unseenWorks: 1, unreadMessages: 3, total: 5 });
});

test("20 queue actions are ordered newest first across all types", () => {
  const result = build({ attempts: [attempt()], submissions: [submission()], conversations: [conversation()] });
  assert.deepEqual(result.items.map((item) => item.kind), ["message", "work", "test"]);
});

function endpointPool() {
  const seen = new Set();
  return {
    seen,
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.includes("FROM auth_sessions AS s")) {
        if (values[0] === hashToken(ADMIN_TOKEN)) return { rows: [{ id: 9, login: "teacher", display_name: "Дарья", role: "admin" }] };
        if (values[0] === hashToken(STUDENT_TOKEN)) return { rows: [{ id: 7, login: "maria", display_name: "Мария", role: "student" }] };
        return { rows: [] };
      }
      if (normalized.startsWith("UPDATE test_attempts") && normalized.includes("teacher_seen_at")) {
        seen.add(String(values[0]));
        return { rows: [{ id: values[0], teacher_seen_at: new Date() }] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
}

async function endpointFixture(t) {
  const pool = endpointPool();
  const config = { enabled: true, secureCookie: false, isProduction: false, cookieName: "social_ege_session", allowedOrigins: new Set([ORIGIN]) };
  const uploadConfig = { directory: "/tmp/social-ege-test-uploads", maxBytes: 1024, allowedMimes: [] };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", createAdminRouter(pool, config, uploadConfig));
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: { code: error.code } });
    return next(error);
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return { pool, url: `http://127.0.0.1:${server.address().port}` };
}

function acknowledge(fixture, token) {
  return fetch(`${fixture.url}/api/admin/inbox/test-attempts/501/seen`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...(token ? { cookie: `social_ege_session=${token}` } : {}) },
    body: "{}",
  });
}

test("21 the acknowledgement endpoint rejects a missing session", async (t) => {
  const fixture = await endpointFixture(t);
  assert.equal((await acknowledge(fixture)).status, 401);
});

test("22 the acknowledgement endpoint rejects a student role", async (t) => {
  const fixture = await endpointFixture(t);
  assert.equal((await acknowledge(fixture, STUDENT_TOKEN)).status, 403);
});

test("23 an authenticated admin can acknowledge the exact attempt", async (t) => {
  const fixture = await endpointFixture(t);
  const response = await acknowledge(fixture, ADMIN_TOKEN);
  assert.equal(response.status, 200);
  assert.equal(fixture.pool.seen.has("501"), true);
});

test("24 the admin frontend renders one unified queue with four type filters", () => {
  const html = fs.readFileSync(path.join(ROOT, "admin/index.html"), "utf8");
  assert.equal((html.match(/data-inbox-list/g) || []).length, 1);
  assert.deepEqual([...html.matchAll(/data-inbox-kind="([^"]+)"/g)].map((match) => match[1]), ["all", "test", "work", "message"]);
  assert.doesNotMatch(html, /data-conversation-inbox-list/);
});

test("25 Inbox test and message actions navigate to exact attempts and conversations", () => {
  const source = fs.readFileSync(path.join(ROOT, "admin/admin.js"), "utf8");
  assert.match(source, /data-open-inbox-attempt/);
  assert.match(source, /await openAttempt\(attemptId\)/);
  assert.match(source, /data-open-inbox-conversation/);
  assert.match(source, /openAdminConversation\(type, id\)/);
});

test("26 the Inbox layout has responsive single-column actions without horizontal overflow", () => {
  const css = fs.readFileSync(path.join(ROOT, "admin/admin.css"), "utf8");
  assert.match(css, /\.unified-inbox-card \{ min-width: 0; \}/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.unified-inbox-compact \{ grid-template-columns: 1fr;/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("27 migration 011 is additive and does not delete existing learning data", () => {
  const sql = fs.readFileSync(path.join(ROOT, "backend/migrations/011_unified_inbox.sql"), "utf8");
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
  assert.equal((sql.match(/ADD COLUMN/g) || []).length, 3);
  assert.match(sql, /teacher_seen_revision = file_revision/);
});

test("28 reviewing a work acknowledges only its current server-side revision", () => {
  const source = fs.readFileSync(path.join(ROOT, "backend/admin/router.js"), "utf8");
  assert.match(source, /teacher_seen_revision = file_revision/);
  assert.match(source, /RETURNING user_id, file_revision/);
});

test("29 Stage 11 attachment and conversation routes remain present", () => {
  const source = fs.readFileSync(path.join(ROOT, "backend/admin/router.js"), "utf8");
  assert.match(source, /\/conversations\/:subjectType\/:subjectId\/messages\/file/);
  assert.match(source, /\/conversations\/attachments\/:attachmentId\/file/);
});

test("30 the unified queue retains protected no-store responses", () => {
  const source = fs.readFileSync(path.join(ROOT, "backend/admin/router.js"), "utf8");
  const start = source.indexOf('router.get(\n    "/inbox"');
  const end = source.indexOf('router.post(\n    "/inbox/test-attempts', start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /Cache-Control", "no-store"/);
});
