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
const nameSchema = z.string().trim().min(2).max(120)
  .transform((value) => value.normalize("NFKC"));
const createStudentSchema = z.object({ login: loginSchema, name: nameSchema }).strict();
const updateStudentSchema = z.object({ login: loginSchema.optional(), name: nameSchema.optional() })
  .strict()
  .refine((value) => value.login !== undefined || value.name !== undefined);
const studentIdSchema = z.string().regex(/^[1-9]\d{0,18}$/);

const studentColumns = `id, login, display_name, account_status, created_at,
  last_login_at, activated_at, disabled_at, archived_at`;

function publicStudent(row) {
  return {
    id: String(row.id),
    login: row.login,
    name: row.display_name,
    status: row.account_status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    activatedAt: row.activated_at,
    disabledAt: row.disabled_at,
    archivedAt: row.archived_at,
  };
}

function studentId(value) {
  const parsed = studentIdSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(404, "student_not_found", "Ученик не найден");
  return parsed.data;
}

function inputError() {
  return new HttpError(400, "invalid_student", "Проверьте имя и логин");
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
        `SELECT ${studentColumns}
           FROM users
          WHERE role = 'student'
          ORDER BY archived_at NULLS FIRST, created_at DESC, id DESC`,
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
               (login, display_name, password_hash, role, is_active,
                password_changed_at, account_status)
             VALUES ($1, $2, NULL, 'student', FALSE, NULL, 'pending_activation')
             RETURNING ${studentColumns}`,
            [parsed.data.login, parsed.data.name],
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
            student: publicStudent(row),
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
      let result;
      try {
        result = await pool.query(
          `UPDATE users
              SET login = COALESCE($1, login),
                  display_name = COALESCE($2, display_name),
                  updated_at = NOW()
            WHERE id = $3 AND role = 'student' AND account_status <> 'archived'
            RETURNING ${studentColumns}`,
          [parsed.data.login ?? null, parsed.data.name ?? null, id],
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
        return publicStudent(updated.rows[0]);
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
