"use strict";

const { HttpError } = require("../lib/http-error");
const { withTransaction } = require("../lib/transaction");
const { findMock } = require("../learning/mock-catalog");
const { findTopic, publicCourseCatalog } = require("./course-catalog");
const {
  TIMEZONE,
  addDays,
  deadlineAt,
  generateStudyPlan,
  todayInTimezone,
} = require("./generator");

const eventColumns = `id, user_id, event_type, topic_id, test_key, lesson_part,
  mock_id, mock_version, scheduled_date, original_scheduled_date, deadline_at,
  status, source, change_note, created_at, updated_at, cancelled_at, completed_at`;

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function serializePlan(row) {
  if (!row) return null;
  return {
    userId: String(row.user_id),
    startTopicId: row.start_topic_id,
    effectiveFrom: dateOnly(row.effective_from),
    targetEndDate: dateOnly(row.target_end_date),
    lessonWeekdays: (row.lesson_weekdays || []).map(Number),
    lessonsPerTopic: Number(row.lessons_per_topic),
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    generatedAt: row.generated_at,
  };
}

function serializeEvent(row) {
  const topic = row.topic_id ? findTopic(row.topic_id) : null;
  const mock = row.mock_id && row.mock_version ? findMock(row.mock_id, row.mock_version) : null;
  return {
    id: String(row.id),
    eventType: row.event_type,
    topicId: row.topic_id,
    topic: topic ? {
      id: topic.id,
      lesson: topic.lesson,
      lessonLabel: topic.lessonLabel,
      title: topic.title,
      sectionId: topic.sectionId,
      sectionLabel: topic.sectionLabel,
    } : null,
    testKey: row.test_key,
    lessonPart: row.lesson_part === null ? null : Number(row.lesson_part),
    mockId: row.mock_id,
    mockVersion: row.mock_version,
    mock: mock ? { title: mock.title, sectionLabel: mock.sectionLabel } : null,
    scheduledDate: dateOnly(row.scheduled_date),
    originalScheduledDate: dateOnly(row.original_scheduled_date),
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
    status: row.status,
    source: row.source,
    changeNote: row.change_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eventKey(event) {
  if (event.eventType === "thematic_mock") return `mock:${event.mockId}:${event.mockVersion}`;
  if (event.eventType === "lesson") return `lesson:${event.topicId}:${event.lessonPart}`;
  return `${event.eventType}:${event.topicId}`;
}

function generatedRow(event) {
  return [
    event.eventType,
    event.topicId,
    event.testKey,
    event.lessonPart,
    event.mockId,
    event.mockVersion,
    event.scheduledDate,
    event.deadlineAt,
  ];
}

async function ensureStudent(client, userId) {
  const { rows } = await client.query(
    `SELECT id FROM users
      WHERE id = $1 AND role = 'student' AND account_status <> 'archived'`,
    [userId],
  );
  if (!rows[0]) throw new HttpError(404, "student_not_found", "Ученик не найден");
}

async function readPlan(client, userId) {
  const { rows } = await client.query(
    `SELECT user_id, start_topic_id, effective_from, target_end_date,
            lesson_weekdays, lessons_per_topic, timezone,
            created_at, updated_at, generated_at
       FROM student_study_plans
      WHERE user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function readEvents(client, userId, { includeSuperseded = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${eventColumns}
       FROM study_schedule_events
      WHERE user_id = $1 ${includeSuperseded ? "" : "AND status <> 'superseded'"}
      ORDER BY scheduled_date, id`,
    [userId],
  );
  return rows;
}

function nearest(events, type, today) {
  return events.find((event) => event.status === "scheduled"
    && event.eventType === type && event.scheduledDate >= today) || null;
}

async function getStudyPlan(pool, userId, options = {}) {
  const planRow = await readPlan(pool, userId);
  if (!planRow) {
    return {
      plan: null,
      events: [],
      nextLesson: null,
      nextDeadline: null,
      message: "Расписание пока не настроено преподавателем",
    };
  }
  const events = (await readEvents(pool, userId, options)).map(serializeEvent);
  const today = todayInTimezone(planRow.timezone || TIMEZONE, options.now);
  const active = events.filter((event) => event.status === "scheduled" && event.scheduledDate >= today);
  const nextLesson = active.find((event) => event.eventType === "lesson") || null;
  const nextDeadline = active.find((event) => event.eventType !== "lesson") || null;
  return {
    plan: serializePlan(planRow),
    events,
    nextLesson,
    nextDeadline,
    message: null,
  };
}

function previewStudyPlan(settings, options = {}) {
  return generateStudyPlan(settings, options);
}

async function protectedEventKeys(client, userId, fromDate) {
  const { rows } = await client.query(
    `SELECT event_type, topic_id, lesson_part, mock_id, mock_version
       FROM study_schedule_events AS e
      WHERE e.user_id = $1
        AND e.scheduled_date >= $2
        AND e.status <> 'superseded'
        AND (
          e.status IN ('completed', 'cancelled')
          OR (e.event_type = 'test_deadline' AND EXISTS (
                SELECT 1 FROM test_attempts t
                 WHERE t.user_id = e.user_id AND t.topic_key = e.topic_id))
          OR (e.event_type = 'homework_deadline' AND EXISTS (
                SELECT 1 FROM homework_submissions h
                 WHERE h.user_id = e.user_id AND h.topic_key = e.topic_id))
          OR (e.event_type = 'thematic_mock' AND EXISTS (
                SELECT 1 FROM mock_submissions m
                 WHERE m.user_id = e.user_id AND m.mock_id = e.mock_id
                   AND m.mock_version = e.mock_version))
        )`,
    [userId, fromDate],
  );
  return new Set(rows.map((row) => eventKey({
    eventType: row.event_type,
    topicId: row.topic_id,
    lessonPart: row.lesson_part,
    mockId: row.mock_id,
    mockVersion: row.mock_version,
  })));
}

async function supersedeMutableFuture(client, userId, fromDate) {
  await client.query(
    `UPDATE study_schedule_events AS e
        SET status = 'superseded', updated_at = NOW(),
            change_note = CASE WHEN change_note = '' THEN 'future_recalculation' ELSE change_note END
      WHERE e.user_id = $1 AND e.scheduled_date >= $2 AND e.status = 'scheduled'
        AND NOT (
          (e.event_type = 'test_deadline' AND EXISTS (
             SELECT 1 FROM test_attempts t
              WHERE t.user_id = e.user_id AND t.topic_key = e.topic_id))
          OR (e.event_type = 'homework_deadline' AND EXISTS (
             SELECT 1 FROM homework_submissions h
              WHERE h.user_id = e.user_id AND h.topic_key = e.topic_id))
          OR (e.event_type = 'thematic_mock' AND EXISTS (
             SELECT 1 FROM mock_submissions m
              WHERE m.user_id = e.user_id AND m.mock_id = e.mock_id
                AND m.mock_version = e.mock_version))
        )`,
    [userId, fromDate],
  );
}

async function insertGeneratedEvents(client, userId, events, fromDate, protectedKeys) {
  let inserted = 0;
  for (const event of events) {
    if (event.scheduledDate < fromDate || protectedKeys.has(eventKey(event))) continue;
    await client.query(
      `INSERT INTO study_schedule_events (
         user_id, event_type, topic_id, test_key, lesson_part, mock_id, mock_version,
         scheduled_date, deadline_at, status, source
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::DATE, $9::TIMESTAMPTZ,
                 'scheduled', 'generated')`,
      [userId, ...generatedRow(event)],
    );
    inserted += 1;
  }
  return inserted;
}

async function writeAudit(client, actorId, action, userId, metadata = {}) {
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'student_study_plan', $3, $4::JSONB)`,
    [actorId, action, String(userId), JSON.stringify(metadata)],
  );
}

async function saveStudyPlan(pool, userId, settings, actorId, options = {}) {
  const validated = generateStudyPlan(settings, options);
  return withTransaction(pool, async (client) => {
    await ensureStudent(client, userId);
    const existing = await readPlan(client, userId);
    const today = todayInTimezone(TIMEZONE, options.now);
    if (existing && options.recalculateFrom && options.recalculateFrom < today) {
      throw new HttpError(409, "past_recalculation_forbidden", "Прошедшие события нельзя пересчитать");
    }
    const fromDate = existing
      ? (options.recalculateFrom || today)
      : "0001-01-01";
    let generated = validated;
    let effectiveFrom = validated.settings.effectiveFrom;
    if (existing) {
      const { rows } = await client.query(
        `SELECT topic_id, lesson_part FROM study_schedule_events
          WHERE user_id = $1 AND event_type = 'lesson' AND status = 'scheduled'
            AND scheduled_date >= $2::DATE
          ORDER BY scheduled_date, id LIMIT 1`,
        [userId, fromDate],
      );
      const firstFuture = rows[0] || null;
      const startTopicChanged = validated.settings.startTopicId !== existing.start_topic_id;
      const requestedEffectiveChanged = dateOnly(settings.effectiveFrom) !== dateOnly(existing.effective_from);
      if (!firstFuture && !startTopicChanged) {
        generated = null;
        effectiveFrom = dateOnly(existing.effective_from);
      } else {
        const requestedStart = settings.effectiveFrom || fromDate;
        const generationStart = requestedStart > fromDate ? requestedStart : fromDate;
        generated = generateStudyPlan({
          ...settings,
          startTopicId: startTopicChanged ? validated.settings.startTopicId : firstFuture.topic_id,
          effectiveFrom: generationStart,
          lessonWeekdays: validated.settings.lessonWeekdays,
          lessonsPerTopic: validated.settings.lessonsPerTopic,
          timezone: validated.settings.timezone,
        }, {
          ...options,
          startLessonPart: startTopicChanged ? 1 : Number(firstFuture.lesson_part),
        });
        effectiveFrom = (startTopicChanged || requestedEffectiveChanged)
          ? generated.settings.effectiveFrom
          : dateOnly(existing.effective_from);
      }
    }
    const protectedKeys = existing ? await protectedEventKeys(client, userId, fromDate) : new Set();
    if (existing) await supersedeMutableFuture(client, userId, fromDate);
    await client.query(
      `INSERT INTO student_study_plans (
         user_id, start_topic_id, effective_from, target_end_date,
         lesson_weekdays, lessons_per_topic, timezone, generated_at
       ) VALUES ($1, $2, $3::DATE, $4::DATE, $5::SMALLINT[], $6, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         start_topic_id = EXCLUDED.start_topic_id,
         effective_from = EXCLUDED.effective_from,
         target_end_date = EXCLUDED.target_end_date,
         lesson_weekdays = EXCLUDED.lesson_weekdays,
         lessons_per_topic = EXCLUDED.lessons_per_topic,
         timezone = EXCLUDED.timezone,
         updated_at = NOW(), generated_at = NOW()`,
      [userId, validated.settings.startTopicId, effectiveFrom,
        validated.settings.targetEndDate, validated.settings.lessonWeekdays,
        validated.settings.lessonsPerTopic, validated.settings.timezone],
    );
    const inserted = generated
      ? await insertGeneratedEvents(client, userId, generated.events, fromDate, protectedKeys)
      : 0;
    await writeAudit(client, actorId, existing ? "study_plan.updated" : "study_plan.created", userId, {
      fromDate: existing ? fromDate : null,
      insertedEvents: inserted,
    });
    return {
      ...(await getStudyPlan(client, userId, options)),
      summary: generated?.summary || null,
    };
  });
}

async function hasSubmission(client, userId, event) {
  if (event.event_type === "test_deadline") {
    const { rows } = await client.query(
      "SELECT 1 FROM test_attempts WHERE user_id = $1 AND topic_key = $2 LIMIT 1",
      [userId, event.topic_id],
    );
    return Boolean(rows[0]);
  }
  if (event.event_type === "homework_deadline") {
    const { rows } = await client.query(
      "SELECT 1 FROM homework_submissions WHERE user_id = $1 AND topic_key = $2 LIMIT 1",
      [userId, event.topic_id],
    );
    return Boolean(rows[0]);
  }
  if (event.event_type === "thematic_mock") {
    const { rows } = await client.query(
      `SELECT 1 FROM mock_submissions
        WHERE user_id = $1 AND mock_id = $2 AND mock_version = $3 LIMIT 1`,
      [userId, event.mock_id, event.mock_version],
    );
    return Boolean(rows[0]);
  }
  return false;
}

async function updateRelatedDeadline(client, userId, event, newDate, timezone) {
  const warnings = [];
  if (event.event_type !== "lesson") return warnings;
  if (Number(event.lesson_part) === 1) {
    const { rows: nextRows } = await client.query(
      `SELECT scheduled_date FROM study_schedule_events
        WHERE user_id = $1 AND event_type = 'lesson' AND status = 'scheduled'
          AND id <> $2 AND scheduled_date > $3::DATE
        ORDER BY scheduled_date, id LIMIT 1`,
      [userId, event.id, newDate],
    );
    if (!nextRows[0]) {
      warnings.push("После переноса не найдено следующее занятие для расчёта дедлайна теста.");
    } else {
      const nextDate = dateOnly(nextRows[0].scheduled_date);
      const testDate = addDays(nextDate, -1);
      const protectedResult = await client.query(
        "SELECT 1 FROM test_attempts WHERE user_id = $1 AND topic_key = $2 LIMIT 1",
        [userId, event.topic_id],
      );
      if (!protectedResult.rows[0]) {
        await client.query(
          `UPDATE study_schedule_events
              SET scheduled_date = $3::DATE, deadline_at = $4::TIMESTAMPTZ,
                  updated_at = NOW(), source = 'manual'
            WHERE user_id = $1 AND topic_id = $2 AND event_type = 'test_deadline'
              AND status = 'scheduled'`,
          [userId, event.topic_id, testDate, deadlineAt(testDate, timezone)],
        );
      }
    }
  }
  if (Number(event.lesson_part) === 2) {
    const homeworkDate = addDays(newDate, 3);
    const protectedResult = await client.query(
      "SELECT 1 FROM homework_submissions WHERE user_id = $1 AND topic_key = $2 LIMIT 1",
      [userId, event.topic_id],
    );
    if (!protectedResult.rows[0]) {
      await client.query(
        `UPDATE study_schedule_events
            SET scheduled_date = $3::DATE, deadline_at = $4::TIMESTAMPTZ,
                updated_at = NOW(), source = 'manual'
          WHERE user_id = $1 AND topic_id = $2 AND event_type = 'homework_deadline'
            AND status = 'scheduled'`,
        [userId, event.topic_id, homeworkDate, deadlineAt(homeworkDate, timezone)],
      );
    }
  }
  return warnings;
}

async function changeStudyEvent(pool, userId, eventId, change, actorId, options = {}) {
  return withTransaction(pool, async (client) => {
    await ensureStudent(client, userId);
    const plan = await readPlan(client, userId);
    if (!plan) throw new HttpError(404, "study_plan_not_found", "Учебный план не настроен");
    const { rows } = await client.query(
      `SELECT ${eventColumns} FROM study_schedule_events
        WHERE id = $1 AND user_id = $2 AND status <> 'superseded' FOR UPDATE`,
      [eventId, userId],
    );
    const event = rows[0];
    if (!event) throw new HttpError(404, "schedule_event_not_found", "Событие не найдено");
    const today = todayInTimezone(plan.timezone, options.now);
    if (dateOnly(event.scheduled_date) < today || event.status === "completed") {
      throw new HttpError(409, "past_event_locked", "Прошедшее событие нельзя изменить");
    }
    if (change.date && change.date < today) {
      throw new HttpError(409, "past_event_date_forbidden", "Нельзя перенести событие в прошлое");
    }
    if (await hasSubmission(client, userId, event)) {
      throw new HttpError(409, "submitted_event_locked", "По этому событию уже отправлена работа");
    }
    const lessonAction = ["move", "cancel", "restore", "replace"].includes(change.action);
    if ((lessonAction && event.event_type !== "lesson")
      || (change.action === "set_deadline" && event.event_type === "lesson")) {
      throw new HttpError(409, "invalid_event_action", "Это действие не подходит для выбранного события");
    }

    const warnings = [];
    if (change.action === "cancel") {
      if (event.status === "cancelled") throw new HttpError(409, "event_already_cancelled", "Занятие уже отменено");
      await client.query(
        `UPDATE study_schedule_events SET status = 'cancelled', cancelled_at = NOW(),
                source = 'manual', updated_at = NOW(), change_note = 'cancelled_by_teacher'
          WHERE id = $1 AND user_id = $2`,
        [eventId, userId],
      );
      if (event.event_type === "lesson") {
        warnings.push("У темы стало меньше запланированных занятий. При необходимости перенесите занятие или пересчитайте будущее расписание.");
      }
    } else if (change.action === "restore") {
      if (event.status !== "cancelled") throw new HttpError(409, "event_not_cancelled", "Событие не отменено");
      await client.query(
        `UPDATE study_schedule_events SET status = 'scheduled', cancelled_at = NULL,
                source = 'manual', updated_at = NOW(), change_note = 'restored_by_teacher'
          WHERE id = $1 AND user_id = $2`,
        [eventId, userId],
      );
    } else if (change.action === "replace") {
      if (event.status !== "cancelled" || event.event_type !== "lesson") {
        throw new HttpError(409, "replacement_not_allowed", "Заменяющее занятие можно создать только для отменённого занятия");
      }
      await client.query(
        `INSERT INTO study_schedule_events (
           user_id, event_type, topic_id, lesson_part, scheduled_date,
           status, source, change_note
         ) VALUES ($1, 'lesson', $2, $3, $4::DATE, 'scheduled', 'manual', $5)`,
        [userId, event.topic_id, event.lesson_part, change.date, `replacement_for:${event.id}`],
      );
      warnings.push(...await updateRelatedDeadline(client, userId, event, change.date, plan.timezone));
    } else {
      const newDate = change.date;
      const newDeadline = event.event_type === "lesson" ? null : deadlineAt(newDate, plan.timezone);
      await client.query(
        `UPDATE study_schedule_events
            SET original_scheduled_date = COALESCE(original_scheduled_date, scheduled_date),
                scheduled_date = $3::DATE, deadline_at = $4::TIMESTAMPTZ,
                source = 'manual', updated_at = NOW(), change_note = $5
          WHERE id = $1 AND user_id = $2`,
        [eventId, userId, newDate, newDeadline,
          change.action === "set_deadline" ? "deadline_changed_by_teacher" : "moved_by_teacher"],
      );
      warnings.push(...await updateRelatedDeadline(client, userId, event, newDate, plan.timezone));
    }
    await writeAudit(client, actorId, `study_event.${change.action}`, userId, { eventId: String(eventId), date: change.date || null });
    return { ...(await getStudyPlan(client, userId, options)), warnings };
  });
}

async function recalculateStudyPlan(pool, userId, fromDate, actorId, options = {}) {
  return withTransaction(pool, async (client) => {
    await ensureStudent(client, userId);
    const planRow = await readPlan(client, userId);
    if (!planRow) throw new HttpError(404, "study_plan_not_found", "Учебный план не настроен");
    const today = todayInTimezone(planRow.timezone, options.now);
    if (fromDate < today) {
      throw new HttpError(409, "past_recalculation_forbidden", "Прошедшие события нельзя пересчитать");
    }
    const { rows } = await client.query(
      `SELECT topic_id, lesson_part FROM study_schedule_events
        WHERE user_id = $1 AND event_type = 'lesson' AND status = 'scheduled'
          AND scheduled_date >= $2::DATE
        ORDER BY scheduled_date, id LIMIT 1`,
      [userId, fromDate],
    );
    const firstFuture = rows[0];
    if (!firstFuture) {
      return { ...(await getStudyPlan(client, userId, options)), summary: null, warnings: ["После выбранной даты нет будущих занятий для пересчёта."] };
    }
    const generated = generateStudyPlan({
      startTopicId: firstFuture.topic_id,
      effectiveFrom: fromDate,
      targetEndDate: dateOnly(planRow.target_end_date),
      lessonWeekdays: planRow.lesson_weekdays,
      lessonsPerTopic: Number(planRow.lessons_per_topic),
      timezone: planRow.timezone,
    }, { ...options, startLessonPart: Number(firstFuture.lesson_part) });
    const protectedKeys = await protectedEventKeys(client, userId, fromDate);
    await supersedeMutableFuture(client, userId, fromDate);
    const inserted = await insertGeneratedEvents(client, userId, generated.events, fromDate, protectedKeys);
    await client.query(
      "UPDATE student_study_plans SET generated_at = NOW(), updated_at = NOW() WHERE user_id = $1",
      [userId],
    );
    await writeAudit(client, actorId, "study_plan.recalculated", userId, { fromDate, insertedEvents: inserted });
    return { ...(await getStudyPlan(client, userId, options)), summary: generated.summary, warnings: generated.summary.warnings };
  });
}

module.exports = {
  changeStudyEvent,
  getStudyPlan,
  previewStudyPlan,
  publicCourseCatalog,
  recalculateStudyPlan,
  saveStudyPlan,
  serializeEvent,
  serializePlan,
};
