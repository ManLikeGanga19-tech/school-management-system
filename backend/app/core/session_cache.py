"""
Redis-backed JWT session cache and access token blacklist.

Design:
  - Access token blacklist: on logout, the token's SHA-256 hash is stored with
    a TTL equal to the token's remaining lifetime. Blacklisted tokens are
    rejected before any DB lookup.
  - Session cache: after the first DB round-trip to load user + permissions,
    the result is cached under the token hash for the remaining access token
    lifetime (max 15 min). Cache hits skip the DB entirely.

Failure mode: every Redis call is wrapped in try/except AND guarded by a
circuit breaker. When Redis is down (Render Key Value suspended, mid-deploy,
network blip), the breaker trips after a few failures and short-circuits all
subsequent calls for `cooldown_s`. No socket connect attempts during that
window — the auth hot path costs one dict lookup per call.

  - Blacklist checks return False (fail open — do not block valid users).
  - Cache reads return None (fall through to DB, same as before this change).
  - Blacklist writes and cache writes are silently skipped.
  A logged-out token may remain valid for up to JWT_ACCESS_TTL_MIN minutes
  when Redis is unavailable. This is an accepted production trade-off.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.circuit_breaker import CircuitBreaker
from app.core.redis import get_redis_client

logger = logging.getLogger(__name__)

_BLACKLIST_PREFIX = "bl:"    # bl:<token_hash>  →  "1"
_SESSION_PREFIX = "sess:"    # sess:<token_hash> →  json payload


# One breaker shared by every session_cache call — a Redis outage is
# always all-or-nothing here, so a single counter is enough. After 3
# consecutive failures we go cold for 30 seconds, then one trial call
# decides whether to flip back.
_breaker = CircuitBreaker(name="redis.session_cache", failure_threshold=3, cooldown_s=30.0)


def breaker_snapshot() -> dict[str, object]:
    """Exposed on /healthz so ops can see degraded mode."""
    return _breaker.snapshot()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _ttl_seconds(payload: dict) -> int:
    exp = payload.get("exp")
    if exp is None:
        return 60
    remaining = int(exp) - int(datetime.now(timezone.utc).timestamp())
    return max(1, remaining)


async def is_blacklisted(token: str) -> bool:
    """Return True if the access token has been explicitly revoked."""
    if not _breaker.allow():
        return False
    client = get_redis_client()
    if client is None:
        return False
    try:
        result = await client.exists(_BLACKLIST_PREFIX + _token_hash(token)) > 0
        _breaker.record_success()
        return result
    except Exception as exc:
        _breaker.record_failure()
        logger.warning("Redis blacklist check failed: %s", exc)
        return False


async def blacklist_token(token: str, payload: dict) -> None:
    """Blacklist an access token until its natural expiry."""
    if not _breaker.allow():
        return
    client = get_redis_client()
    if client is None:
        return
    try:
        ttl = _ttl_seconds(payload)
        await client.setex(_BLACKLIST_PREFIX + _token_hash(token), ttl, "1")
        _breaker.record_success()
    except Exception as exc:
        _breaker.record_failure()
        logger.warning("Redis blacklist write failed: %s", exc)


async def get_cached_session(token: str) -> dict[str, Any] | None:
    """Return cached user session data, or None on cache miss."""
    if not _breaker.allow():
        return None
    client = get_redis_client()
    if client is None:
        return None
    try:
        raw = await client.get(_SESSION_PREFIX + _token_hash(token))
        _breaker.record_success()
        return json.loads(raw) if raw else None
    except Exception as exc:
        _breaker.record_failure()
        logger.warning("Redis session cache read failed: %s", exc)
        return None


async def cache_session(token: str, data: dict[str, Any], ttl_seconds: int) -> None:
    """Cache user session data for the remaining access token lifetime."""
    if not _breaker.allow():
        return
    client = get_redis_client()
    if client is None:
        return
    try:
        await client.setex(_SESSION_PREFIX + _token_hash(token), ttl_seconds, json.dumps(data))
        _breaker.record_success()
    except Exception as exc:
        _breaker.record_failure()
        logger.warning("Redis session cache write failed: %s", exc)


async def invalidate_session(token: str) -> None:
    """Remove a cached session entry (called alongside blacklisting on logout)."""
    if not _breaker.allow():
        return
    client = get_redis_client()
    if client is None:
        return
    try:
        await client.delete(_SESSION_PREFIX + _token_hash(token))
        _breaker.record_success()
    except Exception as exc:
        _breaker.record_failure()
        logger.warning("Redis session cache invalidate failed: %s", exc)
