"""Unit tests for dashboard_stats helpers (Phase E1).

Covers:
  * Student demographics (gender bucketing, ACTIVE filter, tenant scoping)
  * By-date current-term selection (today inside window, fallback paths)
  * Finance current-term scoping via term_number + academic_year
  * Per-class / per-term / per-provider / top-outstanding breakdowns
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.api.v1.tenants.dashboard_stats import (
    _normalize_gender,
    _resolve_current_term_by_date,
    get_finance_all_time,
    get_finance_by_class,
    get_finance_by_provider,
    get_finance_by_term,
    get_finance_current_term,
    get_scholarship_breakdown,
    get_student_demographics,
    get_top_outstanding,
)
from tests.helpers import create_tenant


# ── Seed helpers ────────────────────────────────────────────────────────────

def _seed_student(
    db: Session, *, tenant_id, gender: str | None, status: str = "ACTIVE"
) -> str:
    sid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.students (id, tenant_id, admission_no, "
            "first_name, last_name, gender, status) "
            "VALUES (:id, :tid, :adm, :fn, :ln, :g, :st)"
        ),
        {
            "id": sid,
            "tid": str(tenant_id),
            "adm": f"ADM-{uuid4().hex[:6]}",
            "fn": "Test",
            "ln": "Student",
            "g": gender,
            "st": status,
        },
    )
    db.commit()
    return sid


def _seed_term(
    db: Session,
    *,
    tenant_id,
    code: str,
    start: date,
    end: date,
    term_number: int | None = None,
    academic_year: int | None = None,
    is_active: bool = True,
) -> str:
    tid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.tenant_terms "
            "(id, tenant_id, code, name, start_date, end_date, "
            " term_number, academic_year, is_active) "
            "VALUES (:id, :tid, :code, :name, :start, :end, :tn, :yr, :act)"
        ),
        {
            "id": tid,
            "tid": str(tenant_id),
            "code": code,
            "name": f"Term {code}",
            "start": start,
            "end": end,
            "tn": term_number,
            "yr": academic_year,
            "act": is_active,
        },
    )
    db.commit()
    return tid


def _seed_enrollment(
    db: Session, *, tenant_id, student_id, class_code: str
) -> str:
    eid = str(uuid4())
    payload = {
        "student_name": f"Student {class_code}",
        "class_code": class_code,
    }
    db.execute(
        sa.text(
            "INSERT INTO core.enrollments "
            "(id, tenant_id, admission_number, status, payload, student_id) "
            "VALUES (:id, :tid, :adm, 'ENROLLED', CAST(:pl AS jsonb), :sid)"
        ),
        {
            "id": eid,
            "tid": str(tenant_id),
            "adm": f"ADM-{uuid4().hex[:6]}",
            "pl": __import__("json").dumps(payload),
            "sid": student_id,
        },
    )
    db.commit()
    return eid


def _seed_invoice(
    db: Session,
    *,
    tenant_id,
    enrollment_id,
    total: Decimal,
    paid: Decimal,
    term_number: int | None = None,
    academic_year: int | None = None,
    class_code: str | None = None,
    status: str = "ISSUED",
    invoice_type: str = "SCHOOL_FEES",
) -> str:
    iid = str(uuid4())
    meta = {"class_code": class_code} if class_code else {}
    balance = total - paid
    db.execute(
        sa.text(
            "INSERT INTO core.invoices "
            "(id, tenant_id, enrollment_id, invoice_no, invoice_type, status,"
            " total_amount, paid_amount, balance_amount, term_number,"
            " academic_year, meta) "
            "VALUES (:id, :tid, :eid, :no, :ity, :st, :tot, :paid, :bal,"
            " :tn, :yr, CAST(:meta AS jsonb))"
        ),
        {
            "id": iid,
            "tid": str(tenant_id),
            "eid": enrollment_id,
            "no": f"INV-{uuid4().hex[:8]}",
            "ity": invoice_type,
            "st": status,
            "tot": str(total),
            "paid": str(paid),
            "bal": str(balance),
            "tn": term_number,
            "yr": academic_year,
            "meta": __import__("json").dumps(meta),
        },
    )
    db.commit()
    return iid


def _seed_payment(
    db: Session, *, tenant_id, provider: str, amount: Decimal
) -> str:
    pid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.payments "
            "(id, tenant_id, provider, amount, received_at) "
            "VALUES (:id, :tid, :prov, :amt, NOW())"
        ),
        {"id": pid, "tid": str(tenant_id), "prov": provider, "amt": str(amount)},
    )
    db.commit()
    return pid


# ── Gender normaliser ───────────────────────────────────────────────────────

class TestNormalizeGender:
    def test_male_variants(self):
        for v in ["M", "m", "MALE", "Male", "boy", "BOY"]:
            assert _normalize_gender(v) == "MALE"

    def test_female_variants(self):
        for v in ["F", "f", "FEMALE", "Female", "girl"]:
            assert _normalize_gender(v) == "FEMALE"

    def test_unknown_and_null(self):
        for v in [None, "", "X", "OTHER", "?"]:
            assert _normalize_gender(v) == "UNSPECIFIED"


# ── Demographics ────────────────────────────────────────────────────────────

class TestDemographics:
    def test_empty_tenant_returns_zero_totals(self, db_session: Session):
        tenant = create_tenant(db_session)
        d = get_student_demographics(db_session, tenant_id=tenant.id)
        assert d["total_students"] == 0
        assert d["male_pct"] == 0 and d["female_pct"] == 0

    def test_counts_active_only_and_buckets(self, db_session: Session):
        tenant = create_tenant(db_session)
        for _ in range(3):
            _seed_student(db_session, tenant_id=tenant.id, gender="MALE")
        for _ in range(2):
            _seed_student(db_session, tenant_id=tenant.id, gender="F")
        _seed_student(db_session, tenant_id=tenant.id, gender=None)
        _seed_student(
            db_session, tenant_id=tenant.id, gender="MALE", status="WITHDRAWN"
        )
        d = get_student_demographics(db_session, tenant_id=tenant.id)
        assert d["total_students"] == 6
        assert d["male_count"] == 3
        assert d["female_count"] == 2
        assert d["unspecified_count"] == 1
        assert d["male_pct"] + d["female_pct"] + d["unspecified_pct"] in (99, 100)

    def test_tenant_isolation(self, db_session: Session):
        a = create_tenant(db_session, slug="ta", domain="ta.example.com")
        b = create_tenant(db_session, slug="tb", domain="tb.example.com")
        _seed_student(db_session, tenant_id=a.id, gender="MALE")
        _seed_student(db_session, tenant_id=b.id, gender="FEMALE")
        assert get_student_demographics(db_session, tenant_id=a.id)["male_count"] == 1
        assert get_student_demographics(db_session, tenant_id=a.id)["female_count"] == 0


# ── Current-term selector ───────────────────────────────────────────────────

class TestResolveCurrentTerm:
    def test_picks_term_containing_today(self, db_session: Session):
        tenant = create_tenant(db_session)
        today = date.today()
        # Outdated term
        _seed_term(
            db_session, tenant_id=tenant.id, code="OLD",
            start=today - timedelta(days=200), end=today - timedelta(days=120),
            term_number=1, academic_year=today.year,
        )
        # Current term — should win
        _seed_term(
            db_session, tenant_id=tenant.id, code="NOW",
            start=today - timedelta(days=10), end=today + timedelta(days=30),
            term_number=2, academic_year=today.year,
        )
        # Future term
        _seed_term(
            db_session, tenant_id=tenant.id, code="NEXT",
            start=today + timedelta(days=60), end=today + timedelta(days=120),
            term_number=3, academic_year=today.year,
        )
        row = _resolve_current_term_by_date(db_session, tenant_id=tenant.id)
        assert row is not None and row["code"] == "NOW"

    def test_falls_back_to_most_recent_started(self, db_session: Session):
        tenant = create_tenant(db_session)
        today = date.today()
        _seed_term(
            db_session, tenant_id=tenant.id, code="P1",
            start=today - timedelta(days=200), end=today - timedelta(days=180),
        )
        _seed_term(
            db_session, tenant_id=tenant.id, code="P2",
            start=today - timedelta(days=60), end=today - timedelta(days=30),
        )
        row = _resolve_current_term_by_date(db_session, tenant_id=tenant.id)
        assert row is not None and row["code"] == "P2"

    def test_no_terms_returns_none(self, db_session: Session):
        tenant = create_tenant(db_session)
        assert _resolve_current_term_by_date(db_session, tenant_id=tenant.id) is None


# ── Finance ─────────────────────────────────────────────────────────────────

class TestFinanceBreakdowns:
    def _setup_tenant_with_invoices(self, db_session: Session):
        tenant = create_tenant(db_session)
        today = date.today()
        # Current term
        _seed_term(
            db_session, tenant_id=tenant.id, code="T2",
            start=today - timedelta(days=5), end=today + timedelta(days=60),
            term_number=2, academic_year=today.year,
        )
        # Old term (not current)
        _seed_term(
            db_session, tenant_id=tenant.id, code="T1",
            start=today - timedelta(days=200), end=today - timedelta(days=120),
            term_number=1, academic_year=today.year,
        )

        s1 = _seed_student(db_session, tenant_id=tenant.id, gender="MALE")
        s2 = _seed_student(db_session, tenant_id=tenant.id, gender="FEMALE")
        e1 = _seed_enrollment(
            db_session, tenant_id=tenant.id, student_id=s1, class_code="G4A"
        )
        e2 = _seed_enrollment(
            db_session, tenant_id=tenant.id, student_id=s2, class_code="G5B"
        )

        # Current-term invoices
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=e1,
            total=Decimal("10000"), paid=Decimal("4000"),
            term_number=2, academic_year=today.year, class_code="G4A",
        )
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=e2,
            total=Decimal("8000"), paid=Decimal("8000"),
            term_number=2, academic_year=today.year,
            class_code="G5B", status="PAID",
        )
        # Old-term invoice — counts in all-time and per-term, NOT current term
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=e1,
            total=Decimal("5000"), paid=Decimal("0"),
            term_number=1, academic_year=today.year, class_code="G4A",
        )
        # Cancelled invoice — excluded from everything
        _seed_invoice(
            db_session, tenant_id=tenant.id, enrollment_id=e1,
            total=Decimal("999"), paid=Decimal("0"),
            term_number=2, academic_year=today.year,
            class_code="G4A", status="CANCELLED",
        )
        return tenant

    def test_finance_all_time(self, db_session: Session):
        tenant = self._setup_tenant_with_invoices(db_session)
        f = get_finance_all_time(db_session, tenant_id=tenant.id)
        # 10000 + 8000 + 5000 (cancelled excluded)
        assert f["total_billed"] == 23000.0
        assert f["total_collected"] == 12000.0
        assert f["total_outstanding"] == 11000.0
        assert f["invoice_count"] == 3
        # 12000 / 23000 = 52.17… → 52
        assert f["collection_rate_pct"] == 52

    def test_finance_current_term_uses_structured_keys(self, db_session: Session):
        tenant = self._setup_tenant_with_invoices(db_session)
        current = _resolve_current_term_by_date(db_session, tenant_id=tenant.id)
        assert current and current["code"] == "T2"
        tf = get_finance_current_term(
            db_session, tenant_id=tenant.id, current_term=current
        )
        assert tf is not None
        # Only current-term, non-cancelled invoices: 10000 + 8000
        assert tf["term_billed"] == 18000.0
        assert tf["term_collected"] == 12000.0
        assert tf["term_outstanding"] == 6000.0
        assert tf["term_invoice_count"] == 2
        assert tf["scope"] == "structured"
        assert tf["term_number"] == current["term_number"]

    def test_finance_by_class_and_by_term(self, db_session: Session):
        tenant = self._setup_tenant_with_invoices(db_session)
        per_class = {r["class_code"]: r for r in get_finance_by_class(db_session, tenant_id=tenant.id)}
        assert per_class["G4A"]["billed"] == 15000.0  # 10000 + 5000
        assert per_class["G5B"]["billed"] == 8000.0

        per_term = {(r["academic_year"], r["term_number"]): r
                    for r in get_finance_by_term(db_session, tenant_id=tenant.id)}
        # Both terms represented
        assert len(per_term) == 2

    def test_top_outstanding_orders_by_balance_desc(self, db_session: Session):
        tenant = self._setup_tenant_with_invoices(db_session)
        rows = get_top_outstanding(db_session, tenant_id=tenant.id, limit=10)
        # Only invoices with balance > 0 — student 1 has both 6000 + 5000 = 11000
        assert rows[0]["outstanding"] == 11000.0
        # student 2 fully paid → must not appear
        assert all(r["outstanding"] > 0 for r in rows)

    def test_finance_by_provider(self, db_session: Session):
        tenant = create_tenant(db_session)
        _seed_payment(db_session, tenant_id=tenant.id, provider="mpesa", amount=Decimal("500"))
        _seed_payment(db_session, tenant_id=tenant.id, provider="MPESA", amount=Decimal("1500"))
        _seed_payment(db_session, tenant_id=tenant.id, provider="cash", amount=Decimal("3000"))
        rows = {r["provider"]: r for r in get_finance_by_provider(db_session, tenant_id=tenant.id)}
        assert rows["MPESA"]["payment_count"] == 2
        assert rows["MPESA"]["amount"] == 2000.0
        assert rows["CASH"]["amount"] == 3000.0


# ── Scholarship breakdown ──────────────────────────────────────────────────


class TestScholarshipBreakdown:
    def test_excludes_revoked_from_totals(self, db_session: Session):
        from uuid import uuid4
        tenant = create_tenant(db_session)
        sch_id = str(uuid4())
        db_session.execute(sa.text(
            "INSERT INTO core.scholarships "
            "(id, tenant_id, name, type, value, is_active, covers_carry_forward) "
            "VALUES (:id, :tid, 'Pool', 'FIXED', 20000, TRUE, FALSE)"
        ), {"id": sch_id, "tid": str(tenant.id)})
        # Two students; one ACTIVE, one REVOKED.
        sids = []
        for status in ("ACTIVE", "REVOKED"):
            stu = str(uuid4())
            sids.append(stu)
            db_session.execute(sa.text(
                "INSERT INTO core.students "
                "(id, tenant_id, admission_no, first_name, last_name, status) "
                "VALUES (:id, :tid, :adm, 'X', 'Y', 'ACTIVE')"
            ), {"id": stu, "tid": str(tenant.id),
                "adm": f"A-{uuid4().hex[:4]}"})
            db_session.execute(sa.text(
                "INSERT INTO core.scholarship_allocations "
                "(id, tenant_id, scholarship_id, student_id, amount, reason, status) "
                "VALUES (:id, :tid, :sid, :stu, 5000, 'x', :st)"
            ), {"id": str(uuid4()), "tid": str(tenant.id),
                "sid": sch_id, "stu": stu, "st": status})
        db_session.commit()

        out = get_scholarship_breakdown(db_session, tenant_id=tenant.id)
        # Summary counts only ACTIVE.
        assert out["summary"]["active_allocations"] == 1
        assert out["summary"]["unique_recipients"]  == 1
        assert out["summary"]["total_discount_granted"] == 5000.0
        # Per-scholarship row tracks both buckets.
        row = out["by_scholarship"][0]
        assert row["active_allocations"]  == 1
        assert row["revoked_allocations"] == 1
        assert row["remaining"] == 15000.0  # FIXED only

    def test_remaining_is_none_for_percentage_and_full_waiver(self, db_session: Session):
        from uuid import uuid4
        tenant = create_tenant(db_session)
        for t in ("PERCENTAGE", "FULL_WAIVER"):
            db_session.execute(sa.text(
                "INSERT INTO core.scholarships "
                "(id, tenant_id, name, type, value, is_active, covers_carry_forward) "
                "VALUES (:id, :tid, :nm, :ty, 10, TRUE, FALSE)"
            ), {"id": str(uuid4()), "tid": str(tenant.id),
                "nm": f"S-{t}", "ty": t})
        db_session.commit()
        rows = {r["type"]: r for r in get_scholarship_breakdown(
            db_session, tenant_id=tenant.id)["by_scholarship"]}
        assert rows["PERCENTAGE"]["remaining"] is None
        assert rows["FULL_WAIVER"]["remaining"] is None
