"""
Redis-backed JWT session cache and access token blacklist.

Design:
  - Access token blacklist: on logout, the token's SHA-256 hash is stored with
    a TTL equal to the token's remaining lifetime. Blacklisted tokens are
    rejected before any DB lookup.
  - Session cache: after the first DB round-trip to load user + permissions,
    the result is cached under the token hash for the remaining access token
    lifetime (max 15 min). Cache hits skip the DB entirely.

Failure mode: every Redis call is wrapped in try/except. If Redis is down:
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

from app.core.redis import get_redis_client

logger = logging.getLogger(__name__)

_BLACKLIST_PREFIX = "bl:"    # bl:<token_hash>  →  "1"
_SESSION_PREFIX = "sess:"    # sess:<token_hash> →  json payload


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
    client = get_redis_client()
    if client is None:
        return False
    try:
        return await client.exists(_BLACKLIST_PREFIX + _token_hash(token)) > 0
    except Exception as exc:
        logger.warning("Redis blacklist check failed: %s", exc)
        return False


async def blacklist_token(token: str, payload: dict) -> None:
    """Blacklist an access token until its natural expiry."""
    client = get_redis_client()
    if client is None:
        return
    try:
        ttl = _ttl_seconds(payload)
        await client.setex(_BLACKLIST_PREFIX + _token_hash(token), ttl, "1")
    except Exception as exc:
        logger.warning("Redis blacklist write failed: %s", exc)


async def get_cached_session(token: str) -> dict[str, Any] | None:
    """Return cached user session data, or None on cache miss."""
    client = get_redis_client()
    if client is None:
        return None
    try:
        raw = await client.get(_SESSION_PREFIX + _token_hash(token))
        return json.loads(raw) if raw else None
    except Exception as exc:
        logger.warning("Redis session cache read failed: %s", exc)
        return None


async def cache_session(token: str, data: dict[str, Any], ttl_seconds: int) -> None:
    """Cache user session data for the remaining access token lifetime."""
    client = get_redis_client()
    if client is None:
        return
    try:
        await client.setex(_SESSION_PREFIX + _token_hash(token), ttl_seconds, json.dumps(data))
    except Exception as exc:
        logger.warning("Redis session cache write failed: %s", exc)


async def invalidate_session(token: str) -> None:
    """Remove a cached session entry (called alongside blacklisting on logout)."""
    client = get_redis_client()
    if client is None:
        return
    try:
        await client.delete(_SESSION_PREFIX + _token_hash(token))
    except Exception as exc:
        logger.warning("Redis session cache invalidate failed: %s", exc)
