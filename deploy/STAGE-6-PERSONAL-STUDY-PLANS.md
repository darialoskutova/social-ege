# Stage 6: personal study plans

This runbook is for a later, deliberate production release. Committing this
change does not deploy it. Do not change SSH, UFW, Nginx, systemd, PostgreSQL
network settings or the protected production `.env` for this stage.

## Scope

- additive migration: `backend/migrations/006_personal_study_plans.sql`;
- backend study-plan generator, service and protected routes;
- student schedule block in the existing cabinet;
- admin controls for creating and editing one student's plan;
- shared course catalogue `data/course-topics.js`.

No new package or environment variable is required. The release depends on
all earlier migrations, including `005_file_and_mock_submissions.sql`; the
normal migration runner applies any still-pending migration in order.

## 1. Preflight and backups

Run these commands on the server only after reviewing the release commit:

```sh
cd /var/www/social-ege
git status --short
git fetch origin main
git log --oneline --decorate -5 origin/main
sudo systemctl status social-ege.service --no-pager
curl --fail-with-body https://daria-ege.ru/api/health
release_stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d -m 0700 -o daria -g daria /opt/social-ege/backups
sudo -u postgres pg_dump -Fc social_ege > "/tmp/social-ege-before-stage6-${release_stamp}.dump"
sudo mv "/tmp/social-ege-before-stage6-${release_stamp}.dump" /opt/social-ege/backups/
sudo cp -a /opt/social-ege/backend "/opt/social-ege/backups/backend-before-stage6-${release_stamp}"
```

Stop if the Git working tree contains unexpected changes, the service is not
healthy, or either backup fails. Never print or copy `/opt/social-ege/backend/.env`.

## 2. Update the reviewed source checkout

```sh
cd /var/www/social-ege
git pull --ff-only origin main
```

Install backend source while preserving the production `.env` and excluding
runtime data:

```sh
sudo rsync -a --delete \
  --exclude='.env' \
  --exclude='node_modules/' \
  --exclude='var/' \
  /var/www/social-ege/backend/ /opt/social-ege/backend/
sudo chown -R daria:daria /opt/social-ege/backend
sudo chmod 600 /opt/social-ege/backend/.env
cd /opt/social-ege/backend
npm ci --omit=dev
```

`npm ci` is required for a reproducible backend install even though this stage
adds no dependency.

## 3. Apply and verify the additive migration

```sh
cd /opt/social-ege/backend
npm run migrate
npm run schema:status
```

The status output must include both `student_study_plans` and
`study_schedule_events`, with `006_personal_study_plans.sql` applied. The
migration creates only these tables and their indexes; it does not delete or
rewrite existing learning data.

## 4. Publish the frontend allowlist

First confirm the active Nginx document root. The commands below assume the
currently used `/var/www/html`; replace it only with the already configured
document root. Do not recursively copy the repository and do not overwrite
`privacy.html` or `offer.html`.

```sh
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/index.html /var/www/html/index.html
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/cabinet.css /var/www/html/cabinet.css
sudo install -d -o www-data -g www-data -m 0755 /var/www/html/data /var/www/html/admin
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/data/course-topics.js /var/www/html/data/course-topics.js
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/admin/index.html /var/www/html/admin/index.html
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/admin/admin.css /var/www/html/admin/admin.css
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/admin/admin.js /var/www/html/admin/admin.js
```

## 5. Restart and smoke-test

```sh
sudo systemctl restart social-ege.service
sudo systemctl status social-ege.service --no-pager
sudo journalctl -u social-ege.service -n 80 --no-pager
curl --fail-with-body http://127.0.0.1:3000/health
curl --fail-with-body https://daria-ege.ru/api/health
curl --fail-with-body https://daria-ege.ru/api/auth/status
```

Then verify in a browser:

1. an unauthenticated `GET /api/learning/study-plan` returns 401;
2. an ordinary student cannot call any `/api/admin/*` plan route (403);
3. an admin can open one active student and preview a plan;
4. saving creates two lessons per topic and the expected deadlines;
5. the student sees the nearest lesson and deadline after a fresh login;
6. a student without a plan sees the neutral empty state;
7. moving, cancelling, restoring and replacing one future event works;
8. explicit recalculation preserves past events and submitted work;
9. existing progress, tests, homework, mocks and admin functions still work;
10. `privacy.html` and `offer.html` retain their production checksums.

No Nginx reload is required because routes stay under the existing `/api/`
proxy. Do not modify the upload directory or any production secret.
