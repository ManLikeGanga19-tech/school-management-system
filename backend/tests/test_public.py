"""
Tests for public (prospect) endpoints:
  POST /api/v1/public/auth/register
  POST /api/v1/public/auth/login
  POST /api/v1/public/auth/oauth/google
  POST /api/v1/public/auth/refresh
  POST /api/v1/public/auth/logout
  GET  /api/v1/public/auth/me
  GET  /api/v1/public/requests
  POST /api/v1/public/requests
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

BASE = "/api/v1/public"
AUTH = f"{BASE}/auth"
REQUESTS = f"{BASE}/requests"

# Shared test secret used in dev/test env (see public/routes.py _expected_public_oauth_secret)
OAUTH_SECRET = "dev-public-oauth-bridge-secret"


def _register(client: TestClient, **kwargs) -> dict:
    """Register a prospect and return the response JSON."""
    defaults = {
        "full_name": "Test Prospect",
        "organization_name": "Test School",
        "email": f"{uuid4().hex[:8]}@prospect.com",
        "password": "ProspectPass1!",
    }
    defaults.update(kwargs)
    resp = client.post(f"{AUTH}/register", json=defaults)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _register_and_token(client: TestClient, email=None, password="ProspectPass1!") -> tuple[str, str]:
    email = email or f"{uuid4().hex[:8]}@prospect.com"
    data = _register(client, email=email, password=password)
    return email, data["access_token"]


# ── Registration ──────────────────────────────────────────────────────────────

class TestProspectRegister:
    def test_register_success(self, client: TestClient, db_session: Session):
        resp = client.post(
            f"{AUTH}/register",
            json={
                "full_name": "Alice School",
                "organization_name": "Alice Academy",
                "email": "alice@academy.com",
                "password": "Secure1234!",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "access_token" in data
        assert data["account"]["email"] == "alice@academy.com"

    def test_register_sets_refresh_cookie(self, client: TestClient, db_session: Session):
        resp = client.post(
            f"{AUTH}/register",
            json={
                "full_name": "Cookie Test",
                "organization_name": "Cookie School",
                "email": "cookie@test.com",
                "password": "CookiePass1!",
            },
        )
        assert resp.status_code == 201
        assert "sms_public_refresh" in resp.cookies

    def test_register_duplicate_email_returns_409(self, client: TestClient, db_session: Session):
        email = "dup@prospect.com"
        _register(client, email=email)
        resp = client.post(
            f"{AUTH}/register",
            json={
                "full_name": "Duplicate",
                "organization_name": "Dup Org",
                "email": email,
                "password": "DupPass1!",
            },
        )
        assert resp.status_code == 409

    def test_register_missing_fields_returns_422(self, client: TestClient, db_session: Session):
        resp = client.post(f"{AUTH}/register", json={"email": "incomplete@test.com"})
        assert resp.status_code == 422

    def test_register_rate_limit(self, client: TestClient, db_session: Session):
        unique_ip = f"203.0.113.{uuid4().int % 200 + 1}"
        for i in range(10):
            client.post(
                f"{AUTH}/register",
                json={
                    "full_name": f"Flood {i}",
                    "organization_name": "Flood Org",
                    "email": f"flood{i}@test.com",
                    "password": "FloodPass1!",
                },
                headers={"X-Forwarded-For": unique_ip},
            )
        resp = client.post(
            f"{AUTH}/register",
            json={
                "full_name": "Final Flood",
                "organization_name": "Flood Org",
                "email": "finalflood@test.com",
                "password": "FloodPass1!",
            },
            headers={"X-Forwarded-For": unique_ip},
        )
        assert resp.status_code == 429


# ── Login ──────────────────────────────────────────────────────────────────

class TestProspectLogin:
    def test_login_success(self, client: TestClient, db_session: Session):
        email, _ = _register_and_token(client, email="login@prospect.com", password="Login1234!")
        resp = client.post(
            f"{AUTH}/login",
            json={"email": email, "password": "Login1234!"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["account"]["email"] == email

    def test_login_wrong_password(self, client: TestClient, db_session: Session):
        email, _ = _register_and_token(client, email="wrongpass@prospect.com")
        resp = client.post(
            f"{AUTH}/login",
            json={"email": email, "password": "WrongPass999!"},
        )
        assert resp.status_code == 401

    def test_login_nonexistent_user(self, client: TestClient, db_session: Session):
        resp = client.post(
            f"{AUTH}/login",
            json={"email": "ghost@prospect.com", "password": "Test1234!"},
        )
        assert resp.status_code == 401

    def test_login_rate_limit(self, client: TestClient, db_session: Session):
        unique_ip = f"203.0.113.{uuid4().int % 200 + 1}"
        for i in range(10):
            client.post(
                f"{AUTH}/login",
                json={"email": f"ratelim{i}@test.com", "password": "Test1234!"},
                headers={"X-Forwarded-For": unique_ip},
            )
        resp = client.post(
            f"{AUTH}/login",
            json={"email": "ratelimfinal@test.com", "password": "Test1234!"},
            headers={"X-Forwarded-For": unique_ip},
        )
        assert resp.status_code == 429


# ── Google OAuth ──────────────────────────────────────────────────────────────

class TestProspectGoogleOAuth:
    def test_oauth_creates_new_account(self, client: TestClient, db_session: Session):
        resp = client.post(
            f"{AUTH}/oauth/google",
            json={
                "email": "google-user@gmail.com",
                "full_name": "Google User",
                "organization_name": "Google School",
                "provider_subject": "google-uid-12345",
            },
            headers={"X-Public-Oauth-Secret": OAUTH_SECRET},
        )
        assert resp.status_code == 200
        assert resp.json()["account"]["email"] == "google-user@gmail.com"

    def test_oauth_wrong_secret_returns_403(self, client: TestClient, db_session: Session):
        resp = client.post(
            f"{AUTH}/oauth/google",
            json={
                "email": "google-bad@gmail.com",
                "full_name": "Google Bad",
                "provider_subject": "uid-bad",
            },
            headers={"X-Public-Oauth-Secret": "wrong-secret"},
        )
        assert resp.status_code == 403

    def test_oauth_missing_secret_returns_403(self, client: TestClient, db_session: Session):
        resp = client.post(
            f"{AUTH}/oauth/google",
            json={
                "email": "google-nosecret@gmail.com",
                "full_name": "Google No Secret",
                "provider_subject": "uid-nosecret",
            },
        )
        assert resp.status_code == 403

    def test_oauth_idempotent_existing_account(self, client: TestClient, db_session: Session):
        """Second OAuth call for same email returns the existing account."""
        email = "google-repeat@gmail.com"
        for _ in range(2):
            resp = client.post(
                f"{AUTH}/oauth/google",
                json={
                    "email": email,
                    "full_name": "Repeat User",
                    "provider_subject": "uid-repeat",
                },
                headers={"X-Public-Oauth-Secret": OAUTH_SECRET},
            )
            assert resp.status_code == 200
            assert resp.json()["account"]["email"] == email


# ── Refresh ──────────────────────────────────────────────────────────────────

class TestProspectRefresh:
    def test_refresh_returns_new_access_token(self, client: TestClient, db_session: Session):
        reg = client.post(
            f"{AUTH}/register",
            json={
                "full_name": "Refresh Test",
                "organization_name": "Refresh Org",
                "email": "refresh@prospect.com",
                "password": "RefreshPass1!",
            },
        )
        assert reg.status_code == 201
        refresh_token = reg.cookies.get("sms_public_refresh")
        assert refresh_token

        resp = client.post(
            f"{AUTH}/refresh",
            cookies={"sms_public_refresh": refresh_token},
        )
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    def test_refresh_without_cookie_returns_401(self, client: TestClient, db_session: Session):
        resp = client.post(f"{AUTH}/refresh")
        assert resp.status_code == 401

    def test_refresh_garbage_token_returns_401(self, client: TestClient, db_session: Session):
        resp = client.post(
            f"{AUTH}/refresh",
            cookies={"sms_public_refresh": "not.a.valid.jwt"},
        )
        assert resp.status_code == 401


# ── Logout ────────────────────────────────────────────────────────────────────

class TestProspectLogout:
    def test_logout_clears_cookie(self, client: TestClient, db_session: Session):
        reg = client.post(
            f"{AUTH}/register",
            json={
                "full_name": "Logout Test",
                "organization_name": "Logout Org",
                "email": "logout@prospect.com",
                "password": "LogoutPass1!",
            },
        )
        assert reg.status_code == 201
        refresh_token = reg.cookies.get("sms_public_refresh")

        resp = client.post(
            f"{AUTH}/logout",
            cookies={"sms_public_refresh": refresh_token},
        )
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        set_cookie = resp.headers.get("set-cookie", "")
        assert "sms_public_refresh" in set_cookie

    def test_logout_without_cookie_succeeds(self, client: TestClient, db_session: Session):
        resp = client.post(f"{AUTH}/logout")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_revoked_refresh_token_cannot_be_reused(self, client: TestClient, db_session: Session):
        reg = client.post(
            f"{AUTH}/register",
            json={
                "full_name": "Revoke Test",
                "organization_name": "Revoke Org",
                "email": "revoke@prospect.com",
                "password": "RevokePass1!",
            },
        )
        refresh_token = reg.cookies.get("sms_public_refresh")

        client.post(
            f"{AUTH}/logout",
            cookies={"sms_public_refresh": refresh_token},
        )

        # Attempt refresh with revoked token
        resp = client.post(
            f"{AUTH}/refresh",
            cookies={"sms_public_refresh": refresh_token},
        )
        assert resp.status_code == 401


# ── Me ────────────────────────────────────────────────────────────────────────

class TestProspectMe:
    def test_me_returns_account_info(self, client: TestClient, db_session: Session):
        email, token = _register_and_token(client, email="me@prospect.com")
        resp = client.get(f"{AUTH}/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["account"]["email"] == email

    def test_me_no_auth_returns_401(self, client: TestClient, db_session: Session):
        resp = client.get(f"{AUTH}/me")
        assert resp.status_code == 401

    def test_me_invalid_token_returns_401(self, client: TestClient, db_session: Session):
        resp = client.get(
            f"{AUTH}/me", headers={"Authorization": "Bearer invalid.token.xyz"}
        )
        assert resp.status_code == 401


# ── Requests ──────────────────────────────────────────────────────────────────

class TestProspectRequests:
    def test_create_request(self, client: TestClient, db_session: Session):
        _, token = _register_and_token(client)
        resp = client.post(
            REQUESTS,
            json={"request_type": "DEMO", "notes": "Please demo your system"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["request_type"] == "DEMO"
        assert data["status"] == "NEW"

    def test_list_requests_returns_own(self, client: TestClient, db_session: Session):
        _, token = _register_and_token(client)
        client.post(
            REQUESTS,
            json={"request_type": "ENQUIRY"},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp = client.get(REQUESTS, headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert len(resp.json()) >= 1
        assert all(r["request_type"] in {"DEMO", "ENQUIRY", "SCHOOL_VISIT"} for r in resp.json())

    def test_list_requests_isolation(self, client: TestClient, db_session: Session):
        """User A's requests are not visible to User B."""
        _, token_a = _register_and_token(client)
        _, token_b = _register_and_token(client)

        client.post(
            REQUESTS,
            json={"request_type": "DEMO"},
            headers={"Authorization": f"Bearer {token_a}"},
        )

        resp = client.get(REQUESTS, headers={"Authorization": f"Bearer {token_b}"})
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    def test_create_request_invalid_type(self, client: TestClient, db_session: Session):
        _, token = _register_and_token(client)
        resp = client.post(
            REQUESTS,
            json={"request_type": "INVALID_TYPE"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 422

    def test_create_request_rate_limit(self, client: TestClient, db_session: Session):
        _, token = _register_and_token(client)
        unique_ip = f"203.0.113.{uuid4().int % 200 + 1}"

        for _ in range(10):
            client.post(
                REQUESTS,
                json={"request_type": "DEMO"},
                headers={"Authorization": f"Bearer {token}", "X-Forwarded-For": unique_ip},
            )

        resp = client.post(
            REQUESTS,
            json={"request_type": "DEMO"},
            headers={"Authorization": f"Bearer {token}", "X-Forwarded-For": unique_ip},
        )
        assert resp.status_code == 429

    def test_create_request_requires_auth(self, client: TestClient, db_session: Session):
        resp = client.post(REQUESTS, json={"request_type": "DEMO"})
        assert resp.status_code == 401
