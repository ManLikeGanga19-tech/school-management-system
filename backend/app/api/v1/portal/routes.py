"""Parent-facing read-only portal routes.

All routes require the caller to be authenticated and have a parent record
with user_id == current_user.id.  The role check (PARENT) is handled by
the JWT scope gate at the tenant level; here we additionally verify the
parent record exists.
"""
from __future__ import annotations

from uuid import UUID

import sqlalchemy as sa
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db, get_tenant
from app.models.parent import Parent

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _require_parent(db: Session, tenant_id: UUID, user_id: UUID) -> Parent:
    p = (
        db.query(Parent)
        .filter(
            Parent.tenant_id == tenant_id,
            Parent.user_id == user_id,
            Parent.is_active.is_(True),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=403, detail="No parent record linked to this account")
    return p


def _outstanding_for_enrollment(db: Session, tenant_id: UUID, enrollment_id: UUID) -> Decimal:
    row = db.execute(
        sa.text("""
            SELECT COALESCE(SUM(balance_amount), 0) AS bal
            FROM core.invoices
            WHERE tenant_id = :tid
              AND enrollment_id = :eid
              AND balance_amount > 0
        """),
        {"tid": str(tenant_id), "eid": str(enrollment_id)},
    ).mappings().first()
    return Decimal(str(row["bal"] or 0)) if row else Decimal("0")


def _student_name(payload: dict) -> str:
    return (
        payload.get("student_name")
        or payload.get("full_name")
        or f"{payload.get('first_name', '')} {payload.get('last_name', '')}".strip()
        or "Unknown"
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET /portal/me — parent profile + children summary
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/me")
def get_me(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    parent = _require_parent(db, tenant.id, user.id)

    links = db.execute(
        sa.text("""
            SELECT
                pel.id          AS link_id,
                pel.enrollment_id,
                pel.relationship,
                e.payload,
                e.status        AS enr_status
            FROM core.parent_enrollment_links pel
            JOIN core.enrollments e ON e.id = pel.enrollment_id
            WHERE pel.parent_id = :pid AND pel.tenant_id = :tid
            ORDER BY pel.is_primary DESC, pel.created_at
        """),
        {"pid": str(parent.id), "tid": str(tenant.id)},
    ).mappings().all()

    children = []
    total_outstanding = Decimal("0")
    for lnk in links:
        payload = dict(lnk["payload"] or {})
        eid = UUID(str(lnk["enrollment_id"]))
        outstanding = _outstanding_for_enrollment(db, tenant.id, eid)
        total_outstanding += outstanding
        children.append({
            "link_id": str(lnk["link_id"]),
            "enrollment_id": str(eid),
            "student_name": _student_name(payload),
            "class_code": payload.get("class_code") or payload.get("admission_class") or "",
            "admission_number": payload.get("admission_number"),
            "relationship": lnk["relationship"],
            "enrollment_status": lnk["enr_status"],
            "outstanding": float(outstanding),
        })

    return {
        "id": str(parent.id),
        "first_name": parent.first_name or "",
        "last_name": parent.last_name or "",
        "name": f"{parent.first_name or ''} {parent.last_name or ''}".strip(),
        "phone": parent.phone or "",
        "email": parent.email,
        "school_name": tenant.name,
        "children": children,
        "outstanding_total": float(total_outstanding),
        "child_count": len(children),
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /portal/invoices — all outstanding invoices across linked children
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/invoices")
def get_invoices(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    parent = _require_parent(db, tenant.id, user.id)

    rows = db.execute(
        sa.text("""
            SELECT
                inv.id          AS invoice_id,
                inv.enrollment_id,
                inv.invoice_type,
                inv.invoice_no,
                inv.status,
                inv.term_number,
                inv.academic_year,
                inv.total_amount,
                inv.paid_amount,
                inv.balance_amount,
                inv.created_at,
                e.payload
            FROM core.parent_enrollment_links pel
            JOIN core.invoices inv
                ON inv.enrollment_id = pel.enrollment_id
               AND inv.tenant_id = :tid
            JOIN core.enrollments e
                ON e.id = pel.enrollment_id
            WHERE pel.parent_id = :pid AND pel.tenant_id = :tid
            ORDER BY inv.balance_amount DESC, inv.created_at ASC
        """),
        {"pid": str(parent.id), "tid": str(tenant.id)},
    ).mappings().all()

    result = []
    for r in rows:
        payload = dict(r["payload"] or {})
        result.append({
            "invoice_id": str(r["invoice_id"]),
            "enrollment_id": str(r["enrollment_id"]),
            "student_name": _student_name(payload),
            "class_code": payload.get("class_code") or "",
            "invoice_type": r["invoice_type"],
            "invoice_no": r["invoice_no"],
            "status": r["status"],
            "term_number": r["term_number"],
            "academic_year": r["academic_year"],
            "total_amount": float(r["total_amount"] or 0),
            "paid_amount": float(r["paid_amount"] or 0),
            "balance_amount": float(r["balance_amount"] or 0),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        })
    return result


# ─────────────────────────────────────────────────────────────────────────────
# GET /portal/payments — recent payment history for all linked children
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/payments")
def get_payments(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    parent = _require_parent(db, tenant.id, user.id)

    rows = db.execute(
        sa.text("""
            SELECT DISTINCT
                pay.id,
                pay.receipt_no,
                pay.provider,
                pay.reference,
                pay.amount,
                pay.received_at,
                e.payload
            FROM core.parent_enrollment_links pel
            JOIN core.invoices inv
                ON inv.enrollment_id = pel.enrollment_id
               AND inv.tenant_id = :tid
            JOIN core.payment_allocations pa ON pa.invoice_id = inv.id
            JOIN core.payments pay ON pay.id = pa.payment_id
            JOIN core.enrollments e ON e.id = inv.enrollment_id
            WHERE pel.parent_id = :pid AND pel.tenant_id = :tid
            ORDER BY pay.received_at DESC
            LIMIT 50
        """),
        {"pid": str(parent.id), "tid": str(tenant.id)},
    ).mappings().all()

    result = []
    for r in rows:
        payload = dict(r["payload"] or {})
        result.append({
            "payment_id": str(r["id"]),
            "receipt_no": r["receipt_no"],
            "provider": r["provider"],
            "reference": r["reference"],
            "amount": float(r["amount"] or 0),
            "student_name": _student_name(payload),
            "received_at": r["received_at"].isoformat() if r["received_at"] else None,
        })
    return result
