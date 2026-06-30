"""session_cache must short-circuit Redis calls when the breaker is OPEN.

The critical assertion: when Redis is down, the session_cache code path
must NOT call into the Redis client at all after the breaker trips —
otherwise each request still pays the (now 250ms) timeout. We assert by
counting how many times the mocked client's methods get touched.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.core import session_cache as sc


@pytest.fixture(autouse=True)
def reset_breaker_state():
    """Each test starts with a fresh, healthy breaker so test order doesn't
    leak failures from earlier scenarios."""
    sc._breaker._failures = 0
    sc._breaker._state = "closed"
    sc._breaker._opened_at = 0.0
    sc._breaker._last_warned_state = ""
    yield


def _run(coro):
    return asyncio.run(coro)


class TestBreakerShortCircuit:
    def test_open_breaker_skips_redis_for_blacklist(self):
        """Once breaker is open, is_blacklisted returns False without touching
        the client (no socket connect, no timeout, no log spam)."""
        sc._breaker._state = "open"
        sc._breaker._opened_at = 9e18  # far future → never elapses

        mock_client = AsyncMock()
        with patch("app.core.session_cache.get_redis_client", return_value=mock_client):
            result = _run(sc.is_blacklisted("any-token"))

        assert result is False
        mock_client.exists.assert_not_called()

    def test_open_breaker_skips_redis_for_cache_read(self):
        sc._breaker._state = "open"
        sc._breaker._opened_at = 9e18
        mock_client = AsyncMock()
        with patch("app.core.session_cache.get_redis_client", return_value=mock_client):
            result = _run(sc.get_cached_session("any-token"))
        assert result is None
        mock_client.get.assert_not_called()

    def test_open_breaker_skips_redis_for_cache_write(self):
        sc._breaker._state = "open"
        sc._breaker._opened_at = 9e18
        mock_client = AsyncMock()
        with patch("app.core.session_cache.get_redis_client", return_value=mock_client):
            _run(sc.cache_session("any-token", {"x": 1}, 60))
        mock_client.setex.assert_not_called()


class TestFailureTrips:
    def test_three_consecutive_failures_open_the_breaker(self):
        """After 3 failed calls (the production threshold), subsequent calls
        skip Redis entirely. This is what fixes the slow-UI symptom."""
        boom = AsyncMock()
        boom.get.side_effect = ConnectionRefusedError("nope")
        boom.exists.side_effect = ConnectionRefusedError("nope")

        with patch("app.core.session_cache.get_redis_client", return_value=boom):
            # 3 failures across any mix of methods.
            _run(sc.is_blacklisted("t1"))
            _run(sc.is_blacklisted("t2"))
            _run(sc.is_blacklisted("t3"))

            # Breaker should now be open — next call skips Redis.
            assert sc._breaker.snapshot()["state"] == "open"
            before = boom.exists.call_count
            _run(sc.is_blacklisted("t4"))
            assert boom.exists.call_count == before


class TestRecovery:
    def test_success_after_half_open_closes_breaker(self):
        # Force half_open: simulate cooldown already elapsed.
        sc._breaker._state = "open"
        sc._breaker._opened_at = 0.0  # well in the past
        sc._breaker._failures = 5

        ok = AsyncMock()
        ok.exists.return_value = 0  # not blacklisted

        with patch("app.core.session_cache.get_redis_client", return_value=ok):
            _run(sc.is_blacklisted("t1"))

        assert sc._breaker.snapshot()["state"] == "closed"
        assert sc._breaker.snapshot()["failures"] == 0


class TestHealthExposure:
    def test_breaker_snapshot_shape(self):
        snap = sc.breaker_snapshot()
        assert {"name", "state", "failures", "cooldown_remaining_s"} <= snap.keys()
        assert snap["name"] == "redis.session_cache"
