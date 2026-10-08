"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.resolve(__dirname, "../migrations/004_structured_student_names.sql"),
  "utf8",
);

test("structured-name migration is additive and preserves legacy display names", () => {
  assert.match(migration, /ADD COLUMN first_name VARCHAR\(60\)/);
  assert.match(migration, /ADD COLUMN last_name VARCHAR\(60\)/);
  assert.match(migration, /ADD COLUMN middle_name VARCHAR\(60\)/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bUPDATE\s+users\b/i);
  assert.doesNotMatch(migration, /ALTER\s+COLUMN\s+display_name/i);
});
