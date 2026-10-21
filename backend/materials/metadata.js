"use strict";

const { z } = require("zod");
const { courseTopics, sectionRules } = require("../study-plan/course-catalog");

const materialTypeSchema = z.enum([
  "notes",
  "section_plan",
  "additional",
  "homework",
  "thematic_mock",
]);
const materialStatusSchema = z.enum(["published", "hidden", "archived"]);
const materialScopeSchema = z.enum(["course", "section", "topic"]);
const materialSectionSchema = z.enum(sectionRules.map((section) => section.id));
const materialTopicSchema = z.string().trim().regex(/^[a-z0-9_-]{1,100}$/);

const materialMetadataSchema = z.object({
  title: z.string().trim().min(1).max(300),
  type: materialTypeSchema,
  scope: materialScopeSchema,
  sectionId: materialSectionSchema.nullable().optional(),
  topicId: materialTopicSchema.nullable().optional(),
  subtitle: z.string().trim().max(180).nullable().optional(),
  referenceKey: z.string().trim().regex(/^[a-z0-9._-]{1,160}$/).nullable().optional(),
  contentVersion: z.string().trim().regex(/^[a-z0-9._-]{1,80}$/).nullable().optional(),
  status: materialStatusSchema,
  sortOrder: z.number().int().min(-10000).max(10000).default(0),
}).strict().superRefine((value, context) => {
  const sectionId = value.sectionId || null;
  const topicId = value.topicId || null;

  if (value.scope === "course" && (sectionId || topicId)) {
    context.addIssue({ code: "custom", path: [sectionId ? "sectionId" : "topicId"], message: "Для всего курса раздел и тема не указываются" });
    return;
  }
  if (value.scope === "section") {
    if (!sectionId) context.addIssue({ code: "custom", path: ["sectionId"], message: "Выберите раздел" });
    if (topicId) context.addIssue({ code: "custom", path: ["topicId"], message: "Для раздела тема не указывается" });
    return;
  }
  if (value.scope !== "topic") return;
  if (!sectionId) context.addIssue({ code: "custom", path: ["sectionId"], message: "Выберите раздел" });
  if (!topicId) {
    context.addIssue({ code: "custom", path: ["topicId"], message: "Выберите тему" });
    return;
  }
  const topic = courseTopics.find((item) => item.id === topicId);
  if (!topic || topic.sectionId !== sectionId) {
    context.addIssue({ code: "custom", path: ["topicId"], message: "Тема не относится к выбранному разделу" });
  }
});

module.exports = {
  materialMetadataSchema,
  materialScopeSchema,
  materialSectionSchema,
  materialStatusSchema,
  materialTypeSchema,
};
