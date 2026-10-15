"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "admin/admin.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "backend/migrations/006_personal_study_plans.sql"), "utf8");
const testMigration = fs.readFileSync(path.join(root, "backend/migrations/007_editable_tests.sql"), "utf8");

test("student cabinet loads the personal plan from protected learning API", () => {
  assert.match(index, /learningRequest\("\/study-plan"\)/);
  assert.match(index, /learningState\.studyPlan/);
  assert.match(index, /Расписание пока не настроено преподавателем/);
  assert.doesNotMatch(index, /const dailyCoursePlan\s*=/);
  assert.doesNotMatch(index, /localStorage[^\n]+study.?plan/i);
});

test("the shared course catalog leaves every executable inline script syntactically valid", () => {
  const scripts = [...index.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/.test(match[1])
      && !/type\s*=\s*["']application\/ld\+json/i.test(match[1]))
    .map((match) => match[2])
    .filter((source) => source.trim());
  scripts.forEach((source, scriptIndex) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `index-inline-${scriptIndex + 1}.js` }));
  });
  assert.equal((index.match(/const topics\s*=/g) || []).length, 1);
});

test("admin exposes preview, weekday selection and explicit future recalculation", () => {
  assert.match(adminHtml, /data-study-plan-form/);
  assert.match(adminHtml, /name="lessonWeekday" value="7"/);
  assert.match(adminHtml, /Закончить программу до/);
  assert.match(adminHtml, /Перестроить будущие занятия с даты/);
  assert.match(adminHtml, /Сохранить изменения расписания/);
  assert.match(adminJs, /study-plan\/preview/);
  assert.match(adminJs, /data-event-action/);
  assert.match(adminJs, /Пересчитать только будущие события/);
  assert.match(adminJs, /Тем в программе/);
  assert.match(adminJs, /Настройки изменены — обновите предварительный расчёт/);
  assert.match(adminJs, /await api\(`\/students\/\$\{activePlanStudent\.id\}\/study-plan`\)/);
});

test("topic tabs keep their labels and active state without decorative status circles", () => {
  assert.match(index, /data-lesson-tab="test"/);
  assert.match(index, /data-lesson-tab="homework"/);
  assert.doesNotMatch(index, /lessonTestTabStatus|lessonHomeworkTabStatus/);
});

test("admin test editor uses a normal form and reloads the persisted test", () => {
  assert.match(adminHtml, /data-tab="tests"/);
  assert.match(adminHtml, /data-test-search/);
  assert.match(adminHtml, /data-test-editor-form/);
  assert.match(adminJs, /api\(`\/tests\/\$\{encodeURIComponent\(activeAdminTest\.id\)\}`, \{ method: "PUT"/);
  assert.match(adminJs, /const refreshed = await api\(`\/tests\/\$\{encodeURIComponent\(activeAdminTest\.id\)\}`\)/);
  assert.doesNotMatch(adminHtml, /<textarea[^>]+JSON/i);
});

test("007 test-editor migration is additive and snapshots attempts", () => {
  assert.match(testMigration, /CREATE TABLE editable_tests/);
  assert.match(testMigration, /CREATE TABLE editable_test_versions/);
  assert.match(testMigration, /ADD COLUMN test_version INTEGER/);
  assert.match(testMigration, /ADD COLUMN result_snapshot JSONB/);
  assert.doesNotMatch(testMigration, /^\s*(?:DROP|TRUNCATE|DELETE)\b/im);
});

test("teacher workspace starts with the unified inbox and keeps account operations in settings", () => {
  assert.match(adminHtml, /data-tab="inbox"[^>]*>Входящие/);
  assert.match(adminHtml, /data-panel="students"/);
  assert.match(adminHtml, /data-panel="schedule"/);
  assert.match(adminHtml, /data-panel="settings"/);
  assert.match(adminJs, /api\("\/inbox"\)/);
  assert.match(adminJs, /submissions\/\$\{type\}\/\$\{id\}\/review/);
  assert.doesNotMatch(adminHtml, /Этот раздел появится на следующем этапе/);
});

test("006 migration is additive and isolated from auth, progress and submissions", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS student_study_plans/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS study_schedule_events/);
  assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|DELETE)\b/im);
  assert.doesNotMatch(migration, /ALTER TABLE (?:users|auth_sessions|user_progress|test_attempts|homework_submissions|mock_submissions)/i);
  assert.match(migration, /REFERENCES users\(id\) ON DELETE CASCADE/);
});
