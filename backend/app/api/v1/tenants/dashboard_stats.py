"""Shared dashboard analytics helpers.

Centralises the queries behind the director KPI endpoint and the secretary
dashboard endpoint so demographics, current-term finance, and detailed
finance breakdowns are computed identically for both audiences. Strict
visibility rules are applied at the *caller* level (the secretary endpoint
deliberately drops collected-money aggregates from its payload); this module
is the data layer.
"""
from __future__ import annotations

from datetime import date as _date
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Session


def _dec(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


# ── Demographics ────────────────────────────────────────────────────────────

# Tolerant gender bucketing: real-world data has 'MALE'/'M'/'male'/'Male' all
# coexisting after years of mixed onboarding. Anything else (including NULL
# and 'OTHER') buckets to UNSPECIFIED so the donut never lies by omission.
_MALE_TOKENS = {"M", "MALE", "BOY"}
_FEMALE_TOKENS = {"F", "FEMALE", "GIRL"}


def _normalize_gender(value: Any) -> str:
    if value is None:
        return "UNSPECIFIED"
    s = str(value).strip().upper()
    if s in _MALE_TOKENS:
        return "MALE"
    if s in _FEMALE_TOKENS:
        return "FEMALE"
    return "UNSPECIFIED"


def get_student_demographics(db: Session, *, tenant_id: UUID) -> dict[str, Any]:
    """Tenant-scoped student counts + gender split. Counts active students
    only (status='ACTIVE') because withdrawn/archived rows aren't part of
    the school today."""
    rows = db.execute(
        sa.text(
            """
            SELECT gender
            FROM core.students
            WHERE tenant_id = :tid
              AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
            """
        ),
        {"tid": str(tenant_id)},
    ).all()
    male = 0
    female = 0
    unspecified = 0
    for (g,) in rows:
        bucket = _normalize_gender(g)
        if bucket == "MALE":
            male += 1
        elif bucket == "FEMALE":
            female += 1
        else:
            unspecified += 1
    total = male + female + unspecified
    return {
        "total_students": total,
        "male_count": male,
        "female_count": female,
        "unspecified_count": unspecified,
        "male_pct": int(round(male / total * 100)) if total else 0,
        "female_pct": int(round(female / total * 100)) if total else 0,
        "unspecified_pct": int(round(unspecified / total * 100)) if total else 0,
    }


# ── Current term resolution (by-date) ───────────────────────────────────────

def _resolve_current_term_by_date(
    db: Session, *, tenant_id: UUID, today: Optional[_date] = None
) -> Optional[dict[str, Any]]:
    """Pick the term whose [start_date, end_date] contains today; fall back
    to the most-recently-started; then to the latest created. Returns the
    raw row (id, name, code, start_date, end_date, term_number, academic_year)
    or None when the tenant has no terms.

    This is the authoritative current-term selector for the director KPI's
    'Finance — Current Term' block. Replaces the legacy 'most recent
    is_active' picker which broke during year-end overlaps.
    """
    today_d = today or _date.today()
    rows = db.execute(
        sa.text(
            """
            SELECT id, name, code,
                   CAST(start_date AS TEXT) AS start_date,
                   CAST(end_date AS TEXT)   AS end_date,
                   term_number, academic_year
            FROM core.tenant_terms
            WHERE tenant_id = :tid AND COALESCE(is_active, true) = true
            ORDER BY start_date NULLS LAST, created_at DESC
            """
        ),
        {"tid": str(tenant_id)},
    ).mappings().all()
    if not rows:
        return None

    def _parse(value: Any) -> Optional[_date]:
        if not value:
            return None
        try:
            return _date.fromisoformat(str(value)[:10])
        except Exception:
            return None

    # 1) Term whose [start,end] covers today.
    for r in rows:
        start = _parse(r.get("start_date"))
        end = _parse(r.get("end_date"))
        if start and end and start <= today_d <= end:
            return dict(r)
    # 2) Most recently started.
    started = [(_parse(r.get("start_date")), dict(r)) for r in rows]
    started_only = [(d, r) for (d, r) in started if d and d <= today_d]
    if started_only:
        return max(started_only, key=lambda x: x[0])[1]
    # 3) Latest created.
    return dict(rows[0])


# ── Finance aggregates ──────────────────────────────────────────────────────

def get_finance_all_time(db: Session, *, tenant_id: UUID) -> dict[str, Any]:
    """All-time finance KPIs. Returns Decimal-as-float for JSON-friendly
    serialisation (matches the existing /director/kpis shape)."""
    fin = db.execute(
        sa.text(
            """
            SELECT
                COALESCE(SUM(total_amount), 0)   AS total_billed,
                COALESCE(SUM(paid_amount), 0)    AS total_collected,
                COALESCE(SUM(balance_amount), 0) AS total_outstanding,
                COUNT(*)                          AS invoice_count
            FROM core.invoices
            WHERE tenant_id = :tid AND status != 'CANCELLED'
            """
        ),
        {"tid": str(tenant_id)},
    ).mappings().first()
    pay_count = db.execute(
        sa.text("SELECT COUNT(*) FROM core.payments WHERE tenant_id = :tid"),
        {"tid": str(tenant_id)},
    ).scalar() or 0
    tb = _dec(fin["total_billed"])
    tc = _dec(fin["total_collected"])
    return {
        "total_billed": float(tb),
        "total_collected": float(tc),
        "total_outstanding": float(_dec(fin["total_outstanding"])),
        "invoice_count": int(fin["invoice_count"] or 0),
        "collection_rate_pct": int(tc / tb * 100) if tb > 0 else 0,
        "payment_count": int(pay_count),
    }


def get_finance_current_term(
    db: Session, *, tenant_id: UUID, current_term: Optional[dict[str, Any]]
) -> Optional[dict[str, Any]]:
    """Finance KPIs scoped to the *actual* current term by-date.

    Uses term_number + academic_year to filter invoices when available
    (correct), and falls back to start_date/end_date windowing on
    created_at when the term hasn't been tagged with the structured
    identity yet (legacy compatibility for tenants pre-Phase B).
    """
    if not current_term:
        return None

    term_number = current_term.get("term_number")
    academic_year = current_term.get("academic_year")

    if term_number is not None and academic_year is not None:
        tf = db.execute(
            sa.text(
                """
                SELECT
                    COALESCE(SUM(total_amount), 0)   AS term_billed,
                    COALESCE(SUM(paid_amount), 0)    AS term_collected,
                    COALESCE(SUM(balance_amount), 0) AS term_outstanding,
                    COUNT(*)                          AS term_invoice_count
                FROM core.invoices
                WHERE tenant_id = :tid
                  AND status != 'CANCELLED'
                  AND invoice_type = 'SCHOOL_FEES'
                  AND term_number = :tn
                  AND academic_year = :yr
                """
            ),
            {"tid": str(tenant_id), "tn": int(term_number), "yr": int(academic_year)},
        ).mappings().first()
        scope = "structured"
    else:
        # Legacy fallback: window by created_at against the term's date range.
        start = current_term.get("start_date")
        end = current_term.get("end_date")
        if not start:
            return None
        tf = db.execute(
            sa.text(
                """
                SELECT
                    COALESCE(SUM(total_amount), 0)   AS term_billed,
                    COALESCE(SUM(paid_amount), 0)    AS term_collected,
                    COALESCE(SUM(balance_amount), 0) AS term_outstanding,
                    COUNT(*)                          AS term_invoice_count
                FROM core.invoices
                WHERE tenant_id = :tid
                  AND status != 'CANCELLED'
                  AND created_at >= :start
                  AND (:end IS NULL OR created_at <= :end)
                """
            ),
            {"tid": str(tenant_id), "start": start, "end": end},
        ).mappings().first()
        scope = "created_at_window"

    tb = _dec(tf["term_billed"])
    tc = _dec(tf["term_collected"])
    return {
        "term_billed": float(tb),
        "term_collected": float(tc),
        "term_outstanding": float(_dec(tf["term_outstanding"])),
        "term_invoice_count": int(tf["term_invoice_count"] or 0),
        "term_collection_rate_pct": int(tc / tb * 100) if tb > 0 else 0,
        "term_name": current_term.get("name"),
        "term_code": current_term.get("code"),
        "term_number": term_number,
        "academic_year": academic_year,
        "scope": scope,
    }


def get_finance_by_class(db: Session, *, tenant_id: UUID) -> list[dict[str, Any]]:
    """Per-class billed / collected / outstanding for SCHOOL_FEES invoices.
    Class is resolved from invoice.meta->>'class_code' first (set by the v2
    generator), falling back to the enrollment payload."""
    rows = db.execute(
        sa.text(
            """
            SELECT
                COALESCE(
                    i.meta->>'class_code',
                    e.payload->>'class_code',
                    e.payload->>'admission_class',
                    'UNCATEGORISED'
                ) AS class_code,
                COALESCE(SUM(i.total_amount), 0)   AS billed,
                COALESCE(SUM(i.paid_amount), 0)    AS collected,
                COALESCE(SUM(i.balance_amount), 0) AS outstanding,
                COUNT(*)                            AS invoice_count
            FROM core.invoices i
            LEFT JOIN core.enrollments e ON e.id = i.enrollment_id
            WHERE i.tenant_id = :tid
              AND i.status != 'CANCELLED'
              AND i.invoice_type = 'SCHOOL_FEES'
            GROUP BY 1
            ORDER BY 1 ASC
            """
        ),
        {"tid": str(tenant_id)},
    ).mappings().all()
    return [
        {
            "class_code": r["class_code"],
            "billed": float(_dec(r["billed"])),
            "collected": float(_dec(r["collected"])),
            "outstanding": float(_dec(r["outstanding"])),
            "invoice_count": int(r["invoice_count"] or 0),
        }
        for r in rows
    ]


def get_finance_by_term(db: Session, *, tenant_id: UUID) -> list[dict[str, Any]]:
    """Per-(academic_year, term_number) breakdown of SCHOOL_FEES invoices.
    Excludes legacy rows missing term_number/academic_year — those land
    under all-time but not in this chart."""
    rows = db.execute(
        sa.text(
            """
            SELECT academic_year, term_number,
                   COALESCE(SUM(total_amount), 0)   AS billed,
                   COALESCE(SUM(paid_amount), 0)    AS collected,
                   COALESCE(SUM(balance_amount), 0) AS outstanding,
                   COUNT(*)                          AS invoice_count
            FROM core.invoices
            WHERE tenant_id = :tid
              AND status != 'CANCELLED'
              AND invoice_type = 'SCHOOL_FEES'
              AND term_number IS NOT NULL
              AND academic_year IS NOT NULL
            GROUP BY academic_year, term_number
            ORDER BY academic_year ASC, term_number ASC
            """
        ),
        {"tid": str(tenant_id)},
    ).mappings().all()
    return [
        {
            "academic_year": int(r["academic_year"]),
            "term_number": int(r["term_number"]),
            "label": f"Term {r['term_number']} {r['academic_year']}",
            "billed": float(_dec(r["billed"])),
            "collected": float(_dec(r["collected"])),
            "outstanding": float(_dec(r["outstanding"])),
            "invoice_count": int(r["invoice_count"] or 0),
        }
        for r in rows
    ]


def get_finance_by_provider(db: Session, *, tenant_id: UUID) -> list[dict[str, Any]]:
    """Per-payment-provider totals (M-PESA / Cash / Bank / Cheque).
    Counts only payments themselves (not invoice paid_amount) so this is
    the authoritative 'where the money came in from' view."""
    rows = db.execute(
        sa.text(
            """
            SELECT COALESCE(UPPER(provider), 'OTHER') AS provider,
                   COUNT(*)                            AS payment_count,
                   COALESCE(SUM(amount), 0)            AS amount
            FROM core.payments
            WHERE tenant_id = :tid
            GROUP BY 1
            ORDER BY amount DESC
            """
        ),
        {"tid": str(tenant_id)},
    ).mappings().all()
    return [
        {
            "provider": r["provider"],
            "payment_count": int(r["payment_count"] or 0),
            "amount": float(_dec(r["amount"])),
        }
        for r in rows
    ]


def get_top_outstanding(
    db: Session, *, tenant_id: UUID, limit: int = 20
) -> list[dict[str, Any]]:
    """Students with the largest outstanding balance across all their
    non-cancelled SCHOOL_FEES invoices. Drives the director's collections
    follow-up list."""
    rows = db.execute(
        sa.text(
            """
            SELECT
                COALESCE(s.id, e.student_id)  AS student_id,
                COALESCE(
                    NULLIF(TRIM(s.first_name || ' ' || COALESCE(s.last_name, '')), ''),
                    e.payload->>'student_name',
                    e.payload->>'studentName',
                    'Unknown student'
                ) AS student_name,
                COALESCE(s.admission_no, e.admission_number) AS admission_no,
                COALESCE(
                    e.payload->>'class_code',
                    e.payload->>'admission_class'
                ) AS class_code,
                COALESCE(SUM(i.balance_amount), 0) AS outstanding,
                COUNT(*) AS invoice_count
            FROM core.invoices i
            JOIN core.enrollments e ON e.id = i.enrollment_id
            LEFT JOIN core.students s ON s.id = e.student_id
            WHERE i.tenant_id = :tid
              AND i.status != 'CANCELLED'
              AND i.invoice_type = 'SCHOOL_FEES'
              AND i.balance_amount > 0
            GROUP BY 1, 2, 3, 4
            ORDER BY outstanding DESC
            LIMIT :limit
            """
        ),
        {"tid": str(tenant_id), "limit": int(limit)},
    ).mappings().all()
    return [
        {
            "student_id": str(r["student_id"]) if r["student_id"] else None,
            "student_name": str(r["student_name"] or "Unknown student"),
            "admission_no": r["admission_no"],
            "class_code": r["class_code"],
            "outstanding": float(_dec(r["outstanding"])),
            "invoice_count": int(r["invoice_count"] or 0),
        }
        for r in rows
    ]


# ── Scholarship analytics ──────────────────────────────────────────────────


def get_scholarship_breakdown(
    db: Session, *, tenant_id: UUID, top_beneficiaries_limit: int = 10,
) -> dict[str, Any]:
    """Director-grade scholarship visibility for the all-time finance KPI
    and the CSV/PDF report.

    Counts only ACTIVE rows across allocations + grants — REVOKED rows are
    the audit trail and don't represent live commitments. Includes the
    Phase M2 grant view (student-level attachment) alongside the existing
    per-invoice allocation view.

    Returns:
      summary — totals across the tenant
      by_scholarship — per-scholarship row, sorted by allocated desc
      top_beneficiaries — top-N students by ACTIVE allocation total
        (drives director's "who's on the biggest bursary" view)
    """
    totals = db.execute(
        sa.text("""
            SELECT
                COALESCE(SUM(amount), 0)                  AS total_discount,
                COUNT(*)                                   AS allocation_count,
                COUNT(DISTINCT student_id)
                    FILTER (WHERE student_id IS NOT NULL) AS unique_recipients
            FROM core.scholarship_allocations
            WHERE tenant_id = :tid AND status = 'ACTIVE'
        """),
        {"tid": str(tenant_id)},
    ).mappings().first()

    active_scholarships = db.execute(
        sa.text("""
            SELECT COUNT(*) FROM core.scholarships
            WHERE tenant_id = :tid AND is_active = TRUE
        """),
        {"tid": str(tenant_id)},
    ).scalar() or 0

    # Phase M2: student-level grants live independently of allocations.
    # A student may hold an ACTIVE grant that hasn't yet produced an
    # allocation (e.g. no invoice this term yet) — we report both counts
    # so the director can see forward-looking commitments as well.
    grant_totals = db.execute(
        sa.text("""
            SELECT
                COUNT(*)                                   AS active_grants,
                COUNT(DISTINCT student_id)                 AS unique_grant_recipients
            FROM core.student_scholarship_grants
            WHERE tenant_id = :tid AND status = 'ACTIVE'
        """),
        {"tid": str(tenant_id)},
    ).mappings().first()

    by_sch = db.execute(
        sa.text("""
            SELECT
                s.id            AS scholarship_id,
                s.name          AS name,
                s.type          AS type,
                s.value         AS budget,
                s.max_recipients,
                s.is_active,
                s.covers_carry_forward,
                COALESCE(SUM(sa.amount) FILTER (WHERE sa.status='ACTIVE'), 0) AS allocated,
                COUNT(DISTINCT sa.student_id)
                    FILTER (WHERE sa.status='ACTIVE' AND sa.student_id IS NOT NULL)
                                                          AS unique_recipients,
                COUNT(*) FILTER (WHERE sa.status='ACTIVE') AS active_allocations,
                COUNT(*) FILTER (WHERE sa.status='REVOKED') AS revoked_allocations,
                COALESCE((
                    SELECT COUNT(*)
                    FROM core.student_scholarship_grants g
                    WHERE g.scholarship_id = s.id
                      AND g.tenant_id      = s.tenant_id
                      AND g.status         = 'ACTIVE'
                ), 0)                                       AS active_grants
            FROM core.scholarships s
            LEFT JOIN core.scholarship_allocations sa
                   ON sa.scholarship_id = s.id
                  AND sa.tenant_id = s.tenant_id
            WHERE s.tenant_id = :tid
            GROUP BY s.id
            ORDER BY allocated DESC, s.name ASC
        """),
        {"tid": str(tenant_id)},
    ).mappings().all()

    rows: list[dict[str, Any]] = []
    for r in by_sch:
        budget = _dec(r["budget"])
        allocated = _dec(r["allocated"])
        # `remaining` only meaningful for FIXED — percentage and full-waiver
        # have no monetary cap; UI uses recipient count instead.
        remaining = None
        if (r["type"] or "").upper() == "FIXED":
            remaining = float(max(Decimal("0"), budget - allocated))
        rows.append({
            "scholarship_id": str(r["scholarship_id"]),
            "name": r["name"] or "",
            "type": r["type"] or "",
            "budget": float(budget),
            "allocated": float(allocated),
            "remaining": remaining,
            "max_recipients": int(r["max_recipients"]) if r["max_recipients"] is not None else None,
            "unique_recipients": int(r["unique_recipients"] or 0),
            "active_allocations": int(r["active_allocations"] or 0),
            "revoked_allocations": int(r["revoked_allocations"] or 0),
            "active_grants": int(r["active_grants"] or 0),
            "is_active": bool(r["is_active"]),
            "covers_carry_forward": bool(r["covers_carry_forward"]),
        })

    # Top-N beneficiaries by ACTIVE allocation total. Uses batch student-
    # identity join so we get real names even for legacy enrollment-only
    # rows.
    top_rows = db.execute(
        sa.text("""
            SELECT
                sa.student_id,
                COALESCE(
                    NULLIF(TRIM(st.first_name || ' ' || COALESCE(st.last_name, '')), ''),
                    'Unknown student'
                )                                          AS student_name,
                COALESCE(st.admission_no, '')              AS admission_no,
                COALESCE(SUM(sa.amount), 0)                AS total_allocated,
                COUNT(*)                                    AS allocation_count,
                COUNT(DISTINCT sa.scholarship_id)          AS scholarship_count,
                (SELECT COUNT(*)
                 FROM core.student_scholarship_grants g
                 WHERE g.tenant_id = :tid
                   AND g.student_id = sa.student_id
                   AND g.status = 'ACTIVE')                AS active_grants
            FROM core.scholarship_allocations sa
            LEFT JOIN core.students st
                   ON st.id = sa.student_id
                  AND st.tenant_id = sa.tenant_id
            WHERE sa.tenant_id = :tid
              AND sa.status = 'ACTIVE'
              AND sa.student_id IS NOT NULL
            GROUP BY sa.student_id, st.first_name, st.last_name, st.admission_no
            ORDER BY total_allocated DESC
            LIMIT :lim
        """),
        {"tid": str(tenant_id), "lim": int(top_beneficiaries_limit)},
    ).mappings().all()

    top_beneficiaries = [
        {
            "student_id":        str(r["student_id"]),
            "student_name":      r["student_name"] or "Unknown student",
            "admission_no":      r["admission_no"] or "",
            "total_allocated":   float(_dec(r["total_allocated"])),
            "allocation_count":  int(r["allocation_count"] or 0),
            "scholarship_count": int(r["scholarship_count"] or 0),
            "active_grants":     int(r["active_grants"] or 0),
        }
        for r in top_rows
    ]

    return {
        "summary": {
            "total_discount_granted":  float(_dec(totals["total_discount"])),
            "active_allocations":      int(totals["allocation_count"] or 0),
            "unique_recipients":       int(totals["unique_recipients"] or 0),
            "active_scholarships":     int(active_scholarships),
            "active_grants":           int(grant_totals["active_grants"] or 0),
            "unique_grant_recipients": int(grant_totals["unique_grant_recipients"] or 0),
        },
        "by_scholarship":     rows,
        "top_beneficiaries":  top_beneficiaries,
    }
