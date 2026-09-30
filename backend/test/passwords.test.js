"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword } = require("../auth/passwords");

test("Argon2id password hashes verify only the original password", async () => {
  const password = "correct horse battery staple";
  const passwordHash = await hashPassword(password);

  assert.notEqual(passwordHash, password);
  assert.match(passwordHash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(passwordHash, password), true);
  assert.equal(await verifyPassword(passwordHash, "wrong password"), false);
});
