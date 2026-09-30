"use strict";

const { asyncHandler } = require("../lib/async-handler");
const { HttpError } = require("../lib/http-error");
const { findSession } = require("./sessions");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function requireAllowedOrigin(config) {
  return function allowedOrigin(req, res, next) {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.get("origin");
    if (!origin || !config.allowedOrigins.has(origin)) {
      next(new HttpError(403, "invalid_origin", "Запрос отклонён"));
      return;
    }
    next();
  };
}

function requireSecureTransport(config) {
  return function secureTransport(req, res, next) {
    if (config.isProduction && !req.secure) {
      next(new HttpError(426, "https_required", "Требуется защищённое соединение"));
      return;
    }
    next();
  };
}

function requireAuth(pool, config) {
  return asyncHandler(async (req, res, next) => {
    const token = req.cookies?.[config.cookieName];
    const user = await findSession(pool, token);
    if (!user) {
      throw new HttpError(401, "unauthenticated", "Требуется вход");
    }

    req.auth = {
      sessionToken: token,
      user: {
        id: String(user.id),
        login: user.login,
        name: user.display_name,
        role: user.role,
      },
    };
    next();
  });
}

function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.auth || !roles.includes(req.auth.user.role)) {
      next(new HttpError(403, "forbidden", "Недостаточно прав"));
      return;
    }
    next();
  };
}

module.exports = {
  requireAllowedOrigin,
  requireAuth,
  requireRole,
  requireSecureTransport,
};
