"use strict";

const { z } = require("zod");
const {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordMeetsPolicy,
} = require("../auth/password-policy");
const { hashPassword } = require("../auth/passwords");
const { createPool } = require("./database");

const argumentsSchema = z.object({
  login: z.string().min(3).max(64).regex(/^[a-z0-9._-]+$/),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["student", "teacher", "admin"]),
});

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Use: --login LOGIN --name NAME --role student|teacher|admin");
    }
    result[key.slice(2)] = value;
  }
  if (result.login) {
    result.login = result.login.normalize("NFKC").toLowerCase();
  }
  return argumentsSchema.parse(result);
}

function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("An interactive terminal is required for password input");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function finish(error) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }

    function onData(character) {
      if (character === "\u0003") {
        finish(new Error("Cancelled"));
      } else if (character === "\r" || character === "\n") {
        finish();
      } else if (character === "\u007f") {
        value = value.slice(0, -1);
      } else if (!/[\u0000-\u001f]/.test(character)) {
        value += character;
      }
    }

    process.stdin.on("data", onData);
  });
}

async function run() {
  const user = parseArguments(process.argv.slice(2));
  const password = await readHidden("Password: ");
  const confirmation = await readHidden("Repeat password: ");

  if (password !== confirmation) {
    throw new Error("Passwords do not match");
  }
  if (!passwordMeetsPolicy(password)) {
    throw new Error(`Password must contain ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`);
  }

  const passwordHash = await hashPassword(password);
  const pool = createPool();

  try {
    await pool.query(
      `INSERT INTO users
         (login, display_name, password_hash, role, account_status, activated_at)
       VALUES ($1, $2, $3, $4, 'active', NOW())`,
      [user.login, user.name.normalize("NFKC"), passwordHash, user.role],
    );
    console.log(`Created ${user.role} account: ${user.login}`);
  } catch (error) {
    if (error.code === "23505") {
      throw new Error("A user with this login already exists");
    }
    throw error;
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
