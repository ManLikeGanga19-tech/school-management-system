from __future__ import annotations

import logging

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.core.config import settings

logger = logging.getLogger(__name__)


def _tenant_or_ip_key(request: Request) -> str:
    """
    Composite rate-limit key function.

    Returns a key in one of two forms:

      "tenant:<uuid>"   — for authenticated requests with a resolved tenant.
                          Every user at the same school shares this bucket, so
                          a single school can't exhaust the limit for other
                          tenants on the platform, and users behind CGNAT /
                          shared ISP IPs (common in Kenya) are not penalised
                          for each other's traffic.

      "<ip-address>"    — fallback for public / unauthenticated requests
                          (login, public inquiry, health checks).  The remote
                          IP is the only available identity before a tenant is
                          resolved, so per-IP limits apply.

    Interaction with per-route @limiter.limit() decorators
    -------------------------------------------------------
    Route-level limits (e.g. ``@limiter.limit("5/minute")`` on the login
    endpoint) use the same key function.  Because login routes are
    unauthenticated, ``request.state.tenant_id`` is not set at that point and
    the key falls back to the caller's IP address — exactly what you want for
    brute-force protection.

    Tenant routes that carry ``@limiter.limit("30/minute")`` (e.g. Daraja STK
    push) are keyed by tenant_id, so the declared limit applies per school
    rather than per IP.
    """
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id:
        return f"tenant:{tenant_id}"
    return get_remote_address(request)


def _build_limiter() -> Limiter:
    """
    Build the slowapi Limiter backed by Redis.

    Key strategy  : tenant-aware (see _tenant_or_ip_key above).
    Default limit : RATE_LIMIT_TENANT_PER_MINUTE req/minute (per tenant bucket
                    or per IP for public endpoints).
    Per-route overrides are declared with @limiter.limit() on specific routes.

    Falls back to in-memory storage if Redis is not reachable so the app
    starts cleanly in environments without Redis (e.g., unit tests).
    In-memory storage is NOT shared across gunicorn workers — use Redis in
    production.
    """
    default_limit = f"{settings.RATE_LIMIT_TENANT_PER_MINUTE}/minute"

    try:
        return Limiter(
            key_func=_tenant_or_ip_key,
            storage_uri=settings.redis_url_with_auth,
            default_limits=[default_limit],
        )
    except Exception as exc:
        logger.warning(
            "Rate limiter could not initialise Redis storage (%s). "
            "Falling back to in-memory — NOT suitable for production.",
            exc,
        )
        return Limiter(
            key_func=_tenant_or_ip_key,
            default_limits=[default_limit],
        )


limiter = _build_limiter()
