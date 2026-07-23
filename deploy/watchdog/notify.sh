#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ShuleHQ alert fan-out.
#
# Every channel is enabled PURELY by the presence of its secrets. Adding
# Africa's Talking (or anything else) later needs no code change here — just
# add the secrets and the channel starts firing.
#
#   notify.sh <critical|warning> "<title>" "<body>"
#
# Channels, in order of loudness:
#   AT voice call  AT_USERNAME + AT_API_KEY + AT_VOICE_FROM + ALERT_PHONE  (critical only)
#   ntfy push      NTFY_TOPIC [+ NTFY_URL]                                 (loud, free)
#   AT SMS         AT_USERNAME + AT_API_KEY + ALERT_PHONE
#   webhook        ALERT_WEBHOOK (Slack/Discord-compatible JSON)
#
# If nothing is configured the script still succeeds; the calling workflow
# fails, and GitHub emails you. There is always at least one path to you.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

SEVERITY="${1:-critical}"
TITLE="${2:-ShuleHQ alert}"
BODY="${3:-}"
SENT=0

# Sandbox vs production Africa's Talking endpoints.
if [ "${AT_SANDBOX:-false}" = "true" ]; then
  AT_SMS_URL="https://api.sandbox.africastalking.com/version1/messaging"
else
  AT_SMS_URL="https://api.africastalking.com/version1/messaging"
fi

# ── 1. Voice call — the loudest page. Critical only; a ringing phone at 2am
#       is the point. Requires a voice-enabled AT number.
if [ "${SEVERITY}" = "critical" ] && [ -n "${AT_USERNAME:-}" ] && [ -n "${AT_API_KEY:-}" ] \
   && [ -n "${AT_VOICE_FROM:-}" ] && [ -n "${ALERT_PHONE:-}" ]; then
  if curl -sS -m 25 -X POST "https://voice.africastalking.com/call" \
      -H "apiKey: ${AT_API_KEY}" -H "Accept: application/json" \
      -d "username=${AT_USERNAME}" -d "from=${AT_VOICE_FROM}" -d "to=${ALERT_PHONE}" \
      >/dev/null 2>&1; then
    echo "  ✓ voice call placed to ${ALERT_PHONE}"; SENT=$((SENT+1))
  else
    echo "  ✗ voice call failed"
  fi
fi

# ── 2. ntfy push — free, and can bypass Do Not Disturb at max priority.
if [ -n "${NTFY_TOPIC:-}" ]; then
  NTFY_BASE="${NTFY_URL:-https://ntfy.sh}"
  if [ "${SEVERITY}" = "critical" ]; then PRIO="urgent"; TAGS="rotating_light"; else PRIO="high"; TAGS="warning"; fi
  if curl -sS -m 20 \
      -H "Title: ${TITLE}" -H "Priority: ${PRIO}" -H "Tags: ${TAGS}" \
      -d "${BODY}" "${NTFY_BASE}/${NTFY_TOPIC}" >/dev/null 2>&1; then
    echo "  ✓ ntfy push sent (${PRIO})"; SENT=$((SENT+1))
  else
    echo "  ✗ ntfy push failed"
  fi
fi

# ── 3. SMS — reliable delivery, but usually lands on the normal tone. Good for
#       warnings; not a substitute for a call at 2am.
if [ -n "${AT_USERNAME:-}" ] && [ -n "${AT_API_KEY:-}" ] && [ -n "${ALERT_PHONE:-}" ]; then
  MSG="[${SEVERITY^^}] ${TITLE} — ${BODY}"
  if curl -sS -m 25 -X POST "${AT_SMS_URL}" \
      -H "apiKey: ${AT_API_KEY}" -H "Accept: application/json" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      --data-urlencode "username=${AT_USERNAME}" \
      --data-urlencode "to=${ALERT_PHONE}" \
      --data-urlencode "message=${MSG:0:300}" \
      >/dev/null 2>&1; then
    echo "  ✓ SMS sent to ${ALERT_PHONE}"; SENT=$((SENT+1))
  else
    echo "  ✗ SMS failed"
  fi
fi

# ── 4. Chat webhook (Slack / Discord / Teams-compatible).
if [ -n "${ALERT_WEBHOOK:-}" ]; then
  if curl -sS -m 20 -X POST "${ALERT_WEBHOOK}" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"[${SEVERITY}] ${TITLE}\\n${BODY}\",\"content\":\"[${SEVERITY}] ${TITLE}\\n${BODY}\"}" \
      >/dev/null 2>&1; then
    echo "  ✓ webhook posted"; SENT=$((SENT+1))
  fi
fi

if [ "${SENT}" -eq 0 ]; then
  echo "  ⚠ no alert channel configured — relying on the GitHub workflow failure email."
  echo "     Configure NTFY_TOPIC (free, loud) or AT_* to get paged directly."
fi
exit 0
