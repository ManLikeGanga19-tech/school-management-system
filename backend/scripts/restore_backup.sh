#!/usr/bin/env bash
#
# ShuleHQ — restore a backup artifact produced by the admin Backups feature.
#
# Restores INTO A TARGET YOU NAME — never blindly over production. Use this
# for the monthly restore drill (docs/ops/BACKUP_RESTORE_RUNBOOK.md §7) and
# for real recovery.
#
# Usage:
#   ./restore_backup.sh <artifact.tar> <target_db_url> [media_dest_dir]
#
# Example (drill into a scratch DB):
#   ./restore_backup.sh shulehq-backup-production-20260722-1400.tar \
#       "postgresql://user:pass@localhost:5432/shulehq_restore_test" \
#       /tmp/media-restore
#
# Requires: postgresql-client-18 (pg_restore), tar, sha256sum.
set -euo pipefail

ARTIFACT="${1:?path to backup .tar required}"
TARGET_URL="${2:?target database URL required}"
MEDIA_DEST="${3:-./restored-media}"

[ -f "$ARTIFACT" ] || { echo "ERROR: artifact not found: $ARTIFACT" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Unpacking bundle"
tar xf "$ARTIFACT" -C "$WORK"
[ -f "$WORK/database.dump" ] || { echo "ERROR: database.dump missing from bundle" >&2; exit 1; }
[ -f "$WORK/manifest.json" ] && { echo "==> Manifest:"; cat "$WORK/manifest.json"; echo; }

echo "==> Verifying dump integrity against manifest SHA-256"
if command -v python3 >/dev/null 2>&1 && [ -f "$WORK/manifest.json" ]; then
  EXPECTED="$(python3 -c "import json,sys;print(json.load(open('$WORK/manifest.json'))['database']['dump_sha256'])")"
  ACTUAL="$(sha256sum "$WORK/database.dump" | awk '{print $1}')"
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "ERROR: dump checksum mismatch — artifact is corrupt. Aborting." >&2
    echo "  expected $EXPECTED" >&2; echo "  actual   $ACTUAL" >&2
    exit 1
  fi
  echo "    checksum OK"
fi

echo "==> Restoring database into target (clean, no-owner)"
# --clean --if-exists so the target can be re-restored idempotently in drills.
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$TARGET_URL" "$WORK/database.dump"

echo "==> Restoring student documents → $MEDIA_DEST"
mkdir -p "$MEDIA_DEST"
if [ -f "$WORK/media.tar.gz" ]; then
  tar xzf "$WORK/media.tar.gz" -C "$MEDIA_DEST"
  echo "    $(find "$MEDIA_DEST" -type f | wc -l) file(s) restored"
fi

echo
echo "==> DONE. Now run the drill acceptance checklist (runbook §7):"
echo "    - row-count sanity on tenants/students/invoices/payments"
echo "    - a tenant can log in against the restored DB"
echo "    - an invoice PDF generates and its QR verifies"
echo "    - alembic head matches production"
