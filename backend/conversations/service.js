"use strict";

const { HttpError } = require("../lib/http-error");
const { withTransaction } = require("../lib/transaction");

const SUBJECTS = Object.freeze({
  homework: {
    table: "homework_submissions",
    columns: "id, user_id, topic_key, status, submitted_at, updated_at",
  },
  mock: {
    table: "mock_submissions",
    columns: "id, user_id, mock_id, mock_version, mock_snapshot, status, submitted_at, updated_at",
  },
  test_attempt: {
    table: "test_attempts",
    columns: "id, user_id, topic_key, test_key, submitted_at",
  },
});

function subjectDefinition(subjectType) {
  const definition = SUBJECTS[subjectType];
  if (!definition) throw new HttpError(404, "conversation_not_found", "Переписка не найдена");
  return definition;
}

async function findSubject(client, subjectType, subjectId, studentId = null) {
  const definition = subjectDefinition(subjectType);
  const values = studentId === null ? [subjectId] : [subjectId, studentId];
  const ownerFilter = studentId === null ? "" : " AND user_id = $2";
  const { rows } = await client.query(
    `SELECT ${definition.columns}
       FROM ${definition.table}
      WHERE id = $1${ownerFilter}`,
    values,
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, "conversation_not_found", "Переписка не найдена");
  return row;
}

function serializeSubject(subjectType, row) {
  const common = {
    type: subjectType,
    id: String(row.id),
    status: row.status || null,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at || row.submitted_at,
  };
  if (subjectType === "homework") return { ...common, topicId: row.topic_key };
  if (subjectType === "mock") {
    return {
      ...common,
      mockId: row.mock_id,
      mockVersion: row.mock_version,
      title: row.mock_snapshot?.title || row.mock_id,
    };
  }
  return { ...common, topicId: row.topic_key, testId: row.test_key };
}

function serializeMessage(row, viewerRole) {
  return {
    id: String(row.id),
    sender: row.sender_role,
    author: row.sender_role === "teacher" ? "Дарья Сергеевна" : row.display_name,
    text: row.body,
    createdAt: row.created_at,
    unread: viewerRole === "student"
      ? row.sender_role === "teacher" && !row.student_read_at
      : row.sender_role === "student" && !row.teacher_read_at,
  };
}

async function findThread(client, subjectType, subjectId) {
  const { rows } = await client.query(
    `SELECT id, student_id, subject_type, subject_id, created_at, updated_at
       FROM conversation_threads
      WHERE subject_type = $1 AND subject_id = $2`,
    [subjectType, subjectId],
  );
  return rows[0] || null;
}

async function ensureThread(client, studentId, subjectType, subjectId) {
  const { rows } = await client.query(
    `INSERT INTO conversation_threads (student_id, subject_type, subject_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (subject_type, subject_id) DO UPDATE
       SET updated_at = conversation_threads.updated_at
     RETURNING id, student_id, subject_type, subject_id, created_at, updated_at`,
    [studentId, subjectType, subjectId],
  );
  const thread = rows[0];
  if (String(thread.student_id) !== String(studentId)) {
    throw new HttpError(404, "conversation_not_found", "Переписка не найдена");
  }
  return thread;
}

async function messagesForThread(client, threadId, viewerRole) {
  const { rows } = await client.query(
    `SELECT m.id, m.sender_role, m.body, m.created_at,
            m.student_read_at, m.teacher_read_at, u.display_name
       FROM conversation_messages AS m
       JOIN users AS u ON u.id = m.sender_user_id
      WHERE m.thread_id = $1
      ORDER BY m.created_at, m.id`,
    [threadId],
  );
  return rows.map((row) => serializeMessage(row, viewerRole));
}

async function getConversation(pool, { viewerRole, viewerUserId, subjectType, subjectId }) {
  const subject = await findSubject(
    pool,
    subjectType,
    subjectId,
    viewerRole === "student" ? viewerUserId : null,
  );
  const thread = await findThread(pool, subjectType, subjectId);
  if (thread && String(thread.student_id) !== String(subject.user_id)) {
    throw new HttpError(409, "conversation_owner_mismatch", "Переписка временно недоступна");
  }
  const messages = thread ? await messagesForThread(pool, thread.id, viewerRole) : [];
  return {
    subject: serializeSubject(subjectType, subject),
    messages,
    unreadCount: messages.filter((message) => message.unread).length,
  };
}

async function appendKnownStudentMessage(client, studentId, subjectType, subjectId, body) {
  const text = String(body || "").trim();
  if (!text) return null;
  const thread = await ensureThread(client, studentId, subjectType, subjectId);
  const { rows } = await client.query(
    `INSERT INTO conversation_messages (
       thread_id, sender_user_id, sender_role, body, student_read_at
     ) VALUES ($1, $2, 'student', $3, NOW())
     RETURNING id, sender_role, body, created_at, student_read_at, teacher_read_at`,
    [thread.id, studentId, text],
  );
  await client.query("UPDATE conversation_threads SET updated_at = NOW() WHERE id = $1", [thread.id]);
  return rows[0];
}

async function appendKnownTeacherMessage(client, teacherId, studentId, subjectType, subjectId, body) {
  const text = String(body || "").trim();
  if (!text) return null;
  const thread = await ensureThread(client, studentId, subjectType, subjectId);
  await client.query(
    `UPDATE conversation_messages
        SET teacher_read_at = NOW()
      WHERE thread_id = $1 AND sender_role = 'student' AND teacher_read_at IS NULL`,
    [thread.id],
  );
  const { rows } = await client.query(
    `INSERT INTO conversation_messages (
       thread_id, sender_user_id, sender_role, body, teacher_read_at
     ) VALUES ($1, $2, 'teacher', $3, NOW())
     RETURNING id, sender_role, body, created_at, student_read_at, teacher_read_at`,
    [thread.id, teacherId, text],
  );
  await client.query("UPDATE conversation_threads SET updated_at = NOW() WHERE id = $1", [thread.id]);
  return rows[0];
}

async function addMessage(pool, { senderRole, senderUserId, subjectType, subjectId, body }) {
  return withTransaction(pool, async (client) => {
    const subject = await findSubject(
      client,
      subjectType,
      subjectId,
      senderRole === "student" ? senderUserId : null,
    );
    const thread = await ensureThread(client, subject.user_id, subjectType, subjectId);
    if (senderRole === "teacher") {
      await client.query(
        `UPDATE conversation_messages
            SET teacher_read_at = NOW()
          WHERE thread_id = $1 AND sender_role = 'student' AND teacher_read_at IS NULL`,
        [thread.id],
      );
    } else {
      await client.query(
        `UPDATE conversation_messages
            SET student_read_at = NOW()
          WHERE thread_id = $1 AND sender_role = 'teacher' AND student_read_at IS NULL`,
        [thread.id],
      );
    }
    const readColumn = senderRole === "student" ? "student_read_at" : "teacher_read_at";
    const { rows } = await client.query(
      `INSERT INTO conversation_messages (
         thread_id, sender_user_id, sender_role, body, ${readColumn}
       ) VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, sender_role, body, created_at, student_read_at, teacher_read_at`,
      [thread.id, senderUserId, senderRole, body],
    );
    await client.query("UPDATE conversation_threads SET updated_at = NOW() WHERE id = $1", [thread.id]);
    return serializeMessage({
      ...rows[0],
      display_name: senderRole === "teacher" ? "Дарья Сергеевна" : null,
    }, senderRole);
  });
}

async function markRead(pool, { viewerRole, viewerUserId, subjectType, subjectId }) {
  const subject = await findSubject(
    pool,
    subjectType,
    subjectId,
    viewerRole === "student" ? viewerUserId : null,
  );
  const thread = await findThread(pool, subjectType, subjectId);
  if (!thread) return { read: 0 };
  if (String(thread.student_id) !== String(subject.user_id)) {
    throw new HttpError(409, "conversation_owner_mismatch", "Переписка временно недоступна");
  }
  const senderRole = viewerRole === "student" ? "teacher" : "student";
  const column = viewerRole === "student" ? "student_read_at" : "teacher_read_at";
  const result = await pool.query(
    `UPDATE conversation_messages
        SET ${column} = NOW()
      WHERE thread_id = $1 AND sender_role = $2 AND ${column} IS NULL`,
    [thread.id, senderRole],
  );
  return { read: result.rowCount || 0 };
}

async function listStudentUnread(pool, studentId) {
  const { rows } = await pool.query(
    `SELECT t.subject_type, t.subject_id, COUNT(m.id)::INTEGER AS unread_count,
            MAX(m.created_at) AS last_message_at
       FROM conversation_threads AS t
       JOIN conversation_messages AS m ON m.thread_id = t.id
      WHERE t.student_id = $1 AND m.sender_role = 'teacher' AND m.student_read_at IS NULL
      GROUP BY t.id, t.subject_type, t.subject_id
      ORDER BY MAX(m.created_at) DESC`,
    [studentId],
  );
  return rows.map((row) => ({
    subjectType: row.subject_type,
    subjectId: String(row.subject_id),
    unreadCount: Number(row.unread_count),
    lastMessageAt: row.last_message_at,
  }));
}

async function listAdminUnread(pool) {
  const { rows } = await pool.query(
    `SELECT t.subject_type, t.subject_id, t.student_id,
            u.login, u.display_name,
            COUNT(unread.id)::INTEGER AS unread_count,
            last_message.body, last_message.created_at
       FROM conversation_threads AS t
       JOIN users AS u ON u.id = t.student_id
       JOIN conversation_messages AS unread
         ON unread.thread_id = t.id
        AND unread.sender_role = 'student'
        AND unread.teacher_read_at IS NULL
       JOIN LATERAL (
         SELECT body, created_at
           FROM conversation_messages
          WHERE thread_id = t.id
          ORDER BY created_at DESC, id DESC
          LIMIT 1
       ) AS last_message ON TRUE
      GROUP BY t.id, t.subject_type, t.subject_id, t.student_id,
               u.login, u.display_name, last_message.body, last_message.created_at
      ORDER BY last_message.created_at DESC, t.id DESC`,
  );
  return rows.map((row) => ({
    subjectType: row.subject_type,
    subjectId: String(row.subject_id),
    studentId: String(row.student_id),
    studentName: row.display_name,
    studentLogin: row.login,
    unreadCount: Number(row.unread_count),
    preview: row.body,
    lastMessageAt: row.created_at,
  }));
}

module.exports = {
  addMessage,
  appendKnownStudentMessage,
  appendKnownTeacherMessage,
  getConversation,
  listAdminUnread,
  listStudentUnread,
  markRead,
};
