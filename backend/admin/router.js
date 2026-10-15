"use strict";

const express = require("express");
const { z } = require("zod");
const { createOneTimeToken } = require("../auth/account-tokens");
const {
  requireAllowedOrigin,
  requireAuth,
  requireRole,
  requireSecureTransport,
} = require("../auth/middleware");
const { asyncHandler } = require("../lib/async-handler");
const { HttpError } = require("../lib/http-error");
const { withTransaction } = require("../lib/transaction");
const { readUploadConfig, sendStoredFile } = require("../learning/file-storage");
const defaultStudyPlanService = require("../study-plan/service");
const defaultTestService = require("../tests/service");
const defaultMaterialService = require("../materials/service");
const { readMaterialConfig } = require("../materials/service");
const { courseTopics } = require("../study-plan/course-catalog");

const loginSchema = z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/)
  .transform((value) => value.normalize("NFKC").toLowerCase());
const namePartSchema = z.string().trim().min(1).max(60)
  .transform((value) => value.normalize("NFKC"));
const optionalMiddleNameSchema = z.preprocess(
  (value) => value === undefined || (typeof value === "string" && value.trim() === "") ? null : value,
  namePartSchema.nullable(),
);
const createStudentSchema = z.object({
  login: loginSchema,
  firstName: namePartSchema,
  lastName: namePartSchema,
  middleName: optionalMiddleNameSchema,
}).strict().refine((value) => displayName(value).length <= 120);
const updateStudentSchema = z.object({
  login: loginSchema.optional(),
  firstName: namePartSchema.optional(),
  lastName: namePartSchema.optional(),
  middleName: optionalMiddleNameSchema.optional(),
})
  .strict()
  .refine((value) => value.login !== undefined || hasIdentity(value))
  .refine((value) => !hasIdentity(value) || (value.firstName && value.lastName))
  .refine((value) => !hasIdentity(value) || displayName(value).length <= 120);
const studentIdSchema = z.string().regex(/^[1-9]\d{0,18}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
});
const studyPlanSchema = z.object({
  startTopicId: z.string().regex(/^[a-z0-9_-]{1,100}$/),
  lessonWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  effectiveFrom: dateSchema.nullable().optional(),
  targetEndDate: dateSchema.nullable().optional(),
  recalculateFrom: dateSchema.optional(),
}).strict();
const eventChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), date: dateSchema }).strict(),
  z.object({ action: z.literal("set_deadline"), date: dateSchema }).strict(),
  z.object({ action: z.literal("replace"), date: dateSchema }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("restore") }).strict(),
]);
const recalculateSchema = z.object({ fromDate: dateSchema }).strict();
const submissionTypeSchema = z.enum(["homework", "mock"]);
const reviewSchema = z.object({
  status: z.enum(["in_review", "needs_revision", "accepted"]),
  teacherComment: z.string().trim().max(4000).default(""),
}).strict();
const materialTypeSchema = z.enum(["notes", "section_plan", "additional", "homework", "thematic_mock"]);
const materialStatusSchema = z.enum(["published", "hidden", "archived"]);
const materialSectionSchema = z.enum(["human_society", "social_relations", "economics", "politics", "law"]);
const materialMetadataSchema = z.object({
  title: z.string().trim().min(1).max(300),
  type: materialTypeSchema,
  sectionId: materialSectionSchema,
  topicId: z.string().trim().regex(/^[a-z0-9_-]{1,100}$/).nullable().optional(),
  referenceKey: z.string().trim().regex(/^[a-z0-9._-]{1,160}$/).nullable().optional(),
  contentVersion: z.string().trim().regex(/^[a-z0-9._-]{1,80}$/).nullable().optional(),
  status: materialStatusSchema,
  sortOrder: z.number().int().min(-10000).max(10000).default(0),
}).strict().superRefine((value, context) => {
  if (["notes", "homework"].includes(value.type) && !value.topicId) {
    context.addIssue({ code: "custom", path: ["topicId"], message: "Для этого типа нужна тема" });
  }
  if (!value.topicId) return;
  const topic = courseTopics.find((item) => item.id === value.topicId);
  if (!topic || topic.sectionId !== value.sectionId) {
    context.addIssue({ code: "custom", path: ["topicId"], message: "Тема не относится к выбранному разделу" });
  }
});
const materialIdSchema = z.string().regex(/^[1-9]\d{0,18}$/);

function materialMetadataFromHeader(req) {
  const raw = req.get("x-material-metadata");
  if (!raw || raw.length > 6000) throw new HttpError(400, "invalid_material", "Проверьте данные материала");
  try {
    const parsed = materialMetadataSchema.safeParse(JSON.parse(decodeURIComponent(raw)));
    if (!parsed.success) throw new Error("invalid");
    return parsed.data;
  } catch {
    throw new HttpError(400, "invalid_material", "Проверьте данные материала");
  }
}

function materialId(value) {
  const parsed = materialIdSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(404, "material_not_found", "Материал не найден");
  return parsed.data;
}

function hasIdentity(value) {
  return value.firstName !== undefined
    || value.lastName !== undefined
    || value.middleName !== undefined;
}

function displayName(value) {
  return [value.lastName, value.firstName, value.middleName].filter(Boolean).join(" ");
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

const studentColumns = `id, login, display_name, first_name, last_name, middle_name,
  account_status, created_at,
  last_login_at, activated_at, disabled_at, archived_at`;

function publicStudent(row) {
  const student = {
    id: String(row.id),
    login: row.login,
    name: row.display_name,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    middleName: row.middle_name ?? null,
    status: row.account_status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    activatedAt: row.activated_at,
    disabledAt: row.disabled_at,
    archivedAt: row.archived_at,
    currentTopicId: row.current_topic_id ?? null,
    nextLesson: row.next_lesson_date ? {
      date: dateOnly(row.next_lesson_date),
      topicId: row.current_topic_id,
      lessonPart: row.next_lesson_part === null ? null : Number(row.next_lesson_part),
    } : null,
    completedSteps: Number(row.completed_steps || 0),
    waitingReviewCount: Number(row.waiting_review_count || 0),
  };
  if (Object.hasOwn(row, "activation_link_status")) {
    student.activationExpiresAt = row.activation_expires_at ?? null;
    student.activationLinkStatus = row.activation_link_status;
  }
  return student;
}

function studentId(value) {
  const parsed = studentIdSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(404, "student_not_found", "Ученик не найден");
  return parsed.data;
}

function inputError() {
  return new HttpError(400, "invalid_student", "Проверьте ФИО и логин");
}

function duplicateLogin(error) {
  if (error?.code === "23505") {
    return new HttpError(409, "login_exists", "Такой логин уже используется");
  }
  return error;
}

function linkFor(config, path, rawToken) {
  if (!config.publicOrigin) {
    throw new HttpError(503, "public_origin_missing", "Ссылку не удалось создать");
  }
  return `${config.publicOrigin}${path}#token=${encodeURIComponent(rawToken)}`;
}

async function audit(client, actorId, action, targetId, metadata = {}) {
  return auditTarget(client, actorId, action, "user", targetId, metadata);
}

async function auditTarget(client, actorId, action, targetType, targetId, metadata = {}) {
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorId, action, targetType, String(targetId), JSON.stringify(metadata)],
  );
}

function serializeAdminSubmission(row, type) {
  const isMock = type === "mock";
  return {
    id: String(row.id),
    type,
    studentId: String(row.user_id),
    studentName: row.display_name,
    studentLogin: row.login,
    topicId: isMock ? null : row.topic_key,
    mockId: isMock ? row.mock_id : null,
    mockVersion: isMock ? row.mock_version : null,
    mock: isMock ? row.mock_snapshot : null,
    title: isMock ? (row.mock_snapshot?.title || row.mock_id) : row.topic_key,
    fileName: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    fileRevision: Number(row.file_revision || 1),
    hasFile: Boolean(row.object_key),
    studentComment: row.student_comment || "",
    teacherComment: row.teacher_comment || "",
    status: row.status,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at || row.submitted_at,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    downloadUrl: row.object_key
      ? `/api/admin/${isMock ? "mock" : "homework"}-submissions/${row.id}/file`
      : null,
  };
}

async function loadAdminSubmissions(pool, { userId = null } = {}) {
  const filter = userId ? "WHERE s.user_id = $1" : "";
  const values = userId ? [userId] : [];
  const homework = await pool.query(
      `SELECT s.id, s.user_id, s.topic_key, s.object_key, s.original_filename, s.mime_type,
              s.size_bytes, s.file_revision, s.student_comment, s.status,
              s.teacher_comment, s.submitted_at, s.updated_at, s.reviewed_at,
              s.reviewed_by, u.login, u.display_name
         FROM homework_submissions AS s
         JOIN users AS u ON u.id = s.user_id
         ${filter}
        ORDER BY s.updated_at DESC, s.id DESC`,
      values,
    );
  const mocks = await pool.query(
      `SELECT s.id, s.user_id, s.mock_id, s.mock_version, s.mock_snapshot, s.object_key,
              s.original_filename, s.mime_type, s.size_bytes, s.file_revision,
              s.student_comment, s.status, s.teacher_comment, s.submitted_at,
              s.updated_at, s.reviewed_at, s.reviewed_by, u.login, u.display_name
         FROM mock_submissions AS s
         JOIN users AS u ON u.id = s.user_id
         ${filter}
        ORDER BY s.updated_at DESC, s.id DESC`,
      values,
    );
  return [
    ...homework.rows.map((row) => serializeAdminSubmission(row, "homework")),
    ...mocks.rows.map((row) => serializeAdminSubmission(row, "mock")),
  ].sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt)
    || Number(right.id) - Number(left.id));
}

async function ensureAdminStudent(pool, id) {
  const { rows } = await pool.query(
    `SELECT id FROM users
      WHERE id = $1 AND role = 'student' AND account_status <> 'archived'`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, "student_not_found", "Ученик не найден");
}

function createAdminRouter(
  pool,
  config,
  suppliedUploadConfig = readUploadConfig(),
  studyPlanService = defaultStudyPlanService,
  testService = defaultTestService,
  materialService = defaultMaterialService,
  materialConfig = readMaterialConfig(),
) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!config.enabled) {
      next(new HttpError(503, "auth_unavailable", "Вход временно недоступен"));
      return;
    }
    next();
  });
  router.use(requireSecureTransport(config));
  router.use(requireAllowedOrigin(config));
  router.use(requireAuth(pool, config));
  router.use(requireRole("admin"));

  router.get("/access", (req, res) => {
    res.set("Cache-Control", "no-store").json({ user: req.auth.user });
  });

  router.get("/course-catalog", (req, res) => {
    res.set("Cache-Control", "no-store").json({ topics: studyPlanService.publicCourseCatalog() });
  });

  router.get(
    "/tests",
    asyncHandler(async (req, res) => {
      const tests = await testService.listTests(pool);
      res.set("Cache-Control", "no-store").json({ tests });
    }),
  );

  router.get(
    "/tests/:testId",
    asyncHandler(async (req, res) => {
      const test = await testService.getAdminTest(pool, req.params.testId);
      res.set("Cache-Control", "no-store").json({ test });
    }),
  );

  router.put(
    "/tests/:testId",
    asyncHandler(async (req, res) => {
      const test = await testService.updateTest(
        pool,
        req.params.testId,
        req.body,
        req.auth.user.id,
      );
      res.set("Cache-Control", "no-store").json({ test });
    }),
  );

  router.get(
    "/materials",
    asyncHandler(async (req, res) => {
      const filters = {};
      const parsers = {
        sectionId: materialSectionSchema,
        type: materialTypeSchema,
        status: materialStatusSchema,
        topicId: z.string().trim().regex(/^[a-z0-9_-]{1,100}$/),
        search: z.string().trim().max(200),
      };
      for (const [name, schema] of Object.entries(parsers)) {
        if (req.query[name] === undefined || req.query[name] === "") continue;
        const parsed = schema.safeParse(req.query[name]);
        if (!parsed.success) throw new HttpError(400, "invalid_material_filter", "Проверьте фильтры");
        filters[name] = parsed.data;
      }
      const materials = await materialService.listAdmin(pool, filters);
      res.set("Cache-Control", "no-store").json({ materials });
    }),
  );

  router.post(
    "/materials/file",
    asyncHandler(async (req, res) => {
      const metadata = materialMetadataFromHeader(req);
      const material = await materialService.create(
        pool, req.auth.user.id, metadata, req, materialConfig,
      );
      res.set("Cache-Control", "no-store").status(201).json({ material });
    }),
  );

  router.patch(
    "/materials/:materialId",
    asyncHandler(async (req, res) => {
      const parsed = materialMetadataSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "invalid_material", "Проверьте данные материала");
      const material = await materialService.update(
        pool, req.auth.user.id, materialId(req.params.materialId), parsed.data,
      );
      res.set("Cache-Control", "no-store").json({ material });
    }),
  );

  router.put(
    "/materials/:materialId/file",
    asyncHandler(async (req, res) => {
      const material = await materialService.replaceFile(
        pool, req.auth.user.id, materialId(req.params.materialId), req, materialConfig,
      );
      res.set("Cache-Control", "no-store").json({ material });
    }),
  );

  router.get(
    "/materials/:materialId/file",
    asyncHandler(async (req, res) => {
      const material = await materialService.findFile(pool, materialId(req.params.materialId));
      await materialService.sendFile(res, materialConfig, material);
    }),
  );

  router.get(
    "/inbox",
    asyncHandler(async (req, res) => {
      const submissions = await loadAdminSubmissions(pool);
      const counts = { submitted: 0, in_review: 0, needs_revision: 0, accepted: 0 };
      submissions.forEach((submission) => {
        if (Object.hasOwn(counts, submission.status)) counts[submission.status] += 1;
      });
      res.set("Cache-Control", "no-store").json({ submissions, counts });
    }),
  );

  router.get(
    "/homework-submissions",
    asyncHandler(async (req, res) => {
      const submissions = (await loadAdminSubmissions(pool))
        .filter((submission) => submission.type === "homework");
      res.set("Cache-Control", "no-store").json({ submissions });
    }),
  );

  router.patch(
    "/submissions/:type/:submissionId/review",
    asyncHandler(async (req, res) => {
      const typeResult = submissionTypeSchema.safeParse(req.params.type);
      const parsed = reviewSchema.safeParse(req.body);
      if (!typeResult.success || !parsed.success) {
        throw new HttpError(400, "invalid_review", "Проверьте статус и комментарий");
      }
      const id = studentId(req.params.submissionId);
      const type = typeResult.data;
      const table = type === "mock" ? "mock_submissions" : "homework_submissions";
      const submission = await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE ${table}
              SET status = $2, teacher_comment = $3, reviewed_at = NOW(),
                  reviewed_by = $4, updated_at = NOW()
            WHERE id = $1
            RETURNING user_id`,
          [id, parsed.data.status, parsed.data.teacherComment, req.auth.user.id],
        );
        if (!updated.rows[0]) {
          throw new HttpError(404, "submission_not_found", "Работа не найдена");
        }
        await auditTarget(client, req.auth.user.id, "submission.reviewed", `${type}_submission`, id, {
          status: parsed.data.status,
          studentId: String(updated.rows[0].user_id),
          teacherComment: parsed.data.teacherComment,
        });
        const items = await loadAdminSubmissions(client, { userId: updated.rows[0].user_id });
        return items.find((item) => item.type === type && item.id === String(id));
      });
      res.set("Cache-Control", "no-store").json({ submission });
    }),
  );

  router.get(
    "/students/:studentId/details",
    asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const studentResult = await pool.query(
        `SELECT ${studentColumns}
           FROM users
          WHERE id = $1 AND role = 'student'`,
        [id],
      );
      if (!studentResult.rows[0]) throw new HttpError(404, "student_not_found", "Ученик не найден");
      const [plan, works, progressResult, attemptsResult] = await Promise.all([
        studyPlanService.getStudyPlan(pool, id),
        loadAdminSubmissions(pool, { userId: id }),
        pool.query(
          `SELECT topic_key, test_completed_at, homework_submitted_at, updated_at
             FROM user_progress
            WHERE user_id = $1
            ORDER BY updated_at DESC, topic_key`,
          [id],
        ),
        pool.query(
          `SELECT id, topic_key, test_key, score, max_score, percentage,
                  incorrect_question_ids, test_version, submitted_at,
                  ROW_NUMBER() OVER (
                    PARTITION BY test_key ORDER BY submitted_at, id
                  ) AS attempt_number
             FROM test_attempts
            WHERE user_id = $1
            ORDER BY submitted_at DESC, id DESC`,
          [id],
        ),
      ]);
      res.set("Cache-Control", "no-store").json({
        student: publicStudent(studentResult.rows[0]),
        studyPlan: plan,
        works,
        progress: progressResult.rows.map((row) => ({
          topicId: row.topic_key,
          testCompletedAt: row.test_completed_at,
          homeworkSubmittedAt: row.homework_submitted_at,
          updatedAt: row.updated_at,
        })),
        tests: attemptsResult.rows.map((row) => ({
          id: String(row.id),
          topicId: row.topic_key,
          testId: row.test_key,
          title: courseTopics.find((topic) => topic.id === row.topic_key)?.title || row.test_key,
          topicTitle: courseTopics.find((topic) => topic.id === row.topic_key)?.title || row.topic_key,
          sectionId: courseTopics.find((topic) => topic.id === row.topic_key)?.sectionId || null,
          score: row.score,
          maxScore: row.max_score,
          percentage: row.percentage === null ? null : Number(row.percentage),
          incorrectQuestionIds: row.incorrect_question_ids,
          testVersion: row.test_version === null ? null : Number(row.test_version),
          attemptNumber: Number(row.attempt_number),
          submittedAt: row.submitted_at,
        })),
      });
    }),
  );

  router.get(
    "/students/:studentId/test-attempts/:attemptId",
    asyncHandler(async (req, res) => {
      const ownerId = studentId(req.params.studentId);
      const attemptId = studentId(req.params.attemptId);
      const { rows } = await pool.query(
        `SELECT id, user_id, topic_key, test_key, score, max_score, percentage,
                submitted_answers, incorrect_question_ids, test_version,
                result_snapshot, submitted_at,
                (SELECT COUNT(*) FROM test_attempts AS earlier
                  WHERE earlier.user_id = test_attempts.user_id
                    AND earlier.test_key = test_attempts.test_key
                    AND (earlier.submitted_at, earlier.id) <=
                        (test_attempts.submitted_at, test_attempts.id)) AS attempt_number
           FROM test_attempts
          WHERE id = $1 AND user_id = $2`,
        [attemptId, ownerId],
      );
      const row = rows[0];
      if (!row) throw new HttpError(404, "attempt_not_found", "Попытка не найдена");
      const topic = courseTopics.find((item) => item.id === row.topic_key);
      const base = {
        id: String(row.id),
        studentId: String(row.user_id),
        topicId: row.topic_key,
        sectionId: topic?.sectionId || null,
        title: topic?.title || row.test_key,
        topicTitle: topic?.title || row.topic_key,
        testId: row.test_key,
        version: row.test_version === null ? null : Number(row.test_version),
        attemptNumber: Number(row.attempt_number),
        score: row.score,
        maxScore: row.max_score,
        percentage: row.percentage === null ? null : Number(row.percentage),
        submittedAt: row.submitted_at,
      };
      if (!row.test_version || !row.result_snapshot?.questionResults) {
        res.set("Cache-Control", "no-store").json({
          attempt: { ...base, detailsAvailable: false, questions: [] },
          message: "Для этой старой попытки подробные ответы не сохранялись.",
        });
        return;
      }
      const historical = await testService.getHistoricalTest(pool, row.test_key, row.test_version);
      if (!historical) {
        res.set("Cache-Control", "no-store").json({
          attempt: { ...base, detailsAvailable: false, questions: [] },
          message: "Версия теста для этой попытки недоступна.",
        });
        return;
      }
      const reviews = row.result_snapshot.questionResults;
      const questions = historical.questions.map((question) => {
        const review = reviews[question.id];
        return {
          id: question.id,
          number: question.number,
          type: question.type,
          prompt: question.prompt,
          options: question.options?.map((option) => ({ id: option.id, text: option.text })) || [],
          studentAnswers: review?.submittedAnswers || row.submitted_answers?.[question.id] || [],
          correctAnswers: review?.acceptedAnswers || [],
          isCorrect: review ? Boolean(review.isCorrect) : null,
          explanation: question.explanation || null,
        };
      });
      res.set("Cache-Control", "no-store").json({
        attempt: { ...base, detailsAvailable: true, questions },
      });
    }),
  );

  router.get(
    "/schedule",
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT e.id, e.user_id, e.event_type, e.topic_id, e.test_key, e.lesson_part,
                e.mock_id, e.mock_version, e.scheduled_date, e.original_scheduled_date,
                e.deadline_at, e.status, e.source, e.change_note, e.created_at,
                e.updated_at, e.cancelled_at, e.completed_at,
                u.login, u.display_name
           FROM study_schedule_events AS e
           JOIN users AS u ON u.id = e.user_id
          WHERE e.status <> 'superseded' AND u.role = 'student'
          ORDER BY e.scheduled_date, e.id`,
      );
      res.set("Cache-Control", "no-store").json({
        events: rows.map((row) => ({
          ...studyPlanService.serializeEvent(row),
          student: { id: String(row.user_id), name: row.display_name, login: row.login },
        })),
      });
    }),
  );

  router.get(
    "/students/:studentId/study-plan",
    asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      await ensureAdminStudent(pool, id);
      const result = await studyPlanService.getStudyPlan(pool, id);
      res.set("Cache-Control", "no-store").json(result);
    }),
  );

  router.post(
    "/students/:studentId/study-plan/preview",
    asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const parsed = studyPlanSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "invalid_study_plan", "Проверьте настройки учебного плана");
      await ensureAdminStudent(pool, id);
      let preview;
      try {
        preview = studyPlanService.previewStudyPlan({
          ...parsed.data,
          lessonsPerTopic: 2,
          timezone: "Europe/Moscow",
        });
      } catch {
        throw new HttpError(400, "invalid_study_plan", "Проверьте настройки учебного плана");
      }
      res.set("Cache-Control", "no-store").json(preview);
    }),
  );

  router.put(
    "/students/:studentId/study-plan",
    asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const parsed = studyPlanSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "invalid_study_plan", "Проверьте настройки учебного плана");
      try {
        studyPlanService.previewStudyPlan({
          ...parsed.data,
          lessonsPerTopic: 2,
          timezone: "Europe/Moscow",
        });
      } catch {
        throw new HttpError(400, "invalid_study_plan", "Проверьте настройки учебного плана");
      }
      const result = await studyPlanService.saveStudyPlan(pool, id, {
        ...parsed.data,
        lessonsPerTopic: 2,
        timezone: "Europe/Moscow",
      }, req.auth.user.id, { recalculateFrom: parsed.data.recalculateFrom });
      res.set("Cache-Control", "no-store").json(result);
    }),
  );

  router.patch(
    "/students/:studentId/study-plan/events/:eventId",
    asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const eventId = studentId(req.params.eventId);
      const parsed = eventChangeSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "invalid_schedule_change", "Проверьте изменение расписания");
      const result = await studyPlanService.changeStudyEvent(pool, id, eventId, parsed.data, req.auth.user.id);
      res.set("Cache-Control", "no-store").json(result);
    }),
  );

  router.post(
    "/students/:studentId/study-plan/recalculate",
    asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const parsed = recalculateSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "invalid_recalculation_date", "Укажите дату пересчёта");
      const result = await studyPlanService.recalculateStudyPlan(
        pool,
        id,
        parsed.data.fromDate,
        req.auth.user.id,
      );
      res.set("Cache-Control", "no-store").json(result);
    }),
  );

  router.get(
    "/mock-submissions",
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT s.id, s.mock_id, s.mock_version, s.mock_snapshot,
                s.original_filename, s.mime_type, s.size_bytes, s.file_revision,
                s.student_comment, s.status, s.teacher_comment,
                s.submitted_at, s.updated_at,
                u.login, u.display_name, u.first_name, u.last_name, u.middle_name
           FROM mock_submissions AS s
           JOIN users AS u ON u.id = s.user_id
          ORDER BY s.updated_at DESC, s.id DESC`,
      );
      res.set("Cache-Control", "no-store").json({
        submissions: rows.map((row) => ({
          id: String(row.id),
          studentName: row.display_name,
          studentLogin: row.login,
          firstName: row.first_name,
          lastName: row.last_name,
          middleName: row.middle_name,
          mockId: row.mock_id,
          mockVersion: row.mock_version,
          mock: row.mock_snapshot,
          fileName: row.original_filename,
          mimeType: row.mime_type,
          sizeBytes: Number(row.size_bytes),
          fileRevision: row.file_revision,
          studentComment: row.student_comment,
          teacherComment: row.teacher_comment,
          status: row.status,
          submittedAt: row.submitted_at,
          updatedAt: row.updated_at,
          downloadUrl: `/api/admin/mock-submissions/${row.id}/file`,
        })),
      });
    }),
  );

  router.get(
    "/homework-submissions/:submissionId/file",
    asyncHandler(async (req, res) => {
      const id = studentId(req.params.submissionId);
      const { rows } = await pool.query(
        `SELECT object_key, original_filename, mime_type, size_bytes
           FROM homework_submissions
          WHERE id = $1 AND object_key IS NOT NULL`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "submission_not_found", "Работа не найдена");
      await sendStoredFile(res, suppliedUploadConfig, rows[0]);
    }),
  );

  router.get(
    "/mock-submissions/:submissionId/file",
    asyncHandler(async (req, res) => {
      const id = studentId(req.params.submissionId);
      const { rows } = await pool.query(
        `SELECT object_key, original_filename, mime_type, size_bytes
           FROM mock_submissions
          WHERE id = $1`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, "submission_not_found", "Работа не найдена");
      await sendStoredFile(res, suppliedUploadConfig, rows[0]);
    }),
  );

  router.get(
    "/students",
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT u.id, u.login, u.display_name, u.first_name, u.last_name, u.middle_name,
                u.account_status, u.created_at,
                u.last_login_at, u.activated_at, u.disabled_at, u.archived_at,
                next_lesson.topic_id AS current_topic_id,
                next_lesson.scheduled_date AS next_lesson_date,
                next_lesson.lesson_part AS next_lesson_part,
                COALESCE(progress.completed_steps, 0) AS completed_steps,
                COALESCE(waiting.waiting_review_count, 0) AS waiting_review_count,
                activation.expires_at AS activation_expires_at,
                CASE
                  WHEN activation.id IS NULL THEN 'none'
                  WHEN activation.used_at IS NOT NULL THEN 'used'
                  WHEN activation.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN activation.expires_at <= NOW() THEN 'expired'
                  ELSE 'valid'
                END AS activation_link_status
           FROM users AS u
           LEFT JOIN LATERAL (
             SELECT id, expires_at, used_at, revoked_at
               FROM account_tokens
              WHERE user_id = u.id AND purpose = 'activation'
              ORDER BY created_at DESC, id DESC
              LIMIT 1
           ) AS activation ON TRUE
           LEFT JOIN LATERAL (
             SELECT topic_id, scheduled_date, lesson_part
               FROM study_schedule_events
              WHERE user_id = u.id AND event_type = 'lesson' AND status = 'scheduled'
                AND scheduled_date >= (NOW() AT TIME ZONE 'Europe/Moscow')::DATE
              ORDER BY scheduled_date, id
              LIMIT 1
           ) AS next_lesson ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE test_completed_at IS NOT NULL)
                    + COUNT(*) FILTER (WHERE homework_submitted_at IS NOT NULL) AS completed_steps
               FROM user_progress
              WHERE user_id = u.id
           ) AS progress ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(*) AS waiting_review_count
               FROM (
                 SELECT status FROM homework_submissions WHERE user_id = u.id
                 UNION ALL
                 SELECT status FROM mock_submissions WHERE user_id = u.id
               ) AS work
              WHERE status IN ('submitted', 'in_review')
           ) AS waiting ON TRUE
          WHERE u.role = 'student'
          ORDER BY u.archived_at NULLS FIRST, u.created_at DESC, u.id DESC`,
      );
      res.set("Cache-Control", "no-store").json({ students: rows.map(publicStudent) });
    }),
  );

  router.post(
    "/students",
    asyncHandler(async (req, res) => {
      const parsed = createStudentSchema.safeParse(req.body);
      if (!parsed.success) throw inputError();
      let result;
      try {
        result = await withTransaction(pool, async (client) => {
          const inserted = await client.query(
            `INSERT INTO users
               (login, first_name, last_name, middle_name, display_name,
                password_hash, role, is_active,
                password_changed_at, account_status)
             VALUES ($1, $2, $3, $4, $5, NULL, 'student', FALSE, NULL, 'pending_activation')
             RETURNING ${studentColumns}`,
            [
              parsed.data.login,
              parsed.data.firstName,
              parsed.data.lastName,
              parsed.data.middleName,
              displayName(parsed.data),
            ],
          );
          const row = inserted.rows[0];
          const token = await createOneTimeToken(client, {
            userId: row.id,
            purpose: "activation",
            createdBy: req.auth.user.id,
            ttlHours: config.accountTokenTtlHours,
          });
          await audit(client, req.auth.user.id, "student.created", row.id, { login: row.login });
          return {
            student: publicStudent({
              ...row,
              activation_expires_at: token.expiresAt,
              activation_link_status: "valid",
            }),
            activationUrl: linkFor(config, "/activate/", token.rawToken),
            expiresAt: token.expiresAt,
          };
        });
      } catch (error) {
        throw duplicateLogin(error);
      }
      res.set("Cache-Control", "no-store").status(201).json(result);
    }),
  );

  router.patch(
    "/students/:studentId",
    asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const parsed = updateStudentSchema.safeParse(req.body);
      if (!parsed.success) throw inputError();
      const identityChanged = hasIdentity(parsed.data);
      let result;
      try {
        result = await pool.query(
          `UPDATE users
              SET login = COALESCE($1, login),
                  first_name = CASE WHEN $2 THEN $3 ELSE first_name END,
                  last_name = CASE WHEN $2 THEN $4 ELSE last_name END,
                  middle_name = CASE WHEN $2 THEN $5 ELSE middle_name END,
                  display_name = CASE WHEN $2 THEN $6 ELSE display_name END,
                  updated_at = NOW()
            WHERE id = $7 AND role = 'student' AND account_status <> 'archived'
            RETURNING ${studentColumns}`,
          [
            parsed.data.login ?? null,
            identityChanged,
            parsed.data.firstName ?? null,
            parsed.data.lastName ?? null,
            parsed.data.middleName ?? null,
            identityChanged ? displayName(parsed.data) : null,
            id,
          ],
        );
      } catch (error) {
        throw duplicateLogin(error);
      }
      if (!result.rows[0]) throw new HttpError(404, "student_not_found", "Ученик не найден");
      await audit(pool, req.auth.user.id, "student.updated", id, {
        fields: Object.keys(parsed.data),
      });
      res.set("Cache-Control", "no-store").json({ student: publicStudent(result.rows[0]) });
    }),
  );

  router.post("/students/:studentId/block", statusAction("blocked"));
  router.post("/students/:studentId/unblock", statusAction("unblock"));
  router.post("/students/:studentId/archive", statusAction("archived"));

  router.post("/students/:studentId/activation-link", linkAction("activation"));
  router.post("/students/:studentId/password-reset-link", linkAction("password_reset"));

  function statusAction(action) {
    return asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const student = await withTransaction(pool, async (client) => {
        const selected = await client.query(
          `SELECT id, password_hash, account_status
             FROM users
            WHERE id = $1 AND role = 'student'
            LIMIT 1 FOR UPDATE`,
          [id],
        );
        const current = selected.rows[0];
        if (!current || current.account_status === "archived") {
          throw new HttpError(404, "student_not_found", "Ученик не найден");
        }
        const nextStatus = action === "unblock"
          ? (current.password_hash ? "active" : "pending_activation")
          : action;
        const updated = await client.query(
          `UPDATE users
              SET account_status = $1,
                  is_active = ($1 = 'active'),
                  disabled_at = CASE WHEN $1 IN ('blocked', 'archived') THEN NOW() ELSE NULL END,
                  archived_at = CASE WHEN $1 = 'archived' THEN NOW() ELSE archived_at END,
                  updated_at = NOW()
            WHERE id = $2
            RETURNING ${studentColumns}`,
          [nextStatus, id],
        );
        if (nextStatus !== "active") {
          await client.query(
            `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW())
              WHERE user_id = $1 AND revoked_at IS NULL`,
            [id],
          );
          await client.query(
            `UPDATE account_tokens SET revoked_at = COALESCE(revoked_at, NOW())
              WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
            [id],
          );
        }
        await audit(client, req.auth.user.id, `student.${action}`, id, { status: nextStatus });
        return publicStudent({
          ...updated.rows[0],
          ...(nextStatus === "pending_activation"
            ? { activation_expires_at: null, activation_link_status: "revoked" }
            : {}),
        });
      });
      res.set("Cache-Control", "no-store").json({ student });
    });
  }

  function linkAction(purpose) {
    return asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const result = await withTransaction(pool, async (client) => {
        const selected = await client.query(
          `SELECT id, login, account_status
             FROM users
            WHERE id = $1 AND role = 'student'
            LIMIT 1 FOR UPDATE`,
          [id],
        );
        const row = selected.rows[0];
        const requiredStatus = purpose === "activation" ? "pending_activation" : "active";
        if (!row || row.account_status !== requiredStatus) {
          throw new HttpError(409, "invalid_student_status", "Это действие недоступно для текущего статуса");
        }
        const token = await createOneTimeToken(client, {
          userId: row.id,
          purpose,
          createdBy: req.auth.user.id,
          ttlHours: config.accountTokenTtlHours,
        });
        await audit(client, req.auth.user.id, `student.${purpose}_link_created`, id, {
          expiresAt: token.expiresAt.toISOString(),
        });
        return {
          url: linkFor(
            config,
            purpose === "activation" ? "/activate/" : "/reset-password/",
            token.rawToken,
          ),
          expiresAt: token.expiresAt,
        };
      });
      res.set("Cache-Control", "no-store").json(result);
    });
  }

  return router;
}

module.exports = { createAdminRouter };
