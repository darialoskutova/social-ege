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
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 24 * 7) {
    throw new Error("Account token TTL must be an integer between 1 and 168 hours");
  }
  await revokeActiveTokens(client, userId, purpose);
  const { rawToken, tokenHash } = generateAccountToken();
  const { rows } = await client.query(
    `INSERT INTO account_tokens (user_id, token_hash, purpose, expires_at, created_by)
     VALUES ($1, $2, $3, NOW() + ($4::INTEGER * INTERVAL '1 hour'), $5)
     RETURNING created_at, expires_at`,
    [userId, tokenHash, purpose, ttlHours, createdBy],
  );
  return {
    rawToken,
    createdAt: rows[0].created_at,
    expiresAt: rows[0].expires_at,
  };
}

module.exports = {
  createOneTimeToken,
  generateAccountToken,
  hashAccountToken,
  revokeActiveTokens,
};
