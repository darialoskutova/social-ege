"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mocks: backendMocks } = require("../learning/mock-catalog");

const root = path.resolve(__dirname, "../..");
const manifestText = fs.readFileSync(path.join(root, "data/thematic-mocks.json"), "utf8");
const manifest = JSON.parse(manifestText);
const indexText = fs.readFileSync(path.join(root, "data/webium-task-index.json"), "utf8");
const index = JSON.parse(indexText);
const scores = [1, 2, 1, 2, 2, 2, 2, 2, 1, 2, 2, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 4, 3, 4, 6];
const reviewedLine22 = {
  human_society: [8107, 76635, 57939],
  economics: [70674, 82833, 76631],
  social_relations: [18358, 19116, 19288],
  politics: [21975, 47499, 81674],
  law: [22351, 32699, 83490],
};
const quarantined = new Set([61228, 67587, 20219, 85452, 36225, 81675, 84770, 37440]);

test("offline Webium index is complete and keeps answer keys out of public data", () => {
  assert.equal(index.task_count, 3949);
  assert.equal(index.tasks.length, 3949);
  assert.equal(index.tasks.filter((task) => task.section.length > 0).length, 3942);
  assert.equal(new Set(index.tasks.filter((task) => task.source_group_id).map((task) => task.source_group_id)).size, 47);
  assert.doesNotMatch(indexText, /correctAnswer|correctOptions|"solution"/i);
  assert.doesNotMatch(manifestText, /correctAnswer|correctOptions|"solution"/i);
});

test("all thematic mocks follow the FIPI 2027 draft score model", () => {
  assert.equal(manifest.exam_model, "EGE_SOCIAL_2027_DRAFT");
  assert.equal(manifest.official_status, "project");
  assert.equal(manifest.task_count, 25);
  assert.equal(manifest.max_score, 58);
  assert.deepEqual(manifest.score_schema, scores);
  assert.equal(manifest.mocks.length, 15);

  const sourceIds = new Set();
  const fingerprints = new Set();
  for (const mock of manifest.mocks) {
    assert.ok(mock.focus_section);
    assert.ok(mock.allowed_topics.length > 0);
    assert.equal(mock.tasks.length, 25);
    assert.deepEqual(mock.tasks.map((task) => task.display_position), [...Array(25)].map((_, index) => index + 1));
    assert.deepEqual(mock.tasks.map((task) => task.max_score), scores);
    assert.equal(mock.tasks.reduce((sum, task) => sum + task.max_score, 0), 58);
    assert.ok(mock.tasks.every((task) => task.section === mock.focus_section));
    assert.ok(mock.tasks.every((task) => task.has_answer_or_criteria === true));
    assert.equal(new Set(mock.tasks.map((task) => task.source_id)).size, 25);
    assert.equal(new Set(mock.tasks.map((task) => task.fingerprint)).size, 25);
    for (const task of mock.tasks) {
      assert.ok(!sourceIds.has(task.source_id), `duplicate source ${task.source_id}`);
      assert.ok(!fingerprints.has(task.fingerprint), `duplicate fingerprint ${task.fingerprint}`);
      sourceIds.add(task.source_id);
      fingerprints.add(task.fingerprint);
      if (task.source_exam_task_number === 23) assert.equal(task.section, "law");
    }
    const task17 = mock.tasks[16];
    const task18 = mock.tasks[17];
    assert.ok(task17.source_group_id);
    assert.equal(task17.source_group_id, task18.source_group_id);
    assert.equal(task18.depends_on, task17.id);
    assert.equal(mock.tasks[23].source_exam_task_number, 24);
    assert.equal(mock.tasks[24].source_exam_task_number, 25);
    assert.equal(
      mock.tasks[21].source_id,
      `webium:${reviewedLine22[mock.focus_section][mock.variant - 1]}`,
    );
    assert.match(mock.download_path, new RegExp(`/${mock.content_version}/`));
    const file = path.join(root, mock.download_path);
    assert.ok(fs.existsSync(file), `${mock.download_path} exists`);
    assert.equal(fs.readFileSync(file).subarray(0, 2).toString("ascii"), "PK");
  }
  assert.equal(sourceIds.size, 375);
  assert.equal(fingerprints.size, 375);
  assert.ok([...quarantined].every((id) => !sourceIds.has(`webium:${id}`)));
  assert.ok(index.tasks.filter((task) => quarantined.has(Number(task.source_id.split(":")[1])))
    .every((task) => task.excluded_reason));
});

test("backend catalog and public manifest describe the same immutable versions", () => {
  const publicKeys = manifest.mocks.map((mock) => `${mock.mock_id}:${mock.content_version}`).sort();
  const backendKeys = backendMocks.map((mock) => `${mock.mockId}:${mock.contentVersion}`).sort();
  assert.deepEqual(backendKeys, publicKeys);
  assert.ok(manifest.mocks.every((mock) => mock.content_version === manifest.content_version));
  for (const mock of manifest.mocks) {
    const backendMock = backendMocks.find((item) => item.mockId === mock.mock_id);
    assert.equal(backendMock.downloadPath, mock.download_path);
  }
});
