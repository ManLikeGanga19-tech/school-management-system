"""
Tests for finance endpoints:
  GET/PUT  /api/v1/finance/policy
  GET/PUT  /api/v1/finance/structure-policies
  POST/GET /api/v1/finance/fee-categories
  POST/GET /api/v1/finance/fee-items
  POST/GET/PUT/DELETE /api/v1/finance/fee-structures
  POST/GET /api/v1/finance/scholarships
  POST/GET /api/v1/finance/invoices
  POST/GET /api/v1/finance/payments
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/finance"

POLICY_VIEW = ["finance.policy.view"]
POLICY_MANAGE = ["finance.policy.view", "finance.policy.manage"]
FEES_VIEW = ["finance.fees.view"]
FEES_MANAGE = ["finance.fees.view", "finance.fees.manage"]
SCHOLARSHIP_MANAGE = ["finance.scholarships.view", "finance.scholarships.manage"]
INVOICE_VIEW = ["finance.invoices.view"]
INVOICE_MANAGE = ["finance.invoices.view", "finance.invoices.manage"]
PAYMENT_VIEW = ["finance.payments.view"]
PAYMENT_MANAGE = ["finance.payments.view", "finance.payments.manage"]
ALL_FINANCE = list(
    set(POLICY_MANAGE + FEES_MANAGE + SCHOLARSHIP_MANAGE + INVOICE_MANAGE + PAYMENT_MANAGE)
)

ENROLLMENT_MANAGE = ["enrollment.manage"]


# ── Policy ──────────────────────────────────────────────────────────────────

class TestFinancePolicy:
    def test_get_policy_creates_default(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=POLICY_VIEW)

        resp = client.get(f"{BASE}/policy", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["tenant_id"] == str(tenant.id)
        assert "allow_partial_enrollment" in data

    def test_upsert_policy(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=POLICY_MANAGE)

        resp = client.put(
            f"{BASE}/policy",
            json={"allow_partial_enrollment": True, "min_percent_to_enroll": 50},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["allow_partial_enrollment"] is True
        assert data["min_percent_to_enroll"] == 50

    def test_get_policy_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            f"{BASE}/policy", headers={"X-Tenant-ID": str(tenant.id)}
        )
        assert resp.status_code == 401

    def test_upsert_policy_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=POLICY_VIEW)

        resp = client.put(
            f"{BASE}/policy",
            json={"allow_partial_enrollment": True},
            headers=headers,
        )
        assert resp.status_code == 403


# ── Fee Categories ───────────────────────────────────────────────────────────

class TestFeeCategories:
    def test_create_and_list(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=FEES_MANAGE)

        resp = client.post(
            f"{BASE}/fee-categories",
            json={"code": "TUITION", "name": "Tuition Fees"},
            headers=headers,
        )
        assert resp.status_code == 200
        cat = resp.json()
        assert cat["code"] == "TUITION"

        list_resp = client.get(f"{BASE}/fee-categories", headers=headers)
        assert list_resp.status_code == 200
        codes = [c["code"] for c in list_resp.json()]
        assert "TUITION" in codes

    def test_duplicate_code_returns_400(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=FEES_MANAGE)

        client.post(
            f"{BASE}/fee-categories",
            json={"code": "DUP", "name": "Duplicate"},
            headers=headers,
        )
        resp = client.post(
            f"{BASE}/fee-categories",
            json={"code": "DUP", "name": "Duplicate Again"},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_list_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get(f"{BASE}/fee-categories", headers=headers)
        assert resp.status_code == 403

    def test_tenant_isolation(self, client: TestClient, db_session: Session):
        tenant_a = create_tenant(db_session, slug="fa", domain="fa.example.com")
        tenant_b = create_tenant(db_session, slug="fb", domain="fb.example.com")
        _, headers_a = make_actor(db_session, tenant=tenant_a, permissions=FEES_MANAGE)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=FEES_MANAGE)

        client.post(
            f"{BASE}/fee-categories",
            json={"code": "ONLY_FOR_A", "name": "A Category"},
            headers=headers_a,
        )

        list_resp = client.get(f"{BASE}/fee-categories", headers=headers_b)
        codes = [c["code"] for c in list_resp.json()]
        assert "ONLY_FOR_A" not in codes


# ── Fee Items ────────────────────────────────────────────────────────────────

class TestFeeItems:
    def _create_category(self, client, headers) -> str:
        resp = client.post(
            f"{BASE}/fee-categories",
            json={"code": f"CAT_{uuid4().hex[:6]}", "name": "Category"},
            headers=headers,
        )
        assert resp.status_code == 200
        return resp.json()["id"]

    def test_create_and_list_fee_items(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=FEES_MANAGE)
        cat_id = self._create_category(client, headers)

        resp = client.post(
            f"{BASE}/fee-items",
            json={"category_id": cat_id, "code": "TERM_FEE", "name": "Term Fee"},
            headers=headers,
        )
        assert resp.status_code == 200
        item = resp.json()
        assert item["code"] == "TERM_FEE"
        assert item["category_id"] == cat_id

        list_resp = client.get(f"{BASE}/fee-items", headers=headers)
        assert list_resp.status_code == 200
        codes = [i["code"] for i in list_resp.json()]
        assert "TERM_FEE" in codes

    def test_duplicate_item_code_returns_400(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=FEES_MANAGE)
        cat_id = self._create_category(client, headers)

        client.post(
            f"{BASE}/fee-items",
            json={"category_id": cat_id, "code": "ITEM_DUP", "name": "Item"},
            headers=headers,
        )
        resp = client.post(
            f"{BASE}/fee-items",
            json={"category_id": cat_id, "code": "ITEM_DUP", "name": "Item 2"},
            headers=headers,
        )
        assert resp.status_code == 400


# ── Fee Structures ───────────────────────────────────────────────────────────

class TestFeeStructures:
    def _create_structure(self, client, headers, class_code="GRADE_1") -> dict:
        resp = client.post(
            f"{BASE}/fee-structures",
            json={
                "class_code": class_code,
                "academic_year": 2026,
                "student_type": "RETURNING",
                "name": f"{class_code} 2026 Returning",
            },
            headers=headers,
        )
        assert resp.status_code == 200
        return resp.json()

    def test_create_and_list(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=FEES_MANAGE)

        structure = self._create_structure(client, headers)
        assert structure["class_code"] == "GRADE_1"

        list_resp = client.get(f"{BASE}/fee-structures", headers=headers)
        assert list_resp.status_code == 200
        ids = [s["id"] for s in list_resp.json()]
        assert structure["id"] in ids

    def test_get_structure_with_items(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=FEES_MANAGE)
        structure = self._create_structure(client, headers)

        resp = client.get(f"{BASE}/fee-structures/{structure['id']}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == structure["id"]
        assert "items" in data

    def test_add_item_to_structure(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=FEES_MANAGE)
        structure = self._create_structure(client, headers)

        cat_resp = client.post(
            f"{BASE}/fee-categories",
            json={"code": "MEALS", "name": "Meals"},
            headers=headers,
        )
        cat_id = cat_resp.json()["id"]
        item_resp = client.post(
            f"{BASE}/fee-items",
            json={"category_id": cat_id, "code": "LUNCH", "name": "Lunch"},
            headers=headers,
        )
        item_id = item_resp.json()["id"]

        resp = client.post(
            f"{BASE}/fee-structures/{structure['id']}/items",
            json={
                "fee_item_id": item_id,
                "term_1_amount": "2500.00",
                "term_2_amount": "2500.00",
                "term_3_amount": "2500.00",
            },
            headers=headers,
        )
        assert resp.status_code == 200

    def test_update_structure(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=FEES_MANAGE)
        structure = self._create_structure(client, headers)

        resp = client.put(
            f"{BASE}/fee-structures/{structure['id']}",
            json={"name": "Updated Name"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Name"

    def test_delete_structure(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=FEES_MANAGE)
        structure = self._create_structure(client, headers)

        resp = client.delete(f"{BASE}/fee-structures/{structure['id']}", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_list_requires_fees_view(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get(f"{BASE}/fee-structures", headers=headers)
        assert resp.status_code == 403


# ── Scholarships ─────────────────────────────────────────────────────────────

class TestScholarships:
    def test_create_and_list_scholarships(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=SCHOLARSHIP_MANAGE)

        resp = client.post(
            f"{BASE}/scholarships",
            json={"name": "Merit Award", "type": "PERCENTAGE", "value": "25"},
            headers=headers,
        )
        assert resp.status_code == 200
        sc = resp.json()
        assert sc["name"] == "Merit Award"
        assert sc["type"] == "PERCENTAGE"

        list_resp = client.get(f"{BASE}/scholarships", headers=headers)
        assert list_resp.status_code == 200
        names = [s["name"] for s in list_resp.json()]
        assert "Merit Award" in names

    def test_create_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.post(
            f"{BASE}/scholarships",
            json={"name": "Hack", "type": "PERCENTAGE", "value": "100"},
            headers=headers,
        )
        assert resp.status_code == 403


# ── Invoices ─────────────────────────────────────────────────────────────────

class TestInvoices:
    def _prepare_enrollment(self, client, db_session) -> tuple[dict, dict]:
        """Creates a tenant, actor with all finance perms, and an ENROLLED enrollment."""
        from tests.helpers import create_tenant, make_actor

        tenant = create_tenant(db_session, slug=f"inv-{uuid4().hex[:6]}", domain=f"{uuid4().hex[:6]}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )

        # Create and fully enroll
        enr = client.post(
            "/api/v1/enrollments/",
            json={"payload": {"student_name": "Invoice Student"}},
            headers=headers,
        )
        assert enr.status_code == 201
        eid = enr.json()["id"]

        client.post(f"/api/v1/enrollments/{eid}/submit", headers=headers)
        client.post(f"/api/v1/enrollments/{eid}/approve", headers=headers)
        client.post(f"/api/v1/enrollments/{eid}/enroll", json={}, headers=headers)

        return headers, {"enrollment_id": eid}

    def test_create_and_list_invoice(self, client: TestClient, db_session: Session):
        headers, ctx = self._prepare_enrollment(client, db_session)

        resp = client.post(
            f"{BASE}/invoices",
            json={
                "invoice_type": "SCHOOL_FEES",
                "enrollment_id": ctx["enrollment_id"],
                "lines": [
                    {"description": "Term Fee", "amount": "5000.00", "quantity": 1}
                ],
            },
            headers=headers,
        )
        assert resp.status_code == 200
        inv = resp.json()
        assert inv["invoice_type"] == "SCHOOL_FEES"
        assert "id" in inv

        list_resp = client.get(f"{BASE}/invoices", headers=headers)
        assert list_resp.status_code == 200
        ids = [i["id"] for i in list_resp.json()["items"]]
        assert inv["id"] in ids

    def test_get_invoice_by_id(self, client: TestClient, db_session: Session):
        headers, ctx = self._prepare_enrollment(client, db_session)

        inv_resp = client.post(
            f"{BASE}/invoices",
            json={
                "invoice_type": "SCHOOL_FEES",
                "enrollment_id": ctx["enrollment_id"],
                "lines": [{"description": "Fee", "amount": "3000.00", "quantity": 1}],
            },
            headers=headers,
        )
        inv_id = inv_resp.json()["id"]

        resp = client.get(f"{BASE}/invoices/{inv_id}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == inv_id

    def test_get_invoice_not_found(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug="inv-404", domain="inv404.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=INVOICE_VIEW)

        resp = client.get(f"{BASE}/invoices/{uuid4()}", headers=headers)
        assert resp.status_code == 404

    def test_invoice_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug="inv-auth", domain="invauth.example.com")
        resp = client.get(
            f"{BASE}/invoices", headers={"X-Tenant-ID": str(tenant.id)}
        )
        assert resp.status_code == 401


# ── Payments ─────────────────────────────────────────────────────────────────

class TestFinancePayments:
    def _prepare_with_invoice(self, client, db_session) -> tuple[dict, str, str]:
        """Returns (headers, enrollment_id, invoice_id)."""
        tenant = create_tenant(
            db_session,
            slug=f"pay-{uuid4().hex[:6]}",
            domain=f"{uuid4().hex[:6]}.example.com",
        )
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )

        enr = client.post(
            "/api/v1/enrollments/",
            json={"payload": {"student_name": "Pay Student"}},
            headers=headers,
        )
        eid = enr.json()["id"]
        client.post(f"/api/v1/enrollments/{eid}/submit", headers=headers)
        client.post(f"/api/v1/enrollments/{eid}/approve", headers=headers)
        client.post(f"/api/v1/enrollments/{eid}/enroll", json={}, headers=headers)

        inv = client.post(
            f"{BASE}/invoices",
            json={
                "invoice_type": "SCHOOL_FEES",
                "enrollment_id": eid,
                "lines": [{"description": "Term Fee", "amount": "10000.00", "quantity": 1}],
            },
            headers=headers,
        )
        inv_id = inv.json()["id"]
        return headers, eid, inv_id

    def test_create_and_list_payment(self, client: TestClient, db_session: Session):
        headers, eid, inv_id = self._prepare_with_invoice(client, db_session)

        resp = client.post(
            f"{BASE}/payments",
            json={
                "provider": "CASH",
                "reference": "RCP-001",
                "amount": "5000.00",
                "allocations": [{"invoice_id": inv_id, "amount": "5000.00"}],
            },
            headers=headers,
        )
        assert resp.status_code == 200
        pay = resp.json()
        assert pay["provider"] == "CASH"
        assert pay["reference"] == "RCP-001"

        list_resp = client.get(f"{BASE}/payments?enrollment_id={eid}", headers=headers)
        assert list_resp.status_code == 200
        refs = [p["reference"] for p in list_resp.json()["items"]]
        assert "RCP-001" in refs

    def test_payment_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug="pay-noperm", domain="paynoperm.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])

        resp = client.post(
            f"{BASE}/payments",
            json={"provider": "CASH", "reference": "X", "amount": "100", "allocations": []},
            headers=headers,
        )
        assert resp.status_code == 403
