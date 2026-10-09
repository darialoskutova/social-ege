# Stage 5: thematic mocks and private uploads

This release is not deployed automatically. Run it only after reviewing the
commit on `main`. The commands below do not change SSH, UFW, PostgreSQL network
binding, `.env`, `privacy.html` or `offer.html`.

## 1. Preflight and backups

```bash
cd /var/www/social-ege
git pull --ff-only origin main
test -f /opt/social-ege/backend/.env
sudo systemctl is-active social-ege.service
sudo nginx -t

release_stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d -m 0700 -o daria -g daria /opt/social-ege/backups
sudo tar -C /opt/social-ege -czf "/opt/social-ege/backups/stage5-backend-${release_stamp}.tgz" backend
sudo -u postgres pg_dump -Fc social_ege > "/tmp/social-ege-stage5-${release_stamp}.dump"
sudo mv "/tmp/social-ege-stage5-${release_stamp}.dump" /opt/social-ege/backups/
```

## 2. Backend, private storage and migration

Copy only the backend application while preserving the protected production
`.env`, then create the non-public storage directory and install the systemd
write-access drop-in:

```bash
sudo rsync -a --delete --exclude='.env' --exclude='node_modules/' \
  /var/www/social-ege/backend/ /opt/social-ege/backend/
sudo chown -R daria:daria /opt/social-ege/backend
sudo chmod 600 /opt/social-ege/backend/.env

sudo install -d -m 0700 -o daria -g daria /opt/social-ege/var/uploads
sudo install -d -m 0755 /etc/systemd/system/social-ege.service.d
sudo install -m 0644 deploy/systemd/social-ege-uploads.conf \
  /etc/systemd/system/social-ege.service.d/uploads.conf

cd /opt/social-ege/backend
sudo -u daria npm ci --omit=dev
sudo -u daria npm run migrate
sudo -u daria npm run schema:status
sudo systemctl daemon-reload
sudo systemctl restart social-ege.service
```

Migration `005_file_and_mock_submissions.sql` is additive. It creates
`mock_submissions` and adds homework file revision timestamps; it does not
rewrite existing attempts, homework records or user accounts.

## 3. Nginx upload limit

In the active HTTPS `server {}` block, add `client_max_body_size 15m;` to the
existing `location /api/ {}`. The versioned snippet in
`deploy/nginx/social-ege-api.conf` shows the exact placement. Do not replace the
production server block wholesale.

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 4. Explicit frontend allowlist

Copy the changed public files and the versioned mock directory only. Keep the
server's newer legal pages untouched:

```bash
cd /var/www/social-ege
sudo install -m 0644 index.html cabinet.css /var/www/html/
sudo install -d -m 0755 /var/www/html/data /var/www/html/admin
sudo install -m 0644 data/thematic-mocks.js /var/www/html/data/
sudo install -m 0644 admin/index.html admin/admin.css admin/admin.js /var/www/html/admin/

sudo install -d -m 0755 "/var/www/html/доп материалы/пробные варианты/2027-draft-v1"
sudo find "/var/www/html/доп материалы/пробные варианты/2027-draft-v1" -type f -delete
sudo cp "доп материалы/пробные варианты/2027-draft-v1/"*.docx \
  "/var/www/html/доп материалы/пробные варианты/2027-draft-v1/"
sudo chmod 0644 "/var/www/html/доп материалы/пробные варианты/2027-draft-v1/"*.docx
```

Do not publish `data/thematic-mocks.json`, `data/webium-task-index.json`,
`tools/mock-bank/.private`, upload storage, answer keys or the repository as a
whole. The browser receives only the small answer-free frontend manifest.

## 5. Post-deploy checks

```bash
curl --fail --silent --show-error https://daria-ege.ru/api/health
curl --fail --silent --show-error https://daria-ege.ru/api/auth/status
curl --fail --head --silent --show-error \
  'https://daria-ege.ru/%D0%B4%D0%BE%D0%BF%20%D0%BC%D0%B0%D1%82%D0%B5%D1%80%D0%B8%D0%B0%D0%BB%D1%8B/%D0%BF%D1%80%D0%BE%D0%B1%D0%BD%D1%8B%D0%B5%20%D0%B2%D0%B0%D1%80%D0%B8%D0%B0%D0%BD%D1%82%D1%8B/2027-draft-v1/%E2%84%961%20%D0%9F%D1%80%D0%BE%D0%B1%D0%BD%D1%8B%D0%B9%20%D0%95%D0%93%D0%AD%20%D0%BF%D0%BE%D0%BB%D0%B8%D1%82%D0%B8%D0%BA%D0%B0.docx'
sudo systemctl --no-pager --full status social-ege.service
sudo journalctl -u social-ege.service -n 80 --no-pager
```

Then, with one student account and one admin account, manually verify a small
PDF upload, refresh persistence, replacement before review, owner isolation and
admin download. Confirm that `/opt/social-ege/var/uploads` is not reachable by
an HTTP URL.
