"""Rate-limit keying must identify the real client, not the last proxy.

Regression cover for a production bug found 2026-07-23: behind
Cloudflare -> Caddy -> nginx -> backend, `get_remote_address` returned nginx's
container address for every request, so all unauthenticated traffic shared one
rate-limit bucket. Six teachers logging in within a minute meant the sixth got
429, and anyone could exhaust the single bucket from any IP and lock every
school out of logging in.
"""
from __future__ import annotations

from starlette.datastructures import Headers

from app.core.rate_limit import _client_ip, _tenant_or_ip_key


class _Req:
    """Minimal stand-in for a Starlette Request."""

    def __init__(self, headers: dict[str, str], peer: str = "172.18.0.5"):
        self.headers = Headers(headers)

        class _S:
            pass

        self.state = _S()

        class _C:
            host = peer

        self.client = _C()


class TestClientIp:
    def test_prefers_cloudflare_connecting_ip(self):
        r = _Req({"cf-connecting-ip": "41.90.1.2",
                  "x-forwarded-for": "10.0.0.1, 172.18.0.6"})
        assert _client_ip(r) == "41.90.1.2"

    def test_falls_back_to_leftmost_forwarded_for(self):
        # Left-most entry is the original client; later entries are proxies.
        r = _Req({"x-forwarded-for": "41.90.1.3, 172.18.0.6, 172.18.0.5"})
        assert _client_ip(r) == "41.90.1.3"

    def test_falls_back_to_peer_when_no_proxy_headers(self):
        r = _Req({}, peer="203.0.113.9")
        assert _client_ip(r) == "203.0.113.9"

    def test_blank_headers_do_not_win(self):
        r = _Req({"cf-connecting-ip": "   ", "x-forwarded-for": ""},
                 peer="203.0.113.10")
        assert _client_ip(r) == "203.0.113.10"

    def test_distinct_clients_get_distinct_keys(self):
        """The actual bug: two different users must not share a bucket."""
        a = _Req({"cf-connecting-ip": "41.90.1.10"})
        b = _Req({"cf-connecting-ip": "41.90.1.11"})
        assert _client_ip(a) != _client_ip(b)

    def test_same_proxy_different_clients_still_differ(self):
        """Both arrive via the same Caddy/nginx peer -- previously identical."""
        a = _Req({"cf-connecting-ip": "41.90.1.10"}, peer="172.18.0.5")
        b = _Req({"cf-connecting-ip": "41.90.1.11"}, peer="172.18.0.5")
        assert _tenant_or_ip_key(a) != _tenant_or_ip_key(b)


class TestTenantKeyStillWins:
    def test_authenticated_requests_key_by_tenant(self):
        """Tenant keying is deliberate: users behind shared/CGNAT addresses
        (common in Kenya) must not be penalised for each other's traffic."""
        r = _Req({"cf-connecting-ip": "41.90.1.12"})
        r.state.tenant_id = "abc-123"
        assert _tenant_or_ip_key(r) == "tenant:abc-123"

    def test_same_tenant_shares_one_bucket(self):
        a = _Req({"cf-connecting-ip": "41.90.1.13"})
        b = _Req({"cf-connecting-ip": "41.90.1.14"})
        a.state.tenant_id = b.state.tenant_id = "same-tenant"
        assert _tenant_or_ip_key(a) == _tenant_or_ip_key(b)
