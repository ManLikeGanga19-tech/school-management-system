from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db, get_tenant, require_permission
from app.api.v1.parents import service
from app.api.v1.parents.schemas import (
    LinkEnrollmentRequest,
    ParentBulkPayment,
    ParentCreate,
    ParentUpdate,
    ParentDetail,
    ParentInvoiceOut,
    ParentListItem,
    PaymentPreviewOut,
    SyncResult,
)

router = APIRouter()

_PERM = "enrollment.manage"   # reuse: secretary has this permission


# ─────────────────────────────────────────────────────────────────────────────
# List + Create
# ─────────────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ParentListItem])
def list_parents(
    q: str = "",
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(require_permission(_PERM)),
):
    return service.list_parents(db, tenant_id=tenant.id, q=q)


@router.post("", response_model=ParentDetail)
def create_parent(
    body: ParentCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(require_permission(_PERM)),
):
    result = service.create_parent(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        data=body.model_dump(),
    )
    db.commit()
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Sync from enrollments
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/sync-from-enrollments", response_model=SyncResult)
def sync_from_enrollments(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(require_permission(_PERM)),
):
    result = service.sync_from_enrollments(
        db, tenant_id=tenant.id, actor_user_id=user.id
    )
    db.commit()
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Single parent
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{parent_id}", response_model=ParentDetail)
def get_parent(
    parent_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(require_permission(_PERM)),
):
    return service.get_parent_detail(db, tenant_id=tenant.id, parent_id=parent_id)


@router.put("/{parent_id}", response_model=ParentDetail)
def update_parent(
    parent_id: UUID,
    body: ParentUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(require_permission(_PERM)),
):
    result = service.update_parent(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        parent_id=parent_id,
        data=body.model_dump(exclude_none=True),
    )
    db.commit()
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Enrollment links
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{parent_id}/links", response_model=ParentDetail)
def link_enrollment(
    parent_id: UUID,
    body: LinkEnrollmentRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(require_permission(_PERM)),
):
    result = service.link_enrollment(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        parent_id=parent_id,
        enrollment_id=body.enrollment_id,
        relationship=body.relationship,
        is_primary=body.is_primary,
    )
    db.commit()
    return result


@router.delete("/{parent_id}/links/{link_id}", response_model=ParentDetail)
def unlink_enrollment(
    parent_id: UUID,
    link_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(require_permission(_PERM)),
):
    result = service.unlink_enrollment(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        parent_id=parent_id,
        link_id=link_id,
    )
    db.commit()
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Invoices + payment
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{parent_id}/invoices", response_model=list[ParentInvoiceOut])
def get_parent_invoices(
    parent_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(require_permission(_PERM)),
):
    return service.get_parent_invoices(db, tenant_id=tenant.id, parent_id=parent_id)


@router.post("/{parent_id}/payments/preview", response_model=PaymentPreviewOut)
def preview_payment(
    parent_id: UUID,
    amount: float,
    strategy: str = "oldest_first",
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(require_permission(_PERM)),
):
    from decimal import Decimal
    return service.preview_distribution(
        db,
        tenant_id=tenant.id,
        parent_id=parent_id,
        total_amount=Decimal(str(amount)),
        strategy=strategy,
    )


@router.post("/{parent_id}/payments")
def record_payment(
    parent_id: UUID,
    body: ParentBulkPayment,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(require_permission(_PERM)),
):
    result = service.record_bulk_payment(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        parent_id=parent_id,
        provider=body.provider,
        reference=body.reference,
        amount=body.amount,
        allocations=[{"invoice_id": a.invoice_id, "amount": a.amount} for a in body.allocations],
    )
    db.commit()
    return result
