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
    backend/server.js \
    backend/package.json \
    backend/package-lock.json \
    backend/auth/config.js \
    backend/auth/router.js \
    backend/auth/passwords.js \
    backend/auth/sessions.js \
    backend/auth/middleware.js \
    backend/lib/async-handler.js \
    backend/lib/http-error.js \
    backend/scripts/create-user.js \
    backend/test/auth-config.test.js \
    backend/test/auth-router.test.js \
    backend/test/passwords.test.js \
    deploy/systemd/social-ege.service; do
    [[ -f "$required_path" ]] || fail "missing ${required_path}"
done

step "Preflight"
sudo -v
[[ -f "$ENV_FILE" ]] || fail "${ENV_FILE} does not exist"
[[ "$(stat -c '%a' "$ENV_FILE")" == "600" ]] || fail ".env must have mode 600"
[[ "$(stat -c '%U:%G' "$ENV_FILE")" == "daria:daria" ]] || fail ".env must belong to daria:daria"
sudo systemctl is-active --quiet social-ege.service || fail "backend service is not active"
[[ "$(curl --noproxy '*' --fail --silent --max-time 5 http://127.0.0.1:3000/health)" == '{"ok":true}' ]] \
    || fail "backend health check failed"
sudo -u daria npm --prefix "$BACKEND_DIR" run schema:status >/dev/null

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
staging_dir="/opt/social-ege/staging/stage3-auth-${timestamp}"
backup_dir="/opt/social-ege/backups/stage3-auth-${timestamp}"
service_backup="${SERVICE_FILE}.stage3-${timestamp}.bak"
rollback_armed=0

restore_live_release() {
    rollback_armed=0
    trap - ERR
    set +e
    printf '%s\n' 'Restoring the previous backend release...' >&2
    for filename in server.js package.json package-lock.json; do
        if [[ -f "${backup_dir}/${filename}" ]]; then
            sudo install -o daria -g daria -m 0644 \
                "${backup_dir}/${filename}" "${BACKEND_DIR}/${filename}"
        fi
    done
    sudo -u daria npm --prefix "$BACKEND_DIR" ci --omit=dev --no-audit --no-fund || true
    sudo install -o root -g root -m 0644 "$service_backup" "$SERVICE_FILE"
    sudo systemctl daemon-reload
    sudo systemctl restart social-ege.service || true
}

rollback_on_error() {
    local exit_status=$?
    if [[ "$rollback_armed" == "1" ]]; then
        restore_live_release
    fi
    exit "$exit_status"
}

trap rollback_on_error ERR

step "Test isolated release"
sudo install -d -o daria -g daria -m 0755 "$staging_dir"
sudo -u daria cp -R -- backend/. "$staging_dir/"
sudo -u daria npm --prefix "$staging_dir" ci --no-audit --no-fund
sudo -u daria npm --prefix "$staging_dir" test

step "Backups"
sudo install -d -o daria -g daria -m 0700 "$backup_dir"
for filename in server.js package.json package-lock.json; do
    if [[ -f "${BACKEND_DIR}/${filename}" ]]; then
        sudo cp -p -- "${BACKEND_DIR}/${filename}" "${backup_dir}/${filename}"
    fi
done
for dirname in auth lib scripts migrations test; do
    if [[ -d "${BACKEND_DIR}/${dirname}" ]]; then
        sudo cp -a -- "${BACKEND_DIR}/${dirname}" "${backup_dir}/${dirname}"
    fi
done
sudo cp -p -- "$SERVICE_FILE" "$service_backup"
rollback_armed=1
printf 'Tested release: %s\n' "$staging_dir"
printf 'Backend backup: %s\n' "$backup_dir"
printf 'Service backup: %s\n' "$service_backup"

step "Install backend"
sudo install -o daria -g daria -m 0644 backend/server.js "${BACKEND_DIR}/server.js"
sudo install -o daria -g daria -m 0644 backend/package.json "${BACKEND_DIR}/package.json"
sudo install -o daria -g daria -m 0644 backend/package-lock.json "${BACKEND_DIR}/package-lock.json"

for dirname in auth lib scripts migrations test; do
    sudo install -d -o daria -g daria -m 0755 "${BACKEND_DIR}/${dirname}"
    for source_file in "backend/${dirname}"/*; do
        [[ -f "$source_file" ]] || continue
        sudo install -o daria -g daria -m 0644 \
            "$source_file" "${BACKEND_DIR}/${dirname}/$(basename "$source_file")"
    done
done

sudo -u daria npm --prefix "$BACKEND_DIR" ci --omit=dev --no-audit --no-fund
sudo -u daria npm --prefix "$BACKEND_DIR" run migrate
sudo -u daria npm --prefix "$BACKEND_DIR" run schema:status

step "Restart with authentication disabled"
sudo install -o root -g root -m 0644 deploy/systemd/social-ege.service "$SERVICE_FILE"
sudo systemd-analyze verify "$SERVICE_FILE"
sudo systemctl daemon-reload

if ! sudo systemctl restart social-ege.service; then
    restore_live_release
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
        restore_live_release
        fail "health check failed; previous unit restored"
    fi
    sleep 1
done

direct_auth_status="$(curl --noproxy '*' --fail --silent --max-time 5 \
    http://127.0.0.1:3000/api/auth/status)"
proxy_auth_status="$(curl --noproxy '*' --fail --silent --max-time 5 \
    http://127.0.0.1/api/auth/status)"
if [[ "$direct_auth_status" != '{"enabled":false,"httpsRequired":true}' ]]; then
    restore_live_release
    fail "unexpected direct authentication status"
fi
if [[ "$proxy_auth_status" != "$direct_auth_status" ]]; then
    restore_live_release
    fail "authentication status differs through Nginx"
fi

login_http_code="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' \
    --max-time 5 --request POST --header 'Content-Type: application/json' \
    --data '{"login":"disabled-check","password":"not-a-real-password"}' \
    http://127.0.0.1:3000/api/auth/login)"
if [[ "$login_http_code" != "503" ]]; then
    restore_live_release
    fail "disabled login did not return HTTP 503"
fi

step "Result"
rollback_armed=0
sudo systemctl --no-pager --full status social-ege.service | sed -n '1,12p'
printf 'Health: %s\n' "$health"
printf 'Auth status: %s\n' "$proxy_auth_status"
printf 'Disabled login HTTP status: %s\n' "$login_http_code"
printf '%s\n' 'Stage 3 foundation completed. Authentication remains disabled; no accounts were created.'
