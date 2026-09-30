#!/usr/bin/env bash

set -Eeuo pipefail

readonly EXPECTED_REPO="/var/www/social-ege"
readonly BACKEND_DIR="/opt/social-ege/backend"
readonly ENV_FILE="${BACKEND_DIR}/.env"
readonly SERVICE_FILE="/etc/systemd/system/social-ege.service"
readonly NGINX_SITE="/etc/nginx/sites-available/default"
readonly NGINX_ENABLED="/etc/nginx/sites-enabled/default"
readonly NGINX_SNIPPET="/etc/nginx/snippets/social-ege-api.conf"

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

[[ -f backend/server.js ]] || fail "backend/server.js is missing"
[[ -f backend/package.json ]] || fail "backend/package.json is missing"
[[ -f backend/package-lock.json ]] || fail "backend/package-lock.json is missing"
[[ -f deploy/systemd/social-ege.service ]] || fail "systemd unit is missing"
[[ -f deploy/nginx/social-ege-api.conf ]] || fail "Nginx API snippet is missing"
[[ -f deploy/nginx/default-with-api.conf ]] || fail "Nginx site template is missing"

step "Preflight"
sudo -v

[[ -d "$BACKEND_DIR" ]] || fail "${BACKEND_DIR} does not exist"
[[ -f "$ENV_FILE" ]] || fail "${ENV_FILE} does not exist"

env_mode="$(stat -c '%a' "$ENV_FILE")"
env_owner="$(stat -c '%U:%G' "$ENV_FILE")"
[[ "$env_mode" == "600" ]] || fail ".env mode is ${env_mode}; expected 600"
[[ "$env_owner" == "daria:daria" ]] || fail ".env owner is ${env_owner}; expected daria:daria"
printf '.env metadata: %s %s (contents not read)\n' "$env_mode" "$env_owner"

node_path="$(command -v node)"
npm_path="$(command -v npm)"
[[ "$node_path" == "/usr/bin/node" ]] || fail "Node path is ${node_path}; review the systemd unit before continuing"
printf 'Node: %s\n' "$(node --version)"
printf 'npm: %s\n' "$(npm --version)"

active_site="$(readlink -f "$NGINX_ENABLED" 2>/dev/null || true)"
[[ "$active_site" == "$NGINX_SITE" ]] || fail "the active default Nginx site is not ${NGINX_SITE}"
[[ -f "$NGINX_SITE" ]] || fail "${NGINX_SITE} is missing"
grep -Eq '^[[:space:]]*root[[:space:]]+/var/www/html;' "$NGINX_SITE" \
    || fail "active Nginx root is not /var/www/html"
grep -Eq '^[[:space:]]*listen[[:space:]]+80[[:space:]]+default_server;' "$NGINX_SITE" \
    || fail "active Nginx site is not the standard port 80 default server"
if grep -Eq '^[[:space:]]*proxy_pass[[:space:]]' "$NGINX_SITE"; then
    fail "active Nginx site already contains a proxy; review it manually"
fi

if sudo ss -ltnp '( sport = :3000 )' | grep -q LISTEN \
    && ! sudo systemctl is-active --quiet social-ege.service; then
    fail "port 3000 is occupied outside social-ege.service; stop only the known manual backend process, then rerun"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="/opt/social-ege/backups/stage1-${timestamp}"
nginx_backup="${NGINX_SITE}.stage1-${timestamp}.bak"
service_backup="${SERVICE_FILE}.stage1-${timestamp}.bak"

step "Backups"
sudo install -d -o daria -g daria -m 0700 "$backup_dir"
for filename in server.js package.json package-lock.json; do
    if [[ -f "${BACKEND_DIR}/${filename}" ]]; then
        sudo cp -p -- "${BACKEND_DIR}/${filename}" "${backup_dir}/${filename}"
    fi
done
sudo cp -p -- "$NGINX_SITE" "$nginx_backup"
if [[ -f "$SERVICE_FILE" ]]; then
    sudo cp -p -- "$SERVICE_FILE" "$service_backup"
fi
printf 'Backend backup: %s\n' "$backup_dir"
printf 'Nginx backup: %s\n' "$nginx_backup"

step "Backend"
sudo install -o daria -g daria -m 0644 backend/server.js "${BACKEND_DIR}/server.js"
sudo install -o daria -g daria -m 0644 backend/package.json "${BACKEND_DIR}/package.json"
sudo install -o daria -g daria -m 0644 backend/package-lock.json "${BACKEND_DIR}/package-lock.json"
sudo -u daria "$npm_path" --prefix "$BACKEND_DIR" ci --omit=dev --no-audit --no-fund
sudo -u daria "$node_path" --check "${BACKEND_DIR}/server.js"

step "systemd"
sudo install -o root -g root -m 0644 deploy/systemd/social-ege.service "$SERVICE_FILE"
sudo systemd-analyze verify "$SERVICE_FILE"
sudo systemctl daemon-reload
sudo systemctl enable social-ege.service
sudo systemctl restart social-ege.service

for attempt in {1..10}; do
    if curl --noproxy '*' --fail-with-body --silent --show-error --max-time 5 \
        http://127.0.0.1:3000/health; then
        printf '\n'
        break
    fi
    if [[ "$attempt" == "10" ]]; then
        sudo systemctl --no-pager --full status social-ege.service || true
        sudo journalctl -u social-ege.service -n 50 --no-pager || true
        sudo systemctl stop social-ege.service || true
        fail "direct backend health check failed"
    fi
    sleep 1
done
sudo systemctl is-active --quiet social-ege.service || fail "social-ege.service is not active"
sudo systemctl is-enabled --quiet social-ege.service || fail "social-ege.service is not enabled"

step "Nginx"
root_hash_before="$(curl --noproxy '*' --fail --silent --show-error --max-time 5 \
    http://127.0.0.1/ | sha256sum | awk '{print $1}')"

sudo install -o root -g root -m 0644 deploy/nginx/social-ege-api.conf "$NGINX_SNIPPET"
sudo install -o root -g root -m 0644 deploy/nginx/default-with-api.conf "$NGINX_SITE"

if ! sudo nginx -t; then
    sudo install -o root -g root -m 0644 "$nginx_backup" "$NGINX_SITE"
    sudo nginx -t || true
    fail "Nginx validation failed; previous site configuration restored"
fi

sudo systemctl reload nginx

api_response=""
for attempt in {1..10}; do
    api_response="$(curl --noproxy '*' --fail --silent --max-time 5 \
        http://127.0.0.1/api/health || true)"
    if [[ "$api_response" == '{"ok":true}' ]]; then
        break
    fi
    sleep 1
done

if [[ "$api_response" != '{"ok":true}' ]]; then
    printf '%s\n' 'Nginx health diagnostic:' >&2
    curl --noproxy '*' --silent --show-error --max-time 5 --include \
        http://127.0.0.1/api/health 2>&1 | sed -n '1,20p' >&2 || true
    sudo install -o root -g root -m 0644 "$nginx_backup" "$NGINX_SITE"
    sudo nginx -t
    sudo systemctl reload nginx
    fail "Nginx API health check failed; previous site configuration restored"
fi

root_hash_after="$(curl --noproxy '*' --fail --silent --show-error --max-time 5 \
    http://127.0.0.1/ | sha256sum | awk '{print $1}')"
if [[ "$root_hash_before" != "$root_hash_after" ]]; then
    sudo install -o root -g root -m 0644 "$nginx_backup" "$NGINX_SITE"
    sudo nginx -t
    sudo systemctl reload nginx
    fail "root page changed; previous site configuration restored"
fi

step "Result"
sudo systemctl --no-pager --full status social-ege.service | sed -n '1,12p'
printf 'Direct backend: %s\n' "$(curl --noproxy '*' --fail --silent --max-time 5 http://127.0.0.1:3000/health)"
printf 'Through Nginx: %s\n' "$api_response"
printf '%s\n' 'Root page checksum is unchanged.'
printf '%s\n' 'Stage 1 completed. SSH, UFW and PostgreSQL configuration were not changed.'
