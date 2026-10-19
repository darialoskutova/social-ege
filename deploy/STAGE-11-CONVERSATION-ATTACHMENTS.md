# Stage 11: conversation attachments

This is a deployment runbook only. Stage 11 is not deployed by Codex.

The release adds the additive migration `010_conversation_attachments.sql` and
one private persistent storage directory. It does not change authentication,
Materials CMS records, tests, study plans, legal pages or existing Stage 10
message contents.

## Runtime storage

Create the directory outside the Nginx document root:

```sh
sudo install -d -m 0700 -o daria -g daria \
  /opt/social-ege/var/conversation-attachments
```

The production-safe code defaults are:

```text
CONVERSATION_ATTACHMENT_STORAGE_DIR=/opt/social-ege/var/conversation-attachments
CONVERSATION_ATTACHMENT_MAX_BYTES=10485760
```

Adding these values to the protected production `.env` is optional. Never
print, copy to Git or overwrite that file. The backend service runs as
`daria:daria`, so the directory must remain owned by that user and mode `0700`.

Install the reviewed systemd drop-in so the hardened service can write only to
the three intended private storage directories:

```sh
sudo install -m 0644 deploy/systemd/social-ege-uploads.conf \
  /etc/systemd/system/social-ege.service.d/uploads.conf
sudo systemctl daemon-reload
```

The active Nginx `/api/` limit is already `15m`. Stage 11 deliberately keeps
attachments at 10 MiB, so Nginx must not be loosened. Do not add an Nginx
`alias`, `root` or static location for the attachment directory.

## Required backups

Before any mutation, stop if any backup or validation fails. Create and verify:

1. a PostgreSQL custom-format dump, followed by `pg_restore --list`;
2. `/var/www/social-ege`;
3. `/opt/social-ege/backend`, including preserved `.env` metadata;
4. `/opt/social-ege/var/uploads`;
5. `/opt/social-ege/var/materials`;
6. `/opt/social-ege/var/conversation-attachments` when it already exists;
7. active Nginx and systemd files;
8. production-only `privacy.html`, `offer.html`, `daria.png` and `dasha2.png`.

Record hashes for the legal pages, production photographs, `.env`, Nginx and
systemd files. Keep the backup outside the application checkout.

## Clean release deployment

Do not use `git pull`, `git reset` or `git clean` in the dirty/diverged
production checkout. Fetch and export the exact reviewed commit into a new
clean release directory.

Before mutation, run the complete test suite from that release and verify the
expected files:

- `backend/migrations/010_conversation_attachments.sql`;
- `backend/conversations/attachments.js`;
- the updated backend routers and conversation service;
- `index.html`, `cabinet.css` and the three files under `admin/`;
- `deploy/systemd/social-ege-uploads.conf`.

Install backend files while preserving `/opt/social-ege/backend/.env`, then:

```sh
sudo -u daria npm --prefix /opt/social-ege/backend ci --omit=dev --no-audit --no-fund
sudo -u daria npm --prefix /opt/social-ege/backend run migrate
sudo -u daria npm --prefix /opt/social-ege/backend run schema:status
```

The migration runner must report exactly one of:

```text
applied: 010_conversation_attachments.sql
already applied: 010_conversation_attachments.sql
```

Restart `social-ege.service` only after migration and schema verification
succeed. Retry direct and public health checks for several seconds rather than
using one immediate request. Publish only the reviewed Stage 11 frontend files;
do not overwrite `.env`, `privacy.html`, `offer.html` or production photos.

## Smoke checks

Use dedicated non-production student data, never a real student's work.

1. direct `/health` and public `/api/health` return 200;
2. `/` and `/admin/` return 200;
3. anonymous attachment upload/download returns 401;
4. student uploads PDF, DOCX, JPEG and PNG to own homework conversation;
5. file-only and text-plus-file messages both appear in history and Inbox;
6. student cannot upload to or download from another student's homework,
   thematic mock or test attempt;
7. admin can download the student's attachment and send a reply attachment;
8. student can download the teacher attachment;
9. download response has `Cache-Control: private, no-store`, correct
   `Content-Type` and safe `Content-Disposition`;
10. fake signatures, MIME mismatch, unsupported type, path traversal and a file
    above 10 MiB are rejected without message or file residue;
11. download alone does not mark a conversation read;
12. existing Stage 10 messages still render with an empty attachments list;
13. direct public requests for
    `/opt/social-ege/var/conversation-attachments/` return 404;
14. Inbox, Students, Schedule, Test editor, Materials and Study plan still work;
15. mobile layouts at 390 px have no horizontal overflow for long filenames.

After smoke tests, compare the count of filesystem objects with attachment
rows and investigate any mismatch before accepting the release.

## Rollback

If code installation, restart or smoke checks fail, restore frontend, backend,
systemd files and the previous release marker from the fresh backup, preserve
the production `.env`, run `systemctl daemon-reload`, restart the service and
repeat health checks.

Migration 010 is additive and compatible with the Stage 10 backend, so it may
remain applied during a file rollback. Do not delete its table or storage
objects manually. If the deployment accepted any test attachment before
rollback, retain both its database row and private object until an explicit,
audited cleanup is reviewed.
