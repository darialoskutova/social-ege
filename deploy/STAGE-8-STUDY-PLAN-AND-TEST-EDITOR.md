# Stage 8: study-plan fixes and protected test editor

This release is not deployed automatically. It adds additive migration
`007_editable_tests.sql`, server-side test definitions and answer keys, test
versioning/scoring, the admin editor, and the final study-plan recalculation
fixes. It requires no new environment variable or package dependency.

The public legal pages must not be overwritten. Never recursively copy the Git
checkout into `/var/www/html`.

## 1. Preflight and backups

Replace `EXPECTED_COMMIT` with the reviewed commit hash from the release note.

```sh
cd /var/www/social-ege
git status --short
git fetch origin main
git log --oneline --decorate -5 origin/main
sudo systemctl is-active social-ege.service
curl --fail-with-body https://daria-ege.ru/api/health

release_stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d -m 0700 -o daria -g daria "/opt/social-ege/backups/stage8-${release_stamp}"
sudo -u postgres pg_dump -Fc social_ege > "/tmp/social-ege-before-stage8-${release_stamp}.dump"
sudo mv "/tmp/social-ege-before-stage8-${release_stamp}.dump" "/opt/social-ege/backups/stage8-${release_stamp}/database.dump"
sudo cp -a /opt/social-ege/backend "/opt/social-ege/backups/stage8-${release_stamp}/backend"
sudo cp -a /var/www/html/index.html /var/www/html/cabinet.css /var/www/html/frontend-state.js /var/www/html/admin "/opt/social-ege/backups/stage8-${release_stamp}/"
sudo install -d -m 0700 -o daria -g daria "/opt/social-ege/backups/stage8-${release_stamp}/obsolete-public-test-data"
sudo cp -a /var/www/html/data/course-topics.js "/opt/social-ege/backups/stage8-${release_stamp}/course-topics.js"
for public_test_asset in tests-public.js tests-score-hashes.js; do
  if [ -f "/var/www/html/data/${public_test_asset}" ]; then
    sudo cp -a "/var/www/html/data/${public_test_asset}" "/opt/social-ege/backups/stage8-${release_stamp}/obsolete-public-test-data/"
  fi
done
privacy_before=$(sha256sum /var/www/html/privacy.html | cut -d' ' -f1)
offer_before=$(sha256sum /var/www/html/offer.html | cut -d' ' -f1)
```

Stop if the checkout is dirty, the service is unhealthy or a backup fails. Do
not display or copy `/opt/social-ege/backend/.env`.

## 2. Pull and verify the reviewed source

```sh
cd /var/www/social-ege
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "EXPECTED_COMMIT"

cd /var/www/social-ege/backend
sudo -u daria npm ci --no-audit --no-fund
sudo -u daria npm test
```

## 3. Install backend and apply the additive migration

The exclusions preserve the protected environment, installed dependencies and
private uploaded files.

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

The migration adds `editable_tests`, `editable_test_versions`,
`test_attempts.test_version` and `test_attempts.result_snapshot`. It does not
drop, truncate, delete or rewrite existing attempts, progress or submissions.

## 4. Publish only the changed frontend files

```sh
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/index.html /var/www/html/index.html
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/cabinet.css /var/www/html/cabinet.css
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/frontend-state.js /var/www/html/frontend-state.js
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/data/course-topics.js /var/www/html/data/course-topics.js
sudo install -d -o www-data -g www-data -m 0755 /var/www/html/admin
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/admin/index.html /var/www/html/admin/index.html
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/admin/admin.css /var/www/html/admin/admin.css
sudo install -o www-data -g www-data -m 0644 /var/www/social-ege/admin/admin.js /var/www/html/admin/admin.js

sudo rm -f -- /var/www/html/data/tests-public.js /var/www/html/data/tests-score-hashes.js

test "$(sha256sum /var/www/html/privacy.html | cut -d' ' -f1)" = "$privacy_before"
test "$(sha256sum /var/www/html/offer.html | cut -d' ' -f1)" = "$offer_before"
```

The two explicit removals delete only obsolete public copies. Definitions and
answer keys are now installed under `/opt/social-ege/backend/tests` and are not
inside the Nginx document root.

## 5. Post-deploy checks

```sh
curl --fail-with-body http://127.0.0.1:3000/health
curl --fail-with-body https://daria-ege.ru/api/health
curl --fail-with-body https://daria-ege.ru/api/auth/status
test "$(curl -sS -o /dev/null -w '%{http_code}' https://daria-ege.ru/data/tests-score-hashes.js)" = "404"
test "$(curl -sS -o /dev/null -w '%{http_code}' https://daria-ege.ru/data/tests-public.js)" = "404"
sudo journalctl -u social-ege.service -n 100 --no-pager
```

Then verify with an admin and a student account:

1. `/admin` lists all 56 tests and search works by number and title;
2. a student receives 403 from `/api/admin/tests/test-01`;
3. save one harmless text correction, reopen it, and confirm the new version;
4. a new student attempt uses the edited key while an older stored attempt is unchanged;
5. changing the plan start topic makes it the first future lesson, part 1;
6. changing weekdays continues from the current future lesson;
7. recalculation from a selected date preserves all earlier events and creates no duplicates;
8. the topic tabs remain clickable and show no decorative circles;
9. all 42 configured lesson-note URLs return HTTP 200, including topics 33 and 34;
10. `privacy.html` and `offer.html` checksums still match their pre-deploy values.
