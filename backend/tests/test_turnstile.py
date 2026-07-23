"""Turnstile verification, with emphasis on the ways it must NOT lock users out.

Login protection that fails closed is an outage generator: a third-party CAPTCHA
having a bad day would stop every school from working. These tests pin the
fail-open behaviour so it cannot be regressed by accident.
"""
from __future__ import annotations

import pytest

from app.core import turnstile
from app.core.config import settings


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "0xSECRET", raising=False)
    monkeypatch.setattr(settings, "CORS_BASE_DOMAIN", "shulehq.co.ke", raising=False)


@pytest.fixture
def disabled(monkeypatch):
    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "", raising=False)


def _stub(monkeypatch, payload: dict):
    """Replace the network call with a canned siteverify response."""
    class _Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self):
            import json
            return json.dumps(payload).encode()
    monkeypatch.setattr(turnstile.urllib.request, "urlopen", lambda *a, **k: _Resp())


class TestDisabledIsAFullNoOp:
    def test_no_secret_means_always_allowed(self, disabled):
        assert turnstile.verify(None).ok is True
        assert turnstile.verify("anything").ok is True

    def test_is_enabled_reflects_the_secret(self, disabled):
        assert turnstile.is_enabled() is False


class TestEnabled:
    def test_missing_token_is_rejected(self, enabled):
        r = turnstile.verify(None)
        assert r.ok is False and r.reason == "missing_token"

    def test_blank_token_is_rejected(self, enabled):
        assert turnstile.verify("   ").ok is False

    def test_valid_token_accepted(self, enabled, monkeypatch):
        _stub(monkeypatch, {"success": True, "hostname": "novel-school.shulehq.co.ke"})
        assert turnstile.verify("tok").ok is True

    def test_rejected_token_reports_cloudflare_codes(self, enabled, monkeypatch):
        _stub(monkeypatch, {"success": False, "error-codes": ["invalid-input-response"]})
        r = turnstile.verify("tok")
        assert r.ok is False and "invalid-input-response" in r.reason


class TestFailsOpenOnInfrastructureTrouble:
    """Cloudflare being unreachable must never stop schools logging in."""

    def test_network_error_allows_the_request(self, enabled, monkeypatch):
        def _boom(*a, **k):
            raise OSError("connection refused")
        monkeypatch.setattr(turnstile.urllib.request, "urlopen", _boom)
        r = turnstile.verify("tok")
        assert r.ok is True and r.reason == "verifier_unreachable"

    def test_garbage_response_allows_the_request(self, enabled, monkeypatch):
        def _weird(*a, **k):
            raise ValueError("not json")
        monkeypatch.setattr(turnstile.urllib.request, "urlopen", _weird)
        assert turnstile.verify("tok").ok is True


class TestHostnameScoping:
    """Tenants are created dynamically, so subdomains must be accepted without
    being enumerated anywhere — Turnstile's own widget list caps at 10."""

    def test_apex_allowed(self, enabled):
        assert turnstile._hostname_allowed("shulehq.co.ke") is True

    def test_any_tenant_subdomain_allowed(self, enabled):
        for h in ("novel-school.shulehq.co.ke", "a-school-created-tomorrow.shulehq.co.ke"):
            assert turnstile._hostname_allowed(h) is True

    def test_foreign_domain_rejected(self, enabled):
        assert turnstile._hostname_allowed("evil.com") is False

    def test_lookalike_suffix_rejected(self, enabled):
        # "notshulehq.co.ke" must not pass a naive endswith check.
        assert turnstile._hostname_allowed("notshulehq.co.ke") is False

    def test_token_solved_elsewhere_is_rejected(self, enabled, monkeypatch):
        _stub(monkeypatch, {"success": True, "hostname": "attacker.example.com"})
        r = turnstile.verify("tok")
        assert r.ok is False and r.reason == "hostname_mismatch"
