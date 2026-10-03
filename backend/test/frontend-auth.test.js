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
  assert.match(frontend, /readUserJson\(storage\.works, \[\]\)/);
  assert.match(frontend, /return scopedKey \? readJson\(scopedKey, fallback\) : fallback/);
});

test("logout is performed by the backend before the local cabinet is closed", () => {
  assert.match(frontend, /fetch\("\/api\/auth\/logout"/);
  assert.match(frontend, /if \(!response\.ok\) throw new Error\("auth_logout_unavailable"\)/);
  assert.match(frontend, /clearUser\(\);[\s\S]+showView\("loginView"\)/);
});
