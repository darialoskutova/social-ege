"use strict";

const { createPool } = require("./database");

const expectedTables = [
  "audit_log",
  "auth_sessions",
  "account_tokens",
  "homework_submissions",
  "schema_migrations",
  "teacher_messages",
  "test_attempts",
  "test_drafts",
  "user_consents",
  "user_progress",
  "users",
];

async function run() {
  const pool = createPool();
  try {
    const { rows } = await pool.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::TEXT[])
        ORDER BY table_name`,
      [expectedTables],
    );
    const found = rows.map((row) => row.table_name);
    const missing = expectedTables.filter((name) => !found.includes(name));

    console.log(`schema tables: ${found.join(", ")}`);
    if (missing.length > 0) {
      throw new Error(`Missing schema tables: ${missing.join(", ")}`);
    }

    const migrations = await pool.query(
      "SELECT name, applied_at FROM schema_migrations ORDER BY name",
    );
    for (const migration of migrations.rows) {
      console.log(`migration: ${migration.name} applied`);
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Schema status failed", { name: error.name, code: error.code, message: error.message });
  process.exitCode = 1;
});
