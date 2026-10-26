#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

readonly RELEASE_COMMIT="8222caa4dc55feb6531633019db5a5a2aeee4ffb"
readonly PREVIOUS_RELEASE="bad12a24ecc06bfdb342b21ffedb54552716092b"
readonly SOURCE_URL="https://github.com/darialoskutova/social-ege.git"
readonly WEB_ROOT="/var/www/social-ege"
readonly BACKEND_DIR="/opt/social-ege/backend"
readonly RELEASE_MARKER="/opt/social-ege/RELEASE_COMMIT"
readonly STAGING_ROOT="/opt/social-ege/staging"
readonly BACKUP_ROOT="/opt/social-ege/backups"
readonly PUBLIC_ORIGIN="https://daria-ege.ru"
readonly SERVICE_NAME="social-ege.service"

readonly -a BACKEND_EXISTING=(
  "backend/admin/router.js"
  "backend/materials/service.js"
)
readonly -a BACKEND_NEW=(
  "backend/materials/metadata.js"
  "backend/migrations/012_material_scopes.sql"
  "backend/migrations/013_legacy_material_scope_compatibility.sql"
)
readonly -a FRONTEND_FILES=(
  "admin/admin.css"
  "admin/admin.js"
  "admin/index.html"
  "index.html"
)
readonly -a PROTECTED_FILES=(
  "/opt/social-ege/backend/.env"
  "/var/www/social-ege/privacy.html"
  "/var/www/social-ege/offer.html"
  "/var/www/social-ege/assets/landing/daria.png"
  "/var/www/social-ege/assets/landing/dasha2.png"
  "/etc/nginx/sites-available/default"
  "/etc/nginx/snippets/social-ege-api.conf"
  "/etc/nginx/snippets/social-ege-private-paths.conf"
  "/etc/systemd/system/social-ege.service"
  "/etc/systemd/system/social-ege.service.d/uploads.conf"
)
readonly -a STORAGE_DIRS=(
  "/opt/social-ege/var/uploads"
  "/opt/social-ege/var/materials"
  "/opt/social-ege/var/conversation-attachments"
)
readonly -a EXPECTED_DIFF=(
  "admin/admin.css"
  "admin/admin.js"
  "admin/index.html"
  "backend/README.md"
  "backend/admin/router.js"
  "backend/materials/metadata.js"
  "backend/materials/service.js"
  "backend/migrations/012_material_scopes.sql"
  "backend/migrations/013_legacy_material_scope_compatibility.sql"
  "backend/test/content-assets.test.js"
  "backend/test/material-scope-compatibility.test.js"
  "backend/test/material-scopes.test.js"
  "backend/test/materials-cms.test.js"
  "index.html"
)

rollback_armed=0
backup_dir=""
staging_dir=""
release_dir=""
deploy_started_at=""
marker_tmp=""

step() {
  printf '\n== %s ==\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  if [[ "$rollback_armed" == "1" ]]; then
    rollback_application 1
  fi
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

http_status() {
  curl --noproxy '*' --silent --show-error --max-time 10 \
    --output /dev/null --write-out '%{http_code}' "$1"
}

retry_status() {
  local expected=$1 url=$2 actual="" attempt
  for attempt in {1..30}; do
    actual=$(http_status "$url" || true)
    if [[ "$actual" == "$expected" ]]; then
      printf '%s\n' "$actual"
      return 0
    fi
    sleep 1
  done
  printf 'Last HTTP status for %s: %s\n' "$url" "${actual:-unavailable}" >&2
  return 1
}

protected_manifest() {
  local destination=$1 path
  : > "$destination"
  for path in "${PROTECTED_FILES[@]}"; do
    [[ -f "$path" ]] || die "protected production file is missing: $path"
    sudo sha256sum "$path" >> "$destination"
  done
}

storage_manifest() {
  local destination=$1 directory
  : > "$destination"
  for directory in "${STORAGE_DIRS[@]}"; do
    [[ -d "$directory" ]] || die "private storage is missing: $directory"
    stat -c 'DIR\t%a\t%U:%G\t%n' "$directory" >> "$destination"
    find "$directory" -type f -print0 \
      | sort -z \
      | xargs -0 -r sha256sum >> "$destination"
  done
}

database_preflight() {
  (
    cd "$BACKEND_DIR"
    /usr/bin/node <<'NODE'
"use strict";
const { createPool } = require("./scripts/database");

const expectedMigrations = [
  "001_core_schema.sql",
  "002_learning_data_persistence.sql",
  "003_student_identity_management.sql",
  "004_structured_student_names.sql",
  "005_file_and_mock_submissions.sql",
  "006_personal_study_plans.sql",
  "007_editable_tests.sql",
  "008_materials_cms.sql",
  "009_work_conversations.sql",
  "010_conversation_attachments.sql",
  "011_unified_inbox.sql",
];

(async () => {
  const pool = createPool();
  try {
    const migrations = await pool.query("SELECT name FROM schema_migrations ORDER BY name");
    const names = migrations.rows.map((row) => row.name);
    if (JSON.stringify(names) !== JSON.stringify(expectedMigrations)) {
      throw new Error(`unexpected migrations: ${JSON.stringify(names)}`);
    }
    const { rows: [counts] } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM materials) AS materials,
        (SELECT COUNT(*)::int FROM materials WHERE material_type = 'section_plan') AS plans,
        (SELECT COUNT(*)::int FROM materials WHERE material_type = 'thematic_mock') AS mocks,
        (SELECT COUNT(*)::int FROM (
          SELECT legacy_key FROM materials WHERE legacy_key IS NOT NULL
          GROUP BY legacy_key HAVING COUNT(*) > 1
        ) duplicate_keys) AS duplicates,
        (SELECT COUNT(*)::int FROM conversation_threads) AS threads,
        (SELECT COUNT(*)::int FROM conversation_messages) AS messages,
        (SELECT COUNT(*)::int FROM conversation_attachments) AS attachments
    `);
    const expected = {
      materials: 105, plans: 4, mocks: 15, duplicates: 0,
      threads: 5, messages: 6, attachments: 0,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (counts[key] !== value) throw new Error(`${key}=${counts[key]}, expected ${value}`);
    }
    console.log(JSON.stringify(counts));
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(`database preflight failed: ${error.message}`);
  process.exit(1);
});
NODE
  )
}

database_snapshot() {
  local destination=$1
  (
    cd "$BACKEND_DIR"
    /usr/bin/node - "$destination" <<'NODE'
"use strict";
const fs = require("node:fs");
const { createPool } = require("./scripts/database");

(async () => {
  const pool = createPool();
  try {
    const { rows } = await pool.query(`
      SELECT id, COALESCE(legacy_key, '') AS legacy_key,
             COALESCE(object_key, '') AS object_key,
             original_filename, status
        FROM materials
       ORDER BY id
    `);
    fs.writeFileSync(process.argv[2], `${rows.map((row) => [
      row.id, row.legacy_key, row.object_key, row.original_filename, row.status,
    ].join("\t")).join("\n")}\n`, { mode: 0o600 });
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(`material snapshot failed: ${error.message}`);
  process.exit(1);
});
NODE
  )
}

database_post_migration() {
  local before_snapshot=$1 after_snapshot=$2
  (
    cd "$BACKEND_DIR"
    /usr/bin/node - "$before_snapshot" "$after_snapshot" <<'NODE'
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createPool } = require("./scripts/database");

function checksum(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

(async () => {
  const pool = createPool();
  try {
    const expectedChecksums = new Map([
      "012_material_scopes.sql",
      "013_legacy_material_scope_compatibility.sql",
    ].map((name) => [name, checksum(path.join(__dirname, "migrations", name))]));
    const migrations = await pool.query(`
      SELECT name, checksum FROM schema_migrations
       WHERE name IN ('012_material_scopes.sql', '013_legacy_material_scope_compatibility.sql')
       ORDER BY name
    `);
    if (migrations.rows.length !== 2) throw new Error("012/013 migration pair is incomplete");
    for (const row of migrations.rows) {
      if (row.checksum.trim() !== expectedChecksums.get(row.name)) {
        throw new Error(`migration checksum mismatch: ${row.name}`);
      }
    }

    const { rows: [counts] } = await pool.query(`
      SELECT
        COUNT(*)::int AS materials,
        COUNT(*) FILTER (WHERE scope_type = 'course')::int AS course,
        COUNT(*) FILTER (WHERE scope_type = 'section')::int AS section,
        COUNT(*) FILTER (WHERE scope_type = 'topic')::int AS topic,
        COUNT(*) FILTER (WHERE material_type = 'section_plan')::int AS plans,
        COUNT(*) FILTER (WHERE material_type = 'thematic_mock')::int AS mocks,
        COUNT(*) FILTER (WHERE scope_type IS NULL OR NOT (
          (scope_type = 'course' AND section_id IS NULL AND topic_id IS NULL)
          OR (scope_type = 'section' AND section_id IS NOT NULL AND topic_id IS NULL)
          OR (scope_type = 'topic' AND section_id IS NOT NULL AND topic_id IS NOT NULL)
        ))::int AS invalid,
        (SELECT COUNT(*)::int FROM (
          SELECT legacy_key FROM materials WHERE legacy_key IS NOT NULL
          GROUP BY legacy_key HAVING COUNT(*) > 1
        ) duplicate_keys) AS duplicates
      FROM materials
    `);
    const expected = {
      materials: 105, course: 0, section: 19, topic: 86,
      plans: 4, mocks: 15, invalid: 0, duplicates: 0,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (counts[key] !== value) throw new Error(`${key}=${counts[key]}, expected ${value}`);
    }
    const trigger = await pool.query(`
      SELECT COUNT(*)::int AS count
        FROM pg_trigger
       WHERE tgrelid = 'materials'::regclass
         AND tgname = 'materials_legacy_scope_compat'
         AND NOT tgisinternal
         AND tgenabled = 'O'
    `);
    if (trigger.rows[0].count !== 1) throw new Error("legacy scope compatibility trigger is missing");

    const { rows } = await pool.query(`
      SELECT id, COALESCE(legacy_key, '') AS legacy_key,
             COALESCE(object_key, '') AS object_key,
             original_filename, status
        FROM materials
       ORDER BY id
    `);
    fs.writeFileSync(process.argv[3], `${rows.map((row) => [
      row.id, row.legacy_key, row.object_key, row.original_filename, row.status,
    ].join("\t")).join("\n")}\n`, { mode: 0o600 });
    if (!fs.readFileSync(process.argv[2]).equals(fs.readFileSync(process.argv[3]))) {
      throw new Error("material identity snapshot changed");
    }
    console.log(JSON.stringify(counts));
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(`post-migration verification failed: ${error.message}`);
  process.exit(1);
});
NODE
  )
}

materials_service_smoke() {
  (
    cd "$BACKEND_DIR"
    /usr/bin/node <<'NODE'
"use strict";
const { createPool } = require("./scripts/database");
const fs = require("node:fs");
const path = require("node:path");
const {
  findFile,
  listPublished,
  readMaterialConfig,
} = require("./materials/service");

(async () => {
  const pool = createPool();
  try {
    const materials = await listPublished(pool);
    const plans = materials.filter((item) => item.type === "section_plan");
    const mocks = materials.filter((item) => item.type === "thematic_mock");
    if (materials.length !== 105) throw new Error(`published materials=${materials.length}`);
    if (plans.length !== 4) throw new Error(`published plans=${plans.length}`);
    if (mocks.length !== 15) throw new Error(`published mocks=${mocks.length}`);
    const config = readMaterialConfig();
    for (const material of [...plans, ...mocks]) {
      const row = await findFile(pool, material.id, { publishedOnly: true });
      if (row.storage_kind !== "legacy") throw new Error(`unexpected storage for material ${row.id}`);
      const filename = path.resolve(config.legacyRoot, row.legacy_path);
      if (!filename.startsWith(`${config.legacyRoot}${path.sep}`)) {
        throw new Error(`unsafe legacy path for material ${row.id}`);
      }
      fs.accessSync(filename, fs.constants.R_OK);
    }
    const publicJson = JSON.stringify(materials);
    if (/object_key|storage_kind|legacy_path/.test(publicJson)) {
      throw new Error("student material serialization exposes private storage metadata");
    }
    console.log(JSON.stringify({ materials: materials.length, plans: plans.length, mocks: mocks.length }));
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(`materials smoke failed: ${error.message}`);
  process.exit(1);
});
NODE
  )
}

migration_pair_state() {
  (
    cd "$BACKEND_DIR"
    /usr/bin/node <<'NODE'
"use strict";
const { createPool } = require("./scripts/database");
(async () => {
  const pool = createPool();
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*)::int AS count FROM schema_migrations
       WHERE name IN ('012_material_scopes.sql', '013_legacy_material_scope_compatibility.sql')
    `);
    process.stdout.write(String(rows[0].count));
  } finally {
    await pool.end();
  }
})().catch(() => process.exit(2));
NODE
  )
}

restore_previous_application() {
  local pair_state=$1
  printf '%s\n' "Restoring application files from ${backup_dir}; DB migrations are not rolled back." >&2

  sudo cp -p -- "${backup_dir}/application/backend/admin/router.js" "${BACKEND_DIR}/admin/router.js"
  sudo cp -p -- "${backup_dir}/application/backend/materials/service.js" "${BACKEND_DIR}/materials/service.js"
  sudo cp -p -- "${backup_dir}/application/frontend/admin/admin.css" "${WEB_ROOT}/admin/admin.css"
  sudo cp -p -- "${backup_dir}/application/frontend/admin/admin.js" "${WEB_ROOT}/admin/admin.js"
  sudo cp -p -- "${backup_dir}/application/frontend/admin/index.html" "${WEB_ROOT}/admin/index.html"
  sudo cp -p -- "${backup_dir}/application/frontend/index.html" "${WEB_ROOT}/index.html"
  if [[ -e "${BACKEND_DIR}/materials/metadata.js" ]]; then
    sudo unlink "${BACKEND_DIR}/materials/metadata.js"
  fi

  if [[ "$pair_state" == "0" ]]; then
    [[ -e "${BACKEND_DIR}/migrations/012_material_scopes.sql" ]] \
      && sudo unlink "${BACKEND_DIR}/migrations/012_material_scopes.sql"
    [[ -e "${BACKEND_DIR}/migrations/013_legacy_material_scope_compatibility.sql" ]] \
      && sudo unlink "${BACKEND_DIR}/migrations/013_legacy_material_scope_compatibility.sql"
  fi
  sudo cp -p -- "${backup_dir}/application/RELEASE_COMMIT" "$RELEASE_MARKER"
}

rollback_application() {
  local original_status=${1:-1} pair_state
  rollback_armed=0
  trap - ERR
  set +e
  printf '\nROLLBACK: application deployment failed; starting guarded recovery.\n' >&2
  if [[ -n "$marker_tmp" && -e "$marker_tmp" ]]; then
    sudo unlink "$marker_tmp" || true
  fi
  sudo systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  pair_state=$(migration_pair_state 2>/dev/null)
  if [[ "$pair_state" == "0" || "$pair_state" == "2" ]]; then
    restore_previous_application "$pair_state"
    if sudo systemctl start "$SERVICE_NAME"; then
      retry_status 200 "http://127.0.0.1:3000/health" >/dev/null || true
      retry_status 200 "${PUBLIC_ORIGIN}/api/health" >/dev/null || true
      materials_service_smoke || true
    fi
  else
    printf '%s\n' \
      "ROLLBACK BLOCKED: only one of migrations 012/013 is recorded. The old backend was not restored." \
      "The reviewed backend files remain installed and the service remains stopped for manual recovery." >&2
  fi
  printf 'Release marker after recovery: ' >&2
  cat "$RELEASE_MARKER" >&2 || true
  exit "$original_status"
}

unexpected_error() {
  local line=$1 status=$2
  printf 'DEPLOY FAILED at line %s (status %s).\n' "$line" "$status" >&2
  if [[ "$rollback_armed" == "1" ]]; then
    rollback_application "$status"
  fi
  exit "$status"
}

trap 'unexpected_error "$LINENO" "$?"' ERR

[[ "$#" == "1" && "$1" == "--deploy-reviewed-release" ]] \
  || die "usage: $0 --deploy-reviewed-release"
[[ "$(id -un)" == "daria" ]] || die "run this script as user daria"

for command_name in \
  git tar sha256sum pg_dump pg_restore curl cmp install npm node \
  sudo systemctl journalctl find sort xargs awk; do
  require_command "$command_name"
done
[[ "$(command -v node)" == "/usr/bin/node" ]] || die "expected Node at /usr/bin/node"
[[ "$(command -v npm)" == "/usr/bin/npm" ]] || die "expected npm at /usr/bin/npm"

step "Read-only production preflight"
[[ -f "$RELEASE_MARKER" ]] || die "release marker is missing"
[[ "$(cat "$RELEASE_MARKER")" == "$PREVIOUS_RELEASE" ]] \
  || die "production release is not ${PREVIOUS_RELEASE}"
for service in "$SERVICE_NAME" nginx.service postgresql.service; do
  systemctl is-active --quiet "$service" || die "$service is not active"
done
[[ "$(http_status 'http://127.0.0.1:3000/health')" == "200" ]] || die "direct health is not 200"
[[ "$(http_status "${PUBLIC_ORIGIN}/api/health")" == "200" ]] || die "public health is not 200"
[[ "$(http_status "${PUBLIC_ORIGIN}/")" == "200" ]] || die "public root is not 200"
[[ "$(http_status "${PUBLIC_ORIGIN}/admin/")" == "200" ]] || die "public admin is not 200"

[[ -f "${BACKEND_DIR}/.env" ]] || die "production .env is missing"
[[ "$(stat -c '%a:%U:%G' "${BACKEND_DIR}/.env")" == "600:daria:daria" ]] \
  || die "production .env metadata changed"
[[ "$(systemctl show "$SERVICE_NAME" -p User --value)" == "daria" ]] \
  || die "backend service user is not daria"
for directory in "${STORAGE_DIRS[@]}"; do
  [[ "$(stat -c '%a:%U:%G' "$directory")" == "700:daria:daria" ]] \
    || die "private storage metadata changed: $directory"
done
for path in "${PROTECTED_FILES[@]}"; do
  [[ -f "$path" ]] || die "protected production file is missing: $path"
done
for path in "${BACKEND_DIR}/materials/metadata.js" \
            "${BACKEND_DIR}/migrations/012_material_scopes.sql" \
            "${BACKEND_DIR}/migrations/013_legacy_material_scope_compatibility.sql"; do
  [[ ! -e "$path" ]] || die "unexpected pre-existing release file: $path"
done
database_preflight
printf 'Read-only preflight passed for %s.\n' "$PREVIOUS_RELEASE"

step "Sudo authorization and isolated exact source"
sudo -v
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
staging_dir="${STAGING_ROOT}/stage12-scopes-${timestamp}-$$-8222caa"
backup_dir="${BACKUP_ROOT}/stage12-scopes-${timestamp}-$$-8222caa"
release_dir="${staging_dir}/release"
[[ ! -e "$staging_dir" ]] || die "staging path already exists: $staging_dir"
[[ ! -e "$backup_dir" ]] || die "backup path already exists: $backup_dir"
sudo install -d -o daria -g daria -m 0700 "$staging_dir"

git clone --quiet --filter=blob:none --no-checkout "$SOURCE_URL" "$release_dir"
git -C "$release_dir" checkout --quiet --detach "$RELEASE_COMMIT"
[[ "$(git -C "$release_dir" rev-parse HEAD)" == "$RELEASE_COMMIT" ]] \
  || die "clean source is not the reviewed release"
git -C "$release_dir" cat-file -e "${PREVIOUS_RELEASE}^{commit}" \
  || die "previous release is unavailable in isolated source"
[[ -z "$(git -C "$release_dir" status --porcelain --untracked-files=all)" ]] \
  || die "isolated release checkout is not clean"

printf '%s\n' "${EXPECTED_DIFF[@]}" | sort > "${staging_dir}/expected-diff.txt"
git -C "$release_dir" diff --name-only "$PREVIOUS_RELEASE" "$RELEASE_COMMIT" \
  | sort > "${staging_dir}/actual-diff.txt"
cmp -s "${staging_dir}/expected-diff.txt" "${staging_dir}/actual-diff.txt" \
  || die "reviewed release diff is not the audited file set"
git -C "$release_dir" diff --check "$PREVIOUS_RELEASE" "$RELEASE_COMMIT"
git -C "$release_dir" diff --quiet "$PREVIOUS_RELEASE" "$RELEASE_COMMIT" \
  -- backend/package.json backend/package-lock.json \
  || die "backend dependencies changed unexpectedly"
git -C "$release_dir" diff --quiet "$PREVIOUS_RELEASE" "$RELEASE_COMMIT" \
  -- privacy.html offer.html \
  || die "legal documents changed unexpectedly"

step "Tests in isolated reviewed release"
/usr/bin/npm --prefix "${release_dir}/backend" ci --no-audit --no-fund
set +e
/usr/bin/npm --prefix "${release_dir}/backend" test -- --test-reporter=tap \
  > "${staging_dir}/full-tests.tap" 2>&1
full_test_status=$?
set -e
[[ "$full_test_status" == "0" ]] || die "full test suite failed; see ${staging_dir}/full-tests.tap"
full_test_plan=$(awk '/^1\.\.[0-9]+$/ { value=$0 } END { sub(/^1\.\./, "", value); print value }' \
  "${staging_dir}/full-tests.tap")
[[ "$full_test_plan" == "322" ]] || die "full test plan is ${full_test_plan:-missing}, expected 322"

set +e
(
  cd "${release_dir}/backend"
  /usr/bin/node --test --test-reporter=tap \
    test/content-assets.test.js \
    test/materials-cms.test.js \
    test/material-scopes.test.js \
    test/material-scope-compatibility.test.js
) > "${staging_dir}/materials-tests.tap" 2>&1
targeted_test_status=$?
set -e
[[ "$targeted_test_status" == "0" ]] \
  || die "targeted materials tests failed; see ${staging_dir}/materials-tests.tap"
targeted_test_plan=$(awk '/^1\.\.[0-9]+$/ { value=$0 } END { sub(/^1\.\./, "", value); print value }' \
  "${staging_dir}/materials-tests.tap")
[[ "$targeted_test_plan" == "112" ]] \
  || die "targeted materials test plan is ${targeted_test_plan:-missing}, expected 112"

for script in \
  backend/admin/router.js \
  backend/materials/metadata.js \
  backend/materials/service.js; do
  /usr/bin/node --check "${release_dir}/${script}"
done
/usr/bin/node --check "${release_dir}/admin/admin.js"
[[ -z "$(git -C "$release_dir" diff --name-only)" ]] \
  || die "tests changed tracked release files"
printf 'Full tests: %s/322; targeted materials tests: %s/112.\n' \
  "$full_test_plan" "$targeted_test_plan"

step "Verify current runtime and exact publish sets"
previous_dir="${staging_dir}/previous"
install -d -m 0700 "$previous_dir"
git -C "$release_dir" archive "$PREVIOUS_RELEASE" \
  "${BACKEND_EXISTING[@]}" "${FRONTEND_FILES[@]}" \
  | tar -xf - -C "$previous_dir"
for path in "${BACKEND_EXISTING[@]}"; do
  relative=${path#backend/}
  cmp -s "${previous_dir}/${path}" "${BACKEND_DIR}/${relative}" \
    || die "live backend drift detected: ${relative}"
done
for path in "${FRONTEND_FILES[@]}"; do
  cmp -s "${previous_dir}/${path}" "${WEB_ROOT}/${path}" \
    || die "live frontend drift detected: ${path}"
done
printf 'Backend publish set:\n'
printf '  %s\n' "${BACKEND_EXISTING[@]}" "${BACKEND_NEW[@]}"
printf 'Frontend publish set:\n'
printf '  %s\n' "${FRONTEND_FILES[@]}"

step "Fresh verified backups"
sudo install -d -o daria -g daria -m 0700 "$backup_dir"
protected_manifest "${backup_dir}/protected-before.sha256"
storage_manifest "${backup_dir}/storage-before.sha256"
database_snapshot "${backup_dir}/materials-before.tsv"

(
  cd "$BACKEND_DIR"
  /usr/bin/node - "${backup_dir}/postgres.dump" <<'NODE'
"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(".env"), quiet: true });

const destination = process.argv[2];
const first = (...names) => names.map((name) => process.env[name]).find(Boolean);
let host = first("DB_HOST", "PGHOST", "POSTGRES_HOST") || "127.0.0.1";
let port = first("DB_PORT", "PGPORT", "POSTGRES_PORT") || "5432";
let database = first("DB_NAME", "DB_DATABASE", "PGDATABASE", "POSTGRES_DB") || "social_ege";
let user = first("DB_USER", "DB_USERNAME", "PGUSER", "POSTGRES_USER") || "social_ege_app";
let password = first("DB_PASSWORD", "PGPASSWORD", "POSTGRES_PASSWORD");
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  host = url.hostname;
  port = url.port || "5432";
  database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  user = decodeURIComponent(url.username);
  password = decodeURIComponent(url.password);
}
if (!password) throw new Error("database password is unavailable");
const result = spawnSync("/usr/bin/pg_dump", [
  "--format=custom", "--file", destination,
  "--host", host, "--port", port, "--username", user, database,
], { env: { ...process.env, PGPASSWORD: password }, stdio: ["ignore", "inherit", "inherit"] });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
NODE
)
[[ -s "${backup_dir}/postgres.dump" ]] || die "PostgreSQL backup is empty"
/usr/bin/pg_restore --list "${backup_dir}/postgres.dump" > "${backup_dir}/postgres.dump.list"
[[ -s "${backup_dir}/postgres.dump.list" ]] || die "PostgreSQL backup TOC is empty"

sudo tar --one-file-system -cpf "${backup_dir}/web-root.tar" -C /var/www social-ege
sudo tar --one-file-system -cpf "${backup_dir}/backend.tar" -C /opt/social-ege backend
sudo tar --one-file-system -cpf "${backup_dir}/uploads.tar" -C /opt/social-ege/var uploads
sudo tar --one-file-system -cpf "${backup_dir}/materials.tar" -C /opt/social-ege/var materials
sudo tar --one-file-system -cpf "${backup_dir}/conversation-attachments.tar" \
  -C /opt/social-ege/var conversation-attachments
sudo tar -cpf "${backup_dir}/production-config.tar" -C / \
  etc/nginx/sites-available/default \
  etc/nginx/snippets/social-ege-api.conf \
  etc/nginx/snippets/social-ege-private-paths.conf \
  etc/systemd/system/social-ege.service \
  etc/systemd/system/social-ege.service.d/uploads.conf

for archive in web-root backend uploads materials conversation-attachments production-config; do
  [[ -s "${backup_dir}/${archive}.tar" ]] || die "backup archive is empty: ${archive}.tar"
  sudo tar -tf "${backup_dir}/${archive}.tar" >/dev/null \
    || die "backup archive verification failed: ${archive}.tar"
done

sudo install -d -o root -g root -m 0700 \
  "${backup_dir}/application/backend/admin" \
  "${backup_dir}/application/backend/materials" \
  "${backup_dir}/application/frontend/admin"
sudo cp -p -- "${BACKEND_DIR}/admin/router.js" \
  "${backup_dir}/application/backend/admin/router.js"
sudo cp -p -- "${BACKEND_DIR}/materials/service.js" \
  "${backup_dir}/application/backend/materials/service.js"
sudo cp -p -- "${WEB_ROOT}/admin/admin.css" \
  "${backup_dir}/application/frontend/admin/admin.css"
sudo cp -p -- "${WEB_ROOT}/admin/admin.js" \
  "${backup_dir}/application/frontend/admin/admin.js"
sudo cp -p -- "${WEB_ROOT}/admin/index.html" \
  "${backup_dir}/application/frontend/admin/index.html"
sudo cp -p -- "${WEB_ROOT}/index.html" \
  "${backup_dir}/application/frontend/index.html"
sudo cp -p -- "$RELEASE_MARKER" "${backup_dir}/application/RELEASE_COMMIT"
sudo cp -p -- "${staging_dir}/full-tests.tap" "${backup_dir}/full-tests.tap"
sudo cp -p -- "${staging_dir}/materials-tests.tap" "${backup_dir}/materials-tests.tap"

# Close the backup race before maintenance: no scoped data, protected file or
# private storage change is allowed between preflight and the service stop.
database_preflight
protected_manifest "${staging_dir}/protected-before-stop.sha256"
storage_manifest "${staging_dir}/storage-before-stop.sha256"
cmp -s "${backup_dir}/protected-before.sha256" "${staging_dir}/protected-before-stop.sha256" \
  || die "protected files changed during backup"
cmp -s "${backup_dir}/storage-before.sha256" "${staging_dir}/storage-before-stop.sha256" \
  || die "private storage changed during backup"
[[ "$(http_status 'http://127.0.0.1:3000/health')" == "200" ]] || die "health failed before maintenance"
printf 'Verified backup: %s\n' "$backup_dir"

deploy_started_at=$(date --iso-8601=seconds)
rollback_armed=1

# FIRST LIVE APPLICATION MUTATION. Everything above is preflight, isolated
# release preparation, tests, comparison or backup creation/verification.
step "Maintenance: stop backend"
sudo systemctl stop "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME" && die "backend did not stop"

step "Publish reviewed backend runtime"
for path in "${BACKEND_EXISTING[@]}" "${BACKEND_NEW[@]}"; do
  relative=${path#backend/}
  sudo install -o daria -g daria -m 0600 \
    "${release_dir}/${path}" "${BACKEND_DIR}/${relative}"
  cmp -s "${release_dir}/${path}" "${BACKEND_DIR}/${relative}" \
    || die "backend publish mismatch: ${path}"
done
for path in "${BACKEND_EXISTING[@]}" "${BACKEND_NEW[@]}"; do
  relative=${path#backend/}
  case "$relative" in
    *.js) sudo -u daria /usr/bin/node --check "${BACKEND_DIR}/${relative}" ;;
  esac
done

step "Apply migrations 012 then 013"
sudo -u daria /usr/bin/npm --prefix "$BACKEND_DIR" run migrate \
  > "${backup_dir}/migration-output.log" 2>&1
database_post_migration \
  "${backup_dir}/materials-before.tsv" \
  "${backup_dir}/materials-after-migration.tsv"

step "Publish reviewed frontend runtime"
for path in "${FRONTEND_FILES[@]}"; do
  sudo install -o root -g root -m 0644 "${release_dir}/${path}" "${WEB_ROOT}/${path}"
  cmp -s "${release_dir}/${path}" "${WEB_ROOT}/${path}" \
    || die "frontend publish mismatch: ${path}"
done

step "Start backend and health checks"
sudo systemctl start "$SERVICE_NAME"
retry_status 200 "http://127.0.0.1:3000/health" >/dev/null \
  || die "direct backend health did not recover"
retry_status 200 "${PUBLIC_ORIGIN}/api/health" >/dev/null \
  || die "public API health did not recover"
systemctl is-active --quiet "$SERVICE_NAME" || die "backend service is not active"
systemctl is-active --quiet nginx.service || die "nginx is not active"
systemctl is-active --quiet postgresql.service || die "PostgreSQL is not active"
[[ "$(http_status "${PUBLIC_ORIGIN}/")" == "200" ]] || die "public root is not 200"
[[ "$(http_status "${PUBLIC_ORIGIN}/admin/")" == "200" ]] || die "public admin is not 200"
sudo nginx -t

step "Auth, security and materials smoke"
[[ "$(http_status "${PUBLIC_ORIGIN}/api/learning/materials")" == "401" ]] \
  || die "anonymous student materials endpoint is not 401"
[[ "$(http_status "${PUBLIC_ORIGIN}/api/admin/materials")" == "401" ]] \
  || die "anonymous admin materials endpoint is not 401"
[[ "$(http_status "${PUBLIC_ORIGIN}/api/learning/materials/1/file")" == "401" ]] \
  || die "anonymous material download is not 401"

student_post_status=$(curl --noproxy '*' --silent --show-error --max-time 10 \
  --output /dev/null --write-out '%{http_code}' \
  --request POST --header "Origin: ${PUBLIC_ORIGIN}" \
  --header 'Content-Type: application/octet-stream' --data-binary '' \
  "${PUBLIC_ORIGIN}/api/learning/conversations/homework/1/messages/file")
[[ "$student_post_status" == "401" ]] \
  || die "origin-valid anonymous student POST is ${student_post_status}, expected 401"

admin_post_status=$(curl --noproxy '*' --silent --show-error --max-time 10 \
  --output /dev/null --write-out '%{http_code}' \
  --request POST --header "Origin: ${PUBLIC_ORIGIN}" \
  --header 'Content-Type: application/octet-stream' --data-binary '' \
  "${PUBLIC_ORIGIN}/api/admin/conversations/homework/1/messages/file")
[[ "$admin_post_status" == "401" ]] \
  || die "origin-valid anonymous admin POST is ${admin_post_status}, expected 401"

materials_service_smoke
database_post_migration \
  "${backup_dir}/materials-before.tsv" \
  "${backup_dir}/materials-after-smoke.tsv"

for path in "${BACKEND_EXISTING[@]}" "${BACKEND_NEW[@]}"; do
  relative=${path#backend/}
  cmp -s "${release_dir}/${path}" "${BACKEND_DIR}/${relative}" \
    || die "deployed backend drift: ${path}"
done
for path in "${FRONTEND_FILES[@]}"; do
  cmp -s "${release_dir}/${path}" "${WEB_ROOT}/${path}" \
    || die "deployed frontend drift: ${path}"
done

protected_manifest "${backup_dir}/protected-after.sha256"
storage_manifest "${backup_dir}/storage-after.sha256"
cmp -s "${backup_dir}/protected-before.sha256" "${backup_dir}/protected-after.sha256" \
  || die "a protected production file changed"
cmp -s "${backup_dir}/storage-before.sha256" "${backup_dir}/storage-after.sha256" \
  || die "private storage changed"

sudo journalctl -q -u "$SERVICE_NAME" --since "$deploy_started_at" -p 0..3 --no-pager \
  > "${backup_dir}/service-critical.log"
[[ ! -s "${backup_dir}/service-critical.log" ]] \
  || die "critical service log entries appeared; see ${backup_dir}/service-critical.log"
sudo journalctl -q -u "$SERVICE_NAME" --since "$deploy_started_at" --no-pager \
  > "${backup_dir}/service-since-deploy.log"
if grep -Eai 'warning|error|fatal|exception|unhandled' \
  "${backup_dir}/service-since-deploy.log" > "${backup_dir}/service-warning-lines.log"; then
  die "service warning/error text appeared; see ${backup_dir}/service-warning-lines.log"
else
  : > "${backup_dir}/service-warning-lines.log"
fi

step "Finalize release marker"
marker_tmp="/opt/social-ege/.RELEASE_COMMIT.stage12.$$"
printf '%s\n' "$RELEASE_COMMIT" | sudo tee "$marker_tmp" >/dev/null
sudo chown root:root "$marker_tmp"
sudo chmod 0644 "$marker_tmp"
sudo mv -f -- "$marker_tmp" "$RELEASE_MARKER"
[[ "$(cat "$RELEASE_MARKER")" == "$RELEASE_COMMIT" ]] \
  || die "release marker was not updated"

rollback_armed=0
trap - ERR

step "Deployment complete"
printf 'Production release: %s\n' "$RELEASE_COMMIT"
printf 'Backup: %s\n' "$backup_dir"
printf 'Staging: %s\n' "$staging_dir"
printf 'Migrations: 012_material_scopes.sql, 013_legacy_material_scope_compatibility.sql\n'
printf 'Tests: %s/322; targeted materials: %s/112\n' "$full_test_plan" "$targeted_test_plan"
printf 'Service warnings/errors since deploy start: 0\n'
printf '%s\n' 'Private storage and protected production files: unchanged'
