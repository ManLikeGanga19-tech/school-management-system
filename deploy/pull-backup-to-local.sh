#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ShuleHQ — pull the newest VPS backup down to a local drive (offsite copy).
#
# PULL, not push, deliberately: the VPS holds no credentials for this machine
# and has no route to it, so a compromised server cannot reach or destroy
# these copies. That is the main advantage over pushing to cloud storage.
#
# Run from WSL. Schedule daily via Windows Task Scheduler:
#     Program : wsl.exe
#     Args    : -d Ubuntu -e bash /mnt/c/dev/school-management-system/deploy/pull-backup-to-local.sh
#
# Verifies every artifact against its own manifest before keeping it, so a
# truncated or corrupt download is never mistaken for a good backup.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

VPS_HOST="${VPS_HOST:-94.72.102.13}"
VPS_USER="${VPS_USER:-deploy}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/shulehq_admin_key}"
REMOTE_DIR="${REMOTE_DIR:-/opt/shulehq/backups}"
LOCAL_DIR="${LOCAL_DIR:-/mnt/d/shulehq-backup-db/nightly}"
KEEP="${KEEP:-30}"                      # local artifacts to retain
LOG="${LOG:-${LOCAL_DIR}/pull.log}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }
fail() { log "FAILED: $*"; exit 1; }

mkdir -p "${LOCAL_DIR}" || fail "cannot create ${LOCAL_DIR} (is the D: drive attached?)"
[ -f "${SSH_KEY}" ] || fail "ssh key not found at ${SSH_KEY}"

SSH="ssh -i ${SSH_KEY} -o IdentitiesOnly=yes -o ConnectTimeout=20 -o BatchMode=yes"

# ── newest artifact on the VPS ───────────────────────────────────────────────
NEWEST=$($SSH "${VPS_USER}@${VPS_HOST}" "ls -1t ${REMOTE_DIR}/shulehq-backup-prod-*.tar 2>/dev/null | head -1") \
  || fail "cannot reach the VPS"
[ -n "${NEWEST}" ] || fail "no backup artifacts found on the VPS"
BASE=$(basename "${NEWEST}")

if [ -f "${LOCAL_DIR}/${BASE}" ]; then
  log "already have ${BASE} — nothing to do"
else
  log "fetching ${BASE}"
  scp -i "${SSH_KEY}" -o IdentitiesOnly=yes -q \
    "${VPS_USER}@${VPS_HOST}:${NEWEST}" "${LOCAL_DIR}/${BASE}.part" \
    || fail "download failed"

  # Verify against the manifest INSIDE the artifact before trusting it.
  TMP=$(mktemp -d); trap 'rm -rf "${TMP}"' EXIT
  tar xf "${LOCAL_DIR}/${BASE}.part" -C "${TMP}" || fail "artifact is not a readable tar"
  EXP=$(python3 -c "import json;print(json.load(open('${TMP}/manifest.json'))['database']['dump_sha256'])" 2>/dev/null) \
    || fail "manifest unreadable"
  ACT=$(sha256sum "${TMP}/database.dump" | cut -d' ' -f1)
  [ "${EXP}" = "${ACT}" ] || fail "checksum mismatch — download corrupt (expected ${EXP}, got ${ACT})"

  mv -f "${LOCAL_DIR}/${BASE}.part" "${LOCAL_DIR}/${BASE}"
  ROWS=$(python3 -c "import json;print(json.load(open('${TMP}/manifest.json'))['database']['table_data_count'])" 2>/dev/null || echo '?')
  log "verified and stored ${BASE} ($(stat -c%s "${LOCAL_DIR}/${BASE}") bytes, ${ROWS} tables)"
fi

# ── retention ────────────────────────────────────────────────────────────────
cd "${LOCAL_DIR}"
mapfile -t OLD < <(ls -1t shulehq-backup-prod-*.tar 2>/dev/null | tail -n +$((KEEP+1)) || true)
for f in "${OLD[@]:-}"; do [ -n "$f" ] && rm -f -- "$f" && log "pruned ${f}"; done

COUNT=$(ls -1 shulehq-backup-prod-*.tar 2>/dev/null | wc -l)
log "done — ${COUNT} local copies in ${LOCAL_DIR}"
