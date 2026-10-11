"use strict";

const {
  courseTopics,
  findTopic,
  mandatoryMockForSection,
} = require("./course-catalog");

const TIMEZONE = "Europe/Moscow";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateKey(value) {
  if (!DATE_PATTERN.test(value || "")) throw new Error("Invalid calendar date");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Invalid calendar date");
  }
  return date;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, amount) {
  const date = parseDateKey(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function isoWeekday(value) {
  const weekday = parseDateKey(value).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function normalizeWeekdays(values) {
  const weekdays = [...new Set((values || []).map(Number))].sort((left, right) => left - right);
  if (!weekdays.length || weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 1 || weekday > 7)) {
    throw new Error("At least one valid lesson weekday is required");
  }
  return weekdays;
}

function nextStudyDate(onOrAfter, weekdays) {
  let candidate = onOrAfter;
  for (let offset = 0; offset < 8; offset += 1) {
    if (weekdays.includes(isoWeekday(candidate))) return candidate;
    candidate = addDays(candidate, 1);
  }
  throw new Error("Unable to find a study date");
}

function todayInTimezone(timezone = TIMEZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function deadlineAt(date, timezone = TIMEZONE) {
  if (timezone !== TIMEZONE) throw new Error("Unsupported study-plan timezone");
  parseDateKey(date);
  return new Date(`${date}T23:59:00+03:00`).toISOString();
}

function eventBase(eventType, scheduledDate, topic = null) {
  return {
    eventType,
    topicId: topic?.id || null,
    testKey: null,
    lessonPart: null,
    mockId: null,
    mockVersion: null,
    scheduledDate,
    deadlineAt: null,
    status: "scheduled",
    source: "generated",
  };
}

function generateStudyPlan(settings, options = {}) {
  const timezone = settings.timezone || TIMEZONE;
  if (timezone !== TIMEZONE) throw new Error("Unsupported study-plan timezone");
  const weekdays = normalizeWeekdays(settings.lessonWeekdays);
  const startTopic = findTopic(settings.startTopicId);
  if (!startTopic) throw new Error("Unknown start topic");
  const lessonsPerTopic = Number(settings.lessonsPerTopic || 2);
  if (!Number.isInteger(lessonsPerTopic) || lessonsPerTopic < 1 || lessonsPerTopic > 3) {
    throw new Error("Lessons per topic must be between 1 and 3");
  }
  const startLessonPart = Number(options.startLessonPart || 1);
  if (!Number.isInteger(startLessonPart) || startLessonPart < 1 || startLessonPart > lessonsPerTopic) {
    throw new Error("Invalid start lesson part");
  }
  const today = options.today || todayInTimezone(timezone, options.now);
  const requestedStart = settings.effectiveFrom || today;
  parseDateKey(requestedStart);
  if (settings.targetEndDate) parseDateKey(settings.targetEndDate);
  const firstLessonDate = nextStudyDate(requestedStart, weekdays);
  const firstIndex = courseTopics.findIndex((topic) => topic.id === startTopic.id);
  const selectedTopics = courseTopics.slice(firstIndex);
  const events = [];
  let cursor = firstLessonDate;

  selectedTopics.forEach((topic, topicIndex) => {
    const firstPart = topicIndex === 0 ? startLessonPart : 1;
    const lessonEvents = [];
    for (let part = firstPart; part <= lessonsPerTopic; part += 1) {
      const scheduledDate = nextStudyDate(cursor, weekdays);
      const lesson = eventBase("lesson", scheduledDate, topic);
      lesson.lessonPart = part;
      lessonEvents.push(lesson);
      events.push(lesson);
      cursor = addDays(scheduledDate, 1);
    }

    const partOne = lessonEvents.find((event) => event.lessonPart === 1);
    const partTwo = lessonEvents.find((event) => event.lessonPart === 2);
    if (partOne || (topicIndex === 0 && startLessonPart === 2 && partTwo)) {
      const nextLessonDate = partTwo?.scheduledDate || nextStudyDate(cursor, weekdays);
      const testDate = addDays(nextLessonDate, -1);
      const testEvent = eventBase("test_deadline", testDate, topic);
      testEvent.testKey = topic.testKey;
      testEvent.deadlineAt = deadlineAt(testDate, timezone);
      events.push(testEvent);
    }
    const finalLesson = lessonEvents.at(-1);
    if (finalLesson) {
      const homeworkDate = addDays(finalLesson.scheduledDate, 3);
      const homeworkEvent = eventBase("homework_deadline", homeworkDate, topic);
      homeworkEvent.deadlineAt = deadlineAt(homeworkDate, timezone);
      events.push(homeworkEvent);
    }

    const nextTopic = selectedTopics[topicIndex + 1];
    if (!nextTopic || nextTopic.sectionId !== topic.sectionId) {
      const mock = mandatoryMockForSection(topic.sectionId);
      if (mock && finalLesson) {
        const mockDate = addDays(finalLesson.scheduledDate, 3);
        const mockEvent = eventBase("thematic_mock", mockDate);
        mockEvent.mockId = mock.mockId;
        mockEvent.mockVersion = mock.contentVersion;
        mockEvent.deadlineAt = deadlineAt(mockDate, timezone);
        events.push(mockEvent);
      }
    }
  });

  events.sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate)
    || ({ lesson: 0, test_deadline: 1, homework_deadline: 2, thematic_mock: 3 }[left.eventType]
      - { lesson: 0, test_deadline: 1, homework_deadline: 2, thematic_mock: 3 }[right.eventType]));

  const lessonEvents = events.filter((event) => event.eventType === "lesson");
  const completionDate = events.reduce(
    (latest, event) => event.scheduledDate > latest ? event.scheduledDate : latest,
    firstLessonDate,
  );
  const missingLessonSlots = settings.targetEndDate
    ? lessonEvents.filter((event) => event.scheduledDate > settings.targetEndDate).length
    : 0;
  const warnings = [];
  if (settings.targetEndDate && completionDate > settings.targetEndDate) {
    warnings.push({
      code: "target_end_date_exceeded",
      expectedEndDate: completionDate,
      targetEndDate: settings.targetEndDate,
      missingLessonSlots,
      message: `При текущем расписании программа закончится ${completionDate}. Выбранная конечная дата — ${settings.targetEndDate}.`,
    });
  }

  return {
    settings: {
      startTopicId: startTopic.id,
      effectiveFrom: firstLessonDate,
      targetEndDate: settings.targetEndDate || null,
      lessonWeekdays: weekdays,
      lessonsPerTopic,
      timezone,
    },
    events,
    summary: {
      firstLessonDate,
      expectedEndDate: completionDate,
      topicCount: selectedTopics.length,
      lessonCount: lessonEvents.length,
      thematicMockCount: events.filter((event) => event.eventType === "thematic_mock").length,
      missingLessonSlots,
      warnings,
    },
  };
}

module.exports = {
  TIMEZONE,
  addDays,
  deadlineAt,
  generateStudyPlan,
  isoWeekday,
  nextStudyDate,
  normalizeWeekdays,
  todayInTimezone,
};
