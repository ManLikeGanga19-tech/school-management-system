"""
Tests for enrollment endpoints:
  POST   /api/v1/enrollments/
  GET    /api/v1/enrollments/
  GET    /api/v1/enrollments/paged
  GET    /api/v1/enrollments/{id}
  PATCH  /api/v1/enrollments/{id}
  POST   /api/v1/enrollments/{id}/submit
  POST   /api/v1/enrollments/{id}/approve
  POST   /api/v1/enrollments/{id}/reject
  POST   /api/v1/enrollments/{id}/enroll
  POST   /api/v1/enrollments/{id}/director-override
  POST   /api/v1/enrollments/{id}/transfer/request
  POST   /api/v1/enrollments/{id}/transfer/approve
  POST   /api/v1/enrollments/{id}/soft-delete
  DELETE /api/v1/enrollments/{id}
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import (
    create_tenant,
    create_tenant_user,
    make_actor,
)

MANAGE = ["enrollment.manage"]
DIRECTOR = ["enrollment.manage", "enrollment.director.override"]
TRANSFER_APPROVE = ["enrollment.manage", "enrollment.transfer.approve"]

BASE = "/api/v1/enrollments"


def _draft_payload() -> dict:
    return {
        "student_name": "Alice Kiprotich",
        "class": "Grade 1",
        "term": "Term 1",
        "parent_name": "Bob Kiprotich",
        "parent_phone": "0700000001",
        "assessment_no": "ASSESS-001",
        "nemis_no": "NEMIS-001",
    }


def _create_draft(client, headers) -> dict:
    resp = client.post(BASE + "/", json={"payload": _draft_payload()}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Create ─────────────────────────────────────────────────────────────────

class TestCreateEnrollment:
    def test_create_draft(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        resp = client.post(BASE + "/", json={"payload": _draft_payload()}, headers=headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "DRAFT"
        assert data["payload"]["student_name"] == "Alice Kiprotich"
        assert data["tenant_id"] == str(tenant.id)

    def test_create_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.post(
            BASE + "/",
            json={"payload": _draft_payload()},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_create_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.post(BASE + "/", json={"payload": _draft_payload()}, headers=headers)
        assert resp.status_code == 403


# ── List ────────────────────────────────────────────────────────────────────

class TestListEnrollments:
    def test_list_returns_created(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        _create_draft(client, headers)
        resp = client.get(BASE + "/", headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_list_filter_by_status(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        _create_draft(client, headers)
        resp = client.get(BASE + "/?status=DRAFT", headers=headers)
        assert resp.status_code == 200
        for item in resp.json():
            assert item["status"] == "DRAFT"

    def test_list_tenant_isolation(self, client: TestClient, db_session: Session):
        tenant_a = create_tenant(db_session, slug="tenant-a", domain="a.example.com")
        tenant_b = create_tenant(db_session, slug="tenant-b", domain="b.example.com")
        _, headers_a = make_actor(db_session, tenant=tenant_a, permissions=MANAGE)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=MANAGE)

        _create_draft(client, headers_a)

        resp = client.get(BASE + "/", headers=headers_b)
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    def test_list_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(BASE + "/", headers={"X-Tenant-ID": str(tenant.id)})
        assert resp.status_code == 401


# ── Paged list ───────────────────────────────────────────────────────────────

class TestListEnrollmentsPaged:
    def test_paged_returns_total(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        for _ in range(3):
            _create_draft(client, headers)

        resp = client.get(BASE + "/paged?limit=2&offset=0", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 3
        assert len(data["items"]) == 2
        assert data["limit"] == 2
        assert data["offset"] == 0

    def test_paged_search(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        client.post(
            BASE + "/",
            json={"payload": {"student_name": "UniqueXYZStudent"}},
            headers=headers,
        )
        resp = client.get(BASE + "/paged?search=UniqueXYZStudent", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1


# ── Single record ────────────────────────────────────────────────────────────

class TestGetEnrollment:
    def test_get_by_id(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        created = _create_draft(client, headers)

        resp = client.get(f"{BASE}/{created['id']}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == created["id"]

    def test_get_nonexistent_returns_404(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        from uuid import uuid4
        resp = client.get(f"{BASE}/{uuid4()}", headers=headers)
        assert resp.status_code == 404

    def test_get_cross_tenant_returns_404(self, client: TestClient, db_session: Session):
        tenant_a = create_tenant(db_session, slug="ta", domain="ta.example.com")
        tenant_b = create_tenant(db_session, slug="tb", domain="tb.example.com")
        _, headers_a = make_actor(db_session, tenant=tenant_a, permissions=MANAGE)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=MANAGE)

        created = _create_draft(client, headers_a)
        resp = client.get(f"{BASE}/{created['id']}", headers=headers_b)
        assert resp.status_code == 404


# ── Workflow transitions ──────────────────────────────────────────────────────

class TestEnrollmentWorkflow:
    def _full_workflow(self, client, headers):
        """Helper: DRAFT → SUBMITTED → APPROVED → ENROLLED."""
        created = _create_draft(client, headers)
        eid = created["id"]

        submit = client.post(f"{BASE}/{eid}/submit", headers=headers)
        assert submit.status_code == 200
        assert submit.json()["status"] == "SUBMITTED"

        approve = client.post(f"{BASE}/{eid}/approve", headers=headers)
        assert approve.status_code == 200
        assert approve.json()["status"] == "APPROVED"

        enroll = client.post(f"{BASE}/{eid}/enroll", json={}, headers=headers)
        assert enroll.status_code == 200
        enrolled = enroll.json()
        assert enrolled["status"] == "ENROLLED"
        assert enrolled["admission_number"] is not None

        return enrolled

    def test_full_workflow(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        self._full_workflow(client, headers)

    def test_custom_admission_number(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        created = _create_draft(client, headers)
        eid = created["id"]
        client.post(f"{BASE}/{eid}/submit", headers=headers)
        client.post(f"{BASE}/{eid}/approve", headers=headers)

        resp = client.post(
            f"{BASE}/{eid}/enroll",
            json={"admission_number": "ADM-9999"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["admission_number"] == "ADM-9999"

    def test_submit_non_draft_returns_400(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        created = _create_draft(client, headers)
        eid = created["id"]
        client.post(f"{BASE}/{eid}/submit", headers=headers)
        # Submit again — already SUBMITTED
        resp = client.post(f"{BASE}/{eid}/submit", headers=headers)
        assert resp.status_code == 400

    def test_reject_submitted(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        created = _create_draft(client, headers)
        eid = created["id"]
        client.post(f"{BASE}/{eid}/submit", headers=headers)

        resp = client.post(
            f"{BASE}/{eid}/reject",
            json={"reason": "Incomplete documents"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "REJECTED"

    def test_approve_requires_submitted_state(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        created = _create_draft(client, headers)
        eid = created["id"]
        # Try to approve a DRAFT directly
        resp = client.post(f"{BASE}/{eid}/approve", headers=headers)
        assert resp.status_code == 400


# ── Patch ────────────────────────────────────────────────────────────────────

class TestPatchEnrollment:
    def test_patch_draft(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        created = _create_draft(client, headers)
        eid = created["id"]

        resp = client.patch(
            f"{BASE}/{eid}",
            json={"payload": {"student_name": "Updated Name"}},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["payload"]["student_name"] == "Updated Name"

    def test_patch_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers_m = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        _, headers_no = make_actor(db_session, tenant=tenant, permissions=[])
        created = _create_draft(client, headers_m)
        eid = created["id"]

        resp = client.patch(
            f"{BASE}/{eid}",
            json={"payload": {"student_name": "Hack"}},
            headers=headers_no,
        )
        assert resp.status_code == 403


# ── Director override ──────────────────────────────────────────────────────

class TestDirectorOverride:
    def test_director_override_resets_edit_lock(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DIRECTOR)
        created = _create_draft(client, headers)
        eid = created["id"]

        # Walk through to ENROLLED
        client.post(f"{BASE}/{eid}/submit", headers=headers)
        client.post(f"{BASE}/{eid}/approve", headers=headers)
        client.post(f"{BASE}/{eid}/enroll", json={}, headers=headers)

        resp = client.post(
            f"{BASE}/{eid}/director-override",
            json={"note": "Emergency override"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["secretary_edit_count"] == 0
        assert data["secretary_edit_locked"] is False

    def test_director_override_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers_m = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        _, headers_no_dir = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        created = _create_draft(client, headers_m)
        eid = created["id"]
        client.post(f"{BASE}/{eid}/submit", headers=headers_m)
        client.post(f"{BASE}/{eid}/approve", headers=headers_m)
        client.post(f"{BASE}/{eid}/enroll", json={}, headers=headers_m)

        resp = client.post(f"{BASE}/{eid}/director-override", json={}, headers=headers_no_dir)
        assert resp.status_code == 403


# ── Transfer ──────────────────────────────────────────────────────────────

class TestTransferFlow:
    def test_transfer_request_and_approve(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(
            db_session, tenant=tenant, permissions=TRANSFER_APPROVE + DIRECTOR
        )

        # Create + enroll
        created = _create_draft(client, headers)
        eid = created["id"]
        client.post(f"{BASE}/{eid}/submit", headers=headers)
        client.post(f"{BASE}/{eid}/approve", headers=headers)
        client.post(f"{BASE}/{eid}/enroll", json={}, headers=headers)

        # Request transfer
        resp = client.post(f"{BASE}/{eid}/transfer/request", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "TRANSFER_REQUESTED"

        # Approve transfer
        resp = client.post(f"{BASE}/{eid}/transfer/approve", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "TRANSFERRED"

    def test_transfer_request_on_draft_returns_400(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        created = _create_draft(client, headers)
        eid = created["id"]

        resp = client.post(f"{BASE}/{eid}/transfer/request", headers=headers)
        assert resp.status_code == 400


# ── Soft/hard delete ─────────────────────────────────────────────────────────

class TestDeleteEnrollment:
    def test_soft_delete(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DIRECTOR)
        created = _create_draft(client, headers)
        eid = created["id"]

        resp = client.post(f"{BASE}/{eid}/soft-delete", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "DELETED"

    def test_soft_delete_idempotent(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DIRECTOR)
        created = _create_draft(client, headers)
        eid = created["id"]

        client.post(f"{BASE}/{eid}/soft-delete", headers=headers)
        resp = client.post(f"{BASE}/{eid}/soft-delete", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "DELETED"

    def test_hard_delete_removes_record(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DIRECTOR)
        created = _create_draft(client, headers)
        eid = created["id"]

        client.post(f"{BASE}/{eid}/soft-delete", headers=headers)
        del_resp = client.delete(f"{BASE}/{eid}", headers=headers)
        assert del_resp.status_code == 204

        get_resp = client.get(f"{BASE}/{eid}", headers=headers)
        assert get_resp.status_code == 404

    def test_hard_delete_requires_director(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers_dir = make_actor(db_session, tenant=tenant, permissions=DIRECTOR)
        _, headers_sec = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        created = _create_draft(client, headers_dir)
        eid = created["id"]

        resp = client.delete(f"{BASE}/{eid}", headers=headers_sec)
        assert resp.status_code == 403
