"use strict";

const definitions = require("./definitions");
const answerKeys = require("./answer-keys");
const { HttpError } = require("../lib/http-error");
const { withTransaction } = require("../lib/transaction");
const { courseTopics } = require("../study-plan/course-catalog");

const testsById = new Map(definitions.tests.map((test) => [test.id, test]));
const topicsByTestId = new Map(courseTopics.map((topic) => [topic.testKey, topic]));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAnswer(value) {
  const normalized = String(value)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ");
  return /^[\d\s,;.]+$/.test(normalized) ? normalized.replace(/\D/g, "") : normalized;
}

function safeTestId(value) {
  const id = String(value || "");
  if (!/^[a-z0-9_-]{1,120}$/.test(id) || !testsById.has(id)) {
    throw new HttpError(404, "test_not_found", "Тест не найден");
  }
  return id;
}

function compactAnswerKey(testId) {
  const source = answerKeys.tests[testId];
  if (!source) throw new Error(`Missing answer key for ${testId}`);
  return {
    gradablePoints: Number(source.gradablePoints || 0),
    answers: Object.fromEntries(Object.entries(source.answers).map(([questionId, answer]) => [questionId, {
      type: answer.type,
      points: Number(answer.points || 0),
      acceptedAnswers: [...(answer.acceptedAnswers || [])],
    }])),
  };
}

function baseline(testId) {
  const id = safeTestId(testId);
  return {
    test: clone(testsById.get(id)),
    answerKey: compactAnswerKey(id),
    version: 1,
    updatedAt: null,
    updatedBy: null,
  };
}

function fromRow(row) {
  return {
    test: row.definition,
    answerKey: row.answer_key,
    version: Number(row.version),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by === null ? null : String(row.updated_by),
  };
}

async function resolvedTest(pool, testId, { forUpdate = false } = {}) {
  const id = safeTestId(testId);
  const { rows } = await pool.query(
    `SELECT test_key, version, definition, answer_key, updated_at, updated_by
       FROM editable_tests
      WHERE test_key = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] ? fromRow(rows[0]) : baseline(id);
}

function publicTest(resolved) {
  return {
    ...clone(resolved.test),
    version: resolved.version,
    questionCount: resolved.test.questions.length,
  };
}

function optionId(questionId, index) {
  return `${questionId}-option-${index + 1}`;
}

function adminTest(resolved) {
  const source = resolved.test;
  return {
    id: source.id,
    lesson: Number(source.lesson),
    subject: source.subject,
    title: source.title,
    version: resolved.version,
    questionCount: source.questions.length,
    totalPoints: source.totalPoints,
    updatedAt: resolved.updatedAt,
    updatedBy: resolved.updatedBy,
    questions: source.questions.map((question) => {
      const key = resolved.answerKey.answers[question.id] || { acceptedAnswers: [], points: 0 };
      const accepted = new Set((key.acceptedAnswers || []).map(normalizeAnswer));
      return {
        id: question.id,
        number: question.number,
        type: question.type,
        prompt: question.prompt || "",
        points: Number(key.points || 0),
        editable: ["checkbox", "radio", "select", "text"].includes(question.type),
        options: (question.options || []).map((text, index) => ({
          id: optionId(question.id, index),
          text,
          correct: accepted.has(normalizeAnswer(text)),
        })),
        acceptedAnswers: question.type === "text" ? [...(key.acceptedAnswers || [])] : [],
      };
    }),
  };
}

async function listTests(pool) {
  const { rows } = await pool.query(
    `SELECT test_key, version, definition, answer_key, updated_at, updated_by
       FROM editable_tests
      ORDER BY test_key`,
  );
  const overrides = new Map(rows.map((row) => [row.test_key, fromRow(row)]));
  return definitions.tests.map((definition) => {
    const resolved = overrides.get(definition.id) || baseline(definition.id);
    const topic = topicsByTestId.get(definition.id);
    return {
      id: definition.id,
      lesson: Number(definition.lesson),
      topicId: topic?.id || null,
      title: definition.title,
      questionCount: resolved.test.questions.length,
      version: resolved.version,
      updatedAt: resolved.updatedAt,
    };
  });
}

function invalidTest(message) {
  throw new HttpError(400, "invalid_test", message || "Проверьте вопросы и правильные ответы");
}

function normalizeEditorPayload(current, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || !Array.isArray(payload.questions) || payload.questions.length !== current.test.questions.length) {
    invalidTest("Количество вопросов не совпадает с тестом");
  }

  const incomingById = new Map();
  payload.questions.forEach((question) => {
    if (!question || typeof question !== "object" || typeof question.id !== "string"
      || incomingById.has(question.id)) invalidTest("Вопросы должны иметь уникальные ID");
    incomingById.set(question.id, question);
  });

  const definition = clone(current.test);
  const answerKey = clone(current.answerKey);
  definition.questions = definition.questions.map((question) => {
    const incoming = incomingById.get(question.id);
    if (!incoming) invalidTest(`Не найден вопрос ${question.number}`);
    const prompt = typeof incoming.prompt === "string" ? incoming.prompt.trim() : "";
    if (!prompt || prompt.length > 10_000) invalidTest(`Проверьте текст вопроса ${question.number}`);
    if (incoming.type !== question.type) invalidTest(`Тип вопроса ${question.number} нельзя изменить`);

    const next = { ...question, prompt };
    const key = answerKey.answers[question.id];
    if (!key) invalidTest(`Не найден ключ вопроса ${question.number}`);

    if (["checkbox", "radio", "select"].includes(question.type)) {
      if (!Array.isArray(incoming.options) || incoming.options.length !== (question.options || []).length) {
        invalidTest(`Нельзя изменять число вариантов в вопросе ${question.number}`);
      }
      const ids = new Set();
      const texts = new Set();
      const correct = [];
      next.options = incoming.options.map((option, index) => {
        const expectedId = optionId(question.id, index);
        const text = typeof option?.text === "string" ? option.text.trim() : "";
        if (!option || option.id !== expectedId || ids.has(option.id)) {
          invalidTest(`Дублирующийся или неверный ID в вопросе ${question.number}`);
        }
        if (!text || text.length > 2_000 || texts.has(normalizeAnswer(text))) {
          invalidTest(`Проверьте варианты в вопросе ${question.number}`);
        }
        ids.add(option.id);
        texts.add(normalizeAnswer(text));
        if (option.correct === true) correct.push(text);
        return text;
      });
      if (question.type === "radio" && correct.length !== 1) {
        invalidTest(`В вопросе ${question.number} нужен один правильный ответ`);
      }
      if (question.type === "checkbox" && correct.length < 1) {
        invalidTest(`В вопросе ${question.number} нужно отметить правильные ответы`);
      }
      if (question.type === "select" && correct.length !== 1) {
        invalidTest(`В вопросе ${question.number} нужен один правильный ответ`);
      }
      key.acceptedAnswers = correct;
    } else if (question.type === "text") {
      if (!Array.isArray(incoming.acceptedAnswers)) invalidTest(`Проверьте ответы в вопросе ${question.number}`);
      const accepted = incoming.acceptedAnswers.map((answer) => typeof answer === "string" ? answer.trim() : "");
      const normalized = accepted.map(normalizeAnswer);
      if (!accepted.length || accepted.some((answer) => !answer || answer.length > 2_000)
        || new Set(normalized).size !== normalized.length) {
        invalidTest(`Проверьте верные ответы в вопросе ${question.number}`);
      }
      key.acceptedAnswers = accepted;
    } else {
      invalidTest(`Тип вопроса ${question.number} пока не редактируется`);
    }
    return next;
  });

  return { definition, answerKey };
}

async function updateTest(pool, testId, payload, actorId) {
  const id = safeTestId(testId);
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`editable_test:${id}`]);
    const current = await resolvedTest(client, id, { forUpdate: true });
    const normalized = normalizeEditorPayload(current, payload);
    const version = current.version + 1;
    const { rows } = await client.query(
      `INSERT INTO editable_tests (
         test_key, version, definition, answer_key, updated_at, updated_by
       ) VALUES ($1, $2, $3::JSONB, $4::JSONB, NOW(), $5)
       ON CONFLICT (test_key) DO UPDATE SET
         version = EXCLUDED.version,
         definition = EXCLUDED.definition,
         answer_key = EXCLUDED.answer_key,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by
       RETURNING test_key, version, definition, answer_key, updated_at, updated_by`,
      [id, version, JSON.stringify(normalized.definition), JSON.stringify(normalized.answerKey), actorId],
    );
    await client.query(
      `INSERT INTO editable_test_versions (
         test_key, version, definition, answer_key, changed_at, changed_by
       ) VALUES ($1, $2, $3::JSONB, $4::JSONB, NOW(), $5)`,
      [id, version, JSON.stringify(normalized.definition), JSON.stringify(normalized.answerKey), actorId],
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, 'test.updated', 'test', $2, $3::JSONB)`,
      [actorId, id, JSON.stringify({ version, questionCount: normalized.definition.questions.length })],
    );
    return adminTest(fromRow(rows[0]));
  });
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function scoreTest(pool, testId, submittedAnswers) {
  const resolved = await resolvedTest(pool, testId);
  let earnedPoints = 0;
  let gradedQuestions = 0;
  let correctQuestions = 0;
  const questionResults = {};

  for (const [questionId, key] of Object.entries(resolved.answerKey.answers || {})) {
    const points = Number(key.points || 0);
    if (points <= 0) continue;
    const submitted = (submittedAnswers?.[questionId] || []).map(String).filter((value) => value.trim());
    const normalizedSubmitted = submitted.map(normalizeAnswer).sort();
    const normalizedAccepted = (key.acceptedAnswers || []).map(normalizeAnswer).sort();
    const isExact = ["checkbox"].includes(key.type);
    const isCorrect = isExact
      ? sameValues(normalizedSubmitted, normalizedAccepted)
      : normalizedSubmitted.some((value) => normalizedAccepted.includes(value));
    questionResults[questionId] = {
      isCorrect,
      submittedAnswers: submitted,
      acceptedAnswers: [...(key.acceptedAnswers || [])],
    };
    gradedQuestions += 1;
    if (isCorrect) {
      correctQuestions += 1;
      earnedPoints += points;
    }
  }

  const totalPoints = Number(resolved.answerKey.gradablePoints || 0);
  return {
    test: resolved.test,
    version: resolved.version,
    earnedPoints,
    totalPoints,
    percent: totalPoints ? Math.round((earnedPoints / totalPoints) * 100) : 0,
    correctQuestions,
    gradedQuestions,
    ungradedPoints: Math.max(0, Number(resolved.test.totalPoints || 0) - totalPoints),
    questionResults,
  };
}

module.exports = {
  adminTest,
  getAdminTest: async (pool, testId) => adminTest(await resolvedTest(pool, testId)),
  getStudentTest: async (pool, testId) => publicTest(await resolvedTest(pool, testId)),
  listTests,
  normalizeAnswer,
  scoreTest,
  updateTest,
};
