"use strict";

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { Pool } = require("pg");

require("dotenv").config({
  path: path.resolve(__dirname, ".env"),
  quiet: true,
});

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const databaseSsl = process.env.DATABASE_SSL === "true";

if (host !== "127.0.0.1") {
  throw new Error("Backend must listen on 127.0.0.1");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: databaseUrl,
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

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.set("Cache-Control", "no-store").status(200).json({ ok: true });
  } catch (error) {
    console.error("Health check failed", { name: error.name, code: error.code });
    res.set("Cache-Control", "no-store").status(503).json({ ok: false });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Ресурс не найден" } });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
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
