"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { materialMetadataSchema } = require("../materials/metadata");
const materialService = require("../materials/service");
const { courseTopics, sectionRules } = require("../study-plan/course-catalog");

const ROOT = path.resolve(__dirname, "../..");
const migration = fs.readFileSync(path.join(ROOT, "backend/migrations/012_material_scopes.sql"), "utf8");
const migrateRunner = fs.readFileSync(path.join(ROOT, "backend/scripts/migrate.js"), "utf8");
const studentHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const adminHtml = fs.readFileSync(path.join(ROOT, "admin/index.html"), "utf8");
const adminJs = fs.readFileSync(path.join(ROOT, "admin/admin.js"), "utf8");
const adminCss = fs.readFileSync(path.join(ROOT, "admin/admin.css"), "utf8");

function metadata(overrides = {}) {
  return {
    title: "Справочник по ЕГЭ",
    type: "additional",
    scope: "course",
    sectionId: null,
    topicId: null,
    subtitle: "Полезно держать под рукой",
    referenceKey: null,
    contentVersion: null,
    status: "published",
    sortOrder: 50,
    ...overrides,
  };
}

function valid(value) {
  return materialMetadataSchema.safeParse(value).success;
}

function row(overrides = {}) {
  return {
    id: 15,
    legacy_key: null,
    title: "Справочник по ЕГЭ",
    material_type: "additional",
    scope_type: "course",
    section_id: null,
    topic_id: null,
    card_subtitle: "Полезно держать под рукой",
    reference_key: null,
    content_version: null,
    storage_kind: "uploaded",
    legacy_path: null,
    object_key: "private-object.pdf",
    original_filename: "spravochnik.pdf",
    mime_type: "application/pdf",
    size_bytes: 100,
    status: "published",
    sort_order: 50,
    created_at: new Date("2026-10-21T00:00:00Z"),
    updated_at: new Date("2026-10-21T00:00:00Z"),
    ...overrides,
  };
}

test("012 migration is additive and creates no replacement materials table", () => {
  assert.match(migration, /ALTER TABLE materials/);
  assert.doesNotMatch(migration, /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE materials/i);
});

test("012 migration adds explicit scope and optional card subtitle", () => {
  assert.match(migration, /ADD COLUMN scope_type VARCHAR\(20\)/);
  assert.match(migration, /ADD COLUMN card_subtitle VARCHAR\(180\)/);
});

test("012 migration preserves ids, legacy keys and file identity columns", () => {
  assert.doesNotMatch(migration, /SET\s+(?:id|legacy_key|object_key|legacy_path|original_filename)\s*=/i);
});

test("012 backfills the existing 105-record production model in place", () => {
  assert.match(migration, /UPDATE materials/);
  assert.doesNotMatch(migration, /(?:INSERT INTO|DELETE FROM)\s+materials/i);
  assert.doesNotMatch(migration, /SET\s+title\s*=/i);
});

test("012 migration maps records with a topic to topic scope", () => {
  assert.match(migration, /WHEN topic_id IS NOT NULL THEN 'topic'/);
});

test("012 migration maps section plans and thematic mocks to section scope", () => {
  assert.match(migration, /material_type IN \('section_plan', 'thematic_mock'\) THEN 'section'/);
});

test("012 migration keeps old non-topic additional materials in the course block", () => {
  assert.match(migration, /ELSE 'course'/);
  assert.match(migration, /ELSE NULL/);
});

test("012 migration assigns the existing plan-card subtitle", () => {
  assert.match(migration, /material_type = 'section_plan' THEN 'Задание № 24'/);
});

test("012 migration enforces all three exact scope field combinations", () => {
  assert.match(migration, /scope_type = 'course' AND section_id IS NULL AND topic_id IS NULL/);
  assert.match(migration, /scope_type = 'section' AND section_id IS NOT NULL AND topic_id IS NULL/);
  assert.match(migration, /scope_type = 'topic' AND section_id IS NOT NULL AND topic_id IS NOT NULL/);
});

test("normal migration runner skips an already applied 012 by name and checksum", () => {
  assert.match(migrateRunner, /SELECT checksum FROM schema_migrations WHERE name = \$1/);
  assert.match(migrateRunner, /already applied:/);
  assert.match(migrateRunner, /Applied migration was modified/);
});

test("legacy topic seeds receive topic scope without changing stable keys", () => {
  const topicSeeds = materialService.legacySeeds().filter((item) => item.topicId);
  assert.ok(topicSeeds.length > 0);
  assert.ok(topicSeeds.every((item) => item.scope === "topic"));
  assert.ok(topicSeeds.every((item) => item.legacyKey.startsWith("topic:")));
});

test("the four legacy plan records remain unique section-scoped CMS records", () => {
  const plans = materialService.legacySeeds().filter((item) => item.type === "section_plan");
  assert.equal(plans.length, 4);
  assert.equal(new Set(plans.map((item) => item.legacyKey)).size, 4);
  assert.ok(plans.every((item) => item.scope === "section" && item.subtitle === "Задание № 24"));
});

test("all 15 thematic mocks remain section-scoped and keep reference identities", () => {
  const mocks = materialService.legacySeeds().filter((item) => item.type === "thematic_mock");
  assert.equal(mocks.length, 15);
  assert.ok(mocks.every((item) => item.scope === "section" && item.referenceKey && item.contentVersion));
});

test("course material accepts null section and topic", () => {
  assert.equal(valid(metadata()), true);
});

test("course material rejects a section", () => {
  assert.equal(valid(metadata({ sectionId: "politics" })), false);
});

test("course material rejects a topic", () => {
  assert.equal(valid(metadata({ topicId: "pol29" })), false);
});

test("section material accepts a canonical section without a topic", () => {
  assert.equal(valid(metadata({ scope: "section", sectionId: "politics" })), true);
});

test("section material requires a section", () => {
  assert.equal(valid(metadata({ scope: "section" })), false);
});

test("section material rejects stale topic metadata", () => {
  assert.equal(valid(metadata({ scope: "section", sectionId: "politics", topicId: "pol29" })), false);
});

test("topic material accepts a topic from its selected section", () => {
  const topic = courseTopics.find((item) => item.sectionId === "politics");
  assert.equal(valid(metadata({ scope: "topic", sectionId: topic.sectionId, topicId: topic.id })), true);
});

test("topic material requires a section", () => {
  assert.equal(valid(metadata({ scope: "topic", topicId: "pol29" })), false);
});

test("topic material requires a topic", () => {
  assert.equal(valid(metadata({ scope: "topic", sectionId: "politics" })), false);
});

test("topic material rejects a topic from another section", () => {
  const lawTopic = courseTopics.find((item) => item.sectionId === "law");
  assert.equal(valid(metadata({ scope: "topic", sectionId: "politics", topicId: lawTopic.id })), false);
});

test("unknown material scope is rejected", () => {
  assert.equal(valid(metadata({ scope: "student" })), false);
});

test("material title is required after trimming", () => {
  assert.equal(valid(metadata({ title: "   " })), false);
});

test("card subtitle is optional", () => {
  assert.equal(valid(metadata({ subtitle: null })), true);
  assert.equal(valid(metadata({ subtitle: undefined })), true);
});

test("card subtitle has a bounded length", () => {
  assert.equal(valid(metadata({ subtitle: "а".repeat(180) })), true);
  assert.equal(valid(metadata({ subtitle: "а".repeat(181) })), false);
});

test("sort order accepts the documented range only", () => {
  assert.equal(valid(metadata({ sortOrder: -10000 })), true);
  assert.equal(valid(metadata({ sortOrder: 10000 })), true);
  assert.equal(valid(metadata({ sortOrder: 10001 })), false);
  assert.equal(valid(metadata({ sortOrder: 1.5 })), false);
});

test("material type and scope remain independent concepts", () => {
  assert.equal(valid(metadata({ type: "notes", scope: "course" })), true);
  assert.equal(valid(metadata({ type: "section_plan", scope: "section", sectionId: "law" })), true);
});

test("canonical section schema and topic validation use the course catalog", () => {
  assert.deepEqual(sectionRules.map((item) => item.id), ["human_society", "social_relations", "economics", "politics", "law"]);
  assert.ok(courseTopics.every((topic) => sectionRules.some((section) => section.id === topic.sectionId)));
});

test("student serialization includes scope and subtitle", () => {
  const result = materialService.serialize(row(), false);
  assert.equal(result.scope, "course");
  assert.equal(result.subtitle, "Полезно держать под рукой");
});

test("student serialization never includes private storage identity", () => {
  const text = JSON.stringify(materialService.serialize(row(), false));
  assert.doesNotMatch(text, /private-object|object_key|legacy_path|storage_kind/);
});

test("admin serialization restores scope subtitle and status for editing", () => {
  const result = materialService.serialize(row({ status: "hidden" }), true);
  assert.deepEqual([result.scope, result.subtitle, result.status], ["course", "Полезно держать под рукой", "hidden"]);
});

test("student catalog query remains published-only and deterministically ordered", () => {
  const source = fs.readFileSync(path.join(ROOT, "backend/materials/service.js"), "utf8");
  assert.match(source, /WHERE status = 'published'/);
  assert.match(source, /ORDER BY scope_type, section_id NULLS FIRST, topic_id NULLS FIRST, sort_order, id/);
});

test("student download still requests published-only access", () => {
  const source = fs.readFileSync(path.join(ROOT, "backend/learning/router.js"), "utf8");
  assert.match(source, /findFile\(pool, parsed\.data, \{ publishedOnly: true \}\)/);
});

test("four hardcoded plan cards are removed from student HTML", () => {
  assert.doesNotMatch(studentHtml, /data-section-plan=/);
  assert.doesNotMatch(studentHtml, /href="доп материалы\/Планы по/);
});

test("the existing additional-files shelf is now a CMS render target", () => {
  assert.match(studentHtml, /library-shelf--extras[\s\S]*data-managed-library/);
  assert.match(studentHtml, /material\.scope === "course"/);
  assert.match(studentHtml, /material\.type === "section_plan"/);
});

test("student cards render CMS title and optional subtitle without filename fallback", () => {
  assert.match(studentHtml, /escapeHtml\(material\.title\)/);
  assert.match(studentHtml, /material\.subtitle[\s\S]*escapeHtml\(material\.subtitle\)/);
  assert.doesNotMatch(studentHtml, /managedMaterialCard[\s\S]{0,500}fileName/);
});

test("student cards use anchors and preserve the existing arrow", () => {
  assert.match(studentHtml, /<a class="library-file library-file--managed"[\s\S]*<b aria-hidden="true">↗<\/b>/);
  assert.match(studentHtml, /library-file--managed:focus-visible/);
});

test("managed cards sort by sort order and stable material id", () => {
  assert.match(studentHtml, /Number\(left\.sortOrder \|\| 0\) - Number\(right\.sortOrder \|\| 0\)/);
  assert.match(studentHtml, /localeCompare\(String\(right\.id\)[\s\S]*numeric: true/);
});

test("section material is rendered only for the current section context", () => {
  assert.match(studentHtml, /material\.scope === "section"[\s\S]*sectionIds\.includes\(material\.sectionId\)/);
});

test("topic material is rendered only for the current topic context", () => {
  assert.match(studentHtml, /material\.scope === "topic"[\s\S]*material\.topicId === topicId/);
});

test("empty context material groups are hidden", () => {
  assert.match(studentHtml, /panel\.hidden = renderManagedMaterialList\(container, items\) === 0/);
});

test("long managed-card text wraps without horizontal overflow", () => {
  assert.match(studentHtml, /\.library-file--managed strong,[\s\S]*overflow-wrap: anywhere/);
  assert.match(studentHtml, /grid-template-columns: minmax\(0, 1fr\) 18px/);
});

test("context cards collapse to one column on tablet and mobile", () => {
  assert.match(studentHtml, /@media \(max-width: 900px\)[\s\S]*\.context-materials \.library-file-grid\s*\{\s*grid-template-columns: 1fr/);
});

test("admin form exposes scope subtitle order file and status", () => {
  for (const name of ["scope", "subtitle", "sortOrder", "file", "status"]) {
    assert.match(adminHtml, new RegExp(`name="${name}"`));
  }
});

test("admin form has Russian course section and topic scope choices", () => {
  assert.match(adminHtml, /value="course">Весь курс/);
  assert.match(adminHtml, /value="section">Раздел/);
  assert.match(adminHtml, /value="topic">Тема/);
});

test("admin conditional scope fields toggle native required and disabled states", () => {
  assert.match(adminJs, /sectionField\.hidden = !needsSection/);
  assert.match(adminJs, /topicField\.hidden = !needsTopic/);
  assert.match(adminJs, /sectionId\.required = needsSection/);
  assert.match(adminJs, /topicId\.required = needsTopic/);
});

test("admin scope changes clear hidden stale fields before submission", () => {
  assert.match(adminJs, /clearHiddenValues && !needsSection[\s\S]*sectionId\.value = ""/);
  assert.match(adminJs, /clearHiddenValues && !needsTopic[\s\S]*topicId\.value = ""/);
});

test("admin edit restores scope section topic subtitle and sort order", () => {
  for (const expression of [
    /elements\.scope\.value = material\?\.scope/,
    /elements\.sectionId\.value = material\?\.sectionId/,
    /elements\.topicId\.value = material\?\.topicId/,
    /elements\.subtitle\.value = material\?\.subtitle/,
    /elements\.sortOrder\.value = material\?\.sortOrder/,
  ]) assert.match(adminJs, expression);
});

test("admin material form is one column at mobile width", () => {
  assert.match(adminCss, /@media \(max-width: 760px\)[\s\S]*\.material-form-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(adminCss, /\.material-form \.dialog-actions \{ align-items: stretch; flex-direction: column-reverse; \}/);
});
