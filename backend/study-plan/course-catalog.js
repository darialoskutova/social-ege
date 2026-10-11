"use strict";

const rawTopics = require("../../data/course-topics");
const { mocks } = require("../learning/mock-catalog");

const sectionRules = Object.freeze([
  { id: "human_society", label: "Человек и общество / духовная культура", from: 1, to: 9 },
  { id: "social_relations", label: "Социальные отношения", from: 10, to: 14 },
  { id: "economics", label: "Экономика", from: 15, to: 28 },
  { id: "politics", label: "Политика", from: 29, to: 42 },
  { id: "law", label: "Право", from: 43, to: 56 },
]);

function sectionForLesson(lesson) {
  return sectionRules.find((section) => lesson >= section.from && lesson <= section.to) || null;
}

const courseTopics = Object.freeze(rawTopics.map((topic, index) => {
  const lesson = Number(topic.lesson);
  const section = sectionForLesson(lesson);
  if (!section) throw new Error(`Course topic ${topic.id} has no study-plan section`);
  return Object.freeze({
    id: topic.id,
    order: index + 1,
    lesson,
    lessonLabel: String(topic.lesson),
    title: topic.title,
    subject: topic.subject,
    sectionId: section.id,
    sectionLabel: section.label,
    testKey: `test-${String(topic.testLesson || topic.lesson).padStart(2, "0")}`,
    hasHomework: Boolean(topic.homework),
  });
}));

const topicIds = new Set(courseTopics.map((topic) => topic.id));
if (topicIds.size !== courseTopics.length) throw new Error("Course topic ids must be unique");

const topicsById = new Map(courseTopics.map((topic) => [topic.id, topic]));
const mandatoryMocksBySection = new Map(
  mocks.filter((mock) => mock.variant === 1).map((mock) => [mock.focusSection, mock]),
);

function findTopic(topicId) {
  return topicsById.get(topicId) || null;
}

function publicCourseCatalog() {
  return courseTopics.map((topic) => ({ ...topic }));
}

function mandatoryMockForSection(sectionId) {
  return mandatoryMocksBySection.get(sectionId) || null;
}

module.exports = {
  courseTopics,
  findTopic,
  mandatoryMockForSection,
  publicCourseCatalog,
  sectionRules,
};
