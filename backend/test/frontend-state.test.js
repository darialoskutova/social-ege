"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../../frontend-state");

test("A-D: startup destination follows only the server session", () => {
  assert.equal(state.startupViewFor(null, ""), "public");
  assert.equal(state.startupViewFor(null, "#login"), "login");
  assert.equal(state.startupViewFor(null, "#cabinet/lesson/soc1/test"), "login");
  assert.equal(state.startupViewFor({ id: "1" }, ""), "cabinet");
  assert.equal(state.startupViewFor({ id: "1" }, "#cabinet/works"), "cabinet");
});

test("cabinet route keeps a non-personal section, topic and lesson panel", () => {
  const route = state.routeFromHash("#cabinet/lesson/soc2/test");
  assert.deepEqual(route, { page: "lesson", topicId: "soc2", panel: "test" });
  assert.equal(state.hashForRoute(route), "#cabinet/lesson/soc2/test");
  assert.deepEqual(state.routeFromHash("#cabinet/subjects/law"), { page: "subjects", subject: "law" });
});

test("F/G: a server draft takes priority and retains selected answers", () => {
  const draft = { testId: "test-01", values: { q1: ["2"], q2: ["Ответ"] }, answeredCount: 2 };
  const selected = state.selectTestState("test-01", { "test-01": draft }, [{ testId: "test-01", id: "8" }]);
  assert.equal(selected.kind, "draft");
  assert.deepEqual(selected.draft.values, draft.values);
});

test("H-N: the latest completed attempt is restored without creating a new one", () => {
  const attempts = [
    { id: "1", testId: "test-01", createdAt: "2026-09-01T10:00:00Z" },
    { id: "2", testId: "test-01", createdAt: "2026-10-01T10:00:00Z", scorePoints: 8 },
    { id: "3", testId: "test-02", createdAt: "2026-10-02T10:00:00Z" },
  ];
  const selected = state.selectTestState("test-01", {}, attempts);
  assert.equal(selected.kind, "completed");
  assert.equal(selected.attempt.id, "2");
  assert.equal(selected.history.length, 2);
  assert.equal(attempts.length, 3);
});

test("I-K: completed review restores answers, errors and score", () => {
  const testDefinition = { id: "test-01", totalPoints: 2 };
  const attempt = {
    testId: "test-01",
    scorePoints: 1,
    scoreTotal: 2,
    scorePercent: 50,
    submittedAnswers: { q1: ["A"], q2: ["ошибка"] },
    incorrectQuestionIds: ["q2"],
  };
  const scoreData = { tests: { "test-01": { answers: {
    q1: { points: 1, acceptedAnswers: ["A"] },
    q2: { points: 1, acceptedAnswers: ["B"] },
  } } } };
  const restored = state.buildCompletedAttemptResult(testDefinition, attempt, scoreData);
  assert.equal(restored.hasReviewData, true);
  assert.equal(restored.result.earnedPoints, 1);
  assert.equal(restored.result.totalPoints, 2);
  assert.equal(restored.result.percent, 50);
  assert.deepEqual(restored.result.questionResults.q1.submittedAnswers, ["A"]);
  assert.equal(restored.result.questionResults.q1.isCorrect, true);
  assert.equal(restored.result.questionResults.q2.isCorrect, false);
});

test("old completed attempts without answer details degrade safely", () => {
  const restored = state.buildCompletedAttemptResult(
    { id: "test-01", totalPoints: 10 },
    { testId: "test-01", scorePoints: 7, scoreTotal: 10, scorePercent: 70, submittedAnswers: {}, incorrectQuestionIds: [] },
    { tests: { "test-01": { answers: {} } } },
  );
  assert.equal(restored.hasReviewData, false);
  assert.equal(restored.result.earnedPoints, 7);
  assert.deepEqual(restored.result.questionResults, {});
});

test("O/P: retry intent does not mutate or remove previous attempt history", () => {
  const attempts = [
    { id: "10", testId: "test-03", createdAt: "2026-10-01T10:00:00Z" },
    { id: "11", testId: "test-03", createdAt: "2026-10-02T10:00:00Z" },
  ];
  const before = JSON.stringify(attempts);
  state.selectTestState("test-03", {}, attempts);
  assert.equal(JSON.stringify(attempts), before);
  assert.equal(attempts.length, 2);
});
