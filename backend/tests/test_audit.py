"""
Tests for audit log endpoints:
  GET /api/v1/audit/logs
  GET /api/v1/audit/logs/{id}
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

BASE = "/api/v1/audit"
AUDIT_READ = ["audit.read"]
TENANT_READ_ALL = ["audit.read", "tenants.read_all"]


def _write_audit_event(db_session, tenant_id, action="test.action"):
    """Write a raw audit log entry for testing."""
    from app.core.audit import log_event
    log_event(
        db_session,
        tenant_id=tenant_id,
        actor_user_id=None,
        action=action,
        resource="test",
        resource_id=None,
        payload={"detail": "test audit entry"},
        meta=None,
    )
    db_session.commit()


# ── List audit logs ───────────────────────────────────────────────────────────

class TestListAuditLogs:
    def test_list_logs_returns_events(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=AUDIT_READ)
        _write_audit_event(db_session, tenant.id, action="enrollment.created")

        resp = client.get(f"{BASE}/logs", headers=headers)
        assert resp.status_code == 200
        actions = [r["action"] for r in resp.json()]
        assert "enrollment.created" in actions

    def test_list_logs_tenant_isolation(self, client: TestClient, db_session: Session):
        tenant_a = create_tenant(db_session, slug="aud-a", domain="auda.example.com")
        tenant_b = create_tenant(db_session, slug="aud-b", domain="audb.example.com")

        _, headers_a = make_actor(db_session, tenant=tenant_a, permissions=AUDIT_READ)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=AUDIT_READ)

        _write_audit_event(db_session, tenant_a.id, action="tenant_a.secret_event")

        resp = client.get(f"{BASE}/logs", headers=headers_b)
        assert resp.status_code == 200
        actions = [r["action"] for r in resp.json()]
        assert "tenant_a.secret_event" not in actions

    def test_list_logs_filter_by_action(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=AUDIT_READ)
        _write_audit_event(db_session, tenant.id, action="enrollment.submitted")
        _write_audit_event(db_session, tenant.id, action="enrollment.approved")

        resp = client.get(f"{BASE}/logs?action=enrollment.submitted", headers=headers)
        assert resp.status_code == 200
        for row in resp.json():
            assert row["action"] == "enrollment.submitted"

    def test_list_logs_http_events_excluded_by_default(
        self, client: TestClient, db_session: Session
    ):
        """HTTP request logs are excluded by default."""
        from uuid import uuid4 as _uuid4
        from app.models.audit_log import AuditLog

        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=AUDIT_READ)

        # Manually insert an http.request audit entry
        http_log = AuditLog(
            id=_uuid4(),
            tenant_id=tenant.id,
            actor_user_id=None,
            action="http.request",
            resource="http",
            resource_id=None,
            payload={},
            meta={},
        )
        db_session.add(http_log)
        db_session.commit()

        resp = client.get(f"{BASE}/logs", headers=headers)
        assert resp.status_code == 200
        actions = [r["action"] for r in resp.json()]
        assert "http.request" not in actions

    def test_list_logs_include_http_events(self, client: TestClient, db_session: Session):
        from uuid import uuid4 as _uuid4
        from app.models.audit_log import AuditLog

        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=AUDIT_READ)

        http_log = AuditLog(
            id=_uuid4(),
            tenant_id=tenant.id,
            actor_user_id=None,
            action="http.request",
            resource="http",
            resource_id=None,
            payload={},
            meta={},
        )
        db_session.add(http_log)
        db_session.commit()

        resp = client.get(f"{BASE}/logs?include_http_events=true", headers=headers)
        assert resp.status_code == 200
        actions = [r["action"] for r in resp.json()]
        assert "http.request" in actions

    def test_list_logs_pagination(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=AUDIT_READ)

        for i in range(5):
            _write_audit_event(db_session, tenant.id, action=f"test.event.{i}")

        page1 = client.get(f"{BASE}/logs?limit=3&offset=0", headers=headers)
        page2 = client.get(f"{BASE}/logs?limit=3&offset=3", headers=headers)
        assert page1.status_code == 200
        assert page2.status_code == 200
        assert len(page1.json()) == 3
        ids1 = {r["id"] for r in page1.json()}
        ids2 = {r["id"] for r in page2.json()}
        assert ids1.isdisjoint(ids2)

    def test_list_logs_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            f"{BASE}/logs", headers={"X-Tenant-ID": str(tenant.id)}
        )
        assert resp.status_code == 401

    def test_list_logs_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get(f"{BASE}/logs", headers=headers)
        assert resp.status_code == 403


# ── Get single log ────────────────────────────────────────────────────────────

class TestGetAuditLog:
    def test_get_log_by_id(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=AUDIT_READ)
        _write_audit_event(db_session, tenant.id, action="specific.action")

        list_resp = client.get(f"{BASE}/logs?action=specific.action", headers=headers)
        assert list_resp.status_code == 200
        logs = list_resp.json()
        assert len(logs) >= 1
        log_id = logs[0]["id"]

        resp = client.get(f"{BASE}/logs/{log_id}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == log_id
        assert resp.json()["action"] == "specific.action"

    def test_get_log_not_found(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=AUDIT_READ)

        resp = client.get(f"{BASE}/logs/{uuid4()}", headers=headers)
        assert resp.status_code == 404

    def test_get_log_cross_tenant_returns_403(self, client: TestClient, db_session: Session):
        """Non-SaaS user cannot fetch audit log belonging to a different tenant."""
        tenant_a = create_tenant(db_session, slug="cross-a", domain="crossa.example.com")
        tenant_b = create_tenant(db_session, slug="cross-b", domain="crossb.example.com")

        _, headers_a = make_actor(db_session, tenant=tenant_a, permissions=AUDIT_READ)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=AUDIT_READ)

        _write_audit_event(db_session, tenant_a.id, action="tenant_a.event")
        list_resp = client.get(f"{BASE}/logs?action=tenant_a.event", headers=headers_a)
        log_id = list_resp.json()[0]["id"]

        # Tenant B tries to access Tenant A's log
        resp = client.get(f"{BASE}/logs/{log_id}", headers=headers_b)
        assert resp.status_code in {403, 404}


# ── SaaS cross-tenant query ───────────────────────────────────────────────────

class TestSaasAuditAccess:
    def test_saas_can_query_any_tenant_logs(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        admin = create_super_admin_user(db_session)
        token = get_saas_token(admin)
        saas_headers = {"Authorization": f"Bearer {token}", "X-Tenant-ID": str(tenant.id)}

        _write_audit_event(db_session, tenant.id, action="saas.visible.event")

        resp = client.get(f"{BASE}/logs", headers=saas_headers)
        assert resp.status_code == 200
        actions = [r["action"] for r in resp.json()]
        assert "saas.visible.event" in actions

    def test_saas_requires_audit_read_permission(self, client: TestClient, db_session: Session):
        """SaaS user without SUPER_ADMIN role and without audit.read permission is rejected."""
        from tests.helpers import create_user, get_saas_token_with_claims
        tenant = create_tenant(db_session)
        # Use a plain user (not SUPER_ADMIN) so the permission check is enforced.
        user = create_user(db_session, email="saas-noperm@test.com")
        db_session.commit()
        token = get_saas_token_with_claims(
            user,
            roles=[],
            permissions=["tenants.read_all"],  # no audit.read
        )
        resp = client.get(
            f"{BASE}/logs",
            headers={"Authorization": f"Bearer {token}", "X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 403
