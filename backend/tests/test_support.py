"""
Tests for support (contact admin) endpoints:
  GET  /api/v1/support/tenant/unread-count
  GET  /api/v1/support/tenant/threads
  POST /api/v1/support/tenant/threads
  GET  /api/v1/support/tenant/threads/{id}/messages
  POST /api/v1/support/tenant/threads/{id}/messages
  POST /api/v1/support/tenant/threads/{id}/read
  GET  /api/v1/support/admin/unread-count  (SaaS)
  GET  /api/v1/support/admin/threads       (SaaS)
  POST /api/v1/support/admin/threads/{id}/messages   (SaaS)
  POST /api/v1/support/admin/threads/{id}/read       (SaaS)
  PATCH /api/v1/support/admin/threads/{id}           (SaaS)
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import (
    create_super_admin_user,
    create_tenant,
    make_actor,
    get_saas_token,
)

BASE = "/api/v1/support"
TENANT_BASE = f"{BASE}/tenant"
ADMIN_BASE = f"{BASE}/admin"

# Roles that grant access to the tenant support UI
DIRECTOR_ROLE = ["enrollment.manage"]  # needs role name DIRECTOR in the role code
SECRETARY_ROLE = ["enrollment.manage"]


def _make_director_headers(db_session, tenant):
    """Create a user with DIRECTOR role code so require_tenant_support_actor passes."""
    from tests.helpers import create_role, create_tenant_user, get_tenant_token

    role = create_role(db_session, "DIRECTOR", tenant_id=tenant.id)
    user = create_tenant_user(db_session, tenant=tenant, email=f"{uuid4().hex[:6]}@dir.com", role=role)
    db_session.commit()
    token = get_tenant_token(user, tenant, roles=["DIRECTOR"])
    return {"Authorization": f"Bearer {token}", "X-Tenant-ID": str(tenant.id)}


def _create_thread(client, headers, subject="Test Issue") -> dict:
    resp = client.post(
        f"{TENANT_BASE}/threads",
        json={"subject": subject, "priority": "NORMAL", "message": "Hello, I need help."},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── Tenant-side support ───────────────────────────────────────────────────────

class TestTenantSupport:
    def test_create_thread(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        headers = _make_director_headers(db_session, tenant)

        resp = client.post(
            f"{TENANT_BASE}/threads",
            json={"subject": "Billing Question", "priority": "HIGH", "message": "Urgent!"},
            headers=headers,
        )
        assert resp.status_code == 200
        thread = resp.json()
        assert thread["subject"] == "Billing Question"
        assert thread["priority"] == "HIGH"

    def test_list_threads(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        headers = _make_director_headers(db_session, tenant)

        _create_thread(client, headers, subject="Thread 1")
        _create_thread(client, headers, subject="Thread 2")

        resp = client.get(f"{TENANT_BASE}/threads", headers=headers)
        assert resp.status_code == 200
        subjects = [t["subject"] for t in resp.json()]
        assert "Thread 1" in subjects
        assert "Thread 2" in subjects

    def test_tenant_isolation(self, client: TestClient, db_session: Session):
        tenant_a = create_tenant(db_session, slug="sup-a", domain="supa.example.com")
        tenant_b = create_tenant(db_session, slug="sup-b", domain="supb.example.com")
        headers_a = _make_director_headers(db_session, tenant_a)
        headers_b = _make_director_headers(db_session, tenant_b)

        _create_thread(client, headers_a, subject="Only Tenant A Thread")

        resp = client.get(f"{TENANT_BASE}/threads", headers=headers_b)
        assert resp.status_code == 200
        subjects = [t["subject"] for t in resp.json()]
        assert "Only Tenant A Thread" not in subjects

    def test_send_message_to_thread(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        headers = _make_director_headers(db_session, tenant)
        thread = _create_thread(client, headers)
        thread_id = thread["id"]

        resp = client.post(
            f"{TENANT_BASE}/threads/{thread_id}/messages",
            json={"message": "Follow-up message"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["body"] == "Follow-up message"

    def test_list_messages(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        headers = _make_director_headers(db_session, tenant)
        thread = _create_thread(client, headers)
        thread_id = thread["id"]

        client.post(
            f"{TENANT_BASE}/threads/{thread_id}/messages",
            json={"message": "Additional message"},
            headers=headers,
        )

        resp = client.get(f"{TENANT_BASE}/threads/{thread_id}/messages", headers=headers)
        assert resp.status_code == 200
        msgs = resp.json()
        assert len(msgs) >= 1  # At least the opening message from thread creation

    def test_mark_thread_read(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        headers = _make_director_headers(db_session, tenant)
        thread = _create_thread(client, headers)
        thread_id = thread["id"]

        resp = client.post(f"{TENANT_BASE}/threads/{thread_id}/read", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert resp.json()["thread_id"] == thread_id

    def test_unread_count(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        headers = _make_director_headers(db_session, tenant)

        resp = client.get(f"{TENANT_BASE}/unread-count", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "unread_count" in data
        assert isinstance(data["unread_count"], int)

    def test_create_thread_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.post(
            f"{TENANT_BASE}/threads",
            json={"subject": "Test", "priority": "NORMAL", "message": "Hi"},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_non_director_secretary_role_rejected(self, client: TestClient, db_session: Session):
        """Users without DIRECTOR/SECRETARY/SUPER_ADMIN role → 403."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=["enrollment.manage"])
        # Role code is a random TEST_ROLE_xxx — not DIRECTOR/SECRETARY
        resp = client.get(f"{TENANT_BASE}/threads", headers=headers)
        assert resp.status_code == 403


# ── Admin (SaaS) support ─────────────────────────────────────────────────────

class TestAdminSupport:
    def _saas_headers(self, db_session) -> dict:
        admin = create_super_admin_user(db_session)
        token = get_saas_token(admin)
        return {"Authorization": f"Bearer {token}"}

    def test_admin_unread_count(self, client: TestClient, db_session: Session):
        headers = self._saas_headers(db_session)
        resp = client.get(f"{ADMIN_BASE}/unread-count", headers=headers)
        assert resp.status_code == 200
        assert "unread_count" in resp.json()

    def test_admin_list_threads(self, client: TestClient, db_session: Session):
        headers = self._saas_headers(db_session)
        resp = client.get(f"{ADMIN_BASE}/threads", headers=headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_admin_sees_all_tenant_threads(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        tenant_headers = _make_director_headers(db_session, tenant)
        _create_thread(client, tenant_headers, subject="Cross-Tenant Thread")

        admin_headers = self._saas_headers(db_session)
        resp = client.get(f"{ADMIN_BASE}/threads", headers=admin_headers)
        assert resp.status_code == 200
        subjects = [t["subject"] for t in resp.json()]
        assert "Cross-Tenant Thread" in subjects

    def test_admin_send_reply(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        tenant_headers = _make_director_headers(db_session, tenant)
        thread = _create_thread(client, tenant_headers)
        thread_id = thread["id"]

        admin_headers = self._saas_headers(db_session)
        resp = client.post(
            f"{ADMIN_BASE}/threads/{thread_id}/messages",
            json={"message": "Admin response here"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["body"] == "Admin response here"

    def test_admin_mark_thread_read(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        tenant_headers = _make_director_headers(db_session, tenant)
        thread = _create_thread(client, tenant_headers)
        thread_id = thread["id"]

        admin_headers = self._saas_headers(db_session)
        resp = client.post(
            f"{ADMIN_BASE}/threads/{thread_id}/read",
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_admin_update_thread_status(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        tenant_headers = _make_director_headers(db_session, tenant)
        thread = _create_thread(client, tenant_headers)
        thread_id = thread["id"]

        admin_headers = self._saas_headers(db_session)
        resp = client.patch(
            f"{ADMIN_BASE}/threads/{thread_id}",
            json={"status": "RESOLVED"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "RESOLVED"

    def test_admin_endpoints_reject_tenant_token(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, tenant_headers = make_actor(db_session, tenant=tenant, permissions=["admin.dashboard.view_all"])
        resp = client.get(f"{ADMIN_BASE}/threads", headers=tenant_headers)
        # SaaS endpoint requires SAAS_TENANT_MARKER in token
        assert resp.status_code == 401
