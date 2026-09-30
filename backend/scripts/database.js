"use strict";

const path = require("node:path");
const { Pool } = require("pg");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true,
});

function firstConfigured(...names) {
  for (const name of names) {
    if (process.env[name] !== undefined && process.env[name] !== "") {
      return process.env[name];
    }
  }
  return undefined;
}

function createPool() {
  const databaseUrl = process.env.DATABASE_URL;
  const databaseSsl = process.env.DATABASE_SSL === "true";
  const port = Number(firstConfigured("DB_PORT", "PGPORT", "POSTGRES_PORT") || 5432);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Database port must be an integer between 1 and 65535");
  }

  const connection = databaseUrl
    ? { connectionString: databaseUrl }
    : {
        host: firstConfigured("DB_HOST", "PGHOST", "POSTGRES_HOST") || "127.0.0.1",
        port,
        database: firstConfigured("DB_NAME", "DB_DATABASE", "PGDATABASE", "POSTGRES_DB") || "social_ege",
        user: firstConfigured("DB_USER", "DB_USERNAME", "PGUSER", "POSTGRES_USER") || "social_ege_app",
        password: firstConfigured("DB_PASSWORD", "PGPASSWORD", "POSTGRES_PASSWORD"),
      };

  if (!databaseUrl && !connection.password) {
    throw new Error("Database configuration is incomplete");
  }

  return new Pool({
    ...connection,
    ssl: databaseSsl ? { rejectUnauthorized: true } : false,
    application_name: "social-ege-migrations",
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  });
}

module.exports = { createPool };
