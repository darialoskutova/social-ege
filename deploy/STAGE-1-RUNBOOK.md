# Stage 1 runbook: backend → systemd → Nginx

This runbook intentionally does not change SSH, UFW or PostgreSQL settings. It
does not read, print, copy or replace `/opt/social-ege/backend/.env`.

The guarded automated form of these steps is
`deploy/scripts/apply-stage-1.sh`. Run it as `daria` from the repository root;
it will ask for sudo normally and stop before a risky or unexpected state.

Run it only after comparing the active server files with the versioned files.
All health checks must pass before moving to the next section.

## 1. Backend source

From `/var/www/social-ege`, update the repository using a fast-forward-only
pull. Confirm that `.env` is still mode `0600` and owned by `daria` by using
`stat`; never use `cat`, `less`, `grep` or `env` on it.

Create a dated backup directory and copy only the current source and package
manifests there. Then install these versioned files without touching `.env`:

```sh
sudo install -o daria -g daria -m 0644 backend/server.js /opt/social-ege/backend/server.js
sudo install -o daria -g daria -m 0644 backend/package.json /opt/social-ege/backend/package.json
sudo install -o daria -g daria -m 0644 backend/package-lock.json /opt/social-ege/backend/package-lock.json
sudo -u daria npm --prefix /opt/social-ege/backend ci --omit=dev
```

Verify syntax and the existing local database-backed endpoint:

```sh
sudo -u daria node --check /opt/social-ege/backend/server.js
curl --fail-with-body --max-time 5 http://127.0.0.1:3000/health
```

If a manually started Node process owns port 3000, stop that foreground process
cleanly before enabling systemd. Do not kill unrelated processes.

## 2. systemd

Install and verify the versioned unit:

```sh
sudo install -o root -g root -m 0644 deploy/systemd/social-ege.service /etc/systemd/system/social-ege.service
sudo systemd-analyze verify /etc/systemd/system/social-ege.service
sudo systemctl daemon-reload
sudo systemctl enable --now social-ege.service
sudo systemctl --no-pager --full status social-ege.service
sudo journalctl -u social-ege.service -n 50 --no-pager
curl --fail-with-body --max-time 5 http://127.0.0.1:3000/health
```

The expected result is `active (running)` and `{"ok":true}`. Do not continue if
the unit restarts repeatedly or the direct health check fails.

## 3. Nginx `/api/`

First save a dated copy of the active default site. Install the snippet and the
reviewed standard-page server block:

```sh
sudo install -o root -g root -m 0644 deploy/nginx/social-ege-api.conf /etc/nginx/snippets/social-ege-api.conf
sudo install -o root -g root -m 0644 deploy/nginx/default-with-api.conf /etc/nginx/sites-available/default
sudo nginx -t
```

Only if `nginx -t` succeeds:

```sh
sudo systemctl reload nginx
curl --fail-with-body --max-time 5 http://127.0.0.1/api/health
curl --fail-with-body --max-time 5 http://135.106.228.88/api/health
```

Expected response for both URLs: `{"ok":true}`. The root URL must continue to
show the same standard Nginx page as before this stage.

## Stop condition

Do not start authentication or frontend API integration until all three health
checks succeed:

1. `127.0.0.1:3000/health`;
2. `127.0.0.1/api/health`;
3. `135.106.228.88/api/health`.
