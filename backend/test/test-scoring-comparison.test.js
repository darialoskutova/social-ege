"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const definitions = require("../tests/definitions");
const answerKeys = require("../tests/answer-keys");
const { canonicalizeAnswer, scoreTest } = require("../tests/service");

function staticPool(row = null) {
  return {
    async query() { return { rows: row ? [row] : [] }; },
  };
}

function editableRow(answerKey) {
  return {
    test_key: "test-01",
    version: 2,
    definition: {
      id: "test-01", lesson: 1, subject: "sociology", title: "Scoring fixture",
      totalPoints: answerKey.gradablePoints, questions: [],
    },
    answer_key: answerKey,
    updated_at: new Date(),
    updated_by: 9,
  };
}

test("unordered numeric answers accept every permutation and separators, but not another multiset", () => {
  const correct = canonicalizeAnswer("123", "unordered");
  for (const answer of ["123", "132", "213", "231", "312", "321", "1 2 3", "2,1,3"]) {
    assert.equal(canonicalizeAnswer(answer, "unordered"), correct, answer);
  }
  for (const answer of ["124", "12", "1234", "1123"]) {
    assert.notEqual(canonicalizeAnswer(answer, "unordered"), correct, answer);
  }
  const hash = (answer) => crypto.createHash("sha256")
    .update(canonicalizeAnswer(answer, "unordered"), "utf8").digest("hex");
  assert.equal(hash("123"), hash("3,2,1"));
});

test("ordered matching answers preserve digit positions while allowing separators", () => {
  const correct = canonicalizeAnswer("12121", "ordered");
  assert.equal(canonicalizeAnswer("12121", "ordered"), correct);
  assert.equal(canonicalizeAnswer("1 2 1 2 1", "ordered"), correct);
  assert.equal(canonicalizeAnswer("1,2,1,2,1", "ordered"), correct);
  for (const answer of ["21121", "12112", "11221"]) {
    assert.notEqual(canonicalizeAnswer(answer, "ordered"), correct, answer);
  }
});

test("EGE-2027 comparison fixture keeps 3, 6, 13 and 15 ordered and 11 unordered", () => {
  const ordered = new Set([3, 6, 13, 15]);
  const unordered = new Set([1, 2, 4, 5, 7, 8, 9, 10, 11, 12, 14, 16]);
  const comparisonByNumber = Object.fromEntries([
    ...[...ordered].map((number) => [number, "ordered"]),
    ...[...unordered].map((number) => [number, "unordered"]),
  ]);
  for (const number of ordered) {
    assert.notEqual(canonicalizeAnswer("21121", comparisonByNumber[number]),
      canonicalizeAnswer("12121", comparisonByNumber[number]));
  }
  for (const number of unordered) {
    assert.equal(canonicalizeAnswer("312", comparisonByNumber[number]),
      canonicalizeAnswer("123", comparisonByNumber[number]));
  }
  assert.equal(canonicalizeAnswer("6531", comparisonByNumber[11]),
    canonicalizeAnswer("1356", comparisonByNumber[11]));
});

test("server scoring applies explicit set, exact, ordered and unordered modes", async () => {
  const answerKey = {
    gradablePoints: 5,
    answers: {
      checkbox: { type: "checkbox", comparison: "set", points: 1, acceptedAnswers: ["A", "B"] },
      radio: { type: "radio", comparison: "exact", points: 1, acceptedAnswers: ["A"] },
      select: { type: "select", comparison: "exact", points: 1, acceptedAnswers: ["B"] },
      ordered: { type: "text", comparison: "ordered", points: 1, acceptedAnswers: ["12121"] },
      unordered: { type: "text", comparison: "unordered", points: 1, acceptedAnswers: ["123"] },
    },
  };
  const scored = await scoreTest(staticPool(editableRow(answerKey)), "test-01", {
    checkbox: ["B", "A"], radio: ["A"], select: ["B"],
    ordered: ["21121"], unordered: ["3,2,1"],
  });
  assert.equal(scored.questionResults.checkbox.isCorrect, true);
  assert.equal(scored.questionResults.radio.isCorrect, true);
  assert.equal(scored.questionResults.select.isCorrect, true);
  assert.equal(scored.questionResults.ordered.isCorrect, false);
  assert.equal(scored.questionResults.unordered.isCorrect, true);
  assert.equal(scored.earnedPoints, 4);
  assert.equal(scored.percent, 80);
});

test("real baseline questions score selection unordered and matching ordered", async () => {
  const scored = await scoreTest(staticPool(), "test-01", {
    "test-01-q-011": ["1,2,3,1,1"],
    "test-01-q-017": ["5 4 2"],
  });
  assert.equal(scored.questionResults["test-01-q-011"].comparison, "ordered");
  assert.equal(scored.questionResults["test-01-q-011"].isCorrect, false);
  assert.equal(scored.questionResults["test-01-q-017"].comparison, "unordered");
  assert.equal(scored.questionResults["test-01-q-017"].isCorrect, true);
});

test("legacy editable answer keys without comparison hydrate from the explicit baseline", async () => {
  const baseline = answerKeys.tests["test-01"];
  const answerKey = {
    gradablePoints: 2,
    answers: {
      "test-01-q-011": {
        type: "text", points: 1,
        acceptedAnswers: [...baseline.answers["test-01-q-011"].acceptedAnswers],
      },
      "test-01-q-017": {
        type: "text", points: 1,
        acceptedAnswers: [...baseline.answers["test-01-q-017"].acceptedAnswers],
      },
    },
  };
  const scored = await scoreTest(staticPool(editableRow(answerKey)), "test-01", {
    "test-01-q-011": ["12311"],
    "test-01-q-017": ["542"],
  });
  assert.equal(scored.questionResults["test-01-q-011"].comparison, "ordered");
  assert.equal(scored.questionResults["test-01-q-011"].isCorrect, false);
  assert.equal(scored.questionResults["test-01-q-017"].comparison, "unordered");
  assert.equal(scored.questionResults["test-01-q-017"].isCorrect, true);
});

test("all private test data has explicit comparison metadata and matching canonical hashes", () => {
  const questions = new Map(definitions.tests.flatMap((entry) => entry.questions.map((question) => [question.id, question])));
  let count = 0;
  for (const entry of Object.values(answerKeys.tests)) {
    for (const [questionId, answer] of Object.entries(entry.answers)) {
      const question = questions.get(questionId);
      assert.ok(question, questionId);
      assert.ok(["exact", "ordered", "set", "unordered"].includes(answer.comparison), questionId);
      if (question.type === "checkbox") assert.equal(answer.comparison, "set", questionId);
      const matchingPrompt = /установите\s+соответствие|установить\s+соответствие|соотнесите/i
        .test(question.prompt || "");
      const numericAnswers = (answer.acceptedAnswers || []).every((value) => /^[\d\s,;.]+$/.test(String(value)));
      if (matchingPrompt) {
        assert.equal(answer.comparison, "ordered", questionId);
      }
      if (answer.comparison === "ordered") assert.equal(matchingPrompt, true, questionId);
      if (answer.comparison === "unordered") assert.equal(numericAnswers, true, questionId);
      const expectedHashes = [...new Set((answer.acceptedAnswers || []).map((value) => crypto
        .createHash("sha256")
        .update(canonicalizeAnswer(value, answer.comparison), "utf8")
        .digest("hex")))].sort();
      assert.deepEqual(answer.hashes, expectedHashes, questionId);
      count += 1;
    }
  }
  assert.equal(count, definitions.questionCount);
  assert.equal(answerKeys.schemaVersion, 2);
});

test("frontend work-on-errors uses the same per-question comparison mode", () => {
  const frontend = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
  assert.match(frontend, /function canonicalizeTestAnswer\(value, comparison = "exact"\)/);
  assert.match(frontend, /answerReview\.comparison \|\| question\?\.comparison/);
  assert.match(frontend, /comparison === "set"/);
});
