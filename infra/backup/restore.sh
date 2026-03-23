#!/usr/bin/env bash
# =============================================================================
# infra/backup/restore.sh
#
# Restore a ShuleHQ database from a pg_dump backup.
#
# IMPORTANT
# ---------
# This DROPS and RECREATES the target database — all existing data is lost.
# Run this only on a deliberate restore operation.  Test restores regularly
# on a staging environment to confirm backups are valid.
#
# Usage
# -----
#   # Restore from a local file:
#   ./restore.sh /var/backups/sms/daily_20260320_020000.sql.gz
#
#   # Restore from R2/S3 (downloads first, then restores):
#   ./restore.sh s3://sms-backups/daily_20260320_020000.sql.gz
#
# Environment variables (same as backup.sh)
# ------------------------------------------
#   POSTGRES_CONTAINER   default: sms-postgres
#   POSTGRES_DB          default: school_manager_db
#   POSTGRES_USER        default: postgres
#   POSTGRES_PASSWORD    default: ""
#
# For S3 downloads:
#   BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_KEY_ID, BACKUP_S3_SECRET
# =============================================================================

set -euo pipefail

# ── Load env file ─────────────────────────────────────────────────────────────
_ENV_FILE="${BACKUP_ENV_FILE:-/opt/sms/backup/.env}"
if [[ -f "$_ENV_FILE" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$_ENV_FILE"
    set +a
fi

CONTAINER="${POSTGRES_CONTAINER:-sms-postgres}"
DB="${POSTGRES_DB:-school_manager_db}"
USER="${POSTGRES_USER:-postgres}"
PASSWORD="${POSTGRES_PASSWORD:-}"

S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
S3_REGION="${BACKUP_S3_REGION:-auto}"
S3_KEY_ID="${BACKUP_S3_KEY_ID:-}"
S3_SECRET="${BACKUP_S3_SECRET:-}"

log()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [restore] $*"; }
fail() { log "ERROR: $*"; exit 1; }

# ── Argument ──────────────────────────────────────────────────────────────────
SOURCE="${1:-}"
[[ -z "$SOURCE" ]] && fail "Usage: $0 <backup-file.sql.gz | s3://bucket/key>"

# ── Safety prompt ─────────────────────────────────────────────────────────────
log "═══════════════════════════════════════════════════════"
log "  TARGET DATABASE : $DB  (container: $CONTAINER)"
log "  SOURCE          : $SOURCE"
log "  WARNING: ALL EXISTING DATA IN '$DB' WILL BE LOST"
log "═══════════════════════════════════════════════════════"
read -r -p "Type 'yes' to continue: " CONFIRM
[[ "$CONFIRM" == "yes" ]] || { log "Aborted."; exit 0; }

# ── PGPASSWORD helper ─────────────────────────────────────────────────────────
if [[ -n "$PASSWORD" ]]; then
    PG_ENV=(-e "PGPASSWORD=$PASSWORD")
else
    PG_ENV=()
fi

# ── Resolve source file ───────────────────────────────────────────────────────
TMPFILE=""

if [[ "$SOURCE" == s3://* ]]; then
    log "Downloading from $SOURCE …"
    TMPFILE=$(mktemp /tmp/sms-restore-XXXXXXXX.sql.gz)
    trap 'rm -f "$TMPFILE"' EXIT

    BUCKET_KEY="${SOURCE#s3://}"
    BUCKET="${BUCKET_KEY%%/*}"
    KEY="${BUCKET_KEY#*/}"

    ENDPOINT_FLAG=()
    [[ -n "$S3_ENDPOINT" ]] && ENDPOINT_FLAG=(--endpoint-url "$S3_ENDPOINT")

    AWS_ACCESS_KEY_ID="$S3_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$S3_SECRET" \
        aws s3 cp "$SOURCE" "$TMPFILE" \
            "${ENDPOINT_FLAG[@]}" \
            --region "$S3_REGION" \
            --no-progress \
        || fail "Download failed"

    LOCAL_FILE="$TMPFILE"
    log "Downloaded to $TMPFILE"
else
    [[ -f "$SOURCE" ]] || fail "File not found: $SOURCE"
    LOCAL_FILE="$SOURCE"
fi

SIZE=$(du -sh "$LOCAL_FILE" | cut -f1)
log "Restoring from $LOCAL_FILE ($SIZE) …"

# ── Confirm container is running ──────────────────────────────────────────────
docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null \
    | grep -q '^running$' \
    || fail "Container '$CONTAINER' is not running"

# ── Drop + recreate the database ──────────────────────────────────────────────
log "Dropping existing database …"
docker exec "${PG_ENV[@]}" "$CONTAINER" \
    psql -U "$USER" -d postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid <> pg_backend_pid();" \
    -c "DROP DATABASE IF EXISTS \"$DB\";" \
    -c "CREATE DATABASE \"$DB\" OWNER \"$USER\";" \
    || fail "Failed to drop/recreate database"

# ── Restore ───────────────────────────────────────────────────────────────────
log "Restoring data (this may take a few minutes) …"
gunzip -c "$LOCAL_FILE" \
    | docker exec -i "${PG_ENV[@]}" "$CONTAINER" \
        psql -U "$USER" -d "$DB" --no-password -q \
    || fail "psql restore failed"

log "Restore complete ✓"
log ""
log "Next steps:"
log "  1. Restart the backend container to reconnect its pool:"
log "       docker compose -f docker-compose.prod.yml restart backend"
log "  2. Verify the application is working correctly."
