"use strict";

const express = require("express");
const { z } = require("zod");
const { createOneTimeToken } = require("../auth/account-tokens");
const {
  requireAllowedOrigin,
  requireAuth,
  requireRole,
  requireSecureTransport,
} = require("../auth/middleware");
const { asyncHandler } = require("../lib/async-handler");
const { HttpError } = require("../lib/http-error");
const { withTransaction } = require("../lib/transaction");

const loginSchema = z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/)
  .transform((value) => value.normalize("NFKC").toLowerCase());
const namePartSchema = z.string().trim().min(1).max(60)
  .transform((value) => value.normalize("NFKC"));
const optionalMiddleNameSchema = z.preprocess(
  (value) => value === undefined || (typeof value === "string" && value.trim() === "") ? null : value,
  namePartSchema.nullable(),
);
const createStudentSchema = z.object({
  login: loginSchema,
  firstName: namePartSchema,
  lastName: namePartSchema,
  middleName: optionalMiddleNameSchema,
}).strict().refine((value) => displayName(value).length <= 120);
const updateStudentSchema = z.object({
  login: loginSchema.optional(),
  firstName: namePartSchema.optional(),
  lastName: namePartSchema.optional(),
  middleName: optionalMiddleNameSchema.optional(),
})
  .strict()
  .refine((value) => value.login !== undefined || hasIdentity(value))
  .refine((value) => !hasIdentity(value) || (value.firstName && value.lastName))
  .refine((value) => !hasIdentity(value) || displayName(value).length <= 120);
const studentIdSchema = z.string().regex(/^[1-9]\d{0,18}$/);

function hasIdentity(value) {
  return value.firstName !== undefined
    || value.lastName !== undefined
    || value.middleName !== undefined;
}

function displayName(value) {
  return [value.lastName, value.firstName, value.middleName].filter(Boolean).join(" ");
}

const studentColumns = `id, login, display_name, first_name, last_name, middle_name,
  account_status, created_at,
  last_login_at, activated_at, disabled_at, archived_at`;

function publicStudent(row) {
  const student = {
    id: String(row.id),
    login: row.login,
    name: row.display_name,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    middleName: row.middle_name ?? null,
    status: row.account_status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    activatedAt: row.activated_at,
    disabledAt: row.disabled_at,
    archivedAt: row.archived_at,
  };
  if (Object.hasOwn(row, "activation_link_status")) {
    student.activationExpiresAt = row.activation_expires_at ?? null;
    student.activationLinkStatus = row.activation_link_status;
  }
  return student;
}

function studentId(value) {
  const parsed = studentIdSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(404, "student_not_found", "Ученик не найден");
  return parsed.data;
}

function inputError() {
  return new HttpError(400, "invalid_student", "Проверьте ФИО и логин");
}

function duplicateLogin(error) {
  if (error?.code === "23505") {
    return new HttpError(409, "login_exists", "Такой логин уже используется");
  }
  return error;
}

function linkFor(config, path, rawToken) {
  if (!config.publicOrigin) {
    throw new HttpError(503, "public_origin_missing", "Ссылку не удалось создать");
  }
  return `${config.publicOrigin}${path}#token=${encodeURIComponent(rawToken)}`;
}

async function audit(client, actorId, action, targetId, metadata = {}) {
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'user', $3, $4::jsonb)`,
    [actorId, action, String(targetId), JSON.stringify(metadata)],
  );
}

function createAdminRouter(pool, config) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!config.enabled) {
      next(new HttpError(503, "auth_unavailable", "Вход временно недоступен"));
      return;
    }
    next();
  });
  router.use(requireSecureTransport(config));
  router.use(requireAllowedOrigin(config));
  router.use(requireAuth(pool, config));
  router.use(requireRole("admin"));

  router.get("/access", (req, res) => {
    res.set("Cache-Control", "no-store").json({ user: req.auth.user });
  });

  router.get(
    "/students",
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT u.id, u.login, u.display_name, u.first_name, u.last_name, u.middle_name,
                u.account_status, u.created_at,
                u.last_login_at, u.activated_at, u.disabled_at, u.archived_at,
                activation.expires_at AS activation_expires_at,
                CASE
                  WHEN activation.id IS NULL THEN 'none'
                  WHEN activation.used_at IS NOT NULL THEN 'used'
                  WHEN activation.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN activation.expires_at <= NOW() THEN 'expired'
                  ELSE 'valid'
                END AS activation_link_status
           FROM users AS u
           LEFT JOIN LATERAL (
             SELECT id, expires_at, used_at, revoked_at
               FROM account_tokens
              WHERE user_id = u.id AND purpose = 'activation'
              ORDER BY created_at DESC, id DESC
              LIMIT 1
           ) AS activation ON TRUE
          WHERE u.role = 'student'
          ORDER BY u.archived_at NULLS FIRST, u.created_at DESC, u.id DESC`,
      );
      res.set("Cache-Control", "no-store").json({ students: rows.map(publicStudent) });
    }),
  );

  router.post(
    "/students",
    asyncHandler(async (req, res) => {
      const parsed = createStudentSchema.safeParse(req.body);
      if (!parsed.success) throw inputError();
      let result;
      try {
        result = await withTransaction(pool, async (client) => {
          const inserted = await client.query(
            `INSERT INTO users
               (login, first_name, last_name, middle_name, display_name,
                password_hash, role, is_active,
                password_changed_at, account_status)
             VALUES ($1, $2, $3, $4, $5, NULL, 'student', FALSE, NULL, 'pending_activation')
             RETURNING ${studentColumns}`,
            [
              parsed.data.login,
              parsed.data.firstName,
              parsed.data.lastName,
              parsed.data.middleName,
              displayName(parsed.data),
            ],
          );
          const row = inserted.rows[0];
          const token = await createOneTimeToken(client, {
            userId: row.id,
            purpose: "activation",
            createdBy: req.auth.user.id,
            ttlHours: config.accountTokenTtlHours,
          });
          await audit(client, req.auth.user.id, "student.created", row.id, { login: row.login });
          return {
            student: publicStudent({
              ...row,
              activation_expires_at: token.expiresAt,
              activation_link_status: "valid",
            }),
            activationUrl: linkFor(config, "/activate/", token.rawToken),
            expiresAt: token.expiresAt,
          };
        });
      } catch (error) {
        throw duplicateLogin(error);
      }
      res.set("Cache-Control", "no-store").status(201).json(result);
    }),
  );

  router.patch(
    "/students/:studentId",
    asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const parsed = updateStudentSchema.safeParse(req.body);
      if (!parsed.success) throw inputError();
      const identityChanged = hasIdentity(parsed.data);
      let result;
      try {
        result = await pool.query(
          `UPDATE users
              SET login = COALESCE($1, login),
                  first_name = CASE WHEN $2 THEN $3 ELSE first_name END,
                  last_name = CASE WHEN $2 THEN $4 ELSE last_name END,
                  middle_name = CASE WHEN $2 THEN $5 ELSE middle_name END,
                  display_name = CASE WHEN $2 THEN $6 ELSE display_name END,
                  updated_at = NOW()
            WHERE id = $7 AND role = 'student' AND account_status <> 'archived'
            RETURNING ${studentColumns}`,
          [
            parsed.data.login ?? null,
            identityChanged,
            parsed.data.firstName ?? null,
            parsed.data.lastName ?? null,
            parsed.data.middleName ?? null,
            identityChanged ? displayName(parsed.data) : null,
            id,
          ],
        );
      } catch (error) {
        throw duplicateLogin(error);
      }
      if (!result.rows[0]) throw new HttpError(404, "student_not_found", "Ученик не найден");
      await audit(pool, req.auth.user.id, "student.updated", id, {
        fields: Object.keys(parsed.data),
      });
      res.set("Cache-Control", "no-store").json({ student: publicStudent(result.rows[0]) });
    }),
  );

  router.post("/students/:studentId/block", statusAction("blocked"));
  router.post("/students/:studentId/unblock", statusAction("unblock"));
  router.post("/students/:studentId/archive", statusAction("archived"));

  router.post("/students/:studentId/activation-link", linkAction("activation"));
  router.post("/students/:studentId/password-reset-link", linkAction("password_reset"));

  function statusAction(action) {
    return asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const student = await withTransaction(pool, async (client) => {
        const selected = await client.query(
          `SELECT id, password_hash, account_status
             FROM users
            WHERE id = $1 AND role = 'student'
            LIMIT 1 FOR UPDATE`,
          [id],
        );
        const current = selected.rows[0];
        if (!current || current.account_status === "archived") {
          throw new HttpError(404, "student_not_found", "Ученик не найден");
        }
        const nextStatus = action === "unblock"
          ? (current.password_hash ? "active" : "pending_activation")
          : action;
        const updated = await client.query(
          `UPDATE users
              SET account_status = $1,
                  is_active = ($1 = 'active'),
                  disabled_at = CASE WHEN $1 IN ('blocked', 'archived') THEN NOW() ELSE NULL END,
                  archived_at = CASE WHEN $1 = 'archived' THEN NOW() ELSE archived_at END,
                  updated_at = NOW()
            WHERE id = $2
            RETURNING ${studentColumns}`,
          [nextStatus, id],
        );
        if (nextStatus !== "active") {
          await client.query(
            `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW())
              WHERE user_id = $1 AND revoked_at IS NULL`,
            [id],
          );
          await client.query(
            `UPDATE account_tokens SET revoked_at = COALESCE(revoked_at, NOW())
              WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
            [id],
          );
        }
        await audit(client, req.auth.user.id, `student.${action}`, id, { status: nextStatus });
        return publicStudent({
          ...updated.rows[0],
          ...(nextStatus === "pending_activation"
            ? { activation_expires_at: null, activation_link_status: "revoked" }
            : {}),
        });
      });
      res.set("Cache-Control", "no-store").json({ student });
    });
  }

  function linkAction(purpose) {
    return asyncHandler(async (req, res) => {
      const id = studentId(req.params.studentId);
      const result = await withTransaction(pool, async (client) => {
        const selected = await client.query(
          `SELECT id, login, account_status
             FROM users
            WHERE id = $1 AND role = 'student'
            LIMIT 1 FOR UPDATE`,
          [id],
        );
        const row = selected.rows[0];
        const requiredStatus = purpose === "activation" ? "pending_activation" : "active";
        if (!row || row.account_status !== requiredStatus) {
          throw new HttpError(409, "invalid_student_status", "Это действие недоступно для текущего статуса");
        }
        const token = await createOneTimeToken(client, {
          userId: row.id,
          purpose,
          createdBy: req.auth.user.id,
          ttlHours: config.accountTokenTtlHours,
        });
        await audit(client, req.auth.user.id, `student.${purpose}_link_created`, id, {
          expiresAt: token.expiresAt.toISOString(),
        });
        return {
          url: linkFor(
            config,
            purpose === "activation" ? "/activate/" : "/reset-password/",
            token.rawToken,
          ),
          expiresAt: token.expiresAt,
        };
      });
      res.set("Cache-Control", "no-store").json(result);
    });
  }

  return router;
}

module.exports = { createAdminRouter };
