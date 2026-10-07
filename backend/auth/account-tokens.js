"use strict";

const crypto = require("node:crypto");

function hashAccountToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function generateAccountToken() {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashAccountToken(rawToken) };
}

async function revokeActiveTokens(client, userId, purpose) {
  await client.query(
    `UPDATE account_tokens
        SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE user_id = $1
        AND purpose = $2
        AND used_at IS NULL
        AND revoked_at IS NULL`,
    [userId, purpose],
  );
}

async function createOneTimeToken(client, { userId, purpose, createdBy, ttlHours }) {
  await revokeActiveTokens(client, userId, purpose);
  const { rawToken, tokenHash } = generateAccountToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await client.query(
    `INSERT INTO account_tokens (user_id, token_hash, purpose, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, purpose, expiresAt, createdBy],
  );
  return { rawToken, expiresAt };
}

module.exports = {
  createOneTimeToken,
  generateAccountToken,
  hashAccountToken,
  revokeActiveTokens,
};
