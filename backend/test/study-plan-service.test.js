"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  changeStudyEvent,
  previewStudyPlan,
  recalculateStudyPlan,
  saveStudyPlan,
} = require("../study-plan/service");

function baseEvent(id, eventType, topicId, scheduledDate, extras = {}) {
  return {
    id,
    user_id: "1",
    event_type: eventType,
    topic_id: topicId,
    test_key: extras.testKey || null,
    lesson_part: extras.lessonPart || null,
    mock_id: extras.mockId || null,
    mock_version: extras.mockVersion || null,
    scheduled_date: scheduledDate,
    original_scheduled_date: null,
    deadline_at: extras.deadlineAt || null,
    status: extras.status || "scheduled",
    source: "generated",
    change_note: "",
    created_at: new Date("2026-10-01T00:00:00Z"),
    updated_at: new Date("2026-10-01T00:00:00Z"),
    cancelled_at: null,
    completed_at: null,
  };
}

function fixture(overrides = {}) {
  const state = {
    plan: {
      user_id: "1",
      start_topic_id: "pol35",
      effective_from: "2026-10-13",
      target_end_date: null,
      lesson_weekdays: [2, 4, 6],
      lessons_per_topic: 2,
      timezone: "Europe/Moscow",
      created_at: new Date("2026-10-01T00:00:00Z"),
      updated_at: new Date("2026-10-01T00:00:00Z"),
      generated_at: new Date("2026-10-01T00:00:00Z"),
    },
    events: [
      baseEvent(1, "lesson", "pol35", "2026-10-13", { lessonPart: 1 }),
      baseEvent(2, "test_deadline", "pol35", "2026-10-14", { testKey: "test-35", deadlineAt: "2026-10-14T20:59:00Z" }),
      baseEvent(3, "lesson", "pol35", "2026-10-15", { lessonPart: 2 }),
      baseEvent(4, "homework_deadline", "pol35", "2026-10-18", { deadlineAt: "2026-10-18T20:59:00Z" }),
      baseEvent(5, "lesson", "pol36", "2026-10-17", { lessonPart: 1 }),
      baseEvent(6, "test_deadline", "pol36", "2026-10-19", { testKey: "test-36", deadlineAt: "2026-10-19T20:59:00Z" }),
      baseEvent(7, "lesson", "pol36", "2026-10-20", { lessonPart: 2 }),
      baseEvent(8, "homework_deadline", "pol36", "2026-10-23", { deadlineAt: "2026-10-23T20:59:00Z" }),
    ],
    attempts: [],
    homework: [],
    mocks: [],
    audits: [],
    nextId: 20,
    ...overrides,
  };

  function submitted(event) {
    if (event.event_type === "test_deadline") {
      return state.attempts.some((item) => item.user_id === event.user_id && item.topic_key === event.topic_id);
    }
    if (event.event_type === "homework_deadline") {
      return state.homework.some((item) => item.user_id === event.user_id && item.topic_key === event.topic_id);
    }
    if (event.event_type === "thematic_mock") {
      return state.mocks.some((item) => item.user_id === event.user_id
        && item.mock_id === event.mock_id && item.mock_version === event.mock_version);
    }
    return false;
  }

  async function query(sql, values = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) return { rows: [] };
    if (normalized.startsWith("SELECT id FROM users")) return { rows: [{ id: values[0] }] };
    if (normalized.startsWith("SELECT user_id, start_topic_id")) return { rows: state.plan ? [state.plan] : [] };
    if (normalized.startsWith("SELECT id, user_id, event_type") && normalized.includes("FOR UPDATE")) {
      const event = state.events.find((item) => String(item.id) === String(values[0])
        && item.user_id === String(values[1]) && item.status !== "superseded");
      return { rows: event ? [event] : [] };
    }
    if (normalized.startsWith("SELECT id, user_id, event_type")) {
      const rows = state.events.filter((event) => event.user_id === String(values[0])
        && (normalized.includes("status <> 'superseded'") ? event.status !== "superseded" : true))
        .sort((left, right) => left.scheduled_date.localeCompare(right.scheduled_date) || left.id - right.id);
      return { rows };
    }
    if (normalized.startsWith("SELECT scheduled_date FROM study_schedule_events")) {
      const rows = state.events.filter((event) => event.user_id === String(values[0])
        && event.event_type === "lesson" && event.status === "scheduled"
        && String(event.id) !== String(values[1]) && event.scheduled_date > values[2])
        .sort((left, right) => left.scheduled_date.localeCompare(right.scheduled_date) || left.id - right.id);
      return { rows: rows.length ? [{ scheduled_date: rows[0].scheduled_date }] : [] };
    }
    if (normalized.startsWith("SELECT topic_id, lesson_part FROM study_schedule_events")) {
      const rows = state.events.filter((event) => event.user_id === String(values[0])
        && event.event_type === "lesson" && event.status === "scheduled" && event.scheduled_date >= values[1])
        .sort((left, right) => left.scheduled_date.localeCompare(right.scheduled_date) || left.id - right.id);
      return { rows: rows.length ? [{ topic_id: rows[0].topic_id, lesson_part: rows[0].lesson_part }] : [] };
    }
    if (normalized.startsWith("SELECT event_type, topic_id, lesson_part")) {
      return { rows: state.events.filter((event) => event.user_id === String(values[0])
        && event.scheduled_date >= values[1] && event.status !== "superseded"
        && (["completed", "cancelled"].includes(event.status) || submitted(event))) };
    }
    if (normalized.startsWith("SELECT 1 FROM test_attempts")) {
      return { rows: state.attempts.some((item) => item.user_id === String(values[0]) && item.topic_key === values[1]) ? [{ "?column?": 1 }] : [] };
    }
    if (normalized.startsWith("SELECT 1 FROM homework_submissions")) {
      return { rows: state.homework.some((item) => item.user_id === String(values[0]) && item.topic_key === values[1]) ? [{ "?column?": 1 }] : [] };
    }
    if (normalized.startsWith("SELECT 1 FROM mock_submissions")) {
      return { rows: state.mocks.some((item) => item.user_id === String(values[0])
        && item.mock_id === values[1] && item.mock_version === values[2]) ? [{ "?column?": 1 }] : [] };
    }
    if (normalized.startsWith("UPDATE study_schedule_events AS e")) {
      state.events.forEach((event) => {
        if (event.user_id === String(values[0]) && event.scheduled_date >= values[1]
          && event.status === "scheduled"
          && (!normalized.includes("AND NOT (") || !submitted(event))) event.status = "superseded";
      });
      return { rows: [] };
    }
    if (normalized.includes("SET original_scheduled_date = COALESCE")) {
      const event = state.events.find((item) => String(item.id) === String(values[0]) && item.user_id === String(values[1]));
      event.original_scheduled_date ||= event.scheduled_date;
      event.scheduled_date = values[2];
      event.deadline_at = values[3];
      event.source = "manual";
      event.change_note = values[4];
      return { rows: [] };
    }
    if (normalized.includes("SET status = 'cancelled'")) {
      const event = state.events.find((item) => String(item.id) === String(values[0]));
      event.status = "cancelled";
      event.cancelled_at = new Date();
      return { rows: [] };
    }
    if (normalized.includes("SET status = 'scheduled', cancelled_at = NULL")) {
      const event = state.events.find((item) => String(item.id) === String(values[0]));
      event.status = "scheduled";
      event.cancelled_at = null;
      return { rows: [] };
    }
    if (normalized.startsWith("UPDATE study_schedule_events") && normalized.includes("event_type = 'test_deadline'")) {
      state.events.filter((event) => event.user_id === String(values[0]) && event.topic_id === values[1]
        && event.event_type === "test_deadline" && event.status === "scheduled").forEach((event) => {
        event.scheduled_date = values[2]; event.deadline_at = values[3]; event.source = "manual";
      });
      return { rows: [] };
    }
    if (normalized.startsWith("UPDATE study_schedule_events") && normalized.includes("event_type = 'homework_deadline'")) {
      state.events.filter((event) => event.user_id === String(values[0]) && event.topic_id === values[1]
        && event.event_type === "homework_deadline" && event.status === "scheduled").forEach((event) => {
        event.scheduled_date = values[2]; event.deadline_at = values[3]; event.source = "manual";
      });
      return { rows: [] };
    }
    if (normalized.startsWith("INSERT INTO study_schedule_events") && normalized.includes("'lesson'")) {
      const replacement = baseEvent(state.nextId++, "lesson", values[1], values[3], { lessonPart: values[2] });
      replacement.source = "manual";
      replacement.change_note = values[4];
      state.events.push(replacement);
      return { rows: [] };
    }
    if (normalized.startsWith("INSERT INTO study_schedule_events")) {
      for (let offset = 1; offset < values.length; offset += 8) {
        state.events.push(baseEvent(state.nextId++, values[offset], values[offset + 1], values[offset + 6], {
          testKey: values[offset + 2], lessonPart: values[offset + 3], mockId: values[offset + 4],
          mockVersion: values[offset + 5], deadlineAt: values[offset + 7],
        }));
      }
      return { rows: [] };
    }
    if (normalized.startsWith("UPDATE student_study_plans SET generated_at")) return { rows: [] };
    if (normalized.startsWith("INSERT INTO student_study_plans")) {
      state.plan = {
        ...(state.plan || {}),
        user_id: String(values[0]),
        start_topic_id: values[1],
        effective_from: values[2],
        target_end_date: values[3],
        lesson_weekdays: values[4],
        lessons_per_topic: values[5],
        timezone: values[6],
        created_at: state.plan?.created_at || new Date(),
        updated_at: new Date(),
        generated_at: new Date(),
      };
      return { rows: [] };
    }
    if (normalized.startsWith("INSERT INTO audit_log")) {
      state.audits.push({ actorId: values[0], action: values[1], userId: values[2] });
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${normalized}`);
  }

  return {
    state,
    query,
    async connect() { return { query, release() {} }; },
  };
}

const NOW = { now: new Date("2026-10-11T09:00:00Z") };

test("moving part 1 changes only that lesson and recalculates its test deadline", async () => {
  const pool = fixture();
  const untouched = pool.state.events.find((event) => event.id === 3).scheduled_date;
  const result = await changeStudyEvent(pool, "1", "1", { action: "move", date: "2026-10-14" }, "9", NOW);
  assert.equal(pool.state.events.find((event) => event.id === 1).scheduled_date, "2026-10-14");
  assert.equal(pool.state.events.find((event) => event.id === 3).scheduled_date, untouched);
  assert.equal(pool.state.events.find((event) => event.id === 2).scheduled_date, "2026-10-14");
  assert.equal(result.events.find((event) => event.id === "1").originalScheduledDate, "2026-10-13");
});

test("moving part 2 recalculates second-part deadline by three calendar days", async () => {
  const pool = fixture();
  await changeStudyEvent(pool, "1", "3", { action: "move", date: "2026-10-16" }, "9", NOW);
  assert.equal(pool.state.events.find((event) => event.id === 4).scheduled_date, "2026-10-19");
  assert.equal(new Date(pool.state.events.find((event) => event.id === 4).deadline_at).toISOString(), "2026-10-19T20:59:00.000Z");
});

test("cancelled event remains in history and can be restored", async () => {
  const pool = fixture();
  const cancelled = await changeStudyEvent(pool, "1", "5", { action: "cancel" }, "9", NOW);
  assert.equal(cancelled.events.find((event) => event.id === "5").status, "cancelled");
  assert.ok(cancelled.warnings.length > 0);
  const restored = await changeStudyEvent(pool, "1", "5", { action: "restore" }, "9", NOW);
  assert.equal(restored.events.find((event) => event.id === "5").status, "scheduled");
});

test("a cancelled lesson can keep its history and receive a separate replacement", async () => {
  const pool = fixture();
  await changeStudyEvent(pool, "1", "5", { action: "cancel" }, "9", NOW);
  await changeStudyEvent(pool, "1", "5", { action: "replace", date: "2026-10-21" }, "9", NOW);
  assert.equal(pool.state.events.find((event) => event.id === 5).status, "cancelled");
  const replacement = pool.state.events.find((event) => event.change_note === "replacement_for:5");
  assert.ok(replacement);
  assert.equal(replacement.scheduled_date, "2026-10-21");
  assert.equal(replacement.lesson_part, 1);
});

test("submitted deadlines cannot be rewritten", async () => {
  const pool = fixture({ attempts: [{ user_id: "1", topic_key: "pol35" }] });
  await assert.rejects(
    changeStudyEvent(pool, "1", "2", { action: "set_deadline", date: "2026-10-20" }, "9", NOW),
    (error) => error.code === "submitted_event_locked" && error.status === 409,
  );
  assert.equal(pool.state.events.find((event) => event.id === 2).scheduled_date, "2026-10-14");
});

test("a future event cannot be moved into the past", async () => {
  const pool = fixture();
  await assert.rejects(
    changeStudyEvent(pool, "1", "1", { action: "move", date: "2026-10-10" }, "9", NOW),
    (error) => error.code === "past_event_date_forbidden" && error.status === 409,
  );
  assert.equal(pool.state.events.find((event) => event.id === 1).scheduled_date, "2026-10-13");
});

test("recalculate from date preserves past, completed, submitted and cancelled history", async () => {
  const pool = fixture({
    homework: [{ user_id: "1", topic_key: "pol36" }],
  });
  pool.state.events.find((event) => event.id === 7).status = "completed";
  pool.state.events.find((event) => event.id === 4).status = "cancelled";
  const pastSnapshot = JSON.stringify(pool.state.events.filter((event) => event.scheduled_date < "2026-10-17"));
  await recalculateStudyPlan(pool, "1", "2026-10-17", "9", NOW);
  assert.equal(JSON.stringify(pool.state.events.filter((event) => event.scheduled_date < "2026-10-17")), pastSnapshot);
  assert.equal(pool.state.events.find((event) => event.id === 7).status, "completed");
  assert.equal(pool.state.events.find((event) => event.id === 8).status, "scheduled");
  assert.equal(pool.state.events.find((event) => event.id === 4).status, "cancelled");
  assert.equal(pool.state.events.filter((event) => event.topic_id === "pol35"
    && event.event_type === "homework_deadline" && event.status === "scheduled").length, 0);
  assert.ok(pool.state.events.some((event) => event.id >= 20 && event.status === "scheduled"));
});

test("recalculate rejects a date in the past", async () => {
  const pool = fixture();
  const snapshot = JSON.stringify(pool.state.events);
  await assert.rejects(
    recalculateStudyPlan(pool, "1", "2026-10-10", "9", NOW),
    (error) => error.code === "past_recalculation_forbidden" && error.status === 409,
  );
  assert.equal(JSON.stringify(pool.state.events), snapshot);
});

test("changing weekdays resumes from the first future lesson instead of replaying the old start", async () => {
  const pool = fixture();
  const later = { now: new Date("2026-10-19T22:00:00Z") };
  const result = await saveStudyPlan(pool, "1", {
    startTopicId: "pol35",
    lessonWeekdays: [1, 3, 5],
    effectiveFrom: "2026-10-13",
    targetEndDate: null,
    lessonsPerTopic: 2,
    timezone: "Europe/Moscow",
  }, "9", later);
  assert.equal(result.nextLesson.topicId, "pol36");
  assert.equal(result.nextLesson.lessonPart, 2);
  assert.equal(result.nextLesson.scheduledDate, "2026-10-21");
  assert.equal(pool.state.events.find((event) => event.id === 1).status, "scheduled");
});

test("changing start topic rebuilds only the future from part one of the new topic", async () => {
  const pool = fixture();
  const later = { now: new Date("2026-10-19T22:00:00Z") };
  const pastSnapshot = JSON.stringify(pool.state.events.filter((event) => event.scheduled_date < "2026-10-20"));
  const result = await saveStudyPlan(pool, "1", {
    startTopicId: "law43",
    lessonWeekdays: [1, 3, 5],
    effectiveFrom: "2026-10-13",
    targetEndDate: null,
    lessonsPerTopic: 2,
    timezone: "Europe/Moscow",
  }, "9", later);
  assert.equal(result.plan.startTopicId, "law43");
  assert.equal(result.nextLesson.topicId, "law43");
  assert.equal(result.nextLesson.lessonPart, 1);
  assert.equal(result.nextLesson.scheduledDate, "2026-10-21");
  assert.equal(JSON.stringify(pool.state.events.filter((event) => event.scheduled_date < "2026-10-20")), pastSnapshot);
});

test("law48 to soc9 makes the new topic the first stored future lesson and hides stale deadlines", async () => {
  const pool = fixture({
    plan: {
      ...fixture().state.plan,
      start_topic_id: "law48",
      effective_from: "2026-10-13",
    },
    events: [
      baseEvent(1, "lesson", "law47", "2026-10-18", { lessonPart: 2, status: "completed" }),
      baseEvent(2, "lesson", "law48", "2026-10-20", { lessonPart: 1 }),
      baseEvent(3, "test_deadline", "law48", "2026-10-21", { testKey: "test-48" }),
      baseEvent(4, "lesson", "law48", "2026-10-22", { lessonPart: 2 }),
      baseEvent(5, "homework_deadline", "law48", "2026-10-25"),
    ],
    attempts: [{ user_id: "1", topic_key: "law48", score: 7 }],
  });
  const attemptSnapshot = JSON.stringify(pool.state.attempts);
  const result = await saveStudyPlan(pool, "1", {
    startTopicId: "soc9",
    lessonWeekdays: [1, 3, 5],
    effectiveFrom: "2026-10-13",
    targetEndDate: null,
    lessonsPerTopic: 2,
    timezone: "Europe/Moscow",
  }, "9", { now: new Date("2026-10-19T22:00:00Z") });

  assert.equal(pool.state.plan.start_topic_id, "soc9");
  assert.equal(result.nextLesson.topicId, "soc9");
  assert.equal(result.nextLesson.lessonPart, 1);
  assert.equal(result.summary.firstLessonDate, result.nextLesson.scheduledDate);
  assert.equal(pool.state.events.find((event) => event.id === 1).status, "completed");
  assert.equal(pool.state.events.find((event) => event.id === 3).status, "superseded");
  assert.equal(pool.state.events.find((event) => event.id === 2).status, "superseded");
  assert.equal(pool.state.events.find((event) => event.id === 4).status, "superseded");
  assert.equal(pool.state.events.find((event) => event.id === 5).status, "superseded");
  assert.equal(result.events.some((event) => ["2", "3", "4", "5"].includes(event.id)), false);
  assert.equal(JSON.stringify(pool.state.attempts), attemptSnapshot);
});

test("recalculating the same future range does not leave duplicate active event keys", async () => {
  const pool = fixture();
  await recalculateStudyPlan(pool, "1", "2026-10-17", "9", NOW);
  await recalculateStudyPlan(pool, "1", "2026-10-17", "9", NOW);
  const active = pool.state.events.filter((event) => event.status !== "superseded" && event.scheduled_date >= "2026-10-17");
  const keys = active.map((event) => `${event.event_type}:${event.topic_id || event.mock_id}:${event.lesson_part || event.mock_version || ""}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("preview is pure and does not mutate stored plan or events", () => {
  const pool = fixture();
  const snapshot = JSON.stringify(pool.state);
  const preview = previewStudyPlan({
    startTopicId: "law43",
    lessonWeekdays: [2, 4],
    effectiveFrom: "2026-10-20",
    targetEndDate: null,
    lessonsPerTopic: 2,
    timezone: "Europe/Moscow",
  }, NOW);
  assert.equal(preview.settings.startTopicId, "law43");
  assert.equal(JSON.stringify(pool.state), snapshot);
});
