"""Phase N — Payment Waterfall tests.

Coverage of the strict waterfall:
    1. OPEN carry-forward DEBITS first (oldest first)
    2. Open SCHOOL_FEES invoices oldest-first
    3. Surplus → OVERPAYMENT_CREDIT

Uses the two endpoints:
    POST /finance/students/{sid}/payments/preview   (read-only planner)
    POST /finance/students/{sid}/payments            (books the plan)

The invariant we assert everywhere: preview and record MUST produce the
same step list for the same input state. WYSIWYG for the operator.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.invoice import Invoice
from app.models.student_carry_forward import StudentCarryForward
from tests.helpers import create_tenant, make_actor


BASE = "/api/v1/finance"

PAY_PERMS = ["finance.payments.manage", "finance.payments.view"]


def _seed_student_and_enrollment(
    db: Session,
    *,
    tenant_id,
    admission_no: str | None = None,
    class_code: str = "GRADE_1",
) -> tuple[str, str]:
    sid = uuid4()
    eid = uuid4()
    db.execute(
        text(
            "INSERT INTO core.students "
            "(id, tenant_id, admission_no, first_name, last_name, status, admission_year) "
            "VALUES (:id, :tid, :adm, 'Test', 'Waterfall', 'ACTIVE', 2026)"
        ),
        {
            "id": str(sid), "tid": str(tenant_id),
            "adm": admission_no or f"W-{uuid4().hex[:6].upper()}",
        },
    )
    db.execute(
        text(
            "INSERT INTO core.enrollments "
            "(id, tenant_id, student_id, status, payload) "
            "VALUES (:id, :tid, :sid, 'ENROLLED', CAST(:payload AS jsonb))"
        ),
        {
            "id": str(eid), "tid": str(tenant_id), "sid": str(sid),
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


def _seed_cf_debit(
    db: Session,
    *,
    tenant_id,
    student_id: str,
    amount: Decimal,
    term_label: str = "Prior term arrears",
) -> str:
    cid = uuid4()
    db.execute(
        text(
            "INSERT INTO core.student_carry_forward_balances "
            "(id, tenant_id, student_id, term_label, amount, category, status, description) "
            "VALUES (:id, :tid, :sid, :label, :amt, 'MANUAL_DEBIT', 'OPEN', :desc)"
        ),
        {
            "id": str(cid), "tid": str(tenant_id), "sid": student_id,
            "label": term_label, "amt": str(amount),
            "desc": f"seed cf {amount}",
        },
    )
    db.commit()
    return str(cid)


def _seed_cf_credit(
    db: Session,
    *,
    tenant_id,
    student_id: str,
    amount: Decimal,
    category: str = "OVERPAYMENT_CREDIT",
    term_label: str = "Prior overpayment",
) -> str:
    """Seed an OPEN credit CF row (negative amount)."""
    cid = uuid4()
    db.execute(
        text(
            "INSERT INTO core.student_carry_forward_balances "
            "(id, tenant_id, student_id, term_label, amount, category, status, description) "
            "VALUES (:id, :tid, :sid, :label, :amt, :cat, 'OPEN', :desc)"
        ),
        {
            "id": str(cid), "tid": str(tenant_id), "sid": student_id,
            "label": term_label, "amt": str(-abs(amount)), "cat": category,
            "desc": f"seed credit {amount}",
        },
    )
    db.commit()
    return str(cid)


class TestWaterfallPreview:
    def test_preview_cf_only(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("5000"))

        r = client.post(
            f"{BASE}/students/{sid}/payments/preview",
            headers=headers, json={"amount": "3000"},
        )
        assert r.status_code == 200, r.text
        plan = r.json()
        assert Decimal(plan["summary"]["cf_debits_settled"]) == Decimal("3000")
        assert Decimal(plan["summary"]["invoices_paid"]) == Decimal("0")
        assert Decimal(plan["summary"]["surplus_credit"]) == Decimal("0")
        assert len(plan["steps"]) == 1
        assert plan["steps"][0]["type"] == "carry_forward_debit"
        assert plan["steps"][0]["fully_settles"] is False

    def test_preview_cf_then_invoice_then_surplus(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("5000"))
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("15000"),
        )

        r = client.post(
            f"{BASE}/students/{sid}/payments/preview",
            headers=headers, json={"amount": "22000"},
        )
        assert r.status_code == 200, r.text
        plan = r.json()
        assert Decimal(plan["summary"]["cf_debits_settled"]) == Decimal("5000")
        assert Decimal(plan["summary"]["invoices_paid"]) == Decimal("15000")
        assert Decimal(plan["summary"]["surplus_credit"]) == Decimal("2000")
        # Steps in order: cf → invoice → surplus.
        types = [s["type"] for s in plan["steps"]]
        assert types == ["carry_forward_debit", "invoice", "overpayment_credit"]

    def test_preview_no_invoice_becomes_credit(
        self, client: TestClient, db_session: Session
    ):
        """No CF, no invoice — the whole amount waits as an OVERPAYMENT_CREDIT
        and will auto-apply at the next invoice generation. Never fails."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)

        r = client.post(
            f"{BASE}/students/{sid}/payments/preview",
            headers=headers, json={"amount": "8000"},
        )
        assert r.status_code == 200, r.text
        plan = r.json()
        assert Decimal(plan["summary"]["surplus_credit"]) == Decimal("8000")
        assert len(plan["steps"]) == 1
        assert plan["steps"][0]["type"] == "overpayment_credit"

    def test_preview_multi_cf_oldest_first(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        older = _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("3000"))
        # Force a later created_at so ordering is deterministic in a fast test.
        import time; time.sleep(0.01)
        newer = _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("4000"))

        r = client.post(
            f"{BASE}/students/{sid}/payments/preview",
            headers=headers, json={"amount": "5000"},
        )
        plan = r.json()
        cf_steps = [s for s in plan["steps"] if s["type"] == "carry_forward_debit"]
        assert [s["cf_id"] for s in cf_steps] == [older, newer]
        assert Decimal(cf_steps[0]["amount"]) == Decimal("3000")
        assert Decimal(cf_steps[1]["amount"]) == Decimal("2000")
        assert cf_steps[0]["fully_settles"] is True
        assert cf_steps[1]["fully_settles"] is False

    def test_preview_zero_amount_400(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        r = client.post(
            f"{BASE}/students/{sid}/payments/preview",
            headers=headers, json={"amount": "0"},
        )
        assert r.status_code == 400


class TestWaterfallRecord:
    def test_record_settles_cf_then_invoice(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        cf_id = _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("5000"))
        inv_id = _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("10000"),
        )

        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "12000", "provider": "MPESA", "reference": "MP12345"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert Decimal(body["cf_debits_settled"]) == Decimal("5000")
        assert Decimal(body["allocated_total"]) == Decimal("7000")
        assert Decimal(body["surplus_credit"]) == Decimal("0")

        # CF row is fully SETTLED with settled_amount == amount.
        cf = db_session.get(StudentCarryForward, cf_id)
        db_session.refresh(cf)
        assert cf.status == "SETTLED"
        assert Decimal(str(cf.settled_amount)) == Decimal("5000.00")

        # Invoice paid 7000, balance 3000.
        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        assert Decimal(str(inv.paid_amount)) == Decimal("7000.00")
        assert Decimal(str(inv.balance_amount)) == Decimal("3000.00")

    def test_partial_cf_settlement_keeps_row_open(
        self, client: TestClient, db_session: Session
    ):
        """Payment covers only part of the CF debit — settled_amount advances,
        status stays OPEN, and the row remains available for the next payment."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        cf_id = _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("5000"))

        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "2000", "provider": "CASH"},
        )
        assert r.status_code == 200, r.text
        cf = db_session.get(StudentCarryForward, cf_id)
        db_session.refresh(cf)
        assert cf.status == "OPEN"
        assert Decimal(str(cf.settled_amount)) == Decimal("2000.00")

    def test_surplus_creates_overpayment_credit(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("5000"),
        )

        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "8000", "provider": "MPESA", "reference": "MP-A"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert Decimal(body["surplus_credit"]) == Decimal("3000")
        credit_rows = db_session.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant.id,
                StudentCarryForward.student_id == sid,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
        ).scalars().all()
        assert len(credit_rows) == 1
        assert Decimal(str(credit_rows[0].amount)) == Decimal("-3000.00")

    def test_cf_only_payment_records_receipt_without_invoice(
        self, client: TestClient, db_session: Session
    ):
        """No open invoice, only a CF debit — the payment records, CF gets
        settled, no OVERPAYMENT_CREDIT is created, receipt is issued."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        cf_id = _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("4000"))

        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "4000", "provider": "CASH"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["receipt_no"]
        assert Decimal(body["amount"]) == Decimal("4000")
        assert Decimal(body["cf_debits_settled"]) == Decimal("4000")
        assert Decimal(body["allocated_total"]) == Decimal("0")
        assert Decimal(body["surplus_credit"]) == Decimal("0")
        assert body["credit_balance_id"] is None
        cf = db_session.get(StudentCarryForward, cf_id)
        db_session.refresh(cf)
        assert cf.status == "SETTLED"

    def test_no_invoice_no_cf_records_as_credit(
        self, client: TestClient, db_session: Session
    ):
        """Payment with nothing owing → surplus credit, no failure."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)

        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "5000", "provider": "MPESA", "reference": "AZ-1"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert Decimal(body["surplus_credit"]) == Decimal("5000")
        credit_rows = db_session.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant.id,
                StudentCarryForward.student_id == sid,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
        ).scalars().all()
        assert len(credit_rows) == 1
        assert Decimal(str(credit_rows[0].amount)) == Decimal("-5000.00")

    def test_writes_waterfall_audit_event(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("2000"))
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("6000"),
        )
        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "8000", "provider": "CASH"},
        )
        assert r.status_code == 200
        cnt = db_session.execute(text(
            "SELECT COUNT(*) FROM core.audit_logs "
            "WHERE tenant_id = :tid AND action = 'payment.waterfall.applied'"
        ), {"tid": str(tenant.id)}).scalar()
        assert cnt == 1

    def test_preview_matches_record(
        self, client: TestClient, db_session: Session
    ):
        """The WYSIWYG guarantee: preview and record must produce the same
        step list for the same input state. Enterprise foundation."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("3000"))
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("10000"),
        )

        preview = client.post(
            f"{BASE}/students/{sid}/payments/preview",
            headers=headers, json={"amount": "12000"},
        ).json()
        record = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "12000", "provider": "CASH"},
        ).json()

        # Pydantic serializes the preview into a fully-typed schema that adds
        # None for absent optional fields; the record path returns the raw
        # engine dict. Compare only the (type, amount, key-identifier) tuple
        # that the operator actually reads on the receipt.
        def _sig(step: dict):
            return (
                step.get("type"),
                str(Decimal(str(step.get("amount") or "0"))),
                step.get("cf_id"),
                step.get("invoice_id"),
            )
        assert [_sig(s) for s in preview["steps"]] == [
            _sig(s) for s in record["waterfall_steps"]
        ]


class TestWaterfallApplyAvailableCredit:
    """Phase N2 — the operator can opt to spend the student's OPEN credit
    balance as additional funding for this payment. Ticking the flag
    consumes credit rows (marks them SETTLED) and expands the effective
    pool going into the CF/invoice waterfall."""

    def test_preview_flag_default_off_shows_credit_available(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, _ = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_credit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("2500"))

        r = client.post(
            f"{BASE}/students/{sid}/payments/preview",
            headers=headers, json={"amount": "1000"},
        )
        assert r.status_code == 200, r.text
        plan = r.json()
        # credit_available is surfaced regardless of the flag.
        assert Decimal(plan["credit_available"]) == Decimal("2500")
        # But without the flag, no credit_consumed step is planned.
        assert Decimal(plan["summary"].get("credit_consumed") or "0") == Decimal("0")
        types = [s["type"] for s in plan["steps"]]
        assert "credit_consumed" not in types

    def test_preview_flag_on_consumes_credit_before_waterfall(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_credit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("3000"))
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("10000"),
        )

        r = client.post(
            f"{BASE}/students/{sid}/payments/preview",
            headers=headers,
            json={"amount": "5000", "apply_available_credit": True},
        )
        assert r.status_code == 200, r.text
        plan = r.json()
        # Effective pool = 5000 cash + 3000 credit → 8000 to the invoice.
        assert Decimal(plan["summary"]["credit_consumed"]) == Decimal("3000")
        assert Decimal(plan["summary"]["invoices_paid"]) == Decimal("8000")
        assert Decimal(plan["summary"]["surplus_credit"]) == Decimal("0")
        types = [s["type"] for s in plan["steps"]]
        assert types == ["credit_consumed", "invoice"]

    def test_record_consumes_credit_marks_settled(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        cr_id = _seed_cf_credit(
            db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("3000"),
        )
        inv_id = _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("10000"),
        )

        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={
                "amount": "5000",
                "provider": "MPESA",
                "reference": "MP-CR",
                "apply_available_credit": True,
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert Decimal(body["credit_consumed"]) == Decimal("3000")
        assert Decimal(body["allocated_total"]) == Decimal("8000")
        # Payment row's amount stays the TRUE cash received (5000) — credit
        # is captured separately in credit_consumed for accountancy.
        assert Decimal(body["amount"]) == Decimal("5000")

        cr = db_session.get(StudentCarryForward, cr_id)
        db_session.refresh(cr)
        assert cr.status == "SETTLED"
        assert Decimal(str(cr.settled_amount)) == Decimal("3000.00")

        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        assert Decimal(str(inv.paid_amount)) == Decimal("8000.00")

    def test_record_flag_off_leaves_credit_untouched(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        cr_id = _seed_cf_credit(
            db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("3000"),
        )
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("10000"),
        )
        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "5000", "provider": "MPESA"},
        )
        assert r.status_code == 200, r.text
        cr = db_session.get(StudentCarryForward, cr_id)
        db_session.refresh(cr)
        assert cr.status == "OPEN"
        assert Decimal(str(cr.settled_amount)) == Decimal("0.00")

    def test_credit_consumed_audit_event_emitted(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PAY_PERMS)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_credit(db_session, tenant_id=tenant.id, student_id=sid, amount=Decimal("2000"))
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("5000"),
        )
        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "3000", "provider": "CASH", "apply_available_credit": True},
        )
        assert r.status_code == 200
        cnt = db_session.execute(text(
            "SELECT COUNT(*) FROM core.audit_logs "
            "WHERE tenant_id = :tid "
            "AND action = 'finance.balance.credit_consumed_by_payment'"
        ), {"tid": str(tenant.id)}).scalar()
        assert cnt == 1


class TestInvoiceDocumentPriorBalance:
    """Phase N4 — the invoice document (and its PDF) should surface the
    student's prior balance (open CF debits and available credit) so parents
    see their full financial position at a glance."""

    def test_document_carries_prior_balance_debit(
        self, client: TestClient, db_session: Session
    ):
        from app.api.v1.finance import service
        tenant = create_tenant(db_session)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_debit(
            db_session, tenant_id=tenant.id, student_id=sid,
            amount=Decimal("2500"),
        )
        inv_id = _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("10000"),
        )
        doc = service.build_invoice_document(
            db_session, tenant_id=tenant.id, invoice_id=inv_id,
        )
        assert doc["prior_balance"] is not None
        assert Decimal(doc["prior_balance"]["debit"]) == Decimal("2500.00")
        assert Decimal(doc["prior_balance"]["credit"]) == Decimal("0.00")
        assert Decimal(doc["prior_balance"]["net"]) == Decimal("2500.00")

    def test_document_carries_prior_balance_credit(
        self, client: TestClient, db_session: Session
    ):
        from app.api.v1.finance import service
        tenant = create_tenant(db_session)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_credit(
            db_session, tenant_id=tenant.id, student_id=sid,
            amount=Decimal("1500"),
        )
        inv_id = _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("10000"),
        )
        doc = service.build_invoice_document(
            db_session, tenant_id=tenant.id, invoice_id=inv_id,
        )
        assert doc["prior_balance"] is not None
        assert Decimal(doc["prior_balance"]["debit"]) == Decimal("0.00")
        assert Decimal(doc["prior_balance"]["credit"]) == Decimal("1500.00")
        assert Decimal(doc["prior_balance"]["net"]) == Decimal("-1500.00")

    def test_document_absent_when_no_prior(
        self, client: TestClient, db_session: Session
    ):
        from app.api.v1.finance import service
        tenant = create_tenant(db_session)
        _, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        inv_id = _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("10000"),
        )
        doc = service.build_invoice_document(
            db_session, tenant_id=tenant.id, invoice_id=inv_id,
        )
        assert doc.get("prior_balance") is None

    def test_pdf_contains_prior_balance_when_present(
        self, client: TestClient, db_session: Session
    ):
        """Round-trip through the PDF generator — the file should carry
        the 'PRIOR BALANCE' block when the student owes something outside
        this invoice."""
        from app.api.v1.finance import service
        from app.utils.invoice_pdf import generate_invoice_pdf
        tenant = create_tenant(db_session)
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_debit(
            db_session, tenant_id=tenant.id, student_id=sid,
            amount=Decimal("3000"),
        )
        inv_id = _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            term_number=2, academic_year=2026, total=Decimal("5000"),
        )
        doc = service.build_invoice_document(
            db_session, tenant_id=tenant.id, invoice_id=inv_id,
        )
        # Baseline: PDF without a prior-balance for the same invoice.
        doc_no_prior = dict(doc)
        doc_no_prior["prior_balance"] = None
        pdf_without = generate_invoice_pdf(doc_no_prior)
        pdf_with = generate_invoice_pdf(doc)
        assert pdf_with.startswith(b"%PDF-")
        assert pdf_without.startswith(b"%PDF-")
        # Rendering the prior-balance block should measurably grow the PDF —
        # cheap smoke test that the block actually reached the stream even
        # though the ASCII text is compressed inside the PDF content stream.
        assert len(pdf_with) > len(pdf_without)
