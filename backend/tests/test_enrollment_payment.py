"""Phase O — By-enrollment (applicant / interview-fee) payment tests.

Prospective applicants pay an INTERVIEW fee BEFORE the SIS student record
exists. The by-student payment surface can't handle them (student_id is
null), so we address them by enrollment_id here.

Endpoints under test:
    GET  /finance/enrollments/{enrollment_id}/payment-summary
    POST /finance/enrollments/{enrollment_id}/payments
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text, select
from sqlalchemy.orm import Session

from app.models.invoice import Invoice
from tests.helpers import create_tenant, make_actor


BASE = "/api/v1/finance"
PAY_PERMS = ["finance.payments.manage", "finance.payments.view"]


def _seed_prospective_enrollment(
    db: Session, *, tenant_id, status: str = "DRAFT",
) -> str:
    """Seed a prospective enrollment (no student_id yet — the SIS student
    row is only created at approval)."""
    eid = uuid4()
    db.execute(
        text(
            "INSERT INTO core.enrollments "
            "(id, tenant_id, status, payload) "
            "VALUES (:id, :tid, :status, CAST(:payload AS jsonb))"
        ),
        {
            "id": str(eid), "tid": str(tenant_id), "status": status,
            "payload": '{"student_name": "Applicant Test", "class_code": "GRADE_1"}',
        },
    )
    db.commit()
    return str(eid)


def _seed_school_fees_invoice(
    db: Session, *, tenant_id, enrollment_id: str,
    total: Decimal = Decimal("15000"),
    term_number: int = 1,
    academic_year: int = 2026,
    status: str = "ISSUED",
) -> str:
    """Seed a SCHOOL_FEES invoice against a not-yet-ENROLLED enrollment,
    reflecting the Phase F flow where the fees invoice is generated at
    approval so the operator can record a partial payment before ENROLL."""
    iid = uuid4()
    db.execute(
        text(
            "INSERT INTO core.invoices "
            "(id, tenant_id, invoice_no, invoice_type, status, enrollment_id, "
            " term_number, academic_year, currency, total_amount, paid_amount, balance_amount) "
            "VALUES (:id, :tid, :no, 'SCHOOL_FEES', :status, :eid, :tn, :yr, "
            "        'KES', :total, 0, :total)"
        ),
        {
            "id": str(iid), "tid": str(tenant_id),
            "no": f"INV-{uuid4().hex[:6].upper()}",
            "status": status, "eid": enrollment_id,
            "tn": term_number, "yr": academic_year,
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


def _seed_interview_invoice(
    db: Session, *, tenant_id, enrollment_id: str,
    total: Decimal = Decimal("2000"),
    status: str = "ISSUED",
) -> str:
    iid = uuid4()
    db.execute(
        text(
            "INSERT INTO core.invoices "
            "(id, tenant_id, invoice_no, invoice_type, status, enrollment_id, "
            " currency, total_amount, paid_amount, balance_amount) "
            "VALUES (:id, :tid, :no, 'INTERVIEW', :status, :eid, "
            "        'KES', :total, 0, :total)"
        ),
        {
            "id": str(iid), "tid": str(tenant_id),
            "no": f"INV-{uuid4().hex[:6].upper()}",
            "status": status, "eid": enrollment_id,
            "total": str(total),
        },
    )
    db.execute(
        text(
            "INSERT INTO core.invoice_lines (invoice_id, description, amount) "
            "VALUES (:iid, 'Interview fee', :amt)"
        ),
        {"iid": str(iid), "amt": str(total)},
    )
    db.commit()
    return str(iid)


class TestEnrollmentPaymentSummary:
    def test_summary_returns_applicant_identity_and_invoices(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)
        _seed_interview_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid)

        r = client.get(
            f"{BASE}/enrollments/{eid}/payment-summary",
            headers=headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["enrollment_id"] == eid
        assert body["enrollment_status"] == "DRAFT"
        assert body["student_name"] == "Applicant Test"
        assert body["class_code"] == "GRADE_1"
        assert body["eligible"] is True
        assert len(body["interview_invoices"]) == 1
        assert Decimal(body["total_outstanding"]) == Decimal("2000.00")

    def test_summary_eligible_false_when_no_open_interview(
        self, client: TestClient, db_session: Session,
    ):
        """No unpaid interview invoice → the picker should be able to
        gate this applicant out."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)

        r = client.get(
            f"{BASE}/enrollments/{eid}/payment-summary",
            headers=headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["eligible"] is False

    def test_summary_404_for_unknown_enrollment(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        r = client.get(
            f"{BASE}/enrollments/{uuid4()}/payment-summary",
            headers=headers,
        )
        assert r.status_code == 404

    def test_summary_requires_permission(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)
        r = client.get(
            f"{BASE}/enrollments/{eid}/payment-summary",
            headers=headers,
        )
        assert r.status_code == 403


class TestEnrollmentPaymentRecord:
    def test_exact_payment_settles_interview_invoice(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_interview_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            total=Decimal("2000"),
        )

        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "2000", "provider": "MPESA", "reference": "MP-INT"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["receipt_no"]
        assert Decimal(body["amount"]) == Decimal("2000")
        assert Decimal(body["allocated_total"]) == Decimal("2000")
        assert Decimal(body["surplus_absorbed"]) == Decimal("0")

        inv = db_session.get(Invoice, iid)
        db_session.refresh(inv)
        assert Decimal(str(inv.paid_amount)) == Decimal("2000.00")
        assert Decimal(str(inv.balance_amount)) == Decimal("0.00")
        assert inv.status == "PAID"

    def test_partial_payment_leaves_invoice_open(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_interview_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            total=Decimal("2000"),
        )
        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "1500", "provider": "CASH"},
        )
        assert r.status_code == 200, r.text
        inv = db_session.get(Invoice, iid)
        db_session.refresh(inv)
        assert Decimal(str(inv.paid_amount)) == Decimal("1500.00")
        assert Decimal(str(inv.balance_amount)) == Decimal("500.00")
        assert inv.status != "PAID"

    def test_overpayment_absorbed_as_line_on_oldest_invoice(
        self, client: TestClient, db_session: Session,
    ):
        """Per Decision 3 — overpayment is booked as an "Applicant
        overpayment" line on the interview invoice so the FULL cash
        amount carries forward as INTERVIEW_CREDIT at enrollment."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_interview_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            total=Decimal("2000"),
        )
        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "3500", "provider": "MPESA", "reference": "MP-OVER"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert Decimal(body["amount"]) == Decimal("3500")
        assert Decimal(body["surplus_absorbed"]) == Decimal("1500")

        # Invoice total_amount grew, paid_amount matches, status = PAID.
        inv = db_session.get(Invoice, iid)
        db_session.refresh(inv)
        assert Decimal(str(inv.total_amount)) == Decimal("3500.00")
        assert Decimal(str(inv.paid_amount)) == Decimal("3500.00")
        assert Decimal(str(inv.balance_amount)) == Decimal("0.00")
        assert inv.status == "PAID"

        # The overpayment line is present on the invoice.
        line_types = db_session.execute(text(
            "SELECT meta->>'line_type' FROM core.invoice_lines "
            "WHERE invoice_id = :iid"
        ), {"iid": iid}).scalars().all()
        assert "APPLICANT_OVERPAYMENT" in line_types

    def test_rejects_when_no_open_interview_invoice(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)
        # No interview invoice seeded — payment should be refused.
        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "2000", "provider": "CASH"},
        )
        assert r.status_code == 400
        assert "no unpaid invoices" in r.json()["detail"].lower()

    def test_rejects_zero_amount(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)
        _seed_interview_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid)
        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "0", "provider": "CASH"},
        )
        assert r.status_code == 400

    def test_rejects_invalid_provider(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)
        _seed_interview_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid)
        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "2000", "provider": "CRYPTO"},
        )
        assert r.status_code == 400

    def test_record_requires_permission(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=["finance.payments.view"])
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)
        _seed_interview_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid)
        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "2000", "provider": "CASH"},
        )
        assert r.status_code == 403

    def test_writes_audit_event(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(db_session, tenant_id=tenant.id)
        _seed_interview_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid)
        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "2000", "provider": "CASH"},
        )
        assert r.status_code == 200
        cnt = db_session.execute(text(
            "SELECT COUNT(*) FROM core.audit_logs "
            "WHERE tenant_id = :tid AND action = 'payment.interview.recorded'"
        ), {"tid": str(tenant.id)}).scalar()
        assert cnt == 1


class TestEnrollmentPaymentSchoolFees:
    """Phase P — the by-enrollment payment endpoint also handles
    SCHOOL_FEES invoices for pre-ENROLLED applicants, so operators
    can satisfy the partial-enrollment gate before the SIS student
    row exists."""

    def test_summary_includes_school_fees_invoices(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(
            db_session, tenant_id=tenant.id, status="APPROVED",
        )
        _seed_school_fees_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            total=Decimal("15000"),
        )
        r = client.get(
            f"{BASE}/enrollments/{eid}/payment-summary",
            headers=headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["eligible"] is True
        assert len(body["interview_invoices"]) == 0
        assert len(body["school_fees_invoices"]) == 1
        assert Decimal(body["total_outstanding"]) == Decimal("15000.00")
        assert body["partial_policy"] is not None

    def test_record_pays_school_fees_invoice(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(
            db_session, tenant_id=tenant.id, status="APPROVED",
        )
        iid = _seed_school_fees_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            total=Decimal("15000"),
        )
        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "5000", "provider": "MPESA", "reference": "MP-P"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert Decimal(body["amount"]) == Decimal("5000")
        assert Decimal(body["allocated_total"]) == Decimal("5000")
        assert Decimal(body["surplus_absorbed"]) == Decimal("0")

        inv = db_session.get(Invoice, iid)
        db_session.refresh(inv)
        assert Decimal(str(inv.paid_amount)) == Decimal("5000.00")
        assert Decimal(str(inv.balance_amount)) == Decimal("10000.00")

    def test_record_pays_interview_then_school_fees_oldest_first(
        self, client: TestClient, db_session: Session,
    ):
        """If both an INTERVIEW and a SCHOOL_FEES invoice exist, the
        payment allocates oldest-first — the interview invoice
        (typically older) gets settled before the school-fees invoice."""
        import time
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(
            db_session, tenant_id=tenant.id, status="APPROVED",
        )
        interview_id = _seed_interview_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            total=Decimal("2000"),
        )
        time.sleep(0.01)
        fees_id = _seed_school_fees_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            total=Decimal("15000"),
        )
        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "5000", "provider": "MPESA"},
        )
        assert r.status_code == 200, r.text
        interview = db_session.get(Invoice, interview_id)
        db_session.refresh(interview)
        assert interview.status == "PAID"
        assert Decimal(str(interview.paid_amount)) == Decimal("2000.00")

        fees = db_session.get(Invoice, fees_id)
        db_session.refresh(fees)
        assert Decimal(str(fees.paid_amount)) == Decimal("3000.00")
        assert Decimal(str(fees.balance_amount)) == Decimal("12000.00")

    def test_record_audit_action_when_only_school_fees_touched(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        eid = _seed_prospective_enrollment(
            db_session, tenant_id=tenant.id, status="APPROVED",
        )
        _seed_school_fees_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            total=Decimal("15000"),
        )
        r = client.post(
            f"{BASE}/enrollments/{eid}/payments",
            headers=headers,
            json={"amount": "5000", "provider": "MPESA"},
        )
        assert r.status_code == 200
        actions = db_session.execute(text(
            "SELECT action FROM core.audit_logs "
            "WHERE tenant_id = :tid AND action LIKE 'payment.%.recorded'"
        ), {"tid": str(tenant.id)}).scalars().all()
        assert "payment.applicant_fees.recorded" in actions
