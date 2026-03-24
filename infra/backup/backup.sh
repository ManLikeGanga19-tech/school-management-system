#!/usr/bin/env bash
# =============================================================================
# infra/backup/backup.sh
#
# PostgreSQL backup for the ShuleHQ SMS backend.
#
# What it does
# ------------
# 1. Runs pg_dump inside the running postgres Docker container.
# 2. Compresses the dump with gzip (level 9).
# 3. Saves to a local directory with daily/weekly/monthly rotation.
# 4. Optionally uploads to any S3-compatible bucket (Cloudflare R2,
#    Backblaze B2, AWS S3, etc.) if BACKUP_S3_BUCKET is set.
# 5. Optionally sends a failure alert via ntfy.sh if BACKUP_NTFY_TOPIC is set.
#
# Retention policy (defaults)
# ---------------------------
#   Daily   → last 7   (one week of daily point-in-time recovery)
#   Weekly  → last 4   (one month of weekly snapshots)
#   Monthly → last 3   (one quarter of monthly archives)
#   Tier is determined by the calendar day:
#     - 1st of month  → monthly
#     - Sunday        → weekly
#     - Otherwise     → daily
#
# Usage
# -----
#   ./backup.sh                       # uses defaults
#   source /opt/sms/.env && ./backup.sh
#
# Required environment variables
# --------------------------------
#   POSTGRES_CONTAINER   Docker container name (default: sms-postgres)
#   POSTGRES_DB          Database name        (default: school_manager_db)
#   POSTGRES_USER        DB superuser         (default: postgres)
#   POSTGRES_PASSWORD    DB password          (default: "")
#
# Optional — local storage
# -------------------------
#   BACKUP_DIR           Local directory for dumps (default: /var/backups/sms)
#   BACKUP_KEEP_DAILY    Days of daily backups to keep   (default: 7)
#   BACKUP_KEEP_WEEKLY   Weeks of weekly backups to keep (default: 4)
#   BACKUP_KEEP_MONTHLY  Months of archives to keep      (default: 3)
#
# Optional — offsite upload (Cloudflare R2 / Backblaze B2 / AWS S3)
# ------------------------------------------------------------------
#   BACKUP_S3_BUCKET     e.g. sms-backups
#   BACKUP_S3_ENDPOINT   e.g. https://<account_id>.r2.cloudflarestorage.com
#   BACKUP_S3_REGION     e.g. auto  (R2) | us-east-1 (S3) | us-west-000 (B2)
#   BACKUP_S3_KEY_ID     Access key ID
#   BACKUP_S3_SECRET     Secret access key
#
# Optional — failure alerts (free, no account needed)
# ----------------------------------------------------
#   BACKUP_NTFY_TOPIC    ntfy.sh topic, e.g. sms-backup-alerts
#                        Alerts are sent to: https://ntfy.sh/$BACKUP_NTFY_TOPIC
# =============================================================================

set -euo pipefail

# ── Load env file ─────────────────────────────────────────────────────────────
# Auto-source /opt/sms/backup/.env when it exists so the script works correctly
# whether invoked directly, via cron, or via sudo bash -c '...'.
# set -a exports every variable assignment so child processes inherit them.
_ENV_FILE="${BACKUP_ENV_FILE:-/opt/sms/backup/.env}"
if [[ -f "$_ENV_FILE" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$_ENV_FILE"
    set +a
fi

# ── Configuration ─────────────────────────────────────────────────────────────
CONTAINER="${POSTGRES_CONTAINER:-sms-postgres}"
DB="${POSTGRES_DB:-school_manager_db}"
USER="${POSTGRES_USER:-postgres}"
PASSWORD="${POSTGRES_PASSWORD:-}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/sms}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-3}"

S3_BUCKET="${BACKUP_S3_BUCKET:-}"
S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
S3_REGION="${BACKUP_S3_REGION:-auto}"
S3_KEY_ID="${BACKUP_S3_KEY_ID:-}"
S3_SECRET="${BACKUP_S3_SECRET:-}"

NTFY_TOPIC="${BACKUP_NTFY_TOPIC:-}"

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [backup] $*"; }
fail() {
    log "ERROR: $*"
    if [[ -n "$NTFY_TOPIC" ]]; then
        curl -s -X POST "https://ntfy.sh/${NTFY_TOPIC}" \
            -H "Title: ShuleHQ backup FAILED" \
            -H "Priority: high" \
            -H "Tags: x,rotating_light" \
            -d "pg_dump failed on $(hostname) at $(date -u '+%Y-%m-%dT%H:%M:%SZ'): $*" \
            >/dev/null || true
    fi
    exit 1
}

# ── Determine backup tier ──────────────────────────────────────────────────────
DOM=$(date +%d)   # day of month: 01-31
DOW=$(date +%u)   # day of week:  1=Mon … 7=Sun

if [[ "$DOM" == "01" ]]; then
    TIER="monthly"
elif [[ "$DOW" == "7" ]]; then
    TIER="weekly"
else
    TIER="daily"
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="${TIER}_${TIMESTAMP}.sql.gz"
FILEPATH="$BACKUP_DIR/$FILENAME"

# ── Pre-flight ────────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

# Confirm the container is running before attempting the dump.
docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null | grep -q '^running$' \
    || fail "Container '$CONTAINER' is not running"

# ── Dump ──────────────────────────────────────────────────────────────────────
log "Starting $TIER backup → $FILENAME"

if [[ -n "$PASSWORD" ]]; then
    PGPASSWORD_ENV=(-e "PGPASSWORD=$PASSWORD")
else
    PGPASSWORD_ENV=()
fi

docker exec "${PGPASSWORD_ENV[@]}" "$CONTAINER" \
    pg_dump -U "$USER" -d "$DB" --no-password \
    | gzip -9 > "$FILEPATH" \
    || fail "pg_dump failed — check container logs: docker logs $CONTAINER"

SIZE=$(du -sh "$FILEPATH" | cut -f1)
log "Dump written: $FILEPATH ($SIZE)"

# ── Offsite upload ────────────────────────────────────────────────────────────
if [[ -n "$S3_BUCKET" ]]; then
    log "Uploading to s3://$S3_BUCKET/$FILENAME …"

    # Build endpoint flag only when a custom endpoint is set (R2, B2, MinIO).
    ENDPOINT_FLAG=()
    [[ -n "$S3_ENDPOINT" ]] && ENDPOINT_FLAG=(--endpoint-url "$S3_ENDPOINT")

    AWS_ACCESS_KEY_ID="$S3_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$S3_SECRET" \
        aws s3 cp "$FILEPATH" "s3://$S3_BUCKET/$FILENAME" \
            "${ENDPOINT_FLAG[@]}" \
            --region "$S3_REGION" \
            --no-progress \
            --only-show-errors \
        || fail "Upload to s3://$S3_BUCKET/$FILENAME failed"

    log "Upload complete"

    # Prune remote copies by tier.
    _prune_remote() {
        local tier=$1 keep=$2
        log "Pruning remote $tier backups — keeping newest $keep …"
        AWS_ACCESS_KEY_ID="$S3_KEY_ID" \
        AWS_SECRET_ACCESS_KEY="$S3_SECRET" \
            aws s3 ls "s3://$S3_BUCKET/" \
                "${ENDPOINT_FLAG[@]}" \
                --region "$S3_REGION" \
            | awk '{print $4}' \
            | grep "^${tier}_" \
            | sort \
            | head -n -"$keep" \
            | while read -r key; do
                log "  deleting s3://$S3_BUCKET/$key"
                AWS_ACCESS_KEY_ID="$S3_KEY_ID" \
                AWS_SECRET_ACCESS_KEY="$S3_SECRET" \
                    aws s3 rm "s3://$S3_BUCKET/$key" \
                        "${ENDPOINT_FLAG[@]}" \
                        --region "$S3_REGION" \
                        --only-show-errors
              done
    }

    _prune_remote "daily"   "$KEEP_DAILY"
    _prune_remote "weekly"  "$KEEP_WEEKLY"
    _prune_remote "monthly" "$KEEP_MONTHLY"
fi

# ── Local rotation ────────────────────────────────────────────────────────────
_prune_local() {
    local tier=$1 keep=$2
    # ls -1t = newest first; tail skips the newest $keep; remainder gets deleted.
    mapfile -t stale < <(
        ls -1t "$BACKUP_DIR"/${tier}_*.sql.gz 2>/dev/null \
        | tail -n +"$((keep + 1))"
    )
    for f in "${stale[@]}"; do
        log "Pruning local: $(basename "$f")"
        rm -f "$f"
    done
}

_prune_local "daily"   "$KEEP_DAILY"
_prune_local "weekly"  "$KEEP_WEEKLY"
_prune_local "monthly" "$KEEP_MONTHLY"

log "Backup complete ✓  (tier=$TIER  file=$FILENAME  size=$SIZE)"
