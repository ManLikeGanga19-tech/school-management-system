"""Phase F1 — scholarship core: FULL_WAIVER, capacity validator, soft-revoke
lifecycle (cancel/replace/delete).

Covers the contract the rest of Phase F builds on:
  * FULL_WAIVER zeroes invoices for students with no arrears
  * FULL_WAIVER without covers_carry_forward leaves bundled arrears billed
  * FULL_WAIVER with covers_carry_forward clears arrears too
  * FIXED scholarship budget cap enforced (was silently overrun in v2)
  * max_recipients cap enforced as unique-students (idempotent re-apply)
  * Revoke on invoice delete frees the slot
  * Revoke on invoice replace frees the slot
"""
from __future__ import annotations

import json
from decimal import Decimal
from uuid import uuid4

import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.finance import service as finance_service
from app.models.invoice import Invoice
from app.models.scholarship import Scholarship
from app.models.scholarship_allocation import ScholarshipAllocation
from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/finance"

PERMS = [
    "finance.scholarships.view", "finance.scholarships.manage",
    "finance.invoices.view", "finance.invoices.manage",
    "finance.fees.view", "finance.fees.manage",
    "finance.policy.view", "finance.policy.manage",
    "enrollment.manage",
]


def _seed_student(db: Session, *, tenant_id, admission_year=2025) -> str:
    sid = str(uuid4())
    db.execute(sa.text(
        "INSERT INTO core.students (id, tenant_id, admission_no, "
        "first_name, last_name, status, admission_year) "
        "VALUES (:id, :tid, :adm, 'Test', 'Student', 'ACTIVE', :ay)"
    ), {
        "id": sid, "tid": str(tenant_id),
        "adm": f"ADM-{uuid4().hex[:6].upper()}",
        "ay": admission_year,
    })
    db.commit()
    return sid


def _seed_enrollment(db: Session, *, tenant_id, student_id, class_code="GRADE_1") -> str:
    eid = str(uuid4())
    payload = {"student_name": "Test Student", "class_code": class_code,
               "admission_class": class_code}
    db.execute(sa.text(
        "INSERT INTO core.enrollments "
        "(id, tenant_id, student_id, admission_number, status, payload) "
        "VALUES (:id, :tid, :sid, :adm, 'ENROLLED', CAST(:pl AS jsonb))"
    ), {
        "id": eid, "tid": str(tenant_id), "sid": student_id,
        "adm": f"ADM-{uuid4().hex[:6].upper()}",
        "pl": json.dumps(payload),
    })
    db.commit()
    return eid


def _seed_structure(client, headers, *, class_code="GRADE_1", academic_year=2026,
                    student_type="RETURNING", fee_amount="10000"):
    """Create category + item + structure + add item. Returns structure_id."""
    cat = client.post(
        f"{BASE}/fee-categories",
        json={"code": f"TUIT-{uuid4().hex[:4]}", "name": "Tuition"},
        headers=headers,
    )
    assert cat.status_code == 200
    cat_id = cat.json()["id"]

    item = client.post(
        f"{BASE}/fee-items",
        json={
            "category_id": cat_id,
            "code": f"FEE-{uuid4().hex[:4]}",
            "name": "Fee",
            "charge_frequency": "PER_TERM",
        },
        headers=headers,
    )
    assert item.status_code == 200
    item_id = item.json()["id"]

    structure = client.post(
        f"{BASE}/fee-structures",
        json={
            "code": f"STR-{uuid4().hex[:4]}",
            "name": "Structure",
            "class_code": class_code,
            "academic_year": academic_year,
            "student_type": student_type,
            "is_active": True,
        },
        headers=headers,
    )
    assert structure.status_code == 200
    structure_id = structure.json()["id"]

    add = client.post(
        f"{BASE}/fee-structures/{structure_id}/items",
        json={
            "fee_item_id": item_id,
            "term_1_amount": fee_amount,
            "term_2_amount": fee_amount,
            "term_3_amount": fee_amount,
        },
        headers=headers,
    )
    assert add.status_code == 200, add.text
    return structure_id


# ── FULL_WAIVER ─────────────────────────────────────────────────────────────

class TestFullWaiver:
    def test_full_waiver_zeroes_invoice_for_student_without_arrears(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee_amount="10000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)

        sch = client.post(
            f"{BASE}/scholarships",
            json={
                "name": "Full Bursary", "type": "FULL_WAIVER",
                "value": "0", "is_active": True,
            },
            headers=headers,
        ).json()

        resp = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={
                "enrollment_id": eid, "term_number": 1, "academic_year": 2026,
                "scholarship_id": sch["id"],
                "scholarship_reason": "Top performer",
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        inv = resp.json()
        assert Decimal(str(inv["total_amount"])) == Decimal("0.00")
        assert Decimal(str(inv["balance_amount"])) == Decimal("0.00")

    def test_full_waiver_without_carry_forward_flag_leaves_arrears_billed(
        self, client: TestClient, db_session: Session
    ):
        """Student has KES 3,000 of bundled arrears + KES 10,000 current term.
        FULL_WAIVER (covers_carry_forward=False default) waives 10,000;
        balance = 3,000."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee_amount="10000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)

        # Seed a 3,000 carry-forward debit for this student.
        db_session.execute(sa.text(
            "INSERT INTO core.student_carry_forward_balances "
            "(id, tenant_id, student_id, category, amount, status, term_label) "
            "VALUES (:id, :tid, :sid, 'MANUAL_DEBIT', 3000, 'OPEN', 'Prior term')"
        ), {"id": str(uuid4()), "tid": str(tenant.id), "sid": sid})
        db_session.commit()

        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Bursary", "type": "FULL_WAIVER", "value": "0",
                  "is_active": True, "covers_carry_forward": False},
            headers=headers,
        ).json()

        resp = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={
                "enrollment_id": eid, "term_number": 1, "academic_year": 2026,
                "scholarship_id": sch["id"],
                "scholarship_reason": "Full bursary, arrears remain billed",
                "include_carry_forward": True,
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        inv = resp.json()
        # Lines: +10000 current + 3000 arrears - 10000 waiver = 3000
        assert Decimal(str(inv["total_amount"])) == Decimal("3000.00")
        assert Decimal(str(inv["balance_amount"])) == Decimal("3000.00")

    def test_full_waiver_with_carry_forward_flag_clears_arrears_too(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee_amount="10000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        db_session.execute(sa.text(
            "INSERT INTO core.student_carry_forward_balances "
            "(id, tenant_id, student_id, category, amount, status, term_label) "
            "VALUES (:id, :tid, :sid, 'MANUAL_DEBIT', 3000, 'OPEN', 'Prior term')"
        ), {"id": str(uuid4()), "tid": str(tenant.id), "sid": sid})
        db_session.commit()

        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Total Waiver", "type": "FULL_WAIVER", "value": "0",
                  "is_active": True, "covers_carry_forward": True},
            headers=headers,
        ).json()

        resp = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={
                "enrollment_id": eid, "term_number": 1, "academic_year": 2026,
                "scholarship_id": sch["id"],
                "scholarship_reason": "Full waiver inc. arrears",
                "include_carry_forward": True,
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        inv = resp.json()
        assert Decimal(str(inv["total_amount"])) == Decimal("0.00")
        assert Decimal(str(inv["balance_amount"])) == Decimal("0.00")


# ── Capacity guards (FIXED budget + recipient cap) ─────────────────────────

class TestCapacityGuards:
    def test_fixed_budget_cap_enforced_in_v2(
        self, client: TestClient, db_session: Session
    ):
        """Was silently overrun before F1 — v2 now hard-errors on overrun."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee_amount="10000")

        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Pool", "type": "FIXED", "value": "15000",
                  "is_active": True},
            headers=headers,
        ).json()

        sid1 = _seed_student(db_session, tenant_id=tenant.id)
        eid1 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid1)
        ok = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={
                "enrollment_id": eid1, "term_number": 1, "academic_year": 2026,
                "scholarship_id": sch["id"],
                "scholarship_amount": "10000",
                "scholarship_reason": "Recipient #1",
            },
            headers=headers,
        )
        assert ok.status_code == 200, ok.text

        sid2 = _seed_student(db_session, tenant_id=tenant.id)
        eid2 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid2)
        # Pool has only 5,000 left → asking for 10,000 must error.
        overrun = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={
                "enrollment_id": eid2, "term_number": 1, "academic_year": 2026,
                "scholarship_id": sch["id"],
                "scholarship_amount": "10000",
                "scholarship_reason": "Should fail",
            },
            headers=headers,
        )
        assert overrun.status_code == 400
        assert "pool exhausted" in overrun.text.lower()

    def test_recipient_cap_enforced_as_unique_students(
        self, client: TestClient, db_session: Session
    ):
        """max_recipients=2 with three distinct students → third one rejected."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee_amount="10000")

        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Top 2", "type": "FULL_WAIVER",
                  "value": "0", "max_recipients": 2,
                  "is_active": True},
            headers=headers,
        ).json()

        for i in range(2):
            sid = _seed_student(db_session, tenant_id=tenant.id)
            eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
            ok = client.post(
                f"{BASE}/invoices/generate/fees/v2",
                json={
                    "enrollment_id": eid, "term_number": 1, "academic_year": 2026,
                    "scholarship_id": sch["id"],
                    "scholarship_reason": f"Recipient {i+1}",
                },
                headers=headers,
            )
            assert ok.status_code == 200, ok.text

        sid3 = _seed_student(db_session, tenant_id=tenant.id)
        eid3 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid3)
        denied = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={
                "enrollment_id": eid3, "term_number": 1, "academic_year": 2026,
                "scholarship_id": sch["id"],
                "scholarship_reason": "Should fail",
            },
            headers=headers,
        )
        assert denied.status_code == 400
        assert "recipient cap" in denied.text.lower()

    def test_recipient_cap_idempotent_for_same_student_across_terms(
        self, client: TestClient, db_session: Session
    ):
        """Same student getting the waiver in T1 then T2 must NOT count as
        two recipients — the slot is theirs."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee_amount="10000")
        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Solo", "type": "FULL_WAIVER", "value": "0",
                  "max_recipients": 1, "is_active": True},
            headers=headers,
        ).json()

        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        for term in (1, 2):
            ok = client.post(
                f"{BASE}/invoices/generate/fees/v2",
                json={
                    "enrollment_id": eid, "term_number": term, "academic_year": 2026,
                    "scholarship_id": sch["id"],
                    "scholarship_reason": f"Term {term}",
                },
                headers=headers,
            )
            assert ok.status_code == 200, ok.text


# ── Soft-revoke lifecycle ──────────────────────────────────────────────────

class TestRevokeOnDelete:
    def test_invoice_delete_revokes_allocation_freeing_slot(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee_amount="10000")
        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Once", "type": "FULL_WAIVER",
                  "value": "0", "max_recipients": 1, "is_active": True},
            headers=headers,
        ).json()

        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        ok = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={
                "enrollment_id": eid, "term_number": 1, "academic_year": 2026,
                "scholarship_id": sch["id"], "scholarship_reason": "First award",
            },
            headers=headers,
        )
        inv_id = ok.json()["id"]

        # Delete (hard) — DRAFT invoice + secretary perms allow it.
        client.delete(f"{BASE}/invoices/{inv_id}", headers=headers)

        # Allocation row survives (audit) but is REVOKED.
        row = db_session.execute(sa.text(
            "SELECT status FROM core.scholarship_allocations "
            "WHERE tenant_id = :tid AND scholarship_id = :sid"
        ), {"tid": str(tenant.id), "sid": sch["id"]}).mappings().first()
        assert row is not None
        assert row["status"] == "REVOKED"

        # Slot is free — second student can now claim it.
        sid2 = _seed_student(db_session, tenant_id=tenant.id)
        eid2 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid2)
        re_ok = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={
                "enrollment_id": eid2, "term_number": 1, "academic_year": 2026,
                "scholarship_id": sch["id"],
                "scholarship_reason": "Second award after revoke",
            },
            headers=headers,
        )
        assert re_ok.status_code == 200, re_ok.text

    def test_invoice_replace_revokes_old_allocation(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee_amount="10000")

        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Pool", "type": "FIXED", "value": "10000",
                  "is_active": True},
            headers=headers,
        ).json()

        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        ok = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={
                "enrollment_id": eid, "term_number": 1, "academic_year": 2026,
                "scholarship_id": sch["id"],
                "scholarship_amount": "10000", "scholarship_reason": "Original",
            },
            headers=headers,
        )
        inv_id = ok.json()["id"]

        # Replace (regenerate). New invoice won't carry the scholarship —
        # the old allocation must revoke so the budget is free.
        rep = client.post(
            f"{BASE}/invoices/{inv_id}/replace",
            json={"student_type": "RETURNING", "include_carry_forward": False},
            headers=headers,
        )
        assert rep.status_code == 200, rep.text

        usage = finance_service.scholarship_usage_map(
            db_session, tenant_id=tenant.id,
            scholarship_ids=[__import__("uuid").UUID(sch["id"])],
        )
        from uuid import UUID as _UUID
        assert usage.get(_UUID(sch["id"]), Decimal("0")) == Decimal("0")
