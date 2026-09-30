"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createPool } = require("./database");

const migrationsDirectory = path.resolve(__dirname, "../migrations");
const lockName = "social-ege-schema-migrations";

function checksum(sql) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

async function run() {
  const pool = createPool();
  let client;

  try {
    client = await pool.connect();
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const names = (await fs.readdir(migrationsDirectory))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
      .sort();

    for (const name of names) {
      const sql = await fs.readFile(path.join(migrationsDirectory, name), "utf8");
      const sqlChecksum = checksum(sql);
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE name = $1",
        [name],
      );

      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== sqlChecksum) {
          throw new Error(`Applied migration was modified: ${name}`);
        }
        console.log(`already applied: ${name}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [name, sqlChecksum],
        );
        await client.query("COMMIT");
        console.log(`applied: ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      if (client) {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
      }
    } finally {
      if (client) {
        client.release();
      }
      await pool.end();
    }
  }
}

run().catch((error) => {
  console.error("Migration failed", { name: error.name, code: error.code, message: error.message });
  process.exitCode = 1;
});
