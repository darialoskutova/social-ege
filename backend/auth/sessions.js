"use strict";

const crypto = require("node:crypto");

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function cookieOptions(config, expiresAt, persistent) {
  return {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: "strict",
    path: "/",
    ...(persistent ? { expires: expiresAt } : {}),
  };
}

async function createSession(pool, config, userId, persistent = false) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const ttlHours = persistent ? config.sessionTtlHours : Math.min(12, config.sessionTtlHours);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [tokenHash, userId, expiresAt],
  );

  return { token, expiresAt, persistent };
}

async function findSession(pool, token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) {
    return null;
  }

  const { rows } = await pool.query(
    `SELECT u.id, u.login, u.display_name, u.role
       FROM auth_sessions AS s
       JOIN users AS u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.is_active = TRUE
        AND u.account_status = 'active'
      LIMIT 1`,
    [hashToken(token)],
  );

  return rows[0] ?? null;
}

async function revokeSession(pool, token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) {
    return;
  }

  await pool.query(
    `UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE token_hash = $1`,
    [hashToken(token)],
  );
}

function setSessionCookie(res, config, session) {
  res.cookie(
    config.cookieName,
    session.token,
    cookieOptions(config, session.expiresAt, session.persistent),
  );
}

function clearSessionCookie(res, config) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: "strict",
    path: "/",
  });
}

module.exports = {
  clearSessionCookie,
  createSession,
  findSession,
  revokeSession,
  setSessionCookie,
};
