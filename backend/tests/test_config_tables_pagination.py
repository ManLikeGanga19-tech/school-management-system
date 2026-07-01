"""Phase K — config-table pagination.

Each of the 5 finance config endpoints now supports paginated=true which
flips the response shape from list[T] to {items, meta}. Existing callers
that don't pass paginated get the legacy list shape unchanged.
"""
from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/finance"
PERMS_FEES = ["finance.fees.view", "finance.fees.manage"]
PERMS_SCHOL = ["finance.scholarships.view", "finance.scholarships.manage"]
PERMS_POLICY = ["finance.policy.view", "finance.policy.manage",
                "finance.fees.view", "finance.fees.manage"]


class TestFeeCategoriesPagination:
    def test_legacy_shape_returns_list(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_FEES)
        client.post(f"{BASE}/fee-categories",
                    json={"code": "A", "name": "Alpha"}, headers=headers)
        r = client.get(f"{BASE}/fee-categories", headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, list)

    def test_paginated_shape(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_FEES)
        for i in range(3):
            client.post(f"{BASE}/fee-categories",
                        json={"code": f"C{i}", "name": f"Cat {i}"},
                        headers=headers)
        r = client.get(f"{BASE}/fee-categories?paginated=true", headers=headers)
        body = r.json()
        assert set(body.keys()) == {"items", "meta"}
        assert body["meta"]["total"] == 3
        assert body["meta"]["page"] == 1

    def test_search_q_alias(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_FEES)
        client.post(f"{BASE}/fee-categories",
                    json={"code": "ALPHA", "name": "Alpha"}, headers=headers)
        client.post(f"{BASE}/fee-categories",
                    json={"code": "BRAVO", "name": "Bravo"}, headers=headers)
        r = client.get(f"{BASE}/fee-categories?paginated=true&q=alpha", headers=headers)
        body = r.json()
        assert body["meta"]["total"] == 1
        assert body["items"][0]["code"] == "ALPHA"


class TestFeeItemsPagination:
    def _mkcat(self, client, headers) -> str:
        r = client.post(f"{BASE}/fee-categories",
                        json={"code": f"C-{uuid4().hex[:4]}", "name": "Cat"},
                        headers=headers)
        return r.json()["id"]

    def test_paginated_shape(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_FEES)
        cat_id = self._mkcat(client, headers)
        for i in range(3):
            client.post(f"{BASE}/fee-items",
                        json={"category_id": cat_id, "code": f"F{i}",
                              "name": f"Fee {i}"},
                        headers=headers)
        r = client.get(f"{BASE}/fee-items?paginated=true", headers=headers)
        body = r.json()
        assert body["meta"]["total"] >= 3
        assert isinstance(body["items"], list)

    def test_legacy_shape_still_returns_list(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_FEES)
        r = client.get(f"{BASE}/fee-items", headers=headers)
        assert isinstance(r.json(), list)


class TestFeeStructuresPagination:
    def test_paginated_shape(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_FEES)
        # Vary the class_code so the (class, year, type) unique constraint
        # doesn't collapse three creations to one.
        for i in range(3):
            client.post(f"{BASE}/fee-structures",
                        json={"code": f"S-{i}", "name": f"Structure {i}",
                              "class_code": f"G{i}", "academic_year": 2026,
                              "student_type": "RETURNING"},
                        headers=headers)
        r = client.get(f"{BASE}/fee-structures?paginated=true", headers=headers)
        body = r.json()
        assert body["meta"]["total"] >= 3

    def test_legacy_shape(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_FEES)
        r = client.get(f"{BASE}/fee-structures", headers=headers)
        assert isinstance(r.json(), list)


class TestScholarshipsPagination:
    def test_paginated_shape(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_SCHOL)
        for i in range(3):
            client.post(f"{BASE}/scholarships",
                        json={"name": f"Sch {i}", "type": "FIXED",
                              "value": "100", "is_active": True},
                        headers=headers)
        r = client.get(f"{BASE}/scholarships?paginated=true", headers=headers)
        body = r.json()
        assert body["meta"]["total"] == 3

    def test_legacy_shape(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_SCHOL)
        r = client.get(f"{BASE}/scholarships", headers=headers)
        assert isinstance(r.json(), list)


class TestStructurePoliciesPagination:
    def test_paginated_shape_returns_meta(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_POLICY)
        r = client.get(f"{BASE}/structure-policies?paginated=true", headers=headers)
        body = r.json()
        assert set(body.keys()) == {"items", "meta"}

    def test_legacy_shape(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS_POLICY)
        r = client.get(f"{BASE}/structure-policies", headers=headers)
        assert isinstance(r.json(), list)
