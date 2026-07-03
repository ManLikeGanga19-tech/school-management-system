"""Phase S — partial carry-forward settlement consistency.

After the Phase N waterfall pays down part of a CF debit (row stays OPEN
with settled_amount > 0), every consumer must use the EFFECTIVE
outstanding (amount − settled_amount), not the original amount.

The critical case is the double-billing path: a parent pays part of
their arrears in cash, then next term's invoice must bundle only the
REMAINDER — not the full original debit.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.invoice import Invoice, InvoiceLine
from tests.helpers import create_tenant, make_actor


BASE = "/api/v1/finance"
ALL_FINANCE = list({
    "finance.policy.view", "finance.policy.manage",
    "finance.fees.view", "finance.fees.manage",
    "finance.invoices.view", "finance.invoices.manage",
    "finance.payments.view", "finance.payments.manage",
})


def _seed_student_enrollment(
    db: Session, *, tenant_id, admission_year: int = 2025,
) -> tuple[str, str]:
    """RETURNING student (admission_year < academic_year) + ENROLLED enrollment."""
    sid, eid = uuid4(), uuid4()
    db.execute(text(
        "INSERT INTO core.students "
        "(id, tenant_id, admission_no, first_name, last_name, status, admission_year) "
        "VALUES (:id, :tid, :adm, 'Partial', 'Settle', 'ACTIVE', :ay)"
    ), {"id": str(sid), "tid": str(tenant_id),
        "adm": f"P-{uuid4().hex[:6].upper()}", "ay": admission_year})
    db.execute(text(
        "INSERT INTO core.enrollments (id, tenant_id, student_id, status, payload) "
        "VALUES (:id, :tid, :sid, 'ENROLLED', CAST(:pl AS jsonb))"
    ), {"id": str(eid), "tid": str(tenant_id), "sid": str(sid),
        "pl": '{"class_code": "GRADE_1", "student_name": "Partial Settle"}'})
    db.commit()
    return str(sid), str(eid)


def _seed_cf_debit(
    db: Session, *, tenant_id, student_id: str, amount: Decimal,
    term_label: str = "Term 1 2025 arrears",
) -> str:
    cid = uuid4()
    db.execute(text(
        "INSERT INTO core.student_carry_forward_balances "
        "(id, tenant_id, student_id, term_label, amount, category, status) "
        "VALUES (:id, :tid, :sid, :label, :amt, 'MANUAL_DEBIT', 'OPEN')"
    ), {"id": str(cid), "tid": str(tenant_id), "sid": student_id,
        "label": term_label, "amt": str(amount)})
    db.commit()
    return str(cid)


def _setup_structure(client: TestClient, headers, *, term_amount: str = "10000") -> None:
    cat = client.post(
        f"{BASE}/fee-categories",
        json={"code": f"CAT_{uuid4().hex[:6]}", "name": "Tuition"},
        headers=headers,
    ).json()
    item = client.post(
        f"{BASE}/fee-items",
        json={
            "category_id": cat["id"], "code": f"IT_{uuid4().hex[:6]}",
            "name": "Tuition", "charge_frequency": "PER_TERM",
        },
        headers=headers,
    ).json()
    struct = client.post(
        f"{BASE}/fee-structures",
        json={
            "class_code": "GRADE_1", "academic_year": 2026,
            "student_type": "RETURNING", "name": "G1 2026 RET",
        },
        headers=headers,
    ).json()
    r = client.post(
        f"{BASE}/fee-structures/{struct['id']}/items",
        json={
            "fee_item_id": item["id"],
            "term_1_amount": term_amount,
            "term_2_amount": term_amount,
            "term_3_amount": term_amount,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text


class TestPartialSettlementConsistency:
    def test_summary_tile_shows_remainder_after_partial_settle(
        self, client: TestClient, db_session: Session,
    ):
        """The record-payment screen's Brought-forward tile must show the
        REMAINDER after a partial cash settlement, not the original."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        sid, _ = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid,
                       amount=Decimal("5000"))

        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "2000", "provider": "CASH"},
        )
        assert r.status_code == 200, r.text

        summary = client.get(
            f"{BASE}/students/{sid}/payment-summary", headers=headers,
        ).json()
        assert Decimal(summary["pending_balance_debit"]) == Decimal("3000.00")
        assert Decimal(summary["pending_balance_net"]) == Decimal("3000.00")

    def test_partially_consumed_credit_shows_remainder(
        self, client: TestClient, db_session: Session,
    ):
        """A credit row with settled_amount > 0 (partially spent) reports
        only its remaining spendable value."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        sid, _ = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        db_session.execute(text(
            "INSERT INTO core.student_carry_forward_balances "
            "(id, tenant_id, student_id, term_label, amount, settled_amount, "
            " category, status) "
            "VALUES (:id, :tid, :sid, 'Overpayment', -3000, 1000, "
            "        'OVERPAYMENT_CREDIT', 'OPEN')"
        ), {"id": str(uuid4()), "tid": str(tenant.id), "sid": sid})
        db_session.commit()

        summary = client.get(
            f"{BASE}/students/{sid}/payment-summary", headers=headers,
        ).json()
        assert Decimal(summary["pending_balance_credit"]) == Decimal("-2000.00")

    def test_next_term_invoice_bundles_only_remainder(
        self, client: TestClient, db_session: Session,
    ):
        """THE double-billing regression: pay 2000 of a 5000 CF debit in
        cash, then generate the next term's invoice — the arrears line
        must be 3000, and the invoice total 10000 + 3000 = 13000 (not
        15000, which would bill the paid 2000 a second time)."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        sid, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        _setup_structure(client, headers, term_amount="10000")
        cf_id = _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid,
                               amount=Decimal("5000"))

        # Partial cash settlement via the waterfall.
        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "2000", "provider": "MPESA", "reference": "MP-P"},
        )
        assert r.status_code == 200, r.text
        assert Decimal(r.json()["cf_debits_settled"]) == Decimal("2000")

        # Generate the next term's invoice — CF rolls in.
        gen = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 1, "academic_year": 2026},
            headers=headers,
        )
        assert gen.status_code == 200, gen.text
        inv_id = gen.json()["id"]

        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        assert Decimal(str(inv.total_amount)) == Decimal("13000.00")

        arrears_line = db_session.execute(
            select(InvoiceLine).where(
                InvoiceLine.invoice_id == inv_id,
                InvoiceLine.description == "Arrears (Brought Forward)",
            )
        ).scalar_one()
        assert Decimal(str(arrears_line.amount)) == Decimal("3000.00")
        # Breakdown meta narrates original / settled / bundled per row.
        breakdown = (arrears_line.meta or {}).get("breakdown") or []
        assert len(breakdown) == 1
        assert Decimal(breakdown[0]["original_amount"]) == Decimal("5000.00")
        assert Decimal(breakdown[0]["already_settled"]) == Decimal("2000.00")
        assert Decimal(breakdown[0]["amount"]) == Decimal("3000.00")

        # The CF row is BUNDLED into this invoice.
        status = db_session.execute(text(
            "SELECT status, invoice_id FROM core.student_carry_forward_balances "
            "WHERE id = :id"
        ), {"id": cf_id}).mappings().one()
        assert status["status"] == "BUNDLED"
        assert str(status["invoice_id"]) == inv_id

    def test_enrollment_finance_gate_uses_remainder(
        self, client: TestClient, db_session: Session,
    ):
        """The enroll / transfer-out gate's pending_carry_forward_total
        must reflect only what is still owed."""
        from app.api.v1.finance import service
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        sid, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid,
                       amount=Decimal("5000"))
        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "2000", "provider": "CASH"},
        )
        assert r.status_code == 200, r.text

        status = service.get_enrollment_finance_status(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
        )
        assert Decimal(status["fees"]["pending_carry_forward_total"]) == Decimal("3000.00")

    def test_fully_settled_cf_never_rebundled(
        self, client: TestClient, db_session: Session,
    ):
        """Pay the WHOLE CF debit in cash, then generate the next invoice —
        no arrears line at all; the invoice is exactly the term amount."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_FINANCE)
        sid, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        _setup_structure(client, headers, term_amount="10000")
        _seed_cf_debit(db_session, tenant_id=tenant.id, student_id=sid,
                       amount=Decimal("5000"))
        r = client.post(
            f"{BASE}/students/{sid}/payments",
            headers=headers,
            json={"amount": "5000", "provider": "CASH"},
        )
        assert r.status_code == 200, r.text

        gen = client.post(
            f"{BASE}/invoices/generate/fees/v2",
            json={"enrollment_id": eid, "term_number": 1, "academic_year": 2026},
            headers=headers,
        )
        assert gen.status_code == 200, gen.text
        inv = db_session.get(Invoice, gen.json()["id"])
        db_session.refresh(inv)
        assert Decimal(str(inv.total_amount)) == Decimal("10000.00")
        arrears = db_session.execute(
            select(InvoiceLine).where(
                InvoiceLine.invoice_id == inv.id,
                InvoiceLine.description == "Arrears (Brought Forward)",
            )
        ).scalar_one_or_none()
        assert arrears is None
