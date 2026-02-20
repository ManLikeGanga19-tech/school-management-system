from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.core.dependencies import get_tenant, get_current_user, require_permission

from app.api.v1.finance import service
from app.api.v1.finance.schemas import (
    FinancePolicyUpsert, FinancePolicyOut,
    FeeCategoryCreate, FeeCategoryOut,
    FeeItemCreate, FeeItemOut,
    FeeStructureCreate, FeeStructureUpdate, FeeStructureOut, FeeStructureItemUpsert, FeeStructureItemAdd, FeeStructureItemOut, FeeStructureWithItemsOut,
    ScholarshipCreate, ScholarshipOut,
    InvoiceCreate, InvoiceOut,
    GenerateFeesInvoiceRequest,
    PaymentCreate, PaymentOut, PaymentWithAllocationsOut,
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


@router.get("/fee-categories", response_model=list[FeeCategoryOut], dependencies=[Depends(require_permission("finance.fees.view"))])
def list_fee_categories(
    search: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    sort: str = Query(default="-created_at"),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_fee_categories_filtered(db, tenant_id=tenant.id, search=search, is_active=is_active, page=page, page_size=page_size, sort=sort)


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
            is_active=payload.is_active,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/fee-items", response_model=list[FeeItemOut], dependencies=[Depends(require_permission("finance.fees.view"))])
def list_fee_items(
    search: str | None = Query(default=None),
    category_id: UUID | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    sort: str = Query(default="-created_at"),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_fee_items_filtered(db, tenant_id=tenant.id, search=search, category_id=category_id, is_active=is_active, page=page, page_size=page_size, sort=sort)


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
    row = service.create_fee_structure(db, tenant_id=tenant.id, actor_user_id=user.id, class_code=payload.class_code, name=payload.name, is_active=payload.is_active)
    db.commit()
    db.refresh(row)
    return row


@router.get("/fee-structures", response_model=list[FeeStructureOut], dependencies=[Depends(require_permission("finance.fees.view"))])
def list_fee_structures(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_fee_structures(db, tenant_id=tenant.id)


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
            name=s.name,
            is_active=s.is_active,
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
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/scholarships", response_model=list[ScholarshipOut], dependencies=[Depends(require_permission("finance.scholarships.view"))])
def list_scholarships(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_scholarships(db, tenant_id=tenant.id)


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
            scholarship_id=payload.scholarship_id,
        )
        db.commit()
        db.refresh(inv)
        return inv
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/invoices", response_model=list[InvoiceOut], dependencies=[Depends(require_permission("finance.invoices.view"))])
def list_invoices(
    enrollment_id: UUID | None = Query(default=None),
    invoice_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_invoices(db, tenant_id=tenant.id, enrollment_id=enrollment_id, invoice_type=invoice_type)


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
        return pay
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/payments", response_model=list[PaymentWithAllocationsOut], dependencies=[Depends(require_permission("finance.payments.view"))])
def list_payments(
    enrollment_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_payments(db, tenant_id=tenant.id, enrollment_id=enrollment_id)


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
