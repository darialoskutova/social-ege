"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sourceTopics = require("../../data/course-topics");
const { courseTopics } = require("../study-plan/course-catalog");
const { generateStudyPlan } = require("../study-plan/generator");

function plan(overrides = {}, options = {}) {
  return generateStudyPlan({
    startTopicId: "pol35",
    lessonWeekdays: [2, 4, 6],
    effectiveFrom: "2026-10-12",
    targetEndDate: null,
    lessonsPerTopic: 2,
    timezone: "Europe/Moscow",
    ...overrides,
  }, options);
}

function topicEvents(result, topicId, eventType = null) {
  return result.events.filter((event) => event.topicId === topicId
    && (!eventType || event.eventType === eventType));
}

test("course catalog is the single ordered source used by frontend and backend", () => {
  assert.equal(courseTopics.length, 56);
  assert.deepEqual(courseTopics.map((topic) => topic.id), sourceTopics.map((topic) => topic.id));
  assert.deepEqual(courseTopics.map((topic) => topic.lesson), Array.from({ length: 56 }, (_, index) => index + 1));
});

test("every configured lesson material uses a Linux-safe canonical URL path", () => {
  const notes = sourceTopics.filter((topic) => topic.notes);
  assert.equal(notes.length, 42);
  for (const topic of sourceTopics) {
    for (const field of ["notes", "homework"]) {
      const materialPath = topic[field];
      if (!materialPath) continue;
      assert.equal(materialPath, materialPath.normalize("NFC"), `${topic.id}.${field} must use NFC`);
      assert.equal(materialPath.startsWith("/"), false, `${topic.id}.${field} must stay relative`);
      assert.equal(materialPath.split("/").includes(".."), false, `${topic.id}.${field} must not traverse directories`);
      assert.equal(materialPath.includes("\\"), false, `${topic.id}.${field} must use URL separators`);
    }
  }
});

test("A/B: every topic gets two lessons and Tue/Thu schedules part 1 then part 2", () => {
  const result = plan({ lessonWeekdays: [2, 4] });
  const lessons = topicEvents(result, "pol35", "lesson");
  assert.deepEqual(lessons.map((event) => [event.lessonPart, event.scheduledDate]), [
    [1, "2026-10-13"],
    [2, "2026-10-15"],
  ]);
  assert.ok(result.events.filter((event) => event.eventType === "lesson")
    .every((event, index, events) => index === 0 || event.scheduledDate >= events[index - 1].scheduledDate));
});

test("C: Tue/Thu/Sat alternates topics without placing two lessons on one date", () => {
  const lessons = plan().events.filter((event) => event.eventType === "lesson").slice(0, 6);
  assert.deepEqual(lessons.map((event) => [event.topicId, event.lessonPart, event.scheduledDate]), [
    ["pol35", 1, "2026-10-13"],
    ["pol35", 2, "2026-10-15"],
    ["pol36", 1, "2026-10-17"],
    ["pol36", 2, "2026-10-20"],
    ["pol37", 1, "2026-10-22"],
    ["pol37", 2, "2026-10-24"],
  ]);
  assert.equal(new Set(lessons.map((event) => event.scheduledDate)).size, lessons.length);
});

test("D: test deadline is 23:59 Moscow on the day before the next lesson", () => {
  const result = plan();
  const deadline = topicEvents(result, "pol35", "test_deadline")[0];
  assert.equal(deadline.scheduledDate, "2026-10-14");
  assert.equal(deadline.deadlineAt, "2026-10-14T20:59:00.000Z");
});

test("E/F: second-part deadline is +3 calendar days at 23:59 and may be Sunday", () => {
  const deadline = topicEvents(plan(), "pol35", "homework_deadline")[0];
  assert.equal(deadline.scheduledDate, "2026-10-18");
  assert.equal(deadline.deadlineAt, "2026-10-18T20:59:00.000Z");
  assert.equal(new Date(`${deadline.scheduledDate}T12:00:00Z`).getUTCDay(), 0);
});

test("G/H: a plan starts at any real topic and does not mark or schedule earlier topics", () => {
  const result = plan({ startTopicId: "pol35" });
  assert.equal(result.events.some((event) => event.topicId === "pol34"), false);
  assert.equal(result.events.some((event) => event.topicId === "pol35"), true);
  assert.equal(result.settings.startTopicId, "pol35");
  assert.equal(Object.hasOwn(result, "progress"), false);
});

test("I: an omitted effective date uses the nearest selected weekday", () => {
  const result = generateStudyPlan({
    startTopicId: "pol35",
    lessonWeekdays: [2, 4],
    targetEndDate: null,
    lessonsPerTopic: 2,
    timezone: "Europe/Moscow",
  }, { now: new Date("2026-10-12T07:00:00Z") });
  assert.equal(result.summary.firstLessonDate, "2026-10-13");
});

test("J: one existing thematic mock is inserted after every completed major section", () => {
  const result = plan();
  const politicsLastLesson = topicEvents(result, "pol42", "lesson").at(-1);
  const politicsMock = result.events.find((event) => event.mockId === "politics-1");
  assert.ok(politicsMock);
  assert.equal(politicsMock.mockVersion, "2027-draft-v1");
  assert.equal(politicsMock.scheduledDate, "2026-11-20");
  assert.equal(politicsLastLesson.scheduledDate, "2026-11-17");
  assert.equal(result.summary.thematicMockCount, 2);
});

test("K: target date produces a warning without dropping lessons or topics", () => {
  const result = plan({ targetEndDate: "2026-10-31" });
  assert.equal(result.summary.topicCount, 22);
  assert.equal(result.summary.lessonCount, 44);
  assert.ok(result.summary.missingLessonSlots > 0);
  assert.equal(result.summary.warnings[0].code, "target_end_date_exceeded");
  assert.equal(result.events.filter((event) => event.eventType === "lesson").at(-1).topicId, "law56");
});

test("Mon/Wed/Fri generator remains stable", () => {
  const lessons = plan({ lessonWeekdays: [1, 3, 5] }).events
    .filter((event) => event.eventType === "lesson").slice(0, 4);
  assert.deepEqual(lessons.map((event) => event.scheduledDate), [
    "2026-10-12", "2026-10-14", "2026-10-16", "2026-10-19",
  ]);
});

test("recalculation can resume from part 2 and rebuild its dependent deadlines", () => {
  const result = plan({
    startTopicId: "pol35",
    lessonWeekdays: [2, 4],
    effectiveFrom: "2026-10-20",
  }, { startLessonPart: 2 });
  const lessons = topicEvents(result, "pol35", "lesson");
  assert.deepEqual(lessons.map((event) => event.lessonPart), [2]);
  assert.equal(topicEvents(result, "pol35", "test_deadline")[0].scheduledDate, "2026-10-19");
  assert.equal(topicEvents(result, "pol35", "homework_deadline")[0].scheduledDate, "2026-10-23");
});
