"""Phase H — rate-limiter resilience tests.

Two real failure modes are covered:

  1. Redis unreachable at boot — the probe must short-circuit to memory
     storage, no exception leaks, app starts cleanly.
  2. Redis dies mid-flight — slowapi's swallow_errors + in_memory_fallback
     must keep the API responding rather than 500-ing every request.

The probe is mocked at the redis-py level (we control what `.ping()` does)
so we don't need an actual Redis to test the boot path.
"""
from __future__ import annotations

import importlib
from unittest.mock import patch, MagicMock

import pytest


def _reload_rate_limit_module():
    """Force a fresh import so the module-level `limiter = _build_limiter()`
    re-runs against whatever mocks are active."""
    import app.core.rate_limit as rl
    return importlib.reload(rl)


class TestBootProbe:
    def test_probe_succeeds_uses_redis_backend(self):
        fake_client = MagicMock()
        fake_client.ping.return_value = True
        with patch("redis.Redis.from_url", return_value=fake_client):
            rl = _reload_rate_limit_module()
        assert rl.limiter_health()["backend"] == "redis"

    def test_connection_refused_falls_back_to_memory(self):
        # Simulates Render Key Value suspended (Error 111 connection refused).
        with patch("redis.Redis.from_url", side_effect=ConnectionRefusedError()):
            rl = _reload_rate_limit_module()
        h = rl.limiter_health()
        assert h["backend"] == "memory"
        assert h["mode"] == "healthy"
        assert "per-worker" in h.get("note", "")

    def test_ping_returns_false_falls_back_to_memory(self):
        fake_client = MagicMock()
        fake_client.ping.return_value = False
        with patch("redis.Redis.from_url", return_value=fake_client):
            rl = _reload_rate_limit_module()
        assert rl.limiter_health()["backend"] == "memory"

    def test_dns_failure_falls_back_to_memory(self):
        # Deleted Render instance → NXDOMAIN at resolution time.
        import socket
        with patch(
            "redis.Redis.from_url", side_effect=socket.gaierror("Name unknown")
        ):
            rl = _reload_rate_limit_module()
        assert rl.limiter_health()["backend"] == "memory"

    def test_probe_timeout_falls_back_to_memory(self):
        # Connect timeout (slow / unreachable network) must not block boot
        # beyond the configured short timeout.
        with patch("redis.Redis.from_url", side_effect=TimeoutError()):
            rl = _reload_rate_limit_module()
        assert rl.limiter_health()["backend"] == "memory"


class TestLimiterConfigured:
    def test_swallow_errors_and_fallback_are_enabled(self):
        """Even when Redis is up at boot, the Limiter must be built with
        swallow_errors + in_memory_fallback_enabled so a mid-flight Redis
        outage doesn't 500 the caller."""
        fake_client = MagicMock()
        fake_client.ping.return_value = True
        with patch("redis.Redis.from_url", return_value=fake_client):
            rl = _reload_rate_limit_module()
        assert rl.limiter._swallow_errors is True
        assert rl.limiter._in_memory_fallback_enabled is True

    def test_swallow_errors_and_fallback_present_in_memory_mode_too(self):
        with patch("redis.Redis.from_url", side_effect=ConnectionRefusedError()):
            rl = _reload_rate_limit_module()
        assert rl.limiter._swallow_errors is True
        # in_memory_fallback list is still populated so the active limits
        # have a strategy to enforce against.
        assert rl.limiter._in_memory_fallback_enabled is True


class TestHealthEndpoint:
    def test_healthz_surfaces_rate_limiter_status(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        body = client.get("/healthz").json()
        assert body["status"] == "ok"
        assert "rate_limiter" in body
        assert body["rate_limiter"]["backend"] in ("redis", "memory")
        assert body["rate_limiter"]["mode"] in ("healthy", "degraded")


@pytest.fixture(autouse=True)
def restore_rate_limit_module():
    """Each test in this file mucks with module state via importlib.reload —
    leave the module restored to the live (test-environment) limiter on the
    way out so other test modules see a sane import."""
    yield
    import app.core.rate_limit as rl  # noqa: F401
    importlib.reload(rl)
