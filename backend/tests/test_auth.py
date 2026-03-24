"""
Tests for authentication endpoints:
  POST /api/v1/auth/login          (tenant)
  POST /api/v1/auth/login/saas     (SaaS admin)
  POST /api/v1/auth/refresh
  POST /api/v1/auth/refresh/saas
  POST /api/v1/auth/logout
  POST /api/v1/auth/logout/saas
  GET  /api/v1/auth/me
  GET  /api/v1/auth/me/saas
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import (
    create_super_admin_user,
    create_tenant,
    create_tenant_user,
    create_role,
    get_saas_token,
    get_tenant_token,
    make_actor,
)


# ── Tenant login ───────────────────────────────────────────────────────────────

class TestTenantLogin:
    def test_login_success(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        user = create_tenant_user(
            db_session, tenant=tenant, email="sec@school.com", password="MyPass1234!"
        )
        db_session.commit()

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "sec@school.com", "password": "MyPass1234!"},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "access_token" in data
        assert data["access_token"]

    def test_login_wrong_password(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        create_tenant_user(db_session, tenant=tenant, email="user@school.com", password="Correct1!")
        db_session.commit()

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "user@school.com", "password": "Wrong1234!"},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_login_nonexistent_user(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "ghost@school.com", "password": "Test1234!"},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_login_inactive_user(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        create_tenant_user(
            db_session, tenant=tenant, email="inactive@school.com",
            password="Test1234!", is_active=False,
        )
        db_session.commit()

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "inactive@school.com", "password": "Test1234!"},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_login_missing_tenant_context(self, client: TestClient, db_session: Session):
        # No X-Tenant-ID header → TenantMiddleware rejects
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "user@school.com", "password": "Test1234!"},
        )
        assert resp.status_code in {400, 422}

    def test_login_sets_refresh_cookie(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        create_tenant_user(db_session, tenant=tenant, email="u@school.com", password="Pass1234!")
        db_session.commit()

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "u@school.com", "password": "Pass1234!"},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 200
        assert "sms_refresh" in resp.cookies

    def test_login_rate_limit(self, client: TestClient, db_session: Session):
        """6 rapid login attempts from the same IP must trigger 429."""
        tenant = create_tenant(db_session)
        unique_ip = f"203.0.113.{uuid4().int % 200 + 1}"  # RFC 5737 documentation range

        for i in range(5):
            client.post(
                "/api/v1/auth/login",
                json={"email": f"user{i}@school.com", "password": "Test1234!"},
                headers={"X-Tenant-ID": str(tenant.id), "X-Forwarded-For": unique_ip},
            )

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "final@school.com", "password": "Test1234!"},
            headers={"X-Tenant-ID": str(tenant.id), "X-Forwarded-For": unique_ip},
        )
        assert resp.status_code == 429


# ── SaaS login ────────────────────────────────────────────────────────────────

class TestSaasLogin:
    def test_saas_login_success(self, client: TestClient, db_session: Session):
        admin = create_super_admin_user(db_session)
        # Need a real password hash — create_super_admin_user uses hash_password("Admin1234!")
        resp = client.post(
            "/api/v1/auth/login/saas",
            json={"email": admin.email, "password": "Admin1234!"},
        )
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    def test_saas_login_wrong_password(self, client: TestClient, db_session: Session):
        create_super_admin_user(db_session)
        resp = client.post(
            "/api/v1/auth/login/saas",
            json={"email": "admin@example.com", "password": "wrongpassword"},
        )
        assert resp.status_code == 401

    def test_saas_login_non_admin_user_rejected(self, client: TestClient, db_session: Session):
        """Users without SUPER_ADMIN role cannot log in via the SaaS endpoint."""
        tenant = create_tenant(db_session)
        create_tenant_user(
            db_session, tenant=tenant, email="secretary@school.com", password="Pass1234!"
        )
        db_session.commit()

        resp = client.post(
            "/api/v1/auth/login/saas",
            json={"email": "secretary@school.com", "password": "Pass1234!"},
        )
        assert resp.status_code == 401

    def test_saas_login_rate_limit(self, client: TestClient, db_session: Session):
        unique_ip = f"203.0.113.{uuid4().int % 200 + 1}"
        for i in range(5):
            client.post(
                "/api/v1/auth/login/saas",
                json={"email": f"a{i}@example.com", "password": "Test1234!"},
                headers={"X-Forwarded-For": unique_ip},
            )
        resp = client.post(
            "/api/v1/auth/login/saas",
            json={"email": "final@example.com", "password": "Test1234!"},
            headers={"X-Forwarded-For": unique_ip},
        )
        assert resp.status_code == 429


# ── Token refresh ─────────────────────────────────────────────────────────────

class TestTokenRefresh:
    def _get_refresh_cookie(self, client, tenant, email, password):
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 200, resp.text
        return resp.cookies.get("sms_refresh")

    def test_refresh_returns_new_access_token(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        create_tenant_user(db_session, tenant=tenant, email="r@school.com", password="Refresh1!")
        db_session.commit()

        refresh_token = self._get_refresh_cookie(client, tenant, "r@school.com", "Refresh1!")
        assert refresh_token, "Expected refresh cookie after login"

        resp = client.post(
            "/api/v1/auth/refresh",
            cookies={"sms_refresh": refresh_token},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["access_token"]

    def test_refresh_without_cookie_returns_401(self, client: TestClient, db_session: Session):
        resp = client.post("/api/v1/auth/refresh")
        assert resp.status_code == 401

    def test_refresh_with_garbage_token_returns_401(self, client: TestClient, db_session: Session):
        resp = client.post(
            "/api/v1/auth/refresh",
            cookies={"sms_refresh": "not.a.real.jwt"},
        )
        assert resp.status_code == 401


# ── Logout ────────────────────────────────────────────────────────────────────

class TestLogout:
    def test_logout_clears_refresh_cookie(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        create_tenant_user(db_session, tenant=tenant, email="lo@school.com", password="Logout1!")
        db_session.commit()

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": "lo@school.com", "password": "Logout1!"},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert login_resp.status_code == 200
        access_token = login_resp.json()["access_token"]
        refresh_token = login_resp.cookies.get("sms_refresh")

        logout_resp = client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": f"Bearer {access_token}"},
            cookies={"sms_refresh": refresh_token},
        )
        assert logout_resp.status_code == 200
        assert logout_resp.json() == {"ok": True}
        # Cookie should be cleared (set to empty or Max-Age=0)
        set_cookie = logout_resp.headers.get("set-cookie", "")
        assert "sms_refresh" in set_cookie

    def test_logout_without_tokens_still_succeeds(self, client: TestClient, db_session: Session):
        """Logout is always idempotent — clear cookie even with no tokens."""
        resp = client.post("/api/v1/auth/logout")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_saas_logout_clears_cookie(self, client: TestClient, db_session: Session):
        admin = create_super_admin_user(db_session)
        login_resp = client.post(
            "/api/v1/auth/login/saas",
            json={"email": admin.email, "password": "Admin1234!"},
        )
        assert login_resp.status_code == 200
        access_token = login_resp.json()["access_token"]
        refresh_token = login_resp.cookies.get("sms_refresh")

        logout_resp = client.post(
            "/api/v1/auth/logout/saas",
            headers={"Authorization": f"Bearer {access_token}"},
            cookies={"sms_refresh": refresh_token},
        )
        assert logout_resp.status_code == 200
        assert logout_resp.json() == {"ok": True}


# ── /me endpoints ──────────────────────────────────────────────────────────────

class TestMeEndpoints:
    def test_me_returns_user_info(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(
            db_session, tenant=tenant, permissions=[], email="me@school.com"
        )
        resp = client.get("/api/v1/auth/me", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["user"]["email"] == "me@school.com"
        assert data["tenant"]["id"] == str(tenant.id)

    def test_me_without_auth_returns_401(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            "/api/v1/auth/me", headers={"X-Tenant-ID": str(tenant.id)}
        )
        assert resp.status_code == 401

    def test_me_saas_returns_admin_info(self, client: TestClient, db_session: Session):
        admin = create_super_admin_user(db_session)
        token = get_saas_token(admin)
        resp = client.get("/api/v1/auth/me/saas", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == admin.email
        assert data["mode"] == "saas"

    def test_me_saas_with_tenant_token_rejected(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        user = create_tenant_user(db_session, tenant=tenant, email="t@school.com")
        db_session.commit()
        token = get_tenant_token(user, tenant)
        resp = client.get("/api/v1/auth/me/saas", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401

    def test_me_invalid_token_returns_401(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer invalid.token.here", "X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_me_tenant_token_on_wrong_tenant_returns_401(self, client, db_session):
        tenant_a = create_tenant(db_session, slug="tenant-a", domain="a.example.com")
        tenant_b = create_tenant(db_session, slug="tenant-b", domain="b.example.com")
        user = create_tenant_user(db_session, tenant=tenant_a, email="u@a.com")
        db_session.commit()

        # Token issued for tenant_a but request carries tenant_b context
        token = get_tenant_token(user, tenant_a)
        resp = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}", "X-Tenant-ID": str(tenant_b.id)},
        )
        assert resp.status_code == 401
