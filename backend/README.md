# Social EGE backend

Private API deployed in small, reversible stages. It contains a database-backed
health check, server-side sessions and protected persistence for student
learning data. Server-side test scoring remains a later stage.

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
and an audit log. Migration `002_learning_data_persistence.sql` permits
unscored legacy attempts and metadata-only legacy homework records, and adds
per-user legacy IDs so a browser migration can be retried without duplicates.
It does not drop tables or data.

Migration `003_student_identity_management.sql` extends the existing `users`
table without creating a second identity store. It adds account lifecycle
fields, permits a null password hash only for accounts that have not been
activated, and creates `account_tokens` for activation and password-reset
links. Existing active users remain active; previously disabled users become
blocked. The migration does not delete users or learning records.

Homework file bytes are not uploaded in this stage. Only the filename, MIME
type, byte size and existing student comment are persisted. Test answer keys
are still not stored by these routes and must not be added to the public API.

## Authentication boundary

`GET /api/auth/status` reports whether authentication is enabled without
exposing configuration values. When enabled, the public auth routes are:

- `POST /api/auth/login`;
- `GET /api/auth/me`;
- `POST /api/auth/logout`.

When enabled, authentication requires:

- Argon2id password hashes;
- opaque random sessions stored as SHA-256 token hashes in PostgreSQL;
- `HttpOnly`, `Secure`, `SameSite=Strict` cookies;
- exact HTTPS origins for state-changing requests;
- rate limiting and generic login errors.

The frontend must treat `GET /api/auth/me` as the source of truth for the
current user. Passwords and session tokens must never be copied into browser
storage; the browser receives the session only as an HttpOnly cookie.

The interactive account command never accepts a password in command-line
arguments:

```sh
npm run create-user -- --login LOGIN --name "Имя" --role student
```

Run the command only on the server where the protected `.env` is available.

## Student identity management

Every `/api/admin/*` route requires a valid server session and `role=admin`.
The implemented routes are:

- `GET /api/admin/access`;
- `GET /api/admin/students`;
- `POST /api/admin/students`;
- `PATCH /api/admin/students/:studentId`;
- `POST /api/admin/students/:studentId/block`;
- `POST /api/admin/students/:studentId/unblock`;
- `POST /api/admin/students/:studentId/archive`;
- `POST /api/admin/students/:studentId/activation-link`;
- `POST /api/admin/students/:studentId/password-reset-link`.

The administrator supplies only a display name and unique login. A new
student has no password and remains in `pending_activation` until the student
chooses a password. Admin responses never include password hashes, session
tokens or stored token hashes.

Activation and password reset use the following unauthenticated, rate-limited
routes. Unsafe requests still require an exact allowed Origin and production
HTTPS:

- `POST /api/account/activate/validate`;
- `POST /api/account/activate`;
- `POST /api/account/reset-password/validate`;
- `POST /api/account/reset-password`.

Raw account tokens are generated with `crypto.randomBytes(32)`, returned only
inside the newly created link and never stored in PostgreSQL. The database
stores a SHA-256 token hash. Each token expires after 72 hours by default, is
single-use, and a replacement revokes older unused tokens of the same purpose.
Both `created_at` and `expires_at` are calculated by PostgreSQL; validation
uses the same database clock and `TIMESTAMPTZ`, without local timezone offsets
or a separate Node.js clock.
Generated browser links put the raw token after `#token=` so it is not sent in
the initial HTTP request or included in ordinary Nginx access logs. The page
submits it only inside the API request body. It keeps the fragment across a
reload or a browser-restored tab and removes it immediately after successful
activation or password reset. These pages load no analytics. The admin list
shows only the current activation-link status and expiry, never its raw token.

Password creation and reset share the same server-side 12–256 character
policy and existing Argon2id implementation. A successful password reset also
revokes all existing sessions for that student. Blocking or archiving revokes
sessions and preserves all learning data; unblocking restores the same user ID
and password. Archiving is non-destructive.

## Learning data API

Every route below requires a valid server session. State-changing requests
also require an exact allowed `Origin`. The server always takes the owner from
the authenticated session and rejects unexpected fields such as `user_id`.

- `GET /api/learning/progress`
- `PUT /api/learning/progress/:topicId`
- `GET /api/learning/test-drafts`
- `PUT /api/learning/test-drafts/:testId`
- `DELETE /api/learning/test-drafts/:testId`
- `GET /api/learning/test-attempts`
- `POST /api/learning/test-attempts`
- `GET /api/learning/homework-submissions`
- `POST /api/learning/homework-submissions`
- `GET /api/learning/messages`
- `POST /api/learning/messages`

Creating a test attempt and marking its topic progress happen in one database
transaction; the same is true for homework metadata and homework progress.
Test attempts are append-only, so repeat attempts preserve history. Drafts are
upserted by stable test ID and removed after a confirmed attempt.

The frontend keeps only runtime copies of learning records. On first load it
can retry a one-time import of old keys scoped as `KEY::authenticatedUser.id`.
Each old item is removed only after the protected API confirms it. Unscoped
records, conflicting drafts and the unused correction-history key are left
untouched because ownership or intent cannot be proved safely.

Browser-local data is limited to UI/legal preferences:

- `daria-ege-color-theme` — light/dark theme;
- `daria-ege-personal-data-consent` — local acknowledgement shown by the UI;
- `analytics_consent` — optional analytics choice (analytics remain disabled
  unless accepted).

## Tests

```sh
npm test
```

The integration suite covers unauthenticated access, persistence across new
sessions, cross-user isolation, forged owner fields, post-logout denial,
admin role enforcement, activation, reset, blocking and non-destructive
student updates.

## Current boundary

Full file upload, teacher/admin review endpoints and server-side scoring are not
implemented in this stage. In particular, `data/tests-score-hashes.js` remains
an identified security issue and must later be replaced by server-side scoring
without shipping answer keys to browsers.
