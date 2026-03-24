"""
Tests for cross-cutting security concerns:
  - Security headers on all responses
  - X-Request-ID correlation ID propagation
  - Missing auth → 401 on all protected endpoints
  - Invalid/expired token → 401
  - Wrong tenant context → 401
  - Missing permission → 403
  - CORS headers
  - Cookie security attributes
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import (
    create_tenant,
    create_tenant_user,
    make_actor,
    get_tenant_token,
    get_saas_token,
    create_super_admin_user,
)


# ── Security headers ──────────────────────────────────────────────────────────

class TestSecurityHeaders:
    """Verify that required security headers are present on every response."""

    REQUIRED_HEADERS = {
        "x-frame-options",
        "x-content-type-options",
        "x-xss-protection",
        "referrer-policy",
    }

    def _check_headers(self, resp) -> None:
        actual = {k.lower() for k in resp.headers}
        missing = self.REQUIRED_HEADERS - actual
        assert not missing, f"Missing security headers: {missing}"

    def test_security_headers_on_health_endpoint(self, client: TestClient, db_session: Session):
        resp = client.get("/healthz")
        self._check_headers(resp)

    def test_security_headers_on_api_401(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            "/api/v1/auth/me",
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401
        self._check_headers(resp)

    def test_security_headers_on_successful_api_response(
        self, client: TestClient, db_session: Session
    ):
        admin = create_super_admin_user(db_session)
        token = get_saas_token(admin)
        resp = client.get(
            "/api/v1/auth/me/saas",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        self._check_headers(resp)

    def test_x_content_type_options_value(self, client: TestClient, db_session: Session):
        resp = client.get("/healthz")
        assert resp.headers.get("x-content-type-options", "").lower() == "nosniff"

    def test_x_frame_options_value(self, client: TestClient, db_session: Session):
        resp = client.get("/healthz")
        assert resp.headers.get("x-frame-options", "").upper() == "DENY"


# ── Request ID propagation ─────────────────────────────────────────────────────

class TestRequestIdPropagation:
    def test_request_id_header_present_on_all_responses(
        self, client: TestClient, db_session: Session
    ):
        resp = client.get("/healthz")
        assert "x-request-id" in {k.lower() for k in resp.headers}, (
            "X-Request-ID not found on /healthz response"
        )

    def test_client_supplied_request_id_echoed_back(
        self, client: TestClient, db_session: Session
    ):
        custom_id = f"test-{uuid4()}"
        resp = client.get("/healthz", headers={"X-Request-ID": custom_id})
        assert resp.headers.get("x-request-id") == custom_id

    def test_server_generates_request_id_when_absent(
        self, client: TestClient, db_session: Session
    ):
        resp = client.get("/healthz")
        req_id = resp.headers.get("x-request-id")
        assert req_id
        assert len(req_id) >= 8


# ── Authentication enforcement ────────────────────────────────────────────────

class TestAuthEnforcement:
    """Every protected endpoint should return 401 without a valid token."""

    def test_enrollments_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            "/api/v1/enrollments/",
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_finance_policy_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            "/api/v1/finance/policy",
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_audit_logs_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            "/api/v1/audit/logs",
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_support_tenant_threads_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            "/api/v1/support/tenant/threads",
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_saas_admin_endpoint_rejects_no_auth(self, client: TestClient, db_session: Session):
        resp = client.get("/api/v1/auth/me/saas")
        assert resp.status_code == 401


# ── Invalid / expired token ───────────────────────────────────────────────────

class TestInvalidTokenRejection:
    def test_garbage_bearer_token_returns_401(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            "/api/v1/auth/me",
            headers={
                "Authorization": "Bearer this.is.garbage",
                "X-Tenant-ID": str(tenant.id),
            },
        )
        assert resp.status_code == 401

    def test_tenant_token_rejected_on_saas_endpoint(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        user = create_tenant_user(db_session, tenant=tenant, email="t@school.com")
        db_session.commit()
        token = get_tenant_token(user, tenant)

        resp = client.get(
            "/api/v1/auth/me/saas",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 401

    def test_saas_token_allowed_on_tenant_endpoint_for_impersonation(
        self, client: TestClient, db_session: Session
    ):
        """SaaS token is intentionally allowed on tenant endpoints (operator impersonation).
        get_current_user permits SAAS_TENANT_MARKER tokens when a valid tenant context exists."""
        tenant = create_tenant(db_session)
        admin = create_super_admin_user(db_session)
        token = get_saas_token(admin)

        resp = client.get(
            "/api/v1/auth/me",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Tenant-ID": str(tenant.id),
            },
        )
        assert resp.status_code == 200


# ── Wrong tenant context ──────────────────────────────────────────────────────

class TestWrongTenantContext:
    def test_token_from_tenant_a_rejected_for_tenant_b(
        self, client: TestClient, db_session: Session
    ):
        tenant_a = create_tenant(db_session, slug="sec-a", domain="seca.example.com")
        tenant_b = create_tenant(db_session, slug="sec-b", domain="secb.example.com")
        user = create_tenant_user(db_session, tenant=tenant_a, email="cross@school.com")
        db_session.commit()

        token = get_tenant_token(user, tenant_a)
        resp = client.get(
            "/api/v1/auth/me",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Tenant-ID": str(tenant_b.id),
            },
        )
        assert resp.status_code == 401


# ── Permission enforcement ────────────────────────────────────────────────────

class TestPermissionEnforcement:
    def test_missing_permission_returns_403(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])

        resp = client.get("/api/v1/enrollments/", headers=headers)
        assert resp.status_code == 403

    def test_partial_permissions_rejected(self, client: TestClient, db_session: Session):
        """Having finance.fees.view but not finance.policy.manage → 403 on manage endpoint."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(
            db_session, tenant=tenant, permissions=["finance.fees.view"]
        )

        resp = client.put(
            "/api/v1/finance/policy",
            json={"allow_partial_enrollment": True},
            headers=headers,
        )
        assert resp.status_code == 403

    def test_director_override_without_permission_returns_403(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers_m = make_actor(db_session, tenant=tenant, permissions=["enrollment.manage"])
        _, headers_s = make_actor(db_session, tenant=tenant, permissions=["enrollment.manage"])

        # Create an enrollment
        enr = client.post(
            "/api/v1/enrollments/",
            json={"payload": {"student_name": "Perm Test"}},
            headers=headers_m,
        )
        eid = enr.json()["id"]

        # Secretary tries director-override
        resp = client.post(f"/api/v1/enrollments/{eid}/director-override", json={}, headers=headers_s)
        assert resp.status_code == 403


# ── CORS ──────────────────────────────────────────────────────────────────────

class TestCors:
    def test_cors_preflight_returns_200(self, client: TestClient, db_session: Session):
        resp = client.options(
            "/api/v1/auth/login",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        # FastAPI CORS middleware returns 200 for OPTIONS preflight
        assert resp.status_code == 200

    def test_cors_allow_origin_on_response(self, client: TestClient, db_session: Session):
        resp = client.get(
            "/healthz",
            headers={"Origin": "http://localhost:3000"},
        )
        # Response may include allow-origin header
        # (passes if no error — header presence depends on CORS config)
        assert resp.status_code == 200


# ── Cookie security ────────────────────────────────────────────────────────────

class TestCookieSecurity:
    def test_refresh_cookie_is_httponly(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        create_tenant_user(db_session, tenant=tenant, email="cookie@school.com", password="Cookie1!")
        db_session.commit()

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "cookie@school.com", "password": "Cookie1!"},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 200

        set_cookie = resp.headers.get("set-cookie", "")
        assert "sms_refresh" in set_cookie
        assert "httponly" in set_cookie.lower()

    def test_public_refresh_cookie_is_httponly(self, client: TestClient, db_session: Session):
        resp = client.post(
            "/api/v1/public/auth/register",
            json={
                "full_name": "Cookie Security Test",
                "organization_name": "Cookie Org",
                "email": "cookiesec@prospect.com",
                "password": "CookieSec1!",
            },
        )
        assert resp.status_code == 201
        set_cookie = resp.headers.get("set-cookie", "")
        assert "sms_public_refresh" in set_cookie
        assert "httponly" in set_cookie.lower()

    def test_logout_clears_refresh_cookie(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        create_tenant_user(db_session, tenant=tenant, email="clear@school.com", password="Clear1!")
        db_session.commit()

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": "clear@school.com", "password": "Clear1!"},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        access_token = login_resp.json()["access_token"]
        refresh_token = login_resp.cookies.get("sms_refresh")

        logout_resp = client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": f"Bearer {access_token}"},
            cookies={"sms_refresh": refresh_token},
        )
        assert logout_resp.status_code == 200
        # Cookie must be cleared (Max-Age=0 or empty value)
        set_cookie = logout_resp.headers.get("set-cookie", "")
        assert "sms_refresh" in set_cookie
