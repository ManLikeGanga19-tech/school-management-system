"""Phase 2 — Caddy on-demand TLS authorization endpoint.

Caddy calls GET /public/tls-authorize?domain=<host> before issuing a cert.
2xx authorizes; anything else refuses (protects Let's Encrypt rate limits
from abuse). We authorize fixed platform hosts + active-tenant subdomains
only.
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from tests.helpers import create_tenant


BASE_DOMAIN = "shulehq.co.ke"


def _set_base(monkeypatch):
    monkeypatch.setattr(settings, "CORS_BASE_DOMAIN", BASE_DOMAIN, raising=False)


class TestTlsAuthorize:
    def test_fixed_hosts_authorized(self, client: TestClient, db_session: Session, monkeypatch):
        _set_base(monkeypatch)
        for host in ("shulehq.co.ke", "www.shulehq.co.ke",
                     "api.shulehq.co.ke", "admin.shulehq.co.ke"):
            r = client.get(f"/api/v1/public/tls-authorize?domain={host}")
            assert r.status_code == 200, f"{host}: {r.text}"
            assert r.json()["reason"] == "fixed_host"

    def test_active_tenant_authorized(self, client: TestClient, db_session: Session, monkeypatch):
        _set_base(monkeypatch)
        create_tenant(db_session, slug="greenhill", name="Greenhill", is_active=True)
        r = client.get("/api/v1/public/tls-authorize?domain=greenhill.shulehq.co.ke")
        assert r.status_code == 200, r.text
        assert r.json()["reason"] == "active_tenant"

    def test_unknown_tenant_refused(self, client: TestClient, db_session: Session, monkeypatch):
        _set_base(monkeypatch)
        r = client.get("/api/v1/public/tls-authorize?domain=nosuch.shulehq.co.ke")
        assert r.status_code == 404

    def test_inactive_tenant_refused(self, client: TestClient, db_session: Session, monkeypatch):
        _set_base(monkeypatch)
        create_tenant(db_session, slug="closedschool", name="Closed", is_active=False)
        r = client.get("/api/v1/public/tls-authorize?domain=closedschool.shulehq.co.ke")
        assert r.status_code == 404

    def test_foreign_domain_refused(self, client: TestClient, db_session: Session, monkeypatch):
        _set_base(monkeypatch)
        r = client.get("/api/v1/public/tls-authorize?domain=evil.com")
        assert r.status_code == 404

    def test_nested_subdomain_refused(self, client: TestClient, db_session: Session, monkeypatch):
        """a.b.shulehq.co.ke must NOT authorize (single-label tenants only)."""
        _set_base(monkeypatch)
        create_tenant(db_session, slug="ok", name="OK", is_active=True)
        r = client.get("/api/v1/public/tls-authorize?domain=x.ok.shulehq.co.ke")
        assert r.status_code == 404

    def test_no_base_domain_refuses_safely(self, client: TestClient, db_session: Session, monkeypatch):
        monkeypatch.setattr(settings, "CORS_BASE_DOMAIN", "", raising=False)
        r = client.get("/api/v1/public/tls-authorize?domain=api.shulehq.co.ke")
        assert r.status_code == 503
