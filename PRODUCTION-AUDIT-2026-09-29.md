# Production audit — 29 September 2026

This report contains no passwords, keys, connection strings or `.env` values.

## Verified from the local repository

- The working tree was clean at the start of the audit at commit `6946b64`.
- The repository is primarily a static frontend and had no versioned Node.js
  backend, database migrations, systemd unit or Nginx site configuration.
- Authentication, test attempts, homework metadata and messages are still
  stored in `localStorage`/`sessionStorage`; no frontend API integration is in
  place yet.
- `data/tests-score-hashes.js` contains `acceptedAnswers`, so correct answers
  are currently shipped to every browser and must not be used as a trusted
  scoring source.
- The repository contains 90 PDF files and 104 DOCX files. Publishing the Git
  checkout as an Nginx document root would expose course materials directly.
- No tracked `.env`, private key or `private-data` path was found in the current
  tree. Existing `.gitignore` rules did not yet cover backend runtime files.

## Verified from the public IP

- `http://135.106.228.88/` returns HTTP 200 from Nginx 1.24.0 and currently
  shows the default Nginx page rather than the project frontend.
- `http://135.106.228.88/api/health` did not return a response within 15
  seconds, so the reverse proxy/backend path is not healthy from outside.

## Not yet verifiable

SSH from the current automation environment with the local
`~/.ssh/id_ed25519` key was rejected by the server. The owner separately
confirmed that the same command works from her interactive terminal, so this
is treated as an environment limitation and no SSH settings are to be changed.
For that reason this audit could not directly verify:

- `curl http://127.0.0.1:3000/health` on the VDS;
- PostgreSQL connectivity, version, database and role state;
- UFW rules and whether PostgreSQL listens only locally;
- Nginx active site contents and `nginx -t`;
- `/opt/social-ege/backend` ownership, `.env` mode and installed packages;
- existing systemd services and logs;
- `/var/www/social-ege` status and its checked-out commit.

No server configuration was changed while these checks were unavailable.

## Safe staged plan

1. Restore key-based SSH for user `daria`, then complete the read-only audit.
2. Version the existing minimal backend and deployment templates without
   secrets; keep authentication and data migrations for a later stage.
3. Compare the versioned backend with `/opt/social-ege/backend`; preserve its
   `.env` and make a dated backup before replacing source files.
4. Install and verify the systemd service as unprivileged user `daria`.
5. Assemble an allowlisted static release outside the Git checkout; validate
   Nginx before reload and proxy only `/api/` to localhost.
6. Enable HTTPS before using real accounts or personal data.
7. After infrastructure health is verified, move scoring, student data and protected-file delivery behind authenticated
   API endpoints, one frontend function at a time without redesigning pages.
8. Run localhost, Nginx and role-isolation smoke tests. Reboot only after an
   explicit maintenance window is confirmed.

## Stage 1 result — 30 September 2026

- `social-ege.service` is enabled and active under user `daria`.
- The backend listens on `127.0.0.1:3000` and its database-backed `/health`
  endpoint returns `{"ok":true}`.
- Public `http://135.106.228.88/api/health` returns HTTP 200 through Nginx.
- Direct public access to port 3000 times out, while PostgreSQL and firewall
  settings were not changed.
- The root page still returns the same standard Nginx file; its checksum was
  unchanged across the rollout.
