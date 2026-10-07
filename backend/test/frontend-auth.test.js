"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontend = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");

test("login form sends credentials to the backend instead of accepting frontend-only identity", () => {
  assert.match(frontend, /id="studentPassword"[^>]+type="password"/);
  assert.match(frontend, /fetch\("\/api\/auth\/login"/);
  assert.match(frontend, /if \(response\.status === 401\)/);
  assert.match(frontend, /Неверный логин или пароль/);
  assert.doesNotMatch(frontend, /setUser\(\{ name, login \}, remember\)/);
  assert.doesNotMatch(frontend, /localStorage\.setItem\(storage\.user/);
  assert.doesNotMatch(frontend, /sessionStorage\.setItem\(storage\.user/);
});

test("cabinet view checks the server session and cannot open without an authenticated user", () => {
  assert.match(frontend, /fetch\("\/api\/auth\/me"/);
  assert.match(frontend, /id === "appView" && !authenticatedUser \? "loginView" : id/);
  assert.match(frontend, /if \(!user\) \{\s+clearUser\(\);\s+return;/);
  assert.match(frontend, /await loadLearningData\(\)/);
  assert.match(frontend, /learningRequest\("\/progress"\)/);
  assert.match(frontend, /learningRequest\("\/test-attempts"\)/);
  assert.match(frontend, /learningRequest\("\/homework-submissions"\)/);
});

test("B/C/E: startup waits for the server session and restores the cabinet without a landing flash", () => {
  assert.match(frontend, /document\.documentElement\.classList\.add\("auth-checking"\)/);
  assert.match(frontend, /async function initializeApplication\(\)[\s\S]+await requestCurrentSession\(\)[\s\S]+await loadLearningData\(\)[\s\S]+showView\("appView"\)[\s\S]+restoreCabinetSection\(\)/);
  assert.match(frontend, /finally \{\s+document\.documentElement\.classList\.remove\("auth-checking"\)/);
  assert.match(frontend, /html\.auth-checking \.view[\s\S]+display: none !important/);
  const sessionFunction = frontend.match(/async function requestCurrentSession\(\) \{[\s\S]*?\n        \}/)?.[0] || "";
  assert.match(sessionFunction, /normalizeAuthenticatedUser\(await response\.json\(\)\)/);
  assert.doesNotMatch(sessionFunction, /const user = await requestCurrentSession\(\)/);
});

test("learning records use protected APIs instead of browser storage", () => {
  assert.match(frontend, /learningRequest\("\/test-attempts", \{/);
  assert.match(frontend, /learningRequest\("\/homework-submissions", \{/);
  assert.match(frontend, /learningRequest\(`\/test-drafts\/\$\{encodeURIComponent\(testId\)\}`/);
  assert.doesNotMatch(frontend, /readUserJson\(storage\.(?:works|testAttempts|testDrafts|messages)/);
  assert.doesNotMatch(frontend, /writeUserJson\(storage\.(?:works|testAttempts|testDrafts|messages)/);
});

test("logout is performed by the backend before the local cabinet is closed", () => {
  assert.match(frontend, /fetch\("\/api\/auth\/logout"/);
  assert.match(frontend, /if \(!response\.ok\) throw new Error\("auth_logout_unavailable"\)/);
  assert.match(frontend, /clearUser\(\);[\s\S]+showView\("loginView"\)/);
  assert.match(frontend, /replaceUiHash\("#login"\)/);
});

test("H-O: a completed attempt is restored from backend data and retry is explicit", () => {
  assert.match(frontend, /frontendState\.selectTestState\(test\.id, learningState\.testDrafts, learningState\.testAttempts\)/);
  assert.match(frontend, /restoreCompletedTest\(test, form, testState\.attempt\)/);
  assert.match(frontend, /frontendState\.buildCompletedAttemptResult\(test, attempt, testScoreData\)/);
  assert.match(frontend, /form\.querySelector\('button\[type="submit"\]'\)\.textContent = "Пройти ещё раз"/);
  assert.match(frontend, /if \(event\.currentTarget\.dataset\.reviewed === "true"\)[\s\S]+clearTestReview\(event\.currentTarget\)[\s\S]+return;/);
});
