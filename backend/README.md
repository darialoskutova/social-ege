# Social EGE backend

Private API deployed in small, reversible stages. It contains a database-backed
health check, server-side sessions and protected persistence for student
learning data. Test definitions, answer keys, versioning and scoring are kept
on the backend; answer keys are not shipped with the public frontend.

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

Migration `007_editable_tests.sql` is additive. It creates the current editable
test overrides and their version history, then adds the test version and an
immutable result snapshot to future `test_attempts`. Existing attempts remain
unchanged with null values in the new columns.

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

## Personal study plans

Migration `006_personal_study_plans.sql` is additive. It creates
`student_study_plans` for each student's plan settings and
`study_schedule_events` for generated lessons, deadlines and mandatory
thematic mocks. It does not alter or remove users, progress, test attempts,
homework submissions or mock submissions.

The course order is shared by the browser and backend through
`data/course-topics.js`. A new plan uses two lessons per topic. Test deadlines
are set to 23:59 Europe/Moscow on the day before the next lesson; second-part
deadlines and thematic mock deadlines are set three calendar days after the
relevant lesson. A target end date produces a warning when the generated plan
runs longer, but never truncates the programme.

The authenticated student route is:

- `GET /api/learning/study-plan`.

The owner ID always comes from the server session. Administrative plan routes
all require `role=admin`:

- `GET /api/admin/course-catalog`;
- `GET /api/admin/students/:studentId/study-plan`;
- `POST /api/admin/students/:studentId/study-plan/preview`;
- `PUT /api/admin/students/:studentId/study-plan`;
- `PATCH /api/admin/students/:studentId/study-plan/events/:eventId`;
- `POST /api/admin/students/:studentId/study-plan/recalculate`.

Moving, cancelling, restoring or replacing one event is recorded without
deleting its history. Explicit recalculation replaces only eligible future
generated events. Past, completed, submitted and cancelled work is preserved.
No new environment variable is required.

## Learning data API

Every route below requires a valid server session. State-changing requests
also require an exact allowed `Origin`. The server always takes the owner from
the authenticated session and rejects unexpected fields such as `user_id`.

- `GET /api/learning/progress`
- `PUT /api/learning/progress/:topicId`
- `GET /api/learning/tests`
- `GET /api/learning/tests/:testId`
- `GET /api/learning/test-drafts`
- `PUT /api/learning/test-drafts/:testId`
- `DELETE /api/learning/test-drafts/:testId`
- `GET /api/learning/test-attempts`
- `POST /api/learning/test-attempts`
- `GET /api/learning/homework-submissions`
- `POST /api/learning/homework-submissions`
- `POST /api/learning/homework-submissions/file` — real PDF/JPEG/PNG upload
- `GET /api/learning/homework-submissions/:id/file` — owner-only download
- `GET /api/learning/mock-submissions`
- `POST /api/learning/mock-submissions/file` — versioned thematic mock upload
- `GET /api/learning/mock-submissions/:id/file` — owner-only download

File upload requests send the file as the raw request body. Context is passed
through URL-encoded `X-File-Name`, `X-Topic-Id` or `X-Mock-Id` / `X-Mock-Version`,
and optional `X-Student-Comment` headers. The server validates the extension,
MIME type, binary signature and size. Files receive random internal names and
are never served from the public web root.

Runtime settings:

- `UPLOAD_STORAGE_DIR` (production default documented as `/opt/social-ege/var/uploads`)
- `UPLOAD_MAX_BYTES` (default 15 MiB; maximum accepted configuration is 50 MiB)

With the hardened systemd unit, create the private directory with mode `0700`
for the service user and install `deploy/systemd/social-ege-uploads.conf` as
`/etc/systemd/system/social-ege.service.d/uploads.conf` before restart.

## Teacher-managed materials

Migration `008_materials_cms.sql` adds the `materials` catalog. Existing notes,
homework, section plans and thematic mocks are registered idempotently through
stable `legacy_key` values; subsequent metadata and publication changes are
stored in PostgreSQL. New files are kept in private storage and downloaded only
through authenticated role-aware endpoints.

Runtime settings:

- `MATERIAL_STORAGE_DIR` (production default `/opt/social-ege/var/materials`)
- `MATERIAL_LEGACY_ROOT` (production default `/var/www/social-ege`)
- `MATERIAL_MAX_BYTES` (default 25 MiB; maximum 50 MiB)

The service user needs read/write access to `MATERIAL_STORAGE_DIR`. The legacy
root is read-only and is never returned through the API. Install the updated
`deploy/systemd/social-ege-uploads.conf` so the hardened unit can write both
private upload directories.

Admin endpoints (all require `role=admin`):

- `GET /api/admin/materials`
- `POST /api/admin/materials/file`
- `PATCH /api/admin/materials/:id`
- `PUT /api/admin/materials/:id/file`
- `GET /api/admin/materials/:id/file`
- `GET /api/admin/students/:studentId/test-attempts/:attemptId`

Student endpoints (authenticated, published materials only):

- `GET /api/learning/materials`
- `GET /api/learning/materials/:id/file`

Material create, metadata/status changes and file replacement write
`material.*` entries to the existing `audit_log`. Test-attempt detail is
read-only and reconstructs questions from the immutable saved test version.

## Test editing and scoring

Baseline definitions and private answer keys are installed with the backend in
`backend/tests/`. An admin edit creates a database-backed override in
`editable_tests`, appends the new immutable revision to
`editable_test_versions`, and records `test.updated` in `audit_log`. No new
environment variable is required.

All `/api/admin/tests*` routes use the existing admin router boundary, so they
require a valid session and `role=admin`:

- `GET /api/admin/tests`;
- `GET /api/admin/tests/:testId`;
- `PUT /api/admin/tests/:testId`.

Students receive only test content and metadata through the protected learning
routes. A normal submitted attempt is scored against the current server-side
answer key. Its score, test version and result review are stored together, so a
later admin edit cannot recalculate or change that historical attempt.

Admin endpoints:

- `GET /api/admin/mock-submissions`
- `GET /api/admin/mock-submissions/:id/file`
- `GET /api/learning/messages`
- `POST /api/learning/messages`

Work-specific conversations use immutable message history and are separate
from the older general teacher-contact form above. Supported subject types are
`homework`, `mock` and `test_attempt`.

Student endpoints:

- `GET /api/learning/conversations/unread`
- `GET /api/learning/conversations/:subjectType/:subjectId`
- `POST /api/learning/conversations/:subjectType/:subjectId/messages`
- `POST /api/learning/conversations/:subjectType/:subjectId/read`

Admin endpoints:

- `GET /api/admin/conversations/:subjectType/:subjectId`
- `POST /api/admin/conversations/:subjectType/:subjectId/messages`
- `POST /api/admin/conversations/:subjectType/:subjectId/read`

## Conversation attachments

Migration `010_conversation_attachments.sql` adds immutable attachment metadata
without changing existing conversation messages. A message may contain text,
one attachment, or both. The same storage and validation path is used for
homework, thematic mock and exact test-attempt threads.

Files are sent as the raw request body. `X-File-Name` contains the URL-encoded
original filename. When text accompanies a file, the frontend encodes its
UTF-8 bytes as canonical Base64 split across `X-Message-Text-1` through
`X-Message-Text-4`; `X-Message-Text-Parts` contains the part count. Standalone
text messages continue using the JSON endpoint from Stage 10.

Supported formats are PDF, DOCX, JPEG and PNG. Validation checks filename,
extension, MIME, signature and size; DOCX also uses the shared Word-container
check. The default and maximum configured attachment size is 10 MiB, below the
existing Nginx `client_max_body_size 15m` boundary.

Runtime settings:

- `CONVERSATION_ATTACHMENT_STORAGE_DIR` (production-safe default
  `/opt/social-ege/var/conversation-attachments` when the backend is installed
  in `/opt/social-ege/backend`);
- `CONVERSATION_ATTACHMENT_MAX_BYTES` (default and maximum 10 MiB).

Student endpoints:

- `POST /api/learning/conversations/:subjectType/:subjectId/messages/file`;
- `GET /api/learning/conversations/attachments/:attachmentId/file`.

Admin endpoints:

- `POST /api/admin/conversations/:subjectType/:subjectId/messages/file`;
- `GET /api/admin/conversations/attachments/:attachmentId/file`.

Downloads are session- and ownership-protected and use `private, no-store`.
The API returns only attachment id, original filename, MIME type, size and a
role-specific protected download URL; generated object keys and storage paths
are never serialized. Upload and database insert are coordinated so a failed
transaction removes the newly stored object.

The server derives sender identity from the authenticated session. Student
access is checked against the owner of the referenced submission or exact test
attempt. `/api/admin/inbox` also returns unread conversation summaries.

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

The application now has private homework/mock file upload, teacher review and
server-side test scoring. The public `data/tests-score-hashes.js` and
`data/tests-public.js` assets have been removed; deployment must also remove
their obsolete copies from the Nginx document root. Baseline answer keys remain
version-controlled backend source, so repository access must be treated as
trusted and their earlier public Git history cannot be retroactively hidden by
this release.
