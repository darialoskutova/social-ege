"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../../account-flow.js"), "utf8");

test("activation token remains in the URL fragment until a successful submission", () => {
  const submitIndex = source.indexOf('await request("", { token, password });');
  const clearExpression = "window.history.replaceState({}, document.title, window.location.pathname);";
  const clearIndex = source.indexOf(clearExpression);

  assert.ok(submitIndex > 0);
  assert.ok(clearIndex > submitIndex);
  assert.equal(source.slice(0, submitIndex).includes(clearExpression), false);
  assert.match(source, /#token=\$\{encodeURIComponent\(token\)\}/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
