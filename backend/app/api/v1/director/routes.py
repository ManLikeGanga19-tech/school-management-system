"""Director KPI aggregation endpoint.

GET /director/kpis  — returns all dashboard numbers in one DB round-trip.
Replaces the previous pattern of fetching full invoice/enrollment arrays and
summing them client-side, which breaks at scale.
"""
from __future__ import annotations

from decimal import Decimal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.v1.director.finance_export import (
    build_finance_report_bundle,
    build_finance_report_csv,
    build_finance_report_pdf,
)
from app.api.v1.finance.service import get_tenant_print_profile
from app.api.v1.tenants.dashboard_today import get_today_at_school
from app.core.audit import log_event
from app.api.v1.tenants.dashboard_stats import (
    _resolve_current_term_by_date,
    get_finance_all_time,
    get_finance_by_class,
    get_finance_by_provider,
    get_finance_by_term,
    get_finance_current_term,
    get_student_demographics,
    get_top_outstanding,
)
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

    # ── Finance: all-time + current term (shared helpers) ────────────────
    # Shared with secretary dashboard so the numbers agree; secretary
    # endpoint just hides the collected/billed aggregates on its way out.
    finance = get_finance_all_time(db, tenant_id=tenant.id)
    current_term = _resolve_current_term_by_date(db, tenant_id=tenant.id)
    term_finance = get_finance_current_term(
        db, tenant_id=tenant.id, current_term=current_term
    )

    # ── Demographics + detailed finance breakdowns ───────────────────────
    demographics = get_student_demographics(db, tenant_id=tenant.id)
    finance_breakdowns = {
        "by_class":     get_finance_by_class(db, tenant_id=tenant.id),
        "by_term":      get_finance_by_term(db, tenant_id=tenant.id),
        "by_provider":  get_finance_by_provider(db, tenant_id=tenant.id),
        "top_outstanding": get_top_outstanding(db, tenant_id=tenant.id, limit=20),
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
    return {
        "finance": finance,
        "term_finance": term_finance,
        "finance_breakdowns": finance_breakdowns,
        "demographics": demographics,
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
            "id":            str(current_term["id"]),
            "name":          current_term["name"],
            "code":          current_term["code"],
            "term_number":   current_term.get("term_number"),
            "academic_year": current_term.get("academic_year"),
        } if current_term else None,
        # Today's term context + every event (school-calendar + general)
        # overlapping today, used by the dashboard 'Today at School' card.
        # Uses by-date current-term selection (not 'latest is_active'), so
        # year-end overlap is handled correctly.
        "today_at_school": get_today_at_school(db, tenant_id=tenant.id),
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


@router.get("/group-dashboard")
def get_group_dashboard(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission(_PERM)),
    user=Depends(get_current_user),
):
    """Consolidated KPIs across every campus in the current tenant's group.

    Returns ``grouped: false`` when the tenant is standalone.
    """
    from datetime import date as _date
    from app.models.tenant_group import TenantGroup
    from app.core.subscription import _state_from_tier

    group_id = getattr(tenant, "group_id", None)
    if group_id is None:
        return {"grouped": False}

    group = db.get(TenantGroup, group_id)
    if group is None:
        return {"grouped": False}

    rows = db.execute(sa.text("""
        SELECT
            t.id   AS tenant_id,
            t.name AS name,
            t.slug AS slug,
            COALESCE((SELECT COUNT(*) FROM core.students s WHERE s.tenant_id = t.id), 0) AS students,
            COALESCE((SELECT SUM(total_amount)   FROM core.invoices i WHERE i.tenant_id = t.id), 0) AS billed,
            COALESCE((SELECT SUM(paid_amount)    FROM core.invoices i WHERE i.tenant_id = t.id), 0) AS collected,
            COALESCE((SELECT SUM(balance_amount) FROM core.invoices i WHERE i.tenant_id = t.id), 0) AS outstanding
        FROM core.tenants t
        WHERE t.group_id = :gid AND t.deleted_at IS NULL
        ORDER BY t.name ASC
    """), {"gid": str(group_id)}).mappings().all()

    campuses = []
    tot_students = 0
    tot_billed = Decimal("0")
    tot_collected = Decimal("0")
    tot_outstanding = Decimal("0")
    for r in rows:
        billed = _dec(r["billed"])
        collected = _dec(r["collected"])
        outstanding = _dec(r["outstanding"])
        students = int(r["students"] or 0)
        tot_students += students
        tot_billed += billed
        tot_collected += collected
        tot_outstanding += outstanding
        campuses.append({
            "tenant_id":   str(r["tenant_id"]),
            "name":        r["name"],
            "slug":        r["slug"],
            "students":    students,
            "billed":      float(billed),
            "collected":   float(collected),
            "outstanding": float(outstanding),
            "collection_rate_pct": (
                int(collected / billed * 100) if billed > 0 else 0
            ),
        })

    state = _state_from_tier(
        db, plan_code=group.plan_code, period_end=group.period_end,
        status=None, today=_date.today(),
    )

    return {
        "grouped": True,
        "group": {
            "name":        group.name,
            "slug":        group.slug,
            "plan_name":   state.plan_name,
            "state":       state.state,
            "period_end":  group.period_end.isoformat() if group.period_end else None,
        },
        "totals": {
            "campuses":    len(campuses),
            "students":    tot_students,
            "billed":      float(tot_billed),
            "collected":   float(tot_collected),
            "outstanding": float(tot_outstanding),
            "collection_rate_pct": (
                int(tot_collected / tot_billed * 100) if tot_billed > 0 else 0
            ),
        },
        "campuses": campuses,
    }


# ── Finance report exports (CSV + branded PDF) ─────────────────────────────

_EXPORT_PERM = "finance.invoices.view"


def _emit_export_audit(
    db: Session, *, tenant_id, actor_user_id, scope: str, fmt: str
) -> None:
    try:
        log_event(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            action="finance.report.export",
            resource="director.finance_report",
            meta={"scope": scope, "format": fmt},
        )
        db.commit()
    except Exception:
        db.rollback()


@router.get("/finance/export.csv")
def export_finance_csv(
    scope: str = "all-time",
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
    _=Depends(require_permission(_EXPORT_PERM)),
):
    if scope != "all-time":
        raise HTTPException(400, "Unsupported scope")
    bundle = build_finance_report_bundle(db, tenant_id=tenant.id)
    school = getattr(tenant, "name", None) or getattr(tenant, "slug", "School")
    body = build_finance_report_csv(bundle, school_name=str(school))
    _emit_export_audit(
        db, tenant_id=tenant.id,
        actor_user_id=getattr(user, "id", None),
        scope=scope, fmt="csv",
    )
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="finance-all-time.csv"'},
    )


@router.get("/finance/export.pdf")
def export_finance_pdf(
    scope: str = "all-time",
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
    _=Depends(require_permission(_EXPORT_PERM)),
):
    if scope != "all-time":
        raise HTTPException(400, "Unsupported scope")
    bundle = build_finance_report_bundle(db, tenant_id=tenant.id)
    profile = get_tenant_print_profile(db, tenant_id=tenant.id)
    body = build_finance_report_pdf(bundle, profile=profile)
    _emit_export_audit(
        db, tenant_id=tenant.id,
        actor_user_id=getattr(user, "id", None),
        scope=scope, fmt="pdf",
    )
    return Response(
        content=body,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="finance-all-time.pdf"'},
    )
