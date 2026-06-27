"""
Tests for Finance v2 features:
  - charge_frequency on fee items (PER_TERM / ONCE_PER_YEAR / ONCE_EVER)
  - FeeStructure with academic_year + student_type
  - per-term amounts on fee structure items (term_1/2/3_amount)
  - generate_school_fees_invoice_v2 (auto-detect NEW vs RETURNING)
  - Duplicate invoice guard (one per enrollment per term)
  - ONCE_PER_YEAR guard (only charged in Term 1, not again same year)
  - ONCE_EVER guard (never charged after first invoice)
  - Payment settings CRUD
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from sqlalchemy import select

from app.models.enrollment import Enrollment
from app.models.student import Student
from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/finance"

ALL_FINANCE = list({
    "finance.policy.view", "finance.policy.manage",
    "finance.fees.view", "finance.fees.manage",
    "finance.scholarships.view", "finance.scholarships.manage",
    "finance.invoices.view", "finance.invoices.manage",
    "finance.payments.view", "finance.payments.manage",
})
ENROLLMENT_MANAGE = ["enrollment.manage"]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _link_student_admission_year(db_session: Session, *, tenant_id, enrollment_id, admission_year: int) -> None:
    """Create a Student with the given admission_year and link it to the enrollment."""
    student = Student(
        id=uuid4(),
        tenant_id=tenant_id,
        admission_no=f"ADM{uuid4().hex[:6].upper()}",
        first_name="Test",
        last_name="Student",
        admission_year=admission_year,
    )
    db_session.add(student)
    db_session.flush()
    enrollment = db_session.execute(
        select(Enrollment).where(Enrollment.id == enrollment_id)
    ).scalar_one()
    enrollment.student_id = student.id
    db_session.commit()


def _make_enrolled_student(client, headers, *, class_code: str = "GRADE_1") -> str:
    """Create an enrollment through the full lifecycle and return enrollment_id."""
    enr = client.post(
        "/api/v1/enrollments/",
        json={"payload": {"student_name": "Test Student", "class_code": class_code}},
        headers=headers,
    )
    assert enr.status_code in (200, 201), enr.text
    eid = enr.json()["id"]
    client.post(f"/api/v1/enrollments/{eid}/submit", headers=headers)
    client.post(f"/api/v1/enrollments/{eid}/approve", headers=headers)
    client.post(f"/api/v1/enrollments/{eid}/enroll", json={}, headers=headers)
    return eid


def _create_category(client, headers, *, code: str | None = None) -> str:
    resp = client.post(
        f"{BASE}/fee-categories",
        json={"code": code or f"CAT_{uuid4().hex[:6]}", "name": "Category"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _create_fee_item(
    client,
    headers,
    *,
    cat_id: str,
    code: str | None = None,
    charge_frequency: str = "PER_TERM",
) -> str:
    resp = client.post(
        f"{BASE}/fee-items",
        json={
            "category_id": cat_id,
            "code": code or f"ITEM_{uuid4().hex[:6]}",
            "name": "Fee Item",
            "charge_frequency": charge_frequency,
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _create_structure(
    client,
    headers,
    *,
    class_code: str = "GRADE_1",
    academic_year: int = 2026,
    student_type: str = "RETURNING",
) -> dict:
    resp = client.post(
        f"{BASE}/fee-structures",
        json={
            "class_code": class_code,
            "academic_year": academic_year,
            "student_type": student_type,
            "name": f"{class_code} {academic_year} {student_type}",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _add_item_to_structure(
    client,
    headers,
    *,
    structure_id: str,
    fee_item_id: str,
    t1: str = "5000.00",
    t2: str = "5000.00",
    t3: str = "5000.00",
) -> None:
    resp = client.post(
        f"{BASE}/fee-structures/{structure_id}/items",
        json={
            "fee_item_id": fee_item_id,
            "term_1_amount": t1,
            "term_2_amount": t2,
            "term_3_amount": t3,
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text


def _setup_full_structure(client, headers, *, class_code="GRADE_1", academic_year=2026, student_type="RETURNING"):
    """Create category + fee item + structure + add item. Returns (structure_id, fee_item_id)."""
    cat_id = _create_category(client, headers)
    fee_item_id = _create_fee_item(client, headers, cat_id=cat_id)
    structure = _create_structure(
        client, headers,
        class_code=class_code,
        academic_year=academic_year,
        student_type=student_type,
    )
    _add_item_to_structure(client, headers, structure_id=structure["id"], fee_item_id=fee_item_id)
    return structure["id"], fee_item_id


# ── Fee Item Charge Frequency ─────────────────────────────────────────────────

class TestChargeFrequency:
    def test_create_fee_item_with_per_term(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"cf-{uuid4().hex[:6]}", domain=f"{uuid4().hex[:6]}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        cat_id = _create_category(client, headers)

        resp = client.post(
            f"{BASE}/fee-items",
            json={"category_id": cat_id, "code": "TERM_FEE", "name": "Term Fee", "charge_frequency": "PER_TERM"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["charge_frequency"] == "PER_TERM"

    def test_create_fee_item_once_per_year(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"cf2-{uuid4().hex[:6]}", domain=f"{uuid4().hex[:6]}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        cat_id = _create_category(client, headers)

        resp = client.post(
            f"{BASE}/fee-items",
            json={"category_id": cat_id, "code": "ACTIVITY", "name": "Activity Fee", "charge_frequency": "ONCE_PER_YEAR"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["charge_frequency"] == "ONCE_PER_YEAR"

    def test_create_fee_item_once_ever(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"cf3-{uuid4().hex[:6]}", domain=f"{uuid4().hex[:6]}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        cat_id = _create_category(client, headers)

        resp = client.post(
            f"{BASE}/fee-items",
            json={"category_id": cat_id, "code": "ADMISSION", "name": "Admission Fee", "charge_frequency": "ONCE_EVER"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["charge_frequency"] == "ONCE_EVER"

    def test_update_charge_frequency(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"cf4-{uuid4().hex[:6]}", domain=f"{uuid4().hex[:6]}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        cat_id = _create_category(client, headers)

        item = client.post(
            f"{BASE}/fee-items",
            json={"category_id": cat_id, "code": "BOOK_FEE", "name": "Book Fee", "charge_frequency": "PER_TERM"},
            headers=headers,
        ).json()

        resp = client.put(
            f"{BASE}/fee-items/{item['id']}",
            json={"charge_frequency": "ONCE_PER_YEAR"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["charge_frequency"] == "ONCE_PER_YEAR"


# ── Fee Structure v2 (academic_year + student_type) ───────────────────────────

class TestFeeStructureV2:
    def test_create_structure_with_year_and_type(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"fsv2-{uuid4().hex[:6]}", domain=f"{uuid4().hex[:6]}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/fee-structures",
            json={"class_code": "GRADE_1", "academic_year": 2026, "student_type": "NEW", "name": "Grade 1 New 2026"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["class_code"] == "GRADE_1"
        assert data["academic_year"] == 2026
        assert data["student_type"] == "NEW"

    def test_duplicate_class_year_type_returns_400(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"fsdup-{uuid4().hex[:6]}", domain=f"{uuid4().hex[:6]}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        client.post(
            f"{BASE}/fee-structures",
            json={"class_code": "GRADE_2", "academic_year": 2026, "student_type": "RETURNING", "name": "First"},
            headers=headers,
        )
        resp = client.post(
            f"{BASE}/fee-structures",
            json={"class_code": "GRADE_2", "academic_year": 2026, "student_type": "RETURNING", "name": "Duplicate"},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_new_and_returning_can_coexist(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"fsnr-{uuid4().hex[:6]}", domain=f"{uuid4().hex[:6]}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        r1 = client.post(
            f"{BASE}/fee-structures",
            json={"class_code": "GRADE_3", "academic_year": 2026, "student_type": "NEW", "name": "New"},
            headers=headers,
        )
        r2 = client.post(
            f"{BASE}/fee-structures",
            json={"class_code": "GRADE_3", "academic_year": 2026, "student_type": "RETURNING", "name": "Returning"},
            headers=headers,
        )
        assert r1.status_code == 200
        assert r2.status_code == 200

    def test_add_item_with_per_term_amounts(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"fsitem-{uuid4().hex[:6]}", domain=f"{uuid4().hex[:6]}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        cat_id = _create_category(client, headers)
        item_id = _create_fee_item(client, headers, cat_id=cat_id)
        structure = _create_structure(client, headers)

        resp = client.post(
            f"{BASE}/fee-structures/{structure['id']}/items",
            json={"fee_item_id": item_id, "term_1_amount": "8000.00", "term_2_amount": "7000.00", "term_3_amount": "7000.00"},
            headers=headers,
        )
        assert resp.status_code == 200

        detail = client.get(f"{BASE}/fee-structures/{structure['id']}", headers=headers).json()
        items = detail["items"]
        assert len(items) == 1
        item = items[0]
        assert float(item["term_1_amount"]) == 8000.0
        assert float(item["term_2_amount"]) == 7000.0
        assert float(item["term_3_amount"]) == 7000.0


# ── Generate Invoice v2 ───────────────────────────────────────────────────────

class TestGenerateInvoiceV2:
    def _setup(self, client, db_session, *, class_code="GRADE_1", student_type="RETURNING", academic_year=2026):
        slug = f"inv2-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )
        _setup_full_structure(client, headers, class_code=class_code, academic_year=academic_year, student_type=student_type)
        eid = _make_enrolled_student(client, headers, class_code=class_code)
        # Link student with correct admission_year so auto-detection works
        # NEW: admission_year == academic_year; RETURNING: admission_year < academic_year
        admission_year = academic_year if student_type == "NEW" else academic_year - 1
        _link_student_admission_year(
            db_session,
            tenant_id=headers["X-Tenant-ID"],
            enrollment_id=eid,
            admission_year=admission_year,
        )
        return headers, eid

    def test_generate_invoice_v2_returning(self, client: TestClient, db_session: Session):
        headers, eid = self._setup(client, db_session, student_type="RETURNING", academic_year=2025)

        resp = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 1, "academic_year": 2025},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["invoice_type"] == "SCHOOL_FEES"
        assert data["term_number"] == 1
        assert data["academic_year"] == 2025
        assert data["student_type_snapshot"] == "RETURNING"
        assert float(data["total_amount"]) > 0

    def test_generate_invoice_v2_new_student(self, client: TestClient, db_session: Session):
        """Student admitted in 2026 should auto-detect as NEW for academic_year=2026."""
        headers, eid = self._setup(client, db_session, student_type="NEW", academic_year=2026)

        resp = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 1, "academic_year": 2026},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["student_type_snapshot"] == "NEW"

    def test_generate_invoice_v2_wrong_term_returns_400(self, client: TestClient, db_session: Session):
        slug = f"inv2bad-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE + ENROLLMENT_MANAGE)
        eid = _make_enrolled_student(client, headers)

        resp = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 5, "academic_year": 2026},
            headers=headers,
        )
        assert resp.status_code == 422  # Pydantic validation error (ge=1, le=3)

    def test_generate_invoice_v2_no_structure_returns_400(self, client: TestClient, db_session: Session):
        slug = f"inv2ns-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE + ENROLLMENT_MANAGE)
        eid = _make_enrolled_student(client, headers, class_code="NONEXISTENT")

        resp = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 1, "academic_year": 2026},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "fee structure" in resp.json()["detail"].lower()

    def test_duplicate_invoice_guard(self, client: TestClient, db_session: Session):
        """Generating the same term invoice twice should fail."""
        headers, eid = self._setup(client, db_session, student_type="RETURNING", academic_year=2025)

        r1 = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 2, "academic_year": 2025},
            headers=headers,
        )
        assert r1.status_code == 200, r1.text

        r2 = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 2, "academic_year": 2025},
            headers=headers,
        )
        # Should fail with 400 (unique constraint / duplicate guard)
        assert r2.status_code in (400, 409), r2.text

    def test_different_terms_are_allowed(self, client: TestClient, db_session: Session):
        """Term 1 and Term 2 invoices for the same student should both succeed."""
        headers, eid = self._setup(client, db_session, student_type="RETURNING", academic_year=2025)

        r1 = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 1, "academic_year": 2025},
            headers=headers,
        )
        r2 = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 2, "academic_year": 2025},
            headers=headers,
        )
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, r2.text


# ── ONCE_PER_YEAR guard ───────────────────────────────────────────────────────

class TestOncePerYearGuard:
    def _setup_with_freq(self, client, db_session, charge_frequency: str):
        slug = f"opy-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE + ENROLLMENT_MANAGE)

        cat_id = _create_category(client, headers)
        # One PER_TERM item (always charged) + one special-frequency item
        per_term_item = _create_fee_item(client, headers, cat_id=cat_id, charge_frequency="PER_TERM")
        special_item = _create_fee_item(client, headers, cat_id=cat_id, charge_frequency=charge_frequency)

        structure = _create_structure(client, headers, class_code="GRADE_5", academic_year=2025, student_type="RETURNING")
        _add_item_to_structure(client, headers, structure_id=structure["id"], fee_item_id=per_term_item)
        _add_item_to_structure(client, headers, structure_id=structure["id"], fee_item_id=special_item, t1="350.00", t2="0.00", t3="0.00")

        eid = _make_enrolled_student(client, headers, class_code="GRADE_5")
        # Link a RETURNING student (admitted before 2025)
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"], enrollment_id=eid, admission_year=2024
        )
        return headers, eid

    def test_once_per_year_only_in_term1(self, client: TestClient, db_session: Session):
        """ONCE_PER_YEAR items should only be included in Term 1 invoices."""
        headers, eid = self._setup_with_freq(client, db_session, "ONCE_PER_YEAR")

        r1 = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 1, "academic_year": 2025},
            headers=headers,
        )
        r2 = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 2, "academic_year": 2025},
            headers=headers,
        )
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, r2.text

        # Term 1 total should be higher than Term 2 (includes ONCE_PER_YEAR item)
        assert float(r1.json()["total_amount"]) > float(r2.json()["total_amount"])

    def test_once_per_year_not_charged_again_same_year(self, client: TestClient, db_session: Session):
        """After Term 1 invoice, the ONCE_PER_YEAR item should not be re-charged in any subsequent Term 1 regeneration."""
        headers, eid = self._setup_with_freq(client, db_session, "ONCE_PER_YEAR")

        r1 = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 1, "academic_year": 2025},
            headers=headers,
        )
        assert r1.status_code == 200, r1.text
        # Duplicate guard prevents second Term 1 invoice altogether
        r2 = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 1, "academic_year": 2025},
            headers=headers,
        )
        assert r2.status_code in (400, 409), r2.text


# ── ONCE_EVER guard ───────────────────────────────────────────────────────────

class TestOnceEverGuard:
    def test_once_ever_not_in_term2(self, client: TestClient, db_session: Session):
        """ONCE_EVER item charged in Term 1 should not appear in Term 2 invoice."""
        slug = f"oe-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE + ENROLLMENT_MANAGE)

        cat_id = _create_category(client, headers)
        per_term_item = _create_fee_item(client, headers, cat_id=cat_id, charge_frequency="PER_TERM")
        once_ever_item = _create_fee_item(client, headers, cat_id=cat_id, charge_frequency="ONCE_EVER")

        structure = _create_structure(client, headers, class_code="GRADE_6", academic_year=2025, student_type="RETURNING")
        _add_item_to_structure(client, headers, structure_id=structure["id"], fee_item_id=per_term_item)
        _add_item_to_structure(
            client, headers,
            structure_id=structure["id"],
            fee_item_id=once_ever_item,
            t1="500.00", t2="500.00", t3="500.00",
        )

        eid = _make_enrolled_student(client, headers, class_code="GRADE_6")
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"], enrollment_id=eid, admission_year=2024
        )

        r1 = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 1, "academic_year": 2025},
            headers=headers,
        )
        r2 = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 2, "academic_year": 2025},
            headers=headers,
        )
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, r2.text

        # Term 1 should include ONCE_EVER item, Term 2 should not
        assert float(r1.json()["total_amount"]) > float(r2.json()["total_amount"])


# ── Payment Settings ──────────────────────────────────────────────────────────

class TestPaymentSettings:
    def test_get_payment_settings_404_when_empty(self, client: TestClient, db_session: Session):
        slug = f"ps-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=["finance.policy.view"])

        resp = client.get(f"{BASE}/payment-settings", headers=headers)
        assert resp.status_code == 404

    def test_upsert_and_get_payment_settings(self, client: TestClient, db_session: Session):
        slug = f"ps2-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=["finance.policy.view", "finance.policy.manage"],
        )

        resp = client.put(
            f"{BASE}/payment-settings",
            json={
                "mpesa_paybill": "522522",
                "mpesa_business_no": "1234567",
                "bank_name": "Equity Bank",
                "bank_account_number": "0123456789",
                "cash_payment_instructions": "Pay at bursar's office",
                "assessment_books_amount": "350",
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["mpesa_paybill"] == "522522"
        assert data["bank_name"] == "Equity Bank"
        assert float(data["assessment_books_amount"]) == 350.0

        # Verify GET now returns the data
        get_resp = client.get(f"{BASE}/payment-settings", headers=headers)
        assert get_resp.status_code == 200
        assert get_resp.json()["mpesa_paybill"] == "522522"

    def test_upsert_is_idempotent(self, client: TestClient, db_session: Session):
        slug = f"ps3-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=["finance.policy.view", "finance.policy.manage"],
        )

        client.put(f"{BASE}/payment-settings", json={"mpesa_paybill": "111"}, headers=headers)
        resp = client.put(f"{BASE}/payment-settings", json={"mpesa_paybill": "222"}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["mpesa_paybill"] == "222"

    def test_get_requires_policy_view(self, client: TestClient, db_session: Session):
        slug = f"ps4-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])

        resp = client.get(f"{BASE}/payment-settings", headers=headers)
        assert resp.status_code == 403

    def test_put_requires_policy_manage(self, client: TestClient, db_session: Session):
        slug = f"ps5-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=["finance.policy.view"])

        resp = client.put(f"{BASE}/payment-settings", json={"mpesa_paybill": "999"}, headers=headers)
        assert resp.status_code == 403

    def test_tenant_isolation(self, client: TestClient, db_session: Session):
        slug_a = f"psa-{uuid4().hex[:6]}"
        slug_b = f"psb-{uuid4().hex[:6]}"
        tenant_a = create_tenant(db_session, slug=slug_a, domain=f"{slug_a}.example.com")
        tenant_b = create_tenant(db_session, slug=slug_b, domain=f"{slug_b}.example.com")
        _, headers_a = make_actor(
            db_session, tenant=tenant_a,
            permissions=["finance.policy.view", "finance.policy.manage"],
        )
        _, headers_b = make_actor(
            db_session, tenant=tenant_b,
            permissions=["finance.policy.view"],
        )

        client.put(f"{BASE}/payment-settings", json={"mpesa_paybill": "A_PAYBILL"}, headers=headers_a)

        resp_b = client.get(f"{BASE}/payment-settings", headers=headers_b)
        # Tenant B has no settings
        assert resp_b.status_code == 404


# ────────────────────────────────────────────────────────────────────────────
# Student-type resolver (NEW vs RETURNING)
#
# Exercises the 4-step rule end-to-end via the v2 generation endpoint, so each
# test asserts both the chosen student_type AND the resolved_by tag that is
# stashed on invoice.meta + the audit payload. The rule, in priority order:
#
#   Step 0  force_student_type            -> force_override
#   Step 1  enrollment_source = EXISTING  -> source_override   (RETURNING)
#   Step 2  prior non-cancelled fees inv  -> prior_invoice     (RETURNING)
#   Step 3  admission_year < academic_yr  -> year_math         (RETURNING)
#   Step 4  otherwise                     -> first_intake      (NEW)
# ────────────────────────────────────────────────────────────────────────────

from sqlalchemy import text


def _make_enrolled_student_with_source(
    client, headers, *, class_code: str = "GRADE_1", source: str | None = None,
) -> str:
    """Create an enrollment carrying an explicit enrollment_source on the
    payload (used to exercise Step 1)."""
    payload: dict = {"student_name": "Test Student", "class_code": class_code}
    if source is not None:
        payload["enrollment_source"] = source
    enr = client.post("/api/v1/enrollments/", json={"payload": payload}, headers=headers)
    assert enr.status_code in (200, 201), enr.text
    eid = enr.json()["id"]
    client.post(f"/api/v1/enrollments/{eid}/submit", headers=headers)
    client.post(f"/api/v1/enrollments/{eid}/approve", headers=headers)
    client.post(f"/api/v1/enrollments/{eid}/enroll", json={}, headers=headers)
    return eid


def _generate_v2(
    client, headers, *, enrollment_id: str, term: int, year: int,
    force_student_type: str | None = None,
):
    body: dict = {
        "enrollment_id": enrollment_id,
        "term_number": term,
        "academic_year": year,
    }
    if force_student_type:
        body["force_student_type"] = force_student_type
    return client.post(
        f"{BASE}/invoices/generate/fees/v2",
        json=body,
        headers=headers,
    )


def _invoice_meta(db: Session, *, invoice_id: str) -> dict:
    row = db.execute(
        text("SELECT meta FROM core.invoices WHERE id = :id"),
        {"id": invoice_id},
    ).mappings().first()
    return dict(row["meta"] or {}) if row else {}


def _setup_structures_both_types(client, headers, *, class_code: str, year: int):
    """Create both NEW and RETURNING structures for the same class+year so
    force-override tests have a target for either side."""
    _setup_full_structure(client, headers, class_code=class_code, academic_year=year, student_type="RETURNING")
    _setup_full_structure(client, headers, class_code=class_code, academic_year=year, student_type="NEW")


class TestStudentTypeResolution:
    # ── Step 0: force override ──────────────────────────────────────────────

    def test_force_new_overrides_everything(
        self, client: TestClient, db_session: Session
    ):
        """force_student_type=NEW wins even when the student would otherwise
        be classified RETURNING (e.g. via year math)."""
        slug = f"stres1-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )
        _setup_structures_both_types(client, headers, class_code="GRADE_1", year=2026)
        eid = _make_enrolled_student(client, headers, class_code="GRADE_1")
        # admission_year = 2025 -> year_math would say RETURNING
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"],
            enrollment_id=eid, admission_year=2025,
        )

        resp = _generate_v2(
            client, headers, enrollment_id=eid, term=1, year=2026,
            force_student_type="NEW",
        )
        assert resp.status_code == 200, resp.text
        inv = resp.json()
        assert inv["student_type_snapshot"] == "NEW"
        meta = _invoice_meta(db_session, invoice_id=inv["id"])
        assert meta.get("student_type") == "NEW"
        assert meta.get("student_type_resolved_by") == "force_override"

    def test_force_returning_overrides_first_intake(
        self, client: TestClient, db_session: Session
    ):
        """force_student_type=RETURNING wins on a brand-new student that
        would otherwise be classified NEW."""
        slug = f"stres2-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )
        _setup_structures_both_types(client, headers, class_code="GRADE_1", year=2026)
        eid = _make_enrolled_student(client, headers, class_code="GRADE_1")
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"],
            enrollment_id=eid, admission_year=2026,
        )

        resp = _generate_v2(
            client, headers, enrollment_id=eid, term=1, year=2026,
            force_student_type="RETURNING",
        )
        assert resp.status_code == 200, resp.text
        meta = _invoice_meta(db_session, invoice_id=resp.json()["id"])
        assert meta.get("student_type") == "RETURNING"
        assert meta.get("student_type_resolved_by") == "force_override"

    # ── Step 1: existing-student source override ────────────────────────────

    def test_existing_student_source_is_always_returning(
        self, client: TestClient, db_session: Session
    ):
        """enrollment_source=EXISTING_STUDENT forces RETURNING regardless of
        admission_year (existing students paid admission outside the system).
        """
        slug = f"stres3-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )
        _setup_full_structure(
            client, headers, class_code="GRADE_2",
            academic_year=2026, student_type="RETURNING",
        )
        eid = _make_enrolled_student_with_source(
            client, headers, class_code="GRADE_2", source="EXISTING_STUDENT",
        )
        # admission_year = 2026 -> year_math would say NEW
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"],
            enrollment_id=eid, admission_year=2026,
        )

        resp = _generate_v2(client, headers, enrollment_id=eid, term=1, year=2026)
        assert resp.status_code == 200, resp.text
        meta = _invoice_meta(db_session, invoice_id=resp.json()["id"])
        assert meta.get("student_type") == "RETURNING"
        assert meta.get("student_type_resolved_by") == "source_override"

    # ── Step 2: prior invoice ───────────────────────────────────────────────

    def test_second_term_returns_returning_via_prior_invoice(
        self, client: TestClient, db_session: Session
    ):
        """A wizard intake student who already has a Term 1 invoice should be
        classified RETURNING for Term 2 of the SAME year — not re-billed as
        NEW. This is the Term-2-of-same-year bug the 4-step rule fixes."""
        slug = f"stres4-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )
        _setup_structures_both_types(client, headers, class_code="GRADE_3", year=2026)
        eid = _make_enrolled_student_with_source(
            client, headers, class_code="GRADE_3", source="NEW_STUDENT_INTAKE",
        )
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"],
            enrollment_id=eid, admission_year=2026,
        )

        # Term 1 — first intake → NEW.
        r1 = _generate_v2(client, headers, enrollment_id=eid, term=1, year=2026)
        assert r1.status_code == 200, r1.text
        meta1 = _invoice_meta(db_session, invoice_id=r1.json()["id"])
        assert meta1.get("student_type") == "NEW"
        assert meta1.get("student_type_resolved_by") == "first_intake"

        # Term 2 — now there's a prior invoice → RETURNING via prior_invoice.
        r2 = _generate_v2(client, headers, enrollment_id=eid, term=2, year=2026)
        assert r2.status_code == 200, r2.text
        meta2 = _invoice_meta(db_session, invoice_id=r2.json()["id"])
        assert meta2.get("student_type") == "RETURNING"
        assert meta2.get("student_type_resolved_by") == "prior_invoice"

    def test_cancelled_prior_invoice_does_not_count(
        self, client: TestClient, db_session: Session
    ):
        """A CANCELLED prior invoice must NOT keep a student classified as
        RETURNING — they fall through to year-math / first-intake."""
        slug = f"stres5-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )
        _setup_structures_both_types(client, headers, class_code="GRADE_4", year=2026)
        eid = _make_enrolled_student_with_source(
            client, headers, class_code="GRADE_4", source="NEW_STUDENT_INTAKE",
        )
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"],
            enrollment_id=eid, admission_year=2026,
        )

        # Create + immediately CANCEL a Term 1 invoice.
        r1 = _generate_v2(client, headers, enrollment_id=eid, term=1, year=2026)
        assert r1.status_code == 200, r1.text
        first_id = r1.json()["id"]
        db_session.execute(
            text("UPDATE core.invoices SET status = 'CANCELLED' WHERE id = :id"),
            {"id": first_id},
        )
        db_session.commit()

        # Term 2 — the only prior invoice is CANCELLED, so prior_invoice is
        # NOT triggered. admission_year = 2026 = academic_year → first_intake.
        r2 = _generate_v2(client, headers, enrollment_id=eid, term=2, year=2026)
        assert r2.status_code == 200, r2.text
        meta2 = _invoice_meta(db_session, invoice_id=r2.json()["id"])
        assert meta2.get("student_type") == "NEW"
        assert meta2.get("student_type_resolved_by") == "first_intake"

    def test_prior_invoice_check_spans_enrollments_for_same_student(
        self, client: TestClient, db_session: Session
    ):
        """If a student has TWO enrollments and one of them already has a
        fees invoice, the OTHER enrollment's new invoice should still detect
        the prior — the resolver keys on student_id, not enrollment_id."""
        slug = f"stres6-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )
        _setup_structures_both_types(client, headers, class_code="GRADE_5", year=2026)
        eid_a = _make_enrolled_student_with_source(
            client, headers, class_code="GRADE_5", source="NEW_STUDENT_INTAKE",
        )
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"],
            enrollment_id=eid_a, admission_year=2026,
        )
        # Generate Term 1 on enrollment A.
        ra = _generate_v2(client, headers, enrollment_id=eid_a, term=1, year=2026)
        assert ra.status_code == 200

        # Now create a SECOND enrollment for the same student (re-admission
        # in the same year is uncommon but legal at the data layer; the
        # resolver must not be fooled).
        student_id = db_session.execute(
            text("SELECT student_id FROM core.enrollments WHERE id = :id"),
            {"id": eid_a},
        ).scalar_one()
        # Forge a second enrollment row pointing at the same student.
        eid_b_raw = db_session.execute(
            text(
                "INSERT INTO core.enrollments "
                "(tenant_id, student_id, status, payload) "
                "VALUES (:tid, :sid, 'ENROLLED', "
                "        CAST('{\"class_code\":\"GRADE_5\"}' AS jsonb)) "
                "RETURNING id"
            ),
            {"tid": str(tenant.id), "sid": str(student_id)},
        ).scalar_one()
        db_session.commit()

        # Term 2 against enrollment B → still RETURNING (prior_invoice from
        # enrollment A on the same student).
        rb = _generate_v2(client, headers, enrollment_id=str(eid_b_raw), term=2, year=2026)
        assert rb.status_code == 200, rb.text
        meta_b = _invoice_meta(db_session, invoice_id=rb.json()["id"])
        assert meta_b.get("student_type") == "RETURNING"
        assert meta_b.get("student_type_resolved_by") == "prior_invoice"

    # ── Step 3: year math ───────────────────────────────────────────────────

    def test_year_math_returning_when_admission_year_predates(
        self, client: TestClient, db_session: Session
    ):
        """admission_year < academic_year (no prior invoice, no source
        override) → RETURNING via year_math."""
        slug = f"stres7-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )
        _setup_full_structure(
            client, headers, class_code="GRADE_6",
            academic_year=2026, student_type="RETURNING",
        )
        eid = _make_enrolled_student_with_source(
            client, headers, class_code="GRADE_6", source="NEW_STUDENT_INTAKE",
        )
        # admission_year = 2025, generating Term 1 2026 → year_math.
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"],
            enrollment_id=eid, admission_year=2025,
        )

        resp = _generate_v2(client, headers, enrollment_id=eid, term=1, year=2026)
        assert resp.status_code == 200, resp.text
        meta = _invoice_meta(db_session, invoice_id=resp.json()["id"])
        assert meta.get("student_type") == "RETURNING"
        assert meta.get("student_type_resolved_by") == "year_math"

    # ── Step 4: first intake ────────────────────────────────────────────────

    def test_first_intake_returns_new(
        self, client: TestClient, db_session: Session
    ):
        """admission_year == academic_year, no prior invoice, no source
        override → NEW via first_intake."""
        slug = f"stres8-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )
        _setup_full_structure(
            client, headers, class_code="GRADE_7",
            academic_year=2026, student_type="NEW",
        )
        eid = _make_enrolled_student_with_source(
            client, headers, class_code="GRADE_7", source="NEW_STUDENT_INTAKE",
        )
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"],
            enrollment_id=eid, admission_year=2026,
        )

        resp = _generate_v2(client, headers, enrollment_id=eid, term=1, year=2026)
        assert resp.status_code == 200, resp.text
        meta = _invoice_meta(db_session, invoice_id=resp.json()["id"])
        assert meta.get("student_type") == "NEW"
        assert meta.get("student_type_resolved_by") == "first_intake"

    # ── Audit log carries the resolution tag ────────────────────────────────

    def test_audit_payload_includes_resolved_by(
        self, client: TestClient, db_session: Session
    ):
        """invoice.create.v2 audit event must persist the resolved_by tag
        so directors can audit classification decisions."""
        from app.models.audit_log import AuditLog
        from sqlalchemy import select as sa_select
        slug = f"stres9-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
        )
        _setup_full_structure(
            client, headers, class_code="GRADE_8",
            academic_year=2026, student_type="NEW",
        )
        eid = _make_enrolled_student_with_source(
            client, headers, class_code="GRADE_8", source="NEW_STUDENT_INTAKE",
        )
        _link_student_admission_year(
            db_session, tenant_id=headers["X-Tenant-ID"],
            enrollment_id=eid, admission_year=2026,
        )
        resp = _generate_v2(client, headers, enrollment_id=eid, term=1, year=2026)
        assert resp.status_code == 200, resp.text

        audit = db_session.execute(
            sa_select(AuditLog)
            .where(
                AuditLog.tenant_id == tenant.id,
                AuditLog.action == "invoice.create.v2",
            )
            .order_by(AuditLog.created_at.desc())
        ).scalars().first()
        assert audit is not None
        assert audit.payload.get("student_type") == "NEW"
        assert audit.payload.get("student_type_resolved_by") == "first_intake"
