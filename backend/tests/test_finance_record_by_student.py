"""Tests for the by-student record-payment surface.

  GET  /api/v1/finance/students/{student_id}/payment-summary
  POST /api/v1/finance/students/{student_id}/payments

These cover the auto-allocation behaviour the secretary's "Record Payment by
student" view depends on: FIFO across open SCHOOL_FEES invoices (oldest term
first), surplus auto-credit, prior-vs-current term split, and the guards we
need to keep wrong amounts out of production.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.enrollment import Enrollment
from app.models.invoice import Invoice
from app.models.student import Student
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

VIEW_ONLY = [
    "finance.invoices.view",
    "finance.payments.view",
]


def _seed_student_and_enrollment(
    db: Session,
    *,
    tenant_id,
    admission_no: str | None = None,
    class_code: str = "GRADE_1",
) -> tuple[str, str]:
    """Seed a SIS student linked to a single enrollment. Returns (student_id, enrollment_id)."""
    sid = uuid4()
    eid = uuid4()
    db.execute(
        text(
            "INSERT INTO core.students "
            "(id, tenant_id, admission_no, first_name, last_name, status, admission_year) "
            "VALUES (:id, :tid, :adm, 'Test', 'Student', 'ACTIVE', 2026)"
        ),
        {
            "id": str(sid),
            "tid": str(tenant_id),
            "adm": admission_no or f"ADM-{uuid4().hex[:6].upper()}",
        },
    )
    db.execute(
        text(
            "INSERT INTO core.enrollments "
            "(id, tenant_id, student_id, status, payload) "
            "VALUES (:id, :tid, :sid, 'ENROLLED', "
            "        CAST(:payload AS jsonb))"
        ),
        {
            "id": str(eid),
            "tid": str(tenant_id),
            "sid": str(sid),
            "payload": '{"class_code": "' + class_code + '"}',
        },
    )
    db.commit()
    return str(sid), str(eid)


def _seed_invoice(
    db: Session,
    *,
    tenant_id,
    enrollment_id: str,
    term_number: int,
    academic_year: int,
    total: Decimal,
    invoice_no: str | None = None,
) -> str:
    """Seed a SCHOOL_FEES invoice + one line. Returns invoice_id."""
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
            "id": str(iid),
            "tid": str(tenant_id),
            "no": invoice_no or f"INV-{uuid4().hex[:6].upper()}",
            "eid": enrollment_id,
            "tn": term_number,
            "yr": academic_year,
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
# Permission guards — the new endpoints inherit the standard payment perms.
# ────────────────────────────────────────────────────────────────────────────

class TestPermissions:
    def test_summary_requires_view_perm(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"rps-perm-{uuid4().hex[:6]}")
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get(f"{BASE}/students/{sid}/payment-summary", headers=headers)
        assert resp.status_code == 403

    def test_record_requires_manage_perm(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"rps-perm2-{uuid4().hex[:6]}")
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=VIEW_ONLY)
        resp = client.post(
            f"{BASE}/students/{sid}/payments",
            json={"amount": "100", "provider": "CASH"},
            headers=headers,
        )
        assert resp.status_code == 403


# ────────────────────────────────────────────────────────────────────────────
# Payment summary — breakdown read endpoint
# ────────────────────────────────────────────────────────────────────────────

class TestPaymentSummary:
    def test_empty_when_no_invoices(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"sum1-{uuid4().hex[:6]}")
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.get(f"{BASE}/students/{sid}/payment-summary", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["student_id"] == sid
        assert Decimal(body["total_outstanding"]) == 0
        assert Decimal(body["current_term_total"]) == 0
        assert Decimal(body["prior_terms_balance"]) == 0
        assert body["invoices"] == []

    def test_splits_prior_and_current_term(
        self, client: TestClient, db_session: Session
    ):
        """Older invoices are reported as prior_terms_balance; newest as
        current_term_*. The explicit query params lock the split."""
        tenant = create_tenant(db_session, slug=f"sum2-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("8000"))
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=2, academic_year=2026, total=Decimal("30000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.get(
            f"{BASE}/students/{sid}/payment-summary"
            f"?current_term_number=2&current_academic_year=2026",
            headers=headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert Decimal(body["prior_terms_balance"]) == Decimal("8000")
        assert Decimal(body["current_term_total"]) == Decimal("30000")
        assert Decimal(body["current_term_balance"]) == Decimal("30000")
        assert Decimal(body["total_outstanding"]) == Decimal("38000")
        # Invoices come back oldest-first.
        assert [i["term_number"] for i in body["invoices"]] == [1, 2]

    def test_includes_pending_balance_adjustment_net(
        self, client: TestClient, db_session: Session
    ):
        """pending_balance_net reflects open carry-forward (signed). Debits
        and credits net out into total_outstanding."""
        tenant = create_tenant(db_session, slug=f"sum3-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("10000"))
        # Manually insert an OPEN credit and an OPEN debit.
        db_session.add_all([
            StudentCarryForward(
                tenant_id=tenant.id, student_id=sid,
                term_label="Goodwill", amount=Decimal("-2000"),
                category="GOODWILL_CREDIT", status="OPEN",
            ),
            StudentCarryForward(
                tenant_id=tenant.id, student_id=sid,
                term_label="Old arrears", amount=Decimal("500"),
                category="MANUAL_DEBIT", status="OPEN",
            ),
        ])
        db_session.commit()

        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        resp = client.get(f"{BASE}/students/{sid}/payment-summary", headers=headers)
        body = resp.json()
        assert Decimal(body["pending_balance_debit"]) == Decimal("500")
        assert Decimal(body["pending_balance_credit"]) == Decimal("-2000")
        assert Decimal(body["pending_balance_net"]) == Decimal("-1500")
        # 10,000 owed on invoices + (-1,500) net adjustment = 8,500.
        assert Decimal(body["total_outstanding"]) == Decimal("8500")

    def test_paid_invoices_are_excluded(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"sum4-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                            term_number=1, academic_year=2026, total=Decimal("5000"))
        # Mark it PAID manually.
        db_session.execute(
            text(
                "UPDATE core.invoices SET status='PAID', paid_amount=5000, "
                "balance_amount=0 WHERE id = :id"
            ),
            {"id": iid},
        )
        db_session.commit()

        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        body = client.get(
            f"{BASE}/students/{sid}/payment-summary", headers=headers
        ).json()
        assert body["invoices"] == []
        assert Decimal(body["total_outstanding"]) == 0

    def test_404_when_student_in_another_tenant(
        self, client: TestClient, db_session: Session
    ):
        tenant_a = create_tenant(db_session, slug=f"sum5a-{uuid4().hex[:6]}")
        tenant_b = create_tenant(db_session, slug=f"sum5b-{uuid4().hex[:6]}")
        sid_a, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant_a.id)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=ALL_FINANCE)

        resp = client.get(f"{BASE}/students/{sid_a}/payment-summary", headers=headers_b)
        assert resp.status_code == 404


# ────────────────────────────────────────────────────────────────────────────
# Record payment — auto-allocation FIFO
# ────────────────────────────────────────────────────────────────────────────

class TestRecordPaymentByStudent:
    def test_amount_must_be_positive(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session, slug=f"rps1-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("1000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/students/{sid}/payments",
            json={"amount": "0", "provider": "CASH"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "greater than zero" in resp.json()["detail"].lower()

    def test_no_outstanding_invoice_books_as_credit(
        self, client: TestClient, db_session: Session
    ):
        """Phase N — a payment without any outstanding invoice or CF debit
        no longer fails. The whole amount is booked as OVERPAYMENT_CREDIT
        and auto-applies at the next invoice generation for the student.
        No silent failures — the response reflects the surplus explicitly.
        """
        tenant = create_tenant(db_session, slug=f"rps2-{uuid4().hex[:6]}")
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/students/{sid}/payments",
            json={"amount": "500", "provider": "MPESA"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert Decimal(body["amount"]) == Decimal("500")
        assert Decimal(body["allocated_total"]) == Decimal("0")
        assert Decimal(body["surplus_credit"]) == Decimal("500")
        assert body["credit_balance_id"]

    def test_exact_payment_clears_single_invoice(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"rps3-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                            term_number=1, academic_year=2026, total=Decimal("3000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/students/{sid}/payments",
            json={"amount": "3000", "provider": "CASH"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert Decimal(body["allocated_total"]) == Decimal("3000")
        assert Decimal(body["surplus_credit"]) == 0
        assert body["credit_balance_id"] is None
        assert len(body["allocations"]) == 1
        assert body["allocations"][0]["invoice_id"] == iid

        # Invoice is now PAID.
        inv_row = db_session.execute(
            text(
                "SELECT status, paid_amount, balance_amount FROM core.invoices "
                "WHERE id = :id"
            ),
            {"id": iid},
        ).mappings().first()
        assert inv_row["status"] == "PAID"
        assert Decimal(inv_row["paid_amount"]) == Decimal("3000")
        assert Decimal(inv_row["balance_amount"]) == 0

    def test_partial_payment_leaves_invoice_partial(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"rps4-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                            term_number=1, academic_year=2026, total=Decimal("10000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/students/{sid}/payments",
            json={"amount": "4000", "provider": "MPESA", "reference": "MX12345"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert Decimal(body["allocated_total"]) == Decimal("4000")
        assert Decimal(body["surplus_credit"]) == 0

        inv_row = db_session.execute(
            text("SELECT status, paid_amount, balance_amount FROM core.invoices WHERE id = :id"),
            {"id": iid},
        ).mappings().first()
        assert inv_row["status"] == "PARTIAL"
        assert Decimal(inv_row["paid_amount"]) == Decimal("4000")
        assert Decimal(inv_row["balance_amount"]) == Decimal("6000")

    def test_fifo_clears_oldest_term_first(
        self, client: TestClient, db_session: Session
    ):
        """Two open invoices (Term 1, Term 2). Payment covers the older one
        fully and partially the newer."""
        tenant = create_tenant(db_session, slug=f"rps5-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        iid_t2 = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                               term_number=2, academic_year=2026, total=Decimal("30000"))
        iid_t1 = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                               term_number=1, academic_year=2026, total=Decimal("8000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        # Pay 20,000 — should clear Term 1 (8,000) then put 12,000 onto Term 2.
        resp = client.post(
            f"{BASE}/students/{sid}/payments",
            json={"amount": "20000", "provider": "BANK"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert Decimal(body["allocated_total"]) == Decimal("20000")
        assert Decimal(body["surplus_credit"]) == 0
        # Two allocations, oldest first.
        assert [a["invoice_id"] for a in body["allocations"]] == [iid_t1, iid_t2]
        assert Decimal(body["allocations"][0]["amount"]) == Decimal("8000")
        assert Decimal(body["allocations"][1]["amount"]) == Decimal("12000")

        rows = db_session.execute(
            text(
                "SELECT id, status, paid_amount, balance_amount "
                "FROM core.invoices WHERE id = ANY(:ids)"
            ),
            {"ids": [iid_t1, iid_t2]},
        ).mappings().all()
        by_id = {str(r["id"]): r for r in rows}
        assert by_id[iid_t1]["status"] == "PAID"
        assert Decimal(by_id[iid_t1]["balance_amount"]) == 0
        assert by_id[iid_t2]["status"] == "PARTIAL"
        assert Decimal(by_id[iid_t2]["balance_amount"]) == Decimal("18000")

    def test_fifo_orders_by_academic_year_then_term(
        self, client: TestClient, db_session: Session
    ):
        """An older academic year always allocates before a newer year's
        Term 1 even if the newer Term 1 was created later."""
        tenant = create_tenant(db_session, slug=f"rps6-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        iid_2026 = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                                 term_number=1, academic_year=2026, total=Decimal("5000"))
        iid_2025 = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                                 term_number=3, academic_year=2025, total=Decimal("4000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/students/{sid}/payments",
            json={"amount": "9000", "provider": "CASH"},
            headers=headers,
        )
        assert resp.status_code == 200
        # 2025 Term 3 must clear before 2026 Term 1.
        assert [a["invoice_id"] for a in resp.json()["allocations"]] == [iid_2025, iid_2026]

    def test_surplus_creates_overpayment_credit(
        self, client: TestClient, db_session: Session
    ):
        """Paying more than total outstanding leaves a CREDIT carry-forward
        on the student via OVERPAYMENT_CREDIT, never an over-allocation."""
        tenant = create_tenant(db_session, slug=f"rps7-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("2500"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/students/{sid}/payments",
            json={"amount": "3000", "provider": "MPESA"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert Decimal(body["allocated_total"]) == Decimal("2500")
        assert Decimal(body["surplus_credit"]) == Decimal("500")
        assert body["credit_balance_id"], "expected a credit_balance_id when surplus > 0"

        # CF row exists, negative amount, OVERPAYMENT_CREDIT, status OPEN.
        cf_row = db_session.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant.id,
                StudentCarryForward.student_id == sid,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
        ).scalar_one()
        assert Decimal(str(cf_row.amount)) == Decimal("-500")
        assert cf_row.status == "OPEN"

    def test_record_payment_is_tenant_scoped(
        self, client: TestClient, db_session: Session
    ):
        """A POST against a student id from another tenant must return 4xx
        (404 from the summary-style lookup) — never silently allocate in the
        wrong tenant."""
        tenant_a = create_tenant(db_session, slug=f"rps8a-{uuid4().hex[:6]}")
        tenant_b = create_tenant(db_session, slug=f"rps8b-{uuid4().hex[:6]}")
        sid_a, eid_a = _seed_student_and_enrollment(
            db_session, tenant_id=tenant_a.id
        )
        _seed_invoice(db_session, tenant_id=tenant_a.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("1000"))
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=ALL_FINANCE)

        resp = client.post(
            f"{BASE}/students/{sid_a}/payments",
            json={"amount": "1000", "provider": "CASH"},
            headers=headers_b,
        )
        # The summary helpers raise "No outstanding fees invoices" because
        # tenant_b can't see tenant_a's invoices → 400 with that detail.
        assert resp.status_code == 400


# ────────────────────────────────────────────────────────────────────────────
# create_payment service: credit_to_student_id behaviour
#
# These tests drive the service directly because the per-student endpoint is
# scoped to a single student (so the multi-student guard cannot be exercised
# through it). The forthcoming family endpoint will route through the same
# create_payment, so locking this behaviour here protects both paths.
# ────────────────────────────────────────────────────────────────────────────

class TestCreatePaymentCreditTarget:
    def _seed_two_students_with_invoices(self, db: Session, *, tenant_id) -> tuple[str, str, str, str]:
        """Two students with one open invoice each. Returns
        (sid_a, sid_b, iid_a, iid_b)."""
        sid_a, eid_a = _seed_student_and_enrollment(db, tenant_id=tenant_id)
        sid_b, eid_b = _seed_student_and_enrollment(db, tenant_id=tenant_id)
        iid_a = _seed_invoice(db, tenant_id=tenant_id, enrollment_id=eid_a,
                              term_number=1, academic_year=2026, total=Decimal("5000"))
        iid_b = _seed_invoice(db, tenant_id=tenant_id, enrollment_id=eid_b,
                              term_number=1, academic_year=2026, total=Decimal("3000"))
        return sid_a, sid_b, iid_a, iid_b

    def test_single_student_surplus_credits_that_student_by_default(
        self, db_session: Session
    ):
        """Backwards-compat: a single-student record with surplus and no
        credit_to_student_id still lands the credit on that student."""
        from app.api.v1.finance.service import create_payment
        from uuid import UUID as _UUID
        tenant = create_tenant(db_session, slug=f"cp1-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                            term_number=1, academic_year=2026, total=Decimal("2000"))

        pay = create_payment(
            db_session,
            tenant_id=tenant.id,
            actor_user_id=None,
            provider="CASH",
            reference=None,
            amount=Decimal("2500"),
            allocations=[{"invoice_id": _UUID(iid), "amount": Decimal("2000")}],
        )
        db_session.commit()
        assert pay.id is not None

        cf = db_session.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant.id,
                StudentCarryForward.student_id == sid,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
        ).scalar_one()
        assert Decimal(str(cf.amount)) == Decimal("-500")

    def test_multi_student_surplus_without_credit_target_rejected(
        self, db_session: Session
    ):
        """Allocations span two students AND there is surplus AND no
        credit_to_student_id → raise. No Payment row may be created."""
        from app.api.v1.finance.service import create_payment
        from uuid import UUID as _UUID
        tenant = create_tenant(db_session, slug=f"cp2-{uuid4().hex[:6]}")
        sid_a, sid_b, iid_a, iid_b = self._seed_two_students_with_invoices(
            db_session, tenant_id=tenant.id
        )
        payments_before = db_session.execute(
            text("SELECT COUNT(*) FROM core.payments WHERE tenant_id = :tid"),
            {"tid": str(tenant.id)},
        ).scalar_one()

        with pytest.raises(ValueError, match="credit_to_student_id required"):
            create_payment(
                db_session,
                tenant_id=tenant.id,
                actor_user_id=None,
                provider="MPESA",
                reference="MX1",
                amount=Decimal("10000"),  # surplus of 2000
                allocations=[
                    {"invoice_id": _UUID(iid_a), "amount": Decimal("5000")},
                    {"invoice_id": _UUID(iid_b), "amount": Decimal("3000")},
                ],
            )
        db_session.rollback()

        payments_after = db_session.execute(
            text("SELECT COUNT(*) FROM core.payments WHERE tenant_id = :tid"),
            {"tid": str(tenant.id)},
        ).scalar_one()
        assert payments_after == payments_before

    def test_multi_student_no_surplus_does_not_require_credit_target(
        self, db_session: Session
    ):
        """When the allocations sum exactly to the payment amount, no surplus
        means no credit decision is needed — multi-student is fine."""
        from app.api.v1.finance.service import create_payment
        from uuid import UUID as _UUID
        tenant = create_tenant(db_session, slug=f"cp3-{uuid4().hex[:6]}")
        sid_a, sid_b, iid_a, iid_b = self._seed_two_students_with_invoices(
            db_session, tenant_id=tenant.id
        )

        pay = create_payment(
            db_session,
            tenant_id=tenant.id,
            actor_user_id=None,
            provider="CASH",
            reference=None,
            amount=Decimal("8000"),
            allocations=[
                {"invoice_id": _UUID(iid_a), "amount": Decimal("5000")},
                {"invoice_id": _UUID(iid_b), "amount": Decimal("3000")},
            ],
        )
        db_session.commit()
        assert pay.id is not None

        cf_count = db_session.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant.id,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
        ).all()
        assert len(cf_count) == 0

    def test_multi_student_surplus_honors_chosen_credit_target(
        self, db_session: Session
    ):
        """credit_to_student_id = sid_b → exactly one credit lands on B, none
        on A."""
        from app.api.v1.finance.service import create_payment
        from uuid import UUID as _UUID
        tenant = create_tenant(db_session, slug=f"cp4-{uuid4().hex[:6]}")
        sid_a, sid_b, iid_a, iid_b = self._seed_two_students_with_invoices(
            db_session, tenant_id=tenant.id
        )

        pay = create_payment(
            db_session,
            tenant_id=tenant.id,
            actor_user_id=None,
            provider="BANK",
            reference="BK1",
            amount=Decimal("10000"),
            allocations=[
                {"invoice_id": _UUID(iid_a), "amount": Decimal("5000")},
                {"invoice_id": _UUID(iid_b), "amount": Decimal("3000")},
            ],
            credit_to_student_id=_UUID(sid_b),
        )
        db_session.commit()

        creds = db_session.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant.id,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
        ).scalars().all()
        assert len(creds) == 1
        assert str(creds[0].student_id) == sid_b
        assert Decimal(str(creds[0].amount)) == Decimal("-2000")

        # Audit payload must capture the credit_to_student_id and student_count.
        from app.models.audit_log import AuditLog
        audit = db_session.execute(
            select(AuditLog)
            .where(
                AuditLog.tenant_id == tenant.id,
                AuditLog.action == "payment.create",
                AuditLog.resource_id == pay.id,
            )
        ).scalar_one()
        assert audit.payload.get("credit_to_student_id") == sid_b
        assert audit.payload.get("student_count") == 2

    def test_credit_target_outside_payment_rejected(
        self, db_session: Session
    ):
        """credit_to_student_id must be a student whose invoices are in the
        allocation. A stranger student gets a 'not part of this payment'
        error — guards against typos crediting the wrong family entirely."""
        from app.api.v1.finance.service import create_payment
        from uuid import UUID as _UUID
        tenant = create_tenant(db_session, slug=f"cp5-{uuid4().hex[:6]}")
        sid_a, sid_b, iid_a, iid_b = self._seed_two_students_with_invoices(
            db_session, tenant_id=tenant.id
        )
        # An unrelated student in the same tenant.
        sid_outsider, _eid_o = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)

        with pytest.raises(ValueError, match="not part of this payment"):
            create_payment(
                db_session,
                tenant_id=tenant.id,
                actor_user_id=None,
                provider="MPESA",
                reference="MX2",
                amount=Decimal("10000"),
                allocations=[
                    {"invoice_id": _UUID(iid_a), "amount": Decimal("5000")},
                    {"invoice_id": _UUID(iid_b), "amount": Decimal("3000")},
                ],
                credit_to_student_id=_UUID(sid_outsider),
            )
        db_session.rollback()

    def test_no_surplus_ignores_credit_target(self, db_session: Session):
        """If allocations exactly equal amount, credit_to_student_id is a
        no-op — we don't create a phantom zero-credit CF row."""
        from app.api.v1.finance.service import create_payment
        from uuid import UUID as _UUID
        tenant = create_tenant(db_session, slug=f"cp6-{uuid4().hex[:6]}")
        sid_a, sid_b, iid_a, iid_b = self._seed_two_students_with_invoices(
            db_session, tenant_id=tenant.id
        )
        create_payment(
            db_session,
            tenant_id=tenant.id,
            actor_user_id=None,
            provider="CASH",
            reference=None,
            amount=Decimal("8000"),
            allocations=[
                {"invoice_id": _UUID(iid_a), "amount": Decimal("5000")},
                {"invoice_id": _UUID(iid_b), "amount": Decimal("3000")},
            ],
            credit_to_student_id=_UUID(sid_a),
        )
        db_session.commit()
        creds = db_session.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant.id,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
        ).all()
        assert len(creds) == 0

    def test_audit_records_credit_target_null_when_no_surplus(
        self, db_session: Session
    ):
        """credit_to_student_id audit field is null when there was no
        surplus (regardless of whether the caller supplied a target)."""
        from app.api.v1.finance.service import create_payment
        from app.models.audit_log import AuditLog
        from uuid import UUID as _UUID
        tenant = create_tenant(db_session, slug=f"cp7-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                            term_number=1, academic_year=2026, total=Decimal("3000"))

        pay = create_payment(
            db_session,
            tenant_id=tenant.id,
            actor_user_id=None,
            provider="CASH",
            reference=None,
            amount=Decimal("3000"),
            allocations=[{"invoice_id": _UUID(iid), "amount": Decimal("3000")}],
        )
        db_session.commit()

        audit = db_session.execute(
            select(AuditLog)
            .where(
                AuditLog.tenant_id == tenant.id,
                AuditLog.action == "payment.create",
                AuditLog.resource_id == pay.id,
            )
        ).scalar_one()
        assert audit.payload.get("credit_to_student_id") is None
        assert audit.payload.get("student_count") == 1
