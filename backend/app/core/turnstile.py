"""Cloudflare Turnstile verification for the login endpoints.

Why here and not at the edge: the Cloudflare WAF challenge deliberately
excludes ``/api/*`` so Safaricom's M-Pesa callbacks (server-to-server, no
browser) are never challenged. That exclusion leaves ``/api/v1/auth/login`` —
the endpoint credential-stuffing actually targets — unprotected at the edge.
Turnstile closes exactly that gap, and only there.

FAILS OPEN when TURNSTILE_SECRET_KEY is unset. That is deliberate: it makes
enabling *and* disabling this a single environment variable rather than a code
rollback. If Turnstile ever misbehaves against real users, unsetting one
variable restores logins immediately, with no deploy.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
_TIMEOUT_S = 8.0


class TurnstileResult:
    __slots__ = ("ok", "reason")

    def __init__(self, ok: bool, reason: str = ""):
        self.ok = ok
        self.reason = reason


def is_enabled() -> bool:
    return bool((settings.TURNSTILE_SECRET_KEY or "").strip())


def _hostname_allowed(hostname: str) -> bool:
    """Accept the configured base domain and any of its subdomains.

    Tenants are created from the admin dashboard, so their hostnames
    (`<school>.shulehq.co.ke`) cannot all be enumerated in advance —
    Turnstile's own widget list caps at 10 entries, which a growing SaaS would
    exhaust. Validating the shape ourselves keeps new schools working on the
    day they are onboarded rather than failing at the widget.
    """
    base = (settings.CORS_BASE_DOMAIN or "").strip().lower().lstrip(".")
    host = (hostname or "").strip().lower()
    if not base:
        return True  # nothing configured to validate against (dev)
    return host == base or host.endswith("." + base)


def verify(token: Optional[str], remote_ip: Optional[str] = None) -> TurnstileResult:
    """Verify a Turnstile token. Never raises — a verifier that throws would
    turn a CAPTCHA hiccup into an outage on the login path."""
    secret = (settings.TURNSTILE_SECRET_KEY or "").strip()
    if not secret:
        return TurnstileResult(True, "disabled")

    if not token or not token.strip():
        return TurnstileResult(False, "missing_token")

    form = {"secret": secret, "response": token.strip()}
    if remote_ip:
        form["remoteip"] = remote_ip

    try:
        req = urllib.request.Request(
            _VERIFY_URL,
            data=urllib.parse.urlencode(form).encode(),
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode() or "{}")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        # Cloudflare unreachable. Do NOT lock every school out of their system
        # because a third-party CAPTCHA service is having a bad day: log loudly
        # and let the request through. Passwords and rate limiting still apply.
        logger.warning("TURNSTILE: verification unreachable (%s) — allowing request", exc)
        return TurnstileResult(True, "verifier_unreachable")
    except Exception as exc:  # noqa: BLE001
        logger.warning("TURNSTILE: unexpected verifier error (%s) — allowing request", exc)
        return TurnstileResult(True, "verifier_error")

    if not data.get("success"):
        codes = ",".join(data.get("error-codes") or []) or "unknown"
        return TurnstileResult(False, f"rejected:{codes}")

    hostname = str(data.get("hostname") or "")
    if hostname and not _hostname_allowed(hostname):
        logger.warning("TURNSTILE: token solved on unexpected hostname %r", hostname)
        return TurnstileResult(False, "hostname_mismatch")

    return TurnstileResult(True, "ok")
