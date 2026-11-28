#!/usr/bin/env bash
# Nightly backup of the database. Run from cron (see DEPLOY.md). Safe while the app is running.
#   - writes data/backups/chronomancer-<UTC time>.db using SQLite's online backup
#   - if BACKUP_BUCKET=<bucket name> is set in .env, also copies it to that Google Cloud Storage bucket
#   - keeps the newest 14 copies on the VM
set -euo pipefail
cd "$(dirname "$0")/.."

# A failure must be impossible to miss in the log (~/chronomancer-backup.log under cron):
#   grep FAILED ~/chronomancer-backup.log
trap 'echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) BACKUP FAILED at line ${LINENO}" >&2' ERR

stamp="$(date -u +%Y%m%d-%H%M%S)"
name="chronomancer-${stamp}.db"

# Inside the container the data folder is /data (it is ./data on the VM).
docker compose exec -T app python -m app.backup "/data/backups/${name}"
echo "backed up to data/backups/${name}"

# Copy it off the VM first, so that a problem tidying old files can never skip the off-site copy.
bucket="$(grep -E '^BACKUP_BUCKET=' .env 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r"'"'" || true)"
if [ -n "${bucket}" ]; then
  gcloud storage cp "data/backups/${name}" "gs://${bucket}/${name}"
  echo "copied to gs://${bucket}/${name}"
fi

# Keep the 14 newest copies. The container wrote these files as root, so your own login (and cron)
# cannot delete them; the tidy-up runs inside the container too. A failure is reported, never fatal.
docker compose exec -T app sh -c 'ls -1t /data/backups/chronomancer-*.db 2>/dev/null | tail -n +15 | xargs -r rm --' \
  || echo "warning: could not remove old backups (the new backup was made)"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup ok"
