from __future__ import annotations

from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import select, func as sa_func

from app.core.audit import log_event

from app.models.finance_policy import FinancePolicy
from app.models.fee_catalog import FeeCategory, FeeItem
from app.models.fee_structure import FeeStructure, FeeStructureItem
from app.models.scholarship import Scholarship
from app.models.invoice import Invoice, InvoiceLine
from app.models.payment import Payment, PaymentAllocation


# -------------------------
# Policy
# -------------------------
def get_or_create_policy(db: Session, *, tenant_id: UUID) -> FinancePolicy:
    row = db.execute(select(FinancePolicy).where(FinancePolicy.tenant_id == tenant_id)).scalar_one_or_none()
    if row:
        return row
    row = FinancePolicy(tenant_id=tenant_id)
    db.add(row)
    db.flush()
    return row


def upsert_policy(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], data: dict) -> FinancePolicy:
    row = get_or_create_policy(db, tenant_id=tenant_id)

    row.allow_partial_enrollment = bool(data.get("allow_partial_enrollment", row.allow_partial_enrollment))
    row.min_percent_to_enroll = data.get("min_percent_to_enroll", row.min_percent_to_enroll)
    row.min_amount_to_enroll = data.get("min_amount_to_enroll", row.min_amount_to_enroll)
    row.require_interview_fee_before_submit = bool(
        data.get("require_interview_fee_before_submit", row.require_interview_fee_before_submit)
    )
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="finance.policy.upsert",
        resource="finance_policy",
        resource_id=row.id,
        payload={"allow_partial_enrollment": row.allow_partial_enrollment},
        meta=None,
    )
    return row


# -------------------------
# Fee Catalog CRUD
# -------------------------
def create_fee_category(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], code: str, name: str, is_active: bool) -> FeeCategory:
    norm_code = code.lower().strip()
    # prevent duplicate codes per tenant
    existing = db.execute(
        select(FeeCategory).where(FeeCategory.tenant_id == tenant_id, FeeCategory.code == norm_code)
    ).scalar_one_or_none()
    if existing:
        raise ValueError("Fee category code already exists for this tenant")

    row = FeeCategory(tenant_id=tenant_id, code=norm_code, name=name.strip(), is_active=is_active)
    db.add(row)
    db.flush()
    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="fees.category.create", resource="fee_category", resource_id=row.id, payload={"code": row.code}, meta=None)
    return row


def list_fee_categories(db: Session, *, tenant_id: UUID) -> list[FeeCategory]:
    return db.execute(select(FeeCategory).where(FeeCategory.tenant_id == tenant_id).order_by(FeeCategory.created_at.desc())).scalars().all()


def list_fee_categories_filtered(db: Session, *, tenant_id: UUID, search: str | None = None, is_active: bool | None = None, page: int = 1, page_size: int = 50, sort: str = "-created_at") -> list[FeeCategory]:
    q = select(FeeCategory).where(FeeCategory.tenant_id == tenant_id)
    if search:
        term = f"%{search.strip()}%"
        q = q.where((FeeCategory.name.ilike(term)) | (FeeCategory.code.ilike(term)))
    if is_active is not None:
        q = q.where(FeeCategory.is_active == bool(is_active))

    # sort handling: allow 'code' or 'created_at', prefix '-' for desc
    direction = "desc"
    field = "created_at"
    if sort:
        s = sort.strip()
        if s.startswith("-"):
            direction = "desc"
            s = s[1:]
        else:
            direction = "asc"
        if s in ("code", "created_at"):
            field = s

    if field == "code":
        q = q.order_by(FeeCategory.code.asc() if direction == "asc" else FeeCategory.code.desc())
    else:
        q = q.order_by(FeeCategory.created_at.asc() if direction == "asc" else FeeCategory.created_at.desc())

    offset = (max(page, 1) - 1) * max(min(page_size, 500), 1)
    q = q.offset(offset).limit(max(min(page_size, 500), 1))
    return db.execute(q).scalars().all()


def create_fee_item(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], category_id: UUID, code: str, name: str, is_active: bool) -> FeeItem:
    category = db.execute(
        select(FeeCategory).where(
            FeeCategory.id == category_id,
            FeeCategory.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not category:
        raise ValueError("Fee category not found in this tenant")

    norm_code = code.lower().strip()
    # ensure unique fee item code within tenant
    existing = db.execute(
        select(FeeItem).where(FeeItem.tenant_id == tenant_id, FeeItem.code == norm_code)
    ).scalar_one_or_none()
    if existing:
        raise ValueError("Fee item code already exists for this tenant")

    row = FeeItem(
        tenant_id=tenant_id,
        category_id=category_id,
        code=norm_code,
        name=name.strip(),
        is_active=is_active,
    )
    db.add(row)
    db.flush()
    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="fees.item.create", resource="fee_item", resource_id=row.id, payload={"code": row.code}, meta=None)
    return row


def list_fee_items(db: Session, *, tenant_id: UUID) -> list[FeeItem]:
    return db.execute(select(FeeItem).where(FeeItem.tenant_id == tenant_id).order_by(FeeItem.created_at.desc())).scalars().all()


def list_fee_items_filtered(db: Session, *, tenant_id: UUID, search: str | None = None, category_id: UUID | None = None, is_active: bool | None = None, page: int = 1, page_size: int = 50, sort: str = "-created_at") -> list[FeeItem]:
    q = select(FeeItem).where(FeeItem.tenant_id == tenant_id)
    if category_id:
        q = q.where(FeeItem.category_id == category_id)
    if search:
        term = f"%{search.strip()}%"
        q = q.where((FeeItem.name.ilike(term)) | (FeeItem.code.ilike(term)))
    if is_active is not None:
        q = q.where(FeeItem.is_active == bool(is_active))

    direction = "desc"
    field = "created_at"
    if sort:
        s = sort.strip()
        if s.startswith("-"):
            direction = "desc"
            s = s[1:]
        else:
            direction = "asc"
        if s in ("code", "created_at"):
            field = s

    if field == "code":
        q = q.order_by(FeeItem.code.asc() if direction == "asc" else FeeItem.code.desc())
    else:
        q = q.order_by(FeeItem.created_at.asc() if direction == "asc" else FeeItem.created_at.desc())

    offset = (max(page, 1) - 1) * max(min(page_size, 500), 1)
    q = q.offset(offset).limit(max(min(page_size, 500), 1))
    return db.execute(q).scalars().all()


# -------------------------
# Fee Structure CRUD
# -------------------------
def create_fee_structure(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], class_code: str, name: str, is_active: bool) -> FeeStructure:
    row = FeeStructure(tenant_id=tenant_id, class_code=class_code.strip(), name=name.strip(), is_active=is_active)
    db.add(row)
    db.flush()
    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="fees.structure.create", resource="fee_structure", resource_id=row.id, payload={"class_code": row.class_code}, meta=None)
    return row


def list_fee_structures(db: Session, *, tenant_id: UUID) -> list[FeeStructure]:
    return db.execute(
        select(FeeStructure)
        .where(FeeStructure.tenant_id == tenant_id)
        .order_by(FeeStructure.created_at.desc())
    ).scalars().all()


def update_fee_structure(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], structure_id: UUID, updates: dict) -> FeeStructure:
    structure = _get_structure_or_error(db, tenant_id=tenant_id, structure_id=structure_id)

    if "class_code" in updates and updates["class_code"] is not None:
        structure.class_code = str(updates["class_code"]).strip()
    if "name" in updates and updates["name"] is not None:
        structure.name = str(updates["name"]).strip()
    if "is_active" in updates and updates["is_active"] is not None:
        structure.is_active = bool(updates["is_active"])

    db.flush()
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.structure.update",
        resource="fee_structure",
        resource_id=structure.id,
        payload={"class_code": structure.class_code, "name": structure.name, "is_active": structure.is_active},
        meta=None,
    )
    return structure


def delete_fee_structure(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], structure_id: UUID) -> None:
    structure = _get_structure_or_error(db, tenant_id=tenant_id, structure_id=structure_id)
    db.delete(structure)
    db.flush()
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.structure.delete",
        resource="fee_structure",
        resource_id=structure_id,
        payload=None,
        meta=None,
    )


def _get_structure_or_error(db: Session, *, tenant_id: UUID, structure_id: UUID) -> FeeStructure:
    structure = db.execute(
        select(FeeStructure).where(
            FeeStructure.id == structure_id,
            FeeStructure.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not structure:
        raise ValueError("Fee structure not found")
    return structure


def _list_structure_items_detailed(db: Session, *, tenant_id: UUID, structure_id: UUID) -> list[dict]:
    rows = db.execute(
        select(
            FeeStructureItem.fee_item_id,
            FeeStructureItem.amount,
            FeeItem.code.label("fee_item_code"),
            FeeItem.name.label("fee_item_name"),
            FeeCategory.id.label("category_id"),
            FeeCategory.code.label("category_code"),
            FeeCategory.name.label("category_name"),
        )
        .select_from(FeeStructureItem)
        .join(FeeItem, FeeItem.id == FeeStructureItem.fee_item_id)
        .join(FeeCategory, FeeCategory.id == FeeItem.category_id)
        .join(FeeStructure, FeeStructure.id == FeeStructureItem.structure_id)
        .where(
            FeeStructureItem.structure_id == structure_id,
            FeeStructure.tenant_id == tenant_id,
            FeeItem.tenant_id == tenant_id,
            FeeCategory.tenant_id == tenant_id,
        )
        .order_by(FeeCategory.code.asc(), FeeItem.code.asc())
    ).all()

    return [
        {
            "fee_item_id": row.fee_item_id,
            "amount": row.amount,
            "fee_item_code": row.fee_item_code,
            "fee_item_name": row.fee_item_name,
            "category_id": row.category_id,
            "category_code": row.category_code,
            "category_name": row.category_name,
        }
        for row in rows
    ]


def upsert_fee_structure_items(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], structure_id: UUID, items: list[dict]) -> None:
    _get_structure_or_error(db, tenant_id=tenant_id, structure_id=structure_id)

    seen_fee_item_ids: set[UUID] = set()
    for it in items:
        amount = Decimal(it["amount"])
        if amount <= 0:
            raise ValueError("Each structure item amount must be > 0")
        fee_item_id = it["fee_item_id"]
        if fee_item_id in seen_fee_item_ids:
            raise ValueError("Duplicate fee items are not allowed in a structure")
        seen_fee_item_ids.add(fee_item_id)

    if seen_fee_item_ids:
        found_items = db.execute(
            select(FeeItem.id).where(
                FeeItem.id.in_(list(seen_fee_item_ids)),
                FeeItem.tenant_id == tenant_id,
            )
        ).scalars().all()
        if len(found_items) != len(seen_fee_item_ids):
            raise ValueError("One or more fee items do not belong to this tenant")

    # Hard-replace items
    db.query(FeeStructureItem).filter(FeeStructureItem.structure_id == structure_id).delete()

    for it in items:
        db.add(FeeStructureItem(structure_id=structure_id, fee_item_id=it["fee_item_id"], amount=it["amount"]))
    db.flush()

    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="fees.structure.items.upsert", resource="fee_structure", resource_id=structure_id, payload={"count": len(items)}, meta=None)


def add_or_update_structure_item(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], structure_id: UUID, item: dict) -> dict:
    _get_structure_or_error(db, tenant_id=tenant_id, structure_id=structure_id)

    amount = Decimal(item["amount"])
    if amount <= 0:
        raise ValueError("Amount must be > 0")

    fee_item_id = item.get("fee_item_id")
    inline_fee_item = item.get("fee_item")

    if fee_item_id and inline_fee_item:
        raise ValueError("Provide either fee_item_id or fee_item payload, not both")

    if inline_fee_item:
        category = db.execute(
            select(FeeCategory).where(
                FeeCategory.id == inline_fee_item["category_id"],
                FeeCategory.tenant_id == tenant_id,
            )
        ).scalar_one_or_none()
        if not category:
            raise ValueError("Fee category not found in this tenant")

        code = str(inline_fee_item["code"]).lower().strip()
        name = str(inline_fee_item["name"]).strip()
        is_active = bool(inline_fee_item.get("is_active", True))

        existing_fee_item = db.execute(
            select(FeeItem).where(
                FeeItem.tenant_id == tenant_id,
                FeeItem.code == code,
            )
        ).scalar_one_or_none()

        if existing_fee_item:
            if existing_fee_item.category_id != category.id:
                raise ValueError("Fee item code already exists in a different category")
            existing_fee_item.name = name
            existing_fee_item.is_active = is_active
            db.flush()
            fee_item_id = existing_fee_item.id
        else:
            created_fee_item = create_fee_item(
                db,
                tenant_id=tenant_id,
                actor_user_id=actor_user_id,
                category_id=category.id,
                code=code,
                name=name,
                is_active=is_active,
            )
            fee_item_id = created_fee_item.id

    if not fee_item_id:
        raise ValueError("fee_item_id or fee_item payload is required")

    fee_item = db.execute(
        select(FeeItem).where(
            FeeItem.id == fee_item_id,
            FeeItem.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not fee_item:
        raise ValueError("Fee item not found in this tenant")

    link = db.execute(
        select(FeeStructureItem).where(
            FeeStructureItem.structure_id == structure_id,
            FeeStructureItem.fee_item_id == fee_item_id,
        )
    ).scalar_one_or_none()

    if link:
        link.amount = amount
    else:
        db.add(FeeStructureItem(structure_id=structure_id, fee_item_id=fee_item_id, amount=amount))
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.structure.item.upsert",
        resource="fee_structure",
        resource_id=structure_id,
        payload={"fee_item_id": str(fee_item_id), "amount": str(amount)},
        meta=None,
    )

    details = _list_structure_items_detailed(db, tenant_id=tenant_id, structure_id=structure_id)
    match = next((entry for entry in details if str(entry["fee_item_id"]) == str(fee_item_id)), None)
    if not match:
        raise ValueError("Failed to load structure item details")
    return match


def remove_structure_item(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], structure_id: UUID, fee_item_id: UUID) -> None:
    _get_structure_or_error(db, tenant_id=tenant_id, structure_id=structure_id)

    fee_item = db.execute(
        select(FeeItem).where(
            FeeItem.id == fee_item_id,
            FeeItem.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not fee_item:
        raise ValueError("Fee item not found in this tenant")

    link = db.execute(
        select(FeeStructureItem).where(
            FeeStructureItem.structure_id == structure_id,
            FeeStructureItem.fee_item_id == fee_item_id,
        )
    ).scalar_one_or_none()
    if not link:
        raise ValueError("Fee item is not attached to this structure")

    db.delete(link)
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.structure.item.remove",
        resource="fee_structure",
        resource_id=structure_id,
        payload={"fee_item_id": str(fee_item_id)},
        meta=None,
    )


def get_structure_with_items(db: Session, *, tenant_id: UUID, structure_id: UUID) -> tuple[FeeStructure, list[dict]]:
    structure = _get_structure_or_error(db, tenant_id=tenant_id, structure_id=structure_id)
    items = _list_structure_items_detailed(db, tenant_id=tenant_id, structure_id=structure_id)
    return structure, items


def find_structure_by_class(db: Session, *, tenant_id: UUID, class_code: str) -> FeeStructure | None:
    return db.execute(
        select(FeeStructure).where(
            FeeStructure.tenant_id == tenant_id,
            FeeStructure.class_code == class_code.strip(),
            FeeStructure.is_active == True,
        )
    ).scalar_one_or_none()


def assign_fee_structure_to_enrollment(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], enrollment_id: UUID, fee_structure_id: UUID, generate_invoice: bool = False, meta: dict | None = None):
    # validate structure
    structure = db.execute(
        select(FeeStructure).where(FeeStructure.id == fee_structure_id, FeeStructure.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not structure:
        raise ValueError("Fee structure not found for this tenant")

    # create assignment record (import locally to avoid circular imports)
    from app.models.student_fee_assignment import StudentFeeAssignment

    assignment = StudentFeeAssignment(
        tenant_id=tenant_id,
        enrollment_id=enrollment_id,
        fee_structure_id=fee_structure_id,
        meta=meta,
    )
    db.add(assignment)
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.structure.assign",
        resource="student_fee_assignment",
        resource_id=assignment.id,
        payload={"fee_structure_id": str(fee_structure_id), "enrollment_id": str(enrollment_id)},
        meta=meta,
    )

    # optionally generate invoice now
    if generate_invoice:
        try:
            generate_school_fees_invoice_from_structure(db, tenant_id=tenant_id, actor_user_id=actor_user_id, enrollment_id=enrollment_id, class_code=structure.class_code, scholarship_id=None)
            db.flush()
        except Exception:
            # don't block assignment if invoice generation fails; surface to caller if desired
            pass

    return assignment


# -------------------------
# Scholarships CRUD
# -------------------------
def create_scholarship(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], name: str, type_: str, value: Decimal, is_active: bool) -> Scholarship:
    t = type_.upper().strip()
    if t not in ("PERCENT", "FIXED"):
        raise ValueError("Scholarship type must be PERCENT or FIXED")

    row = Scholarship(tenant_id=tenant_id, name=name.strip(), type=t, value=value, is_active=is_active)
    db.add(row)
    db.flush()

    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="scholarship.create", resource="scholarship", resource_id=row.id, payload={"type": row.type, "value": str(row.value)}, meta=None)
    return row


def list_scholarships(db: Session, *, tenant_id: UUID) -> list[Scholarship]:
    return db.execute(select(Scholarship).where(Scholarship.tenant_id == tenant_id).order_by(Scholarship.created_at.desc())).scalars().all()


# -------------------------
# Invoices
# -------------------------
def _recalc_invoice_amounts(db: Session, invoice: Invoice) -> None:
    total = db.execute(select(sa_func.coalesce(sa_func.sum(InvoiceLine.amount), 0)).where(InvoiceLine.invoice_id == invoice.id)).scalar_one()
    invoice.total_amount = total
    # paid_amount is derived from allocations
    paid = db.execute(select(sa_func.coalesce(sa_func.sum(PaymentAllocation.amount), 0)).where(PaymentAllocation.invoice_id == invoice.id)).scalar_one()
    invoice.paid_amount = paid
    invoice.balance_amount = (Decimal(total) - Decimal(paid))

    # set status
    if invoice.total_amount == 0:
        invoice.status = "DRAFT"
    elif invoice.balance_amount <= 0:
        invoice.status = "PAID"
    elif invoice.paid_amount > 0:
        invoice.status = "PARTIAL"
    else:
        invoice.status = "ISSUED"


def create_invoice(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], invoice_type: str, enrollment_id: UUID, lines: list[dict]) -> Invoice:
    t = invoice_type.upper().strip()
    if t not in ("INTERVIEW", "SCHOOL_FEES"):
        raise ValueError("Invalid invoice_type")

    inv = Invoice(tenant_id=tenant_id, invoice_type=t, enrollment_id=enrollment_id, status="DRAFT")
    db.add(inv)
    db.flush()

    for ln in lines:
        db.add(InvoiceLine(invoice_id=inv.id, description=ln["description"], amount=ln["amount"], meta=ln.get("meta")))

    db.flush()
    _recalc_invoice_amounts(db, inv)
    db.flush()

    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="invoice.create", resource="invoice", resource_id=inv.id, payload={"type": inv.invoice_type, "status": inv.status}, meta=None)
    return inv


def list_invoices(db: Session, *, tenant_id: UUID, enrollment_id: Optional[UUID] = None, invoice_type: Optional[str] = None) -> list[Invoice]:
    q = select(Invoice).where(Invoice.tenant_id == tenant_id)
    if enrollment_id:
        q = q.where(Invoice.enrollment_id == enrollment_id)
    if invoice_type:
        q = q.where(Invoice.invoice_type == invoice_type.upper().strip())
    return db.execute(q.order_by(Invoice.created_at.desc())).scalars().all()


def get_invoice(db: Session, *, tenant_id: UUID, invoice_id: UUID) -> Invoice | None:
    return db.execute(select(Invoice).where(Invoice.tenant_id == tenant_id, Invoice.id == invoice_id)).scalar_one_or_none()


def generate_school_fees_invoice_from_structure(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    enrollment_id: UUID,
    class_code: str,
    scholarship_id: Optional[UUID],
) -> Invoice:
    structure = find_structure_by_class(db, tenant_id=tenant_id, class_code=class_code)
    if not structure:
        raise ValueError("Fee structure not found for class_code")

    # pull items with fee item name for better invoice descriptions
    items = db.execute(
        select(
            FeeStructureItem.amount,
            FeeItem.id.label("fee_item_id"),
            FeeItem.name.label("fee_item_name"),
            FeeItem.code.label("fee_item_code"),
        )
        .select_from(FeeStructureItem)
        .join(FeeItem, FeeItem.id == FeeStructureItem.fee_item_id)
        .where(
            FeeStructureItem.structure_id == structure.id,
            FeeItem.tenant_id == tenant_id,
        )
    ).all()
    if not items:
        raise ValueError("Fee structure has no items")

    # build lines
    lines: list[dict] = []
    for it in items:
        lines.append(
            {
                "description": f"{it.fee_item_name} ({structure.class_code})",
                "amount": it.amount,
                "meta": {"fee_item_id": str(it.fee_item_id), "fee_item_code": it.fee_item_code},
            }
        )

    inv = create_invoice(db, tenant_id=tenant_id, actor_user_id=actor_user_id, invoice_type="SCHOOL_FEES", enrollment_id=enrollment_id, lines=lines)

    # apply scholarship as a negative line (discount)
    if scholarship_id:
        sch = db.execute(select(Scholarship).where(Scholarship.tenant_id == tenant_id, Scholarship.id == scholarship_id, Scholarship.is_active == True)).scalar_one_or_none()
        if not sch:
            raise ValueError("Scholarship not found")

        # compute discount based on current total
        current_total = Decimal(inv.total_amount)
        discount = Decimal("0")
        if sch.type == "PERCENT":
            discount = (current_total * Decimal(sch.value) / Decimal("100"))
        else:
            discount = Decimal(sch.value)

        if discount > 0:
            db.add(InvoiceLine(invoice_id=inv.id, description=f"Scholarship: {sch.name}", amount=(discount * Decimal("-1")), meta={"scholarship_id": str(sch.id)}))
            db.flush()
            _recalc_invoice_amounts(db, inv)
            db.flush()

        log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="invoice.scholarship.apply", resource="invoice", resource_id=inv.id, payload={"scholarship_id": str(sch.id), "discount": str(discount)}, meta=None)

    return inv


# -------------------------
# Payments
# -------------------------
def create_payment(db: Session, *, tenant_id: UUID, actor_user_id: Optional[UUID], provider: str, reference: Optional[str], amount: Decimal, allocations: list[dict]) -> Payment:
    provider_code = provider.upper().strip()
    if provider_code not in ("CASH", "MPESA", "BANK", "CHEQUE"):
        raise ValueError("Invalid payment provider")

    if amount <= 0:
        raise ValueError("Payment amount must be > 0")
    if not allocations:
        raise ValueError("Allocations required")

    invoice_ids = [a["invoice_id"] for a in allocations]
    if len(set(invoice_ids)) != len(invoice_ids):
        raise ValueError("Duplicate invoice allocations are not allowed")

    normalized_allocations: list[tuple[UUID, Decimal]] = []
    for a in allocations:
        alloc_amount = Decimal(a["amount"])
        if alloc_amount <= 0:
            raise ValueError("Allocation amount must be > 0")
        normalized_allocations.append((a["invoice_id"], alloc_amount))

    alloc_sum = sum([alloc for _, alloc in normalized_allocations], Decimal("0"))
    if alloc_sum.quantize(Decimal("0.01")) != Decimal(amount).quantize(Decimal("0.01")):
        raise ValueError("Allocations sum must equal payment amount")

    pay = Payment(tenant_id=tenant_id, provider=provider_code, reference=reference, amount=amount, created_by=actor_user_id)
    db.add(pay)
    db.flush()

    # validate invoices belong to tenant
    invoices = db.execute(select(Invoice).where(Invoice.tenant_id == tenant_id, Invoice.id.in_(invoice_ids))).scalars().all()
    if len(invoices) != len(set(invoice_ids)):
        raise ValueError("One or more invoices not found in this tenant")

    invoice_map = {inv.id: inv for inv in invoices}
    for invoice_id, alloc_amount in normalized_allocations:
        inv = invoice_map[invoice_id]
        if Decimal(inv.balance_amount) <= 0:
            raise ValueError(f"Invoice {inv.id} is already fully paid")
        if alloc_amount > Decimal(inv.balance_amount):
            raise ValueError(f"Allocation exceeds outstanding balance for invoice {inv.id}")
        db.add(PaymentAllocation(payment_id=pay.id, invoice_id=invoice_id, amount=alloc_amount))

    db.flush()

    # recalc invoices
    for inv in invoices:
        _recalc_invoice_amounts(db, inv)
    db.flush()

    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="payment.create", resource="payment", resource_id=pay.id, payload={"provider": pay.provider, "amount": str(pay.amount)}, meta=None)
    return pay


def list_payments(db: Session, *, tenant_id: UUID, enrollment_id: Optional[UUID] = None) -> list[dict]:
    payment_rows = db.execute(
        select(Payment)
        .where(Payment.tenant_id == tenant_id)
        .order_by(Payment.received_at.desc())
    ).scalars().all()

    payments: list[dict] = []
    for payment in payment_rows:
        alloc_query = (
            select(PaymentAllocation.invoice_id, PaymentAllocation.amount)
            .select_from(PaymentAllocation)
            .join(Invoice, Invoice.id == PaymentAllocation.invoice_id)
            .where(
                PaymentAllocation.payment_id == payment.id,
                Invoice.tenant_id == tenant_id,
            )
        )
        if enrollment_id:
            alloc_query = alloc_query.where(Invoice.enrollment_id == enrollment_id)

        allocations = db.execute(alloc_query).all()
        if enrollment_id and len(allocations) == 0:
            continue

        payments.append(
            {
                "id": payment.id,
                "tenant_id": payment.tenant_id,
                "provider": payment.provider,
                "reference": payment.reference,
                "amount": payment.amount,
                "allocations": [
                    {"invoice_id": row.invoice_id, "amount": row.amount} for row in allocations
                ],
            }
        )

    return payments


# -------------------------
# Enrollment eligibility helper
# -------------------------
def get_enrollment_finance_status(db: Session, *, tenant_id: UUID, enrollment_id: UUID) -> dict:
    # Find interview + fees invoice for the enrollment
    invs = db.execute(select(Invoice).where(Invoice.tenant_id == tenant_id, Invoice.enrollment_id == enrollment_id)).scalars().all()

    interview = next((i for i in invs if i.invoice_type == "INTERVIEW"), None)
    fees = next((i for i in invs if i.invoice_type == "SCHOOL_FEES"), None)

    policy = get_or_create_policy(db, tenant_id=tenant_id)

    def paid_ok(inv: Optional[Invoice]) -> bool:
        return bool(inv and inv.status == "PAID")

    def partial_ok(inv: Optional[Invoice]) -> bool:
        if not inv:
            return False
        if inv.status == "PAID":
            return True
        if not policy.allow_partial_enrollment:
            return False
        # percent threshold
        if policy.min_percent_to_enroll is not None and inv.total_amount and inv.total_amount > 0:
            pct = (Decimal(inv.paid_amount) / Decimal(inv.total_amount)) * Decimal("100")
            return pct >= Decimal(policy.min_percent_to_enroll)
        # amount threshold
        if policy.min_amount_to_enroll is not None:
            return Decimal(inv.paid_amount) >= Decimal(policy.min_amount_to_enroll)
        # allow any partial if policy says allow and no thresholds set
        return Decimal(inv.paid_amount) > 0

    return {
        "policy": {
            "allow_partial_enrollment": policy.allow_partial_enrollment,
            "min_percent_to_enroll": policy.min_percent_to_enroll,
            "min_amount_to_enroll": str(policy.min_amount_to_enroll) if policy.min_amount_to_enroll is not None else None,
            "require_interview_fee_before_submit": policy.require_interview_fee_before_submit,
        },
        "interview": {
            "invoice_id": str(interview.id) if interview else None,
            "status": interview.status if interview else None,
            "paid_ok": paid_ok(interview),
        },
        "fees": {
            "invoice_id": str(fees.id) if fees else None,
            "status": fees.status if fees else None,
            "paid_ok": paid_ok(fees),
            "partial_ok": partial_ok(fees),
        },
    }
