"""Tests for the family-mode (by-parent) record-payment surface.

  GET  /api/v1/finance/parents/{parent_id}/payment-summary
  POST /api/v1/finance/parents/{parent_id}/payments

These exercise the multi-student payment flow: one parent's M-PESA transaction
covering several children produces ONE Payment row with ONE receipt number,
allocations spanning multiple students, and a per-student breakdown on the
receipt payload. Surplus auto-credit must be explicitly directed at one child
when the payment spans siblings (no silent 'first invoice's student' wins).
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.student_carry_forward import StudentCarryForward
from tests.helpers import create_tenant, make_actor


BASE = "/api/v1/finance"

ALL_FINANCE = list({
    "finance.policy.view", "finance.policy.manage",
    "finance.fees.view", "finance.fees.manage",
    "finance.scholarships.view", "finance.scholarships.manage",
    "finance.invoices.view", "finance.invoices.manage",
    "finance.payments.view", "finance.payments.manage",
})


def _seed_student_and_enrollment(
    db: Session, *, tenant_id, admission_no: str | None = None,
    class_code: str = "GRADE_1",
) -> tuple[str, str]:
    sid = uuid4()
    eid = uuid4()
    db.execute(
        text(
            "INSERT INTO core.students "
            "(id, tenant_id, admission_no, first_name, last_name, status, admission_year) "
            "VALUES (:id, :tid, :adm, 'Test', 'Student', 'ACTIVE', 2026)"
        ),
        {"id": str(sid), "tid": str(tenant_id),
         "adm": admission_no or f"ADM-{uuid4().hex[:6].upper()}"},
    )
    db.execute(
        text(
            "INSERT INTO core.enrollments "
            "(id, tenant_id, student_id, status, payload) "
            "VALUES (:id, :tid, :sid, 'ENROLLED', "
            "        CAST(:payload AS jsonb))"
        ),
        {
            "id": str(eid), "tid": str(tenant_id), "sid": str(sid),
            "payload": '{"class_code": "' + class_code + '"}',
        },
    )
    db.commit()
    return str(sid), str(eid)


def _seed_parent_with_children(
    db: Session, *, tenant_id, n_children: int = 2,
) -> tuple[str, list[tuple[str, str]]]:
    """Create a parent + n children, returning (parent_id, [(sid, eid), ...])."""
    pid = uuid4()
    db.execute(
        text(
            "INSERT INTO core.parents "
            "(id, tenant_id, first_name, last_name, phone) "
            "VALUES (:id, :tid, 'Jane', 'Wanjiru', :phone)"
        ),
        {"id": str(pid), "tid": str(tenant_id),
         "phone": f"07{uuid4().hex[:8]}"},
    )
    db.commit()
    children: list[tuple[str, str]] = []
    for _ in range(n_children):
        sid, eid = _seed_student_and_enrollment(db, tenant_id=tenant_id)
        db.execute(
            text(
                "INSERT INTO core.parent_enrollment_links "
                "(tenant_id, parent_id, enrollment_id, relationship, is_primary) "
                "VALUES (:tid, :pid, :eid, 'GUARDIAN', false)"
            ),
            {"tid": str(tenant_id), "pid": str(pid), "eid": eid},
        )
        children.append((sid, eid))
    db.commit()
    return str(pid), children


def _seed_invoice(
    db: Session, *, tenant_id, enrollment_id: str,
    term_number: int, academic_year: int, total: Decimal,
    invoice_no: str | None = None,
) -> str:
    iid = uuid4()
    db.execute(
        text(
            "INSERT INTO core.invoices "
            "(id, tenant_id, invoice_no, invoice_type, status, enrollment_id, "
            " term_number, academic_year, currency, total_amount, paid_amount, balance_amount) "
            "VALUES (:id, :tid, :no, 'SCHOOL_FEES', 'ISSUED', :eid, :tn, :yr, "
            "        'KES', :total, 0, :total)"
        ),
        {
            "id": str(iid), "tid": str(tenant_id),
            "no": invoice_no or f"INV-{uuid4().hex[:6].upper()}",
            "eid": enrollment_id, "tn": term_number, "yr": academic_year,
            "total": str(total),
        },
    )
    db.execute(
        text(
            "INSERT INTO core.invoice_lines (invoice_id, description, amount) "
            "VALUES (:iid, 'Tuition', :amt)"
        ),
        {"iid": str(iid), "amt": str(total)},
    )
    db.commit()
    return str(iid)


# ────────────────────────────────────────────────────────────────────────────
# Parent payment summary
# ────────────────────────────────────────────────────────────────────────────

class TestParentSummary:
    def test_summary_lists_each_child_with_family_total(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"ps-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("8000"))
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                      term_number=2, academic_year=2026, total=Decimal("12000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.get(f"{BASE}/parents/{pid}/payment-summary", headers=headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["parent_id"] == pid
        assert len(body["children"]) == 2
        assert Decimal(body["family_total_outstanding"]) == Decimal("20000")
        # Per-child summaries embed the StudentPaymentSummary fields.
        for child in body["children"]:
            assert "total_outstanding" in child
            assert "invoices" in child

    def test_summary_includes_open_credit_in_family_total(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"ps2-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("10000"))
        # Child B has a goodwill credit on file (no invoice).
        db_session.add(StudentCarryForward(
            tenant_id=tenant.id, student_id=sid_b,
            term_label="Goodwill", amount=Decimal("-3000"),
            category="GOODWILL_CREDIT", status="OPEN",
        ))
        db_session.commit()
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        body = client.get(
            f"{BASE}/parents/{pid}/payment-summary", headers=headers
        ).json()
        # 10,000 owed by A + (-3,000) credit for B = 7,000 net family total.
        assert Decimal(body["family_total_outstanding"]) == Decimal("7000")

    def test_summary_empty_when_no_children(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"ps3-{uuid4().hex[:6]}")
        pid, _children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=0
        )
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        body = client.get(
            f"{BASE}/parents/{pid}/payment-summary", headers=headers
        ).json()
        assert body["children"] == []
        assert Decimal(body["family_total_outstanding"]) == 0

    def test_summary_404_for_parent_in_another_tenant(
        self, client: TestClient, db_session: Session
    ):
        ta = create_tenant(db_session, slug=f"ps4a-{uuid4().hex[:6]}")
        tb = create_tenant(db_session, slug=f"ps4b-{uuid4().hex[:6]}")
        pid_a, _ = _seed_parent_with_children(db_session, tenant_id=ta.id)
        _, headers_b = make_actor(db_session, tenant=tb, permissions=ALL_FINANCE)
        resp = client.get(f"{BASE}/parents/{pid_a}/payment-summary", headers=headers_b)
        assert resp.status_code == 404


# ────────────────────────────────────────────────────────────────────────────
# Record family payment — auto mode
# ────────────────────────────────────────────────────────────────────────────

class TestFamilyRecordAuto:
    def test_auto_exact_covers_two_children_one_payment_one_receipt(
        self, client: TestClient, db_session: Session
    ):
        """Parent sends KES 20k that exactly covers two children's outstanding.
        Result: one Payment row, one receipt number, allocations spanning both
        children, no surplus, no CF created."""
        tenant = create_tenant(db_session, slug=f"fr-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        iid_a = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                              term_number=1, academic_year=2026, total=Decimal("8000"))
        iid_b = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                              term_number=1, academic_year=2026, total=Decimal("12000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={"amount": "20000", "provider": "MPESA", "reference": "MX1"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert Decimal(body["allocated_total"]) == Decimal("20000")
        assert Decimal(body["surplus_credit"]) == 0
        assert body["credit_balance_id"] is None
        # Per-student breakdown, sorted by name, both present.
        students = body["students"]
        assert len(students) == 2
        sid_to_subtotal = {s["student_id"]: Decimal(s["subtotal"]) for s in students}
        assert sid_to_subtotal[sid_a] == Decimal("8000")
        assert sid_to_subtotal[sid_b] == Decimal("12000")

        # Exactly one Payment row + one receipt number.
        payment_count = db_session.execute(
            text(
                "SELECT COUNT(*) FROM core.payments WHERE tenant_id = :tid"
            ),
            {"tid": str(tenant.id)},
        ).scalar_one()
        assert payment_count == 1
        alloc_count = db_session.execute(
            text(
                "SELECT COUNT(*) FROM core.payment_allocations pa "
                "JOIN core.payments p ON p.id = pa.payment_id "
                "WHERE p.tenant_id = :tid"
            ),
            {"tid": str(tenant.id)},
        ).scalar_one()
        assert alloc_count == 2

        # Both invoices now PAID.
        rows = db_session.execute(
            text("SELECT id, status FROM core.invoices WHERE id = ANY(:ids)"),
            {"ids": [iid_a, iid_b]},
        ).mappings().all()
        assert {r["status"] for r in rows} == {"PAID"}

    def test_auto_fifo_across_family_oldest_year_first(
        self, client: TestClient, db_session: Session
    ):
        """Allocation order is global across the family: 2025 Term 3 of one
        child clears before 2026 Term 1 of the other."""
        tenant = create_tenant(db_session, slug=f"fr2-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        iid_a_2026 = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                                   term_number=1, academic_year=2026, total=Decimal("5000"))
        iid_b_2025 = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                                   term_number=3, academic_year=2025, total=Decimal("3000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={"amount": "3000", "provider": "CASH"},
            headers=headers,
        )
        assert resp.status_code == 200
        # The 3,000 must clear child B's older 2025 invoice first.
        rows = db_session.execute(
            text("SELECT id, status, balance_amount FROM core.invoices WHERE id = ANY(:ids)"),
            {"ids": [iid_a_2026, iid_b_2025]},
        ).mappings().all()
        by_id = {str(r["id"]): r for r in rows}
        assert by_id[iid_b_2025]["status"] == "PAID"
        assert by_id[iid_a_2026]["status"] == "ISSUED"
        assert Decimal(by_id[iid_a_2026]["balance_amount"]) == Decimal("5000")

    def test_auto_surplus_without_credit_target_rejected_for_multi_child(
        self, client: TestClient, db_session: Session
    ):
        """Multi-child surplus with no credit target → 400, no Payment row."""
        tenant = create_tenant(db_session, slug=f"fr3-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("5000"))
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                      term_number=1, academic_year=2026, total=Decimal("3000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={"amount": "10000", "provider": "MPESA"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "credit_to_student_id" in resp.json()["detail"]
        # No Payment row created.
        count = db_session.execute(
            text("SELECT COUNT(*) FROM core.payments WHERE tenant_id = :tid"),
            {"tid": str(tenant.id)},
        ).scalar_one()
        assert count == 0

    def test_auto_surplus_with_credit_target_creates_one_credit(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"fr4-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("5000"))
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                      term_number=1, academic_year=2026, total=Decimal("3000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={
                "amount": "10000", "provider": "MPESA",
                "credit_to_student_id": sid_b,
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert Decimal(body["allocated_total"]) == Decimal("8000")
        assert Decimal(body["surplus_credit"]) == Decimal("2000")
        assert body["credit_to_student_id"] == sid_b
        assert body["credit_balance_id"] is not None

        # Exactly one OVERPAYMENT_CREDIT on sid_b.
        creds = db_session.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant.id,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
        ).scalars().all()
        assert len(creds) == 1
        assert str(creds[0].student_id) == sid_b
        assert Decimal(str(creds[0].amount)) == Decimal("-2000")

    def test_auto_credit_target_must_be_child_of_parent(
        self, client: TestClient, db_session: Session
    ):
        """credit_to_student_id pointing at a stranger child → 400 before
        any Payment row is created."""
        tenant = create_tenant(db_session, slug=f"fr5-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("5000"))
        sid_outsider, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={
                "amount": "10000", "provider": "CASH",
                "credit_to_student_id": sid_outsider,
            },
            headers=headers,
        )
        assert resp.status_code == 400
        assert "child" in resp.json()["detail"].lower()

    def test_auto_no_invoices_for_family_rejected(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"fr6-{uuid4().hex[:6]}")
        pid, _ = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={"amount": "5000", "provider": "CASH"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "No outstanding" in resp.json()["detail"]


# ────────────────────────────────────────────────────────────────────────────
# Record family payment — manual mode
# ────────────────────────────────────────────────────────────────────────────

class TestFamilyRecordManual:
    def test_manual_per_student_splits_as_instructed(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"fm-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("10000"))
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                      term_number=1, academic_year=2026, total=Decimal("10000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={
                "amount": "9000", "provider": "MPESA",
                "mode": "manual",
                "per_student_allocations": [
                    {"student_id": sid_a, "amount": "6000"},
                    {"student_id": sid_b, "amount": "3000"},
                ],
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        sid_to_sub = {s["student_id"]: Decimal(s["subtotal"]) for s in body["students"]}
        assert sid_to_sub[sid_a] == Decimal("6000")
        assert sid_to_sub[sid_b] == Decimal("3000")
        assert Decimal(body["surplus_credit"]) == 0

    def test_manual_per_student_amount_exceeding_their_outstanding_rejected(
        self, client: TestClient, db_session: Session
    ):
        """No silent spillover from one child to a sibling — refuse with a
        clear message, leave both invoices untouched."""
        tenant = create_tenant(db_session, slug=f"fm2-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        iid_a = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                              term_number=1, academic_year=2026, total=Decimal("5000"))
        iid_b = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                              term_number=1, academic_year=2026, total=Decimal("5000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={
                "amount": "12000", "provider": "CASH",
                "mode": "manual",
                "per_student_allocations": [
                    {"student_id": sid_a, "amount": "8000"},  # > 5,000
                    {"student_id": sid_b, "amount": "4000"},
                ],
            },
            headers=headers,
        )
        assert resp.status_code == 400
        assert "exceeds" in resp.json()["detail"].lower()
        # No payment row created.
        count = db_session.execute(
            text("SELECT COUNT(*) FROM core.payments WHERE tenant_id = :tid"),
            {"tid": str(tenant.id)},
        ).scalar_one()
        assert count == 0

    def test_manual_per_student_sum_above_amount_rejected(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"fm3-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("10000"))
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                      term_number=1, academic_year=2026, total=Decimal("10000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={
                "amount": "5000", "provider": "CASH",
                "mode": "manual",
                "per_student_allocations": [
                    {"student_id": sid_a, "amount": "3000"},
                    {"student_id": sid_b, "amount": "3000"},
                ],
            },
            headers=headers,
        )
        assert resp.status_code == 400
        assert "exceed" in resp.json()["detail"].lower()

    def test_manual_surplus_requires_credit_target(
        self, client: TestClient, db_session: Session
    ):
        """manual mode where per-student sum < amount AND multiple children →
        the leftover must be credited; rejected if credit_to_student_id is
        not supplied."""
        tenant = create_tenant(db_session, slug=f"fm4-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("10000"))
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                      term_number=1, academic_year=2026, total=Decimal("10000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={
                "amount": "10000", "provider": "MPESA",
                "mode": "manual",
                "per_student_allocations": [
                    {"student_id": sid_a, "amount": "4000"},
                    {"student_id": sid_b, "amount": "3000"},
                ],
            },
            headers=headers,
        )
        assert resp.status_code == 400
        assert "credit_to_student_id" in resp.json()["detail"]


# ────────────────────────────────────────────────────────────────────────────
# Transferred children + tenant isolation + receipt payload shape
# ────────────────────────────────────────────────────────────────────────────

class TestEdgeCases:
    def test_transferred_child_with_balance_can_still_be_paid(
        self, client: TestClient, db_session: Session
    ):
        """Final-bill use case: a TRANSFERRED enrollment with an open invoice
        must still appear in the family summary and be payable."""
        tenant = create_tenant(db_session, slug=f"ec-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=1
        )
        (sid_a, eid_a) = children[0]
        iid = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                            term_number=2, academic_year=2026, total=Decimal("4000"))
        # Mark enrollment TRANSFERRED.
        db_session.execute(
            text("UPDATE core.enrollments SET status='TRANSFERRED' WHERE id = :id"),
            {"id": eid_a},
        )
        db_session.commit()
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        # Summary still shows the child.
        body = client.get(
            f"{BASE}/parents/{pid}/payment-summary", headers=headers
        ).json()
        assert len(body["children"]) == 1
        assert Decimal(body["family_total_outstanding"]) == Decimal("4000")

        # Payment goes through.
        resp = client.post(
            f"{BASE}/parents/{pid}/payments",
            json={"amount": "4000", "provider": "CASH"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert Decimal(resp.json()["allocated_total"]) == Decimal("4000")

    def test_record_is_tenant_scoped(
        self, client: TestClient, db_session: Session
    ):
        ta = create_tenant(db_session, slug=f"ec2a-{uuid4().hex[:6]}")
        tb = create_tenant(db_session, slug=f"ec2b-{uuid4().hex[:6]}")
        pid_a, children = _seed_parent_with_children(db_session, tenant_id=ta.id)
        (sid, eid) = children[0]
        _seed_invoice(db_session, tenant_id=ta.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("1000"))
        _, headers_b = make_actor(db_session, tenant=tb, permissions=ALL_FINANCE)
        resp = client.post(
            f"{BASE}/parents/{pid_a}/payments",
            json={"amount": "1000", "provider": "CASH"},
            headers=headers_b,
        )
        # Tenant B can't see Parent A → "no linked children" or 404 surface.
        assert resp.status_code in (400, 404)

    def test_receipt_payload_groups_allocations_by_student(
        self, db_session: Session
    ):
        """build_payment_receipt_document returns a `students` list with
        per-student subtotals — required for the per-student receipt PDF
        rendering of a multi-child payment."""
        from app.api.v1.finance.service import (
            record_parent_payment,
            build_payment_receipt_document,
        )
        from uuid import UUID as _UUID
        tenant = create_tenant(db_session, slug=f"ec3-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("8000"))
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                      term_number=1, academic_year=2026, total=Decimal("12000"))

        result = record_parent_payment(
            db_session,
            tenant_id=tenant.id,
            actor_user_id=None,
            parent_id=_UUID(pid),
            amount=Decimal("20000"),
            provider="MPESA",
            reference="MX-RCP-1",
            mode="auto",
        )
        db_session.commit()

        receipt_payload = build_payment_receipt_document(
            db_session,
            tenant_id=tenant.id,
            payment_id=_UUID(result["payment_id"]),
        )
        assert "students" in receipt_payload
        students = receipt_payload["students"]
        assert len(students) == 2
        # Each student section has identity + subtotal + allocations.
        for stu in students:
            assert stu["student_name"]
            assert "subtotal" in stu
            assert "allocations" in stu and len(stu["allocations"]) >= 1
        # Subtotals sum to the receipt total.
        subtotal_sum = sum(Decimal(s["subtotal"]) for s in students)
        assert subtotal_sum == Decimal(receipt_payload["allocated_total"])

    def test_receipt_payload_includes_surplus_credit_student_when_applicable(
        self, db_session: Session
    ):
        from app.api.v1.finance.service import (
            record_parent_payment,
            build_payment_receipt_document,
        )
        from uuid import UUID as _UUID
        tenant = create_tenant(db_session, slug=f"ec4-{uuid4().hex[:6]}")
        pid, children = _seed_parent_with_children(
            db_session, tenant_id=tenant.id, n_children=2
        )
        (sid_a, eid_a), (sid_b, eid_b) = children
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("5000"))
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid_b,
                      term_number=1, academic_year=2026, total=Decimal("3000"))

        result = record_parent_payment(
            db_session,
            tenant_id=tenant.id,
            actor_user_id=None,
            parent_id=_UUID(pid),
            amount=Decimal("10000"),
            provider="MPESA",
            reference="MX-RCP-2",
            mode="auto",
            credit_to_student_id=_UUID(sid_b),
        )
        db_session.commit()

        receipt_payload = build_payment_receipt_document(
            db_session,
            tenant_id=tenant.id,
            payment_id=_UUID(result["payment_id"]),
        )
        sc = receipt_payload.get("surplus_credit_student")
        assert sc is not None
        assert sc["student_id"] == sid_b
        assert Decimal(receipt_payload["surplus_credit"]) == Decimal("2000")
