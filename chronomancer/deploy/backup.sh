#!/usr/bin/env bash
# Nightly backup of the database. Run from cron (see DEPLOY.md). Safe while the app is running.
#   - writes data/backups/chronomancer-<UTC time>.db using SQLite's online backup
#   - keeps the newest 14 copies on the VM
#   - if BACKUP_BUCKET=<bucket name> is set in .env, also copies it to that Google Cloud Storage bucket
set -euo pipefail
cd "$(dirname "$0")/.."

stamp="$(date -u +%Y%m%d-%H%M%S)"
name="chronomancer-${stamp}.db"

# Inside the container the data folder is /data (it is ./data on the VM).
docker compose exec -T app python -m app.backup "/data/backups/${name}"
echo "backed up to data/backups/${name}"

# Keep the 14 newest copies.
ls -1t data/backups/chronomancer-*.db 2>/dev/null | tail -n +15 | xargs -r rm --

bucket="$(grep -E '^BACKUP_BUCKET=' .env 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r"'"'" || true)"
if [ -n "${bucket}" ]; then
  gcloud storage cp "data/backups/${name}" "gs://${bucket}/${name}"
  echo "copied to gs://${bucket}/${name}"
fi
