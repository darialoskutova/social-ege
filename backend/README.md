# Social EGE backend

Private API deployed in small, reversible stages. It currently contains a
database-backed health check, the core schema and disabled authentication
primitives. Student data and server-side test scoring remain later stages.

## Configuration

The production file is `/opt/social-ege/backend/.env`. It must never be copied
to Git or printed in logs. Keep it owned by `daria` with mode `0600`.

`.env.example` documents variable names only:

- `HOST` must remain `127.0.0.1`; the process refuses any other value;
- `PORT` defaults to `3000`;
- the backend accepts either `DATABASE_URL` or the existing split variables
  `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`;
- `DATABASE_SSL=false` is appropriate for the existing localhost connection.

## Install and run

```sh
npm ci --omit=dev
npm start
```

Direct health check:

```sh
curl --fail-with-body http://127.0.0.1:3000/health
```

Expected response:

```json
{"ok":true}
```

The health endpoint executes `SELECT 1`, so HTTP 200 confirms both the Express
process and the configured PostgreSQL connection. It returns HTTP 503 without
database error details when PostgreSQL is unavailable.

## Schema migrations

```sh
npm run migrate
npm run schema:status
```

Migrations are immutable numbered SQL files. The runner serializes execution
with a PostgreSQL advisory lock and stores a SHA-256 checksum for every applied
file. If an applied migration is edited later, startup stops instead of
silently changing history.

The initial schema contains users and roles, consent records, server sessions,
topic progress, test drafts and attempts, homework metadata, teacher messages
and an audit log. Homework file bytes and test answer keys are deliberately not
stored in the public repository.

## Authentication boundary

The backend contains password and session primitives, but production keeps
them disabled with `AUTH_ENABLED=false` until HTTPS and the final public origin
are configured. `GET /api/auth/status` reports this state without exposing any
configuration values.

When enabled later, authentication requires:

- Argon2id password hashes;
- opaque random sessions stored as SHA-256 token hashes in PostgreSQL;
- `HttpOnly`, `Secure`, `SameSite=Strict` cookies;
- exact HTTPS origins for state-changing requests;
- rate limiting and generic login errors.

The interactive account command never accepts a password in command-line
arguments:

```sh
npm run create-user -- --login LOGIN --name "Имя" --role student
```

Do not create production accounts before HTTPS is active and the legal consent
flow is connected to the frontend.

## Current boundary

The schema alone does not expose login, progress, homework or scoring API
routes. In particular, `data/tests-score-hashes.js` remains an identified
security issue and must later be replaced by server-side scoring without
shipping answer keys to browsers.
