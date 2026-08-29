"""Tests for director-only payment reversal.

  POST /api/v1/finance/payments/{payment_id}/reverse

A reversal removes a payment's invoice allocations and restores each affected
invoice to its pre-payment amounts, undoes any carry-forward debt the payment
settled, marks the payment reversed for the audit trail, and *blocks* — rather
than corrupt the ledger — any payment that created or consumed a credit balance.

These tests lock in the whole contract: the ledger-restoring happy paths, the
integrity guards, the audit trail, the RBAC boundary (reversal is gated by
`finance.payments.reverse`, granted to DIRECTOR only), and tenant isolation.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor
from tests.test_finance_record_by_student import (
    _seed_student_and_enrollment,
    _seed_invoice,
)

BASE = "/api/v1/finance"
DIRECTOR_BASE = "/api/v1/director/finance"

# A finance manager who can record + view but NOT reverse payments.
FINANCE_MANAGE = [
    "finance.invoices.view", "finance.invoices.manage",
    "finance.payments.view", "finance.payments.manage",
]
# A director who can also reverse.
REVERSE_PERMS = FINANCE_MANAGE + ["finance.payments.reverse"]


# ── helpers ─────────────────────────────────────────────────────────────────

def _record_payment(client, headers, sid, amount, *, provider="CASH", reference=None):
    payload: dict = {"amount": str(amount), "provider": provider}
    if reference:
        payload["reference"] = reference
    resp = client.post(f"{BASE}/students/{sid}/payments", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _reverse(client, headers, payment_id, *, reason="Recorded in error"):
    return client.post(
        f"{BASE}/payments/{payment_id}/reverse",
        json={"reason": reason},
        headers=headers,
    )


def _invoice_row(db: Session, iid: str):
    return db.execute(
        text(
            "SELECT status, paid_amount, balance_amount "
            "FROM core.invoices WHERE id = :id"
        ),
        {"id": iid},
    ).mappings().first()


def _payment_row(db: Session, pid: str):
    return db.execute(
        text(
            "SELECT reversed_at, reversed_by, reversal_reason "
            "FROM core.payments WHERE id = :id"
        ),
        {"id": pid},
    ).mappings().first()


def _alloc_count(db: Session, pid: str) -> int:
    return db.execute(
        text("SELECT COUNT(*) FROM core.payment_allocations WHERE payment_id = :id"),
        {"id": pid},
    ).scalar()


# ── happy paths ──────────────────────────────────────────────────────────────

class TestPaymentReversalHappyPath:
    def test_reverse_full_payment_restores_invoice(
        self, client: TestClient, db_session: Session
    ):
        """A payment that fully settled an invoice, once reversed, returns the
        invoice to ISSUED with the whole balance owing again, marks the payment
        reversed, and removes the allocations."""
        tenant = create_tenant(db_session, slug=f"rev1-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                            term_number=1, academic_year=2026, total=Decimal("3000"))
        actor, headers = make_actor(db_session, tenant=tenant, permissions=REVERSE_PERMS)

        rec = _record_payment(client, headers, sid, "3000")
        pid = rec["payment_id"]
        assert _invoice_row(db_session, iid)["status"] == "PAID"

        resp = _reverse(client, headers, pid, reason="Duplicate entry")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["reversed"] is True
        assert body["payment_id"] == pid
        assert body["reversed_at"]
        restored = {r["invoice_id"] for r in body["invoices_restored"]}
        assert iid in restored

        row = _invoice_row(db_session, iid)
        assert row["status"] == "ISSUED"
        assert Decimal(row["paid_amount"]) == 0
        assert Decimal(row["balance_amount"]) == Decimal("3000")

        pay = _payment_row(db_session, pid)
        assert pay["reversed_at"] is not None
        assert str(pay["reversed_by"]) == str(actor.id)
        assert pay["reversal_reason"] == "Duplicate entry"
        assert _alloc_count(db_session, pid) == 0

    def test_reverse_partial_payment_restores_balance(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"rev2-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                            term_number=1, academic_year=2026, total=Decimal("10000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=REVERSE_PERMS)

        rec = _record_payment(client, headers, sid, "4000", provider="MPESA", reference="MX1")
        assert _invoice_row(db_session, iid)["status"] == "PARTIAL"

        resp = _reverse(client, headers, rec["payment_id"], reason="Wrong student")
        assert resp.status_code == 200, resp.text

        row = _invoice_row(db_session, iid)
        assert row["status"] == "ISSUED"
        assert Decimal(row["paid_amount"]) == 0
        assert Decimal(row["balance_amount"]) == Decimal("10000")

    def test_reverse_writes_audit_event(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"rev3-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("3000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=REVERSE_PERMS)

        pid = _record_payment(client, headers, sid, "3000")["payment_id"]
        assert _reverse(client, headers, pid, reason="Cheque bounced").status_code == 200

        audit = db_session.execute(
            text(
                "SELECT action, resource, resource_id, payload->>'reason' AS reason "
                "FROM core.audit_logs "
                "WHERE tenant_id = :tid AND action = 'payment.reverse' "
                "ORDER BY created_at DESC LIMIT 1"
            ),
            {"tid": str(tenant.id)},
        ).mappings().first()
        assert audit is not None
        assert audit["resource"] == "payment"
        assert str(audit["resource_id"]) == pid
        assert audit["reason"] == "Cheque bounced"

    def test_reverse_restores_total_outstanding(
        self, client: TestClient, db_session: Session
    ):
        """Ledger integrity via aggregates: the student's total outstanding
        returns to the full invoice amount after the payment is reversed."""
        tenant = create_tenant(db_session, slug=f"rev4-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("6000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=REVERSE_PERMS)

        pid = _record_payment(client, headers, sid, "6000")["payment_id"]
        summary = client.get(f"{BASE}/students/{sid}/payment-summary", headers=headers).json()
        assert Decimal(summary["total_outstanding"]) == 0

        assert _reverse(client, headers, pid).status_code == 200

        summary = client.get(f"{BASE}/students/{sid}/payment-summary", headers=headers).json()
        assert Decimal(summary["total_outstanding"]) == Decimal("6000")

    def test_reversed_state_surfaced_in_payments_list(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"rev5-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("3000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=REVERSE_PERMS)

        pid = _record_payment(client, headers, sid, "3000")["payment_id"]
        assert _reverse(client, headers, pid, reason="Listing check").status_code == 200

        listing = client.get(f"{DIRECTOR_BASE}/payments", headers=headers).json()
        row = next((r for r in listing["items"] if r["id"] == pid), None)
        assert row is not None, "reversed payment should still appear in the list"
        assert row["reversed_at"] is not None
        assert row["reversal_reason"] == "Listing check"


# ── ledger-integrity guards ──────────────────────────────────────────────────

class TestPaymentReversalGuards:
    def test_reverse_requires_a_reason(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"revg1-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("3000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=REVERSE_PERMS)

        pid = _record_payment(client, headers, sid, "3000")["payment_id"]
        resp = _reverse(client, headers, pid, reason="   ")
        assert resp.status_code == 400
        assert "reason" in resp.json()["detail"].lower()
        # Guard did not partially apply — payment is still live.
        assert _payment_row(db_session, pid)["reversed_at"] is None

    def test_double_reversal_is_blocked(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"revg2-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("3000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=REVERSE_PERMS)

        pid = _record_payment(client, headers, sid, "3000")["payment_id"]
        assert _reverse(client, headers, pid).status_code == 200
        resp = _reverse(client, headers, pid)
        assert resp.status_code == 400
        assert "already been reversed" in resp.json()["detail"].lower()

    def test_reverse_blocks_overpayment_credit(
        self, client: TestClient, db_session: Session
    ):
        """A payment that overpaid an invoice created a credit balance. Reversal
        would leave a dangling credit, so it is blocked with a clear reason and
        nothing is mutated."""
        tenant = create_tenant(db_session, slug=f"revg3-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        iid = _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                            term_number=1, academic_year=2026, total=Decimal("3000"))
        _, headers = make_actor(db_session, tenant=tenant, permissions=REVERSE_PERMS)

        # Pay 5,000 against a 3,000 invoice → 2,000 surplus credit.
        rec = _record_payment(client, headers, sid, "5000")
        assert Decimal(rec["surplus_credit"]) == Decimal("2000")
        pid = rec["payment_id"]

        resp = _reverse(client, headers, pid)
        assert resp.status_code == 400
        assert "credit" in resp.json()["detail"].lower()

        # Nothing changed: payment still live, invoice still PAID, allocation intact.
        assert _payment_row(db_session, pid)["reversed_at"] is None
        assert _invoice_row(db_session, iid)["status"] == "PAID"
        assert _alloc_count(db_session, pid) == 1

    def test_reverse_unknown_payment_is_rejected(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session, slug=f"revg4-{uuid4().hex[:6]}")
        _, headers = make_actor(db_session, tenant=tenant, permissions=REVERSE_PERMS)
        resp = _reverse(client, headers, str(uuid4()))
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


# ── security: RBAC + tenant isolation ────────────────────────────────────────

class TestPaymentReversalSecurity:
    def test_reverse_requires_reverse_permission(
        self, client: TestClient, db_session: Session
    ):
        """A finance manager who can record payments still cannot reverse them
        without finance.payments.reverse (director-only)."""
        tenant = create_tenant(db_session, slug=f"revs1-{uuid4().hex[:6]}")
        sid, eid = _seed_student_and_enrollment(db_session, tenant_id=tenant.id)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      term_number=1, academic_year=2026, total=Decimal("3000"))
        # Actor WITH manage but WITHOUT reverse.
        _, headers = make_actor(db_session, tenant=tenant, permissions=FINANCE_MANAGE)

        pid = _record_payment(client, headers, sid, "3000")["payment_id"]
        resp = _reverse(client, headers, pid)
        assert resp.status_code == 403
        assert _payment_row(db_session, pid)["reversed_at"] is None

    def test_reverse_is_tenant_isolated(
        self, client: TestClient, db_session: Session
    ):
        """A director in tenant B cannot reverse a payment that belongs to
        tenant A — it simply does not exist in their scope."""
        tenant_a = create_tenant(db_session, slug=f"revs2a-{uuid4().hex[:6]}")
        tenant_b = create_tenant(db_session, slug=f"revs2b-{uuid4().hex[:6]}")
        sid_a, eid_a = _seed_student_and_enrollment(db_session, tenant_id=tenant_a.id)
        _seed_invoice(db_session, tenant_id=tenant_a.id, enrollment_id=eid_a,
                      term_number=1, academic_year=2026, total=Decimal("3000"))
        _, headers_a = make_actor(db_session, tenant=tenant_a, permissions=REVERSE_PERMS)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=REVERSE_PERMS)

        pid = _record_payment(client, headers_a, sid_a, "3000")["payment_id"]

        resp = _reverse(client, headers_b, pid)
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()
        # Payment in tenant A is untouched.
        assert _payment_row(db_session, pid)["reversed_at"] is None
