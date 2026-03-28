"""
Tests for Phase 0 — curriculum_type field on the tenant.

Endpoints exercised:
  GET   /api/v1/tenants/whoami          → returns curriculum_type
  PATCH /api/v1/tenants/me              → update curriculum_type
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

WHOAMI = "/api/v1/tenants/whoami"
UPDATE_ME = "/api/v1/tenants/me"

# Permission needed to call PATCH /tenants/me
MANAGE = ["admin.dashboard.view_tenant"]


class TestWhoamiCurriculumType:
    def test_whoami_defaults_to_cbc(self, client: TestClient, db_session: Session):
        """A freshly created tenant has curriculum_type=CBC.
        whoami only needs X-Tenant-ID header (no Bearer token required).
        """
        tenant = create_tenant(db_session)
        resp = client.get(WHOAMI, headers={"X-Tenant-ID": str(tenant.id)})
        assert resp.status_code == 200
        data = resp.json()
        assert "curriculum_type" in data
        assert data["curriculum_type"] == "CBC"

    def test_whoami_is_accessible_without_auth(self, client: TestClient, db_session: Session):
        """whoami is a lightweight identity endpoint — no Bearer token needed."""
        tenant = create_tenant(db_session)
        resp = client.get(WHOAMI, headers={"X-Tenant-ID": str(tenant.id)})
        assert resp.status_code == 200

    def test_whoami_reflects_updated_curriculum_type(
        self, client: TestClient, db_session: Session
    ):
        """After updating to 8-4-4, whoami returns the new value."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)

        patch = client.patch(UPDATE_ME, json={"curriculum_type": "8-4-4"}, headers=headers)
        assert patch.status_code == 200

        # whoami only needs X-Tenant-ID
        resp = client.get(WHOAMI, headers={"X-Tenant-ID": str(tenant.id)})
        assert resp.status_code == 200
        assert resp.json()["curriculum_type"] == "8-4-4"


class TestUpdateCurriculumType:
    def test_update_to_cbc(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        resp = client.patch(UPDATE_ME, json={"curriculum_type": "CBC"}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["curriculum_type"] == "CBC"

    def test_update_to_844(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        resp = client.patch(UPDATE_ME, json={"curriculum_type": "8-4-4"}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["curriculum_type"] == "8-4-4"

    def test_update_to_igcse(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        resp = client.patch(UPDATE_ME, json={"curriculum_type": "IGCSE"}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["curriculum_type"] == "IGCSE"

    def test_invalid_curriculum_type_rejected(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        resp = client.patch(UPDATE_ME, json={"curriculum_type": "XYZ"}, headers=headers)
        assert resp.status_code == 400
        assert "curriculum_type" in resp.json()["detail"].lower() or "invalid" in resp.json()["detail"].lower()

    def test_case_insensitive_cbc(self, client: TestClient, db_session: Session):
        """Input 'cbc' should be accepted and normalised to 'CBC'."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        resp = client.patch(UPDATE_ME, json={"curriculum_type": "cbc"}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["curriculum_type"] == "CBC"

    def test_update_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.patch(
            UPDATE_ME,
            json={"curriculum_type": "CBC"},
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_other_fields_unchanged_after_curriculum_update(
        self, client: TestClient, db_session: Session
    ):
        """Updating curriculum_type does not clobber the tenant name."""
        tenant = create_tenant(db_session, name="Sunshine Academy")
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)

        resp = client.patch(UPDATE_ME, json={"curriculum_type": "IGCSE"}, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["curriculum_type"] == "IGCSE"
        assert data["name"] == "Sunshine Academy"
