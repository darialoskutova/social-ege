"use strict";

const { HttpError } = require("../lib/http-error");
const { courseTopics } = require("../study-plan/course-catalog");

const SECTION_NAMES = Object.freeze({
  human_society: "Человек и общество / духовная культура",
  social_relations: "Социальные отношения",
  economics: "Экономика",
  politics: "Политика",
  law: "Право",
});

function topicFor(topicId) {
  return courseTopics.find((topic) => topic.id === topicId) || null;
}

function serializeAttempt(row) {
  const topic = topicFor(row.topic_key);
  return {
    id: `test:${row.id}`,
    kind: "test",
    label: "Новый результат теста",
    studentId: String(row.user_id),
    studentName: row.display_name,
    studentLogin: row.login,
    attemptId: String(row.id),
    attemptNumber: Number(row.attempt_number),
    testId: row.test_key,
    topicId: row.topic_key,
    title: topic?.title || row.test_key,
    sectionId: topic?.sectionId || null,
    sectionTitle: topic ? SECTION_NAMES[topic.sectionId] || topic.sectionId : null,
    score: row.score === null ? null : Number(row.score),
    maxScore: row.max_score === null ? null : Number(row.max_score),
    percentage: row.percentage === null ? null : Number(row.percentage),
    unreadMessageCount: Number(row.unread_message_count || 0),
    occurredAt: row.submitted_at,
  };
}

async function listUnseenTestAttempts(pool) {
  const { rows } = await pool.query(
    `SELECT a.id, a.user_id, a.topic_key, a.test_key, a.score, a.max_score,
            a.percentage, a.submitted_at, u.login, u.display_name,
            (SELECT COUNT(*)
               FROM test_attempts AS earlier
              WHERE earlier.user_id = a.user_id
                AND earlier.test_key = a.test_key
                AND (earlier.submitted_at, earlier.id) <= (a.submitted_at, a.id)
            ) AS attempt_number,
            (SELECT COUNT(m.id)
               FROM conversation_threads AS t
               JOIN conversation_messages AS m ON m.thread_id = t.id
              WHERE t.subject_type = 'test_attempt'
                AND t.subject_id = a.id
                AND m.sender_role = 'student'
                AND m.teacher_read_at IS NULL
            ) AS unread_message_count
       FROM test_attempts AS a
       JOIN users AS u ON u.id = a.user_id
      WHERE a.teacher_seen_at IS NULL
      ORDER BY a.submitted_at DESC, a.id DESC`,
  );
  return rows.map(serializeAttempt);
}

async function markTestAttemptSeen(pool, attemptId) {
  const { rows } = await pool.query(
    `UPDATE test_attempts
        SET teacher_seen_at = COALESCE(teacher_seen_at, NOW())
      WHERE id = $1
      RETURNING id, teacher_seen_at`,
    [attemptId],
  );
  if (!rows[0]) throw new HttpError(404, "attempt_not_found", "Попытка не найдена");
  return { id: String(rows[0].id), seenAt: rows[0].teacher_seen_at };
}

function workItem(submission) {
  const revision = Number(submission.fileRevision || 1);
  return {
    id: `work:${submission.type}:${submission.id}:${revision}`,
    kind: "work",
    label: revision > 1 ? "Повторная сдача" : "Новая работа",
    studentId: submission.studentId,
    studentName: submission.studentName,
    studentLogin: submission.studentLogin,
    occurredAt: submission.updatedAt,
    submission,
  };
}

function messageItem(conversation) {
  const topic = topicFor(conversation.topicId);
  return {
    id: `message:${conversation.subjectType}:${conversation.subjectId}`,
    kind: "message",
    label: "Новое сообщение",
    studentId: conversation.studentId,
    studentName: conversation.studentName,
    studentLogin: conversation.studentLogin,
    subjectType: conversation.subjectType,
    subjectId: conversation.subjectId,
    topicId: conversation.topicId || null,
    title: conversation.subjectTitle || topic?.title || null,
    preview: conversation.preview,
    attachmentFilename: conversation.attachmentFilename,
    unreadCount: conversation.unreadCount,
    occurredAt: conversation.lastMessageAt,
  };
}

function buildUnifiedInbox({ submissions, attempts, conversations }) {
  const unseenSubmissions = submissions.filter((submission) => (
    Number(submission.teacherSeenRevision || 0) < Number(submission.fileRevision || 1)
  ));
  const testItems = attempts.map((attempt) => ({ ...attempt }));
  const workItems = unseenSubmissions.map(workItem);
  const messageItems = conversations.map(messageItem);
  const items = [...testItems, ...workItems, ...messageItems].sort((left, right) => (
    new Date(right.occurredAt) - new Date(left.occurredAt)
      || right.id.localeCompare(left.id)
  ));
  const unreadMessages = conversations.reduce((sum, item) => sum + Number(item.unreadCount || 0), 0);
  return {
    items,
    unseenSubmissions,
    counts: {
      unseenTests: testItems.length,
      unseenWorks: workItems.length,
      unreadMessages,
      total: testItems.length + workItems.length + unreadMessages,
    },
  };
}

module.exports = {
  buildUnifiedInbox,
  listUnseenTestAttempts,
  markTestAttemptSeen,
};
