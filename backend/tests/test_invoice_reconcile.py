"""Phase Q — Fee-structure reconciliation engine tests.

When a fee structure is edited AFTER invoices were generated from it, the
engine detects and corrects the drift in place — preserving payments,
scholarship discounts, and every non-structure line.

Endpoints under test:
    POST /finance/reconcile/sweep                       (+ dry_run)
    POST /finance/fee-structures/{id}/reconcile         (+ dry_run)
    PUT  /finance/fee-structures/{id}/items             (auto-reconcile hook)
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.invoice import Invoice, InvoiceLine
from app.models.student_carry_forward import StudentCarryForward
from tests.helpers import create_tenant, make_actor


BASE = "/api/v1/finance"
PERMS = [
    "finance.fees.view", "finance.fees.manage",
    "finance.invoices.view", "finance.invoices.manage",
    "finance.payments.view", "finance.payments.manage",
]


def _seed_student_enrollment(db: Session, *, tenant_id) -> tuple[str, str]:
    sid, eid = uuid4(), uuid4()
    db.execute(text(
        "INSERT INTO core.students "
        "(id, tenant_id, admission_no, first_name, last_name, status, admission_year) "
        "VALUES (:id, :tid, :adm, 'Recon', 'Student', 'ACTIVE', 2026)"
    ), {"id": str(sid), "tid": str(tenant_id), "adm": f"R-{uuid4().hex[:6].upper()}"})
    db.execute(text(
        "INSERT INTO core.enrollments (id, tenant_id, student_id, status, payload) "
        "VALUES (:id, :tid, :sid, 'ENROLLED', CAST(:pl AS jsonb))"
    ), {"id": str(eid), "tid": str(tenant_id), "sid": str(sid),
        "pl": '{"class_code": "PP2", "student_name": "Recon Student"}'})
    db.commit()
    return str(sid), str(eid)


def _seed_structure(
    db: Session, *, tenant_id,
    items: list[tuple[str, Decimal]],  # (item_name, term_2_amount)
    class_code: str = "PP2",
) -> tuple[str, dict[str, str]]:
    """Seed category + fee items + structure. Returns (structure_id,
    {item_name: fee_item_id})."""
    cat_id = uuid4()
    db.execute(text(
        "INSERT INTO core.fee_categories (id, tenant_id, code, name) "
        "VALUES (:id, :tid, :code, 'Tuition & Fees')"
    ), {"id": str(cat_id), "tid": str(tenant_id), "code": f"CAT-{uuid4().hex[:4].upper()}"})
    struct_id = uuid4()
    db.execute(text(
        "INSERT INTO core.fee_structures "
        "(id, tenant_id, class_code, academic_year, student_type, name) "
        "VALUES (:id, :tid, :cc, 2026, 'NEW', :name)"
    ), {"id": str(struct_id), "tid": str(tenant_id), "cc": class_code,
        "name": f"{class_code} 2026 NEW"})
    fee_ids: dict[str, str] = {}
    for name, t2 in items:
        fid = uuid4()
        db.execute(text(
            "INSERT INTO core.fee_items (id, tenant_id, category_id, code, name, charge_frequency) "
            "VALUES (:id, :tid, :cat, :code, :name, 'PER_TERM')"
        ), {"id": str(fid), "tid": str(tenant_id), "cat": str(cat_id),
            "code": f"FI-{uuid4().hex[:4].upper()}", "name": name})
        db.execute(text(
            "INSERT INTO core.fee_structure_items "
            "(id, structure_id, fee_item_id, term_1_amount, term_2_amount, term_3_amount) "
            "VALUES (:id, :sid, :fid, :amt, :amt, :amt)"
        ), {"id": str(uuid4()), "sid": str(struct_id), "fid": str(fid), "amt": str(t2)})
        fee_ids[name] = str(fid)
    db.commit()
    return str(struct_id), fee_ids


def _seed_invoice_from_structure(
    db: Session, *, tenant_id, enrollment_id: str, structure_id: str,
    lines: list[tuple[str, str, Decimal]],  # (fee_item_id, description, amount)
    status: str = "ISSUED",
    paid: Decimal = Decimal("0"),
) -> str:
    iid = uuid4()
    total = sum((a for _, _, a in lines), Decimal("0"))
    db.execute(text(
        "INSERT INTO core.invoices "
        "(id, tenant_id, invoice_no, invoice_type, status, enrollment_id, "
        " term_number, academic_year, currency, total_amount, paid_amount, balance_amount, meta) "
        "VALUES (:id, :tid, :no, 'SCHOOL_FEES', :status, :eid, 2, 2026, 'KES', "
        "        :total, :paid, :bal, CAST(:meta AS jsonb))"
    ), {
        "id": str(iid), "tid": str(tenant_id),
        "no": f"INV-{uuid4().hex[:6].upper()}",
        "status": status, "eid": enrollment_id,
        "total": str(total), "paid": str(paid), "bal": str(total - paid),
        "meta": (
            '{"fee_structure_id": "' + structure_id + '", '
            '"class_code": "PP2", "student_type": "NEW", '
            '"academic_year": 2026, "term_number": 2}'
        ),
    })
    for fid, desc, amt in lines:
        db.execute(text(
            "INSERT INTO core.invoice_lines (invoice_id, description, amount, meta) "
            "VALUES (:iid, :desc, :amt, CAST(:meta AS jsonb))"
        ), {"iid": str(iid), "desc": desc, "amt": str(amt),
            "meta": '{"fee_item_id": "' + fid + '", "charge_frequency": "PER_TERM"}'})
    db.commit()
    return str(iid)


def _pay(db: Session, *, tenant_id, invoice_id: str, amount: Decimal) -> None:
    """Book a real Payment + allocation so paid_amount survives recalc."""
    pid = uuid4()
    db.execute(text(
        "INSERT INTO core.payments (id, tenant_id, provider, amount, received_at) "
        "VALUES (:id, :tid, 'CASH', :amt, NOW())"
    ), {"id": str(pid), "tid": str(tenant_id), "amt": str(amount)})
    db.execute(text(
        "INSERT INTO core.payment_allocations (payment_id, invoice_id, amount) "
        "VALUES (:pid, :iid, :amt)"
    ), {"pid": str(pid), "iid": invoice_id, "amt": str(amount)})
    db.commit()


def _set_structure_amount(db: Session, *, structure_id: str, fee_item_id: str, amount: Decimal) -> None:
    db.execute(text(
        "UPDATE core.fee_structure_items "
        "SET term_1_amount = :amt, term_2_amount = :amt, term_3_amount = :amt "
        "WHERE structure_id = :sid AND fee_item_id = :fid"
    ), {"amt": str(amount), "sid": structure_id, "fid": fee_item_id})
    db.commit()


class TestReconcileSweep:
    def test_amount_drift_corrected_preserving_payment(
        self, client: TestClient, db_session: Session,
    ):
        """The PP2 case: invoice published at old amounts, structure edited,
        partial payment made — sweep corrects the total, keeps the payment."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_id, fee_ids = _seed_structure(
            db_session, tenant_id=tenant.id,
            items=[("Tuition", Decimal("8000")), ("Transport", Decimal("2000"))],
        )
        inv_id = _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            structure_id=struct_id,
            lines=[
                (fee_ids["Tuition"], "Tuition (PP2)", Decimal("8000")),
                (fee_ids["Transport"], "Transport (PP2)", Decimal("2000")),
            ],
        )
        _pay(db_session, tenant_id=tenant.id, invoice_id=inv_id, amount=Decimal("4000"))
        # Structure edited AFTER publication: tuition 8000 → 9500.
        _set_structure_amount(
            db_session, structure_id=struct_id,
            fee_item_id=fee_ids["Tuition"], amount=Decimal("9500"),
        )

        r = client.post(f"{BASE}/reconcile/sweep", headers=headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["reconciled"] == 1

        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        assert Decimal(str(inv.total_amount)) == Decimal("11500.00")
        assert Decimal(str(inv.paid_amount)) == Decimal("4000.00")   # preserved
        assert Decimal(str(inv.balance_amount)) == Decimal("7500.00")
        assert inv.status == "PARTIAL"
        assert (inv.meta or {}).get("reconciled_count") == 1

    def test_sweep_is_idempotent(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_id, fee_ids = _seed_structure(
            db_session, tenant_id=tenant.id, items=[("Tuition", Decimal("8000"))],
        )
        _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            structure_id=struct_id,
            lines=[(fee_ids["Tuition"], "Tuition (PP2)", Decimal("8000"))],
        )
        # Aligned invoice: first sweep is a no-op; a drift then one sweep
        # fixes it and the second sweep is a no-op again.
        r1 = client.post(f"{BASE}/reconcile/sweep", headers=headers)
        assert r1.json()["reconciled"] == 0
        _set_structure_amount(
            db_session, structure_id=struct_id,
            fee_item_id=fee_ids["Tuition"], amount=Decimal("9000"),
        )
        r2 = client.post(f"{BASE}/reconcile/sweep", headers=headers)
        assert r2.json()["reconciled"] == 1
        r3 = client.post(f"{BASE}/reconcile/sweep", headers=headers)
        assert r3.json()["reconciled"] == 0

    def test_fee_drop_below_paid_books_overpayment_credit(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_id, fee_ids = _seed_structure(
            db_session, tenant_id=tenant.id, items=[("Tuition", Decimal("10000"))],
        )
        inv_id = _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            structure_id=struct_id,
            lines=[(fee_ids["Tuition"], "Tuition (PP2)", Decimal("10000"))],
        )
        _pay(db_session, tenant_id=tenant.id, invoice_id=inv_id, amount=Decimal("9000"))
        # Fees reduced to 6000 — parent already paid 9000.
        _set_structure_amount(
            db_session, structure_id=struct_id,
            fee_item_id=fee_ids["Tuition"], amount=Decimal("6000"),
        )
        r = client.post(f"{BASE}/reconcile/sweep", headers=headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["reconciled"] == 1
        assert Decimal(body["invoices"][0]["overpayment_credited"]) == Decimal("3000")

        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        assert inv.status == "PAID"
        assert Decimal(str(inv.balance_amount)) == Decimal("0.00")

        credit = db_session.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant.id,
                StudentCarryForward.student_id == sid,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
        ).scalar_one()
        assert Decimal(str(credit.amount)) == Decimal("-3000.00")

    def test_item_removed_from_structure_removes_line(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_id, fee_ids = _seed_structure(
            db_session, tenant_id=tenant.id,
            items=[("Tuition", Decimal("8000")), ("Lunch", Decimal("1500"))],
        )
        inv_id = _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            structure_id=struct_id,
            lines=[
                (fee_ids["Tuition"], "Tuition (PP2)", Decimal("8000")),
                (fee_ids["Lunch"], "Lunch (PP2)", Decimal("1500")),
            ],
        )
        db_session.execute(text(
            "DELETE FROM core.fee_structure_items "
            "WHERE structure_id = :sid AND fee_item_id = :fid"
        ), {"sid": struct_id, "fid": fee_ids["Lunch"]})
        db_session.commit()

        r = client.post(f"{BASE}/reconcile/sweep", headers=headers)
        assert r.json()["reconciled"] == 1
        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        assert Decimal(str(inv.total_amount)) == Decimal("8000.00")
        descriptions = db_session.execute(
            select(InvoiceLine.description).where(InvoiceLine.invoice_id == inv_id)
        ).scalars().all()
        assert not any("Lunch" in d for d in descriptions)

    def test_item_added_to_structure_adds_line(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_id, fee_ids = _seed_structure(
            db_session, tenant_id=tenant.id, items=[("Tuition", Decimal("8000"))],
        )
        inv_id = _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            structure_id=struct_id,
            lines=[(fee_ids["Tuition"], "Tuition (PP2)", Decimal("8000"))],
        )
        # Add a new fee item to the structure after publication.
        cat_id = db_session.execute(text(
            "SELECT category_id FROM core.fee_items WHERE id = :fid"
        ), {"fid": fee_ids["Tuition"]}).scalar()
        new_fid = uuid4()
        db_session.execute(text(
            "INSERT INTO core.fee_items (id, tenant_id, category_id, code, name, charge_frequency) "
            "VALUES (:id, :tid, :cat, :code, 'Activity Fee', 'PER_TERM')"
        ), {"id": str(new_fid), "tid": str(tenant.id), "cat": str(cat_id),
            "code": f"FI-{uuid4().hex[:4].upper()}"})
        db_session.execute(text(
            "INSERT INTO core.fee_structure_items "
            "(id, structure_id, fee_item_id, term_1_amount, term_2_amount, term_3_amount) "
            "VALUES (:id, :sid, :fid, 500, 500, 500)"
        ), {"id": str(uuid4()), "sid": struct_id, "fid": str(new_fid)})
        db_session.commit()

        r = client.post(f"{BASE}/reconcile/sweep", headers=headers)
        assert r.json()["reconciled"] == 1
        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        assert Decimal(str(inv.total_amount)) == Decimal("8500.00")

    def test_dry_run_reports_without_mutating(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_id, fee_ids = _seed_structure(
            db_session, tenant_id=tenant.id, items=[("Tuition", Decimal("8000"))],
        )
        inv_id = _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            structure_id=struct_id,
            lines=[(fee_ids["Tuition"], "Tuition (PP2)", Decimal("8000"))],
        )
        _set_structure_amount(
            db_session, structure_id=struct_id,
            fee_item_id=fee_ids["Tuition"], amount=Decimal("9500"),
        )
        r = client.post(f"{BASE}/reconcile/sweep?dry_run=true", headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["dry_run"] is True
        assert body["reconciled"] == 1
        assert Decimal(body["invoices"][0]["new_total"]) == Decimal("9500")
        # Nothing actually changed.
        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        assert Decimal(str(inv.total_amount)) == Decimal("8000.00")

    def test_cancelled_invoice_untouched(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_id, fee_ids = _seed_structure(
            db_session, tenant_id=tenant.id, items=[("Tuition", Decimal("8000"))],
        )
        inv_id = _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            structure_id=struct_id,
            lines=[(fee_ids["Tuition"], "Tuition (PP2)", Decimal("8000"))],
            status="CANCELLED",
        )
        _set_structure_amount(
            db_session, structure_id=struct_id,
            fee_item_id=fee_ids["Tuition"], amount=Decimal("9500"),
        )
        r = client.post(f"{BASE}/reconcile/sweep", headers=headers)
        assert r.json()["reconciled"] == 0
        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        assert Decimal(str(inv.total_amount)) == Decimal("8000.00")

    def test_sweep_requires_permission(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        r = client.post(f"{BASE}/reconcile/sweep", headers=headers)
        assert r.status_code == 403

    def test_sweep_writes_audit_events(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_id, fee_ids = _seed_structure(
            db_session, tenant_id=tenant.id, items=[("Tuition", Decimal("8000"))],
        )
        _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            structure_id=struct_id,
            lines=[(fee_ids["Tuition"], "Tuition (PP2)", Decimal("8000"))],
        )
        _set_structure_amount(
            db_session, structure_id=struct_id,
            fee_item_id=fee_ids["Tuition"], amount=Decimal("9000"),
        )
        client.post(f"{BASE}/reconcile/sweep", headers=headers)
        reconciled_cnt = db_session.execute(text(
            "SELECT COUNT(*) FROM core.audit_logs "
            "WHERE tenant_id = :tid AND action = 'invoice.reconciled'"
        ), {"tid": str(tenant.id)}).scalar()
        sweep_cnt = db_session.execute(text(
            "SELECT COUNT(*) FROM core.audit_logs "
            "WHERE tenant_id = :tid AND action = 'finance.reconcile.sweep'"
        ), {"tid": str(tenant.id)}).scalar()
        assert reconciled_cnt == 1
        assert sweep_cnt == 1


class TestStructureEditHook:
    def test_bulk_upsert_auto_reconciles(
        self, client: TestClient, db_session: Session,
    ):
        """Editing term amounts via PUT /items fixes affected invoices in the
        same request — drift is dead the moment it is born."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_id, fee_ids = _seed_structure(
            db_session, tenant_id=tenant.id, items=[("Tuition", Decimal("8000"))],
        )
        inv_id = _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            structure_id=struct_id,
            lines=[(fee_ids["Tuition"], "Tuition (PP2)", Decimal("8000"))],
        )
        r = client.put(
            f"{BASE}/fee-structures/{struct_id}/items",
            headers=headers,
            json=[{
                "fee_item_id": fee_ids["Tuition"],
                "term_1_amount": "9500",
                "term_2_amount": "9500",
                "term_3_amount": "9500",
            }],
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["reconciliation"]["reconciled"] == 1

        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        assert Decimal(str(inv.total_amount)) == Decimal("9500.00")

    def test_structure_reconcile_endpoint_scoped(
        self, client: TestClient, db_session: Session,
    ):
        """Per-structure endpoint only touches that structure's invoices."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _, eid_a = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        _, eid_b = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_a, fees_a = _seed_structure(
            db_session, tenant_id=tenant.id, items=[("Tuition", Decimal("8000"))],
            class_code="PP2",
        )
        struct_b, fees_b = _seed_structure(
            db_session, tenant_id=tenant.id, items=[("Tuition", Decimal("7000"))],
            class_code="PP1",
        )
        inv_a = _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid_a,
            structure_id=struct_a,
            lines=[(fees_a["Tuition"], "Tuition (PP2)", Decimal("8000"))],
        )
        inv_b = _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid_b,
            structure_id=struct_b,
            lines=[(fees_b["Tuition"], "Tuition (PP1)", Decimal("7000"))],
        )
        # Drift BOTH structures; reconcile only A.
        _set_structure_amount(db_session, structure_id=struct_a,
                              fee_item_id=fees_a["Tuition"], amount=Decimal("9000"))
        _set_structure_amount(db_session, structure_id=struct_b,
                              fee_item_id=fees_b["Tuition"], amount=Decimal("6000"))

        r = client.post(
            f"{BASE}/fee-structures/{struct_a}/reconcile", headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["reconciled"] == 1

        inv = db_session.get(Invoice, inv_a)
        db_session.refresh(inv)
        assert Decimal(str(inv.total_amount)) == Decimal("9000.00")
        inv2 = db_session.get(Invoice, inv_b)
        db_session.refresh(inv2)
        assert Decimal(str(inv2.total_amount)) == Decimal("7000.00")  # untouched


class TestReconcileWithScholarship:
    def test_percentage_scholarship_recomputed(
        self, client: TestClient, db_session: Session,
    ):
        """A 50% scholarship must stay 50% of the CORRECTED subtotal."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid, eid = _seed_student_enrollment(db_session, tenant_id=tenant.id)
        struct_id, fee_ids = _seed_structure(
            db_session, tenant_id=tenant.id, items=[("Tuition", Decimal("8000"))],
        )
        inv_id = _seed_invoice_from_structure(
            db_session, tenant_id=tenant.id, enrollment_id=eid,
            structure_id=struct_id,
            lines=[(fee_ids["Tuition"], "Tuition (PP2)", Decimal("8000"))],
        )
        # Seed a 50% scholarship + allocation + discount line (mirrors
        # apply_scholarship_to_invoice output).
        sch_id, alloc_id = uuid4(), uuid4()
        db_session.execute(text(
            "INSERT INTO core.scholarships (id, tenant_id, name, type, value, is_active) "
            "VALUES (:id, :tid, 'Half Bursary', 'PERCENTAGE', 50, TRUE)"
        ), {"id": str(sch_id), "tid": str(tenant.id)})
        db_session.execute(text(
            "INSERT INTO core.scholarship_allocations "
            "(id, tenant_id, scholarship_id, enrollment_id, student_id, invoice_id, amount, reason, status) "
            "VALUES (:id, :tid, :sch, :eid, :sid, :inv, 4000, 'seed', 'ACTIVE')"
        ), {"id": str(alloc_id), "tid": str(tenant.id), "sch": str(sch_id),
            "eid": eid, "sid": sid, "inv": inv_id})
        db_session.execute(text(
            "INSERT INTO core.invoice_lines (invoice_id, description, amount, meta) "
            "VALUES (:iid, 'Scholarship: Half Bursary', -4000, CAST(:meta AS jsonb))"
        ), {"iid": inv_id,
            "meta": (
                '{"scholarship_id": "' + str(sch_id) + '", '
                '"scholarship_type": "PERCENTAGE", '
                '"scholarship_allocation_id": "' + str(alloc_id) + '"}'
            )})
        # Fix the invoice totals to reflect the discount (8000 - 4000).
        db_session.execute(text(
            "UPDATE core.invoices SET total_amount = 4000, balance_amount = 4000 "
            "WHERE id = :iid"
        ), {"iid": inv_id})
        db_session.commit()

        # Structure edit: tuition 8000 → 10000. 50% discount must become 5000.
        _set_structure_amount(
            db_session, structure_id=struct_id,
            fee_item_id=fee_ids["Tuition"], amount=Decimal("10000"),
        )
        r = client.post(f"{BASE}/reconcile/sweep", headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["reconciled"] == 1

        inv = db_session.get(Invoice, inv_id)
        db_session.refresh(inv)
        # 10000 - 5000 = 5000
        assert Decimal(str(inv.total_amount)) == Decimal("5000.00")

        alloc_amount = db_session.execute(text(
            "SELECT amount FROM core.scholarship_allocations WHERE id = :aid"
        ), {"aid": str(alloc_id)}).scalar()
        assert Decimal(str(alloc_amount)) == Decimal("5000.00")
