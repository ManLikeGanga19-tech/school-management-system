from __future__ import annotations

import logging
from typing import AsyncGenerator

import redis.asyncio as aioredis
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import settings

logger = logging.getLogger(__name__)

_redis_pool: aioredis.ConnectionPool | None = None
_redis_client: Redis | None = None


async def init_redis() -> None:
    global _redis_pool, _redis_client
    # Use the authenticated URL (password injected from REDIS_PASSWORD env var).
    # Log only the base URL so the password is never written to logs.
    auth_url = settings.redis_url_with_auth
    _redis_pool = aioredis.ConnectionPool.from_url(
        auth_url,
        max_connections=20,
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=5,
        health_check_interval=30,
    )
    _redis_client = aioredis.Redis(connection_pool=_redis_pool)
    try:
        await _redis_client.ping()
        logger.info("Redis connected: %s", settings.REDIS_URL)  # log base URL only
    except RedisError as exc:
        # Degrade gracefully — rate limiting and session caching will fall back.
        logger.error("Redis ping failed on startup: %s", exc)


async def close_redis() -> None:
    global _redis_pool, _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
    if _redis_pool is not None:
        await _redis_pool.aclose()
        _redis_pool = None
    logger.info("Redis connection pool closed")


def get_redis_client() -> Redis | None:
    """Return the shared Redis client, or None if not initialised."""
    return _redis_client


async def get_redis() -> AsyncGenerator[Redis, None]:
    """FastAPI dependency — yields the shared client (no per-request connection overhead)."""
    from fastapi import HTTPException

    client = get_redis_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Cache unavailable")
    yield client
