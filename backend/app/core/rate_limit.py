"""Rate limiter with Redis backend + production-grade resilience.

Two failure modes are handled explicitly so a Redis outage cannot take the
API down with itself:

  1. Redis unreachable AT BOOT (most common on Render — Key Value instance
     suspended after 30 days of inactivity). We PING with a short timeout
     before initialising slowapi; if the probe fails we build the Limiter
     with in-memory storage from the start and log a loud warning. No
     request-path overhead, no per-request connection retries.

  2. Redis dies MID-FLIGHT (network blip, instance restart, OOM, etc.).
     slowapi is configured with:
       * swallow_errors=True       — storage exceptions don't 500 the
                                     caller; the request is allowed
                                     through and a warning is logged.
       * in_memory_fallback_enabled + in_memory_fallback=[default_limit]
                                   — slowapi tracks `_storage_dead` and
                                     auto-degrades to its in-memory
                                     fallback strategy while Redis is
                                     down, then re-checks periodically
                                     and switches back when it recovers.

Trade-off: in fallback mode, limits are enforced per-worker rather than
cluster-wide, so brute-force protection on auth routes is weaker (an
attacker hitting different gunicorn workers could in theory get N× the
budget). That is strictly better than the API being unavailable.

Observability: `limiter_health()` returns the active backend so /health
or an admin endpoint can surface "RUNNING DEGRADED — Redis unavailable".
"""
from __future__ import annotations

import logging
from typing import Any

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Key strategy ────────────────────────────────────────────────────────────

def _tenant_or_ip_key(request: Request) -> str:
    """Composite rate-limit key.

      "tenant:<uuid>"   — authenticated requests with a resolved tenant. All
                          users at the same school share one bucket; users
                          behind CGNAT / shared ISP IPs (common in Kenya)
                          are not penalised for each other's traffic.
      "<ip-address>"    — public / unauthenticated requests (login, public
                          inquiry, health checks).

    Route-level limits (e.g. @limiter.limit("5/minute") on the login route)
    share this key function — login is unauthenticated so the key falls
    back to IP, which is exactly what you want for brute-force protection.
    """
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id:
        return f"tenant:{tenant_id}"
    return _client_ip(request)


def _client_ip(request: Request) -> str:
    """The real client IP, not the last proxy in the chain.

    ``get_remote_address`` returns the immediate TCP peer. Behind
    Cloudflare -> Caddy -> nginx -> backend that is always nginx's container
    address, so EVERY unauthenticated request shared a single rate-limit
    bucket. Two consequences, both observed in production:

      * six teachers logging in within a minute -> the sixth got 429, because
        one bucket was shared by every user of every school;
      * an attacker sending 5 requests/minute from anywhere could exhaust that
        one bucket and lock all schools out of logging in -- the limiter meant
        to stop brute force became a denial-of-service vector.

    CF-Connecting-IP is set by Cloudflare and cannot be forged by a client
    *through* Cloudflare. It is only trustworthy while the origin is not
    reachable directly, so the origin should be firewalled to Cloudflare's
    ranges; until then this is still strictly better than keying every user to
    one proxy address. X-Forwarded-For is the fallback for non-Cloudflare
    paths, taking the left-most entry (the original client).
    """
    cf = request.headers.get("cf-connecting-ip")
    if cf and cf.strip():
        return cf.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff and xff.strip():
        return xff.split(",")[0].strip()
    return get_remote_address(request)


# ── Redis liveness probe ────────────────────────────────────────────────────

_REDIS_PROBE_TIMEOUT_S = 2.0  # short — boot must not block on a dead Redis.


def _redis_is_reachable(uri: str) -> bool:
    """PING Redis with a short timeout. Returns True only when the server
    responds. Any exception (DNS failure, refused, timeout, auth error) →
    False so the caller can fall back to memory storage."""
    try:
        # Imported here so the module still loads in environments where
        # `redis` isn't installed (e.g., trimmed test images).
        from redis import Redis
    except Exception as exc:
        logger.warning("redis-py not importable, using in-memory limiter: %s", exc)
        return False

    try:
        client = Redis.from_url(
            uri,
            socket_connect_timeout=_REDIS_PROBE_TIMEOUT_S,
            socket_timeout=_REDIS_PROBE_TIMEOUT_S,
        )
        ok = bool(client.ping())
        try:
            client.close()
        except Exception:
            pass
        return ok
    except Exception as exc:
        # Common cases: connection refused (instance suspended), DNS NXDOMAIN
        # (instance deleted), authentication failure, timeout (network blip).
        # All collapse to "use memory storage" — the explicit log makes it
        # obvious in ops dashboards which mode we booted into.
        logger.warning(
            "Rate-limiter Redis probe failed at boot (%s). "
            "Falling back to in-memory storage — limits will be per-worker, "
            "not cluster-wide. Resume Redis to restore.",
            exc.__class__.__name__,
        )
        return False


# ── Builder ────────────────────────────────────────────────────────────────

_LIMITER_BACKEND: str = "uninitialised"


def _build_limiter() -> Limiter:
    """Probe Redis, then build the Limiter against the best available
    backend with both safety nets engaged."""
    global _LIMITER_BACKEND
    default_limit = f"{settings.RATE_LIMIT_TENANT_PER_MINUTE}/minute"

    redis_uri = settings.redis_url_with_auth
    use_redis = _redis_is_reachable(redis_uri)

    common_kwargs: dict[str, Any] = {
        "key_func": _tenant_or_ip_key,
        "default_limits": [default_limit],
        # swallow_errors: when the storage backend raises (Redis dies
        # mid-flight, transient network blip), let the request through
        # rather than 500-ing every API call. slowapi will log + flip
        # _storage_dead, then retry the backend periodically.
        "swallow_errors": True,
        # in_memory_fallback: while _storage_dead is set, enforce limits
        # against an in-memory strategy so brute-force protection isn't
        # completely off during an outage.
        "in_memory_fallback": [default_limit],
        "in_memory_fallback_enabled": True,
    }

    if use_redis:
        _LIMITER_BACKEND = "redis"
        logger.info("Rate limiter: redis backend (cluster-wide enforcement).")
        return Limiter(storage_uri=redis_uri, **common_kwargs)

    _LIMITER_BACKEND = "memory"
    return Limiter(storage_uri="memory://", **common_kwargs)


def limiter_health() -> dict[str, Any]:
    """Health snapshot for /health or admin observability. `mode` reflects
    the slowapi state — when Redis is configured but slowapi has flipped
    _storage_dead, mode comes back as 'degraded'."""
    backend = _LIMITER_BACKEND
    storage_dead = bool(getattr(limiter, "_storage_dead", False))
    if backend == "redis" and storage_dead:
        return {"backend": "redis", "mode": "degraded", "fallback": "memory"}
    if backend == "redis":
        return {"backend": "redis", "mode": "healthy"}
    return {"backend": "memory", "mode": "healthy", "note": "per-worker limits"}


limiter = _build_limiter()
