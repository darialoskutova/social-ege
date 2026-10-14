# Stage 7: teacher workspace and submission review

This release is not deployed automatically. It adds no migration, package or
environment variable. It must not overwrite the production legal pages,
landing page, student cabinet, learning materials or private uploads.

## 1. Preflight and backup

```sh
cd /var/www/social-ege
git status --short
git fetch origin main
git log --oneline --decorate -5 origin/main
sudo systemctl is-active social-ege.service
curl --fail-with-body https://daria-ege.ru/api/health

release_stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d -m 0700 -o daria -g daria /opt/social-ege/backups
sudo -u postgres pg_dump -Fc social_ege > "/tmp/social-ege-before-stage7-${release_stamp}.dump"
sudo mv "/tmp/social-ege-before-stage7-${release_stamp}.dump" /opt/social-ege/backups/
sudo cp -a /opt/social-ege/backend "/opt/social-ege/backups/backend-before-stage7-${release_stamp}"
sudo tar -C /var/www/html -czf "/opt/social-ege/backups/admin-before-stage7-${release_stamp}.tgz" admin
privacy_before=$(sha256sum /var/www/html/privacy.html | cut -d' ' -f1)
offer_before=$(sha256sum /var/www/html/offer.html | cut -d' ' -f1)
```

Stop if the checkout is dirty, the service is unhealthy or any backup fails.
Do not print or copy `/opt/social-ege/backend/.env`.

## 2. Update and test the reviewed source

Replace `EXPECTED_COMMIT` with the reviewed commit hash from the release note.

```sh
cd /var/www/social-ege
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "EXPECTED_COMMIT"

cd /var/www/social-ege/backend
sudo -u daria npm ci --no-audit --no-fund
sudo -u daria npm test
```

## 3. Install the backend

The runtime upload directory `/opt/social-ege/var/uploads` is outside both the
Git checkout and the backend source directory. The command below preserves the
protected `.env`, installed dependencies and runtime data.

```sh
sudo rsync -a --delete \
  --exclude='.env' \
  --exclude='node_modules/' \
  --exclude='var/' \
  /var/www/social-ege/backend/ /opt/social-ege/backend/
sudo chown -R daria:daria /opt/social-ege/backend
sudo chmod 600 /opt/social-ege/backend/.env

cd /opt/social-ege/backend
sudo -u daria npm ci --omit=dev --no-audit --no-fund
sudo -u daria npm run migrate
sudo -u daria npm run schema:status
sudo systemctl restart social-ege.service
sudo systemctl status social-ege.service --no-pager
```

There is no Stage 7 migration. The migration command only verifies and applies
previously committed additive migrations if the server is missing any.

## 4. Publish only the admin frontend

```sh
sudo install -d -o www-data -g www-data -m 0755 /var/www/html/admin
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/admin/index.html /var/www/html/admin/index.html
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/admin/admin.css /var/www/html/admin/admin.css
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/admin/admin.js /var/www/html/admin/admin.js

test "$(sha256sum /var/www/html/privacy.html | cut -d' ' -f1)" = "$privacy_before"
test "$(sha256sum /var/www/html/offer.html | cut -d' ' -f1)" = "$offer_before"
```

Do not recursively copy the repository into `/var/www/html`. In particular,
do not publish the upload directory, answer keys or internal test data.

## 5. Post-deploy checks

```sh
curl --fail-with-body http://127.0.0.1:3000/health
curl --fail-with-body https://daria-ege.ru/api/health
curl --fail-with-body https://daria-ege.ru/api/auth/status
curl --fail --head https://daria-ege.ru/admin/
sudo journalctl -u social-ege.service -n 80 --no-pager
```

Then verify with one admin and one student account:

1. an unauthenticated request to `/api/admin/inbox` returns 401;
2. a student request to `/api/admin/inbox` returns 403;
3. the admin sees both homework and mock submissions;
4. the admin can download a file and save review status/comment;
5. after `needs_revision`, the student can upload a new revision;
6. after `in_review` or `accepted`, replacement remains blocked;
7. another student cannot download the file through the learning API;
8. the student card and all-student schedule open correctly;
9. study-plan preview does not save, while save/recalculation preserves history;
10. `/opt/social-ege/var/uploads` is not reachable by a public URL.
