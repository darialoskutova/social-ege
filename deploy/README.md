# Production deployment files

These files are versioned templates. They do not contain passwords, database
URLs, SSH keys or other secrets.

- `systemd/social-ege.service` runs the API as unprivileged user `daria`,
  reads the existing protected `.env` and restarts it only after failures.
- `nginx/social-ege-api.conf` is a snippet for the active Nginx `server {}`
  block. It proxies `/api/` to `127.0.0.1:3000` without changing the root page.
- `nginx/default-with-api.conf` preserves Ubuntu's standard `/var/www/html`
  document root and includes the API snippet.
- `scripts/audit-server.sh` performs read-only checks and never reads `.env`.
- `STAGE-1-RUNBOOK.md` records the exact staged checks and stop conditions.

Before installing either template on a server:

1. Save a dated copy of the active configuration.
2. Compare paths and the current Node binary location.
3. Run `sudo nginx -t` before every Nginx reload.
4. Verify the backend directly on localhost, then through `/api/health`.
5. Verify that `/api/health` returns the same healthy result through Nginx.

This stage does not deploy the frontend or alter the active document root. A
later frontend release must use an explicit public-file allowlist; never point
Nginx at the Git working tree or recursively copy the repository into web root.
