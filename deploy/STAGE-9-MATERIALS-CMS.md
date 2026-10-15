# Stage 9: materials CMS and test-attempt details

This document is a deployment runbook only. The release is not deployed by
Codex. It adds the additive migration `008_materials_cms.sql` and one new
private runtime directory; it does not modify legal pages.

Before restart, create the private directory and install the updated systemd
drop-in:

```sh
sudo install -d -m 0700 -o daria -g daria /opt/social-ege/var/materials
sudo install -m 0644 deploy/systemd/social-ege-uploads.conf \
  /etc/systemd/system/social-ege.service.d/uploads.conf
sudo systemctl daemon-reload
```

The code has safe production defaults:

```text
MATERIAL_STORAGE_DIR=/opt/social-ege/var/materials
MATERIAL_LEGACY_ROOT=/var/www/social-ege
MATERIAL_MAX_BYTES=26214400
```

Explicitly adding these values to the protected production `.env` is optional.
Never print or commit that file. Install backend files with the existing
allowlisted process, run `npm ci`, `npm run migrate`, `npm run schema:status`,
and restart `social-ege.service`. Publish only `index.html` plus the three
files in `admin/`; do not overwrite `privacy.html` or `offer.html`.

After deployment verify `/api/health`, an anonymous 401 for
`/api/learning/materials`, a student list/download, admin create/replace/hide,
and that no URL can address `/opt/social-ege/var/materials` directly.
