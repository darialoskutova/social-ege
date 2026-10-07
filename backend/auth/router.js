"use strict";

const crypto = require("node:crypto");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const { asyncHandler } = require("../lib/async-handler");
const { HttpError } = require("../lib/http-error");
const { hashPassword, verifyPassword } = require("./passwords");
const {
  requireAllowedOrigin,
  requireAuth,
  requireSecureTransport,
} = require("./middleware");
const {
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
} = require("./sessions");

const loginSchema = z.object({
  login: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(8).max(256),
  remember: z.boolean().optional().default(false),
}).strict();

let dummyHashPromise;

function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(crypto.randomBytes(32).toString("hex"));
  }
  return dummyHashPromise;
}

function publicUser(user) {
  return {
    id: String(user.id),
    login: user.login,
    name: user.display_name ?? user.name,
    role: user.role,
  };
}

function createAuthRouter(pool, config) {
  const router = express.Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      error: {
        code: "too_many_attempts",
        message: "Слишком много попыток. Попробуйте позже",
      },
    },
  });

  router.get("/status", (req, res) => {
    res.set("Cache-Control", "no-store").json({
      enabled: config.enabled,
      httpsRequired: config.isProduction,
    });
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

  router.post(
    "/login",
    loginLimiter,
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(401, "invalid_credentials", "Неверный логин или пароль");
      }

      const login = parsed.data.login.normalize("NFKC").toLowerCase();
      const { rows } = await pool.query(
        `SELECT id, login, display_name, password_hash, role, is_active, account_status
           FROM users
          WHERE login = $1
          LIMIT 1`,
        [login],
      );
      const user = rows[0];
      const canLogin = user?.is_active
        && user?.account_status === "active"
        && typeof user?.password_hash === "string";
      const passwordHash = canLogin ? user.password_hash : await getDummyHash();
      const passwordIsValid = await verifyPassword(passwordHash, parsed.data.password);

      if (!user || !canLogin || !passwordIsValid) {
        throw new HttpError(401, "invalid_credentials", "Неверный логин или пароль");
      }

      const session = await createSession(pool, config, user.id, parsed.data.remember);
      await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
      setSessionCookie(res, config, session);
      res.set("Cache-Control", "no-store").status(200).json({ user: publicUser(user) });
    }),
  );

  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      const token = req.cookies?.[config.cookieName];
      await revokeSession(pool, token);
      clearSessionCookie(res, config);
      res.status(204).end();
    }),
  );

  router.get("/me", requireAuth(pool, config), (req, res) => {
    res.set("Cache-Control", "no-store").status(200).json({ user: req.auth.user });
  });

  return router;
}

module.exports = { createAuthRouter };
