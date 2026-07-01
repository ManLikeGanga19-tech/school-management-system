from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.core.dependencies import get_tenant, get_current_user, require_permission
from app.core.subscription_gate import block_when_inactive


def _enforce_director_for_non_draft(request: Request, status: str) -> None:
    """Inside a route already gated on finance.invoices.manage, refuse the
    call when the target invoice is no longer DRAFT and the caller is not a
    director (finance.policy.manage). Used by the status-split delete and
    replace endpoints so the secretary can fix/discard their own DRAFTs but
    cannot touch published ones — the director has those exclusively.

    SUPER_ADMIN always passes."""
    if (status or "").upper() == "DRAFT":
        return
    roles = {
        str(r).strip().upper()
        for r in (getattr(request.state, "roles", []) or [])
        if isinstance(r, str) and str(r).strip()
    }
    if "SUPER_ADMIN" in roles:
        return
    perms = getattr(request.state, "permissions", []) or []
    if "finance.policy.manage" not in perms:
        raise HTTPException(
            status_code=403,
            detail=(
                "Only directors can act on published invoices. "
                "Discard or fix it while it is still a DRAFT, "
                "or ask the director to perform this action."
            ),
        )

from app.api.v1.finance import service
from app.api.v1.payments import service as payments_service
from app.api.v1.sms import notifications as sms_notify
from app.api.v1.finance.schemas import (
    FinancePolicyUpsert, FinancePolicyOut,
    FinanceStructurePolicyUpsert, FinanceStructurePolicyOut,
    FeeCategoryCreate, FeeCategoryOut, FeeCategoryUpdate,
    FeeItemCreate, FeeItemOut, FeeItemUpdate,
    FeeStructureCreate, FeeStructureUpdate, FeeStructureOut, FeeStructureItemUpsert, FeeStructureItemAdd, FeeStructureItemOut, FeeStructureWithItemsOut,
    ScholarshipCreate, ScholarshipOut, ScholarshipUpdate,
    InvoiceCreate, InvoiceOut, InvoicePageOut,
    GenerateFeesInvoiceRequest,
    GenerateFeesInvoiceV2Request,
    PaymentCreate, PaymentOut, PaymentWithAllocationsOut, PaymentPageOut,
    StudentPaymentSummaryOut, StudentPaymentRecordRequest, StudentPaymentRecordOut,
    ParentPaymentSummaryOut, ParentPaymentRecordRequest, ParentPaymentRecordOut,
    BulkGenerateFeesInvoicesRequest, BulkGenerateFeesInvoicesOut,
    BulkPublishInvoicesRequest, BulkPublishInvoicesOut,
    TenantPaymentSettingsUpsert, TenantPaymentSettingsOut,
)

router = APIRouter()

# -------------------------
# Policy (Director/Secretary)
# -------------------------
@router.get("/policy", response_model=FinancePolicyOut, dependencies=[Depends(require_permission("finance.policy.view"))])
def get_policy(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.get_or_create_policy(db, tenant_id=tenant.id)
    db.commit()
    return row


@router.put("/policy", response_model=FinancePolicyOut, dependencies=[Depends(require_permission("finance.policy.manage"))])
def upsert_policy(
    payload: FinancePolicyUpsert,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.upsert_policy(db, tenant_id=tenant.id, actor_user_id=user.id, data=payload.model_dump())
    db.commit()
    db.refresh(row)
    return row


@router.get(
    "/structure-policies",
    dependencies=[Depends(require_permission("finance.policy.view"))],
)
def list_structure_policies(
    fee_structure_id: UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    paginated: bool = Query(default=False, description="Return {items, meta} shape when true"),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Backwards-compat: default returns list[T]. paginated=true triggers
    the {items, meta} shape used by the shared frontend usePaginatedTable
    hook."""
    if paginated:
        return service.list_fee_structure_policies_paginated(
            db, tenant_id=tenant.id, fee_structure_id=fee_structure_id,
            page=page, page_size=page_size, paginated=True,
        )
    return service.list_fee_structure_policies(
        db,
        tenant_id=tenant.id,
        fee_structure_id=fee_structure_id,
    )


@router.put(
    "/structure-policies",
    response_model=FinanceStructurePolicyOut,
    dependencies=[Depends(require_permission("finance.policy.manage"))],
)
def upsert_structure_policy(
    payload: FinanceStructurePolicyUpsert,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.upsert_fee_structure_policy(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        fee_structure_id=payload.fee_structure_id,
        fee_item_id=payload.fee_item_id,
        allow_partial_enrollment=payload.allow_partial_enrollment,
        min_percent_to_enroll=payload.min_percent_to_enroll,
        min_amount_to_enroll=payload.min_amount_to_enroll,
    )
    db.commit()
    db.refresh(row)
    return row


@router.delete(
    "/structure-policies",
    dependencies=[Depends(require_permission("finance.policy.manage"))],
)
def delete_structure_policy(
    fee_structure_id: UUID = Query(...),
    fee_item_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    service.delete_fee_structure_policy(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        fee_structure_id=fee_structure_id,
        fee_item_id=fee_item_id,
    )
    db.commit()
    return {"ok": True}


# -------------------------
# Fee Catalog
# -------------------------
@router.post("/fee-categories", response_model=FeeCategoryOut, dependencies=[Depends(require_permission("finance.fees.manage"))])
def create_fee_category(
    payload: FeeCategoryCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.create_fee_category(db, tenant_id=tenant.id, actor_user_id=user.id, code=payload.code, name=payload.name, is_active=payload.is_active)
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/fee-categories", dependencies=[Depends(require_permission("finance.fees.view"))])
def list_fee_categories(
    search: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    sort: str = Query(default="-created_at"),
    paginated: bool = Query(default=False, description="Return {items, meta} shape when true"),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Backwards-compat: default returns list[T]. When paginated=true,
    returns {items, meta} for the shared frontend usePaginatedTable hook.
    `q` is an alias of `search` used by the shared hook."""
    return service.list_fee_categories_paginated(
        db, tenant_id=tenant.id, search=q or search, is_active=is_active,
        page=page, page_size=page_size, sort=sort, paginated=paginated,
    )


@router.post("/fee-items", response_model=FeeItemOut, dependencies=[Depends(require_permission("finance.fees.manage"))])
def create_fee_item(
    payload: FeeItemCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.create_fee_item(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            category_id=payload.category_id,
            code=payload.code,
            name=payload.name,
            charge_frequency=payload.charge_frequency,
            is_active=payload.is_active,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/fee-categories/{category_id}", response_model=FeeCategoryOut, dependencies=[Depends(require_permission("finance.fees.manage"))])
def update_fee_category(
    category_id: UUID,
    payload: FeeCategoryUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.update_fee_category(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            category_id=category_id,
            updates=payload.model_dump(exclude_none=True),
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/fee-categories/{category_id}", status_code=204, dependencies=[Depends(require_permission("finance.fees.manage"))])
def delete_fee_category(
    category_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        service.delete_fee_category(db, tenant_id=tenant.id, actor_user_id=user.id, category_id=category_id)
        db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/fee-items", dependencies=[Depends(require_permission("finance.fees.view"))])
def list_fee_items(
    search: str | None = Query(default=None),
    q: str | None = Query(default=None),
    category_id: UUID | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    sort: str = Query(default="-created_at"),
    paginated: bool = Query(default=False, description="Return {items, meta} shape when true"),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    # Backwards-compat: paginated=false returns the legacy list[T] shape via
    # list_fee_items_filtered (which still applies category_id). paginated=true
    # returns {items, meta} for the shared frontend usePaginatedTable hook.
    if not paginated:
        return service.list_fee_items_filtered(
            db, tenant_id=tenant.id, search=q or search, category_id=category_id,
            is_active=is_active, page=page, page_size=page_size, sort=sort,
        )
    return service.list_fee_items_paginated(
        db, tenant_id=tenant.id, search=q or search, is_active=is_active,
        page=page, page_size=page_size, sort=sort, paginated=True,
    )


@router.put("/fee-items/{item_id}", response_model=FeeItemOut, dependencies=[Depends(require_permission("finance.fees.manage"))])
def update_fee_item(
    item_id: UUID,
    payload: FeeItemUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.update_fee_item(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            item_id=item_id,
            updates=payload.model_dump(exclude_none=True),
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/fee-items/{item_id}", status_code=204, dependencies=[Depends(require_permission("finance.fees.manage"))])
def delete_fee_item(
    item_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        service.delete_fee_item(db, tenant_id=tenant.id, actor_user_id=user.id, item_id=item_id)
        db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# -------------------------
# Fee Structures
# -------------------------
@router.post("/fee-structures", response_model=FeeStructureOut, dependencies=[Depends(require_permission("finance.fees.manage"))])
def create_fee_structure(
    payload: FeeStructureCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.create_fee_structure(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            class_code=payload.class_code,
            academic_year=payload.academic_year,
            student_type=payload.student_type,
            name=payload.name,
            is_active=payload.is_active,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/fee-structures", dependencies=[Depends(require_permission("finance.fees.view"))])
def list_fee_structures(
    q: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    paginated: bool = Query(default=False, description="Return {items, meta} shape when true"),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Backwards-compat: default returns list[T] (no filters applied for
    legacy callers). paginated=true triggers the {items, meta} shape used
    by the shared frontend usePaginatedTable hook."""
    if not paginated:
        return service.list_fee_structures(db, tenant_id=tenant.id)
    return service.list_fee_structures_paginated(
        db, tenant_id=tenant.id, search=q, is_active=is_active,
        page=page, page_size=page_size, paginated=True,
    )


@router.put("/fee-structures/{structure_id}", response_model=FeeStructureOut, dependencies=[Depends(require_permission("finance.fees.manage"))])
def update_fee_structure(
    structure_id: UUID,
    payload: FeeStructureUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.update_fee_structure(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            structure_id=structure_id,
            updates=payload.model_dump(exclude_unset=True),
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/fee-structures/{structure_id}", dependencies=[Depends(require_permission("finance.fees.manage"))])
def delete_fee_structure(
    structure_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        service.delete_fee_structure(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            structure_id=structure_id,
        )
        db.commit()
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/fee-structures/{structure_id}/items", dependencies=[Depends(require_permission("finance.fees.manage"))])
def upsert_structure_items(
    structure_id: UUID,
    items: list[FeeStructureItemUpsert],
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        service.upsert_fee_structure_items(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            structure_id=structure_id,
            items=[i.model_dump() for i in items],
        )
        db.commit()
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/fee-structures/{structure_id}/items", response_model=FeeStructureItemOut, dependencies=[Depends(require_permission("finance.fees.manage"))])
def add_structure_item(
    structure_id: UUID,
    payload: FeeStructureItemAdd,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        item = service.add_or_update_structure_item(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            structure_id=structure_id,
            item=payload.model_dump(),
        )
        db.commit()
        return item
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/fee-structures/{structure_id}/items/{fee_item_id}", dependencies=[Depends(require_permission("finance.fees.manage"))])
def remove_structure_item(
    structure_id: UUID,
    fee_item_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        service.remove_structure_item(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            structure_id=structure_id,
            fee_item_id=fee_item_id,
        )
        db.commit()
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/fee-structures/{structure_id}", response_model=FeeStructureWithItemsOut, dependencies=[Depends(require_permission("finance.fees.view"))])
def get_structure(
    structure_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    try:
        s, items = service.get_structure_with_items(db, tenant_id=tenant.id, structure_id=structure_id)
        return FeeStructureWithItemsOut(
            id=s.id,
            class_code=s.class_code,
            academic_year=s.academic_year,
            student_type=s.student_type,
            name=s.name,
            is_active=s.is_active,
            structure_no=getattr(s, "structure_no", None),
            items=items,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/assignments", dependencies=[Depends(require_permission("finance.fees.manage"))])
def assign_structure(
    payload: dict,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        enrollment_id = payload.get("enrollment_id")
        structure_id = payload.get("fee_structure_id")
        if not enrollment_id or not structure_id:
            raise HTTPException(status_code=400, detail="enrollment_id and fee_structure_id are required")

        assignment = service.assign_fee_structure_to_enrollment(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            enrollment_id=UUID(enrollment_id),
            fee_structure_id=UUID(structure_id),
            generate_invoice=bool(payload.get("generate_invoice", False)),
            meta=payload.get("meta"),
        )
        db.commit()
        return {"ok": True, "id": str(assignment.id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# -------------------------
# Scholarships
# -------------------------
@router.post("/scholarships", response_model=ScholarshipOut, dependencies=[Depends(require_permission("finance.scholarships.manage"))])
def create_scholarship(
    payload: ScholarshipCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.create_scholarship(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            name=payload.name,
            type_=payload.type,
            value=payload.value,
            is_active=payload.is_active,
            max_recipients=payload.max_recipients,
            description=payload.description,
            covers_carry_forward=payload.covers_carry_forward,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/scholarships", dependencies=[Depends(require_permission("finance.scholarships.view"))])
def list_scholarships(
    q: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    paginated: bool = Query(default=False, description="Return {items, meta} shape when true"),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Backwards-compat: default returns list[T]. paginated=true triggers
    the {items, meta} shape used by the shared frontend usePaginatedTable
    hook. Search matches name + description."""
    if not paginated:
        return service.list_scholarships(db, tenant_id=tenant.id)
    return service.list_scholarships_paginated(
        db, tenant_id=tenant.id, search=q, is_active=is_active,
        page=page, page_size=page_size, paginated=True,
    )


@router.put("/scholarships/{scholarship_id}", response_model=ScholarshipOut, dependencies=[Depends(require_permission("finance.scholarships.manage"))])
def update_scholarship(
    scholarship_id: UUID,
    payload: ScholarshipUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.update_scholarship(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            scholarship_id=scholarship_id,
            updates=payload.model_dump(exclude_none=True),
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/scholarships/{scholarship_id}", status_code=204, dependencies=[Depends(require_permission("finance.scholarships.manage"))])
def delete_scholarship(
    scholarship_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        service.delete_scholarship(db, tenant_id=tenant.id, actor_user_id=user.id, scholarship_id=scholarship_id)
        db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/scholarships/{scholarship_id}/allocations",
    dependencies=[Depends(require_permission("finance.scholarships.view"))],
)
def list_scholarship_allocations(
    scholarship_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Return a list of students who have received this scholarship."""
    rows = service.list_scholarship_allocations(db, tenant_id=tenant.id, scholarship_id=scholarship_id)
    return {"ok": True, "scholarship_id": str(scholarship_id), "allocations": rows}


@router.post(
    "/invoices/{invoice_id}/scholarship",
    response_model=InvoiceOut,
    # Director-only — applying after-the-fact is a policy decision, not data
    # entry. Secretary can still apply at create time via the standard
    # generate endpoints.
    dependencies=[Depends(require_permission("finance.policy.manage"))],
)
def apply_scholarship_to_invoice_route(
    invoice_id: UUID,
    payload: dict,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """Apply a scholarship to an existing invoice (DRAFT / ISSUED / PARTIAL).
    PAID + CANCELLED are blocked — issue a refund or void first."""
    from app.models.invoice import Invoice as _Invoice
    from sqlalchemy import select as _select

    scholarship_raw = payload.get("scholarship_id")
    if not scholarship_raw:
        raise HTTPException(status_code=400, detail="scholarship_id is required")
    try:
        scholarship_id = UUID(str(scholarship_raw))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="invalid scholarship_id")

    reason = str(payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="reason is required")

    amount_raw = payload.get("amount")
    amount = None
    if amount_raw is not None and str(amount_raw).strip() != "":
        from decimal import Decimal, InvalidOperation
        try:
            amount = Decimal(str(amount_raw))
        except InvalidOperation:
            raise HTTPException(status_code=400, detail="invalid amount")

    try:
        service.apply_scholarship_to_existing_invoice(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            invoice_id=invoice_id,
            scholarship_id=scholarship_id,
            requested_amount=amount,
            reason=reason,
        )
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    inv = db.execute(
        _select(_Invoice).where(
            _Invoice.id == invoice_id, _Invoice.tenant_id == tenant.id,
        )
    ).scalar_one()
    return inv


@router.post(
    "/scholarships/{scholarship_id}/bulk-apply",
    dependencies=[Depends(require_permission("finance.policy.manage"))],
)
def bulk_apply_scholarship_route(
    scholarship_id: UUID,
    payload: dict,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """Director action — apply this scholarship to every student in a class
    for a given term + year. Optional dry_run returns the preview without
    persisting. Skip-on-conflict: students whose invoice already has an
    ACTIVE scholarship are reported as skipped, never replaced."""
    try:
        class_code = str(payload.get("class_code") or "")
        term_number = int(payload.get("term_number") or 0)
        academic_year = int(payload.get("academic_year") or 0)
        reason = str(payload.get("reason") or "")
        dry_run = bool(payload.get("dry_run", False))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="invalid request")

    try:
        result = service.bulk_apply_scholarship_to_class(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            scholarship_id=scholarship_id,
            class_code=class_code,
            term_number=term_number,
            academic_year=academic_year,
            reason=reason,
            dry_run=dry_run,
        )
        if not dry_run:
            db.commit()
        return result
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/students/{student_id}/scholarships",
    dependencies=[Depends(require_permission("finance.scholarships.view"))],
)
def list_student_scholarships(
    student_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Full scholarship history for a student — ACTIVE + REVOKED, newest
    first. Drives the student profile 'Awards' tab and the parent portal."""
    rows = service.list_student_scholarship_history(
        db, tenant_id=tenant.id, student_id=student_id,
    )
    return {"ok": True, "student_id": str(student_id), "allocations": rows}


# -------------------------
# Invoices
# -------------------------
@router.post("/invoices", response_model=InvoiceOut, dependencies=[Depends(require_permission("finance.invoices.manage"))])
def create_invoice(
    payload: InvoiceCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        inv = service.create_invoice(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            invoice_type=payload.invoice_type,
            enrollment_id=payload.enrollment_id,
            lines=[l.model_dump() for l in payload.lines],
        )
        db.commit()
        db.refresh(inv)
        sms_notify.fire_invoice_notification(
            db, tenant_id=tenant.id, actor_user_id=user.id,
            enrollment_id=payload.enrollment_id,
            invoice_no=inv.invoice_no, total_amount=inv.total_amount,
        )
        return inv
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/invoices/generate/fees", response_model=InvoiceOut, dependencies=[Depends(require_permission("finance.invoices.manage"))])
def generate_fees_invoice(
    payload: GenerateFeesInvoiceRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        inv = service.generate_school_fees_invoice_from_structure(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            enrollment_id=payload.enrollment_id,
            class_code=payload.class_code,
            term_code=payload.term_code,
            scholarship_id=payload.scholarship_id,
            scholarship_amount=payload.scholarship_amount,
            scholarship_reason=payload.scholarship_reason,
        )
        db.commit()
        db.refresh(inv)
        sms_notify.fire_invoice_notification(
            db, tenant_id=tenant.id, actor_user_id=user.id,
            enrollment_id=payload.enrollment_id,
            invoice_no=inv.invoice_no, total_amount=inv.total_amount,
        )
        return inv
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/invoices/generate/fees/v2", response_model=InvoiceOut, dependencies=[Depends(require_permission("finance.invoices.manage"))])
def generate_fees_invoice_v2(
    payload: GenerateFeesInvoiceV2Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        inv = service.generate_school_fees_invoice_v2(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            enrollment_id=payload.enrollment_id,
            term_number=payload.term_number,
            academic_year=payload.academic_year,
            scholarship_id=payload.scholarship_id,
            scholarship_amount=payload.scholarship_amount,
            scholarship_reason=payload.scholarship_reason,
            include_carry_forward=payload.include_carry_forward,
            force_student_type=payload.force_student_type,
        )
        db.commit()
        db.refresh(inv)
        # Notification deliberately NOT fired here — the invoice is a DRAFT.
        # Parents are notified only when the secretary publishes it via the
        # /invoices/{id}/publish endpoint below.
        return inv
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/invoices/{invoice_id}/publish",
    response_model=InvoiceOut,
    dependencies=[Depends(require_permission("finance.invoices.manage"))],
)
def publish_invoice_route(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """Move a DRAFT invoice into its live status (ISSUED / PARTIAL / PAID).
    Publishing is what makes the invoice visible to parents and unlocks
    payment recording against it. Allowed for both secretary and director."""
    try:
        inv = service.publish_invoice(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            invoice_id=invoice_id,
        )
        db.commit()
        db.refresh(inv)
        # Now that it's live, notify the parent — the same notification that
        # used to fire on generate, deferred to publish so DRAFTs don't spam.
        try:
            sms_notify.fire_invoice_notification(
                db, tenant_id=tenant.id, actor_user_id=user.id,
                enrollment_id=inv.enrollment_id,
                invoice_no=inv.invoice_no, total_amount=inv.total_amount,
            )
        except Exception:
            # Notification failure must never roll back a published invoice.
            pass
        return inv
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/invoices/generate/fees/bulk",
    response_model=BulkGenerateFeesInvoicesOut,
    dependencies=[Depends(require_permission("finance.invoices.manage"))],
)
def bulk_generate_fees_invoices_route(
    payload: BulkGenerateFeesInvoicesRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """Generate DRAFT v2 fees invoices for every eligible enrollment
    (ENROLLED / ENROLLED_PARTIAL) for the given term + academic year.
    Optional class_code narrows the batch to a single class.

    dry_run=true returns the same outcome list but rolls back any DRAFTs
    that would have been created — used by the UI's 'Preview' step before
    the secretary commits the batch.

    Per-student failures don't abort the batch; each row shows up in
    created/skipped/failed with a reason code the UI can render."""
    try:
        result = service.bulk_generate_fees_invoices(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            term_number=payload.term_number,
            academic_year=payload.academic_year,
            class_code=payload.class_code,
            dry_run=payload.dry_run,
        )
        # The service manages its own savepoint; commit the outer transaction
        # only when it actually persisted anything.
        if not payload.dry_run:
            db.commit()
        return result
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/invoices/publish/bulk",
    response_model=BulkPublishInvoicesOut,
    dependencies=[Depends(require_permission("finance.invoices.manage"))],
)
def bulk_publish_invoices_route(
    payload: BulkPublishInvoicesRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """Publish a batch of DRAFT invoices in one request — typically the
    DRAFTs the secretary just generated via /generate/fees/bulk and
    reviewed. Each row publishes in its own savepoint so one bad invoice
    doesn't sink the rest. Returns per-row outcomes."""
    try:
        result = service.bulk_publish_invoices(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            invoice_ids=payload.invoice_ids,
            all_drafts=payload.all_drafts,
            term_number=payload.term_number,
            academic_year=payload.academic_year,
            all_drafts_limit=payload.all_drafts_limit,
        )
        db.commit()
        # Best-effort parent SMS for each successfully published invoice.
        # Same rule as the single publish endpoint: notification failure
        # must never roll back a published invoice.
        try:
            from app.models.invoice import Invoice as _Invoice
            from sqlalchemy import select as _select
            for row in result.get("published", []):
                inv = db.execute(
                    _select(_Invoice).where(_Invoice.id == UUID(row["invoice_id"]))
                ).scalar_one_or_none()
                if inv is not None:
                    sms_notify.fire_invoice_notification(
                        db, tenant_id=tenant.id, actor_user_id=user.id,
                        enrollment_id=inv.enrollment_id,
                        invoice_no=inv.invoice_no, total_amount=inv.total_amount,
                    )
        except Exception:
            pass
        return result
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/invoices/drafts/count",
    dependencies=[Depends(require_permission("finance.invoices.view"))],
)
def count_draft_invoices(
    term_number: int | None = None,
    academic_year: int | None = None,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
):
    """How many DRAFT invoices match the optional term filter. Powers the
    'Publish All Drafts' confirm dialog so the user sees a real number
    before committing."""
    from sqlalchemy import text as _text
    sql = (
        "SELECT COUNT(*) FROM core.invoices "
        "WHERE tenant_id = :tid AND status = 'DRAFT'"
    )
    params: dict[str, object] = {"tid": str(tenant.id)}
    if term_number is not None:
        sql += " AND term_number = :tn"
        params["tn"] = int(term_number)
    if academic_year is not None:
        sql += " AND academic_year = :yr"
        params["yr"] = int(academic_year)
    count = db.execute(_text(sql), params).scalar() or 0
    return {"count": int(count)}


@router.post(
    "/invoices/{invoice_id}/replace",
    response_model=InvoiceOut,
    # Minimum gate; the inner check tightens to finance.policy.manage when
    # the invoice is no longer DRAFT (only directors can re-issue a live
    # invoice from a different structure).
    dependencies=[Depends(require_permission("finance.invoices.manage"))],
)
def replace_invoice(
    invoice_id: UUID,
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """Regenerate a school-fees invoice in place from the chosen structure.

    Both roles can replace a DRAFT they just generated (fix-my-own-mistake);
    replacing a published invoice (ISSUED / PARTIAL / PAID) requires
    finance.policy.manage — director only."""
    from app.models.invoice import Invoice as _Invoice
    from sqlalchemy import select as _select
    inv_row = db.execute(
        _select(_Invoice).where(
            _Invoice.id == invoice_id, _Invoice.tenant_id == tenant.id,
        )
    ).scalar_one_or_none()
    if not inv_row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _enforce_director_for_non_draft(request, inv_row.status or "")

    try:
        inv = service.replace_fees_invoice(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            invoice_id=invoice_id,
            student_type=str(payload.get("student_type") or ""),
            include_carry_forward=bool(payload.get("include_carry_forward", True)),
        )
        db.commit()
        db.refresh(inv)
        return inv
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.delete(
    "/invoices/{invoice_id}",
    # Minimum gate; the inner check tightens to finance.policy.manage when
    # the invoice has been published. Secretaries can discard a DRAFT they
    # just generated (mistakes happen, no money on it yet); only directors
    # can hard-delete a live invoice.
    dependencies=[Depends(require_permission("finance.invoices.manage"))],
)
def delete_invoice(
    invoice_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """Hard-delete an invoice + everything tied to it (payments, receipts,
    allocations, bundled carry-forward releases back to OPEN).
    DRAFT: both roles. Published: director only."""
    from app.models.invoice import Invoice as _Invoice
    from sqlalchemy import select as _select
    inv_row = db.execute(
        _select(_Invoice).where(
            _Invoice.id == invoice_id, _Invoice.tenant_id == tenant.id,
        )
    ).scalar_one_or_none()
    if not inv_row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    _enforce_director_for_non_draft(request, inv_row.status or "")

    try:
        result = service.delete_invoice_cascade(
            db, tenant_id=tenant.id, actor_user_id=user.id, invoice_id=invoice_id
        )
        db.commit()
        return {"ok": True, **result}
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/invoices", dependencies=[Depends(require_permission("finance.invoices.view"))])
def list_invoices(
    enrollment_id: UUID | None = Query(default=None),
    invoice_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    outstanding_only: bool = Query(default=False),
    q: str | None = Query(default=None),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD inclusive"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD inclusive"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Paginated invoice listing shared by secretary + director.

    Same filter set as /director/finance/invoices. Rows carry
    student_name + admission_no from a batch enrollment lookup so the
    frontend renders names without a client-side map. Used for both the
    Invoices tab and the Receipts tab (status=PAID).
    """
    result = service.list_invoices(
        db, tenant_id=tenant.id, enrollment_id=enrollment_id,
        invoice_type=invoice_type, status=status,
        outstanding_only=outstanding_only,
        q=q, date_from=date_from, date_to=date_to,
        page=page, page_size=page_size,
    )
    # Batch-resolve student labels for this page — same helper the
    # director endpoint uses. Kept small dependency here for isolation.
    from app.api.v1.director.routes import _batch_student_labels, _serialize_invoice_row
    invoices = result["items"]
    enrollment_ids = [inv.enrollment_id for inv in invoices if inv.enrollment_id]
    labels = _batch_student_labels(db, tenant_id=tenant.id, enrollment_ids=enrollment_ids)
    items = []
    for inv in invoices:
        name, adm = labels.get(str(inv.enrollment_id), ("", "")) if inv.enrollment_id else ("", "")
        items.append(_serialize_invoice_row(inv, student_name=name, admission_no=adm))
    return {"items": items, "meta": result["meta"]}


@router.get("/invoices/{invoice_id}", response_model=InvoiceOut, dependencies=[Depends(require_permission("finance.invoices.view"))])
def get_invoice(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    inv = service.get_invoice(db, tenant_id=tenant.id, invoice_id=invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv


@router.get(
    "/invoices/{invoice_id}/lines",
    dependencies=[Depends(require_permission("finance.invoices.view"))],
)
def get_invoice_lines(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Return the invoice's line items WITH meta. Used by the Preview &
    Publish modal so the secretary can see line-kind (arrears rollup,
    scholarship, interview credit, fee) before publishing — the canonical
    /documents/invoices payload strips meta for PDF rendering.
    """
    from app.models.invoice import Invoice as _Invoice, InvoiceLine as _InvoiceLine
    from sqlalchemy import select as _select
    inv = db.execute(
        _select(_Invoice).where(
            _Invoice.id == invoice_id, _Invoice.tenant_id == tenant.id,
        )
    ).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    rows = db.execute(
        _select(_InvoiceLine)
        .where(_InvoiceLine.invoice_id == invoice_id)
        .order_by(_InvoiceLine.id.asc())
    ).scalars().all()
    return [
        {
            "id": str(line.id),
            "description": line.description,
            "amount": str(line.amount or 0),
            "meta": line.meta or {},
        }
        for line in rows
    ]


# -------------------------
# Payments
# -------------------------
@router.post("/payments", response_model=PaymentOut, dependencies=[Depends(require_permission("finance.payments.manage"))])
def create_payment(
    payload: PaymentCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        pay = service.create_payment(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            provider=payload.provider,
            reference=payload.reference,
            amount=payload.amount,
            allocations=[a.model_dump() for a in payload.allocations],
        )
        db.commit()
        db.refresh(pay)
        # Resolve enrollment_id from the first allocated invoice so we can look up the guardian
        first_invoice_id = payload.allocations[0].invoice_id if payload.allocations else None
        enrollment_id = None
        if first_invoice_id:
            from app.models.invoice import Invoice as _Invoice
            _inv = db.get(_Invoice, first_invoice_id)
            enrollment_id = _inv.enrollment_id if _inv else None
        # Compute outstanding balance across all allocated invoices after payment
        from sqlalchemy import select as _select
        from app.models.invoice import Invoice as _Invoice2
        allocated_ids = [a.invoice_id for a in payload.allocations]
        remaining = sum(
            float(_inv.balance_amount)
            for _inv in db.execute(_select(_Invoice2).where(_Invoice2.id.in_(allocated_ids))).scalars()
        )
        sms_notify.fire_payment_notification(
            db, tenant_id=tenant.id, actor_user_id=user.id,
            enrollment_id=enrollment_id,
            receipt_no=pay.receipt_no, amount=pay.amount,
            new_balance=remaining,
        )
        return pay
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/students/{student_id}/payment-summary",
    response_model=StudentPaymentSummaryOut,
    dependencies=[Depends(require_permission("finance.payments.view"))],
)
def get_student_payment_summary_route(
    student_id: UUID,
    current_term_number: int | None = Query(default=None, ge=1, le=3),
    current_academic_year: int | None = Query(default=None, ge=2000, le=2100),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    """Snapshot used by the by-student record-payment view: pending balance
    adjustment, current term, prior-term arrears, and per-invoice breakdown."""
    try:
        return service.get_student_payment_summary(
            db,
            tenant_id=tenant.id,
            student_id=student_id,
            current_term_number=current_term_number,
            current_academic_year=current_academic_year,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/students/{student_id}/payments",
    response_model=StudentPaymentRecordOut,
    dependencies=[Depends(require_permission("finance.payments.manage"))],
)
def record_student_payment_route(
    student_id: UUID,
    payload: StudentPaymentRecordRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """Record a payment for a student. FIFO allocation across their open
    school-fees invoices (oldest -> newest); any surplus auto-credits the
    student via an OVERPAYMENT_CREDIT carry-forward."""
    try:
        result = service.record_student_payment(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            student_id=student_id,
            amount=payload.amount,
            provider=payload.provider,
            reference=payload.reference,
        )
        db.commit()

        # Best-effort SMS notification, mirroring the manual /payments path.
        # Look up the enrollment behind the first allocated invoice.
        if result.get("allocations"):
            from app.models.invoice import Invoice as _Invoice
            first_inv_id = UUID(result["allocations"][0]["invoice_id"])
            inv = db.get(_Invoice, first_inv_id)
            enrollment_id = inv.enrollment_id if inv else None
            try:
                sms_notify.fire_payment_notification(
                    db, tenant_id=tenant.id, actor_user_id=user.id,
                    enrollment_id=enrollment_id,
                    receipt_no=result.get("receipt_no"),
                    amount=payload.amount,
                    new_balance=0.0,  # detailed split lives on the receipt.
                )
            except Exception:
                # Notification failure must not roll back a recorded payment.
                pass

        return result
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/parents/{parent_id}/payment-summary",
    response_model=ParentPaymentSummaryOut,
    dependencies=[Depends(require_permission("finance.payments.view"))],
)
def get_parent_payment_summary_route(
    parent_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    """Family roll-up of every linked child's payment summary, plus
    family_total_outstanding. Used by the family-mode Record Payment view."""
    try:
        return service.get_parent_payment_summary(
            db, tenant_id=tenant.id, parent_id=parent_id
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/parents/{parent_id}/payments",
    response_model=ParentPaymentRecordOut,
    dependencies=[Depends(require_permission("finance.payments.manage"))],
)
def record_parent_payment_route(
    parent_id: UUID,
    payload: ParentPaymentRecordRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """Record ONE payment covering one or more of a parent's children.

    mode=auto: FIFO across the family's open school-fees invoices, oldest term
    first across all children. mode=manual: per_student_allocations[] gives an
    explicit split per child; each child's amount is then FIFO-allocated inside
    that child's invoices (no silent spillover between siblings).

    credit_to_student_id is required when a surplus would result and the
    payment covers multiple children.
    """
    try:
        per_student = (
            [a.model_dump() for a in payload.per_student_allocations]
            if payload.per_student_allocations
            else None
        )
        result = service.record_parent_payment(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            parent_id=parent_id,
            amount=payload.amount,
            provider=payload.provider,
            reference=payload.reference,
            mode=payload.mode,
            per_student_allocations=per_student,
            credit_to_student_id=payload.credit_to_student_id,
        )
        db.commit()

        # Notify each child's primary enrollment about the payment portion
        # that went to them. Best-effort — never roll back a recorded payment.
        try:
            for stu in result.get("students", []):
                stu_id = stu.get("student_id")
                if not stu_id:
                    continue
                # First allocation's invoice for this student → enrollment id.
                allocs = stu.get("allocations") or []
                if not allocs:
                    continue
                from app.models.invoice import Invoice as _Invoice
                first_inv_id = UUID(allocs[0]["invoice_id"])
                inv = db.get(_Invoice, first_inv_id)
                sms_notify.fire_payment_notification(
                    db, tenant_id=tenant.id, actor_user_id=user.id,
                    enrollment_id=inv.enrollment_id if inv else None,
                    receipt_no=result.get("receipt_no"),
                    amount=float(stu.get("subtotal") or 0),
                    new_balance=0.0,
                )
        except Exception:
            pass

        return result
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/payments", dependencies=[Depends(require_permission("finance.payments.view"))])
def list_payments(
    enrollment_id: UUID | None = Query(default=None),
    q: str | None = Query(default=None),
    provider: str | None = Query(default=None),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD inclusive"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD inclusive"),
    settled_only: bool = Query(default=False, description="Receipts view: only payments against PAID invoices"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Paginated payments listing shared by secretary + parent-facing UIs.

    Same filter set as /director/finance/payments (both wrap the same
    list_payments service). Response no longer uses PaymentPageOut so the
    extended row payload (student_label, received_at) surfaces cleanly.
    """
    result = service.list_payments(
        db, tenant_id=tenant.id, enrollment_id=enrollment_id,
        q=q, provider=provider, date_from=date_from, date_to=date_to,
        settled_only=settled_only, page=page, page_size=page_size,
    )
    items = []
    for row in result["items"]:
        items.append({
            "id":            str(row["id"]),
            "receipt_no":    row.get("receipt_no"),
            "provider":      row.get("provider"),
            "reference":     row.get("reference"),
            "amount":        str(row.get("amount") or 0),
            "received_at":   row.get("received_at"),
            "student_label": row.get("student_label") or "",
            "allocations": [
                {
                    "invoice_id": str(a["invoice_id"]),
                    "amount":     str(a["amount"] or 0),
                }
                for a in (row.get("allocations") or [])
            ],
        })
    return {"items": items, "meta": result["meta"]}


# -------------------------
# Canonical documents (JSON + PDF)
# -------------------------
@router.get(
    "/documents/invoices/{invoice_id}",
    dependencies=[Depends(require_permission("finance.invoices.view"))],
)
def get_invoice_document(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    try:
        payload = service.build_invoice_document(
            db,
            tenant_id=tenant.id,
            invoice_id=invoice_id,
        )
        db.commit()
        return payload
    except ValueError as e:
        db.rollback()
        msg = str(e)
        raise HTTPException(status_code=404 if "not found" in msg.lower() else 400, detail=msg)


@router.get(
    "/documents/invoices/{invoice_id}/pdf",
    dependencies=[Depends(require_permission("finance.invoices.view"))],
)
def download_invoice_pdf(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    try:
        payload = service.build_invoice_document(
            db,
            tenant_id=tenant.id,
            invoice_id=invoice_id,
        )
        pdf = service.render_document_pdf(payload)
        db.commit()
        filename = f"{payload.get('document_no') or 'invoice'}.pdf"
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as e:
        db.rollback()
        msg = str(e)
        raise HTTPException(status_code=404 if "not found" in msg.lower() else 400, detail=msg)


@router.get(
    "/documents/payments/{payment_id}",
    dependencies=[Depends(require_permission("finance.payments.view"))],
)
def get_payment_document(
    payment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    try:
        payload = service.build_payment_receipt_document(
            db,
            tenant_id=tenant.id,
            payment_id=payment_id,
        )
        db.commit()
        return payload
    except ValueError as e:
        db.rollback()
        msg = str(e)
        raise HTTPException(status_code=404 if "not found" in msg.lower() else 400, detail=msg)


@router.get(
    "/documents/payments/{payment_id}/pdf",
    dependencies=[
        Depends(require_permission("finance.payments.view")),
        Depends(block_when_inactive),
    ],
)
def download_payment_pdf(
    payment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    try:
        payload = service.build_payment_receipt_document(
            db,
            tenant_id=tenant.id,
            payment_id=payment_id,
        )
        # Downloaded receipt is always A4 — a saved file is never thermal-sized.
        pdf = service.render_document_pdf(payload, receipt_force_a4=True)
        db.commit()
        filename = f"{payload.get('document_no') or 'receipt'}.pdf"
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as e:
        db.rollback()
        msg = str(e)
        raise HTTPException(status_code=404 if "not found" in msg.lower() else 400, detail=msg)


@router.get(
    "/documents/payments/{payment_id}/thermal",
    dependencies=[
        Depends(require_permission("finance.payments.view")),
        Depends(block_when_inactive),
    ],
)
def download_payment_thermal(
    payment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Return a plain-text HTML receipt sized for 80 mm thermal paper that auto-prints."""
    try:
        from app.utils.receipt_pdf import generate_thermal_html
        payload = service.build_payment_receipt_document(
            db,
            tenant_id=tenant.id,
            payment_id=payment_id,
        )
        html = generate_thermal_html(payload)
        db.commit()
        return Response(content=html, media_type="text/html")
    except ValueError as e:
        db.rollback()
        msg = str(e)
        raise HTTPException(status_code=404 if "not found" in msg.lower() else 400, detail=msg)


@router.get(
    "/documents/payments/{payment_id}/print",
    dependencies=[
        Depends(require_permission("finance.payments.view")),
        Depends(block_when_inactive),
    ],
)
def print_payment_receipt(
    payment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Receipt for printing — format follows the tenant's paper_size setting.

    THERMAL_80MM → auto-printing 80 mm HTML; otherwise → A4 PDF. The caller
    just opens the response; the backend owns the thermal-vs-A4 decision.
    """
    try:
        payload = service.build_payment_receipt_document(
            db,
            tenant_id=tenant.id,
            payment_id=payment_id,
        )
        profile = payload.get("profile") or {}
        is_thermal = str(profile.get("paper_size") or "A4").upper() == "THERMAL_80MM"
        if is_thermal:
            from app.utils.receipt_pdf import generate_thermal_html
            body = generate_thermal_html(payload)
            media = "text/html"
        else:
            body = service.render_document_pdf(payload, receipt_force_a4=True)
            media = "application/pdf"
        db.commit()
        return Response(content=body, media_type=media)
    except ValueError as e:
        db.rollback()
        msg = str(e)
        raise HTTPException(status_code=404 if "not found" in msg.lower() else 400, detail=msg)


@router.get(
    "/documents/fee-structures/{structure_id}",
    dependencies=[Depends(require_permission("finance.fees.view"))],
)
def get_fee_structure_document(
    structure_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    try:
        payload = service.build_fee_structure_document(
            db,
            tenant_id=tenant.id,
            structure_id=structure_id,
        )
        db.commit()
        return payload
    except ValueError as e:
        db.rollback()
        msg = str(e)
        raise HTTPException(status_code=404 if "not found" in msg.lower() else 400, detail=msg)


@router.get(
    "/documents/fee-structures/{structure_id}/pdf",
    dependencies=[Depends(require_permission("finance.fees.view"))],
)
def download_fee_structure_pdf(
    structure_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    try:
        payload = service.build_fee_structure_document(
            db,
            tenant_id=tenant.id,
            structure_id=structure_id,
        )
        pdf = service.render_document_pdf(payload)
        db.commit()
        cls = str(payload.get("class_code") or "structure").replace("/", "-").replace(" ", "_")
        yr = str(payload.get("academic_year") or "")
        stype = str(payload.get("student_type") or "")
        filename = f"fee-structure-{cls}-{yr}-{stype}.pdf".lower()
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as e:
        db.rollback()
        msg = str(e)
        raise HTTPException(status_code=404 if "not found" in msg.lower() else 400, detail=msg)


# -------------------------
# Enrollment finance status helper (for Next.js UI)
# -------------------------
@router.get("/enrollments/{enrollment_id}/finance-status", dependencies=[Depends(require_permission("finance.invoices.view"))])
def enrollment_finance_status(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.get_enrollment_finance_status(db, tenant_id=tenant.id, enrollment_id=enrollment_id)


# -------------------------
# Subscription (Tenant/Director)
# NOTE: Must use TENANT auth (get_current_user) like other finance endpoints.
# -------------------------

@router.get(
    "/subscription",
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def get_subscription(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    try:
        return payments_service.get_tenant_subscription(db, tenant_id=tenant.id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get(
    "/subscription/payments",
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def list_subscription_payments(
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    try:
        return payments_service.list_tenant_subscription_payments(
            db,
            tenant_id=tenant.id,
            limit=limit,
            offset=offset,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post(
    "/subscription/pay",
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def pay_subscription(
    payload: dict,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    phone = (payload.get("phone_number") or "").strip()
    amount = payload.get("amount")
    subscription_id = payload.get("subscription_id")

    if not phone:
        raise HTTPException(status_code=400, detail="phone_number is required")
    if amount is None:
        raise HTTPException(status_code=400, detail="amount is required")
    try:
        if isinstance(subscription_id, str) and subscription_id.strip():
            subscription_id = UUID(subscription_id)
        out = payments_service.initiate_tenant_subscription_payment(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            phone_number=phone,
            amount=amount,
            subscription_id=subscription_id,
        )
        db.commit()
        return out
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))


@router.get(
    "/subscription/payment-status",
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def subscription_payment_status(
    checkout_request_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    try:
        out = payments_service.get_tenant_subscription_payment_status(
            db,
            tenant_id=tenant.id,
            checkout_request_id=checkout_request_id,
        )
        db.commit()
        return out
    except ValueError as exc:
        db.rollback()
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail=str(exc))
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# Payment Settings (Director manages, Secretary reads)
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/payment-settings",
    response_model=TenantPaymentSettingsOut,
    dependencies=[Depends(require_permission("finance.policy.view"))],
)
def get_payment_settings(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.get_payment_settings(db, tenant_id=tenant.id)
    if not row:
        raise HTTPException(status_code=404, detail="Payment settings not configured")
    return row


@router.put(
    "/payment-settings",
    response_model=TenantPaymentSettingsOut,
    dependencies=[Depends(require_permission("finance.policy.manage"))],
)
def upsert_payment_settings(
    payload: TenantPaymentSettingsUpsert,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.upsert_payment_settings(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            data=payload.model_dump(exclude_unset=True),
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
