"use strict";

const path = require("node:path");
const cookieParser = require("cookie-parser");
const express = require("express");
const helmet = require("helmet");
const { Pool } = require("pg");
const { createAdminRouter } = require("./admin/router");
const { createAccountRouter } = require("./auth/account-router");
const { readAuthConfig } = require("./auth/config");
const { createAuthRouter } = require("./auth/router");
const { createLearningRouter } = require("./learning/router");
const { readUploadConfig } = require("./learning/file-storage");
const { HttpError } = require("./lib/http-error");

require("dotenv").config({
  path: path.resolve(__dirname, ".env"),
  quiet: true,
});

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const databaseSsl = process.env.DATABASE_SSL === "true";
const authConfig = readAuthConfig();
const uploadConfig = readUploadConfig();

function firstConfigured(...names) {
  for (const name of names) {
    if (process.env[name] !== undefined && process.env[name] !== "") {
      return process.env[name];
    }
  }
  return undefined;
}

if (host !== "127.0.0.1") {
  throw new Error("Backend must listen on 127.0.0.1");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
const databaseHost = firstConfigured("DB_HOST", "PGHOST", "POSTGRES_HOST") || "127.0.0.1";
const databasePort = Number(firstConfigured("DB_PORT", "PGPORT", "POSTGRES_PORT") || 5432);
const databaseName = firstConfigured("DB_NAME", "DB_DATABASE", "PGDATABASE", "POSTGRES_DB") || "social_ege";
const databaseUser = firstConfigured("DB_USER", "DB_USERNAME", "PGUSER", "POSTGRES_USER") || "social_ege_app";
const databasePassword = firstConfigured("DB_PASSWORD", "PGPASSWORD", "POSTGRES_PASSWORD");

if (!databaseUrl && !databasePassword) {
  throw new Error("Database configuration is incomplete");
}
if (!databaseUrl && (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535)) {
  throw new Error("Database port must be an integer between 1 and 65535");
}

const databaseConnection = databaseUrl
  ? { connectionString: databaseUrl }
  : {
      host: databaseHost,
      port: databasePort,
      database: databaseName,
      user: databaseUser,
      password: databasePassword,
    };

const pool = new Pool({
  ...databaseConnection,
  ssl: databaseSsl ? { rejectUnauthorized: true } : false,
  application_name: "social-ege-api",
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
});

pool.on("error", (error) => {
  console.error("Unexpected database connection error", {
    name: error.name,
    code: error.code,
  });
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(helmet());
app.use(express.json({ limit: "64kb", strict: true }));
app.use(cookieParser());

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.set("Cache-Control", "no-store").status(200).json({ ok: true });
  } catch (error) {
    console.error("Health check failed", { name: error.name, code: error.code });
    res.set("Cache-Control", "no-store").status(503).json({ ok: false });
  }
});

app.use("/api/auth", createAuthRouter(pool, authConfig));
app.use("/api/account", createAccountRouter(pool, authConfig));
app.use("/api/admin", createAdminRouter(pool, authConfig, uploadConfig));
app.use("/api/learning", createLearningRouter(pool, authConfig, uploadConfig));

app.use((req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Ресурс не найден" } });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({
      error: { code: "invalid_json", message: "Некорректный формат запроса" },
    });
    return;
  }
  console.error("Unhandled request error", {
    name: error?.name,
    code: error?.code,
    method: req.method,
    path: req.originalUrl,
  });
  res.status(500).json({
    error: { code: "internal_error", message: "Не удалось выполнить запрос" },
  });
});

const server = app.listen(port, host, () => {
  console.log(`social-ege backend listening on ${host}:${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  server.close(async (serverError) => {
    try {
      await pool.end();
    } catch (databaseError) {
      console.error("Database shutdown failed", { name: databaseError.name });
    }
    process.exitCode = serverError ? 1 : 0;
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
