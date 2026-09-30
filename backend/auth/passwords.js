"use strict";

const argon2 = require("argon2");

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

async function hashPassword(password) {
  return argon2.hash(password, ARGON2_OPTIONS);
}

async function verifyPassword(passwordHash, password) {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
