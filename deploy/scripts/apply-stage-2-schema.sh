#!/usr/bin/env bash

set -Eeuo pipefail

readonly EXPECTED_REPO="/var/www/social-ege"
readonly BACKEND_DIR="/opt/social-ege/backend"
readonly ENV_FILE="${BACKEND_DIR}/.env"
readonly SERVICE_FILE="/etc/systemd/system/social-ege.service"

fail() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

step() {
    printf '\n== %s ==\n' "$*"
}

[[ "$(id -un)" == "daria" ]] || fail "run this script as user daria"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "not inside a Git repository"
[[ "$repo_root" == "$EXPECTED_REPO" ]] || fail "expected repository at ${EXPECTED_REPO}, found ${repo_root}"
cd "$repo_root"

for required_path in \
    backend/package.json \
    backend/package-lock.json \
    backend/server.js \
    backend/scripts/database.js \
    backend/scripts/migrate.js \
    backend/scripts/schema-status.js \
    backend/migrations/001_core_schema.sql \
    deploy/systemd/social-ege.service; do
    [[ -f "$required_path" ]] || fail "missing ${required_path}"
done

step "Preflight"
sudo -v
[[ -f "$ENV_FILE" ]] || fail "${ENV_FILE} does not exist"
[[ "$(stat -c '%a' "$ENV_FILE")" == "600" ]] || fail ".env must have mode 600"
[[ "$(stat -c '%U:%G' "$ENV_FILE")" == "daria:daria" ]] || fail ".env must belong to daria:daria"
sudo systemctl is-active --quiet social-ege.service || fail "stage 1 backend service is not active"
[[ "$(curl --noproxy '*' --fail --silent --max-time 5 http://127.0.0.1:3000/health)" == '{"ok":true}' ]] \
    || fail "stage 1 health check failed"

if [[ -d "${BACKEND_DIR}/migrations" ]]; then
    for server_migration in "${BACKEND_DIR}"/migrations/*.sql; do
        [[ -e "$server_migration" ]] || continue
        migration_name="$(basename "$server_migration")"
        [[ -f "backend/migrations/${migration_name}" ]] \
            || fail "unexpected server migration ${migration_name}; review manually"
    done
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="/opt/social-ege/backups/stage2-schema-${timestamp}"
service_backup="${SERVICE_FILE}.stage2-${timestamp}.bak"

step "Backups"
sudo install -d -o daria -g daria -m 0700 "$backup_dir"
for filename in server.js package.json package-lock.json; do
    if [[ -f "${BACKEND_DIR}/${filename}" ]]; then
        sudo cp -p -- "${BACKEND_DIR}/${filename}" "${backup_dir}/${filename}"
    fi
done
for dirname in scripts migrations; do
    if [[ -d "${BACKEND_DIR}/${dirname}" ]]; then
        sudo cp -a -- "${BACKEND_DIR}/${dirname}" "${backup_dir}/${dirname}"
    fi
done
sudo cp -p -- "$SERVICE_FILE" "$service_backup"
printf 'Backend backup: %s\n' "$backup_dir"
printf 'Service backup: %s\n' "$service_backup"

step "Install migration files"
sudo install -o daria -g daria -m 0644 backend/server.js "${BACKEND_DIR}/server.js"
sudo install -o daria -g daria -m 0644 backend/package.json "${BACKEND_DIR}/package.json"
sudo install -o daria -g daria -m 0644 backend/package-lock.json "${BACKEND_DIR}/package-lock.json"
sudo install -d -o daria -g daria -m 0755 "${BACKEND_DIR}/scripts" "${BACKEND_DIR}/migrations"
for source_file in backend/scripts/*.js; do
    sudo install -o daria -g daria -m 0644 "$source_file" "${BACKEND_DIR}/scripts/$(basename "$source_file")"
done
for source_file in backend/migrations/*.sql; do
    sudo install -o daria -g daria -m 0644 "$source_file" "${BACKEND_DIR}/migrations/$(basename "$source_file")"
done

sudo -u daria node --check "${BACKEND_DIR}/scripts/database.js"
sudo -u daria node --check "${BACKEND_DIR}/scripts/migrate.js"
sudo -u daria node --check "${BACKEND_DIR}/scripts/schema-status.js"

step "Apply schema"
sudo -u daria npm --prefix "$BACKEND_DIR" run migrate
sudo -u daria npm --prefix "$BACKEND_DIR" run schema:status

step "Enable migrations before service start"
sudo install -o root -g root -m 0644 deploy/systemd/social-ege.service "$SERVICE_FILE"
sudo systemd-analyze verify "$SERVICE_FILE"
sudo systemctl daemon-reload

if ! sudo systemctl restart social-ege.service; then
    sudo install -o root -g root -m 0644 "$service_backup" "$SERVICE_FILE"
    sudo systemctl daemon-reload
    sudo systemctl restart social-ege.service || true
    fail "service restart failed; previous unit restored"
fi

for attempt in {1..10}; do
    health="$(curl --noproxy '*' --fail --silent --max-time 5 \
        http://127.0.0.1:3000/health || true)"
    if [[ "$health" == '{"ok":true}' ]]; then
        break
    fi
    if [[ "$attempt" == "10" ]]; then
        sudo systemctl --no-pager --full status social-ege.service || true
        sudo journalctl -u social-ege.service -n 50 --no-pager || true
        sudo install -o root -g root -m 0644 "$service_backup" "$SERVICE_FILE"
        sudo systemctl daemon-reload
        sudo systemctl restart social-ege.service || true
        fail "health check failed; previous unit restored"
    fi
    sleep 1
done

step "Result"
sudo -u daria npm --prefix "$BACKEND_DIR" run schema:status
sudo systemctl --no-pager --full status social-ege.service | sed -n '1,12p'
printf 'Direct backend: %s\n' "$health"
printf 'Through Nginx: %s\n' "$(curl --noproxy '*' --fail --silent --max-time 5 http://127.0.0.1/api/health)"
printf '%s\n' 'Stage 2 schema completed. No user accounts or answer keys were created.'
