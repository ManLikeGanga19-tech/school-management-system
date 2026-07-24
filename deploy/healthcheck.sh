#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ShuleHQ — operator health sweep.
#
# A fast, read-only survey of the production box for routine check-ins:
# "is anything weird happening?" Run from your workstation; it opens ONE SSH
# session, runs the whole sweep remotely, and flags anything worth a look.
# Changes nothing.
#
#   bash deploy/healthcheck.sh
#
# Single remote session on purpose: an earlier version ran each section as its
# own SSH command, which was slow (many handshakes) and broke loops/heredocs in
# the local-vs-remote quoting. Everything now executes on the box.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

HOST="${VPS_HOST:-94.72.102.13}"
USER="${VPS_USER:-deploy}"
KEY="${SSH_KEY:-$HOME/.ssh/shulehq_admin_key}"

ssh -i "${KEY}" -o IdentitiesOnly=yes -o ConnectTimeout=15 -o BatchMode=yes \
    "${USER}@${HOST}" 'bash -s' <<'REMOTE'
set -uo pipefail
R=$'\033[31m'; G=$'\033[32m'; B=$'\033[1m'; N=$'\033[0m'
say()  { printf '%s%s%s\n' "$B" "$*" "$N"; }
bad()  { printf '   %s✗ %s%s\n' "$R" "$*" "$N"; }
ok()   { printf '   %s✓ %s%s\n' "$G" "$*" "$N"; }

say "═══ ShuleHQ health sweep — $(date -u +%Y-%m-%dT%H:%M:%SZ) ═══"

# ── 1. containers ────────────────────────────────────────────────────────────
say "1. Containers"
docker ps -a --format '{{.Names}}|{{.Status}}' | while IFS='|' read -r name status; do
  case "$status" in
    *unhealthy*|*Restarting*)   bad "${name}: ${status}" ;;
    *"Exited (0)"*)             printf '   · %s: %s\n' "$name" "$status" ;;
    *Exited*)                   bad "${name}: ${status}" ;;
    *healthy*|*Up*)             ok  "${name}: ${status}" ;;
    *)                          printf '   ? %s: %s\n' "$name" "$status" ;;
  esac
done

# ── 2. restart counts ────────────────────────────────────────────────────────
say "2. Restart counts (0 = good; climbing = crash loop)"
for c in $(docker ps --format '{{.Names}}'); do
  n=$(docker inspect -f '{{.RestartCount}}' "$c")
  printf '   %-16s %s\n' "$c" "$n"
done

# ── 3. resources ─────────────────────────────────────────────────────────────
say "3. Resources"
free -h | awk '/Mem:/{print "   RAM  "$3" / "$2"  (avail "$7")"}'
df -h / | awk 'NR==2{print "   Disk "$3" / "$2"  ("$5")"}'
echo "   Load $(cut -d' ' -f1-3 /proc/loadavg) on $(nproc) vCPU"
free -h | awk '/Swap:/{print "   Swap "$3" / "$2}'

# ── 4. live per-container usage ──────────────────────────────────────────────
say "4. Current per-container usage"
docker stats --no-stream --format '   {{.Name}}	{{.CPUPerc}}	{{.MemUsage}}'

# ── 5. CPU throttling since boot ─────────────────────────────────────────────
say "5. CPU throttling (nr_throttled climbing = a container is hitting its cap)"
for c in sms-backend sms-postgres sms-frontend; do
  v=$(docker exec "$c" cat /sys/fs/cgroup/cpu.stat 2>/dev/null | awk '/nr_throttled/{print $2}')
  printf '   %-16s nr_throttled=%s\n' "$c" "${v:-n/a}"
done

# ── 6. backend log scan (last 1h) ────────────────────────────────────────────
say "6. Backend log scan (last 1h)"
logs=$(docker logs sms-backend --since 1h 2>&1)
printf '   5xx responses      : %s\n' "$(printf '%s' "$logs" | grep -cE ' 5[0-9][0-9] ')"
printf '   tracebacks         : %s\n' "$(printf '%s' "$logs" | grep -c 'Traceback')"
printf '   401/403 (auth)     : %s\n' "$(printf '%s' "$logs" | grep -cE ' 40[13] ')"
printf '   429 (rate limited) : %s\n' "$(printf '%s' "$logs" | grep -c ' 429 ')"

# ── 7. public listeners ──────────────────────────────────────────────────────
say "7. Public listeners (expect ONLY 22/80/443; app ports on 127.0.0.1)"
sudo ss -tlnp 2>/dev/null | awk 'NR>1{print $4}' \
  | grep -vE '127\.0\.0\.[0-9]+|\[::1\]' | sort -u | sed 's/^/   /'

# ── 8. backups ───────────────────────────────────────────────────────────────
say "8. Backups"
newest=$(ls -1t /opt/shulehq/backups/*.tar 2>/dev/null | head -1)
if [ -z "$newest" ]; then
  bad "NO backup artifacts on the VPS"
else
  age=$(( ($(date +%s) - $(stat -c %Y "$newest")) / 3600 ))
  printf '   newest: %s (%sh old)\n' "$(basename "$newest")" "$age"
  [ "$age" -gt 30 ] && bad "STALE — expected a nightly within 30h"
  printf '   retained: %s on the VPS\n' "$(ls -1 /opt/shulehq/backups/*.tar 2>/dev/null | wc -l)"
fi

# ── 9. data heartbeat ────────────────────────────────────────────────────────
say "9. Data heartbeat"
docker exec -u postgres sms-postgres psql -U shulehq -d shulehq -tA 2>/dev/null -c \
"SELECT '   tenants='||(SELECT count(*) FROM core.tenants)
      ||'  users='||(SELECT count(*) FROM core.users)
      ||'  payments='||(SELECT count(*) FROM core.payments)
      ||'  newest audit='||to_char((SELECT max(created_at) FROM core.audit_logs),'MM-DD HH24:MI');" \
  || bad "could not reach the database"

say "═══ sweep complete ═══"
echo "Anything red, or a number that jumped since last check, is worth a closer look."
REMOTE
