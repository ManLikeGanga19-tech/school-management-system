#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ShuleHQ — automated backup (Phase 5).
#
# Produces the SAME artifact format as the admin-dashboard backup, so
# backend/scripts/restore_backup.sh restores either one identically:
#
#     shulehq-backup-prod-<ts>.tar
#       ├── database.dump    pg_dump -Fc (compressed, selective restore)
#       ├── media.tar.gz     student documents
#       └── manifest.json    sha256 of each part + provenance
#
# Install (on the VPS):
#     sudo install -m 0755 backup-nightly.sh /usr/local/bin/shulehq-backup
#     sudo crontab -e   →   15 2 * * *  /usr/local/bin/shulehq-backup >> /var/log/shulehq-backup.log 2>&1
#
# Exits non-zero on ANY failure so cron/monitoring can alert. A backup that
# fails silently is worse than no backup at all.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/shulehq}"
BACKUP_DIR="${BACKUP_DIR:-${DEPLOY_DIR}/backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"        # nightly artifacts to retain locally
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"      # Sunday artifacts retained longer
PG_CONTAINER="${PG_CONTAINER:-sms-postgres}"
APP_CONTAINER="${APP_CONTAINER:-sms-backend}"
# Optional offsite push: an rclone remote such as "r2:shulehq-backups".
# Empty = local only (NOT sufficient on its own — the box is a single point of failure).
OFFSITE_REMOTE="${OFFSITE_REMOTE:-}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FAILED: $*"; exit 1; }

command -v docker >/dev/null || fail "docker not found"
[ -f "${DEPLOY_DIR}/.env" ] || fail "no ${DEPLOY_DIR}/.env"

# Read DB settings from the deployed env (never hardcode credentials here).
PGUSER=$(grep -E '^POSTGRES_USER=' "${DEPLOY_DIR}/.env" | tail -n1 | cut -d= -f2-)
PGDB=$(grep -E '^POSTGRES_DB=' "${DEPLOY_DIR}/.env" | tail -n1 | cut -d= -f2-)
PGUSER="${PGUSER:-postgres}"
PGDB="${PGDB:-shulehq}"

docker inspect "${PG_CONTAINER}" >/dev/null 2>&1 || fail "${PG_CONTAINER} not running"

TS="$(date -u +%Y%m%d-%H%M%S)"
NAME="shulehq-backup-prod-${TS}.tar"
WORK="$(mktemp -d /tmp/shulehq-backup-XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${BACKUP_DIR}"

log "starting backup ${NAME} (db=${PGDB} user=${PGUSER})"

# ── 1. Database ──────────────────────────────────────────────────────────────
docker exec -u postgres "${PG_CONTAINER}" \
  pg_dump -U "${PGUSER}" -d "${PGDB}" -Fc --no-owner --no-privileges -f /tmp/_bk.dump \
  || fail "pg_dump failed"

# Sanity BEFORE copying out: the archive must be readable and contain table
# data. pg_restore -l needs a seekable file, so verify it in place rather than
# through a pipe.
TDC=$(docker exec "${PG_CONTAINER}" pg_restore -l /tmp/_bk.dump 2>/dev/null \
      | grep -c 'TABLE DATA' || true)
[ "${TDC:-0}" -gt 0 ] || fail "dump contains no TABLE DATA — refusing to record a useless backup"

docker cp "${PG_CONTAINER}:/tmp/_bk.dump" "${WORK}/database.dump" >/dev/null \
  || fail "could not copy dump out of container"
docker exec "${PG_CONTAINER}" rm -f /tmp/_bk.dump || true
[ -s "${WORK}/database.dump" ] || fail "dump is empty"

# ── 2. Media (student documents) ─────────────────────────────────────────────
if docker inspect "${APP_CONTAINER}" >/dev/null 2>&1; then
  docker exec "${APP_CONTAINER}" sh -c 'tar czf - -C /app/media . 2>/dev/null' \
    > "${WORK}/media.tar.gz" || : # empty media dir is valid
  MEDIA_COUNT=$(docker exec "${APP_CONTAINER}" sh -c \
    'find /app/media -type f 2>/dev/null | wc -l' || echo 0)
else
  : > "${WORK}/media.tar.gz"; MEDIA_COUNT=0
fi
[ -f "${WORK}/media.tar.gz" ] || : > "${WORK}/media.tar.gz"

# ── 3. Manifest ──────────────────────────────────────────────────────────────
DB_SHA=$(sha256sum "${WORK}/database.dump" | cut -d' ' -f1)
MD_SHA=$(sha256sum "${WORK}/media.tar.gz" | cut -d' ' -f1)
HEAD=$(docker exec -u postgres "${PG_CONTAINER}" \
        psql -U "${PGUSER}" -d "${PGDB}" -tAc 'SELECT version_num FROM alembic_version;' 2>/dev/null | tr -d '[:space:]' || true)
PGVER=$(docker exec "${PG_CONTAINER}" pg_dump --version 2>/dev/null | head -c 120 || true)

cat > "${WORK}/manifest.json" <<JSON
{
  "product": "ShuleHQ",
  "artifact_version": 1,
  "environment": "prod",
  "source": "automated-nightly",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pg_dump_version": "${PGVER}",
  "alembic_head": "${HEAD}",
  "database": {
    "name": "${PGDB}",
    "table_data_count": ${TDC:-0},
    "dump_sha256": "${DB_SHA}",
    "dump_bytes": $(stat -c%s "${WORK}/database.dump")
  },
  "media": {
    "file_count": ${MEDIA_COUNT:-0},
    "sha256": "${MD_SHA}",
    "bytes": $(stat -c%s "${WORK}/media.tar.gz")
  }
}
JSON

# ── 4. Bundle (outer tar; the dump is already compressed) ────────────────────
tar cf "${BACKUP_DIR}/${NAME}" -C "${WORK}" database.dump media.tar.gz manifest.json \
  || fail "bundling failed"
SIZE=$(stat -c%s "${BACKUP_DIR}/${NAME}")
SHA=$(sha256sum "${BACKUP_DIR}/${NAME}" | cut -d' ' -f1)
log "artifact ${NAME} bytes=${SIZE} tables=${TDC} media=${MEDIA_COUNT} head=${HEAD}"
log "sha256 ${SHA}"

# ── 5. Offsite (optional but strongly recommended — 3-2-1) ───────────────────
if [ -n "${OFFSITE_REMOTE}" ]; then
  command -v rclone >/dev/null || fail "OFFSITE_REMOTE set but rclone not installed"
  rclone copy "${BACKUP_DIR}/${NAME}" "${OFFSITE_REMOTE}/" --no-traverse \
    || fail "offsite push to ${OFFSITE_REMOTE} failed"
  log "offsite copy pushed to ${OFFSITE_REMOTE}"
else
  log "WARNING: no OFFSITE_REMOTE configured — this copy lives only on this host"
fi

# ── 6. Retention ─────────────────────────────────────────────────────────────
# Keep the last KEEP_DAILY artifacts, plus Sunday artifacts up to KEEP_WEEKLY.
cd "${BACKUP_DIR}"
mapfile -t ALL < <(ls -1t shulehq-backup-prod-*.tar 2>/dev/null || true)
KEEP=()
for f in "${ALL[@]:0:${KEEP_DAILY}}"; do KEEP+=("$f"); done
WEEKLIES=0
for f in "${ALL[@]}"; do
  d="${f#shulehq-backup-prod-}"; d="${d%%-*}"
  if [ "$(date -d "${d}" +%u 2>/dev/null || echo 0)" = "7" ] && [ "${WEEKLIES}" -lt "${KEEP_WEEKLY}" ]; then
    KEEP+=("$f"); WEEKLIES=$((WEEKLIES+1))
  fi
done
for f in "${ALL[@]}"; do
  keep=false
  for k in "${KEEP[@]}"; do [ "$f" = "$k" ] && keep=true && break; done
  if [ "${keep}" = false ]; then rm -f -- "$f"; log "pruned ${f}"; fi
done

log "backup complete: ${BACKUP_DIR}/${NAME}"
