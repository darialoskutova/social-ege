"use strict";

const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const { asyncHandler } = require("../lib/async-handler");
const { HttpError } = require("../lib/http-error");
const { withTransaction } = require("../lib/transaction");
const { hashAccountToken, revokeActiveTokens } = require("./account-tokens");
const { requireAllowedOrigin, requireSecureTransport } = require("./middleware");
const { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } = require("./password-policy");
const { hashPassword } = require("./passwords");

const tokenSchema = z.string().min(32).max(256);
const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
const validateSchema = z.object({ token: tokenSchema }).strict();
const submitSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
}).strict();

function invalidLink(reason = "invalid") {
  const error = new HttpError(400, "invalid_account_link", "Ссылка недействительна или истекла");
  error.accountTokenReason = reason;
  return error;
}

function accountTokenState(row, purpose, requiredStatus) {
  if (!row) return "invalid";
  if (row.purpose !== purpose) return "wrong_purpose";
  if (row.account_status === "archived") return "account_archived";
  if (row.account_status === "blocked") return "account_blocked";
  if (row.used_at) return "used";
  if (row.revoked_at) return "revoked";
  if (!row.is_unexpired) return "expired";
  if (row.account_status !== requiredStatus) return "account_state_changed";
  return "valid";
}

async function inspectToken(client, rawToken, purpose, requiredStatus, lock = false) {
  const { rows } = await client.query(
    `SELECT t.id AS token_id, t.user_id, u.login, u.display_name,
            u.account_status, u.password_hash, t.purpose, t.expires_at,
            t.used_at, t.revoked_at, (t.expires_at > NOW()) AS is_unexpired
       FROM account_tokens AS t
       JOIN users AS u ON u.id = t.user_id
      WHERE t.token_hash = $1
      LIMIT 1${lock ? " FOR UPDATE OF t, u" : ""}`,
    [hashAccountToken(rawToken)],
  );
  const row = rows[0] ?? null;
  return { row, state: accountTokenState(row, purpose, requiredStatus) };
}

function publicAccount(row) {
  return { login: row.login, name: row.display_name };
}

function createAccountRouter(pool, config) {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "too_many_attempts", message: "Слишком много попыток. Попробуйте позже" } },
  });

  router.use((req, res, next) => {
    if (!config.enabled) {
      next(new HttpError(503, "auth_unavailable", "Вход временно недоступен"));
      return;
    }
    next();
  });
  router.use(requireSecureTransport(config));
  router.use(requireAllowedOrigin(config));
  router.use(limiter);

  for (const flow of [
    { path: "/activate", purpose: "activation", requiredStatus: "pending_activation" },
    { path: "/reset-password", purpose: "password_reset", requiredStatus: "active" },
  ]) {
    router.post(
      `${flow.path}/validate`,
      asyncHandler(async (req, res) => {
        const parsed = validateSchema.safeParse(req.body);
        if (!parsed.success) throw invalidLink();
        const inspected = await inspectToken(
          pool, parsed.data.token, flow.purpose, flow.requiredStatus,
        );
        if (inspected.state !== "valid") throw invalidLink(inspected.state);
        const { row } = inspected;
        res.set("Cache-Control", "no-store").json({ account: publicAccount(row) });
      }),
    );

    router.post(
      flow.path,
      asyncHandler(async (req, res) => {
        const parsed = submitSchema.safeParse(req.body);
        if (!parsed.success) {
          if (parsed.error.issues.some((issue) => issue.path[0] === "password")) {
            throw new HttpError(400, "invalid_password", "Пароль должен содержать от 12 до 256 символов");
          }
          throw invalidLink();
        }

        const preflight = await inspectToken(
          pool, parsed.data.token, flow.purpose, flow.requiredStatus,
        );
        if (preflight.state !== "valid") throw invalidLink(preflight.state);
        const passwordHash = await hashPassword(parsed.data.password);
        const account = await withTransaction(pool, async (client) => {
          const inspected = await inspectToken(
            client, parsed.data.token, flow.purpose, flow.requiredStatus, true,
          );
          if (inspected.state !== "valid") throw invalidLink(inspected.state);
          const { row } = inspected;

          if (flow.purpose === "activation") {
            await client.query(
              `UPDATE users
                  SET password_hash = $1,
                      password_changed_at = NOW(),
                      activated_at = COALESCE(activated_at, NOW()),
                      account_status = 'active',
                      is_active = TRUE,
                      disabled_at = NULL,
                      updated_at = NOW()
                WHERE id = $2`,
              [passwordHash, row.user_id],
            );
          } else {
            await client.query(
              `UPDATE users
                  SET password_hash = $1,
                      password_changed_at = NOW(),
                      updated_at = NOW()
                WHERE id = $2`,
              [passwordHash, row.user_id],
            );
            await client.query(
              `UPDATE auth_sessions
                  SET revoked_at = COALESCE(revoked_at, NOW())
                WHERE user_id = $1 AND revoked_at IS NULL`,
              [row.user_id],
            );
          }

          await client.query(
            "UPDATE account_tokens SET used_at = NOW() WHERE id = $1 AND used_at IS NULL",
            [row.token_id],
          );
          await revokeActiveTokens(client, row.user_id, flow.purpose);
          await client.query(
            `INSERT INTO audit_log (action, target_type, target_id, metadata)
             VALUES ($1, 'user', $2, $3::jsonb)`,
            [
              flow.purpose === "activation" ? "student.activated" : "student.password_reset",
              String(row.user_id),
              JSON.stringify({ login: row.login }),
            ],
          );
          return publicAccount(row);
        });

        res.set("Cache-Control", "no-store").json({ ok: true, account });
      }),
    );
  }

  return router;
}

module.exports = { accountTokenState, createAccountRouter };
