#!/usr/bin/env bash

set -u

printf '%s\n' '== identity and OS =='
whoami
. /etc/os-release
printf '%s\n' "$PRETTY_NAME"
uname -r

printf '%s\n' '== service state =='
for service in nginx postgresql social-ege; do
    printf '%s: active=' "$service"
    systemctl is-active "$service" 2>/dev/null || true
    printf '%s: enabled=' "$service"
    systemctl is-enabled "$service" 2>/dev/null || true
done

printf '%s\n' '== local health =='
curl --max-time 5 --fail-with-body --silent --show-error \
    http://127.0.0.1:3000/health || true
printf '\n'

printf '%s\n' '== listeners (80, 3000, 5432) =='
ss -ltn | awk 'NR == 1 || $4 ~ /:(80|3000|5432)$/'

printf '%s\n' '== firewall =='
sudo -n ufw status verbose 2>&1 || true

printf '%s\n' '== backend paths and modes (contents are not read) =='
for path in \
    /opt/social-ege/backend \
    /opt/social-ege/backend/.env \
    /opt/social-ege/backend/package.json \
    /opt/social-ege/backend/server.js; do
    if [[ -e "$path" ]]; then
        stat -c '%a %U %G %n' "$path"
    else
        printf 'missing %s\n' "$path"
    fi
done

printf '%s\n' '== frontend repository =='
if [[ -d /var/www/social-ege/.git ]]; then
    git -C /var/www/social-ege status --short --branch
    git -C /var/www/social-ege log -1 --oneline
else
    printf '%s\n' 'missing /var/www/social-ege/.git'
fi

printf '%s\n' '== PostgreSQL presence checks =='
sudo -n -u postgres psql -X -Atqc \
    "SELECT 'version=' || current_setting('server_version');
     SELECT 'database=' || EXISTS (SELECT 1 FROM pg_database WHERE datname = 'social_ege');
     SELECT 'role=' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'social_ege_app');" \
    2>&1 || true

printf '%s\n' '== Nginx configuration test =='
sudo -n nginx -t 2>&1 || true
