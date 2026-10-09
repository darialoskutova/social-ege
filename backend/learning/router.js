"use strict";

const express = require("express");
const { z } = require("zod");
const {
  requireAllowedOrigin,
  requireAuth,
  requireSecureTransport,
} = require("../auth/middleware");
const { asyncHandler } = require("../lib/async-handler");
const { HttpError } = require("../lib/http-error");
const {
  decodeHeader,
  readUploadConfig,
  receiveUpload,
  removeStoredFile,
  sendStoredFile,
} = require("./file-storage");
const { findMock } = require("./mock-catalog");

const stableKey = z.string().trim().min(1).max(120).regex(/^[a-z0-9_-]+$/);
const topicKey = stableKey.max(100);
const legacyId = z.string().trim().min(1).max(120);
const timestamp = z.string().datetime({ offset: true });
const answerValues = z.array(z.string().max(2000)).max(30);
const answers = z.record(z.string().min(1).max(160), answerValues);

const progressSchema = z.object({
  testCompleted: z.literal(true).optional(),
  homeworkSubmitted: z.literal(true).optional(),
}).strict().refine((value) => value.testCompleted || value.homeworkSubmitted, {
  message: "At least one completed step is required",
});

const draftSchema = z.object({
  topicId: topicKey,
  answers,
}).strict();

const attemptSchema = z.object({
  topicId: topicKey,
  testId: stableKey,
  scorePoints: z.number().int().min(0).max(1000).nullable(),
  scoreTotal: z.number().int().min(1).max(1000).nullable(),
  submittedAnswers: answers.default({}),
  incorrectQuestionIds: z.array(stableKey).max(200).default([]),
  legacyClientId: legacyId.optional(),
  legacyCreatedAt: timestamp.optional(),
}).strict().superRefine((value, context) => {
  const bothNull = value.scorePoints === null && value.scoreTotal === null;
  const bothPresent = value.scorePoints !== null && value.scoreTotal !== null;
  if (!bothNull && !bothPresent) {
    context.addIssue({ code: "custom", message: "Score and maximum score must be supplied together" });
  } else if (bothPresent && value.scorePoints > value.scoreTotal) {
    context.addIssue({ code: "custom", message: "Score cannot exceed maximum score" });
  }
});

const homeworkSchema = z.object({
  topicId: topicKey,
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100).nullable().optional(),
  sizeBytes: z.number().int().min(1).max(100 * 1024 * 1024).nullable().optional(),
  studentComment: z.string().trim().max(4000).default(""),
  legacyClientId: legacyId.optional(),
  legacyCreatedAt: timestamp.optional(),
}).strict();

const messageSchema = z.object({
  category: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(4000),
  legacyClientId: legacyId.optional(),
  legacyCreatedAt: timestamp.optional(),
}).strict();

const uploadComment = z.string().trim().max(4000);
const mockVersion = z.string().trim().min(1).max(80).regex(/^[a-z0-9._-]+$/);

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "invalid_request", "Некорректные данные запроса");
  }
  return result.data;
}

async function transaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markProgress(client, userId, topic, fields) {
  const testCompletedAt = fields.testCompleted ? new Date() : null;
  const homeworkSubmittedAt = fields.homeworkSubmitted ? new Date() : null;
  const { rows } = await client.query(
    `INSERT INTO user_progress (
       user_id, topic_key, test_completed_at, homework_submitted_at
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, topic_key) DO UPDATE SET
       test_completed_at = COALESCE(user_progress.test_completed_at, EXCLUDED.test_completed_at),
       homework_submitted_at = COALESCE(user_progress.homework_submitted_at, EXCLUDED.homework_submitted_at),
       updated_at = NOW()
     RETURNING topic_key, test_completed_at, homework_submitted_at, updated_at`,
    [userId, topic, testCompletedAt, homeworkSubmittedAt],
  );
  return serializeProgress(rows[0]);
}

function serializeProgress(row) {
  return {
    topicId: row.topic_key,
    testCompletedAt: row.test_completed_at,
    homeworkSubmittedAt: row.homework_submitted_at,
    updatedAt: row.updated_at,
  };
}

function serializeAttempt(row) {
  return {
    id: String(row.id),
    topicId: row.topic_key,
    testId: row.test_key,
    scorePoints: row.score,
    scoreTotal: row.max_score,
    scorePercent: row.percentage === null ? null : Number(row.percentage),
    submittedAnswers: row.submitted_answers,
    incorrectQuestionIds: row.incorrect_question_ids,
    createdAt: row.submitted_at,
  };
}

function serializeDraft(row) {
  return {
    testId: row.test_key,
    topicId: row.topic_key,
    values: row.answers,
    answeredCount: Object.keys(row.answers || {}).length,
    updatedAt: row.updated_at,
  };
}

function serializeHomework(row, user) {
  const statuses = {
    submitted: "Отправлено",
    in_review: "На проверке",
    needs_revision: "Нужно исправить",
    accepted: "Проверено",
  };
  return {
    id: String(row.id),
    topicId: row.topic_key,
    studentName: user.name,
    studentLogin: user.login,
    fileName: row.original_filename,
    mimeType: row.mime_type || null,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    hasFile: Boolean(row.object_key),
    downloadUrl: row.object_key ? `/api/learning/homework-submissions/${row.id}/file` : null,
    studentComment: row.student_comment,
    teacherComment: row.teacher_comment,
    status: statuses[row.status] || "Отправлено",
    createdAt: row.submitted_at,
    updatedAt: row.updated_at || row.submitted_at,
  };
}

function serializeMockSubmission(row, user) {
  const statuses = {
    submitted: "Отправлено",
    in_review: "На проверке",
    needs_revision: "Нужно исправить",
    accepted: "Проверено",
  };
  return {
    id: String(row.id),
    mockId: row.mock_id,
    mockVersion: row.mock_version,
    mock: row.mock_snapshot,
    studentName: user.name,
    studentLogin: user.login,
    fileName: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    fileRevision: row.file_revision,
    studentComment: row.student_comment,
    teacherComment: row.teacher_comment,
    status: statuses[row.status] || "Отправлено",
    statusCode: row.status,
    downloadUrl: `/api/learning/mock-submissions/${row.id}/file`,
    createdAt: row.submitted_at,
    updatedAt: row.updated_at,
  };
}

function optionalEncodedHeader(req, name, maximum) {
  const raw = req.get(name);
  if (raw === undefined) return "";
  let value;
  try {
    value = decodeURIComponent(raw).normalize("NFKC").trim();
  } catch {
    throw new HttpError(400, "invalid_upload_metadata", "Некорректные данные файла");
  }
  if (value.length > maximum || value.includes("\0")) {
    throw new HttpError(400, "invalid_upload_metadata", "Некорректные данные файла");
  }
  return value;
}

async function cleanupReplacedUpload(config, objectKey) {
  if (!objectKey) return;
  try {
    await removeStoredFile(config, objectKey);
  } catch (error) {
    // The database already points to the new file. A failed cleanup must not
    // delete that current file or turn a successful replacement into data loss.
    console.error("Replaced upload cleanup failed", { name: error?.name, code: error?.code });
  }
}

function serializeMessage(row, user) {
  return {
    id: String(row.id),
    studentName: user.name,
    studentLogin: user.login,
    category: row.category,
    text: row.body,
    reply: row.teacher_reply || "",
    createdAt: row.created_at,
  };
}

function createLearningRouter(pool, config, suppliedUploadConfig = readUploadConfig()) {
  const router = express.Router();
  router.use(requireSecureTransport(config));
  router.use(requireAllowedOrigin(config));
  router.use(requireAuth(pool, config));
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/progress", asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT topic_key, test_completed_at, homework_submitted_at, updated_at
         FROM user_progress
        WHERE user_id = $1
        ORDER BY topic_key`,
      [req.auth.user.id],
    );
    res.json({ progress: rows.map(serializeProgress) });
  }));

  router.put("/progress/:topicId", asyncHandler(async (req, res) => {
    const topic = parse(topicKey, req.params.topicId);
    const fields = parse(progressSchema, req.body);
    const progress = await transaction(pool, (client) => (
      markProgress(client, req.auth.user.id, topic, fields)
    ));
    res.json({ progress });
  }));

  router.get("/test-drafts", asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT test_key, topic_key, answers, updated_at
         FROM test_drafts
        WHERE user_id = $1
        ORDER BY updated_at DESC`,
      [req.auth.user.id],
    );
    res.json({ drafts: rows.map(serializeDraft) });
  }));

  router.put("/test-drafts/:testId", asyncHandler(async (req, res) => {
    const testId = parse(stableKey, req.params.testId);
    const data = parse(draftSchema, req.body);
    const { rows } = await pool.query(
      `INSERT INTO test_drafts (user_id, test_key, topic_key, answers)
       VALUES ($1, $2, $3, $4::JSONB)
       ON CONFLICT (user_id, test_key) DO UPDATE SET
         topic_key = EXCLUDED.topic_key,
         answers = EXCLUDED.answers,
         updated_at = NOW()
       RETURNING test_key, topic_key, answers, updated_at`,
      [req.auth.user.id, testId, data.topicId, JSON.stringify(data.answers)],
    );
    res.json({ draft: serializeDraft(rows[0]) });
  }));

  router.delete("/test-drafts/:testId", asyncHandler(async (req, res) => {
    const testId = parse(stableKey, req.params.testId);
    await pool.query(
      "DELETE FROM test_drafts WHERE user_id = $1 AND test_key = $2",
      [req.auth.user.id, testId],
    );
    res.status(204).end();
  }));

  router.get("/test-attempts", asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, topic_key, test_key, score, max_score, percentage,
              submitted_answers, incorrect_question_ids, submitted_at
         FROM test_attempts
        WHERE user_id = $1
        ORDER BY submitted_at DESC, id DESC`,
      [req.auth.user.id],
    );
    res.json({ attempts: rows.map(serializeAttempt) });
  }));

  router.post("/test-attempts", asyncHandler(async (req, res) => {
    const data = parse(attemptSchema, req.body);
    const percentage = data.scorePoints === null
      ? null
      : Math.round((data.scorePoints / data.scoreTotal) * 10_000) / 100;
    const result = await transaction(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO test_attempts (
           user_id, topic_key, test_key, score, max_score, percentage,
           submitted_answers, incorrect_question_ids, submitted_at, legacy_client_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, $8::JSONB,
                   COALESCE($9::TIMESTAMPTZ, NOW()), $10)
         ON CONFLICT DO NOTHING
         RETURNING id, topic_key, test_key, score, max_score, percentage,
                   submitted_answers, incorrect_question_ids, submitted_at`,
        [
          req.auth.user.id,
          data.topicId,
          data.testId,
          data.scorePoints,
          data.scoreTotal,
          percentage,
          JSON.stringify(data.submittedAnswers),
          JSON.stringify(data.incorrectQuestionIds),
          data.legacyCreatedAt || null,
          data.legacyClientId || null,
        ],
      );
      let row = inserted.rows[0];
      if (!row && data.legacyClientId) {
        const existing = await client.query(
          `SELECT id, topic_key, test_key, score, max_score, percentage,
                  submitted_answers, incorrect_question_ids, submitted_at
             FROM test_attempts
            WHERE user_id = $1 AND legacy_client_id = $2`,
          [req.auth.user.id, data.legacyClientId],
        );
        row = existing.rows[0];
      }
      if (!row) throw new HttpError(409, "attempt_conflict", "Попытка уже сохранена");
      const progress = await markProgress(client, req.auth.user.id, data.topicId, { testCompleted: true });
      await client.query(
        "DELETE FROM test_drafts WHERE user_id = $1 AND test_key = $2",
        [req.auth.user.id, data.testId],
      );
      return { attempt: serializeAttempt(row), progress };
    });
    res.status(201).json(result);
  }));

  router.get("/homework-submissions", asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, topic_key, object_key, original_filename, mime_type, size_bytes,
              student_comment, status, teacher_comment, submitted_at, updated_at
         FROM homework_submissions
        WHERE user_id = $1
        ORDER BY submitted_at DESC, id DESC`,
      [req.auth.user.id],
    );
    res.json({ submissions: rows.map((row) => serializeHomework(row, req.auth.user)) });
  }));

  router.post("/homework-submissions/file", asyncHandler(async (req, res) => {
    const topic = parse(topicKey, decodeHeader(req, "x-topic-id", 100));
    const studentComment = parse(uploadComment, optionalEncodedHeader(req, "x-student-comment", 4000));
    const uploaded = await receiveUpload(req, suppliedUploadConfig);
    let replacedObjectKey = null;
    let result;
    try {
      result = await transaction(pool, async (client) => {
        const previousResult = await client.query(
          `SELECT id, object_key, status
             FROM homework_submissions
            WHERE user_id = $1 AND topic_key = $2
            ORDER BY submitted_at DESC, id DESC
            LIMIT 1
            FOR UPDATE`,
          [req.auth.user.id, topic],
        );
        const previous = previousResult.rows[0];
        let row;
        if (previous) {
          if (previous.status !== "submitted") {
            throw new HttpError(409, "submission_locked", "Работа уже принята на проверку");
          }
          replacedObjectKey = previous.object_key;
          const updated = await client.query(
            `UPDATE homework_submissions
                SET object_key = $3, original_filename = $4, mime_type = $5,
                    size_bytes = $6, student_comment = $7, file_revision = file_revision + 1,
                    submitted_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND user_id = $2
              RETURNING id, topic_key, object_key, original_filename, mime_type, size_bytes,
                        student_comment, status, teacher_comment, submitted_at, updated_at`,
            [previous.id, req.auth.user.id, uploaded.objectKey, uploaded.originalFilename,
              uploaded.mimeType, uploaded.sizeBytes, studentComment],
          );
          row = updated.rows[0];
        } else {
          const inserted = await client.query(
            `INSERT INTO homework_submissions (
               user_id, topic_key, object_key, original_filename, mime_type, size_bytes,
               student_comment, submitted_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
             RETURNING id, topic_key, object_key, original_filename, mime_type, size_bytes,
                       student_comment, status, teacher_comment, submitted_at, updated_at`,
            [req.auth.user.id, topic, uploaded.objectKey, uploaded.originalFilename,
              uploaded.mimeType, uploaded.sizeBytes, studentComment],
          );
          row = inserted.rows[0];
        }
        const progress = await markProgress(client, req.auth.user.id, topic, { homeworkSubmitted: true });
        return { submission: serializeHomework(row, req.auth.user), progress };
      });
    } catch (error) {
      await removeStoredFile(suppliedUploadConfig, uploaded.objectKey);
      throw error;
    }
    await cleanupReplacedUpload(suppliedUploadConfig, replacedObjectKey);
    res.status(201).json(result);
  }));

  router.get("/homework-submissions/:submissionId/file", asyncHandler(async (req, res) => {
    const id = parse(z.string().regex(/^[1-9]\d{0,18}$/), req.params.submissionId);
    const { rows } = await pool.query(
      `SELECT object_key, original_filename, mime_type, size_bytes
         FROM homework_submissions
        WHERE id = $1 AND user_id = $2 AND object_key IS NOT NULL`,
      [id, req.auth.user.id],
    );
    if (!rows[0]) throw new HttpError(404, "submission_not_found", "Работа не найдена");
    await sendStoredFile(res, suppliedUploadConfig, rows[0]);
  }));

  router.post("/homework-submissions", asyncHandler(async (req, res) => {
    const data = parse(homeworkSchema, req.body);
    const result = await transaction(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO homework_submissions (
           user_id, topic_key, object_key, original_filename, mime_type, size_bytes,
           student_comment, submitted_at, legacy_client_id
         ) VALUES ($1, $2, NULL, $3, $4, $5, $6, COALESCE($7::TIMESTAMPTZ, NOW()), $8)
         ON CONFLICT DO NOTHING
         RETURNING id, topic_key, original_filename, student_comment, status,
                   teacher_comment, submitted_at`,
        [
          req.auth.user.id,
          data.topicId,
          data.originalFilename,
          data.mimeType || null,
          data.sizeBytes || null,
          data.studentComment,
          data.legacyCreatedAt || null,
          data.legacyClientId || null,
        ],
      );
      let row = inserted.rows[0];
      if (!row && data.legacyClientId) {
        const existing = await client.query(
          `SELECT id, topic_key, original_filename, student_comment, status,
                  teacher_comment, submitted_at
             FROM homework_submissions
            WHERE user_id = $1 AND legacy_client_id = $2`,
          [req.auth.user.id, data.legacyClientId],
        );
        row = existing.rows[0];
      }
      if (!row) throw new HttpError(409, "homework_conflict", "Работа уже сохранена");
      const progress = await markProgress(client, req.auth.user.id, data.topicId, { homeworkSubmitted: true });
      return { submission: serializeHomework(row, req.auth.user), progress };
    });
    res.status(201).json(result);
  }));

  router.get("/mock-submissions", asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, mock_id, mock_version, mock_snapshot, object_key, original_filename,
              mime_type, size_bytes, file_revision, student_comment, status,
              teacher_comment, submitted_at, updated_at
         FROM mock_submissions
        WHERE user_id = $1
        ORDER BY updated_at DESC, id DESC`,
      [req.auth.user.id],
    );
    res.json({ submissions: rows.map((row) => serializeMockSubmission(row, req.auth.user)) });
  }));

  router.post("/mock-submissions/file", asyncHandler(async (req, res) => {
    const mockId = parse(stableKey, decodeHeader(req, "x-mock-id", 120));
    const version = parse(mockVersion, decodeHeader(req, "x-mock-version", 80));
    const studentComment = parse(uploadComment, optionalEncodedHeader(req, "x-student-comment", 4000));
    const mock = findMock(mockId, version);
    if (!mock) throw new HttpError(404, "mock_not_found", "Пробник не найден");
    const uploaded = await receiveUpload(req, suppliedUploadConfig);
    let replacedObjectKey = null;
    let submission;
    try {
      submission = await transaction(pool, async (client) => {
        const previousResult = await client.query(
          `SELECT id, object_key, status
             FROM mock_submissions
            WHERE user_id = $1 AND mock_id = $2 AND mock_version = $3
            FOR UPDATE`,
          [req.auth.user.id, mockId, version],
        );
        const previous = previousResult.rows[0];
        let row;
        const snapshot = JSON.stringify(mock);
        if (previous) {
          if (previous.status !== "submitted") {
            throw new HttpError(409, "submission_locked", "Работа уже принята на проверку");
          }
          replacedObjectKey = previous.object_key;
          const updated = await client.query(
            `UPDATE mock_submissions
                SET mock_snapshot = $4::JSONB, object_key = $5, original_filename = $6,
                    mime_type = $7, size_bytes = $8, student_comment = $9,
                    file_revision = file_revision + 1, submitted_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND user_id = $2 AND mock_version = $3
              RETURNING id, mock_id, mock_version, mock_snapshot, object_key,
                        original_filename, mime_type, size_bytes, file_revision,
                        student_comment, status, teacher_comment, submitted_at, updated_at`,
            [previous.id, req.auth.user.id, version, snapshot, uploaded.objectKey,
              uploaded.originalFilename, uploaded.mimeType, uploaded.sizeBytes, studentComment],
          );
          row = updated.rows[0];
        } else {
          const inserted = await client.query(
            `INSERT INTO mock_submissions (
               user_id, mock_id, mock_version, mock_snapshot, object_key,
               original_filename, mime_type, size_bytes, student_comment
             ) VALUES ($1, $2, $3, $4::JSONB, $5, $6, $7, $8, $9)
             RETURNING id, mock_id, mock_version, mock_snapshot, object_key,
                       original_filename, mime_type, size_bytes, file_revision,
                       student_comment, status, teacher_comment, submitted_at, updated_at`,
            [req.auth.user.id, mockId, version, snapshot, uploaded.objectKey,
              uploaded.originalFilename, uploaded.mimeType, uploaded.sizeBytes, studentComment],
          );
          row = inserted.rows[0];
        }
        return serializeMockSubmission(row, req.auth.user);
      });
    } catch (error) {
      await removeStoredFile(suppliedUploadConfig, uploaded.objectKey);
      throw error;
    }
    await cleanupReplacedUpload(suppliedUploadConfig, replacedObjectKey);
    res.status(201).json({ submission });
  }));

  router.get("/mock-submissions/:submissionId/file", asyncHandler(async (req, res) => {
    const id = parse(z.string().regex(/^[1-9]\d{0,18}$/), req.params.submissionId);
    const { rows } = await pool.query(
      `SELECT object_key, original_filename, mime_type, size_bytes
         FROM mock_submissions
        WHERE id = $1 AND user_id = $2`,
      [id, req.auth.user.id],
    );
    if (!rows[0]) throw new HttpError(404, "submission_not_found", "Работа не найдена");
    await sendStoredFile(res, suppliedUploadConfig, rows[0]);
  }));

  router.get("/messages", asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, category, body, teacher_reply, created_at
         FROM teacher_messages
        WHERE student_id = $1
        ORDER BY created_at DESC, id DESC`,
      [req.auth.user.id],
    );
    res.json({ messages: rows.map((row) => serializeMessage(row, req.auth.user)) });
  }));

  router.post("/messages", asyncHandler(async (req, res) => {
    const data = parse(messageSchema, req.body);
    const { rows } = await pool.query(
      `INSERT INTO teacher_messages (
         student_id, category, body, created_at, legacy_client_id
       ) VALUES ($1, $2, $3, COALESCE($4::TIMESTAMPTZ, NOW()), $5)
       ON CONFLICT DO NOTHING
       RETURNING id, category, body, teacher_reply, created_at`,
      [
        req.auth.user.id,
        data.category,
        data.text,
        data.legacyCreatedAt || null,
        data.legacyClientId || null,
      ],
    );
    let row = rows[0];
    if (!row && data.legacyClientId) {
      const existing = await pool.query(
        `SELECT id, category, body, teacher_reply, created_at
           FROM teacher_messages
          WHERE student_id = $1 AND legacy_client_id = $2`,
        [req.auth.user.id, data.legacyClientId],
      );
      row = existing.rows[0];
    }
    if (!row) throw new HttpError(409, "message_conflict", "Сообщение уже сохранено");
    res.status(201).json({ message: serializeMessage(row, req.auth.user) });
  }));

  return router;
}

module.exports = { createLearningRouter };
