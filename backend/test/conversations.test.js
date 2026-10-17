"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const cookieParser = require("cookie-parser");
const express = require("express");
const { createAdminRouter } = require("../admin/router");
const { createLearningRouter } = require("../learning/router");
const { HttpError } = require("../lib/http-error");

const ORIGIN = "https://social-ege.example";
const TOKENS = {
  studentA: "conversation-student-a-token-000000000000",
  studentB: "conversation-student-b-token-000000000000",
  admin: "conversation-admin-token-000000000000000",
};

function tokenHash(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function config() {
  return { enabled: true, secureCookie: false, isProduction: false, cookieName: "social_ege_session", sessionTtlHours: 168, allowedOrigins: new Set([ORIGIN]) };
}

function poolFixture() {
  const now = new Date("2026-10-17T10:00:00Z");
  const state = {
    users: [
      { id: 1, login: "masha", display_name: "Маша Иванова", role: "student" },
      { id: 2, login: "anna", display_name: "Анна Петрова", role: "student" },
      { id: 9, login: "teacher", display_name: "Дарья Сергеевна", role: "admin" },
    ],
    sessions: new Map([
      [tokenHash(TOKENS.studentA), 1], [tokenHash(TOKENS.studentB), 2], [tokenHash(TOKENS.admin), 9],
    ]),
    homework: [
      { id: 101, user_id: 1, topic_key: "law44", object_key: "a.pdf", original_filename: "дз.pdf", mime_type: "application/pdf", size_bytes: 100, file_revision: 1, student_comment: "", teacher_comment: "", status: "submitted", submitted_at: now, updated_at: now, reviewed_at: null, reviewed_by: null },
      { id: 102, user_id: 2, topic_key: "law45", object_key: "b.pdf", original_filename: "чужое.pdf", mime_type: "application/pdf", size_bytes: 120, file_revision: 1, student_comment: "", teacher_comment: "", status: "submitted", submitted_at: now, updated_at: now, reviewed_at: null, reviewed_by: null },
    ],
    mocks: [
      { id: 201, user_id: 1, mock_id: "law-1", mock_version: "2027-draft-v1", mock_snapshot: { title: "Пробник по праву" }, object_key: "m1.pdf", original_filename: "пробник.pdf", mime_type: "application/pdf", size_bytes: 130, file_revision: 1, student_comment: "", teacher_comment: "", status: "submitted", submitted_at: now, updated_at: now, reviewed_at: null, reviewed_by: null },
      { id: 202, user_id: 2, mock_id: "law-2", mock_version: "2027-draft-v1", mock_snapshot: { title: "Чужой пробник" }, object_key: "m2.pdf", original_filename: "чужой-пробник.pdf", mime_type: "application/pdf", size_bytes: 140, file_revision: 1, student_comment: "", teacher_comment: "", status: "submitted", submitted_at: now, updated_at: now, reviewed_at: null, reviewed_by: null },
    ],
    attempts: [
      { id: 301, user_id: 1, topic_key: "law44", test_key: "test-44", submitted_at: now },
      { id: 302, user_id: 2, topic_key: "law45", test_key: "test-45", submitted_at: now },
    ],
    threads: [], messages: [], nextThreadId: 1, nextMessageId: 1,
  };

  function subjectRows(table, values) {
    const rows = state[table].filter((row) => String(row.id) === String(values[0]));
    return values.length > 1 ? rows.filter((row) => String(row.user_id) === String(values[1])) : rows;
  }

  async function query(sql, values = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rows: [], rowCount: 0 };
    if (normalized.includes("FROM auth_sessions AS s")) {
      const id = state.sessions.get(values[0]);
      const user = state.users.find((item) => item.id === id);
      return { rows: user ? [{ id: user.id, login: user.login, display_name: user.display_name, role: user.role }] : [] };
    }
    if (normalized.startsWith("SELECT id, user_id, topic_key, status") && normalized.includes("FROM homework_submissions")) return { rows: subjectRows("homework", values) };
    if (normalized.startsWith("SELECT id, user_id, mock_id") && normalized.includes("FROM mock_submissions")) return { rows: subjectRows("mocks", values) };
    if (normalized.startsWith("SELECT id, user_id, topic_key, test_key") && normalized.includes("FROM test_attempts")) return { rows: subjectRows("attempts", values) };
    if (normalized.startsWith("SELECT id, student_id, subject_type") && normalized.includes("FROM conversation_threads")) {
      return { rows: state.threads.filter((row) => row.subject_type === values[0] && String(row.subject_id) === String(values[1])) };
    }
    if (normalized.startsWith("INSERT INTO conversation_threads")) {
      let row = state.threads.find((item) => item.subject_type === values[1] && String(item.subject_id) === String(values[2]));
      if (!row) {
        row = { id: state.nextThreadId++, student_id: String(values[0]), subject_type: values[1], subject_id: String(values[2]), created_at: new Date(), updated_at: new Date() };
        state.threads.push(row);
      }
      return { rows: [row], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO conversation_messages")) {
      const senderRole = values.length === 4 ? values[2] : "student";
      const body = values.length === 4 ? values[3] : values[2];
      const row = {
        id: state.nextMessageId++, thread_id: values[0], sender_user_id: String(values[1]), sender_role: senderRole,
        body, created_at: new Date(Date.now() + state.nextMessageId),
        student_read_at: senderRole === "student" ? new Date() : null,
        teacher_read_at: senderRole === "teacher" ? new Date() : null,
      };
      state.messages.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE conversation_threads SET updated_at")) return { rows: [], rowCount: 1 };
    if (normalized.startsWith("SELECT m.id, m.sender_role")) {
      return { rows: state.messages.filter((row) => String(row.thread_id) === String(values[0])).map((row) => ({ ...row, display_name: state.users.find((user) => String(user.id) === row.sender_user_id)?.display_name })) };
    }
    if (normalized.startsWith("UPDATE conversation_messages SET student_read_at")) {
      const sender = values[1] || "teacher";
      let count = 0; state.messages.forEach((row) => { if (String(row.thread_id) === String(values[0]) && row.sender_role === sender && !row.student_read_at) { row.student_read_at = new Date(); count += 1; } });
      return { rows: [], rowCount: count };
    }
    if (normalized.startsWith("UPDATE conversation_messages SET teacher_read_at")) {
      const sender = values[1] || "student";
      let count = 0; state.messages.forEach((row) => { if (String(row.thread_id) === String(values[0]) && row.sender_role === sender && !row.teacher_read_at) { row.teacher_read_at = new Date(); count += 1; } });
      return { rows: [], rowCount: count };
    }
    if (normalized.startsWith("SELECT t.subject_type, t.subject_id, COUNT(m.id)") && normalized.includes("student_read_at IS NULL")) {
      return { rows: state.threads.filter((thread) => String(thread.student_id) === String(values[0])).map((thread) => {
        const unread = state.messages.filter((message) => message.thread_id === thread.id && message.sender_role === "teacher" && !message.student_read_at);
        return unread.length ? { subject_type: thread.subject_type, subject_id: thread.subject_id, unread_count: unread.length, last_message_at: unread.at(-1).created_at } : null;
      }).filter(Boolean) };
    }
    if (normalized.startsWith("SELECT t.subject_type, t.subject_id, t.student_id") && normalized.includes("teacher_read_at IS NULL")) {
      return { rows: state.threads.map((thread) => {
        const unread = state.messages.filter((message) => message.thread_id === thread.id && message.sender_role === "student" && !message.teacher_read_at);
        const last = state.messages.filter((message) => message.thread_id === thread.id).at(-1);
        const user = state.users.find((item) => String(item.id) === String(thread.student_id));
        return unread.length ? { subject_type: thread.subject_type, subject_id: thread.subject_id, student_id: thread.student_id, login: user.login, display_name: user.display_name, unread_count: unread.length, body: last.body, created_at: last.created_at } : null;
      }).filter(Boolean) };
    }
    if (normalized.startsWith("SELECT s.id, s.user_id, s.topic_key")) {
      return { rows: state.homework.map((row) => ({ ...row, login: state.users.find((u) => u.id === row.user_id).login, display_name: state.users.find((u) => u.id === row.user_id).display_name })) };
    }
    if (normalized.startsWith("SELECT s.id, s.user_id, s.mock_id")) {
      return { rows: state.mocks.map((row) => ({ ...row, login: state.users.find((u) => u.id === row.user_id).login, display_name: state.users.find((u) => u.id === row.user_id).display_name })) };
    }
    throw new Error(`Unexpected query: ${normalized}`);
  }
  return { state, query, async connect() { return { query, release() {} }; } };
}

async function fixture(t) {
  const pool = poolFixture();
  const app = express(); app.use(express.json({ limit: "64kb" })); app.use(cookieParser());
  app.use("/api/learning", createLearningRouter(pool, config(), { directory: "/tmp/not-used", maxBytes: 1024 }));
  app.use("/api/admin", createAdminRouter(pool, config(), { directory: "/tmp/not-used", maxBytes: 1024 }));
  app.use((req, res) => res.status(404).json({ error: { code: "not_found" } }));
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
    next(error);
  });
  const server = await new Promise((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { pool, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function request(context, role, pathName, { method = "GET", body } = {}) {
  const token = TOKENS[role];
  return fetch(`${context.baseUrl}${pathName}`, {
    method,
    headers: { ...(token ? { cookie: `social_ege_session=${token}` } : {}), ...(method === "GET" ? {} : { origin: ORIGIN, "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function postMessage(context, role, apiRoot, type, id, body) {
  return request(context, role, `${apiRoot}/conversations/${type}/${id}/messages`, { method: "POST", body });
}

test("1 student creates a message for own homework", async (t) => { const c = await fixture(t); assert.equal((await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "Вопрос по аргументу" })).status, 201); });
test("2 student cannot write to another student's homework", async (t) => { const c = await fixture(t); assert.equal((await postMessage(c, "studentA", "/api/learning", "homework", 102, { body: "Чужая работа" })).status, 404); });
test("3 student creates a message for own mock", async (t) => { const c = await fixture(t); assert.equal((await postMessage(c, "studentA", "/api/learning", "mock", 201, { body: "Вопрос по пробнику" })).status, 201); });
test("4 student cannot write to another student's mock", async (t) => { const c = await fixture(t); assert.equal((await postMessage(c, "studentA", "/api/learning", "mock", 202, { body: "Чужой пробник" })).status, 404); });
test("5 student creates a message for own test attempt", async (t) => { const c = await fixture(t); assert.equal((await postMessage(c, "studentA", "/api/learning", "test_attempt", 301, { body: "Почему ответ неверный?" })).status, 201); });
test("6 student cannot write to another student's attempt", async (t) => { const c = await fixture(t); assert.equal((await postMessage(c, "studentA", "/api/learning", "test_attempt", 302, { body: "Чужая попытка" })).status, 404); });
test("7 admin reads a student thread", async (t) => { const c = await fixture(t); await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "Мой вопрос" }); const r = await request(c, "admin", "/api/admin/conversations/homework/101"); assert.equal(r.status, 200); assert.equal((await r.json()).conversation.messages[0].text, "Мой вопрос"); });
test("8 admin replies to a thread", async (t) => { const c = await fixture(t); await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "Вопрос" }); assert.equal((await postMessage(c, "admin", "/api/admin", "homework", 101, { body: "Ответ" })).status, 201); });
test("9 student sees the admin reply", async (t) => { const c = await fixture(t); await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "Вопрос" }); await postMessage(c, "admin", "/api/admin", "homework", 101, { body: "Ответ Дарьи" }); const p = await (await request(c, "studentA", "/api/learning/conversations/homework/101")).json(); assert.equal(p.conversation.messages.at(-1).text, "Ответ Дарьи"); });
test("10 sender identity cannot be forged in payload", async (t) => { const c = await fixture(t); const r = await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "Подмена", senderRole: "teacher", senderUserId: 9 }); assert.equal(r.status, 400); assert.equal(c.pool.state.messages.length, 0); });
test("11 empty message is rejected", async (t) => { const c = await fixture(t); assert.equal((await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "   " })).status, 400); });
test("12 oversized message is rejected", async (t) => { const c = await fixture(t); assert.equal((await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "а".repeat(6001) })).status, 400); });
test("13 student cannot read another student's thread", async (t) => { const c = await fixture(t); await postMessage(c, "studentB", "/api/learning", "homework", 102, { body: "Секрет" }); assert.equal((await request(c, "studentA", "/api/learning/conversations/homework/102")).status, 404); });
test("14 admin Inbox receives a new student message", async (t) => { const c = await fixture(t); await postMessage(c, "studentA", "/api/learning", "test_attempt", 301, { body: "Вопрос по тесту" }); const p = await (await request(c, "admin", "/api/admin/inbox")).json(); assert.equal(p.conversations[0].subjectType, "test_attempt"); });
test("15 unread appears for admin", async (t) => { const c = await fixture(t); await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "Новое" }); const p = await (await request(c, "admin", "/api/admin/inbox")).json(); assert.equal(p.counts.unreadMessages, 1); });
test("16 admin read action clears unread", async (t) => { const c = await fixture(t); await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "Новое" }); assert.equal((await request(c, "admin", "/api/admin/conversations/homework/101/read", { method: "POST", body: {} })).status, 200); const p = await (await request(c, "admin", "/api/admin/inbox")).json(); assert.equal(p.counts.unreadMessages, 0); });
test("17 teacher reply creates student unread", async (t) => { const c = await fixture(t); await postMessage(c, "studentA", "/api/learning", "mock", 201, { body: "Вопрос" }); await postMessage(c, "admin", "/api/admin", "mock", 201, { body: "Ответ" }); const p = await (await request(c, "studentA", "/api/learning/conversations/unread")).json(); assert.equal(p.unreadCount, 1); });
test("18 student read action clears teacher unread", async (t) => { const c = await fixture(t); await postMessage(c, "studentA", "/api/learning", "mock", 201, { body: "Вопрос" }); await postMessage(c, "admin", "/api/admin", "mock", 201, { body: "Ответ" }); await request(c, "studentA", "/api/learning/conversations/mock/201/read", { method: "POST", body: {} }); const p = await (await request(c, "studentA", "/api/learning/conversations/unread")).json(); assert.equal(p.unreadCount, 0); });
test("19 accepted submission keeps conversation open", async (t) => { const c = await fixture(t); c.pool.state.homework[0].status = "accepted"; assert.equal((await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "Ещё вопрос" })).status, 201); });
test("20 needs_revision submission keeps conversation open", async (t) => { const c = await fixture(t); c.pool.state.homework[0].status = "needs_revision"; assert.equal((await postMessage(c, "admin", "/api/admin", "homework", 101, { body: "Уточнение" })).status, 201); });
test("21 resubmission preserves previous thread history", async (t) => { const c = await fixture(t); await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "До исправления" }); c.pool.state.homework[0].file_revision += 1; await postMessage(c, "studentA", "/api/learning", "homework", 101, { body: "После исправления" }); const p = await (await request(c, "studentA", "/api/learning/conversations/homework/101")).json(); assert.deepEqual(p.conversation.messages.map((m) => m.text), ["До исправления", "После исправления"]); });
test("22 migration preserves homework and mock legacy comments", () => { const sql = fs.readFileSync(path.resolve(__dirname, "../migrations/009_work_conversations.sql"), "utf8"); assert.match(sql, /BTRIM\(h\.student_comment\)/); assert.match(sql, /BTRIM\(h\.teacher_comment\)/); assert.match(sql, /BTRIM\(m\.student_comment\)/); assert.match(sql, /BTRIM\(m\.teacher_comment\)/); });
test("23 migration is additive and idempotent for legacy messages", () => { const sql = fs.readFileSync(path.resolve(__dirname, "../migrations/009_work_conversations.sql"), "utf8"); assert.match(sql, /conversation_messages_legacy_source_idx/); assert.equal((sql.match(/ON CONFLICT \(thread_id, legacy_source\) WHERE legacy_source IS NOT NULL DO NOTHING;/g) || []).length, 4); assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|ALTER)\b/i); });
test("24 public API exposes no PATCH or DELETE for messages", async (t) => { const c = await fixture(t); assert.equal((await request(c, "studentA", "/api/learning/conversations/homework/101/messages", { method: "PATCH", body: { body: "edit" } })).status, 404); assert.equal((await request(c, "admin", "/api/admin/conversations/homework/101/messages", { method: "DELETE", body: {} })).status, 404); });
test("25 test conversation is tied to exact attempt id", async (t) => { const c = await fixture(t); await postMessage(c, "studentA", "/api/learning", "test_attempt", 301, { body: "Только попытка 301" }); const own = await (await request(c, "admin", "/api/admin/conversations/test_attempt/301")).json(); const other = await (await request(c, "admin", "/api/admin/conversations/test_attempt/302")).json(); assert.equal(own.conversation.messages.length, 1); assert.equal(other.conversation.messages.length, 0); });
