from __future__ import annotations

from decimal import Decimal
from datetime import datetime, timezone
import hashlib
import json
import logging
from typing import Any, Optional
from uuid import UUID

logger = logging.getLogger(__name__)

from sqlalchemy.orm import Session
from sqlalchemy import select, func as sa_func

from app.core.audit import log_event

from app.models.finance_policy import FinancePolicy
from app.models.finance_structure_policy import FinanceStructurePolicy
from app.models.fee_catalog import FeeCategory, FeeItem
from app.models.fee_structure import FeeStructure, FeeStructureItem
from app.models.enrollment import Enrollment
from app.models.scholarship import Scholarship
from app.models.scholarship_allocation import ScholarshipAllocation
from app.models.invoice import Invoice, InvoiceLine
from app.models.payment import Payment, PaymentAllocation
from app.models.tenant import Tenant
from app.models.tenant_print_profile import TenantPrintProfile
from app.models.document_sequence import DocumentSequence


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


def _norm_upper(value: str) -> str:
    return value.strip().upper()


def _normalize_term_code(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return "GENERAL"
    return raw.replace(" ", "_").upper()


def _extract_enrollment_term_code(payload: dict[str, Any] | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    candidates = [
        payload.get("admission_term"),
        payload.get("term_code"),
        payload.get("term"),
        payload.get("academic_term"),
    ]
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return _normalize_term_code(value)
    return None


def _uuid_from_any(value: Any) -> UUID | None:
    if value is None:
        return None
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except Exception:
        return None


def _document_year(value: datetime | None = None) -> int:
    dt = value or datetime.now(timezone.utc)
    return int(dt.year)


def _next_document_number(
    db: Session,
    *,
    tenant_id: UUID,
    doc_type: str,
    created_at: datetime | None = None,
) -> str:
    dtype = str(doc_type or "").strip().upper()
    if dtype not in {"INV", "RCT", "FS"}:
        raise ValueError("Unsupported doc_type")

    year = _document_year(created_at)
    try:
        with db.begin_nested():
            row = db.execute(
                select(DocumentSequence)
                .where(
                    DocumentSequence.tenant_id == tenant_id,
                    DocumentSequence.doc_type == dtype,
                    DocumentSequence.year == year,
                )
                .with_for_update()
            ).scalar_one_or_none()

            if row is None:
                row = DocumentSequence(
                    tenant_id=tenant_id,
                    doc_type=dtype,
                    year=year,
                    next_seq=2,
                )
                db.add(row)
                seq = 1
            else:
                seq = int(row.next_seq or 1)
                row.next_seq = seq + 1
                row.updated_at = datetime.now(timezone.utc)

        return f"{dtype}-{year:04d}-{seq:06d}"
    except Exception:
        # Safe fallback if document_sequences migration has not been applied yet.
        # We avoid rolling back the outer transaction so core workflow can continue.
        fallback_seq = datetime.now(timezone.utc).strftime("%H%M%S")
        return f"{dtype}-{year:04d}-{fallback_seq}"


def _document_checksum(
    *,
    tenant_id: UUID,
    document_id: UUID,
    document_no: str,
    document_type: str,
) -> str:
    payload = f"{tenant_id}|{document_type}|{document_id}|{document_no}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def _coerce_profile_paper_size(value: str | None) -> str:
    v = str(value or "").strip().upper()
    return v if v in {"A4", "THERMAL_80MM"} else "A4"


def _profile_to_dict(profile: TenantPrintProfile | None, *, tenant_name: str | None) -> dict[str, Any]:
    school_header = (
        str(getattr(profile, "school_header", "") or "").strip()
        or str(tenant_name or "").strip()
        or "School Management System"
    )

    def _s(attr: str) -> str | None:
        if profile is None:
            return None
        val = str(getattr(profile, attr, "") or "").strip()
        return val or None

    return {
        "logo_url": (str(getattr(profile, "logo_url", "") or "").strip() or None),
        "school_header": school_header,
        "receipt_footer": (
            str(getattr(profile, "receipt_footer", "") or "").strip()
            or "Thank you for partnering with us."
        ),
        "paper_size": _coerce_profile_paper_size(getattr(profile, "paper_size", "A4")),
        "currency": str(getattr(profile, "currency", "KES") or "KES"),
        "thermal_width_mm": int(getattr(profile, "thermal_width_mm", 80) or 80),
        "qr_enabled": bool(getattr(profile, "qr_enabled", True)),
        "po_box": _s("po_box"),
        "physical_address": _s("physical_address"),
        "phone": _s("phone"),
        "email": _s("email"),
        "school_motto": _s("school_motto"),
        "authorized_signatory_name": _s("authorized_signatory_name"),
        "authorized_signatory_title": _s("authorized_signatory_title"),
    }


def get_tenant_print_profile(db: Session, *, tenant_id: UUID) -> dict[str, Any]:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise ValueError("Tenant not found")

    try:
        profile = db.execute(
            select(TenantPrintProfile).where(TenantPrintProfile.tenant_id == tenant_id)
        ).scalar_one_or_none()
    except Exception:
        db.rollback()
        profile = None
    return _profile_to_dict(profile, tenant_name=getattr(tenant, "name", None))


def _extract_student_name(payload: dict[str, Any] | None) -> str:
    if not isinstance(payload, dict):
        return "Unknown student"
    candidates = [
        payload.get("student_name"),
        payload.get("studentName"),
        payload.get("full_name"),
        payload.get("fullName"),
        payload.get("name"),
        payload.get("applicant_name"),
    ]
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    first = str(payload.get("first_name") or "").strip()
    last = str(payload.get("last_name") or "").strip()
    full = f"{first} {last}".strip()
    return full or "Unknown student"


def _get_structure_in_tenant(db: Session, *, tenant_id: UUID, fee_structure_id: UUID) -> FeeStructure | None:
    return db.execute(
        select(FeeStructure).where(
            FeeStructure.id == fee_structure_id,
            FeeStructure.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()


def _validate_fee_item_belongs_to_structure(
    db: Session,
    *,
    structure_id: UUID,
    fee_item_id: UUID,
    tenant_id: UUID,
) -> None:
    row = db.execute(
        select(FeeStructureItem)
        .join(FeeItem, FeeItem.id == FeeStructureItem.fee_item_id)
        .where(
            FeeStructureItem.structure_id == structure_id,
            FeeStructureItem.fee_item_id == fee_item_id,
            FeeItem.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if row is None:
        raise ValueError("fee_item_id is not attached to this fee structure")


def list_fee_structure_policies(
    db: Session,
    *,
    tenant_id: UUID,
    fee_structure_id: UUID | None = None,
) -> list[FinanceStructurePolicy]:
    q = select(FinanceStructurePolicy).where(FinanceStructurePolicy.tenant_id == tenant_id)
    if fee_structure_id is not None:
        q = q.where(FinanceStructurePolicy.fee_structure_id == fee_structure_id)
    return db.execute(
        q.order_by(
            FinanceStructurePolicy.fee_structure_id.asc(),
            FinanceStructurePolicy.fee_item_id.asc().nullsfirst(),
            FinanceStructurePolicy.created_at.desc(),
        )
    ).scalars().all()


def upsert_fee_structure_policy(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID | None,
    fee_structure_id: UUID,
    fee_item_id: UUID | None,
    allow_partial_enrollment: bool,
    min_percent_to_enroll: int | None,
    min_amount_to_enroll: Decimal | None,
) -> FinanceStructurePolicy:
    structure = _get_structure_in_tenant(
        db, tenant_id=tenant_id, fee_structure_id=fee_structure_id
    )
    if structure is None:
        raise ValueError("Fee structure not found for this tenant")

    if fee_item_id is not None:
        _validate_fee_item_belongs_to_structure(
            db,
            structure_id=fee_structure_id,
            fee_item_id=fee_item_id,
            tenant_id=tenant_id,
        )

    row = db.execute(
        select(FinanceStructurePolicy).where(
            FinanceStructurePolicy.tenant_id == tenant_id,
            FinanceStructurePolicy.fee_structure_id == fee_structure_id,
            FinanceStructurePolicy.fee_item_id == fee_item_id,
        )
    ).scalar_one_or_none()

    if row is None:
        row = FinanceStructurePolicy(
            tenant_id=tenant_id,
            fee_structure_id=fee_structure_id,
            fee_item_id=fee_item_id,
        )
        db.add(row)

    row.allow_partial_enrollment = bool(allow_partial_enrollment)
    row.min_percent_to_enroll = min_percent_to_enroll
    row.min_amount_to_enroll = min_amount_to_enroll
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="finance.structure_policy.upsert",
        resource="finance_structure_policy",
        resource_id=row.id,
        payload={
            "fee_structure_id": str(fee_structure_id),
            "fee_item_id": str(fee_item_id) if fee_item_id else None,
            "allow_partial_enrollment": row.allow_partial_enrollment,
            "min_percent_to_enroll": row.min_percent_to_enroll,
            "min_amount_to_enroll": (
                str(row.min_amount_to_enroll) if row.min_amount_to_enroll is not None else None
            ),
        },
        meta={
            "class_code": getattr(structure, "class_code", None),
            "term_code": getattr(structure, "term_code", None),
        },
    )
    return row


def delete_fee_structure_policy(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID | None,
    fee_structure_id: UUID,
    fee_item_id: UUID | None,
) -> None:
    row = db.execute(
        select(FinanceStructurePolicy).where(
            FinanceStructurePolicy.tenant_id == tenant_id,
            FinanceStructurePolicy.fee_structure_id == fee_structure_id,
            FinanceStructurePolicy.fee_item_id == fee_item_id,
        )
    ).scalar_one_or_none()
    if row is None:
        return

    policy_id = row.id
    db.delete(row)
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="finance.structure_policy.delete",
        resource="finance_structure_policy",
        resource_id=policy_id,
        payload={
            "fee_structure_id": str(fee_structure_id),
            "fee_item_id": str(fee_item_id) if fee_item_id else None,
        },
        meta=None,
    )


# -------------------------
# Fee Catalog CRUD
# -------------------------
def create_fee_category(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    code: str,
    name: str,
    is_active: bool
) -> FeeCategory:
    norm_code = code.upper().strip()
    # prevent duplicate codes per tenant
    existing = db.execute(
        select(FeeCategory).where(FeeCategory.tenant_id == tenant_id, FeeCategory.code == norm_code)
    ).scalar_one_or_none()
    if existing:
        raise ValueError("Fee category code already exists for this tenant")

    row = FeeCategory(tenant_id=tenant_id, code=norm_code, name=name.strip(), is_active=is_active)
    db.add(row)
    db.flush()
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.category.create",
        resource="fee_category",
        resource_id=row.id,
        payload={"code": row.code},
        meta=None,
    )
    return row


def list_fee_categories(db: Session, *, tenant_id: UUID) -> list[FeeCategory]:
    return db.execute(
        select(FeeCategory).where(FeeCategory.tenant_id == tenant_id).order_by(FeeCategory.created_at.desc())
    ).scalars().all()


def list_fee_categories_filtered(
    db: Session,
    *,
    tenant_id: UUID,
    search: str | None = None,
    is_active: bool | None = None,
    page: int = 1,
    page_size: int = 50,
    sort: str = "-created_at"
) -> list[FeeCategory]:
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


def create_fee_item(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    category_id: UUID,
    code: str,
    name: str,
    is_active: bool
) -> FeeItem:
    category = db.execute(
        select(FeeCategory).where(
            FeeCategory.id == category_id,
            FeeCategory.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not category:
        raise ValueError("Fee category not found in this tenant")

    norm_code = code.upper().strip()
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
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.item.create",
        resource="fee_item",
        resource_id=row.id,
        payload={"code": row.code},
        meta=None,
    )
    return row


def list_fee_items(db: Session, *, tenant_id: UUID) -> list[FeeItem]:
    return db.execute(
        select(FeeItem).where(FeeItem.tenant_id == tenant_id).order_by(FeeItem.created_at.desc())
    ).scalars().all()


def list_fee_items_filtered(
    db: Session,
    *,
    tenant_id: UUID,
    search: str | None = None,
    category_id: UUID | None = None,
    is_active: bool | None = None,
    page: int = 1,
    page_size: int = 50,
    sort: str = "-created_at"
) -> list[FeeItem]:
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
def create_fee_structure(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    class_code: str,
    term_code: str,
    name: str,
    is_active: bool
) -> FeeStructure:
    norm_class = _norm_upper(class_code)
    norm_term = _normalize_term_code(term_code)
    if not norm_class:
        raise ValueError("class_code is required")

    existing = db.execute(
        select(FeeStructure).where(
            FeeStructure.tenant_id == tenant_id,
            FeeStructure.class_code == norm_class,
            FeeStructure.term_code == norm_term,
        )
    ).scalar_one_or_none()
    if existing:
        raise ValueError("Fee structure already exists for this class and term")

    row = FeeStructure(
        tenant_id=tenant_id,
        class_code=norm_class,
        term_code=norm_term,
        name=name.strip(),
        is_active=is_active,
    )
    db.add(row)
    db.flush()
    if not getattr(row, "structure_no", None):
        row.structure_no = _next_document_number(
            db,
            tenant_id=tenant_id,
            doc_type="FS",
            created_at=getattr(row, "created_at", None),
        )
        db.flush()
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.structure.create",
        resource="fee_structure",
        resource_id=row.id,
        payload={"class_code": row.class_code, "term_code": row.term_code},
        meta=None,
    )
    return row


def list_fee_structures(db: Session, *, tenant_id: UUID) -> list[FeeStructure]:
    return db.execute(
        select(FeeStructure)
        .where(FeeStructure.tenant_id == tenant_id)
        .order_by(FeeStructure.class_code.asc(), FeeStructure.term_code.asc(), FeeStructure.created_at.desc())
    ).scalars().all()


def update_fee_structure(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    structure_id: UUID,
    updates: dict
) -> FeeStructure:
    structure = _get_structure_or_error(db, tenant_id=tenant_id, structure_id=structure_id)

    next_class_code = structure.class_code
    next_term_code = structure.term_code
    if "class_code" in updates and updates["class_code"] is not None:
        next_class_code = _norm_upper(str(updates["class_code"]))
    if "term_code" in updates and updates["term_code"] is not None:
        next_term_code = _normalize_term_code(str(updates["term_code"]))

    if (next_class_code, next_term_code) != (structure.class_code, structure.term_code):
        duplicate = db.execute(
            select(FeeStructure).where(
                FeeStructure.tenant_id == tenant_id,
                FeeStructure.class_code == next_class_code,
                FeeStructure.term_code == next_term_code,
                FeeStructure.id != structure_id,
            )
        ).scalar_one_or_none()
        if duplicate:
            raise ValueError("Another fee structure already exists for this class and term")
        structure.class_code = next_class_code
        structure.term_code = next_term_code

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
        payload={
            "class_code": structure.class_code,
            "term_code": structure.term_code,
            "name": structure.name,
            "is_active": structure.is_active,
        },
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

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.structure.items.upsert",
        resource="fee_structure",
        resource_id=structure_id,
        payload={"count": len(items)},
        meta=None,
    )


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


def find_structure_by_class(
    db: Session,
    *,
    tenant_id: UUID,
    class_code: str,
    term_code: str | None = None,
) -> FeeStructure | None:
    norm_class = _norm_upper(class_code)
    norm_term = _normalize_term_code(term_code) if term_code else None

    if norm_term:
        row = db.execute(
            select(FeeStructure).where(
                FeeStructure.tenant_id == tenant_id,
                FeeStructure.class_code == norm_class,
                FeeStructure.term_code == norm_term,
                FeeStructure.is_active == True,
            )
        ).scalar_one_or_none()
        if row is not None:
            return row

    return db.execute(
        select(FeeStructure).where(
            FeeStructure.tenant_id == tenant_id,
            FeeStructure.class_code == norm_class,
            FeeStructure.term_code == "GENERAL",
            FeeStructure.is_active == True,
        )
    ).scalar_one_or_none()


def assign_fee_structure_to_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    enrollment_id: UUID,
    fee_structure_id: UUID,
    generate_invoice: bool = False,
    meta: dict | None = None
):
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
            generate_school_fees_invoice_from_structure(
                db,
                tenant_id=tenant_id,
                actor_user_id=actor_user_id,
                enrollment_id=enrollment_id,
                class_code=structure.class_code,
                term_code=structure.term_code,
                scholarship_id=None
            )
            db.flush()
        except Exception:
            # don't block assignment if invoice generation fails
            pass

    return assignment


# -------------------------
# Scholarships CRUD
# -------------------------
def create_scholarship(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    name: str,
    type_: str,
    value: Decimal,
    is_active: bool
) -> Scholarship:
    t = type_.upper().strip()
    if t not in ("PERCENTAGE", "FIXED"):
        raise ValueError("Scholarship type must be PERCENTAGE or FIXED")

    row = Scholarship(tenant_id=tenant_id, name=name.strip(), type=t, value=value, is_active=is_active)
    db.add(row)
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="scholarship.create",
        resource="scholarship",
        resource_id=row.id,
        payload={"type": row.type, "value": str(row.value)},
        meta=None,
    )
    return row


def list_scholarships(db: Session, *, tenant_id: UUID) -> list[Scholarship]:
    return db.execute(
        select(Scholarship).where(Scholarship.tenant_id == tenant_id).order_by(Scholarship.created_at.desc())
    ).scalars().all()


def scholarship_usage_map(
    db: Session,
    *,
    tenant_id: UUID,
    scholarship_ids: list[UUID] | None = None,
) -> dict[UUID, Decimal]:
    q = (
        select(
            ScholarshipAllocation.scholarship_id,
            sa_func.coalesce(sa_func.sum(ScholarshipAllocation.amount), 0).label("allocated"),
        )
        .where(ScholarshipAllocation.tenant_id == tenant_id)
        .group_by(ScholarshipAllocation.scholarship_id)
    )
    if scholarship_ids:
        q = q.where(ScholarshipAllocation.scholarship_id.in_(scholarship_ids))

    rows = db.execute(q).all()
    usage: dict[UUID, Decimal] = {}
    for row in rows:
        usage[row.scholarship_id] = Decimal(row.allocated or 0)
    return usage


# -------------------------
# Invoices
# -------------------------
def _normalize_invoice_type(value: str | None) -> str | None:
    if value is None:
        return None
    t = value.upper().strip()
    if t == "INTERVIEW_FEE":
        return "INTERVIEW"
    return t


def _recalc_invoice_amounts(db: Session, invoice: Invoice) -> None:
    total = db.execute(
        select(sa_func.coalesce(sa_func.sum(InvoiceLine.amount), 0)).where(InvoiceLine.invoice_id == invoice.id)
    ).scalar_one()
    invoice.total_amount = total
    # paid_amount is derived from allocations
    paid = db.execute(
        select(sa_func.coalesce(sa_func.sum(PaymentAllocation.amount), 0)).where(PaymentAllocation.invoice_id == invoice.id)
    ).scalar_one()
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


def create_invoice(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    invoice_type: str,
    enrollment_id: UUID,
    lines: list[dict]
) -> Invoice:
    t = _normalize_invoice_type(invoice_type) or ""
    if t not in ("INTERVIEW", "SCHOOL_FEES"):
        raise ValueError("Invalid invoice_type")

    inv = Invoice(tenant_id=tenant_id, invoice_type=t, enrollment_id=enrollment_id, status="DRAFT")
    db.add(inv)
    db.flush()
    if not getattr(inv, "invoice_no", None):
        inv.invoice_no = _next_document_number(
            db,
            tenant_id=tenant_id,
            doc_type="INV",
            created_at=getattr(inv, "created_at", None),
        )
        db.flush()

    for ln in lines:
        db.add(
            InvoiceLine(
                invoice_id=inv.id,
                description=ln["description"],
                amount=ln["amount"],
                meta=ln.get("meta"),
            )
        )

    db.flush()
    _recalc_invoice_amounts(db, inv)
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="invoice.create",
        resource="invoice",
        resource_id=inv.id,
        payload={"type": inv.invoice_type, "status": inv.status},
        meta=None,
    )
    return inv


def list_invoices(db: Session, *, tenant_id: UUID, enrollment_id: Optional[UUID] = None, invoice_type: Optional[str] = None) -> list[Invoice]:
    q = select(Invoice).where(Invoice.tenant_id == tenant_id)
    if enrollment_id:
        q = q.where(Invoice.enrollment_id == enrollment_id)
    if invoice_type:
        q = q.where(Invoice.invoice_type == (_normalize_invoice_type(invoice_type) or ""))
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
    term_code: str | None,
    scholarship_id: Optional[UUID],
    scholarship_amount: Decimal | None = None,
    scholarship_reason: str | None = None,
) -> Invoice:
    enrollment = db.execute(
        select(Enrollment).where(
            Enrollment.tenant_id == tenant_id,
            Enrollment.id == enrollment_id,
        )
    ).scalar_one_or_none()

    effective_term_code = _normalize_term_code(term_code) if term_code else None
    if effective_term_code is None:
        effective_term_code = _extract_enrollment_term_code(
            getattr(enrollment, "payload", None)
        )

    structure = find_structure_by_class(
        db,
        tenant_id=tenant_id,
        class_code=class_code,
        term_code=effective_term_code,
    )
    if not structure:
        if effective_term_code:
            raise ValueError("Fee structure not found for this class and term")
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

    inv = create_invoice(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        invoice_type="SCHOOL_FEES",
        enrollment_id=enrollment_id,
        lines=lines,
    )
    inv.meta = {
        **(inv.meta or {}),
        "fee_structure_id": str(structure.id),
        "class_code": structure.class_code,
        "term_code": structure.term_code,
    }
    db.flush()

    # apply scholarship as a negative line (discount)
    if scholarship_id:
        sch = db.execute(
            select(Scholarship).where(
                Scholarship.tenant_id == tenant_id,
                Scholarship.id == scholarship_id,
                Scholarship.is_active == True
            )
        ).scalar_one_or_none()
        if not sch:
            raise ValueError("Scholarship not found")

        if scholarship_amount is None:
            raise ValueError("scholarship_amount is required when scholarship_id is provided")
        requested = Decimal(scholarship_amount)
        if requested <= 0:
            raise ValueError("scholarship_amount must be greater than 0")

        reason = (scholarship_reason or "").strip()
        if not reason:
            raise ValueError("scholarship_reason is required when scholarship_id is provided")

        usage = scholarship_usage_map(
            db,
            tenant_id=tenant_id,
            scholarship_ids=[sch.id],
        )
        allocated = usage.get(sch.id, Decimal("0"))
        budget = Decimal(sch.value or 0)
        remaining = max(Decimal("0"), budget - allocated)
        if remaining <= 0:
            raise ValueError("Scholarship has no remaining balance")
        if requested > remaining:
            raise ValueError(
                f"Scholarship remaining balance is {remaining}. Requested {requested} exceeds available amount."
            )

        current_total = max(Decimal(inv.total_amount or 0), Decimal("0"))
        discount = min(requested, current_total)
        if discount <= 0:
            raise ValueError("Cannot apply scholarship to an invoice with zero total amount")

        allocation = ScholarshipAllocation(
            tenant_id=tenant_id,
            scholarship_id=sch.id,
            enrollment_id=enrollment_id,
            invoice_id=inv.id,
            amount=discount,
            reason=reason,
            created_by=actor_user_id,
        )
        db.add(allocation)
        db.flush()

        db.add(
            InvoiceLine(
                invoice_id=inv.id,
                description=f"Scholarship: {sch.name}",
                amount=(discount * Decimal("-1")),
                meta={
                    "scholarship_id": str(sch.id),
                    "scholarship_allocation_id": str(allocation.id),
                    "reason": reason,
                },
            )
        )
        db.flush()
        _recalc_invoice_amounts(db, inv)
        db.flush()

        log_event(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            action="invoice.scholarship.apply",
            resource="invoice",
            resource_id=inv.id,
            payload={
                "scholarship_id": str(sch.id),
                "requested_amount": str(requested),
                "applied_amount": str(discount),
                "remaining_after": str(max(Decimal("0"), remaining - discount)),
                "reason": reason,
            },
            meta=None,
        )

    return inv


# -------------------------
# Payments
# -------------------------
def create_payment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    provider: str,
    reference: Optional[str],
    amount: Decimal,
    allocations: list[dict]
) -> Payment:
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
    if not getattr(pay, "receipt_no", None):
        pay.receipt_no = _next_document_number(
            db,
            tenant_id=tenant_id,
            doc_type="RCT",
            created_at=getattr(pay, "received_at", None),
        )
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

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="payment.create",
        resource="payment",
        resource_id=pay.id,
        payload={"provider": pay.provider, "amount": str(pay.amount)},
        meta=None,
    )
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
                "receipt_no": getattr(payment, "receipt_no", None),
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
# Canonical document payloads + server-side PDF
# -------------------------
def build_invoice_document(
    db: Session,
    *,
    tenant_id: UUID,
    invoice_id: UUID,
) -> dict[str, Any]:
    inv = get_invoice(db, tenant_id=tenant_id, invoice_id=invoice_id)
    if inv is None:
        raise ValueError("Invoice not found")

    if not getattr(inv, "invoice_no", None):
        inv.invoice_no = _next_document_number(
            db,
            tenant_id=tenant_id,
            doc_type="INV",
            created_at=getattr(inv, "created_at", None),
        )
        db.flush()

    enrollment = None
    if getattr(inv, "enrollment_id", None):
        enrollment = db.execute(
            select(Enrollment).where(
                Enrollment.tenant_id == tenant_id,
                Enrollment.id == inv.enrollment_id,
            )
        ).scalar_one_or_none()
    student_name = _extract_student_name(getattr(enrollment, "payload", None))

    rows = db.execute(
        select(InvoiceLine).where(InvoiceLine.invoice_id == inv.id).order_by(InvoiceLine.id.asc())
    ).scalars().all()
    lines = [
        {
            "description": str(getattr(row, "description", "") or ""),
            "amount": str(getattr(row, "amount", 0) or 0),
        }
        for row in rows
    ]

    profile = get_tenant_print_profile(db, tenant_id=tenant_id)
    checksum = _document_checksum(
        tenant_id=tenant_id,
        document_id=inv.id,
        document_no=str(inv.invoice_no),
        document_type="INVOICE",
    )
    qr_payload = json.dumps(
        {
            "tenant_id": str(tenant_id),
            "doc_type": "INVOICE",
            "doc_id": str(inv.id),
            "doc_no": str(inv.invoice_no),
            "checksum": checksum,
        },
        separators=(",", ":"),
        sort_keys=True,
    )

    return {
        "document_type": "INVOICE",
        "document_id": str(inv.id),
        "document_no": str(inv.invoice_no),
        "tenant_id": str(tenant_id),
        "profile": profile,
        "student_name": student_name,
        "invoice_type": str(getattr(inv, "invoice_type", "") or ""),
        "status": str(getattr(inv, "status", "") or ""),
        "currency": str(getattr(inv, "currency", "KES") or "KES"),
        "total_amount": str(getattr(inv, "total_amount", 0) or 0),
        "paid_amount": str(getattr(inv, "paid_amount", 0) or 0),
        "balance_amount": str(getattr(inv, "balance_amount", 0) or 0),
        "created_at": (
            getattr(inv, "created_at").isoformat()
            if getattr(inv, "created_at", None) is not None
            else None
        ),
        "lines": lines,
        "checksum": checksum,
        "qr_payload": qr_payload,
    }


def build_payment_receipt_document(
    db: Session,
    *,
    tenant_id: UUID,
    payment_id: UUID,
) -> dict[str, Any]:
    payment = db.execute(
        select(Payment).where(
            Payment.tenant_id == tenant_id,
            Payment.id == payment_id,
        )
    ).scalar_one_or_none()
    if payment is None:
        raise ValueError("Payment not found")

    if not getattr(payment, "receipt_no", None):
        payment.receipt_no = _next_document_number(
            db,
            tenant_id=tenant_id,
            doc_type="RCT",
            created_at=getattr(payment, "received_at", None),
        )
        db.flush()

    alloc_rows = db.execute(
        select(
            PaymentAllocation.invoice_id,
            PaymentAllocation.amount,
            Invoice.enrollment_id,
            Invoice.invoice_no,
        )
        .select_from(PaymentAllocation)
        .join(Invoice, Invoice.id == PaymentAllocation.invoice_id)
        .where(
            PaymentAllocation.payment_id == payment.id,
            Invoice.tenant_id == tenant_id,
        )
        .order_by(PaymentAllocation.id.asc())
    ).all()

    enrollment_ids = [row.enrollment_id for row in alloc_rows if row.enrollment_id is not None]
    enrollments = (
        db.execute(
            select(Enrollment).where(
                Enrollment.tenant_id == tenant_id,
                Enrollment.id.in_(enrollment_ids),
            )
        ).scalars().all()
        if enrollment_ids
        else []
    )
    enrollment_name_map = {
        str(e.id): _extract_student_name(getattr(e, "payload", None)) for e in enrollments
    }

    # Fetch invoice lines (fee descriptions) for each allocated invoice
    invoice_ids = [row.invoice_id for row in alloc_rows if row.invoice_id is not None]
    invoice_lines_map: dict[str, list[dict]] = {}
    if invoice_ids:
        all_lines = db.execute(
            select(InvoiceLine)
            .where(InvoiceLine.invoice_id.in_(invoice_ids))
            .order_by(InvoiceLine.invoice_id.asc(), InvoiceLine.id.asc())
        ).scalars().all()
        for line in all_lines:
            key = str(line.invoice_id)
            invoice_lines_map.setdefault(key, []).append({
                "description": str(getattr(line, "description", "") or ""),
                "amount": str(getattr(line, "amount", 0) or 0),
            })

    allocations = [
        {
            "invoice_id": str(row.invoice_id),
            "invoice_no": (str(row.invoice_no) if row.invoice_no is not None else None),
            "amount": str(row.amount or 0),
            "student_name": enrollment_name_map.get(str(row.enrollment_id), "Unknown student"),
            "lines": invoice_lines_map.get(str(row.invoice_id), []),
        }
        for row in alloc_rows
    ]

    profile = get_tenant_print_profile(db, tenant_id=tenant_id)
    checksum = _document_checksum(
        tenant_id=tenant_id,
        document_id=payment.id,
        document_no=str(payment.receipt_no),
        document_type="RECEIPT",
    )
    qr_payload = json.dumps(
        {
            "tenant_id": str(tenant_id),
            "doc_type": "RECEIPT",
            "doc_id": str(payment.id),
            "doc_no": str(payment.receipt_no),
            "checksum": checksum,
        },
        separators=(",", ":"),
        sort_keys=True,
    )

    return {
        "document_type": "RECEIPT",
        "document_id": str(payment.id),
        "document_no": str(payment.receipt_no),
        "tenant_id": str(tenant_id),
        "profile": profile,
        "provider": str(getattr(payment, "provider", "") or ""),
        "reference": (
            str(getattr(payment, "reference", ""))
            if getattr(payment, "reference", None) is not None
            else None
        ),
        "currency": str(getattr(payment, "currency", "KES") or "KES"),
        "amount": str(getattr(payment, "amount", 0) or 0),
        "received_at": (
            getattr(payment, "received_at").isoformat()
            if getattr(payment, "received_at", None) is not None
            else None
        ),
        "allocations": allocations,
        "checksum": checksum,
        "qr_payload": qr_payload,
        # slug needed by enterprise PDF generator for QR verify URL
        "tenant_slug": str(getattr(db.get(Tenant, tenant_id), "slug", "") or ""),
    }


def build_fee_structure_document(
    db: Session,
    *,
    tenant_id: UUID,
    structure_id: UUID,
) -> dict[str, Any]:
    structure = _get_structure_or_error(db, tenant_id=tenant_id, structure_id=structure_id)

    if not getattr(structure, "structure_no", None):
        structure.structure_no = _next_document_number(
            db,
            tenant_id=tenant_id,
            doc_type="FS",
            created_at=getattr(structure, "created_at", None),
        )
        db.flush()

    items = _list_structure_items_detailed(db, tenant_id=tenant_id, structure_id=structure_id)
    total = sum([Decimal(str(i.get("amount") or "0")) for i in items], Decimal("0"))

    profile = get_tenant_print_profile(db, tenant_id=tenant_id)
    checksum = _document_checksum(
        tenant_id=tenant_id,
        document_id=structure.id,
        document_no=str(structure.structure_no),
        document_type="FEE_STRUCTURE",
    )
    qr_payload = json.dumps(
        {
            "tenant_id": str(tenant_id),
            "doc_type": "FEE_STRUCTURE",
            "doc_id": str(structure.id),
            "doc_no": str(structure.structure_no),
            "checksum": checksum,
        },
        separators=(",", ":"),
        sort_keys=True,
    )

    return {
        "document_type": "FEE_STRUCTURE",
        "document_id": str(structure.id),
        "document_no": str(structure.structure_no),
        "tenant_id": str(tenant_id),
        "profile": profile,
        "class_code": str(getattr(structure, "class_code", "") or ""),
        "term_code": str(getattr(structure, "term_code", "GENERAL") or "GENERAL"),
        "name": str(getattr(structure, "name", "") or ""),
        "is_active": bool(getattr(structure, "is_active", True)),
        "created_at": (
            getattr(structure, "created_at").isoformat()
            if getattr(structure, "created_at", None) is not None
            else None
        ),
        "items": [
            {
                "fee_item_code": str(i.get("fee_item_code") or ""),
                "fee_item_name": str(i.get("fee_item_name") or ""),
                "amount": str(i.get("amount") or 0),
            }
            for i in items
        ],
        "total_amount": str(total),
        "checksum": checksum,
        "qr_payload": qr_payload,
    }


def _ascii_pdf_text(value: str) -> str:
    text = value.encode("latin-1", "replace").decode("latin-1")
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _document_lines(payload: dict[str, Any]) -> list[str]:
    dtype = str(payload.get("document_type") or "").upper()
    profile = payload.get("profile") if isinstance(payload.get("profile"), dict) else {}
    header = str(profile.get("school_header") or "School Management System")
    lines: list[str] = [
        header,
        f"{dtype} · {payload.get('document_no')}",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
    ]

    if dtype == "INVOICE":
        lines.extend(
            [
                f"Student: {payload.get('student_name') or 'Unknown student'}",
                f"Type: {payload.get('invoice_type') or ''}",
                f"Status: {payload.get('status') or ''}",
                f"Total: {payload.get('total_amount')}",
                f"Paid: {payload.get('paid_amount')}",
                f"Balance: {payload.get('balance_amount')}",
                "",
                "Lines:",
            ]
        )
        for idx, row in enumerate(payload.get("lines") or [], start=1):
            if not isinstance(row, dict):
                continue
            lines.append(f"{idx}. {row.get('description')}: {row.get('amount')}")
    elif dtype == "RECEIPT":
        lines.extend(
            [
                f"Provider: {payload.get('provider') or ''}",
                f"Reference: {payload.get('reference') or '—'}",
                f"Amount: {payload.get('amount')}",
                "",
                "Allocations:",
            ]
        )
        for idx, row in enumerate(payload.get("allocations") or [], start=1):
            if not isinstance(row, dict):
                continue
            lines.append(
                f"{idx}. {row.get('invoice_no') or row.get('invoice_id')}: {row.get('student_name')} · {row.get('amount')}"
            )
    elif dtype == "FEE_STRUCTURE":
        lines.extend(
            [
                f"Class: {payload.get('class_code') or ''}",
                f"Term: {payload.get('term_code') or ''}",
                f"Name: {payload.get('name') or ''}",
                f"Total: {payload.get('total_amount')}",
                "",
                "Items:",
            ]
        )
        for idx, row in enumerate(payload.get("items") or [], start=1):
            if not isinstance(row, dict):
                continue
            lines.append(f"{idx}. {row.get('fee_item_code')} {row.get('fee_item_name')}: {row.get('amount')}")
    elif dtype == "TIMETABLE":
        lines.extend(
            [
                f"School: {payload.get('tenant_name') or ''}",
                f"Generated: {payload.get('generated_at') or datetime.now(timezone.utc).isoformat()}",
                "",
            ]
        )

        filters = payload.get("filters")
        if isinstance(filters, dict):
            filter_tokens: list[str] = []
            for label, key in (
                ("Term", "term"),
                ("Class", "class_code"),
                ("Day", "day_of_week"),
                ("Type", "slot_type"),
                ("Status", "status"),
                ("Search", "search"),
            ):
                raw = filters.get(key)
                if raw is None:
                    continue
                token = str(raw).strip()
                if not token:
                    continue
                filter_tokens.append(f"{label}: {token}")
            if filter_tokens:
                lines.append("Filters: " + " | ".join(filter_tokens))
                lines.append("")

        lines.append("Entries:")
        entries = payload.get("entries") or []
        if isinstance(entries, list) and entries:
            for idx, row in enumerate(entries, start=1):
                if not isinstance(row, dict):
                    continue
                day = str(row.get("day_of_week") or "")
                time_range = str(row.get("time_range") or "")
                class_code = str(row.get("class_code") or "")
                slot_type = str(row.get("slot_type") or "")
                title = str(row.get("title") or "")
                subject = str(row.get("subject") or "")
                teacher = str(row.get("teacher") or "")
                term = str(row.get("term") or "")

                line = (
                    f"{idx}. {day} {time_range} | {class_code} | {slot_type} | {title}"
                )
                lines.append(line)
                if subject or teacher or term:
                    lines.append(
                        f"    Subject: {subject or '-'} | Teacher: {teacher or '-'} | Term: {term or '-'}"
                    )
        else:
            lines.append("No timetable entries found for the selected filters.")

    lines.extend(
        [
            "",
            f"Checksum: {payload.get('checksum')}",
            f"QR Payload: {payload.get('qr_payload')}",
            str(profile.get("receipt_footer") or "Thank you."),
        ]
    )
    return lines


def _render_timetable_pdf(payload: dict[str, Any]) -> bytes:
    """A4 landscape timetable — black & white, readable font."""
    from reportlab.lib.pagesizes import A4, landscape  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors  # type: ignore
    from reportlab.platypus import (  # type: ignore
        SimpleDocTemplate,
        Paragraph,
        Spacer,
        Table,
        TableStyle,
        HRFlowable,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.lib.enums import TA_CENTER  # type: ignore
    import io as _io

    profile = payload.get("profile") or {}
    school_name = str(profile.get("school_header") or payload.get("tenant_name") or "School")

    styles = getSampleStyleSheet()

    def _s(name: str, *, size: int = 9, bold: bool = False, center: bool = False) -> ParagraphStyle:
        return ParagraphStyle(
            name,
            parent=styles["Normal"],
            fontSize=size,
            leading=size + 3,
            alignment=TA_CENTER if center else 0,
            fontName="Helvetica-Bold" if bold else "Helvetica",
            spaceAfter=2,
        )

    buf = _io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
    )

    story = []
    story.append(Paragraph(school_name.upper(), _s("t", size=14, bold=True, center=True)))
    story.append(Paragraph("SCHOOL TIMETABLE", _s("st", size=11, center=True)))
    story.append(Spacer(1, 3 * mm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.black))
    story.append(Spacer(1, 2 * mm))

    # Filters summary
    filters = payload.get("filters")
    if isinstance(filters, dict):
        parts = []
        for label, key in (
            ("Term", "term"),
            ("Class", "class_code"),
            ("Day", "day_of_week"),
            ("Type", "slot_type"),
        ):
            val = str(filters.get(key) or "").strip()
            if val:
                parts.append(f"{label}: {val}")
        if parts:
            story.append(Paragraph("  |  ".join(parts), _s("filt", center=True)))
            story.append(Spacer(1, 2 * mm))

    entries = [e for e in (payload.get("entries") or []) if isinstance(e, dict)]

    if not entries:
        story.append(Paragraph("No timetable entries found.", _s("empty", center=True)))
    else:
        headers = ["Day", "Time", "Class", "Type", "Title / Subject", "Teacher", "Term"]
        rows = [headers]
        for e in entries:
            title = str(e.get("title") or "")
            subject = str(e.get("subject") or "")
            title_subject = f"{title} / {subject}" if title and subject else title or subject
            rows.append(
                [
                    str(e.get("day_of_week") or ""),
                    str(e.get("time_range") or ""),
                    str(e.get("class_code") or ""),
                    str(e.get("slot_type") or ""),
                    title_subject,
                    str(e.get("teacher") or ""),
                    str(e.get("term") or ""),
                ]
            )

        page_w = landscape(A4)[0] - 30 * mm
        col_widths = [
            22 * mm,  # Day
            25 * mm,  # Time
            22 * mm,  # Class
            22 * mm,  # Type
            None,     # Title/Subject (auto fill)
            35 * mm,  # Teacher
            25 * mm,  # Term
        ]
        # Fill remaining width for Title/Subject
        fixed = sum(w for w in col_widths if w is not None)
        col_widths[4] = max(page_w - fixed, 30 * mm)

        table = Table(rows, colWidths=col_widths, repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.black),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#eeeeee")]),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#aaaaaa")),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("WORDWRAP", (0, 0), (-1, -1), True),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        story.append(table)

    story.append(Spacer(1, 4 * mm))
    generated = str(payload.get("generated_at") or datetime.now(timezone.utc).isoformat())
    story.append(Paragraph(f"Generated: {generated}", _s("gen", size=7, center=True)))

    doc.build(story)
    return buf.getvalue()


def render_document_pdf(payload: dict[str, Any]) -> bytes:
    dtype = str(payload.get("document_type") or "").upper()

    # Enterprise invoice template (A4, school header + QR + fee items table)
    if dtype == "INVOICE":
        try:
            from app.utils.receipt_pdf import generate_invoice_pdf
            return generate_invoice_pdf(payload)
        except Exception as exc:
            logger.exception("invoice_pdf rendering failed, falling back to plain-text: %s", exc)

    # Enterprise receipt template (A4 or Thermal with embedded QR code)
    if dtype == "RECEIPT":
        try:
            from app.utils.receipt_pdf import generate_receipt_pdf
            return generate_receipt_pdf(payload)
        except Exception as exc:
            logger.exception("receipt_pdf rendering failed, falling back to plain-text: %s", exc)

    # Timetable: A4 landscape
    if dtype == "TIMETABLE":
        try:
            return _render_timetable_pdf(payload)
        except Exception as exc:
            logger.exception("timetable PDF rendering failed, falling back to plain-text: %s", exc)

    lines = _document_lines(payload)

    page_width = 595
    page_height = 842
    margin_left = 42
    margin_top = 42
    line_height = 14
    max_lines_per_page = max(20, int((page_height - margin_top - 42) / line_height))

    pages: list[list[str]] = []
    for idx in range(0, len(lines), max_lines_per_page):
        pages.append(lines[idx: idx + max_lines_per_page])
    if not pages:
        pages = [["No content"]]

    objects: dict[int, bytes] = {}
    next_id = 1

    def reserve_obj() -> int:
        nonlocal next_id
        oid = next_id
        next_id += 1
        return oid

    catalog_id = reserve_obj()
    pages_id = reserve_obj()
    font_id = reserve_obj()

    content_page_pairs: list[tuple[int, int]] = []
    for _ in pages:
        content_id = reserve_obj()
        page_id = reserve_obj()
        content_page_pairs.append((content_id, page_id))

    objects[font_id] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    for page_lines, (content_id, page_id) in zip(pages, content_page_pairs):
        chunks: list[str] = []
        for idx, raw in enumerate(page_lines):
            y = page_height - margin_top - (idx * line_height)
            text = _ascii_pdf_text(str(raw))
            chunks.append(f"BT /F1 10 Tf {margin_left} {y} Td ({text}) Tj ET")
        stream = "\n".join(chunks).encode("latin-1", "replace")
        objects[content_id] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode("ascii")
            + stream
            + b"\nendstream"
        )
        objects[page_id] = (
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {page_width} {page_height}] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>"
        ).encode("ascii")

    kids = " ".join([f"{page_id} 0 R" for _, page_id in content_page_pairs])
    objects[pages_id] = f"<< /Type /Pages /Count {len(content_page_pairs)} /Kids [ {kids} ] >>".encode("ascii")
    objects[catalog_id] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode("ascii")

    buffer = bytearray()
    buffer.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: dict[int, int] = {}
    for oid in sorted(objects.keys()):
        offsets[oid] = len(buffer)
        buffer.extend(f"{oid} 0 obj\n".encode("ascii"))
        buffer.extend(objects[oid])
        buffer.extend(b"\nendobj\n")

    xref_offset = len(buffer)
    max_obj = max(objects.keys())
    buffer.extend(f"xref\n0 {max_obj + 1}\n".encode("ascii"))
    buffer.extend(b"0000000000 65535 f \n")
    for oid in range(1, max_obj + 1):
        off = offsets.get(oid, 0)
        buffer.extend(f"{off:010d} 00000 n \n".encode("ascii"))

    buffer.extend(
        (
            f"trailer\n<< /Size {max_obj + 1} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(buffer)


# -------------------------
# Enrollment eligibility helper
# -------------------------
def _extract_enrollment_class_code(payload: dict[str, Any] | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    candidates = [
        payload.get("admission_class"),
        payload.get("class_code"),
        payload.get("classCode"),
        payload.get("grade"),
    ]
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return _norm_upper(value)
    return None


def _policy_required_amount(
    *,
    subtotal: Decimal,
    allow_partial_enrollment: bool,
    min_percent_to_enroll: int | None,
    min_amount_to_enroll: Decimal | None,
) -> Decimal:
    if subtotal <= 0:
        return Decimal("0")
    if not allow_partial_enrollment:
        return subtotal
    if min_percent_to_enroll is not None:
        pct = Decimal(min_percent_to_enroll) / Decimal("100")
        return subtotal * pct
    if min_amount_to_enroll is not None:
        return min(subtotal, Decimal(min_amount_to_enroll))
    return min(subtotal, Decimal("0.01"))


def _resolve_fee_structure_for_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID,
    fees_invoice: Invoice | None,
) -> FeeStructure | None:
    if fees_invoice is not None and isinstance(fees_invoice.meta, dict):
        sid = _uuid_from_any(fees_invoice.meta.get("fee_structure_id"))
        if sid is not None:
            structure = _get_structure_in_tenant(
                db, tenant_id=tenant_id, fee_structure_id=sid
            )
            if structure is not None:
                return structure

    enrollment = db.execute(
        select(Enrollment).where(
            Enrollment.tenant_id == tenant_id,
            Enrollment.id == enrollment_id,
        )
    ).scalar_one_or_none()
    payload = getattr(enrollment, "payload", None)
    class_code = _extract_enrollment_class_code(payload)
    term_code = _extract_enrollment_term_code(payload)
    if not class_code:
        return None
    return find_structure_by_class(
        db,
        tenant_id=tenant_id,
        class_code=class_code,
        term_code=term_code,
    )


def _structure_partial_ok(
    db: Session,
    *,
    tenant_id: UUID,
    invoice: Invoice,
    structure: FeeStructure,
) -> tuple[bool, dict[str, Any]]:
    policies = list_fee_structure_policies(
        db,
        tenant_id=tenant_id,
        fee_structure_id=structure.id,
    )
    structure_policy = next((p for p in policies if p.fee_item_id is None), None)
    item_policies = {
        p.fee_item_id: p for p in policies if p.fee_item_id is not None
    }

    invoice_lines = db.execute(
        select(InvoiceLine).where(InvoiceLine.invoice_id == invoice.id)
    ).scalars().all()

    total_due = max(Decimal(invoice.total_amount or 0), Decimal("0"))
    paid_amount = max(Decimal(invoice.paid_amount or 0), Decimal("0"))
    if total_due <= 0:
        return True, {
            "mode": "structure",
            "fee_structure_id": str(structure.id),
            "class_code": structure.class_code,
            "term_code": structure.term_code,
            "required_amount": "0",
            "applied_policies": len(policies),
        }

    if not policies:
        return False, {
            "mode": "structure",
            "fee_structure_id": str(structure.id),
            "class_code": structure.class_code,
            "term_code": structure.term_code,
            "required_amount": str(total_due),
            "applied_policies": 0,
        }

    item_required = Decimal("0")
    structure_scope_subtotal = Decimal("0")

    for line in invoice_lines:
        amount = Decimal(getattr(line, "amount", 0) or 0)
        if amount <= 0:
            continue

        item_id: UUID | None = None
        meta = getattr(line, "meta", None)
        if isinstance(meta, dict):
            item_id = _uuid_from_any(meta.get("fee_item_id"))

        item_policy = item_policies.get(item_id) if item_id else None
        if item_policy is not None:
            item_required += _policy_required_amount(
                subtotal=amount,
                allow_partial_enrollment=bool(item_policy.allow_partial_enrollment),
                min_percent_to_enroll=item_policy.min_percent_to_enroll,
                min_amount_to_enroll=item_policy.min_amount_to_enroll,
            )
        else:
            structure_scope_subtotal += amount

    required_total = item_required
    if structure_scope_subtotal > 0:
        if structure_policy is not None:
            required_total += _policy_required_amount(
                subtotal=structure_scope_subtotal,
                allow_partial_enrollment=bool(structure_policy.allow_partial_enrollment),
                min_percent_to_enroll=structure_policy.min_percent_to_enroll,
                min_amount_to_enroll=structure_policy.min_amount_to_enroll,
            )
        else:
            required_total += structure_scope_subtotal

    required_total = min(max(required_total, Decimal("0")), total_due)

    return paid_amount >= required_total, {
        "mode": "structure",
        "fee_structure_id": str(structure.id),
        "class_code": structure.class_code,
        "term_code": structure.term_code,
        "required_amount": str(required_total),
        "applied_policies": len(policies),
    }


def get_enrollment_finance_status(db: Session, *, tenant_id: UUID, enrollment_id: UUID) -> dict:
    # Find interview + fees invoice for the enrollment
    invs = db.execute(
        select(Invoice)
        .where(
            Invoice.tenant_id == tenant_id,
            Invoice.enrollment_id == enrollment_id,
        )
        .order_by(Invoice.created_at.desc())
    ).scalars().all()

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
        structure = _resolve_fee_structure_for_enrollment(
            db,
            tenant_id=tenant_id,
            enrollment_id=enrollment_id,
            fees_invoice=inv,
        )
        if structure is not None:
            ok, _meta = _structure_partial_ok(
                db,
                tenant_id=tenant_id,
                invoice=inv,
                structure=structure,
            )
            return ok

        # Legacy fallback when a fees invoice is not linked to any structure.
        if not policy.allow_partial_enrollment:
            return False
        if policy.min_percent_to_enroll is not None and inv.total_amount and inv.total_amount > 0:
            pct = (Decimal(inv.paid_amount) / Decimal(inv.total_amount)) * Decimal("100")
            return pct >= Decimal(policy.min_percent_to_enroll)
        if policy.min_amount_to_enroll is not None:
            return Decimal(inv.paid_amount) >= Decimal(policy.min_amount_to_enroll)
        return Decimal(inv.paid_amount) > 0

    fee_policy_meta: dict[str, Any] | None = None
    if fees is not None:
        structure = _resolve_fee_structure_for_enrollment(
            db,
            tenant_id=tenant_id,
            enrollment_id=enrollment_id,
            fees_invoice=fees,
        )
        if structure is not None:
            _ok, meta = _structure_partial_ok(
                db,
                tenant_id=tenant_id,
                invoice=fees,
                structure=structure,
            )
            fee_policy_meta = meta
        else:
            fee_policy_meta = {
                "mode": "tenant_global_fallback",
                "allow_partial_enrollment": policy.allow_partial_enrollment,
                "min_percent_to_enroll": policy.min_percent_to_enroll,
                "min_amount_to_enroll": (
                    str(policy.min_amount_to_enroll) if policy.min_amount_to_enroll is not None else None
                ),
            }

    return {
        "policy": {
            "allow_partial_enrollment": policy.allow_partial_enrollment,
            "min_percent_to_enroll": policy.min_percent_to_enroll,
            "min_amount_to_enroll": str(policy.min_amount_to_enroll) if policy.min_amount_to_enroll is not None else None,
            "require_interview_fee_before_submit": policy.require_interview_fee_before_submit,
        },
        "fees_policy": fee_policy_meta,
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


# =============================================================================
# Subscription (Tenant/Director) - production safe
# =============================================================================

def _load_subscription_models():
    """
    Tries to load subscription-related models if they exist in this codebase.
    This keeps the module production-safe even if subscription tables aren't added yet.
    """
    Subscription = None
    SubscriptionPayment = None

    # Common patterns: app.models.subscription, app.models.subscriptions, etc.
    candidates = [
        ("app.models.subscription", "Subscription", "SubscriptionPayment"),
        ("app.models.subscriptions", "Subscription", "SubscriptionPayment"),
        ("app.models.billing_subscription", "Subscription", "SubscriptionPayment"),
    ]

    for mod, sub_cls, pay_cls in candidates:
        try:
            m = __import__(mod, fromlist=[sub_cls, pay_cls])
            Subscription = getattr(m, sub_cls, None)
            SubscriptionPayment = getattr(m, pay_cls, None)
            if Subscription is not None:
                # SubscriptionPayment is optional; history can be derived or empty
                return Subscription, SubscriptionPayment
        except Exception:
            continue

    return None, None


def get_tenant_subscription(db: Session, *, tenant_id: UUID) -> dict | None:
    """
    Returns the current tenant subscription for director UI.
    Expected shape aligns with DirectorSubscription type in frontend.
    """
    Subscription, _SubscriptionPayment = _load_subscription_models()
    if Subscription is None:
        # Subscription module not implemented in DB/models yet
        # Return None (frontend will show "No active subscription") OR raise.
        # Returning None is nicer for UI.
        return None

    # Try common fields; we don’t assume exact schema, but we do best effort.
    sub = db.execute(
        select(Subscription).where(
            getattr(Subscription, "tenant_id") == tenant_id
        ).order_by(
            getattr(Subscription, "created_at").desc() if hasattr(Subscription, "created_at") else getattr(Subscription, "id").desc()
        )
    ).scalars().first()

    if not sub:
        return None

    def _get(name: str, default=None):
        return getattr(sub, name, default)

    # Normalize likely fields to frontend shape
    return {
        "id": str(_get("id")),
        "plan": _get("plan", _get("plan_name", "Standard")),
        "billing_cycle": _get("billing_cycle", _get("cycle", "per_term")),
        "status": _get("status", "active"),
        "amount_kes": int(_get("amount_kes", _get("amount", 0)) or 0),
        "discount_percent": _get("discount_percent", None),
        "period_start": (_get("period_start").isoformat() if _get("period_start") else None),
        "period_end": (_get("period_end").isoformat() if _get("period_end") else None),
        "next_payment_date": (_get("next_payment_date").isoformat() if _get("next_payment_date") else None),
        "next_payment_amount": (
            int(_get("next_payment_amount") or 0) if _get("next_payment_amount") is not None else None
        ),
        "created_at": (_get("created_at").isoformat() if _get("created_at") else None),
        "notes": _get("notes", None),
        "tenant_name": _get("tenant_name", None),
        "tenant_slug": _get("tenant_slug", None),
    }


def list_tenant_subscription_payments(db: Session, *, tenant_id: UUID) -> list[dict]:
    """
    Returns subscription payment history rows for the tenant.
    If SubscriptionPayment model isn't present, returns [] safely.
    """
    _Subscription, SubscriptionPayment = _load_subscription_models()
    if SubscriptionPayment is None:
        return []

    rows = db.execute(
        select(SubscriptionPayment).where(
            getattr(SubscriptionPayment, "tenant_id") == tenant_id
        ).order_by(
            getattr(SubscriptionPayment, "paid_at").desc() if hasattr(SubscriptionPayment, "paid_at") else getattr(SubscriptionPayment, "created_at").desc()
        )
    ).scalars().all()

    out: list[dict] = []
    for p in rows:
        def _get(name: str, default=None):
            return getattr(p, name, default)

        out.append(
            {
                "id": str(_get("id")),
                "amount_kes": int(_get("amount_kes", _get("amount", 0)) or 0),
                "paid_at": (_get("paid_at").isoformat() if _get("paid_at") else (_get("created_at").isoformat() if _get("created_at") else None)),
                "mpesa_receipt": _get("mpesa_receipt", _get("receipt", None)),
                "phone": _get("phone", _get("phone_number", None)),
                "period_label": _get("period_label", None),
                "status": _get("status", "completed"),
            }
        )
    return out


def initiate_tenant_subscription_payment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    phone_number: str,
    amount,
    subscription_id: Optional[str] = None,
) -> dict:
    """
    Initiates an STK push for subscription payment.

    Production-safe behavior:
    - If you have an mpesa integration service in codebase, we call it.
    - If not, we raise a clear ValueError that backend integration is missing.
    """
    # Validate amount
    try:
        amt = Decimal(str(amount))
    except Exception:
        raise ValueError("Invalid amount")
    if amt <= 0:
        raise ValueError("Amount must be > 0")

    # Try to locate an mpesa integration function if exists
    mpesa_candidates = [
        ("app.integrations.mpesa.service", "initiate_stk_push"),
        ("app.services.mpesa", "initiate_stk_push"),
        ("app.mpesa.service", "initiate_stk_push"),
    ]

    mpesa_fn = None
    for mod, fn_name in mpesa_candidates:
        try:
            m = __import__(mod, fromlist=[fn_name])
            mpesa_fn = getattr(m, fn_name, None)
            if mpesa_fn:
                break
        except Exception:
            continue

    if not mpesa_fn:
        # No integration found. Fail clearly (frontend shows error toast).
        raise ValueError("M-Pesa integration not configured on backend (initiate_stk_push not found)")

    # Call the integration
    res = mpesa_fn(
        db=db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        phone_number=phone_number,
        amount=amt,
        subscription_id=subscription_id,
    )

    # Expecting res to be dict-like, but keep safe
    if not isinstance(res, dict):
        raise ValueError("M-Pesa initiate_stk_push returned invalid response")

    # Optional audit
    try:
        log_event(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            action="subscription.payment.initiate",
            resource="subscription",
            resource_id=(UUID(subscription_id) if subscription_id else None),
            payload={"phone_number": phone_number, "amount": str(amt)},
            meta=None,
        )
    except Exception:
        # don't break payment initiation due to audit
        pass

    return res


def get_tenant_subscription_payment_status(db: Session, *, tenant_id: UUID, checkout_request_id: str) -> dict:
    """
    Polls payment status for STK push.

    Production-safe behavior:
    - Uses backend mpesa query if it exists.
    - Otherwise returns a clean error.
    """
    if not checkout_request_id or not str(checkout_request_id).strip():
        raise ValueError("checkout_request_id is required")

    mpesa_candidates = [
        ("app.integrations.mpesa.service", "query_stk_status"),
        ("app.services.mpesa", "query_stk_status"),
        ("app.mpesa.service", "query_stk_status"),
    ]

    query_fn = None
    for mod, fn_name in mpesa_candidates:
        try:
            m = __import__(mod, fromlist=[fn_name])
            query_fn = getattr(m, fn_name, None)
            if query_fn:
                break
        except Exception:
            continue

    if not query_fn:
        raise ValueError("M-Pesa integration not configured on backend (query_stk_status not found)")

    res = query_fn(db=db, tenant_id=tenant_id, checkout_request_id=checkout_request_id)
    if not isinstance(res, dict):
        raise ValueError("M-Pesa query_stk_status returned invalid response")
    return res
