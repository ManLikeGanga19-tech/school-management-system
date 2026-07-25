"""A demo tenant must be provably read-only.

The demo login's credentials are published on the marketing site, so the ONLY
safe design is one where those credentials cannot mutate anything. The guard
lives in the tenant middleware (before routing/auth), so no write ever reaches
the application for a demo tenant. These tests pin that guarantee.
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant

READONLY_MARKER = "read-only demo"


def _make_demo(db: Session, slug: str = "demo-test"):
    t = create_tenant(db, slug=slug, name="Demo School")
    t.is_demo = True
    db.commit()
    return t


class TestDemoIsReadOnly:
    def test_write_is_blocked_before_reaching_the_app(self, client: TestClient, db_session: Session):
        # Middleware runs before routing/auth, so ANY write is refused with 403
        # regardless of endpoint or credentials.
        t = _make_demo(db_session)
        for method, path in [
            ("POST", "/api/v1/students"),
            ("PATCH", "/api/v1/students/whatever/biodata"),
            ("DELETE", "/api/v1/students/whatever"),
            ("PUT", "/api/v1/tenants/me"),
        ]:
            r = client.request(method, path, headers={"X-Tenant-ID": str(t.id)})
            assert r.status_code == 403, f"{method} {path} -> {r.status_code}"
            assert READONLY_MARKER in r.text.lower(), r.text

    def test_reads_are_allowed_through_the_guard(self, client: TestClient, db_session: Session):
        # GET is not blocked: it passes the demo guard and proceeds to auth
        # (401 here, since no token) — crucially NOT the 403 read-only refusal.
        t = _make_demo(db_session, slug="demo-read")
        r = client.get("/api/v1/tenants/whoami", headers={"X-Tenant-ID": str(t.id)})
        assert r.status_code != 403
        assert READONLY_MARKER not in r.text.lower()

    def test_login_is_exempt(self, client: TestClient, db_session: Session):
        # The demo user must be able to log in — the one write the guard allows.
        # Bad credentials give 401 (or 403 invalid-turnstile), never the
        # read-only refusal.
        t = _make_demo(db_session, slug="demo-login")
        r = client.post(
            "/api/v1/auth/login",
            headers={"X-Tenant-ID": str(t.id)},
            json={"email": "nobody@example.com", "password": "wrong"},
        )
        assert READONLY_MARKER not in r.text.lower()
        assert r.status_code in (401, 422)  # reached auth, not blocked as read-only


class TestNonDemoUnaffected:
    def test_normal_tenant_write_not_blocked_by_demo_guard(self, client: TestClient, db_session: Session):
        # A normal tenant's write passes the demo guard and hits auth (401),
        # proving the guard targets only demo tenants.
        t = create_tenant(db_session, slug="real-school", name="Real School")
        r = client.post("/api/v1/students", headers={"X-Tenant-ID": str(t.id)}, json={})
        assert READONLY_MARKER not in r.text.lower()
        assert r.status_code != 403 or "read-only" not in r.text.lower()
