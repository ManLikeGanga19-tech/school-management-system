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
from sqlalchemy import select, func as sa_func, text as sa_text

from app.core.audit import log_event

from app.models.finance_policy import FinancePolicy
from app.models.finance_structure_policy import FinanceStructurePolicy
from app.models.fee_catalog import FeeCategory, FeeItem
from app.models.fee_structure import FeeStructure, FeeStructureItem
from app.models.enrollment import Enrollment
from app.models.scholarship import Scholarship
from app.models.scholarship_allocation import ScholarshipAllocation
from app.models.invoice import Invoice, InvoiceLine
from app.models.payment import Payment, PaymentAllocation, _new_verify_code
from app.models.student import Student
from app.models.parent import Parent, ParentEnrollmentLink
from app.models.tenant import Tenant
from app.models.tenant_payment_settings import TenantPaymentSettings
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
        "qr_enabled": (
            getattr(profile, "qr_enabled", None)
            if getattr(profile, "qr_enabled", None) is not None
            else True
        ),
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


def _resolve_student_identity(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment: Optional[Enrollment],
) -> dict[str, str]:
    """Resolve a student's printable identity (name / admission no / class / parent).

    Shared by the invoice and receipt document builders so the two documents
    can never disagree about who a student is. Reads the enrollment payload
    first, then falls back to the linked Student record for name + admission no.
    """
    payload: dict = (getattr(enrollment, "payload", None) or {}) if enrollment is not None else {}

    student_name = _extract_student_name(payload)
    admission_no = str(payload.get("admission_no") or payload.get("admissionNo") or "")
    class_code = str(
        payload.get("class_code")
        or payload.get("classCode")
        or payload.get("class")
        or ""
    )
    # Prefer the registered Parent record's full name (first + last) over the
    # free-text guardian name typed into the enrollment payload — the receipt's
    # "Paid By" line must show the parent's proper full name.
    parent_name = ""
    if enrollment is not None and getattr(enrollment, "id", None):
        link = db.execute(
            select(ParentEnrollmentLink)
            .where(
                ParentEnrollmentLink.tenant_id == tenant_id,
                ParentEnrollmentLink.enrollment_id == enrollment.id,
            )
            .order_by(ParentEnrollmentLink.is_primary.desc(),
                      ParentEnrollmentLink.created_at.asc())
        ).scalars().first()
        if link is not None:
            parent = db.get(Parent, link.parent_id)
            if parent is not None:
                parent_name = (
                    f"{parent.first_name or ''} {parent.last_name or ''}".strip()
                )

    if not parent_name:
        parent_name = str(
            payload.get("parent_name")
            or payload.get("parentName")
            or payload.get("guardian_name")
            or ""
        )

    if (
        (not admission_no or not student_name or student_name == "Unknown student")
        and enrollment is not None
        and getattr(enrollment, "student_id", None)
    ):
        s = db.execute(
            select(Student).where(
                Student.id == enrollment.student_id,
                Student.tenant_id == tenant_id,
            )
        ).scalar_one_or_none()
        if s:
            if not admission_no:
                admission_no = str(getattr(s, "admission_no", "") or "")
            if not student_name or student_name == "Unknown student":
                fn = str(getattr(s, "first_name", "") or "").strip()
                ln = str(getattr(s, "last_name", "") or "").strip()
                student_name = f"{fn} {ln}".strip() or student_name

    return {
        "student_name": student_name or "Unknown student",
        "admission_no": admission_no,
        "class_code": class_code,
        "parent_name": parent_name,
    }


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


def update_fee_category(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    category_id: UUID,
    updates: dict,
) -> FeeCategory:
    row = db.execute(
        select(FeeCategory).where(FeeCategory.id == category_id, FeeCategory.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not row:
        raise ValueError("Fee category not found")
    if "code" in updates and updates["code"]:
        norm = str(updates["code"]).upper().strip()
        conflict = db.execute(
            select(FeeCategory).where(
                FeeCategory.tenant_id == tenant_id,
                FeeCategory.code == norm,
                FeeCategory.id != category_id,
            )
        ).scalar_one_or_none()
        if conflict:
            raise ValueError("Fee category code already exists for this tenant")
        row.code = norm
    if "name" in updates and updates["name"]:
        row.name = str(updates["name"]).strip()
    if "is_active" in updates:
        row.is_active = bool(updates["is_active"])
    db.flush()
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.category.update",
        resource="fee_category",
        resource_id=row.id,
        payload={"code": row.code},
        meta=None,
    )
    return row


def delete_fee_category(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    category_id: UUID,
) -> None:
    row = db.execute(
        select(FeeCategory).where(FeeCategory.id == category_id, FeeCategory.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not row:
        raise ValueError("Fee category not found")
    has_items = db.execute(
        select(FeeItem.id).where(FeeItem.tenant_id == tenant_id, FeeItem.category_id == category_id).limit(1)
    ).scalar_one_or_none()
    if has_items:
        raise ValueError("Cannot delete a fee category that has fee items — remove the items first")
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.category.delete",
        resource="fee_category",
        resource_id=row.id,
        payload={"code": row.code},
        meta=None,
    )
    db.delete(row)
    db.flush()


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
    charge_frequency: str = "PER_TERM",
    is_active: bool = True,
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

    valid_freq = {"PER_TERM", "ONCE_PER_YEAR", "ONCE_EVER"}
    if charge_frequency not in valid_freq:
        raise ValueError(f"charge_frequency must be one of {valid_freq}")

    row = FeeItem(
        tenant_id=tenant_id,
        category_id=category_id,
        code=norm_code,
        name=name.strip(),
        charge_frequency=charge_frequency,
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


def update_fee_item(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    item_id: UUID,
    updates: dict,
) -> FeeItem:
    row = db.execute(
        select(FeeItem).where(FeeItem.id == item_id, FeeItem.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not row:
        raise ValueError("Fee item not found")
    if "category_id" in updates and updates["category_id"]:
        cat = db.execute(
            select(FeeCategory).where(
                FeeCategory.id == updates["category_id"], FeeCategory.tenant_id == tenant_id
            )
        ).scalar_one_or_none()
        if not cat:
            raise ValueError("Fee category not found in this tenant")
        row.category_id = updates["category_id"]
    if "code" in updates and updates["code"]:
        norm = str(updates["code"]).upper().strip()
        conflict = db.execute(
            select(FeeItem).where(
                FeeItem.tenant_id == tenant_id,
                FeeItem.code == norm,
                FeeItem.id != item_id,
            )
        ).scalar_one_or_none()
        if conflict:
            raise ValueError("Fee item code already exists for this tenant")
        row.code = norm
    if "name" in updates and updates["name"]:
        row.name = str(updates["name"]).strip()
    if "charge_frequency" in updates and updates["charge_frequency"]:
        valid_freq = {"PER_TERM", "ONCE_PER_YEAR", "ONCE_EVER"}
        if updates["charge_frequency"] not in valid_freq:
            raise ValueError(f"charge_frequency must be one of {valid_freq}")
        row.charge_frequency = updates["charge_frequency"]
    if "is_active" in updates:
        row.is_active = bool(updates["is_active"])
    db.flush()
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.item.update",
        resource="fee_item",
        resource_id=row.id,
        payload={"code": row.code},
        meta=None,
    )
    return row


def delete_fee_item(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    item_id: UUID,
) -> None:
    row = db.execute(
        select(FeeItem).where(FeeItem.id == item_id, FeeItem.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not row:
        raise ValueError("Fee item not found")
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.item.delete",
        resource="fee_item",
        resource_id=row.id,
        payload={"code": row.code},
        meta=None,
    )
    db.delete(row)
    db.flush()


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
    academic_year: int,
    student_type: str,
    name: str,
    is_active: bool = True,
) -> FeeStructure:
    norm_class = _norm_upper(class_code)
    if not norm_class:
        raise ValueError("class_code is required")
    if student_type not in ("NEW", "RETURNING"):
        raise ValueError("student_type must be NEW or RETURNING")

    existing = db.execute(
        select(FeeStructure).where(
            FeeStructure.tenant_id == tenant_id,
            FeeStructure.class_code == norm_class,
            FeeStructure.academic_year == academic_year,
            FeeStructure.student_type == student_type,
        )
    ).scalar_one_or_none()
    if existing:
        raise ValueError("Fee structure already exists for this class, year, and student type")

    row = FeeStructure(
        tenant_id=tenant_id,
        class_code=norm_class,
        academic_year=academic_year,
        student_type=student_type,
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
        payload={"class_code": row.class_code, "academic_year": row.academic_year, "student_type": row.student_type},
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
    next_academic_year = structure.academic_year
    next_student_type = structure.student_type
    if "class_code" in updates and updates["class_code"] is not None:
        next_class_code = _norm_upper(str(updates["class_code"]))
    if "academic_year" in updates and updates["academic_year"] is not None:
        next_academic_year = int(updates["academic_year"])
    if "student_type" in updates and updates["student_type"] is not None:
        next_student_type = str(updates["student_type"]).upper()
        if next_student_type not in ("NEW", "RETURNING"):
            raise ValueError("student_type must be NEW or RETURNING")

    if (next_class_code, next_academic_year, next_student_type) != (
        structure.class_code, structure.academic_year, structure.student_type
    ):
        duplicate = db.execute(
            select(FeeStructure).where(
                FeeStructure.tenant_id == tenant_id,
                FeeStructure.class_code == next_class_code,
                FeeStructure.academic_year == next_academic_year,
                FeeStructure.student_type == next_student_type,
                FeeStructure.id != structure_id,
            )
        ).scalar_one_or_none()
        if duplicate:
            raise ValueError("Another fee structure already exists for this class, year, and student type")
        structure.class_code = next_class_code
        structure.academic_year = next_academic_year
        structure.student_type = next_student_type

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
            "academic_year": structure.academic_year,
            "student_type": structure.student_type,
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
            FeeStructureItem.term_1_amount,
            FeeStructureItem.term_2_amount,
            FeeStructureItem.term_3_amount,
            FeeItem.code.label("fee_item_code"),
            FeeItem.name.label("fee_item_name"),
            FeeItem.charge_frequency,
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
            "term_1_amount": row.term_1_amount,
            "term_2_amount": row.term_2_amount,
            "term_3_amount": row.term_3_amount,
            "charge_frequency": row.charge_frequency,
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
        for col in ("term_1_amount", "term_2_amount", "term_3_amount"):
            if Decimal(it[col]) < 0:
                raise ValueError(f"Each structure item {col} must be >= 0")
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
        t1 = Decimal(it["term_1_amount"])
        t2 = Decimal(it["term_2_amount"])
        t3 = Decimal(it["term_3_amount"])
        db.add(FeeStructureItem(
            structure_id=structure_id,
            fee_item_id=it["fee_item_id"],
            term_1_amount=t1,
            term_2_amount=t2,
            term_3_amount=t3,
            amount=t1,  # keep legacy column in sync
        ))
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

    t1 = Decimal(item["term_1_amount"])
    t2 = Decimal(item["term_2_amount"])
    t3 = Decimal(item["term_3_amount"])
    for col, val in (("term_1_amount", t1), ("term_2_amount", t2), ("term_3_amount", t3)):
        if val < 0:
            raise ValueError(f"{col} must be >= 0")

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
        freq = str(inline_fee_item.get("charge_frequency", "PER_TERM"))

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
                charge_frequency=freq,
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
        link.term_1_amount = t1
        link.term_2_amount = t2
        link.term_3_amount = t3
        link.amount = t1  # keep legacy in sync
    else:
        db.add(FeeStructureItem(
            structure_id=structure_id,
            fee_item_id=fee_item_id,
            term_1_amount=t1,
            term_2_amount=t2,
            term_3_amount=t3,
            amount=t1,
        ))
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="fees.structure.item.upsert",
        resource="fee_structure",
        resource_id=structure_id,
        payload={"fee_item_id": str(fee_item_id), "term_1_amount": str(t1)},
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
    is_active: bool,
    max_recipients: int | None = None,
    description: str | None = None,
) -> Scholarship:
    t = type_.upper().strip()
    if t not in ("PERCENTAGE", "FIXED"):
        raise ValueError("Scholarship type must be PERCENTAGE or FIXED")
    if max_recipients is not None and max_recipients < 1:
        raise ValueError("max_recipients must be at least 1")

    row = Scholarship(
        tenant_id=tenant_id,
        name=name.strip(),
        type=t,
        value=value,
        is_active=is_active,
        max_recipients=max_recipients,
        description=description,
    )
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


def update_scholarship(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    scholarship_id: UUID,
    updates: dict,
) -> Scholarship:
    row = db.execute(
        select(Scholarship).where(Scholarship.id == scholarship_id, Scholarship.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not row:
        raise ValueError("Scholarship not found")
    if "name" in updates and updates["name"]:
        row.name = str(updates["name"]).strip()
    if "type" in updates and updates["type"]:
        t = str(updates["type"]).upper().strip()
        if t not in ("PERCENTAGE", "FIXED"):
            raise ValueError("Scholarship type must be PERCENTAGE or FIXED")
        row.type = t
    if "value" in updates and updates["value"] is not None:
        from decimal import Decimal, InvalidOperation
        try:
            row.value = Decimal(str(updates["value"]))
        except InvalidOperation:
            raise ValueError("Invalid scholarship value")
    if "max_recipients" in updates:
        mr = updates["max_recipients"]
        if mr is not None:
            mr = int(mr)
            if mr < 1:
                raise ValueError("max_recipients must be at least 1")
        row.max_recipients = mr
    if "description" in updates:
        row.description = updates["description"]
    if "is_active" in updates:
        row.is_active = bool(updates["is_active"])
    db.flush()
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="scholarship.update",
        resource="scholarship",
        resource_id=row.id,
        payload={"type": row.type, "value": str(row.value)},
        meta=None,
    )
    return row


def delete_scholarship(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    scholarship_id: UUID,
) -> None:
    row = db.execute(
        select(Scholarship).where(Scholarship.id == scholarship_id, Scholarship.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not row:
        raise ValueError("Scholarship not found")
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="scholarship.delete",
        resource="scholarship",
        resource_id=row.id,
        payload={"name": row.name},
        meta=None,
    )
    db.delete(row)
    db.flush()


def list_scholarships(db: Session, *, tenant_id: UUID) -> list[Scholarship]:
    return db.execute(
        select(Scholarship).where(Scholarship.tenant_id == tenant_id).order_by(Scholarship.created_at.desc())
    ).scalars().all()


def list_scholarship_allocations(
    db: Session,
    *,
    tenant_id: UUID,
    scholarship_id: UUID,
) -> list[dict[str, Any]]:
    """Return a list of students who received this scholarship, with amounts."""
    rows = db.execute(
        __import__("sqlalchemy").text(
            """
            SELECT
                sa.id                   AS allocation_id,
                sa.amount,
                sa.reason,
                sa.created_at,
                sa.invoice_id,
                sa.enrollment_id,
                sa.student_id,
                COALESCE(
                    s.first_name || ' ' || s.last_name,
                    -- Parens required: `||` and `->>` share precedence and
                    -- are left-associative, so without grouping postgres
                    -- parses this as `(text || text) || payload ->> 'last_name'`,
                    -- which trips the `text ->> unknown` operator error.
                    (ep.payload->>'first_name') || ' ' || (ep.payload->>'last_name'),
                    ep.payload->>'student_name',
                    ep.payload->>'full_name',
                    'Unknown Student'
                ) AS student_name,
                COALESCE(s.admission_no, ep.payload->>'admission_no', '') AS admission_no,
                inv.invoice_no
            FROM core.scholarship_allocations sa
            LEFT JOIN core.students s         ON s.id = sa.student_id AND s.tenant_id = :tid
            LEFT JOIN core.enrollments ep     ON ep.id = sa.enrollment_id
            LEFT JOIN core.invoices inv       ON inv.id = sa.invoice_id
            WHERE sa.scholarship_id = :sid
              AND sa.tenant_id = :tid
            ORDER BY sa.created_at DESC
            """
        ),
        {"tid": str(tenant_id), "sid": str(scholarship_id)},
    ).mappings().all()

    return [
        {
            "allocation_id": str(r["allocation_id"]),
            "student_name": r["student_name"] or "Unknown Student",
            "admission_no": r["admission_no"] or "",
            "amount": str(r["amount"] or "0"),
            "reason": r["reason"] or "",
            "invoice_no": r["invoice_no"] or "",
            "enrollment_id": str(r["enrollment_id"]) if r["enrollment_id"] else None,
            "student_id": str(r["student_id"]) if r["student_id"] else None,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


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
    # A cancelled (voided) invoice is frozen — it stays out of all balances and
    # must never be flipped back to an active status by a recalc.
    if getattr(invoice, "status", None) == "CANCELLED":
        return
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

    # Status lifecycle for non-DRAFT, non-CANCELLED invoices. DRAFT is held
    # until publish_invoice is called explicitly — recalc must never
    # auto-promote a DRAFT to ISSUED, or the secretary's preview-then-publish
    # step gets bypassed every time totals are recomputed (e.g. on
    # regeneration or a downstream CF settle).
    if invoice.status != "DRAFT":
        if invoice.total_amount == 0:
            # Emptying out an existing live invoice (rare) sends it back to
            # DRAFT for the secretary to publish or delete deliberately.
            invoice.status = "DRAFT"
        elif invoice.balance_amount <= 0:
            invoice.status = "PAID"
        elif invoice.paid_amount > 0:
            invoice.status = "PARTIAL"
        else:
            invoice.status = "ISSUED"

    # Arrears (brought-forward balance) breakdown — FIFO accounting: any payment
    # is treated as clearing the arrears portion before the current-term
    # portion. No schema change needed; the split is derived and stashed on
    # invoice.meta so the UI and PDF can render "Previous balance" vs "Current
    # term" without scanning the lines themselves.
    from app.models.student_carry_forward import StudentCarryForward
    bundled = db.execute(
        select(StudentCarryForward).where(
            StudentCarryForward.invoice_id == invoice.id,
            StudentCarryForward.status.in_(("BUNDLED", "SETTLED")),
        )
    ).scalars().all()

    if bundled:
        arrears_total = sum(
            (Decimal(str(cf.amount)) for cf in bundled), Decimal("0")
        )
        paid_d = Decimal(paid or 0)
        if arrears_total > 0:
            arrears_paid = min(paid_d, arrears_total)
            arrears_balance = arrears_total - arrears_paid
        else:
            # Net credit (or zero): the arrears line already reduces the
            # invoice total, so there is nothing left to "pay down" on it.
            arrears_paid = arrears_total
            arrears_balance = Decimal("0")
        current_term_total = Decimal(total or 0) - arrears_total
        current_term_paid = paid_d - arrears_paid
        current_term_balance = current_term_total - current_term_paid

        # Settle bundled CF rows once the arrears portion is fully covered.
        # For a net-credit arrears (negative total), the credit has already been
        # absorbed by the invoice's reduced total at generation time → settle
        # immediately so the credit is not re-used on the next invoice.
        if arrears_total <= 0 or paid_d >= arrears_total:
            for cf in bundled:
                if cf.status != "SETTLED":
                    cf.status = "SETTLED"

        invoice.meta = {
            **(invoice.meta or {}),
            "arrears_total": str(arrears_total),
            "arrears_paid": str(arrears_paid),
            "arrears_balance": str(arrears_balance),
            "current_term_total": str(current_term_total),
            "current_term_paid": str(current_term_paid),
            "current_term_balance": str(current_term_balance),
        }
    elif invoice.meta and "arrears_total" in (invoice.meta or {}):
        # Arrears were detached (e.g. invoice regenerated without CF). Clear
        # the stale breakdown so the UI doesn't display ghost numbers.
        cleaned = {k: v for k, v in (invoice.meta or {}).items() if not k.startswith(("arrears_", "current_term_"))}
        invoice.meta = cleaned or None


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
    # Legacy + interview-fee invoices auto-publish on creation (parents pay
    # interview fees immediately; there's no preview workflow for them). The
    # v2 fees generator deliberately keeps DRAFT — see generate_school_fees_invoice_v2.
    inv.status = "ISSUED"
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


def list_invoices(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: Optional[UUID] = None,
    invoice_type: Optional[str] = None,
    status: Optional[str] = None,
    outstanding_only: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    q = select(Invoice).where(Invoice.tenant_id == tenant_id)
    if enrollment_id:
        q = q.where(Invoice.enrollment_id == enrollment_id)
    if invoice_type:
        q = q.where(Invoice.invoice_type == (_normalize_invoice_type(invoice_type) or ""))
    if status:
        q = q.where(Invoice.status == status.upper())
    if outstanding_only:
        q = q.where(Invoice.balance_amount > 0)
    total: int = db.execute(select(sa_func.count()).select_from(q.subquery())).scalar() or 0
    pages = max(1, (total + page_size - 1) // page_size)
    page = max(1, min(page, pages))
    items = db.execute(
        q.order_by(Invoice.created_at.desc())
         .limit(page_size)
         .offset((page - 1) * page_size)
    ).scalars().all()
    return {"items": items, "meta": {"total": total, "page": page, "page_size": page_size, "pages": pages}}


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
    allocations: list[dict],
    credit_to_student_id: Optional[UUID] = None,
) -> Payment:
    """Record a payment and allocate it across invoices.

    credit_to_student_id controls who an overpayment surplus is credited to:
      - omitted + single-student allocation -> that student (no ambiguity)
      - omitted + multi-student allocation + surplus > 0 -> hard error (the
        caller MUST pick a child explicitly; we never silently credit the
        'first' invoice's student when siblings are involved)
      - supplied -> credit goes to that student, BUT the student must be one
        of the students whose invoices are part of this payment (or the
        surplus would land on someone unrelated to the transaction)
    """
    provider_code = provider.upper().strip()
    if provider_code not in ("CASH", "MPESA", "BANK", "CHEQUE"):
        raise ValueError("Invalid payment provider")

    if amount <= 0:
        raise ValueError("Payment amount must be > 0")
    if not allocations:
        raise ValueError("Allocations required")

    invoice_ids = [UUID(str(a["invoice_id"])) for a in allocations]
    if len(set(invoice_ids)) != len(invoice_ids):
        raise ValueError("Duplicate invoice allocations are not allowed")

    normalized_allocations: list[tuple[UUID, Decimal]] = []
    for a in allocations:
        alloc_amount = Decimal(a["amount"])
        if alloc_amount <= 0:
            raise ValueError("Allocation amount must be > 0")
        normalized_allocations.append((UUID(str(a["invoice_id"])), alloc_amount))

    alloc_sum = sum([alloc for _, alloc in normalized_allocations], Decimal("0"))
    payment_amount = Decimal(amount).quantize(Decimal("0.01"))
    alloc_total = alloc_sum.quantize(Decimal("0.01"))
    if alloc_total > payment_amount:
        raise ValueError("Allocations sum cannot exceed payment amount")
    # Surplus (allocations sum to less than the payment amount) is allowed —
    # it becomes a CREDIT balance for the student, rolled into their next
    # invoice. The receipt narrates the split.
    surplus = payment_amount - alloc_total

    # Resolve the set of students whose invoices the allocation touches. This
    # both anchors the multi-student surplus rule and lets us validate any
    # caller-supplied credit_to_student_id is part of the payment.
    invoices = db.execute(
        select(Invoice).where(
            Invoice.tenant_id == tenant_id,
            Invoice.id.in_(invoice_ids),
        )
    ).scalars().all()
    if len(invoices) != len(set(invoice_ids)):
        raise ValueError("One or more invoices not found in this tenant")

    enrollment_ids = {inv.enrollment_id for inv in invoices if inv.enrollment_id}
    student_id_rows = db.execute(
        select(Enrollment.student_id).where(
            Enrollment.tenant_id == tenant_id,
            Enrollment.id.in_(enrollment_ids),
        )
    ).all() if enrollment_ids else []
    students_in_payment: set[UUID] = {
        r[0] for r in student_id_rows if r[0] is not None
    }

    if surplus > 0:
        if credit_to_student_id is None:
            if len(students_in_payment) > 1:
                raise ValueError(
                    "credit_to_student_id required when payment surplus spans "
                    "multiple students"
                )
        else:
            credit_uuid = UUID(str(credit_to_student_id))
            if students_in_payment and credit_uuid not in students_in_payment:
                raise ValueError(
                    "credit_to_student_id is not part of this payment"
                )

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

    invoice_map = {inv.id: inv for inv in invoices}
    for invoice_id, alloc_amount in normalized_allocations:
        inv = invoice_map[invoice_id]
        # DRAFT invoices have not been signed off by the secretary yet —
        # money must never land on them. The publish-then-record flow gives
        # us this guarantee at the point of the payment.
        if getattr(inv, "status", None) == "DRAFT":
            raise ValueError(
                f"Invoice {inv.invoice_no or inv.id} is a draft and has not "
                "been published yet — publish it before recording a payment."
            )
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

    # Surplus → auto-credit. credit_to_student_id wins; otherwise (single-student
    # case only, multi-student case is already rejected above) credit goes to
    # the unique student behind the allocation.
    credit_balance_id = None
    credit_student_id: Optional[UUID] = None
    if surplus > 0:
        if credit_to_student_id is not None:
            credit_student_id = UUID(str(credit_to_student_id))
        elif len(students_in_payment) == 1:
            credit_student_id = next(iter(students_in_payment))

        if credit_student_id is not None:
            # Use the oldest invoice in the allocation to label the credit
            # (deterministic — sorted by created_at) so receipts read sensibly.
            anchor_inv = min(
                (inv for inv in invoices if inv.enrollment_id is not None),
                key=lambda i: (i.created_at or 0),
                default=invoices[0],
            )
            credit_balance = add_carry_forward(
                db,
                tenant_id=tenant_id,
                student_id=credit_student_id,
                actor_user_id=actor_user_id,
                term_label=f"Overpayment on receipt {pay.receipt_no or str(pay.id)[:8]}",
                academic_year=getattr(anchor_inv, "academic_year", None),
                term_number=getattr(anchor_inv, "term_number", None),
                amount=-surplus,
                description=(
                    f"Auto-credit for KES {surplus} surplus on payment "
                    f"{pay.receipt_no or pay.id} (provider: {provider_code})."
                ),
                category="OVERPAYMENT_CREDIT",
            )
            credit_balance_id = credit_balance["id"]

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="payment.create",
        resource="payment",
        resource_id=pay.id,
        payload={
            "provider": pay.provider,
            "amount": str(pay.amount),
            "allocated_total": str(alloc_total),
            "surplus_credit": str(surplus),
            "credit_balance_id": credit_balance_id,
            "credit_to_student_id": (
                str(credit_student_id) if credit_student_id is not None else None
            ),
            "student_count": len(students_in_payment),
        },
        meta=None,
    )
    return pay


# ── By-student payment view ─────────────────────────────────────────────────
#
# Two helpers powering the new "Record Payment by student" surface:
#
#   get_student_payment_summary(student_id)
#       -> what the student owes right now, broken into pending balance
#          adjustments (signed), current term, and prior-term arrears, with
#          the per-invoice list ordered oldest -> newest. The UI renders the
#          breakdown straight from this.
#
#   record_student_payment(student_id, amount, provider, reference)
#       -> records a single payment for the student, auto-allocating FIFO
#          across their open SCHOOL_FEES invoices (prior terms first, then
#          current term). Any surplus becomes an OVERPAYMENT_CREDIT carry-
#          forward — handled inside create_payment, so the same audit + sign
#          rules apply.
#
# Allocation is deliberately deterministic so the secretary can predict what
# the receipt will show, and the auto-credit is the same code path used by
# the manual /payments endpoint when allocations sum to less than amount.


def _student_open_fees_invoices(
    db: Session,
    *,
    tenant_id: UUID,
    student_id: UUID,
) -> list[Invoice]:
    """Open (non-PAID, non-CANCELLED) SCHOOL_FEES invoices for a student,
    oldest-first by (academic_year, term_number, created_at)."""
    rows = db.execute(
        select(Invoice)
        .join(Enrollment, Enrollment.id == Invoice.enrollment_id)
        .where(
            Invoice.tenant_id == tenant_id,
            Enrollment.student_id == student_id,
            Invoice.invoice_type == "SCHOOL_FEES",
            Invoice.status.notin_(("PAID", "CANCELLED")),
            Invoice.balance_amount > 0,
        )
        .order_by(
            sa_func.coalesce(Invoice.academic_year, 0).asc(),
            sa_func.coalesce(Invoice.term_number, 0).asc(),
            Invoice.created_at.asc(),
        )
    ).scalars().all()
    return list(rows)


def get_student_payment_summary(
    db: Session,
    *,
    tenant_id: UUID,
    student_id: UUID,
    current_term_number: Optional[int] = None,
    current_academic_year: Optional[int] = None,
) -> dict:
    """Snapshot of a student's owed (or credit) balance — see module comment.

    current_term_number / current_academic_year identify "which fees invoice is
    the *current* term" so prior-term arrears can be reported separately. If
    not supplied, the most recent fees invoice for the student is treated as
    current and everything older is prior.
    """
    student = db.execute(
        select(Student).where(
            Student.id == student_id, Student.tenant_id == tenant_id
        )
    ).scalar_one_or_none()
    if not student:
        raise ValueError("Student not found")

    # Resolve class_code from the student's most recent enrollment for display.
    latest_enrollment = db.execute(
        select(Enrollment)
        .where(
            Enrollment.tenant_id == tenant_id,
            Enrollment.student_id == student_id,
        )
        .order_by(Enrollment.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    class_code = ""
    if latest_enrollment is not None:
        pl = latest_enrollment.payload or {}
        class_code = str(
            pl.get("class_code")
            or pl.get("admission_class")
            or pl.get("classCode")
            or pl.get("grade")
            or ""
        )

    # Pending carry-forward (signed).
    from app.models.student_carry_forward import StudentCarryForward
    cf_rows = db.execute(
        select(StudentCarryForward).where(
            StudentCarryForward.tenant_id == tenant_id,
            StudentCarryForward.student_id == student_id,
            StudentCarryForward.status == "OPEN",
        )
    ).scalars().all()
    pending_debit = sum(
        (Decimal(str(r.amount)) for r in cf_rows if Decimal(str(r.amount)) > 0),
        Decimal("0"),
    )
    pending_credit = sum(
        (Decimal(str(r.amount)) for r in cf_rows if Decimal(str(r.amount)) < 0),
        Decimal("0"),
    )
    pending_net = pending_debit + pending_credit

    open_invoices = _student_open_fees_invoices(
        db, tenant_id=tenant_id, student_id=student_id
    )

    # Figure out which invoice is "current term" — explicit override, else the
    # most-recent fees invoice we have for this student.
    def _is_current(inv: Invoice) -> bool:
        if current_term_number is not None and current_academic_year is not None:
            return (
                inv.term_number == current_term_number
                and inv.academic_year == current_academic_year
            )
        # Implicit: the newest invoice (max year, then max term).
        # Determined by the absolute max in the list.
        return False

    if current_term_number is None or current_academic_year is None:
        # Pick the newest invoice (and any that share its (year, term)) as
        # "current term".
        all_for_pick = db.execute(
            select(Invoice)
            .join(Enrollment, Enrollment.id == Invoice.enrollment_id)
            .where(
                Invoice.tenant_id == tenant_id,
                Enrollment.student_id == student_id,
                Invoice.invoice_type == "SCHOOL_FEES",
                Invoice.status != "CANCELLED",
            )
            .order_by(
                sa_func.coalesce(Invoice.academic_year, 0).desc(),
                sa_func.coalesce(Invoice.term_number, 0).desc(),
                Invoice.created_at.desc(),
            )
            .limit(1)
        ).scalar_one_or_none()
        if all_for_pick is not None:
            current_term_number = all_for_pick.term_number
            current_academic_year = all_for_pick.academic_year

    current_total = Decimal("0")
    current_paid = Decimal("0")
    current_balance = Decimal("0")
    prior_balance = Decimal("0")

    invoice_summaries: list[dict] = []
    for inv in open_invoices:
        bal = Decimal(inv.balance_amount or 0)
        tot = Decimal(inv.total_amount or 0)
        paid = Decimal(inv.paid_amount or 0)
        invoice_summaries.append({
            "invoice_id": str(inv.id),
            "invoice_no": inv.invoice_no,
            "invoice_type": inv.invoice_type,
            "status": inv.status,
            "term_number": inv.term_number,
            "academic_year": inv.academic_year,
            "total_amount": str(tot),
            "paid_amount": str(paid),
            "balance_amount": str(bal),
        })
        if (
            current_term_number is not None
            and current_academic_year is not None
            and inv.term_number == current_term_number
            and inv.academic_year == current_academic_year
        ):
            current_total += tot
            current_paid += paid
            current_balance += bal
        else:
            prior_balance += bal

    total_outstanding = current_balance + prior_balance + pending_net

    # Best-effort display name from the SIS row.
    student_name = " ".join(
        str(getattr(student, attr, "") or "").strip()
        for attr in ("first_name", "other_names", "last_name")
    ).strip() or "Student"

    return {
        "student_id": str(student.id),
        "student_name": student_name,
        "admission_no": getattr(student, "admission_no", None),
        "class_code": class_code or None,
        "pending_balance_net": str(pending_net),
        "pending_balance_debit": str(pending_debit),
        "pending_balance_credit": str(pending_credit),
        "current_term_total": str(current_total),
        "current_term_paid": str(current_paid),
        "current_term_balance": str(current_balance),
        "prior_terms_balance": str(prior_balance),
        "total_outstanding": str(total_outstanding),
        "invoices": invoice_summaries,
    }


def record_student_payment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    student_id: UUID,
    amount: Decimal,
    provider: str,
    reference: Optional[str] = None,
) -> dict:
    """Record a payment for a student, allocating FIFO across their open
    school-fees invoices. Surplus → auto-credit (handled inside create_payment).

    Behaviour:
      - amount > 0 required (delegated to create_payment).
      - If the student has no open fees invoices, the entire amount is taken
        as an overpayment credit: we create a synthetic 1-line invoice for
        KES 0 won't work, so instead we record it directly as a credit
        carry-forward (no Payment row, no receipt) and explain in the error
        case — see below.

    Returns a dict matching StudentPaymentRecordOut.
    """
    if amount is None or Decimal(amount) <= 0:
        raise ValueError("Payment amount must be greater than zero")

    open_invoices = _student_open_fees_invoices(
        db, tenant_id=tenant_id, student_id=student_id
    )

    if not open_invoices:
        # No invoice to allocate against → cannot record a payment via the
        # invoice path. Surface a clear error; the UI can offer "Record a
        # credit on this student's balance" via Adjust Balance instead.
        raise ValueError(
            "No outstanding fees invoices for this student. "
            "Generate the term invoice first, or record a credit via Adjust Balance."
        )

    remaining = Decimal(amount).quantize(Decimal("0.01"))
    allocations: list[dict] = []
    for inv in open_invoices:
        if remaining <= 0:
            break
        inv_balance = Decimal(inv.balance_amount or 0)
        if inv_balance <= 0:
            continue
        take = min(remaining, inv_balance)
        allocations.append({"invoice_id": inv.id, "amount": take})
        remaining -= take
    # `remaining` is the surplus; create_payment will turn it into a credit
    # carry-forward automatically. To make that happen, the payment's amount
    # is the FULL received amount, and the sum of allocations is whatever fit
    # the open invoices.

    pay = create_payment(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        provider=provider,
        reference=reference,
        amount=Decimal(amount),
        allocations=[{"invoice_id": a["invoice_id"], "amount": a["amount"]} for a in allocations],
    )

    # Look up the credit balance row create_payment may have auto-created so
    # we can echo its id back to the UI.
    from app.models.student_carry_forward import StudentCarryForward
    credit_balance_id: Optional[str] = None
    surplus = (Decimal(amount).quantize(Decimal("0.01"))
               - sum((a["amount"] for a in allocations), Decimal("0")).quantize(Decimal("0.01")))
    if surplus > 0:
        latest_credit = db.execute(
            select(StudentCarryForward)
            .where(
                StudentCarryForward.tenant_id == tenant_id,
                StudentCarryForward.student_id == student_id,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
            .order_by(StudentCarryForward.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if latest_credit is not None:
            credit_balance_id = str(latest_credit.id)

    # Build a detailed allocation echo with invoice_no / term context.
    invoice_map = {inv.id: inv for inv in open_invoices}
    alloc_out: list[dict] = []
    for a in allocations:
        inv = invoice_map.get(a["invoice_id"])
        alloc_out.append({
            "invoice_id": str(a["invoice_id"]),
            "invoice_no": getattr(inv, "invoice_no", None),
            "term_number": getattr(inv, "term_number", None),
            "academic_year": getattr(inv, "academic_year", None),
            "amount": str(a["amount"]),
        })

    return {
        "payment_id": str(pay.id),
        "receipt_no": pay.receipt_no,
        "amount": str(pay.amount),
        "allocated_total": str(
            sum((a["amount"] for a in allocations), Decimal("0")).quantize(Decimal("0.01"))
        ),
        "surplus_credit": str(surplus.quantize(Decimal("0.01"))),
        "credit_balance_id": credit_balance_id,
        "allocations": alloc_out,
    }


# ── By-family (parent) payment view ─────────────────────────────────────────
#
# Three helpers powering the family-aware "Record Payment" surface:
#
#   _parent_children(parent_id)
#       -> the set of student_ids linked to a parent through enrollments in
#          this tenant. Used to constrain allocations and credit targets.
#
#   get_parent_payment_summary(parent_id)
#       -> per-child StudentPaymentSummaryOut blocks + family_total_outstanding.
#
#   record_parent_payment(parent_id, amount, provider, mode, ...)
#       -> ONE Payment row whose allocations span the family's invoices.
#          mode=auto: FIFO across the union of the family's open SCHOOL_FEES
#          invoices, oldest term first across all children.
#          mode=manual: each (student_id, amount) is FIFO-allocated inside
#          that student's invoices, validated against the student's own
#          outstanding (no silent overflow to siblings).
#          Surplus is auto-credited to credit_to_student_id via create_payment
#          (which enforces the multi-student credit_to rules).


def _parent_children(
    db: Session, *, tenant_id: UUID, parent_id: UUID
) -> list[UUID]:
    """Distinct student_ids linked to a parent through this tenant's
    enrollments. Includes TRANSFERRED enrollments (final-bill use case)."""
    rows = db.execute(
        sa_text(
            """
            SELECT DISTINCT e.student_id
            FROM core.parent_enrollment_links pel
            JOIN core.enrollments e ON e.id = pel.enrollment_id
            WHERE pel.tenant_id = :tid AND pel.parent_id = :pid
              AND e.student_id IS NOT NULL
            """
        ),
        {"tid": str(tenant_id), "pid": str(parent_id)},
    ).all()
    return [UUID(str(r[0])) for r in rows if r[0] is not None]


def get_parent_payment_summary(
    db: Session,
    *,
    tenant_id: UUID,
    parent_id: UUID,
) -> dict:
    """Per-child StudentPaymentSummaryOut + family rollup. Children are
    included if they have outstanding invoices OR an open carry-forward, so
    transferred/leaving children with a final bill stay visible."""
    parent = db.execute(
        select(Parent).where(
            Parent.id == parent_id,
            Parent.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if parent is None:
        raise ValueError("Parent not found")

    student_ids = _parent_children(db, tenant_id=tenant_id, parent_id=parent_id)

    children: list[dict] = []
    family_total = Decimal("0")
    for sid in student_ids:
        try:
            summary = get_student_payment_summary(
                db, tenant_id=tenant_id, student_id=sid
            )
        except ValueError:
            # Student row missing — skip; we'll let the parent module surface
            # the broken link separately.
            continue
        family_total += Decimal(str(summary.get("total_outstanding") or 0))
        children.append(summary)

    children.sort(key=lambda c: (c.get("student_name") or "").lower())

    name = " ".join(
        s for s in (getattr(parent, "first_name", "") or "", getattr(parent, "last_name", "") or "")
        if s
    ).strip() or "Guardian"

    return {
        "parent_id": str(parent.id),
        "parent_name": name,
        "children": children,
        "family_total_outstanding": str(family_total),
    }


def _student_name_for(db: Session, *, tenant_id: UUID, student_id: UUID) -> str:
    student = db.execute(
        select(Student).where(
            Student.id == student_id, Student.tenant_id == tenant_id
        )
    ).scalar_one_or_none()
    if student is None:
        return "Student"
    return " ".join(
        str(getattr(student, attr, "") or "").strip()
        for attr in ("first_name", "other_names", "last_name")
    ).strip() or "Student"


def record_parent_payment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    parent_id: UUID,
    amount: Decimal,
    provider: str,
    reference: Optional[str] = None,
    mode: str = "auto",
    per_student_allocations: Optional[list[dict]] = None,
    credit_to_student_id: Optional[UUID] = None,
) -> dict:
    """Record one Payment row covering one or more of a parent's children.

    See module-level comment for the allocation rules. Returns a dict matching
    ParentPaymentRecordOut, with a per-student breakdown for the receipt panel.
    """
    if amount is None or Decimal(amount) <= 0:
        raise ValueError("Payment amount must be greater than zero")
    mode_norm = (mode or "auto").lower()
    if mode_norm not in ("auto", "manual"):
        raise ValueError("mode must be 'auto' or 'manual'")

    family_ids = _parent_children(db, tenant_id=tenant_id, parent_id=parent_id)
    if not family_ids:
        raise ValueError("Parent has no linked children in this tenant")

    # Credit target (if supplied) must be a child of this parent. We re-check
    # 'part of this payment' inside create_payment, but checking against the
    # family here gives a friendlier error before we touch any rows.
    if credit_to_student_id is not None:
        target_uuid = UUID(str(credit_to_student_id))
        if target_uuid not in set(family_ids):
            raise ValueError(
                "credit_to_student_id must be one of this parent's children"
            )

    # ─── Build the allocation list ────────────────────────────────────────
    allocations: list[dict] = []
    used_student_ids: list[UUID] = []

    if mode_norm == "auto":
        # Union of the family's open fees invoices, ordered globally
        # oldest-first by (academic_year, term_number, created_at). FIFO until
        # the amount runs out.
        family_invoices: list[Invoice] = []
        for sid in family_ids:
            family_invoices.extend(
                _student_open_fees_invoices(
                    db, tenant_id=tenant_id, student_id=sid
                )
            )
        family_invoices.sort(
            key=lambda i: (
                i.academic_year or 0,
                i.term_number or 0,
                i.created_at or 0,
            )
        )
        remaining = Decimal(amount).quantize(Decimal("0.01"))
        # Map invoice -> student for the surplus check below.
        student_by_enrollment = dict(
            db.execute(
                select(Enrollment.id, Enrollment.student_id).where(
                    Enrollment.tenant_id == tenant_id,
                    Enrollment.id.in_({i.enrollment_id for i in family_invoices if i.enrollment_id}),
                )
            ).all()
        ) if family_invoices else {}
        for inv in family_invoices:
            if remaining <= 0:
                break
            bal = Decimal(inv.balance_amount or 0)
            if bal <= 0:
                continue
            take = min(remaining, bal)
            allocations.append({"invoice_id": inv.id, "amount": take})
            remaining -= take
            sid = student_by_enrollment.get(inv.enrollment_id)
            if sid is not None and sid not in used_student_ids:
                used_student_ids.append(sid)

    else:
        # ── manual mode ───────────────────────────────────────────────────
        if not per_student_allocations:
            raise ValueError(
                "per_student_allocations is required when mode='manual'"
            )
        # Validate each student is in the family and amount is positive.
        seen: set[UUID] = set()
        manual_total = Decimal("0")
        for row in per_student_allocations:
            sid = UUID(str(row["student_id"]))
            if sid in seen:
                raise ValueError(
                    f"Duplicate per_student_allocations entry for student {sid}"
                )
            seen.add(sid)
            if sid not in set(family_ids):
                raise ValueError(
                    f"Student {sid} is not a child of this parent"
                )
            try:
                row_amount = Decimal(str(row["amount"]))
            except Exception as exc:
                raise ValueError(
                    f"Invalid per_student_allocations amount: {row.get('amount')!r}"
                ) from exc
            if row_amount <= 0:
                raise ValueError(
                    "per_student_allocations amounts must be greater than zero"
                )
            manual_total += row_amount

            # FIFO-allocate this student's portion across their invoices,
            # rejecting if their portion exceeds their outstanding (no silent
            # spillover to siblings).
            student_invoices = _student_open_fees_invoices(
                db, tenant_id=tenant_id, student_id=sid
            )
            student_balance = sum(
                (Decimal(i.balance_amount or 0) for i in student_invoices),
                Decimal("0"),
            )
            if row_amount > student_balance:
                raise ValueError(
                    f"Allocation for student {sid} ({row_amount}) exceeds "
                    f"their outstanding ({student_balance})"
                )
            student_remaining = row_amount
            for inv in student_invoices:
                if student_remaining <= 0:
                    break
                bal = Decimal(inv.balance_amount or 0)
                if bal <= 0:
                    continue
                take = min(student_remaining, bal)
                allocations.append({"invoice_id": inv.id, "amount": take})
                student_remaining -= take
            used_student_ids.append(sid)

        if manual_total.quantize(Decimal("0.01")) > Decimal(amount).quantize(Decimal("0.01")):
            raise ValueError(
                "Sum of per_student_allocations cannot exceed payment amount"
            )

    # Family with no open invoices at all → can't record via this path.
    if not allocations:
        raise ValueError(
            "No outstanding fees invoices for this family. Generate term "
            "invoices first, or record a credit via Adjust Balance."
        )

    # Surplus = payment amount minus what we managed to allocate.
    alloc_sum = sum((a["amount"] for a in allocations), Decimal("0"))
    surplus = (Decimal(amount) - alloc_sum).quantize(Decimal("0.01"))

    # When surplus would result AND the allocations span more than one
    # student, credit_to_student_id is mandatory (also re-enforced inside
    # create_payment as a defensive check).
    if surplus > 0 and len(used_student_ids) > 1 and credit_to_student_id is None:
        raise ValueError(
            "credit_to_student_id is required when this payment leaves a "
            "surplus and covers multiple children"
        )

    pay = create_payment(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        provider=provider,
        reference=reference,
        amount=Decimal(amount),
        allocations=[{"invoice_id": a["invoice_id"], "amount": a["amount"]} for a in allocations],
        credit_to_student_id=credit_to_student_id,
    )

    # ─── Build the per-student receipt breakdown ──────────────────────────
    # Map invoice -> student name + meta for grouping.
    inv_ids = [a["invoice_id"] for a in allocations]
    inv_rows = db.execute(
        select(Invoice).where(Invoice.id.in_(inv_ids))
    ).scalars().all()
    inv_by_id = {inv.id: inv for inv in inv_rows}
    inv_enrollment_ids = {inv.enrollment_id for inv in inv_rows if inv.enrollment_id}
    enrollment_to_student: dict[UUID, tuple] = {}
    if inv_enrollment_ids:
        for eid, sid, pl in db.execute(
            select(Enrollment.id, Enrollment.student_id, Enrollment.payload).where(
                Enrollment.tenant_id == tenant_id,
                Enrollment.id.in_(inv_enrollment_ids),
            )
        ).all():
            enrollment_to_student[eid] = (sid, pl)

    student_groups: dict[str, dict] = {}
    for a in allocations:
        inv = inv_by_id.get(a["invoice_id"])
        if inv is None or inv.enrollment_id is None:
            continue
        row = enrollment_to_student.get(inv.enrollment_id)
        if row is None:
            continue
        sid, payload = row
        if sid is None:
            continue
        key = str(sid)
        if key not in student_groups:
            student_groups[key] = {
                "student_id": str(sid),
                "student_name": _student_name_for(db, tenant_id=tenant_id, student_id=sid),
                "admission_no": (payload or {}).get("admission_number"),
                "class_code": (
                    (payload or {}).get("class_code")
                    or (payload or {}).get("admission_class")
                    or None
                ),
                "subtotal": Decimal("0"),
                "allocations": [],
            }
        group = student_groups[key]
        amt = Decimal(a["amount"])
        group["subtotal"] += amt
        group["allocations"].append({
            "invoice_id": str(inv.id),
            "invoice_no": inv.invoice_no,
            "student_id": str(sid),
            "student_name": group["student_name"],
            "term_number": inv.term_number,
            "academic_year": inv.academic_year,
            "amount": str(amt),
        })

    # Stringify subtotals + sort by student name for stable receipt order.
    students_out: list[dict] = []
    for g in sorted(student_groups.values(), key=lambda x: x["student_name"].lower()):
        g["subtotal"] = str(g["subtotal"])
        students_out.append(g)

    credit_to_name: Optional[str] = None
    if surplus > 0 and credit_to_student_id is not None:
        credit_to_name = _student_name_for(
            db, tenant_id=tenant_id, student_id=UUID(str(credit_to_student_id))
        )

    # Resolve the credit CF id from the most recent OVERPAYMENT_CREDIT row
    # this transaction would have created.
    credit_balance_id: Optional[str] = None
    if surplus > 0 and credit_to_student_id is not None:
        from app.models.student_carry_forward import StudentCarryForward
        latest = db.execute(
            select(StudentCarryForward)
            .where(
                StudentCarryForward.tenant_id == tenant_id,
                StudentCarryForward.student_id == UUID(str(credit_to_student_id)),
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
            )
            .order_by(StudentCarryForward.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if latest is not None:
            credit_balance_id = str(latest.id)

    return {
        "payment_id": str(pay.id),
        "receipt_no": pay.receipt_no,
        "amount": str(pay.amount),
        "allocated_total": str(alloc_sum.quantize(Decimal("0.01"))),
        "surplus_credit": str(surplus),
        "credit_balance_id": credit_balance_id,
        "credit_to_student_id": (
            str(credit_to_student_id) if (surplus > 0 and credit_to_student_id is not None) else None
        ),
        "credit_to_student_name": credit_to_name,
        "students": students_out,
    }


def list_payments(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: Optional[UUID] = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    base_q = select(Payment).where(Payment.tenant_id == tenant_id)
    if enrollment_id:
        base_q = base_q.join(
            PaymentAllocation, PaymentAllocation.payment_id == Payment.id
        ).join(
            Invoice, Invoice.id == PaymentAllocation.invoice_id
        ).where(Invoice.enrollment_id == enrollment_id).distinct()

    total: int = db.execute(select(sa_func.count()).select_from(base_q.subquery())).scalar() or 0
    pages = max(1, (total + page_size - 1) // page_size)
    page = max(1, min(page, pages))

    payment_rows = db.execute(
        base_q.order_by(Payment.received_at.desc())
              .limit(page_size)
              .offset((page - 1) * page_size)
    ).scalars().all()

    items: list[dict] = []
    for payment in payment_rows:
        alloc_query = (
            select(PaymentAllocation.invoice_id, PaymentAllocation.amount)
            .select_from(PaymentAllocation)
            .join(Invoice, Invoice.id == PaymentAllocation.invoice_id)
            .where(PaymentAllocation.payment_id == payment.id,
                   Invoice.tenant_id == tenant_id)
        )
        allocations = db.execute(alloc_query).all()
        items.append({
            "id": payment.id,
            "tenant_id": payment.tenant_id,
            "receipt_no": getattr(payment, "receipt_no", None),
            "provider": payment.provider,
            "reference": payment.reference,
            "amount": payment.amount,
            "allocations": [{"invoice_id": r.invoice_id, "amount": r.amount} for r in allocations],
        })

    return {"items": items, "meta": {"total": total, "page": page, "page_size": page_size, "pages": pages}}


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

    # Lazy-fill the QR verification code for any row predating the column.
    if not getattr(inv, "verify_code", None):
        inv.verify_code = _new_verify_code()
        db.flush()

    enrollment = None
    if getattr(inv, "enrollment_id", None):
        enrollment = db.execute(
            select(Enrollment).where(
                Enrollment.tenant_id == tenant_id,
                Enrollment.id == inv.enrollment_id,
            )
        ).scalar_one_or_none()

    identity = _resolve_student_identity(db, tenant_id=tenant_id, enrollment=enrollment)
    student_name = identity["student_name"]
    admission_no = identity["admission_no"]
    class_code = identity["class_code"]
    parent_name = identity["parent_name"]

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

    # Load payment settings for the invoice PDF footer
    payment_settings = get_payment_settings(db, tenant_id=tenant_id)
    ps_dict: dict[str, Any] = {}
    if payment_settings:
        ps_dict = {
            "mpesa_paybill": getattr(payment_settings, "mpesa_paybill", None),
            "mpesa_business_no": getattr(payment_settings, "mpesa_business_no", None),
            "mpesa_account_format": getattr(payment_settings, "mpesa_account_format", None),
            "bank_name": getattr(payment_settings, "bank_name", None),
            "bank_account_name": getattr(payment_settings, "bank_account_name", None),
            "bank_account_number": getattr(payment_settings, "bank_account_number", None),
            "bank_branch": getattr(payment_settings, "bank_branch", None),
            "cash_payment_instructions": getattr(payment_settings, "cash_payment_instructions", None),
        }

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

    # Carry-forward arrears breakdown (stashed on inv.meta by
    # _recalc_invoice_amounts when CF rows are bundled). Surfacing it on the
    # PDF lets the receipt say "Includes previous balance: KES X" without
    # touching line-level payment tracking.
    inv_meta = getattr(inv, "meta", None) or {}
    arrears_summary = (
        {
            "arrears_total": inv_meta.get("arrears_total"),
            "arrears_paid": inv_meta.get("arrears_paid"),
            "arrears_balance": inv_meta.get("arrears_balance"),
            "current_term_total": inv_meta.get("current_term_total"),
            "current_term_paid": inv_meta.get("current_term_paid"),
            "current_term_balance": inv_meta.get("current_term_balance"),
        }
        if "arrears_total" in inv_meta
        else None
    )

    return {
        "document_type": "INVOICE",
        "document_id": str(inv.id),
        "document_no": str(inv.invoice_no),
        "tenant_id": str(tenant_id),
        "profile": profile,
        "student_name": student_name,
        "admission_no": admission_no,
        "class_code": class_code,
        "parent_name": parent_name,
        "invoice_type": str(getattr(inv, "invoice_type", "") or ""),
        "status": str(getattr(inv, "status", "") or ""),
        "term_number": getattr(inv, "term_number", None),
        "academic_year": getattr(inv, "academic_year", None),
        "student_type_snapshot": getattr(inv, "student_type_snapshot", None),
        "currency": str(getattr(inv, "currency", "KES") or "KES"),
        "total_amount": str(getattr(inv, "total_amount", 0) or 0),
        "paid_amount": str(getattr(inv, "paid_amount", 0) or 0),
        "balance_amount": str(getattr(inv, "balance_amount", 0) or 0),
        "arrears_summary": arrears_summary,
        "created_at": (
            getattr(inv, "created_at").isoformat()
            if getattr(inv, "created_at", None) is not None
            else None
        ),
        "lines": lines,
        "payment_settings": ps_dict,
        "checksum": checksum,
        "qr_payload": qr_payload,
        "verify_code": str(getattr(inv, "verify_code", "") or ""),
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

    # Lazy-fill the QR verification code for any row predating the column.
    if not getattr(payment, "verify_code", None):
        payment.verify_code = _new_verify_code()
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
    enrollment_identity_map = {
        str(e.id): _resolve_student_identity(db, tenant_id=tenant_id, enrollment=e)
        for e in enrollments
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

    _empty_identity = {
        "student_name": "Unknown student",
        "admission_no": "",
        "class_code": "",
        "parent_name": "",
    }
    allocations = []
    for row in alloc_rows:
        identity = enrollment_identity_map.get(str(row.enrollment_id), _empty_identity)
        allocations.append({
            "invoice_id": str(row.invoice_id),
            "invoice_no": (str(row.invoice_no) if row.invoice_no is not None else None),
            "amount": str(row.amount or 0),
            "student_name": identity["student_name"],
            "admission_no": identity["admission_no"],
            "class_code": identity["class_code"],
            "parent_name": identity["parent_name"],
            "lines": invoice_lines_map.get(str(row.invoice_id), []),
        })

    # Surplus credit: amount paid minus the sum of allocations. The payment
    # service auto-creates an OVERPAYMENT_CREDIT carry-forward for this surplus;
    # the receipt notes it so the parent sees the split: "Allocated X to
    # invoices, Y credited to next term."
    alloc_total = sum(
        (Decimal(str(row.amount or 0)) for row in alloc_rows), Decimal("0")
    )
    surplus_credit = Decimal(str(getattr(payment, "amount", 0) or 0)) - alloc_total
    if surplus_credit < 0:
        surplus_credit = Decimal("0")

    # ── Per-student grouping for the receipt ──────────────────────────────
    # A single Payment may now cover multiple children (one M-PESA transaction
    # for two siblings). Group allocations by student so the PDF renders one
    # named section per child with their own subtotal, class, and admission
    # number — siblings are often in different classes and the parent needs
    # to see both clearly on the same receipt.
    student_groups: dict[str, dict] = {}
    for row in allocations:
        sid_key = (row.get("student_name") or "") + "|" + (row.get("admission_no") or "")
        # Anchor groups by (student_name, admission_no) so different students
        # with same name still split, and the parent of a one-child record
        # collapses cleanly.
        if sid_key not in student_groups:
            student_groups[sid_key] = {
                "student_name": row.get("student_name") or "Unknown student",
                "admission_no": row.get("admission_no") or "",
                "class_code": row.get("class_code") or "",
                "parent_name": row.get("parent_name") or "",
                "subtotal": Decimal("0"),
                "allocations": [],
            }
        group = student_groups[sid_key]
        amt = Decimal(str(row.get("amount") or 0))
        group["subtotal"] += amt
        group["allocations"].append({
            "invoice_id": row.get("invoice_id"),
            "invoice_no": row.get("invoice_no"),
            "amount": row.get("amount"),
            "lines": row.get("lines", []),
        })
    students_out = [
        {**g, "subtotal": str(g["subtotal"])}
        for g in sorted(
            student_groups.values(),
            key=lambda x: str(x.get("student_name") or "").lower(),
        )
    ]

    # Surplus credit student lookup — from the most recent OVERPAYMENT_CREDIT
    # carry-forward this payment created. We tie back via the description
    # which embeds the receipt number; safe even if multiple credits ever
    # land in quick succession because the description is unique per payment.
    surplus_credit_student: dict | None = None
    if surplus_credit > 0:
        from app.models.student_carry_forward import StudentCarryForward
        from app.models.student import Student as _Student
        rec_no = getattr(payment, "receipt_no", None) or str(payment.id)
        cf_row = db.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant_id,
                StudentCarryForward.category == "OVERPAYMENT_CREDIT",
                StudentCarryForward.description.like(f"%{rec_no}%"),
            )
            .order_by(StudentCarryForward.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if cf_row is not None:
            stu = db.get(_Student, cf_row.student_id)
            if stu is not None:
                surplus_credit_student = {
                    "student_id": str(stu.id),
                    "student_name": " ".join(
                        str(getattr(stu, a, "") or "").strip()
                        for a in ("first_name", "other_names", "last_name")
                    ).strip() or "Student",
                    "admission_no": getattr(stu, "admission_no", None),
                }

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
        "students": students_out,
        "allocated_total": str(alloc_total),
        "surplus_credit": str(surplus_credit),
        "surplus_credit_student": surplus_credit_student,
        "checksum": checksum,
        "qr_payload": qr_payload,
        "verify_code": str(getattr(payment, "verify_code", "") or ""),
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

    # Load tenant branding fields for the PDF header
    tenant_row = db.get(Tenant, tenant_id)
    school_name = str(getattr(tenant_row, "name", "") or "")
    school_address = str(getattr(tenant_row, "school_address", "") or "")
    school_phone = str(getattr(tenant_row, "school_phone", "") or "")
    school_email = str(getattr(tenant_row, "school_email", "") or "")
    brand_color = str(getattr(tenant_row, "brand_color", "") or "")

    return {
        "document_type": "FEE_STRUCTURE",
        "document_id": str(structure.id),
        "document_no": str(structure.structure_no),
        "tenant_id": str(tenant_id),
        "profile": profile,
        # Branding fields used by the PDF generator
        "school_name": school_name,
        "school_address": school_address,
        "school_phone": school_phone,
        "school_email": school_email,
        "brand_color": brand_color,
        "class_code": str(getattr(structure, "class_code", "") or ""),
        "term_code": str(getattr(structure, "term_code", "GENERAL") or "GENERAL"),
        "academic_year": str(getattr(structure, "academic_year", "") or ""),
        "student_type": str(getattr(structure, "student_type", "") or ""),
        "name": str(getattr(structure, "name", "") or ""),
        "structure_no": str(getattr(structure, "structure_no", "") or ""),
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
                "term_1_amount": str(i.get("term_1_amount") or 0),
                "term_2_amount": str(i.get("term_2_amount") or 0),
                "term_3_amount": str(i.get("term_3_amount") or 0),
                "charge_frequency": str(i.get("charge_frequency") or "PER_TERM"),
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
            ]
        )
        arrears = payload.get("arrears_summary")
        if isinstance(arrears, dict) and arrears.get("arrears_total"):
            try:
                arr_total = Decimal(str(arrears.get("arrears_total") or 0))
            except Exception:
                arr_total = Decimal("0")
            if arr_total != 0:
                tag = "Includes previous balance" if arr_total > 0 else "Includes credit balance"
                lines.append(f"{tag}: {arrears.get('arrears_total')}")
                lines.append(f"Current term: {arrears.get('current_term_total')}")
        lines.append("")
        lines.append("Lines:")
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
            ]
        )
        try:
            surplus = Decimal(str(payload.get("surplus_credit") or 0))
        except Exception:
            surplus = Decimal("0")
        if surplus > 0:
            lines.append(f"Allocated to invoices: {payload.get('allocated_total')}")
            credit_stu = payload.get("surplus_credit_student") or {}
            credit_label = credit_stu.get("student_name") if isinstance(credit_stu, dict) else None
            if credit_label:
                lines.append(f"Credit forward ({credit_label}): {surplus}")
            else:
                lines.append(f"Credit forward (next term): {surplus}")
        lines.append("")
        students = payload.get("students") or []
        if students and isinstance(students, list):
            # Per-student sections — needed when a single payment covers two
            # siblings (often in different classes). Each section shows the
            # student's identity + their share of the allocations.
            for stu in students:
                if not isinstance(stu, dict):
                    continue
                ident_bits = [
                    stu.get("student_name") or "Unknown student",
                    stu.get("admission_no") or "",
                    stu.get("class_code") or "",
                ]
                header = " · ".join(b for b in ident_bits if b)
                lines.append(f"Student: {header}")
                for idx, row in enumerate(stu.get("allocations") or [], start=1):
                    if not isinstance(row, dict):
                        continue
                    lines.append(
                        f"  {idx}. {row.get('invoice_no') or row.get('invoice_id')}: {row.get('amount')}"
                    )
                lines.append(f"  Subtotal: {stu.get('subtotal')}")
                lines.append("")
        else:
            lines.append("Allocations:")
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


def render_document_pdf(payload: dict[str, Any], *, receipt_force_a4: bool = False) -> bytes:
    dtype = str(payload.get("document_type") or "").upper()

    # Fee structure sheet PDF
    if dtype == "FEE_STRUCTURE":
        try:
            from app.utils.fee_structure_pdf import generate_fee_structure_pdf
            return generate_fee_structure_pdf(payload)
        except Exception as exc:
            logger.exception("fee_structure_pdf rendering failed, falling back to plain-text: %s", exc)

    # Enterprise invoice template (A4, school header + fee items table + payment block)
    if dtype == "INVOICE":
        try:
            from app.utils.invoice_pdf import generate_invoice_pdf
            return generate_invoice_pdf(payload)
        except Exception as exc:
            logger.exception("invoice_pdf rendering failed, falling back to plain-text: %s", exc)

    # Enterprise receipt template (A4 or Thermal with embedded QR code)
    if dtype == "RECEIPT":
        try:
            from app.utils.receipt_pdf import generate_receipt_pdf
            return generate_receipt_pdf(payload, force_a4=receipt_force_a4)
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
    """Return the enrollment's interview + school-fees status.

    fees.paid_ok is aggregate: it is True only when EVERY non-cancelled
    SCHOOL_FEES invoice for this enrollment is PAID AND the student has no
    pending carry-forward arrears. This is what the transfer-out gate needs
    ("school fees fully cleared" must mean across all terms and prior years,
    not just the most recent term).

    fees.partial_ok stays scoped to the latest fees invoice — it answers the
    admission-time question "can we enroll this student with a deposit?",
    which is always evaluated against the just-generated Term-1 invoice.
    """
    invs = db.execute(
        select(Invoice)
        .where(
            Invoice.tenant_id == tenant_id,
            Invoice.enrollment_id == enrollment_id,
        )
        .order_by(Invoice.created_at.desc())
    ).scalars().all()

    interview = next((i for i in invs if i.invoice_type == "INTERVIEW"), None)

    # Newest-first list of active fees invoices. CANCELLED is frozen and
    # excluded from balance calculations (matches _recalc_invoice_amounts).
    fees_invoices = [
        i for i in invs if i.invoice_type == "SCHOOL_FEES" and i.status != "CANCELLED"
    ]
    fees_latest = fees_invoices[0] if fees_invoices else None

    policy = get_or_create_policy(db, tenant_id=tenant_id)

    # Pending carry-forward (arrears) for the student behind this enrollment.
    # Carry-forward is per-student, so arrears persist across enrollments and
    # must be cleared before "fees fully paid" is true.
    student_id = db.execute(
        select(Enrollment.student_id).where(
            Enrollment.id == enrollment_id,
            Enrollment.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()

    pending_cf_total = Decimal("0")
    if student_id:
        from app.models.student_carry_forward import StudentCarryForward
        cf_amounts = db.execute(
            select(StudentCarryForward.amount).where(
                StudentCarryForward.tenant_id == tenant_id,
                StudentCarryForward.student_id == student_id,
                StudentCarryForward.status == "OPEN",
            )
        ).scalars().all()
        pending_cf_total = sum(
            (Decimal(str(a or 0)) for a in cf_amounts), Decimal("0")
        )

    total_outstanding = sum(
        (Decimal(i.balance_amount or 0) for i in fees_invoices), Decimal("0")
    )
    unpaid_terms = [
        {
            "invoice_id": str(i.id),
            "invoice_no": i.invoice_no,
            "term_number": i.term_number,
            "academic_year": i.academic_year,
            "status": i.status,
            "balance_amount": str(i.balance_amount or 0),
        }
        for i in fees_invoices
        if i.status != "PAID"
    ]

    def interview_paid_ok(inv: Optional[Invoice]) -> bool:
        return bool(inv and inv.status == "PAID")

    fees_paid_ok = (
        len(fees_invoices) > 0
        and all(i.status == "PAID" for i in fees_invoices)
        and pending_cf_total == 0
    )

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
    if fees_latest is not None:
        structure = _resolve_fee_structure_for_enrollment(
            db,
            tenant_id=tenant_id,
            enrollment_id=enrollment_id,
            fees_invoice=fees_latest,
        )
        if structure is not None:
            _ok, meta = _structure_partial_ok(
                db,
                tenant_id=tenant_id,
                invoice=fees_latest,
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
            "paid_ok": interview_paid_ok(interview),
        },
        "fees": {
            # Latest-term invoice id/status (backward-compatible field names).
            "invoice_id": str(fees_latest.id) if fees_latest else None,
            "status": fees_latest.status if fees_latest else None,
            # Aggregate across all terms + pending carry-forward.
            "paid_ok": fees_paid_ok,
            # Admission-time partial gate, scoped to the latest invoice.
            "partial_ok": partial_ok(fees_latest),
            # Aggregate observability — useful for UIs and the transfer gate.
            "invoice_count": len(fees_invoices),
            "total_outstanding": str(total_outstanding),
            "unpaid_terms": unpaid_terms,
            "pending_carry_forward_total": str(pending_cf_total),
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


# ─────────────────────────────────────────────────────────────────────────────
# Tenant Payment Settings
# ─────────────────────────────────────────────────────────────────────────────

def build_fee_structure_document(
    db: Session,
    *,
    tenant_id: UUID,
    structure_id: UUID,
) -> dict[str, Any]:
    """Build full data dict for the fee structure PDF."""
    structure = _get_structure_or_error(db, tenant_id=tenant_id, structure_id=structure_id)
    items = _list_structure_items_detailed(db, tenant_id=tenant_id, structure_id=structure_id)

    profile = get_tenant_print_profile(db, tenant_id=tenant_id)
    payment_settings = get_payment_settings(db, tenant_id=tenant_id)
    ps_dict: dict[str, Any] = {}
    if payment_settings:
        ps_dict = {
            "mpesa_paybill": getattr(payment_settings, "mpesa_paybill", None),
            "mpesa_business_no": getattr(payment_settings, "mpesa_business_no", None),
            "mpesa_account_format": getattr(payment_settings, "mpesa_account_format", None),
            "bank_name": getattr(payment_settings, "bank_name", None),
            "bank_account_name": getattr(payment_settings, "bank_account_name", None),
            "bank_account_number": getattr(payment_settings, "bank_account_number", None),
            "bank_branch": getattr(payment_settings, "bank_branch", None),
            "cash_payment_instructions": getattr(payment_settings, "cash_payment_instructions", None),
            "uniform_details_text": getattr(payment_settings, "uniform_details_text", None),
            "uniform_details_text_jss": getattr(payment_settings, "uniform_details_text_jss", None),
            "assessment_books_amount": getattr(payment_settings, "assessment_books_amount", None),
            "assessment_books_note": getattr(payment_settings, "assessment_books_note", None),
            "remedial_fee_amount": getattr(payment_settings, "remedial_fee_amount", None),
        }

    school_name = str(profile.get("school_header") or profile.get("school_name") or profile.get("name") or "School") if profile else "School"
    school_address = str(profile.get("physical_address") or profile.get("po_box") or profile.get("address") or "") if profile else ""
    school_phone = str(profile.get("phone") or "") if profile else ""

    return {
        "document_type": "FEE_STRUCTURE",
        "document_id": str(structure.id),
        "school_name": school_name,
        "school_address": school_address,
        "school_phone": school_phone,
        "class_code": structure.class_code,
        "academic_year": structure.academic_year,
        "student_type": structure.student_type,
        "structure_no": structure.structure_no,
        "items": [
            {
                "fee_item_name": it["fee_item_name"],
                "charge_frequency": it["charge_frequency"],
                "term_1_amount": str(it["term_1_amount"]),
                "term_2_amount": str(it["term_2_amount"]),
                "term_3_amount": str(it["term_3_amount"]),
            }
            for it in items
        ],
        "payment_settings": ps_dict,
    }


def get_payment_settings(db: Session, *, tenant_id: UUID) -> TenantPaymentSettings | None:
    return db.execute(
        select(TenantPaymentSettings).where(TenantPaymentSettings.tenant_id == tenant_id)
    ).scalar_one_or_none()


def upsert_payment_settings(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    data: dict,
) -> TenantPaymentSettings:
    row = get_payment_settings(db, tenant_id=tenant_id)
    if not row:
        row = TenantPaymentSettings(tenant_id=tenant_id)
        db.add(row)

    updatable = (
        "mpesa_paybill", "mpesa_business_no", "mpesa_account_format",
        "bank_name", "bank_account_name", "bank_account_number", "bank_branch",
        "cash_payment_instructions", "uniform_details_text",
        "uniform_details_text_jss",
        "assessment_books_amount", "assessment_books_note",
        "remedial_fee_amount",
    )
    for field in updatable:
        if field in data:
            setattr(row, field, data[field])

    db.flush()
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="finance.payment_settings.upsert",
        resource="tenant_payment_settings",
        resource_id=row.id,
        payload=None,
        meta=None,
    )
    return row


# ─────────────────────────────────────────────────────────────────────────────
# Smart Invoice Generator v2
# Detects student type from admission_year, picks correct fee structure,
# applies per-term amounts, enforces ONCE_PER_YEAR / ONCE_EVER guards,
# and creates one invoice per term (duplicate-guarded at DB level).
# ─────────────────────────────────────────────────────────────────────────────

def _detect_student_type(admission_year: int, academic_year: int) -> str:
    """NEW if first year, RETURNING otherwise. Legacy helper kept for any
    code path that still depends on simple year math (e.g. fee-structure
    eligibility); the authoritative caller is now _resolve_student_type
    below, which layers explicit source + prior-invoice signals on top."""
    return "NEW" if admission_year >= academic_year else "RETURNING"


def _enrollment_is_existing_student(db: Session, *, tenant_id: UUID, enrollment_id: UUID) -> bool:
    """True when this enrollment came from the existing-student registry.

    Such students already paid admission before the system, so they must be
    billed as RETURNING (no admission fee).
    """
    row = db.execute(
        select(Enrollment.payload).where(
            Enrollment.id == enrollment_id,
            Enrollment.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    payload = row or {}
    source = str(payload.get("enrollment_source") or "").upper()
    return source == "EXISTING_STUDENT"


# Possible values of the `resolved_by` tag returned by _resolve_student_type.
# Stashed on invoice.meta and on the audit payload so a director can see
# (and dispute, if needed) why a given invoice was classified the way it was.
STUDENT_TYPE_RESOLVED_FORCE_OVERRIDE = "force_override"
STUDENT_TYPE_RESOLVED_SOURCE_OVERRIDE = "source_override"
STUDENT_TYPE_RESOLVED_PRIOR_INVOICE = "prior_invoice"
STUDENT_TYPE_RESOLVED_YEAR_MATH = "year_math"
STUDENT_TYPE_RESOLVED_FIRST_INTAKE = "first_intake"


def _student_has_prior_fees_invoice(
    db: Session,
    *,
    tenant_id: UUID,
    student_id: Optional[UUID],
    exclude_enrollment_id: Optional[UUID] = None,
) -> bool:
    """True if this student already has a non-CANCELLED SCHOOL_FEES invoice in
    the system. We deliberately exclude CANCELLED — a voided invoice should
    NOT keep a student classified as RETURNING (matches the
    _recalc_invoice_amounts policy that treats CANCELLED as out-of-scope).

    exclude_enrollment_id is honoured if supplied, so the resolver doesn't
    count the *current* enrollment's existing invoice (e.g. on a replace flow)
    against itself.
    """
    if student_id is None:
        return False
    q = (
        select(sa_func.count(Invoice.id))
        .select_from(Invoice)
        .join(Enrollment, Enrollment.id == Invoice.enrollment_id)
        .where(
            Invoice.tenant_id == tenant_id,
            Enrollment.student_id == student_id,
            Invoice.invoice_type == "SCHOOL_FEES",
            Invoice.status != "CANCELLED",
        )
    )
    if exclude_enrollment_id is not None:
        q = q.where(Invoice.enrollment_id != exclude_enrollment_id)
    count = db.execute(q).scalar() or 0
    return count > 0


def _resolve_student_type(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID,
    student_id: Optional[UUID],
    admission_year: int,
    academic_year: int,
    force_student_type: Optional[str] = None,
    exclude_enrollment_id_for_prior_invoice: Optional[UUID] = None,
) -> tuple[str, str]:
    """Decide whether this invoice is for a NEW or RETURNING student.

    Returns (student_type, resolved_by). resolved_by is one of the constants
    above and is persisted on the invoice's meta + the audit log so the
    decision is fully traceable.

    The rule layers four signals, most-deterministic first:

        Step 0  force_student_type            -> FORCE_OVERRIDE     (caller's call)
        Step 1  enrollment_source = EXISTING  -> SOURCE_OVERRIDE    (RETURNING)
        Step 2  prior non-CANCELLED fees inv  -> PRIOR_INVOICE      (RETURNING)
        Step 3  admission_year < academic_yr  -> YEAR_MATH          (RETURNING)
        Step 4  otherwise                     -> FIRST_INTAKE       (NEW)

    Step 2 is the powerful new one: 'the system has billed this student
    school fees before' is the most reliable RETURNING signal there is, and
    it catches the Term 2 / Term 3 cases that year-math alone got wrong.
    """
    # Step 0 — explicit caller override (admin/replace flow).
    if force_student_type and force_student_type.upper() in ("NEW", "RETURNING"):
        return force_student_type.upper(), STUDENT_TYPE_RESOLVED_FORCE_OVERRIDE

    # Step 1 — existing-student onboard always RETURNING.
    if _enrollment_is_existing_student(
        db, tenant_id=tenant_id, enrollment_id=enrollment_id
    ):
        return "RETURNING", STUDENT_TYPE_RESOLVED_SOURCE_OVERRIDE

    # Step 2 — any prior (non-cancelled) SCHOOL_FEES invoice for this student.
    if _student_has_prior_fees_invoice(
        db,
        tenant_id=tenant_id,
        student_id=student_id,
        exclude_enrollment_id=exclude_enrollment_id_for_prior_invoice,
    ):
        return "RETURNING", STUDENT_TYPE_RESOLVED_PRIOR_INVOICE

    # Step 3 — year math (admission predates the academic year being invoiced).
    if admission_year < academic_year:
        return "RETURNING", STUDENT_TYPE_RESOLVED_YEAR_MATH

    # Step 4 — first-time intake.
    return "NEW", STUDENT_TYPE_RESOLVED_FIRST_INTAKE


def _get_term_amount(item: Any, term_number: int) -> Decimal:
    col = f"term_{term_number}_amount"
    return Decimal(getattr(item, col, 0) or 0)


def _once_per_year_already_invoiced(
    db: Session, *, tenant_id: UUID, enrollment_id: UUID, academic_year: int, fee_item_id: UUID
) -> bool:
    """Check if a ONCE_PER_YEAR item was already invoiced in any term this year."""
    result = db.execute(
        sa_func.count(InvoiceLine.id).select().select_from(InvoiceLine)
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .where(
            Invoice.tenant_id == tenant_id,
            Invoice.enrollment_id == enrollment_id,
            Invoice.academic_year == academic_year,
            Invoice.invoice_type == "SCHOOL_FEES",
            InvoiceLine.meta["fee_item_id"].astext == str(fee_item_id),
        )
    ).scalar()
    return (result or 0) > 0


def _once_ever_already_invoiced(
    db: Session, *, tenant_id: UUID, enrollment_id: UUID, fee_item_id: UUID
) -> bool:
    """Check if a ONCE_EVER item was ever invoiced for this enrollment."""
    result = db.execute(
        sa_func.count(InvoiceLine.id).select().select_from(InvoiceLine)
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .where(
            Invoice.tenant_id == tenant_id,
            Invoice.enrollment_id == enrollment_id,
            Invoice.invoice_type == "SCHOOL_FEES",
            InvoiceLine.meta["fee_item_id"].astext == str(fee_item_id),
        )
    ).scalar()
    return (result or 0) > 0


def generate_school_fees_invoice_v2(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    enrollment_id: UUID,
    term_number: int,
    academic_year: int,
    scholarship_id: Optional[UUID] = None,
    scholarship_amount: Optional[Decimal] = None,
    scholarship_reason: Optional[str] = None,
    # Always-on by default: any pending balance adjustment for the student is
    # rolled into a single "Arrears (Brought Forward)" line on the new invoice
    # so the parent sees one correct total. Set False only in tests or for an
    # explicitly arrears-free invoice.
    include_carry_forward: bool = True,
    force_student_type: Optional[str] = None,
    existing_invoice: Optional[Invoice] = None,
) -> Invoice:
    """
    Smart invoice generator:
    - Loads enrollment → student → admission_year
    - Detects NEW vs RETURNING based on admission_year vs academic_year
    - Finds matching fee structure (class_code + academic_year + student_type)
    - Applies term-specific amounts
    - Skips ONCE_PER_YEAR / ONCE_EVER items already invoiced
    - Creates one SCHOOL_FEES invoice per enrollment per term (DB-enforced unique index)
    """
    if term_number not in (1, 2, 3):
        raise ValueError("term_number must be 1, 2, or 3")

    # Load enrollment
    enrollment = db.execute(
        select(Enrollment).where(
            Enrollment.id == enrollment_id,
            Enrollment.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not enrollment:
        raise ValueError("Enrollment not found")

    enrollment_payload = getattr(enrollment, "payload", None) or {}
    student_id = getattr(enrollment, "student_id", None)

    # ── class_code resolution (multi-level fallback) ──────────────────────────
    # 1) Check common payload keys from the intake / application form
    class_code = str(
        enrollment_payload.get("class_code")
        or enrollment_payload.get("classCode")
        or enrollment_payload.get("class")
        or enrollment_payload.get("admission_class")
        or enrollment_payload.get("grade")
        or ""
    ).strip() or None

    # 2) Check the student's current class via student_class_enrollments
    if not class_code and student_id:
        sce_row = db.execute(
            __import__("sqlalchemy").text(
                """
                SELECT tc.code
                FROM core.student_class_enrollments sce
                JOIN core.tenant_classes tc ON tc.id = sce.class_id
                WHERE sce.student_id = :sid
                  AND sce.tenant_id  = :tid
                ORDER BY sce.created_at DESC
                LIMIT 1
                """
            ),
            {"sid": str(student_id), "tid": str(tenant_id)},
        ).mappings().first()
        if sce_row:
            class_code = str(sce_row["code"]).strip() or None

    # 3) Check the assigned fee structure for this enrollment
    if not class_code:
        from app.models.student_fee_assignment import StudentFeeAssignment
        sfa_row = db.execute(
            select(FeeStructure)
            .join(StudentFeeAssignment, StudentFeeAssignment.fee_structure_id == FeeStructure.id)
            .where(
                StudentFeeAssignment.tenant_id == tenant_id,
                StudentFeeAssignment.enrollment_id == enrollment_id,
            )
            .order_by(StudentFeeAssignment.assigned_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if sfa_row:
            class_code = sfa_row.class_code

    if not class_code:
        raise ValueError(
            "Cannot determine class for this enrollment. "
            "Please ensure the student is assigned to a class or the enrollment form includes a class."
        )

    # Duplicate guard: one SCHOOL_FEES invoice per enrollment per term per year.
    # Skipped when regenerating an invoice in place (replace flow).
    if existing_invoice is None:
        dupe = db.execute(
            select(Invoice).where(
                Invoice.tenant_id == tenant_id,
                Invoice.enrollment_id == enrollment_id,
                Invoice.term_number == term_number,
                Invoice.academic_year == academic_year,
                Invoice.invoice_type == "SCHOOL_FEES",
            )
        ).scalar_one_or_none()
        if dupe:
            raise ValueError(
                f"A SCHOOL_FEES invoice already exists for this student in "
                f"Term {term_number} {academic_year} "
                f"(invoice: {dupe.invoice_no or str(dupe.id)[:8]})"
            )

    # Load student for admission_year
    student = db.execute(
        select(Student).where(Student.id == student_id, Student.tenant_id == tenant_id)
    ).scalar_one_or_none() if student_id else None

    admission_year = getattr(student, "admission_year", academic_year) if student else academic_year

    # Authoritative 4-step resolver (see _resolve_student_type docstring).
    # On a replace/regenerate flow we DO want to exclude this very enrollment's
    # existing invoice from the "prior invoice" check, otherwise replacing the
    # FIRST invoice of a brand-new student would flip them to RETURNING on
    # their own re-issue. New generations (existing_invoice is None) keep the
    # plain rule.
    exclude_self_enrollment = (
        enrollment_id if existing_invoice is not None else None
    )
    student_type, student_type_resolved_by = _resolve_student_type(
        db,
        tenant_id=tenant_id,
        enrollment_id=enrollment_id,
        student_id=student_id,
        admission_year=admission_year,
        academic_year=academic_year,
        force_student_type=force_student_type,
        exclude_enrollment_id_for_prior_invoice=exclude_self_enrollment,
    )

    # Find fee structure
    norm_class = _norm_upper(str(class_code))
    structure = db.execute(
        select(FeeStructure).where(
            FeeStructure.tenant_id == tenant_id,
            FeeStructure.class_code == norm_class,
            FeeStructure.academic_year == academic_year,
            FeeStructure.student_type == student_type,
            FeeStructure.is_active == True,
        )
    ).scalar_one_or_none()
    if not structure:
        raise ValueError(
            f"No active fee structure found for class '{norm_class}', "
            f"year {academic_year}, student type {student_type}"
        )

    # Pull structure items with fee item details
    items = db.execute(
        select(
            FeeStructureItem.fee_item_id,
            FeeStructureItem.term_1_amount,
            FeeStructureItem.term_2_amount,
            FeeStructureItem.term_3_amount,
            FeeItem.name.label("fee_item_name"),
            FeeItem.code.label("fee_item_code"),
            FeeItem.charge_frequency,
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

    lines: list[dict] = []
    for it in items:
        freq = it.charge_frequency or "PER_TERM"

        if freq == "PER_TERM":
            amount = _get_term_amount(it, term_number)
        elif freq == "ONCE_PER_YEAR":
            if term_number != 1:
                # ONCE_PER_YEAR is only charged in Term 1
                continue
            if _once_per_year_already_invoiced(
                db, tenant_id=tenant_id, enrollment_id=enrollment_id,
                academic_year=academic_year, fee_item_id=it.fee_item_id
            ):
                continue
            amount = it.term_1_amount  # canonical value for once-per-year items
        elif freq == "ONCE_EVER":
            if _once_ever_already_invoiced(
                db, tenant_id=tenant_id, enrollment_id=enrollment_id, fee_item_id=it.fee_item_id
            ):
                continue
            amount = it.term_1_amount  # canonical value
        else:
            amount = _get_term_amount(it, term_number)

        if Decimal(amount or 0) == 0:
            continue

        lines.append({
            "description": f"{it.fee_item_name} ({norm_class})",
            "amount": Decimal(amount),
            "meta": {
                "fee_item_id": str(it.fee_item_id),
                "fee_item_code": it.fee_item_code,
                "charge_frequency": freq,
            },
        })

    if not lines:
        raise ValueError("No chargeable fee items for this term (all items already invoiced or zero-amount)")

    # ── Interview fee credit for NEW students (Term 1 only) ───────────────────
    # If this student already paid an interview fee, carry it forward as a
    # negative line so the school fees invoice shows the correct balance owed.
    interview_credit: Decimal = Decimal("0")
    if student_type == "NEW" and term_number == 1:
        interview_inv = db.execute(
            select(Invoice).where(
                Invoice.tenant_id == tenant_id,
                Invoice.enrollment_id == enrollment_id,
                Invoice.invoice_type == "INTERVIEW",
            ).order_by(Invoice.created_at.desc()).limit(1)
        ).scalar_one_or_none()
        if interview_inv and Decimal(interview_inv.paid_amount or 0) > 0:
            interview_credit = Decimal(str(interview_inv.paid_amount))

    if existing_invoice is not None:
        # Regenerate in place — keep the same invoice row (and its payments),
        # just rebuild the lines from the correct structure.
        inv = existing_invoice
        old_lines = db.execute(
            select(InvoiceLine).where(InvoiceLine.invoice_id == inv.id)
        ).scalars().all()
        from app.models.student_carry_forward import StudentCarryForward
        # Release any carry-forward rows this invoice had absorbed, regardless of
        # which line they were attached to (the legacy code only handled
        # per-line CF rows; with the rolled-up "Arrears" line we look them up
        # by invoice_id directly).
        db.execute(
            StudentCarryForward.__table__.update()
            .where(
                StudentCarryForward.tenant_id == tenant_id,
                StudentCarryForward.invoice_id == inv.id,
                StudentCarryForward.status == "BUNDLED",
            )
            .values(status="OPEN", invoice_id=None)
        )
        for old_ln in old_lines:
            db.delete(old_ln)
        inv.status = "DRAFT"
        inv.student_type_snapshot = student_type
        db.flush()
        if not inv.invoice_no:
            inv.invoice_no = _next_document_number(
                db, tenant_id=tenant_id, doc_type="INV",
                created_at=getattr(inv, "created_at", None),
            )
            db.flush()
    else:
        # Create the invoice
        inv = Invoice(
            tenant_id=tenant_id,
            invoice_type="SCHOOL_FEES",
            enrollment_id=enrollment_id,
            status="DRAFT",
            term_number=term_number,
            academic_year=academic_year,
            student_type_snapshot=student_type,
        )
        db.add(inv)
        db.flush()

        inv.invoice_no = _next_document_number(
            db,
            tenant_id=tenant_id,
            doc_type="INV",
            created_at=getattr(inv, "created_at", None),
        )
        db.flush()

    # Roll any open balance adjustments into ONE "Arrears (Brought Forward)"
    # line, inserted first so it shows at the top of the invoice and PDF. The
    # individual carry-forward rows are linked via invoice_id (their status
    # flips OPEN → BUNDLED) and listed in the line's meta so the audit log
    # and a future drill-down can still show the breakdown.
    if include_carry_forward and student_id:
        from app.models.student_carry_forward import StudentCarryForward
        cf_rows = db.execute(
            select(StudentCarryForward).where(
                StudentCarryForward.tenant_id == tenant_id,
                StudentCarryForward.student_id == student_id,
                StudentCarryForward.status == "OPEN",
            )
        ).scalars().all()
        if cf_rows:
            arrears_total = sum(
                (Decimal(str(cf.amount)) for cf in cf_rows), Decimal("0")
            )
            if arrears_total != 0:
                description = (
                    "Arrears (Brought Forward)"
                    if arrears_total > 0
                    else "Credit Balance (Brought Forward)"
                )
                breakdown = [
                    {
                        "id": str(cf.id),
                        "term_label": cf.term_label,
                        "amount": str(cf.amount),
                        "category": cf.category,
                    }
                    for cf in cf_rows
                ]
                db.add(InvoiceLine(
                    invoice_id=inv.id,
                    description=description,
                    amount=arrears_total,
                    meta={
                        "line_type": "CARRY_FORWARD_ROLLUP",
                        "carry_forward_ids": [str(cf.id) for cf in cf_rows],
                        "breakdown": breakdown,
                    },
                ))
            for cf in cf_rows:
                cf.status = "BUNDLED"
                cf.invoice_id = inv.id
            db.flush()

    for ln in lines:
        db.add(InvoiceLine(
            invoice_id=inv.id,
            description=ln["description"],
            amount=ln["amount"],
            meta=ln.get("meta"),
        ))

    # Add interview fee credit line
    if interview_credit > 0:
        db.add(InvoiceLine(
            invoice_id=inv.id,
            description="Interview Fee Credit (already paid)",
            amount=-interview_credit,
            meta={"line_type": "INTERVIEW_CREDIT", "interview_invoice_id": str(interview_inv.id)},
        ))

    db.flush()
    _recalc_invoice_amounts(db, inv)
    db.flush()

    # Store fee structure context in meta + the resolver decision so a
    # director can see (and dispute, if needed) why this invoice was billed
    # as NEW vs RETURNING.
    inv.meta = {
        **(inv.meta or {}),
        "fee_structure_id": str(structure.id),
        "class_code": structure.class_code,
        "student_type": student_type,
        "student_type_resolved_by": student_type_resolved_by,
        "academic_year": academic_year,
        "term_number": term_number,
    }
    db.flush()

    # Apply scholarship discount if provided
    if scholarship_id:
        sch = db.execute(
            select(Scholarship).where(
                Scholarship.id == scholarship_id,
                Scholarship.tenant_id == tenant_id,
                Scholarship.is_active == True,
            )
        ).scalar_one_or_none()
        if not sch:
            raise ValueError("Scholarship not found or inactive")

        if scholarship_amount is None:
            if sch.type == "PERCENTAGE":
                scholarship_amount = (inv.total_amount * Decimal(sch.value) / 100).quantize(Decimal("0.01"))
            elif sch.max_recipients and sch.max_recipients > 1:
                # Pool scholarship: divide equally among all recipients
                scholarship_amount = (Decimal(sch.value) / Decimal(sch.max_recipients)).quantize(Decimal("0.01"))
            else:
                scholarship_amount = Decimal(sch.value)

        if scholarship_amount > 0:
            recipient_note = (
                f" (1 of {sch.max_recipients} recipients)"
                if sch.max_recipients and sch.max_recipients > 1
                else ""
            )
            db.add(InvoiceLine(
                invoice_id=inv.id,
                description=f"Scholarship: {sch.name}{recipient_note}{(' — ' + scholarship_reason) if scholarship_reason else ''}",
                amount=-abs(scholarship_amount),
                meta={
                    "scholarship_id": str(scholarship_id),
                    "scholarship_type": sch.type,
                    "max_recipients": sch.max_recipients,
                },
            ))
            db.flush()
            _recalc_invoice_amounts(db, inv)
            db.flush()

            allocation = ScholarshipAllocation(
                tenant_id=tenant_id,
                scholarship_id=scholarship_id,
                enrollment_id=enrollment_id,
                student_id=student_id,
                invoice_id=inv.id,
                amount=scholarship_amount,
                reason=scholarship_reason or "",
            )
            db.add(allocation)
            db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="invoice.create.v2",
        resource="invoice",
        resource_id=inv.id,
        payload={
            "type": inv.invoice_type,
            "term_number": term_number,
            "academic_year": academic_year,
            "student_type": student_type,
            "student_type_resolved_by": student_type_resolved_by,
        },
        meta=None,
    )
    return inv


def publish_invoice(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    invoice_id: UUID,
) -> Invoice:
    """Move an invoice out of DRAFT into its live status (ISSUED / PARTIAL /
    PAID, depending on existing allocations).

    The DRAFT status is the secretary's safety net — generation produces a
    DRAFT, the secretary reviews it (preview modal), then publishes. Only
    after publish are payments allowed and parents notified.

    Raises ValueError when the invoice is not DRAFT (idempotent guard so a
    double-click does not silently no-op or worse).
    """
    inv = db.execute(
        select(Invoice).where(
            Invoice.id == invoice_id,
            Invoice.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not inv:
        raise ValueError("Invoice not found")
    if inv.status != "DRAFT":
        raise ValueError(
            f"Invoice is already {inv.status} — only DRAFT invoices can be published"
        )

    before_status = inv.status
    total = Decimal(inv.total_amount or 0)
    if total <= 0:
        raise ValueError(
            "Cannot publish an empty invoice — add fee lines or delete the draft"
        )

    paid = Decimal(inv.paid_amount or 0)
    if paid >= total:
        inv.status = "PAID"
    elif paid > 0:
        inv.status = "PARTIAL"
    else:
        inv.status = "ISSUED"
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="invoice.publish",
        resource="invoice",
        resource_id=inv.id,
        payload={
            "before_status": before_status,
            "after_status": inv.status,
            "invoice_no": inv.invoice_no,
            "total_amount": str(total),
            "enrollment_id": str(inv.enrollment_id) if inv.enrollment_id else None,
        },
        meta=None,
    )
    return inv


def replace_fees_invoice(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    invoice_id: UUID,
    student_type: str,
    # Default True to match generate_school_fees_invoice_v2 — the open
    # balance adjustments for the student auto-attach as a single 'Arrears'
    # line whenever the invoice is regenerated.
    include_carry_forward: bool = True,
) -> Invoice:
    """Fix a wrong school-fees invoice by regenerating it from the right
    structure, in place (no data lost).

    The same invoice row is reused — its invoice number and any payments stay
    attached — so money already received is preserved and there is no
    unique-key clash on (enrollment, term, year). The lines are rebuilt from
    the corrected structure and the invoice amounts/status are recalculated.
    """
    st = (student_type or "").upper()
    if st not in ("NEW", "RETURNING"):
        raise ValueError("student_type must be NEW or RETURNING")

    inv = db.execute(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not inv:
        raise ValueError("Invoice not found")
    if inv.invoice_type != "SCHOOL_FEES":
        raise ValueError("Only school-fees invoices can be replaced")
    if inv.status == "CANCELLED":
        raise ValueError("This invoice has already been cancelled")
    if inv.enrollment_id is None or inv.term_number is None or inv.academic_year is None:
        raise ValueError("Invoice is missing the enrollment/term context needed to replace it")

    # Regenerate the invoice in place from the chosen structure. The same row
    # is reused — its invoice number and any payments stay attached, so nothing
    # is lost and there is no unique-key clash on (enrollment, term, year).
    new_inv = generate_school_fees_invoice_v2(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        enrollment_id=inv.enrollment_id,
        term_number=inv.term_number,
        academic_year=inv.academic_year,
        include_carry_forward=include_carry_forward,
        force_student_type=st,
        existing_invoice=inv,
    )

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="invoice.replace",
        resource="invoice",
        resource_id=new_inv.id,
        payload={"invoice_id": str(new_inv.id), "student_type": st},
        meta=None,
    )
    return new_inv


# ── Bulk fees-invoice generation ────────────────────────────────────────────
#
# Term-start workhorse. One call enumerates every eligible enrollment for the
# tenant (optionally narrowed to a class), tries to generate a DRAFT v2 fees
# invoice for each, and returns a structured per-student outcome:
#
#   created — { enrollment_id, student_id, student_name, class_code,
#               invoice_id, invoice_no, total_amount, student_type,
#               student_type_resolved_by }
#   skipped — { enrollment_id, student_name, reason: 'already_invoiced',
#               existing_invoice_id }
#   failed  — { enrollment_id, student_name, reason: code, detail: message }
#
# Reasons for failure:
#   no_class           — enrollment has no recognisable class_code
#   no_student_record  — enrollment never reached the SIS table (rare)
#   no_structure       — no active fee structure matches class+year+student_type
#   no_chargeable_items — structure had no items priced for this term
#   error              — anything else; the failing enrollment is skipped,
#                        the batch continues
#
# Dry-run mode runs the same logic inside a savepoint and rolls back at the
# end — no DRAFTs persist, but the same outcome list is returned so the
# secretary can preview before committing.


_BULK_ELIGIBLE_STATUSES = ("ENROLLED", "ENROLLED_PARTIAL")


def _enrollment_display_name(payload: dict[str, Any] | None) -> str:
    if not isinstance(payload, dict):
        return "Unknown student"
    for key in ("student_name", "studentName", "full_name", "fullName", "name"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "Unknown student"


def bulk_generate_fees_invoices(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    term_number: int,
    academic_year: int,
    class_code: Optional[str] = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Generate DRAFT v2 fees invoices for every eligible enrollment in one
    go. Returns a structured outcome map — see module comment.

    Behaviour:
      • Only enrollments with status in ENROLLED / ENROLLED_PARTIAL are
        considered (transfers, drafts, withdrawn etc. are skipped silently).
      • Optional class_code filter (case-insensitive normalised).
      • Per-student failure NEVER aborts the batch — bad rows are recorded
        and the loop moves on.
      • dry_run=True: every generated invoice (and any bundled CF) is rolled
        back at the end via a savepoint, so the preview is consequence-free.
      • Audit: 'invoice.bulk_generate' with the summary counts. Per-student
        rows are NOT individually audited (the per-student v2 generator
        already audits each created invoice via 'invoice.create.v2').
    """
    if term_number not in (1, 2, 3):
        raise ValueError("term_number must be 1, 2, or 3")
    if academic_year < 2000 or academic_year > 2199:
        raise ValueError("academic_year must be between 2000 and 2199")

    class_filter_norm = _norm_upper(class_code) if class_code else None

    # Pull every eligible enrollment for this tenant. Loading payloads in one
    # pass keeps the per-row class_code resolution cheap.
    enrollments = db.execute(
        select(Enrollment).where(
            Enrollment.tenant_id == tenant_id,
            Enrollment.status.in_(_BULK_ELIGIBLE_STATUSES),
        )
    ).scalars().all()

    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    # Wrap the whole batch in a savepoint so dry_run can roll back atomically.
    # In commit mode (dry_run=False), per-row failures are rolled back
    # individually via inner savepoints; the outer one is released cleanly.
    outer_sp = db.begin_nested()
    try:
        for enr in enrollments:
            display_name = _enrollment_display_name(enr.payload)
            enr_class = _extract_enrollment_class_code(enr.payload)

            # Class filter — applied here so the outcome list only shows
            # what the caller actually asked for.
            if class_filter_norm and (enr_class or "") != class_filter_norm:
                continue

            row_failed: Optional[dict[str, Any]] = None
            row_skipped: Optional[dict[str, Any]] = None
            row_created: Optional[dict[str, Any]] = None

            # Inner savepoint: a single failing enrollment must not poison
            # the session for the rest of the batch.
            inner_sp = db.begin_nested()
            try:
                inv = generate_school_fees_invoice_v2(
                    db,
                    tenant_id=tenant_id,
                    actor_user_id=actor_user_id,
                    enrollment_id=enr.id,
                    term_number=term_number,
                    academic_year=academic_year,
                    include_carry_forward=True,
                )
                inner_sp.commit()
                meta = dict(inv.meta or {})
                row_created = {
                    "enrollment_id": str(enr.id),
                    "student_id": str(enr.student_id) if enr.student_id else None,
                    "student_name": display_name,
                    "class_code": enr_class,
                    "invoice_id": str(inv.id),
                    "invoice_no": inv.invoice_no,
                    "total_amount": str(inv.total_amount or 0),
                    "student_type": meta.get("student_type"),
                    "student_type_resolved_by": meta.get("student_type_resolved_by"),
                }
            except ValueError as e:
                inner_sp.rollback()
                msg = str(e)
                # Classify the common failure reasons so the UI can render
                # actionable chips per row instead of dumping raw text.
                if "already exists" in msg.lower():
                    # Pull the duplicate's id out of the existing v2 generator's
                    # message for the UI to link to.
                    existing_id: Optional[str] = None
                    existing_inv = db.execute(
                        select(Invoice).where(
                            Invoice.tenant_id == tenant_id,
                            Invoice.enrollment_id == enr.id,
                            Invoice.term_number == term_number,
                            Invoice.academic_year == academic_year,
                            Invoice.invoice_type == "SCHOOL_FEES",
                        )
                    ).scalar_one_or_none()
                    if existing_inv:
                        existing_id = str(existing_inv.id)
                    row_skipped = {
                        "enrollment_id": str(enr.id),
                        "student_name": display_name,
                        "class_code": enr_class,
                        "reason": "already_invoiced",
                        "detail": msg,
                        "existing_invoice_id": existing_id,
                    }
                elif "cannot determine class" in msg.lower():
                    row_failed = {
                        "enrollment_id": str(enr.id),
                        "student_name": display_name,
                        "class_code": enr_class,
                        "reason": "no_class",
                        "detail": msg,
                    }
                elif "no active fee structure" in msg.lower():
                    row_failed = {
                        "enrollment_id": str(enr.id),
                        "student_name": display_name,
                        "class_code": enr_class,
                        "reason": "no_structure",
                        "detail": msg,
                    }
                elif "no chargeable" in msg.lower() or "fee structure has no items" in msg.lower():
                    row_failed = {
                        "enrollment_id": str(enr.id),
                        "student_name": display_name,
                        "class_code": enr_class,
                        "reason": "no_chargeable_items",
                        "detail": msg,
                    }
                else:
                    row_failed = {
                        "enrollment_id": str(enr.id),
                        "student_name": display_name,
                        "class_code": enr_class,
                        "reason": "error",
                        "detail": msg,
                    }
            except Exception as e:  # pragma: no cover — defensive
                inner_sp.rollback()
                row_failed = {
                    "enrollment_id": str(enr.id),
                    "student_name": display_name,
                    "class_code": enr_class,
                    "reason": "error",
                    "detail": str(e),
                }

            if row_created is not None:
                created.append(row_created)
            elif row_skipped is not None:
                skipped.append(row_skipped)
            elif row_failed is not None:
                failed.append(row_failed)

        if dry_run:
            outer_sp.rollback()  # nothing persists
        else:
            outer_sp.commit()
    except Exception:
        # If the outer savepoint itself blew up (shouldn't happen — per-row
        # errors are caught above), make sure nothing leaks out partially
        # committed.
        try:
            outer_sp.rollback()
        except Exception:
            pass
        raise

    summary = {
        "total": len(created) + len(skipped) + len(failed),
        "created": len(created),
        "skipped": len(skipped),
        "failed": len(failed),
        "term_number": term_number,
        "academic_year": academic_year,
        "class_code": class_filter_norm,
        "dry_run": bool(dry_run),
    }

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="invoice.bulk_generate",
        resource="invoice",
        resource_id=None,
        payload=summary,
        meta=None,
    )

    return {"summary": summary, "created": created, "skipped": skipped, "failed": failed}


def _snapshot_draft_invoice_ids(
    db: Session,
    *,
    tenant_id: UUID,
    term_number: Optional[int] = None,
    academic_year: Optional[int] = None,
    limit: int = 5000,
) -> list[UUID]:
    """Return DRAFT invoice IDs for this tenant, deterministically ordered
    (created_at ASC). Used by the all_drafts mode of bulk_publish so the
    server captures the snapshot, not the client."""
    sql = (
        "SELECT id FROM core.invoices "
        "WHERE tenant_id = :tid AND status = 'DRAFT'"
    )
    params: dict[str, Any] = {"tid": str(tenant_id), "lim": int(limit)}
    if term_number is not None:
        sql += " AND term_number = :tn"
        params["tn"] = int(term_number)
    if academic_year is not None:
        sql += " AND academic_year = :yr"
        params["yr"] = int(academic_year)
    sql += " ORDER BY created_at ASC LIMIT :lim"
    rows = db.execute(sa_text(sql), params).all()
    return [r[0] for r in rows]


def bulk_publish_invoices(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    invoice_ids: list[UUID] | None = None,
    all_drafts: bool = False,
    term_number: Optional[int] = None,
    academic_year: Optional[int] = None,
    all_drafts_limit: int = 5000,
) -> dict[str, Any]:
    """Publish a batch of DRAFT invoices. Per-row outcome:

      published — { invoice_id, invoice_no, after_status }
      skipped   — { invoice_id, reason: 'not_draft'|'not_found', current_status }
      failed    — { invoice_id, reason: 'empty_invoice'|'error', detail }

    Per-row failures don't abort the batch — each publish runs in its own
    savepoint. Tenant-scoped: invoice ids belonging to other tenants are
    reported as 'not_found' so we don't leak existence.

    When `all_drafts=True`, the IDs are snapshotted server-side from every
    DRAFT in the tenant (optionally filtered by term_number + academic_year)
    up to all_drafts_limit, so the caller doesn't need to fetch the list
    first and there's no UI/server drift.
    """
    if all_drafts:
        invoice_ids = _snapshot_draft_invoice_ids(
            db,
            tenant_id=tenant_id,
            term_number=term_number,
            academic_year=academic_year,
            limit=all_drafts_limit,
        )

    if not invoice_ids:
        return {
            "summary": {"total": 0, "published": 0, "skipped": 0, "failed": 0},
            "published": [], "skipped": [], "failed": [],
        }

    published: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for inv_id in invoice_ids:
        sp = db.begin_nested()
        try:
            inv = db.execute(
                select(Invoice).where(
                    Invoice.id == inv_id,
                    Invoice.tenant_id == tenant_id,
                )
            ).scalar_one_or_none()
            if inv is None:
                sp.rollback()
                skipped.append({
                    "invoice_id": str(inv_id),
                    "reason": "not_found",
                    "current_status": None,
                })
                continue
            if inv.status != "DRAFT":
                sp.rollback()
                skipped.append({
                    "invoice_id": str(inv_id),
                    "invoice_no": inv.invoice_no,
                    "reason": "not_draft",
                    "current_status": inv.status,
                })
                continue
            published_inv = publish_invoice(
                db,
                tenant_id=tenant_id,
                actor_user_id=actor_user_id,
                invoice_id=inv_id,
            )
            sp.commit()
            published.append({
                "invoice_id": str(inv_id),
                "invoice_no": published_inv.invoice_no,
                "after_status": published_inv.status,
            })
        except ValueError as e:
            sp.rollback()
            msg = str(e)
            reason = "empty_invoice" if "empty" in msg.lower() else "error"
            failed.append({
                "invoice_id": str(inv_id),
                "reason": reason,
                "detail": msg,
            })
        except Exception as e:  # pragma: no cover — defensive
            sp.rollback()
            failed.append({
                "invoice_id": str(inv_id),
                "reason": "error",
                "detail": str(e),
            })

    summary = {
        "total": len(invoice_ids),
        "published": len(published),
        "skipped": len(skipped),
        "failed": len(failed),
    }
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="invoice.bulk_publish",
        resource="invoice",
        resource_id=None,
        payload=summary,
        meta=None,
    )
    return {"summary": summary, "published": published, "skipped": skipped, "failed": failed}


def delete_invoice_cascade(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    invoice_id: UUID,
) -> dict:
    """Hard-delete an invoice and everything tied to it — its lines, the payment
    allocations against it, and any payment (receipt) that existed solely for
    it. Director-only cleanup for onboarding mistakes.

    A payment shared with other invoices is not deleted: this invoice's
    allocation is removed and the other invoices are recalculated, so no other
    student's record is disturbed.
    """
    inv = db.execute(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not inv:
        raise ValueError("Invoice not found")

    invoice_no = inv.invoice_no

    # Allocations against this invoice → the payments that touched it.
    allocs = db.execute(
        select(PaymentAllocation).where(PaymentAllocation.invoice_id == invoice_id)
    ).scalars().all()
    payment_ids = {a.payment_id for a in allocs}

    # Drop this invoice's allocations first.
    for a in allocs:
        db.delete(a)
    db.flush()

    deleted_payments = 0
    affected_other_invoices: set[UUID] = set()
    for pid in payment_ids:
        remaining = db.execute(
            select(PaymentAllocation).where(PaymentAllocation.payment_id == pid)
        ).scalars().all()
        if not remaining:
            # Payment existed only for this invoice — delete it and its receipt.
            pay = db.get(Payment, pid)
            if pay is not None and pay.tenant_id == tenant_id:
                db.delete(pay)
                deleted_payments += 1
        else:
            affected_other_invoices.update(r.invoice_id for r in remaining)
    db.flush()

    # Remove this invoice's lines, then the invoice itself.
    db.execute(
        InvoiceLine.__table__.delete().where(InvoiceLine.invoice_id == invoice_id)
    )
    db.flush()

    # Drop scholarship allocations recorded against this invoice. The FK is
    # ON DELETE SET NULL, so without this the rows would survive (orphaned) and
    # keep counting toward the scholarship's pool/recipient limit — wrongly
    # showing the slot as still consumed after the invoice is gone.
    scholarship_allocs_removed = db.execute(
        ScholarshipAllocation.__table__.delete().where(
            ScholarshipAllocation.tenant_id == tenant_id,
            ScholarshipAllocation.invoice_id == invoice_id,
        )
    ).rowcount
    db.flush()

    # Release any carry-forward balances this invoice had absorbed.
    from app.models.student_carry_forward import StudentCarryForward
    db.execute(
        StudentCarryForward.__table__.update()
        .where(
            StudentCarryForward.tenant_id == tenant_id,
            StudentCarryForward.invoice_id == invoice_id,
        )
        .values(status="OPEN", invoice_id=None)
    )

    db.delete(inv)
    db.flush()

    # Recalc invoices that shared a now-partially-unallocated payment.
    for other_id in affected_other_invoices:
        if other_id == invoice_id:
            continue
        other = db.get(Invoice, other_id)
        if other is not None and other.status != "CANCELLED":
            _recalc_invoice_amounts(db, other)
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="invoice.delete",
        resource="invoice",
        resource_id=invoice_id,
        payload={
            "invoice_no": invoice_no,
            "deleted_payments": deleted_payments,
            "allocations_removed": len(allocs),
            "scholarship_allocations_removed": scholarship_allocs_removed,
        },
        meta=None,
    )
    return {
        "deleted_payments": deleted_payments,
        "allocations_removed": len(allocs),
        "scholarship_allocations_removed": scholarship_allocs_removed,
    }


# ── Carry-Forward / Balance Adjustments ───────────────────────────────────────

# Category → kind. DEBIT increases the student's next invoice; CREDIT reduces
# it. The kind is enforced against the sign of `amount` so the UI cannot record
# a 'GOODWILL_CREDIT' as a positive number (which would charge the student).
_CATEGORY_KINDS: dict[str, str] = {
    "MANUAL_DEBIT": "DEBIT",
    "OVERPAYMENT_CREDIT": "CREDIT",
    "GOODWILL_CREDIT": "CREDIT",
    "OVERBILL_CORRECTION": "CREDIT",
}


def _serialize_carry_forward(row: Any) -> dict:
    category = str(row.category or "MANUAL_DEBIT")
    return {
        "id": str(row.id),
        "student_id": str(row.student_id),
        "term_label": str(row.term_label or ""),
        "academic_year": row.academic_year,
        "term_number": row.term_number,
        "amount": str(row.amount or "0"),
        "description": str(row.description or ""),
        "category": category,
        "kind": _CATEGORY_KINDS.get(category, "DEBIT"),
        "status": str(row.status or "OPEN"),
        "invoice_id": str(row.invoice_id) if row.invoice_id else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def list_carry_forward(
    db: Session,
    *,
    tenant_id: UUID,
    student_id: UUID,
) -> list[dict]:
    from app.models.student_carry_forward import StudentCarryForward
    rows = db.execute(
        select(StudentCarryForward)
        .where(
            StudentCarryForward.tenant_id == tenant_id,
            StudentCarryForward.student_id == student_id,
        )
        .order_by(
            StudentCarryForward.academic_year.desc(),
            StudentCarryForward.term_number.desc(),
            StudentCarryForward.created_at.desc(),
        )
    ).scalars().all()
    return [_serialize_carry_forward(r) for r in rows]


def get_carry_forward_summary(
    db: Session,
    *,
    tenant_id: UUID,
    student_id: UUID,
) -> dict:
    """Return OPEN balance adjustments for a student, signed: positive amounts
    are debits the student owes, negative are credits owed to the student.
    `pending_total` is the NET (debits − credits) that will be rolled into the
    next generated invoice."""
    from app.models.student_carry_forward import StudentCarryForward
    rows = db.execute(
        select(StudentCarryForward)
        .where(
            StudentCarryForward.tenant_id == tenant_id,
            StudentCarryForward.student_id == student_id,
            StudentCarryForward.status == "OPEN",
        )
    ).scalars().all()
    debit_total = sum(
        (Decimal(str(r.amount)) for r in rows if Decimal(str(r.amount)) > 0),
        Decimal("0"),
    )
    credit_total = sum(
        (Decimal(str(r.amount)) for r in rows if Decimal(str(r.amount)) < 0),
        Decimal("0"),
    )
    net_total = debit_total + credit_total  # credit_total is already negative
    return {
        "pending_count": len(rows),
        "pending_total": str(net_total),
        "debit_total": str(debit_total),
        "credit_total": str(credit_total),
        "items": [_serialize_carry_forward(r) for r in rows],
    }


def add_carry_forward(
    db: Session,
    *,
    tenant_id: UUID,
    student_id: UUID,
    actor_user_id: Optional[UUID],
    term_label: str,
    academic_year: Optional[int],
    term_number: Optional[int],
    amount: Decimal,
    description: Optional[str],
    category: str = "MANUAL_DEBIT",
) -> dict:
    from app.models.student_carry_forward import StudentCarryForward
    from app.models.student import Student

    student = db.execute(
        select(Student).where(Student.id == student_id, Student.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not student:
        raise ValueError("Student not found")
    if Decimal(amount or 0) == 0:
        raise ValueError("Amount must be non-zero (positive for debit, negative for credit)")
    if category not in _CATEGORY_KINDS:
        raise ValueError(f"Invalid category. Must be one of: {', '.join(_CATEGORY_KINDS)}")
    # Sign must match category — guards against UI mistakes (e.g. recording a
    # 'GOODWILL_CREDIT' with a positive amount, which would actually charge the
    # student more, not credit them).
    if _CATEGORY_KINDS[category] == "DEBIT" and amount < 0:
        raise ValueError(f"Category {category} requires a positive (debit) amount")
    if _CATEGORY_KINDS[category] == "CREDIT" and amount > 0:
        raise ValueError(f"Category {category} requires a negative (credit) amount")

    row = StudentCarryForward(
        tenant_id=tenant_id,
        student_id=student_id,
        term_label=term_label.strip(),
        academic_year=academic_year,
        term_number=term_number,
        amount=amount,
        description=description.strip() if description else None,
        category=category,
        status="OPEN",
        recorded_by=actor_user_id,
    )
    db.add(row)
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="finance.balance.create",
        resource="student_carry_forward",
        resource_id=row.id,
        payload={
            "student_id": str(student_id),
            "kind": _CATEGORY_KINDS[category],
            "category": category,
            "amount": str(amount),
            "term_label": row.term_label,
            "academic_year": academic_year,
            "term_number": term_number,
            "description": row.description,
        },
        meta=None,
    )
    return _serialize_carry_forward(row)


def edit_carry_forward(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    balance_id: UUID,
    amount: Optional[Decimal],
    term_label: Optional[str],
    description: Optional[str],
    category: Optional[str] = None,
) -> dict:
    from app.models.student_carry_forward import StudentCarryForward
    row = db.execute(
        select(StudentCarryForward).where(
            StudentCarryForward.id == balance_id,
            StudentCarryForward.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not row:
        raise ValueError("Balance record not found")
    if row.status != "OPEN":
        raise ValueError("Only OPEN balances can be edited (already bundled into an invoice)")

    before = {
        "amount": str(row.amount),
        "term_label": row.term_label,
        "description": row.description,
        "category": row.category,
    }

    new_category = category if category is not None else row.category
    new_amount = amount if amount is not None else Decimal(str(row.amount))

    if Decimal(new_amount or 0) == 0:
        raise ValueError("Amount must be non-zero (positive for debit, negative for credit)")
    if new_category not in _CATEGORY_KINDS:
        raise ValueError(f"Invalid category. Must be one of: {', '.join(_CATEGORY_KINDS)}")
    if _CATEGORY_KINDS[new_category] == "DEBIT" and new_amount < 0:
        raise ValueError(f"Category {new_category} requires a positive (debit) amount")
    if _CATEGORY_KINDS[new_category] == "CREDIT" and new_amount > 0:
        raise ValueError(f"Category {new_category} requires a negative (credit) amount")

    if amount is not None:
        row.amount = amount
    if term_label is not None:
        row.term_label = term_label.strip()
    if description is not None:
        row.description = description.strip() if description.strip() else None
    if category is not None:
        row.category = category
    db.flush()

    after = {
        "amount": str(row.amount),
        "term_label": row.term_label,
        "description": row.description,
        "category": row.category,
    }
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="finance.balance.update",
        resource="student_carry_forward",
        resource_id=row.id,
        payload={
            "student_id": str(row.student_id),
            "before": before,
            "after": after,
        },
        meta=None,
    )
    return _serialize_carry_forward(row)


def delete_carry_forward(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    balance_id: UUID,
) -> None:
    from app.models.student_carry_forward import StudentCarryForward
    row = db.execute(
        select(StudentCarryForward).where(
            StudentCarryForward.id == balance_id,
            StudentCarryForward.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not row:
        raise ValueError("Balance record not found")
    if row.status != "OPEN":
        raise ValueError("Only OPEN balances can be deleted (already bundled into an invoice)")

    snapshot = {
        "student_id": str(row.student_id),
        "amount": str(row.amount),
        "category": row.category,
        "term_label": row.term_label,
        "academic_year": row.academic_year,
        "term_number": row.term_number,
        "description": row.description,
    }
    db.delete(row)
    db.flush()
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="finance.balance.delete",
        resource="student_carry_forward",
        resource_id=balance_id,
        payload=snapshot,
        meta=None,
    )
