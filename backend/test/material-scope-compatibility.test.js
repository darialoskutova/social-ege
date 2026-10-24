"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const materialService = require("../materials/service");

const ROOT = path.resolve(__dirname, "../..");
const migration012 = fs.readFileSync(path.join(ROOT, "backend/migrations/012_material_scopes.sql"), "utf8");
const migration013 = fs.readFileSync(path.join(ROOT, "backend/migrations/013_legacy_material_scope_compatibility.sql"), "utf8");
const migrateRunner = fs.readFileSync(path.join(ROOT, "backend/scripts/migrate.js"), "utf8");
const materialSource = fs.readFileSync(path.join(ROOT, "backend/materials/service.js"), "utf8");

test("013 is an additive compatibility migration", () => {
  assert.doesNotMatch(migration013, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER)\b/i);
  assert.doesNotMatch(migration013, /\bINSERT\s+INTO\b/i);
  assert.match(migration013, /CREATE FUNCTION set_legacy_material_scope\(\)/);
  assert.match(migration013, /CREATE TRIGGER materials_legacy_scope_compat/);
});

test("compatibility trigger runs before insert constraints are checked", () => {
  assert.match(migration013, /BEFORE INSERT ON materials\s+FOR EACH ROW/i);
});

test("compatibility logic runs only for an omitted legacy scope", () => {
  assert.match(migration013, /IF NEW\.scope_type IS NULL THEN[\s\S]*?END IF;/);
  assert.equal((migration013.match(/NEW\.scope_type\s*:=/g) || []).length, 1);
});

test("legacy topic inserts infer topic scope first", () => {
  assert.match(migration013, /WHEN NEW\.topic_id IS NOT NULL THEN 'topic'/);
});

test("legacy section-plan inserts infer section scope", () => {
  assert.match(migration013, /NEW\.material_type IN \('section_plan', 'thematic_mock'\) THEN 'section'/);
});

test("legacy thematic-mock inserts infer section scope", () => {
  const sectionRule = /NEW\.material_type IN \('section_plan', 'thematic_mock'\) THEN 'section'/;
  assert.match(migration013, sectionRule);
  assert.ok(materialService.legacySeeds().filter((item) => item.type === "thematic_mock").every((item) => item.scope === "section"));
});

test("valid no-topic generic legacy inserts infer course scope", () => {
  assert.match(migration013, /ELSE 'course'/);
});

test("013 inference order matches the reviewed 012 backfill", () => {
  const expected012 = /WHEN topic_id IS NOT NULL THEN 'topic'[\s\S]*WHEN material_type IN \('section_plan', 'thematic_mock'\) THEN 'section'[\s\S]*ELSE 'course'/;
  const expected013 = /WHEN NEW\.topic_id IS NOT NULL THEN 'topic'[\s\S]*WHEN NEW\.material_type IN \('section_plan', 'thematic_mock'\) THEN 'section'[\s\S]*ELSE 'course'/;
  assert.match(migration012, expected012);
  assert.match(migration013, expected013);
});

test("an explicit scope remains owned by the new backend", () => {
  const guardedBody = migration013.match(/IF NEW\.scope_type IS NULL THEN([\s\S]*?)END IF;/)?.[1] || "";
  assert.match(guardedBody, /NEW\.scope_type\s*:=/);
  assert.doesNotMatch(migration013.replace(guardedBody, ""), /NEW\.scope_type\s*:=/);
});

test("trigger does not repair inconsistent section or topic fields", () => {
  assert.doesNotMatch(migration013, /NEW\.(?:section_id|topic_id)\s*:=/);
});

test("trigger does not mutate material identity, storage or status", () => {
  assert.doesNotMatch(migration013, /NEW\.(?:id|legacy_key|object_key|legacy_path|original_filename|status)\s*:=/);
});

test("card subtitle stays nullable and outside rollback compatibility logic", () => {
  assert.doesNotMatch(migration013, /card_subtitle/);
  assert.match(migration012, /ADD COLUMN card_subtitle VARCHAR\(180\)/);
  assert.doesNotMatch(migration012, /ALTER COLUMN card_subtitle SET NOT NULL/i);
});

test("012 still enforces non-null scope and the three consistency branches", () => {
  assert.match(migration012, /ALTER COLUMN scope_type SET NOT NULL/);
  assert.match(migration012, /scope_type = 'course' AND section_id IS NULL AND topic_id IS NULL/);
  assert.match(migration012, /scope_type = 'section' AND section_id IS NOT NULL AND topic_id IS NULL/);
  assert.match(migration012, /scope_type = 'topic' AND section_id IS NOT NULL AND topic_id IS NOT NULL/);
});

test("012 keeps the scope value allowlist", () => {
  assert.match(migration012, /CHECK \(scope_type IN \('course', 'section', 'topic'\)\)/);
});

test("normal migration runner makes 013 idempotent by filename and checksum", () => {
  assert.match(migrateRunner, /SELECT checksum FROM schema_migrations WHERE name = \$1/);
  assert.match(migrateRunner, /already applied:/);
  assert.match(migrateRunner, /Applied migration was modified/);
});

test("new material seed still explicitly supplies scope and scope fields", () => {
  assert.match(materialSource, /material_type, scope_type, section_id, topic_id/);
  assert.match(materialSource, /scope_type: seed\.scope, section_id: seed\.sectionId, topic_id: seed\.topicId/);
});

test("new serialization accepts a nullable legacy card subtitle", () => {
  const serialized = materialService.serialize({
    id: 1,
    title: "Legacy",
    material_type: "notes",
    scope_type: "topic",
    section_id: "politics",
    topic_id: "pol29",
    card_subtitle: null,
    reference_key: null,
    content_version: null,
    storage_kind: "legacy",
    object_key: null,
    legacy_path: "legacy.pdf",
    original_filename: "legacy.pdf",
    mime_type: "application/pdf",
    size_bytes: null,
    status: "published",
    sort_order: 1,
    created_at: new Date("2026-10-24T00:00:00Z"),
    updated_at: new Date("2026-10-24T00:00:00Z"),
  });
  assert.equal(serialized.subtitle, null);
});

test("reviewed legacy catalog keeps unique keys, four plans and fifteen mocks", () => {
  const seeds = materialService.legacySeeds();
  assert.equal(new Set(seeds.map((item) => item.legacyKey)).size, seeds.length);
  assert.equal(seeds.filter((item) => item.type === "section_plan").length, 4);
  assert.equal(seeds.filter((item) => item.type === "thematic_mock").length, 15);
});
