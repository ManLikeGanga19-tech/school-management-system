"""Director KPI aggregation endpoint.

GET /director/kpis  — returns all dashboard numbers in one DB round-trip.
Replaces the previous pattern of fetching full invoice/enrollment arrays and
summing them client-side, which breaks at scale.
"""
from __future__ import annotations

from decimal import Decimal

import sqlalchemy as sa
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db, get_tenant, require_permission

router = APIRouter()

_PERM = "admin.dashboard.view_tenant"


def _dec(v: object) -> Decimal:
    return Decimal(str(v)) if v is not None else Decimal("0")


@router.get("/kpis")
def get_director_kpis(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission(_PERM)),
    user=Depends(get_current_user),
):
    tid = str(tenant.id)

    # ── Finance: all-time aggregation ─────────────────────────────────────
    fin = db.execute(sa.text("""
        SELECT
            COALESCE(SUM(total_amount),   0) AS total_billed,
            COALESCE(SUM(paid_amount),    0) AS total_collected,
            COALESCE(SUM(balance_amount), 0) AS total_outstanding,
            COUNT(*)                          AS invoice_count
        FROM core.invoices
        WHERE tenant_id = :tid
    """), {"tid": tid}).mappings().first()

    pay_count = db.execute(sa.text(
        "SELECT COUNT(*) FROM core.payments WHERE tenant_id = :tid"
    ), {"tid": tid}).scalar() or 0

    # ── Active term ────────────────────────────────────────────────────────
    term = db.execute(sa.text("""
        SELECT id, name, code, start_date, end_date
        FROM core.tenant_terms
        WHERE tenant_id = :tid AND is_active = true
        ORDER BY created_at DESC
        LIMIT 1
    """), {"tid": tid}).mappings().first()

    # ── Finance: current term window ──────────────────────────────────────
    term_finance = None
    if term and term["start_date"]:
        tf = db.execute(sa.text("""
            SELECT
                COALESCE(SUM(total_amount),   0) AS term_billed,
                COALESCE(SUM(paid_amount),    0) AS term_collected,
                COALESCE(SUM(balance_amount), 0) AS term_outstanding,
                COUNT(*)                          AS term_invoice_count
            FROM core.invoices
            WHERE tenant_id = :tid
              AND created_at >= :start
              AND (:end IS NULL OR created_at <= :end)
        """), {
            "tid": tid,
            "start": term["start_date"],
            "end": term["end_date"],
        }).mappings().first()

        tb = _dec(tf["term_billed"])
        tc = _dec(tf["term_collected"])
        term_finance = {
            "term_billed":            float(tb),
            "term_collected":         float(tc),
            "term_outstanding":       float(_dec(tf["term_outstanding"])),
            "term_collection_rate_pct": int(tc / tb * 100) if tb > 0 else 0,
            "term_invoice_count":     int(tf["term_invoice_count"] or 0),
        }

    # ── Enrollments by status ─────────────────────────────────────────────
    enr_rows = db.execute(sa.text("""
        SELECT UPPER(status) AS status, COUNT(*) AS cnt
        FROM core.enrollments
        WHERE tenant_id = :tid
        GROUP BY status
    """), {"tid": tid}).mappings().all()

    by_status: dict[str, int] = {r["status"]: int(r["cnt"]) for r in enr_rows}
    total_enrolled  = by_status.get("ENROLLED", 0)
    pending_intake  = by_status.get("SUBMITTED", 0) + by_status.get("APPROVED", 0)

    # ── School meta (single subquery pass) ───────────────────────────────
    meta = db.execute(sa.text("""
        SELECT
            (SELECT COUNT(*) FROM core.user_tenants
             WHERE tenant_id = :tid)                              AS total_users,
            (SELECT COUNT(*) FROM core.user_roles
             WHERE tenant_id = :tid)                              AS total_roles,
            (SELECT COUNT(*) FROM core.audit_logs
             WHERE tenant_id = :tid)                              AS total_audit_logs,
            (SELECT COUNT(*) FROM core.fee_categories
             WHERE tenant_id = :tid AND is_active = true)         AS fee_categories,
            (SELECT COUNT(*) FROM core.fee_items fi
             JOIN core.fee_categories fc ON fc.id = fi.category_id
             WHERE fc.tenant_id = :tid AND fi.is_active = true)   AS fee_items
    """), {"tid": tid}).mappings().first()

    # ── Recent 5 payments (with student name from enrollment payload) ─────
    recent_rows = db.execute(sa.text("""
        SELECT
            p.id                               AS payment_id,
            p.provider,
            p.reference,
            p.receipt_no,
            p.amount,
            p.received_at,
            MIN(e.payload->>'student_name')    AS student_name
        FROM core.payments p
        LEFT JOIN core.payment_allocations pa ON pa.payment_id = p.id
        LEFT JOIN core.invoices i             ON i.id = pa.invoice_id
        LEFT JOIN core.enrollments e          ON e.id = i.enrollment_id
        WHERE p.tenant_id = :tid
        GROUP BY p.id, p.provider, p.reference, p.receipt_no, p.amount, p.received_at
        ORDER BY p.received_at DESC
        LIMIT 5
    """), {"tid": tid}).mappings().all()

    # ── Assemble response ─────────────────────────────────────────────────
    total_billed    = _dec(fin["total_billed"])
    total_collected = _dec(fin["total_collected"])
    collection_rate = int(total_collected / total_billed * 100) if total_billed > 0 else 0

    return {
        "finance": {
            "total_billed":         float(total_billed),
            "total_collected":      float(total_collected),
            "total_outstanding":    float(_dec(fin["total_outstanding"])),
            "collection_rate_pct":  collection_rate,
            "invoice_count":        int(fin["invoice_count"] or 0),
            "payment_count":        int(pay_count),
        },
        "term_finance": term_finance,
        "enrollments": {
            "total_enrolled":   total_enrolled,
            "pending_intake":   pending_intake,
            "by_status":        by_status,
        },
        "school": {
            "total_users":       int(meta["total_users"]       or 0),
            "total_roles":       int(meta["total_roles"]       or 0),
            "total_audit_logs":  int(meta["total_audit_logs"]  or 0),
            "fee_categories":    int(meta["fee_categories"]    or 0),
            "fee_items":         int(meta["fee_items"]         or 0),
        },
        "active_term": {
            "id":   str(term["id"]),
            "name": term["name"],
            "code": term["code"],
        } if term else None,
        "recent_payments": [
            {
                "payment_id":  str(r["payment_id"]),
                "provider":    r["provider"],
                "reference":   r["reference"],
                "receipt_no":  r["receipt_no"],
                "amount":      float(r["amount"]),
                "received_at": r["received_at"].isoformat() if r["received_at"] else None,
                "student_name": r["student_name"],
            }
            for r in recent_rows
        ],
    }
