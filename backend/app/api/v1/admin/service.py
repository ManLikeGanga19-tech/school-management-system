# app/api/v1/admin/service.py

from __future__ import annotations

from datetime import datetime, date, timedelta
import logging
import re
from typing import Optional, Any
from uuid import UUID, uuid4
import secrets

from sqlalchemy.orm import Session
from sqlalchemy import select, func, or_, and_, text

from app.models.tenant import Tenant
from app.models.user import User
from app.models.membership import UserTenant
from app.models.rbac import Role, UserRole, Permission, UserPermissionOverride
from app.models.audit_log import AuditLog
from app.models.subscription import Subscription, SubscriptionPayment
from app.models.payment import Payment
from app.models.enrollment import Enrollment
from app.models.invoice import Invoice
from app.models.tenant_print_profile import TenantPrintProfile

# If your project has hashing util (it does, used in tenants/routes.py)
from app.utils.hashing import hash_password

logger = logging.getLogger(__name__)
TENANT_SLUG_PATTERN = re.compile(r"^[a-z0-9-]+$")


# ─── Subscription billing model ──────────────────────────────────────────────

ALLOWED_BILLING_PLANS = {"per_term", "per_year"}
ALLOWED_SUB_STATUSES = {"active", "trialing", "past_due", "cancelled", "paused"}
SAAS_BILLING_ELIGIBILITY_SOURCES = {"saas_academic_calendar", "fallback"}


def _clean_optional_text(value: Any, *, max_len: int) -> str | None:
    if value is None:
        return None
    out = str(value).strip()
    if not out:
        return None
    return out[:max_len]


def _clean_email(value: Any) -> str | None:
    cleaned = _clean_optional_text(value, max_len=255)
    return cleaned.lower() if cleaned else None


def _clean_domain(value: Any) -> str | None:
    cleaned = _clean_optional_text(value, max_len=255)
    return cleaned.lower() if cleaned else None


def _clean_name(value: Any) -> str | None:
    return _clean_optional_text(value, max_len=160)


def _clean_password(value: Any) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _normalize_slug(value: Any) -> str:
    slug = str(value or "").strip().lower()
    if not slug:
        raise ValueError("slug is required")
    if not TENANT_SLUG_PATTERN.fullmatch(slug):
        raise ValueError("slug must be lowercase letters, numbers, and hyphens only")
    return slug


def _get_global_role(db: Session, code: str) -> Role:
    role = db.execute(
        select(Role).where(Role.code == code, Role.tenant_id.is_(None))
    ).scalar_one_or_none()
    if role is None:
        raise RuntimeError(f"System role {code} not seeded")
    return role


def _get_tenant_director_user(db: Session, tenant_id: UUID) -> User | None:
    director_role = db.execute(
        select(Role).where(Role.code == "DIRECTOR", Role.tenant_id.is_(None))
    ).scalar_one_or_none()
    if director_role is None:
        return None
    return (
        db.execute(
            select(User)
            .join(UserRole, UserRole.user_id == User.id)
            .where(
                UserRole.tenant_id == tenant_id,
                UserRole.role_id == director_role.id,
            )
            .order_by(User.created_at.asc())
            .limit(1)
        )
        .scalars()
        .first()
    )


def _build_tenant_row(
    db: Session,
    tenant: Tenant,
    *,
    plan_hint: str | None = None,
) -> dict:
    user_count = db.scalar(
        select(func.count()).select_from(UserTenant).where(UserTenant.tenant_id == tenant.id)
    )

    active_sub = None
    if plan_hint is None:
        active_sub = db.execute(
            select(Subscription)
            .where(Subscription.tenant_id == tenant.id, Subscription.status == "active")
            .order_by(Subscription.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()

    admin_user = _get_tenant_director_user(db, tenant.id)

    return {
        "id": tenant.id,
        "slug": tenant.slug,
        "name": tenant.name,
        "primary_domain": tenant.primary_domain,
        "is_active": bool(tenant.is_active),
        "plan": _subscription_billing_plan(active_sub)
        if active_sub
        else plan_hint,
        "user_count": int(user_count) if user_count is not None else None,
        "admin_user_id": getattr(admin_user, "id", None),
        "admin_email": getattr(admin_user, "email", None),
        "admin_full_name": getattr(admin_user, "full_name", None),
        "created_at": tenant.created_at,
        "updated_at": getattr(tenant, "updated_at", None),
    }


def _ensure_tenant_admin_access(
    db: Session,
    *,
    tenant: Tenant,
    admin_email: Any = None,
    admin_full_name: Any = None,
    admin_password: Any = None,
) -> User | None:
    normalized_email = _clean_email(admin_email)
    normalized_name = _clean_name(admin_full_name)
    normalized_password = _clean_password(admin_password)

    if normalized_email is None and (normalized_name is not None or normalized_password is not None):
        raise ValueError("admin_email is required before setting tenant admin credentials")

    director_role = _get_global_role(db, "DIRECTOR")
    current_director = _get_tenant_director_user(db, tenant.id)
    target_user = current_director

    if normalized_email:
        target_user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
        if target_user is None:
            if not normalized_password:
                raise ValueError("admin_password is required when provisioning a new tenant admin")
            target_user = User(
                id=uuid4(),
                email=normalized_email,
                password_hash=hash_password(normalized_password),
                full_name=normalized_name,
                is_active=True,
            )
            db.add(target_user)
            db.flush()
        else:
            target_user.is_active = True
            if normalized_password:
                target_user.password_hash = hash_password(normalized_password)
            if normalized_name is not None:
                target_user.full_name = normalized_name
    elif current_director is not None:
        target_user = current_director
        target_user.is_active = True
        if normalized_password:
            target_user.password_hash = hash_password(normalized_password)
        if normalized_name is not None:
            target_user.full_name = normalized_name
    else:
        return None

    membership = db.execute(
        select(UserTenant).where(
            UserTenant.tenant_id == tenant.id,
            UserTenant.user_id == target_user.id,
        )
    ).scalar_one_or_none()
    if membership is None:
        db.add(
            UserTenant(
                id=uuid4(),
                tenant_id=tenant.id,
                user_id=target_user.id,
                is_active=True,
            )
        )
    elif not membership.is_active:
        membership.is_active = True

    assignment = db.execute(
        select(UserRole).where(
            UserRole.tenant_id == tenant.id,
            UserRole.user_id == target_user.id,
            UserRole.role_id == director_role.id,
        )
    ).scalar_one_or_none()
    if assignment is None:
        db.add(
            UserRole(
                id=uuid4(),
                tenant_id=tenant.id,
                user_id=target_user.id,
                role_id=director_role.id,
            )
        )

    if current_director is not None and current_director.id != target_user.id:
        old_assignments = db.execute(
            select(UserRole).where(
                UserRole.tenant_id == tenant.id,
                UserRole.user_id == current_director.id,
                UserRole.role_id == director_role.id,
            )
        ).scalars().all()
        for old_assignment in old_assignments:
            db.delete(old_assignment)

    return target_user


def _normalize_billing_plan(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw == "full_year":
        raw = "per_year"
    if raw not in ALLOWED_BILLING_PLANS:
        raise ValueError("Invalid billing_plan: use per_term or per_year")
    return raw


def _plan_to_cycle(plan: str) -> str:
    normalized = _normalize_billing_plan(plan)
    return "full_year" if normalized == "per_year" else "per_term"


def _cycle_to_plan(cycle: str | None) -> str:
    raw = str(cycle or "").strip().lower()
    if raw == "full_year":
        return "per_year"
    if raw == "per_term":
        return "per_term"
    return "per_term"


def _subscription_billing_plan(sub: Subscription) -> str:
    plan_raw = str(getattr(sub, "plan", "") or "").strip().lower()
    if plan_raw in ALLOWED_BILLING_PLANS:
        return plan_raw
    return _cycle_to_plan(getattr(sub, "billing_cycle", None))


def _service_today() -> date:
    return date.today()


def _fallback_term_label(when: date) -> str:
    if when.month <= 4:
        term_no = 1
    elif when.month <= 8:
        term_no = 2
    else:
        term_no = 3
    return f"Term {term_no} {when.year}"


def _active_saas_term_covering_date(db: Session, *, when: date) -> dict[str, Any] | None:
    _ensure_saas_academic_calendar_table(db)
    row = db.execute(
        text(
            """
            SELECT academic_year, term_no, term_code, term_name, start_date, end_date
            FROM core.saas_academic_calendar_terms
            WHERE COALESCE(is_active, true) = true
              AND start_date <= :when
              AND end_date >= :when
            ORDER BY academic_year DESC, term_no ASC
            LIMIT 1
            """
        ),
        {"when": when},
    ).mappings().first()
    return dict(row) if row else None


def _next_or_current_saas_term(db: Session, *, when: date) -> dict[str, Any] | None:
    _ensure_saas_academic_calendar_table(db)
    row = db.execute(
        text(
            """
            SELECT academic_year, term_no, term_code, term_name, start_date, end_date
            FROM core.saas_academic_calendar_terms
            WHERE COALESCE(is_active, true) = true
              AND end_date >= :when
            ORDER BY academic_year ASC, start_date ASC, term_no ASC
            LIMIT 1
            """
        ),
        {"when": when},
    ).mappings().first()
    return dict(row) if row else None


def get_subscription_billing_eligibility(
    db: Session,
    *,
    billing_plan: str,
    as_of: date | None = None,
) -> dict[str, Any]:
    normalized_plan = _normalize_billing_plan(billing_plan)
    effective_date = as_of or _service_today()

    if normalized_plan == "per_year":
        current_or_next = _next_or_current_saas_term(db, when=effective_date)
        academic_year = int(current_or_next["academic_year"]) if current_or_next else effective_date.year
        return {
            "billing_plan": normalized_plan,
            "source": "saas_academic_calendar" if current_or_next else "fallback",
            "as_of": effective_date,
            "academic_year": academic_year,
            "label": f"Academic Year {academic_year}",
            "eligible_from_date": effective_date,
            "eligible_until_date": effective_date + timedelta(days=365),
            "term_no": None,
            "term_code": None,
            "term_name": None,
        }

    term = _next_or_current_saas_term(db, when=effective_date)
    if term:
        start_date = term["start_date"]
        end_date = term["end_date"]
        eligible_from = max(effective_date, start_date)
        return {
            "billing_plan": normalized_plan,
            "source": "saas_academic_calendar",
            "as_of": effective_date,
            "academic_year": int(term["academic_year"]),
            "label": str(term["term_name"]),
            "eligible_from_date": eligible_from,
            "eligible_until_date": end_date,
            "term_no": int(term["term_no"]),
            "term_code": str(term["term_code"]),
            "term_name": str(term["term_name"]),
        }

    return {
        "billing_plan": normalized_plan,
        "source": "fallback",
        "as_of": effective_date,
        "academic_year": effective_date.year,
        "label": _fallback_term_label(effective_date),
        "eligible_from_date": effective_date,
        "eligible_until_date": effective_date + timedelta(days=90),
        "term_no": None,
        "term_code": None,
        "term_name": None,
    }


def _period_end_for_plan(period_start: date, billing_plan: str) -> date:
    normalized = _normalize_billing_plan(billing_plan)
    if normalized == "per_year":
        return period_start + timedelta(days=365)
    return period_start + timedelta(days=90)


def _subscription_row(db: Session, sub: Subscription, tenant: Tenant | None) -> dict:
    billing_plan = _subscription_billing_plan(sub)
    billing_cycle = _plan_to_cycle(billing_plan)
    billing_term_label: str | None = None
    billing_term_code: str | None = None
    billing_academic_year: int | None = None

    if billing_plan == "per_term":
        anchor_date = getattr(sub, "period_start", None) or getattr(sub, "period_end", None) or _service_today()
        term = _active_saas_term_covering_date(db, when=anchor_date) if isinstance(anchor_date, date) else None
        if term:
            billing_term_label = str(term["term_name"])
            billing_term_code = str(term["term_code"])
            billing_academic_year = int(term["academic_year"])
        else:
            eligibility = get_subscription_billing_eligibility(
                db,
                billing_plan=billing_plan,
                as_of=anchor_date if isinstance(anchor_date, date) else None,
            )
            billing_term_label = str(eligibility["label"])
            billing_term_code = eligibility.get("term_code")
            billing_academic_year = int(eligibility["academic_year"])

    return {
        "id": sub.id,
        "tenant_id": sub.tenant_id,
        "tenant_name": tenant.name if tenant else "",
        "tenant_slug": tenant.slug if tenant else "",
        "billing_plan": billing_plan,
        # Backward-compatible mirrors for existing clients.
        "plan": billing_plan,
        "billing_cycle": billing_cycle,
        "status": sub.status,
        "amount_kes": float(sub.amount_kes),
        "discount_percent": float(sub.discount_percent) if sub.discount_percent is not None else None,
        "period_start": sub.period_start,
        "period_end": sub.period_end,
        "next_payment_date": sub.period_end,
        "next_payment_amount": float(sub.amount_kes),
        "billing_term_label": billing_term_label,
        "billing_term_code": billing_term_code,
        "billing_academic_year": billing_academic_year,
        "created_at": sub.created_at,
        "notes": sub.notes,
    }


def _send_invitation_email(email: str, tenant: Tenant) -> None:
    """
    Reuse existing invitation utility in your codebase.
    Update the import path below to match your project if needed.
    """
    try:
        # Example common patterns — adjust to your actual utility path/name.
        from app.utils.invitation_email import send_invitation_email  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "Invitation email utility not found. Expected app.utils.invitation_email.send_invitation_email"
        ) from exc

    # Minimal payload; adjust args to match your utility signature
    send_invitation_email(email=email, tenant_name=tenant.name, tenant_slug=tenant.slug)


def _try_send_invitation_email(email: str, tenant: Tenant) -> None:
    """
    Invitation delivery is best-effort.

    Tenant provisioning must succeed even when email infrastructure is absent or
    temporarily degraded, otherwise local/staging environments become brittle
    and admin onboarding fails with an opaque 500.
    """
    try:
        _send_invitation_email(email=email, tenant=tenant)
    except Exception:
        logger.exception(
            "Tenant admin invitation delivery failed",
            extra={"tenant_slug": tenant.slug, "tenant_id": str(tenant.id), "email": email},
        )


def _resolve_payment_amount_column() -> Any | None:
    """
    Payment model field name differs across projects.
    Resolve the first known money column that exists on the ORM model.

    Returns a SQLAlchemy InstrumentedAttribute or None.
    """
    for cand in ("amount_kes", "amount", "amount_paid", "amount_received", "amount_total", "total_amount"):
        if hasattr(Payment, cand):
            return getattr(Payment, cand)
    return None


def _resolve_payment_completed_filter(stmt):
    """
    Apply a "completed payment" filter if the Payment model has status/state fields.
    If none exist, return stmt unchanged (best-effort).
    """
    # Common patterns: status="completed", state="completed", payment_status="completed"
    for field in ("status", "state", "payment_status"):
        if hasattr(Payment, field):
            col = getattr(Payment, field)
            return stmt.where(col == "completed")
    return stmt


# ─── SaaS Summary ────────────────────────────────────────────────────────────

def get_saas_summary(db: Session) -> dict:
    total = db.scalar(select(func.count()).select_from(Tenant)) or 0
    active = db.scalar(
        select(func.count()).select_from(Tenant).where(Tenant.is_active == True)
    ) or 0
    inactive = int(total) - int(active)
    return {
        "total_tenants": int(total),
        "active_tenants": int(active),
        "inactive_tenants": int(inactive),
    }


# ─── Tenant Dashboard ─────────────────────────────────────────────────────────

def get_tenant_dashboard(db: Session, tenant_id: UUID) -> dict:
    total_users = db.scalar(
        select(func.count()).select_from(UserTenant).where(UserTenant.tenant_id == tenant_id)
    ) or 0

    total_roles = db.scalar(
        select(func.count()).select_from(UserRole).where(UserRole.tenant_id == tenant_id)
    ) or 0

    total_audit = db.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.tenant_id == tenant_id)
    ) or 0

    return {
        "total_users": int(total_users),
        "total_roles": int(total_roles),
        "total_audit_logs": int(total_audit),
    }


# ─── Update Tenant ────────────────────────────────────────────────────────────

def update_tenant(db: Session, tenant_id: UUID, data: dict):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        return None

    if "name" in data:
        name = _clean_name(data.get("name"))
        if name is None:
            raise ValueError("name is required")
        tenant.name = name

    if "slug" in data:
        slug = _normalize_slug(data.get("slug"))
        existing_slug = db.execute(
            select(Tenant).where(Tenant.slug == slug, Tenant.id != tenant.id)
        ).scalar_one_or_none()
        if existing_slug is not None:
            raise ValueError("Slug already exists")
        tenant.slug = slug

    if "primary_domain" in data:
        domain = _clean_domain(data.get("primary_domain"))
        if domain:
            existing_domain = db.execute(
                select(Tenant).where(Tenant.primary_domain == domain, Tenant.id != tenant.id)
            ).scalar_one_or_none()
            if existing_domain is not None:
                raise ValueError("Primary domain already exists")
        tenant.primary_domain = domain

    if "is_active" in data and data.get("is_active") is not None:
        tenant.is_active = bool(data.get("is_active"))

    if any(key in data for key in ("admin_email", "admin_full_name", "admin_password")):
        _ensure_tenant_admin_access(
            db,
            tenant=tenant,
            admin_email=data.get("admin_email"),
            admin_full_name=data.get("admin_full_name"),
            admin_password=data.get("admin_password"),
        )

    db.commit()
    db.refresh(tenant)
    return _build_tenant_row(db, tenant)


# ─── List Users (tenant scoped) ───────────────────────────────────────────────

def list_users(db: Session, tenant_id: UUID):
    return db.execute(
        select(User)
        .join(UserTenant, UserTenant.user_id == User.id)
        .where(UserTenant.tenant_id == tenant_id)
    ).scalars().all()


# ─── Assign Role ─────────────────────────────────────────────────────────────

def assign_role(db: Session, tenant_id: UUID, user_id: UUID, role_code: str) -> None:
    role = db.execute(
        select(Role).where(Role.code == role_code, Role.tenant_id.is_(None))
    ).scalar_one_or_none()

    if not role:
        raise ValueError(f"Role '{role_code}' not found")

    exists = db.execute(
        select(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role_id == role.id,
            UserRole.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()

    if not exists:
        db.add(UserRole(id=uuid4(), tenant_id=tenant_id, user_id=user_id, role_id=role.id))
        db.commit()


# ─── Permission Override ──────────────────────────────────────────────────────

def set_permission_override(
    db: Session,
    tenant_id: UUID,
    user_id: UUID,
    permission_code: str,
    effect: str,
) -> None:
    perm = db.execute(select(Permission).where(Permission.code == permission_code)).scalar_one_or_none()
    if not perm:
        raise ValueError(f"Permission '{permission_code}' not found")

    override = db.execute(
        select(UserPermissionOverride).where(
            UserPermissionOverride.user_id == user_id,
            UserPermissionOverride.permission_id == perm.id,
            UserPermissionOverride.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()

    if override:
        override.effect = effect
    else:
        db.add(
            UserPermissionOverride(
                id=uuid4(),
                tenant_id=tenant_id,
                user_id=user_id,
                permission_id=perm.id,
                effect=effect,
            )
        )

    db.commit()


# ─── Tenant list with metadata ────────────────────────────────────────────────

def list_tenants_with_metadata(
    db: Session,
    q: Optional[str] = None,
    is_active: Optional[bool] = None,
) -> list[dict]:
    stmt = select(Tenant)

    if q:
        ql = q.strip()
        stmt = stmt.where(
            or_(
                Tenant.slug.ilike(f"%{ql}%"),
                Tenant.name.ilike(f"%{ql}%"),
                Tenant.primary_domain.ilike(f"%{ql}%"),
            )
        )

    if is_active is not None:
        stmt = stmt.where(Tenant.is_active == is_active)

    tenants = db.execute(stmt.order_by(Tenant.created_at.desc())).scalars().all()

    # NOTE: For now we keep per-tenant aggregates (limit is usually small in UI).
    # If you expect thousands of tenants, we can convert to subqueries in one SQL call.
    result: list[dict] = []
    for t in tenants:
        result.append(_build_tenant_row(db, t))

    return result


def get_or_create_tenant_print_profile(db: Session, *, tenant_id: UUID) -> TenantPrintProfile:
    row = db.execute(
        select(TenantPrintProfile).where(TenantPrintProfile.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if row:
        return row

    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise ValueError("Tenant not found")

    row = TenantPrintProfile(
        tenant_id=tenant_id,
        school_header=(tenant.name or "").strip() or None,
        receipt_footer="Thank you for partnering with us.",
        paper_size="A4",
        currency="KES",
        thermal_width_mm=80,
        qr_enabled=True,
    )
    db.add(row)
    db.flush()
    return row


def upsert_tenant_print_profile(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID | None,
    data: dict[str, Any],
) -> TenantPrintProfile:
    row = get_or_create_tenant_print_profile(db, tenant_id=tenant_id)

    paper_size = str(data.get("paper_size") or row.paper_size or "A4").upper().strip()
    if paper_size not in {"A4", "THERMAL_80MM"}:
        raise ValueError("paper_size must be A4 or THERMAL_80MM")

    try:
        thermal_width = int(data.get("thermal_width_mm", row.thermal_width_mm or 80))
    except Exception:
        raise ValueError("thermal_width_mm must be an integer")
    if thermal_width < 58 or thermal_width > 120:
        raise ValueError("thermal_width_mm must be between 58 and 120")

    currency = str(data.get("currency") or row.currency or "KES").upper().strip()
    if not currency:
        raise ValueError("currency is required")
    if len(currency) > 10:
        raise ValueError("currency must be at most 10 characters")

    row.logo_url = _clean_optional_text(data.get("logo_url"), max_len=500)
    row.school_header = _clean_optional_text(data.get("school_header"), max_len=500)
    row.receipt_footer = _clean_optional_text(data.get("receipt_footer"), max_len=500)
    row.paper_size = paper_size
    row.currency = currency
    row.thermal_width_mm = thermal_width
    row.qr_enabled = bool(data.get("qr_enabled", row.qr_enabled))
    row.po_box = _clean_optional_text(data.get("po_box"), max_len=100)
    row.physical_address = _clean_optional_text(data.get("physical_address"), max_len=2000)
    row.phone = _clean_optional_text(data.get("phone"), max_len=50)
    row.email = _clean_optional_text(data.get("email"), max_len=255)
    row.school_motto = _clean_optional_text(data.get("school_motto"), max_len=500)
    row.authorized_signatory_name = _clean_optional_text(data.get("authorized_signatory_name"), max_len=200)
    row.authorized_signatory_title = _clean_optional_text(data.get("authorized_signatory_title"), max_len=200)
    row.updated_by = actor_user_id
    db.flush()
    return row


# ─── Create Tenant (with optional plan + optional admin invite) ───────────────

def create_tenant_with_optional_admin(
    db: Session,
    *,
    name: str,
    slug: str,
    primary_domain: Optional[str] = None,
    plan: Optional[str] = None,
    admin_email: Optional[str] = None,
    admin_full_name: Optional[str] = None,
    admin_password: Optional[str] = None,
) -> dict:
    slug = _normalize_slug(slug)
    name = _clean_name(name)
    if name is None:
        raise ValueError("name is required")
    primary_domain = _clean_domain(primary_domain)

    existing = db.execute(select(Tenant).where(Tenant.slug == slug)).scalar_one_or_none()
    if existing:
        raise ValueError("Slug already exists")
    if primary_domain:
        existing_domain = db.execute(
            select(Tenant).where(Tenant.primary_domain == primary_domain)
        ).scalar_one_or_none()
        if existing_domain is not None:
            raise ValueError("Primary domain already exists")

    tenant = Tenant(name=name, slug=slug, primary_domain=primary_domain, is_active=True)
    db.add(tenant)
    db.flush()  # materialise tenant.id

    # Optional initial subscription stub (trialing). Amount is manual and can be
    # updated later from the subscriptions module.
    if plan:
        try:
            billing_plan = _normalize_billing_plan(plan)
        except ValueError:
            # Backward-compatible guard for legacy onboarding forms.
            billing_plan = "per_term"
        today = _service_today()
        billing_cycle = _plan_to_cycle(billing_plan)
        if billing_plan == "per_term":
            eligibility = get_subscription_billing_eligibility(
                db,
                billing_plan=billing_plan,
                as_of=today,
            )
            start = eligibility["eligible_from_date"]
            end = eligibility["eligible_until_date"]
        else:
            start = today
            end = _period_end_for_plan(today, billing_plan)
        db.add(
            Subscription(
                tenant_id=tenant.id,
                plan=billing_plan,
                billing_cycle=billing_cycle,
                status="trialing",
                amount_kes=0.0,
                discount_percent=0.0,
                period_start=start,
                period_end=end,
            )
        )

    invite_email: Optional[str] = None
    if admin_email:
        invite_email = _clean_email(admin_email)
        _ensure_tenant_admin_access(
            db,
            tenant=tenant,
            admin_email=invite_email,
            admin_full_name=admin_full_name,
            admin_password=admin_password or secrets.token_urlsafe(18),
        )

    db.commit()
    db.refresh(tenant)

    if invite_email:
        _try_send_invitation_email(email=invite_email, tenant=tenant)

    normalized_plan_hint = (
        _normalize_billing_plan(plan)
        if str(plan or "").strip().lower() in {"per_term", "per_year", "full_year"}
        else None
    )
    return _build_tenant_row(db, tenant, plan_hint=normalized_plan_hint)


# ─── Recent tenants ───────────────────────────────────────────────────────────

def get_recent_tenants(db: Session, limit: int = 6) -> dict:
    tenants = db.execute(
        select(Tenant).order_by(Tenant.created_at.desc()).limit(limit)
    ).scalars().all()

    rows: list[dict] = []
    for t in tenants:
        user_count = db.scalar(
            select(func.count()).select_from(UserTenant).where(UserTenant.tenant_id == t.id)
        )

        sub = db.execute(
            select(Subscription)
            .where(
                Subscription.tenant_id == t.id,
                Subscription.status.in_(["active", "trialing"]),
            )
            .order_by(Subscription.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()

        last_activity = db.scalar(
            select(func.max(AuditLog.created_at)).where(AuditLog.tenant_id == t.id)
        )

        rows.append(
            {
                "id": t.id,
                "name": t.name,
                "slug": t.slug,
                "is_active": bool(t.is_active),
                "plan": _subscription_billing_plan(sub) if sub else None,
                "user_count": int(user_count) if user_count is not None else None,
                "created_at": t.created_at,
                "last_activity": last_activity,
            }
        )

    return {"tenants": rows}


# ─── SaaS Metrics ─────────────────────────────────────────────────────────────

def get_saas_metrics(db: Session) -> dict:
    today = date.today()
    first_this_month = today.replace(day=1)
    first_last_month = (first_this_month - timedelta(days=1)).replace(day=1)
    first_next_month = (first_this_month + timedelta(days=32)).replace(day=1)

    # Active subs now (MRR)
    active_subs = db.execute(select(Subscription).where(Subscription.status == "active")).scalars().all()
    mrr = 0.0
    for sub in active_subs:
        billing_plan = _subscription_billing_plan(sub)
        if billing_plan == "per_term":
            mrr += float(sub.amount_kes) / 4
        elif billing_plan == "per_year":
            mrr += float(sub.amount_kes) / 12
    arr = mrr * 12

    # Payments: sum completed payments only (schema-safe)
    amount_col = _resolve_payment_amount_column()
    if amount_col is None:
        total_collected = 0.0
    else:
        payment_stmt = select(func.coalesce(func.sum(amount_col), 0.0))
        payment_stmt = _resolve_payment_completed_filter(payment_stmt)
        total_collected = float(db.scalar(payment_stmt) or 0.0)

    # MoM MRR growth (compute MRR for active subs created within months)
    def _mrr_for_created_between(start: date, end: date) -> float:
        subs = db.execute(
            select(Subscription).where(
                Subscription.status == "active",
                Subscription.created_at >= start,
                Subscription.created_at < end,
            )
        ).scalars().all()
        val = 0.0
        for s in subs:
            billing_plan = _subscription_billing_plan(s)
            if billing_plan == "per_term":
                val += float(s.amount_kes) / 4
            elif billing_plan == "per_year":
                val += float(s.amount_kes) / 12
        return val

    this_month_mrr = _mrr_for_created_between(first_this_month, first_next_month)
    last_month_mrr = _mrr_for_created_between(first_last_month, first_this_month)
    growth_percent = (
        round(((this_month_mrr - last_month_mrr) / last_month_mrr) * 100, 1)
        if last_month_mrr > 0
        else 0.0
    )

    # Subscription counts
    status_rows = db.execute(
        select(Subscription.status, func.count(Subscription.id)).group_by(Subscription.status)
    ).all()
    status_map = {row[0]: int(row[1]) for row in status_rows}

    plan_acc: dict[str, dict[str, float]] = {
        "per_term": {"count": 0, "sum_amount": 0.0},
        "per_year": {"count": 0, "sum_amount": 0.0},
    }
    for sub in active_subs:
        name = _subscription_billing_plan(sub)
        if name not in plan_acc:
            plan_acc[name] = {"count": 0, "sum_amount": 0.0}
        plan_acc[name]["count"] += 1
        plan_acc[name]["sum_amount"] += float(sub.amount_kes or 0.0)

    plans = [
        {
            "name": name,
            "count": int(values["count"]),
            "price": round(
                values["sum_amount"] / values["count"], 2
            ) if values["count"] > 0 else 0.0,
        }
        for name, values in plan_acc.items()
        if values["count"] > 0
    ]

    # Tenant counts
    new_this_month = db.scalar(
        select(func.count()).select_from(Tenant).where(
            Tenant.created_at >= first_this_month,
            Tenant.created_at < first_next_month,
        )
    ) or 0

    churned_this_month = db.scalar(
        select(func.count()).select_from(Tenant).where(
            Tenant.is_active == False,
            Tenant.updated_at >= first_this_month,
            Tenant.updated_at < first_next_month,
        )
    ) or 0

    total_users = db.scalar(
        select(func.count(func.distinct(UserTenant.user_id))).select_from(UserTenant)
    ) or 0

    # System counts
    total_enrollments = db.scalar(select(func.count()).select_from(Enrollment)) or 0
    total_invoices = db.scalar(select(func.count()).select_from(Invoice)) or 0
    total_audit_events = db.scalar(select(func.count()).select_from(AuditLog)) or 0
    total_permissions = db.scalar(select(func.count()).select_from(Permission)) or 0
    total_roles = db.scalar(select(func.count()).select_from(Role)) or 0

    return {
        "revenue": {
            "mrr": round(mrr, 2),
            "arr": round(arr, 2),
            "total_collected": round(total_collected, 2),
            "growth_percent": float(growth_percent),
        },
        "subscriptions": {
            "active": status_map.get("active", 0),
            "trialing": status_map.get("trialing", 0),
            "past_due": status_map.get("past_due", 0),
            "cancelled": status_map.get("cancelled", 0),
            "plans": plans,
        },
        "tenants": {
            "new_this_month": int(new_this_month),
            "churned_this_month": int(churned_this_month),
            "total_users_across_tenants": int(total_users),
        },
        "system": {
            "total_enrollments": int(total_enrollments),
            "total_invoices": int(total_invoices),
            "total_audit_events": int(total_audit_events),
            "total_permissions": int(total_permissions),
            "total_roles": int(total_roles),
        },
    }


# ─── Subscriptions ────────────────────────────────────────────────────────────

def list_subscriptions(
    db: Session,
    status: Optional[str] = None,
    billing_plan: Optional[str] = None,
    tenant_id: Optional[UUID] = None,
    # Backward-compatible aliases for older callers.
    plan: Optional[str] = None,
    billing_cycle: Optional[str] = None,
) -> list[dict]:
    stmt = select(Subscription, Tenant).join(Tenant, Tenant.id == Subscription.tenant_id)

    if status:
        stmt = stmt.where(Subscription.status == status)

    selected_plan = billing_plan
    if not selected_plan and plan:
        selected_plan = plan
    if not selected_plan and billing_cycle:
        raw_cycle = str(billing_cycle).strip().lower()
        if raw_cycle not in {"per_term", "full_year"}:
            raise ValueError("Invalid billing_cycle: use per_term or full_year")
        selected_plan = "per_year" if raw_cycle == "full_year" else "per_term"

    if selected_plan:
        normalized_plan = _normalize_billing_plan(selected_plan)
        stmt = stmt.where(Subscription.billing_cycle == _plan_to_cycle(normalized_plan))

    if tenant_id:
        stmt = stmt.where(Subscription.tenant_id == tenant_id)

    rows = db.execute(stmt.order_by(Subscription.created_at.desc())).all()
    return [_subscription_row(db, sub, tenant) for sub, tenant in rows]


def create_subscription(
    db: Session,
    *,
    tenant_id: UUID,
    billing_plan: str,
    amount_kes: float,
    discount_percent: float = 0.0,
    notes: Optional[str] = None,
    period_start: Optional[date] = None,
) -> dict:
    normalized_plan = _normalize_billing_plan(billing_plan)
    normalized_amount = float(amount_kes or 0.0)
    if normalized_amount <= 0:
        raise ValueError("amount_kes must be greater than 0")

    normalized_discount = float(discount_percent or 0.0)
    if normalized_discount < 0 or normalized_discount > 100:
        raise ValueError("discount_percent must be between 0 and 100")

    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise ValueError("Tenant not found")

    if period_start is not None:
        start = period_start
        if normalized_plan == "per_term":
            term = _active_saas_term_covering_date(db, when=start)
            end = term["end_date"] if term else _period_end_for_plan(start, normalized_plan)
        else:
            end = _period_end_for_plan(start, normalized_plan)
    elif normalized_plan == "per_term":
        eligibility = get_subscription_billing_eligibility(
            db,
            billing_plan=normalized_plan,
            as_of=_service_today(),
        )
        start = eligibility["eligible_from_date"]
        end = eligibility["eligible_until_date"]
    else:
        start = _service_today()
        end = _period_end_for_plan(start, normalized_plan)

    has_prior = (
        db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.tenant_id == tenant_id)
        )
        or 0
    ) > 0

    sub = Subscription(
        tenant_id=tenant_id,
        plan=normalized_plan,
        billing_cycle=_plan_to_cycle(normalized_plan),
        status="active" if has_prior else "trialing",
        amount_kes=normalized_amount,
        discount_percent=normalized_discount,
        period_start=start,
        period_end=end,
        notes=notes,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    return _subscription_row(db, sub, tenant)


def update_subscription(db: Session, subscription_id: UUID, **kwargs) -> dict:
    sub = db.get(Subscription, subscription_id)
    if not sub:
        raise ValueError("Subscription not found")

    # Validate status if provided
    if "status" in kwargs and kwargs["status"] is not None:
        if kwargs["status"] not in ALLOWED_SUB_STATUSES:
            raise ValueError(f"Invalid status: {kwargs['status']}")

    next_billing_plan: str | None = None
    if kwargs.get("billing_plan") is not None:
        next_billing_plan = _normalize_billing_plan(kwargs["billing_plan"])
    elif kwargs.get("plan") is not None:
        # Backward-compatible alias
        next_billing_plan = _normalize_billing_plan(kwargs["plan"])
    elif kwargs.get("billing_cycle") is not None:
        # Backward-compatible alias
        next_billing_plan = _cycle_to_plan(kwargs["billing_cycle"])

    discount_percent = kwargs.get("discount_percent")
    if discount_percent is None:
        discount_percent = float(sub.discount_percent) if sub.discount_percent is not None else 0.0
    else:
        discount_percent = float(discount_percent)
    if discount_percent < 0 or discount_percent > 100:
        raise ValueError("discount_percent must be between 0 and 100")

    if "amount_kes" in kwargs and kwargs["amount_kes"] is not None:
        next_amount = float(kwargs["amount_kes"])
        if next_amount <= 0:
            raise ValueError("amount_kes must be greater than 0")
        sub.amount_kes = next_amount

    if next_billing_plan is not None:
        sub.plan = next_billing_plan
        sub.billing_cycle = _plan_to_cycle(next_billing_plan)

    for field in ("status", "discount_percent", "notes"):
        if field in kwargs and kwargs[field] is not None:
            setattr(sub, field, kwargs[field])

    sub.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(sub)

    tenant = db.get(Tenant, sub.tenant_id)
    return _subscription_row(db, sub, tenant)


def cancel_subscription(db: Session, subscription_id: UUID) -> None:
    sub = db.get(Subscription, subscription_id)
    if not sub:
        raise ValueError("Subscription not found")
    sub.status = "cancelled"
    sub.updated_at = datetime.utcnow()
    db.commit()


# ─── SaaS Subscription Payments ──────────────────────────────────────────────

def _subscription_payment_status_to_api(status: Any) -> str:
    raw = str(status or "PENDING").strip().upper()
    if raw not in {"PENDING", "COMPLETED", "FAILED", "CANCELLED"}:
        raw = "PENDING"
    return raw.lower()


def _effective_subscription_payment_datetime(pay: SubscriptionPayment) -> datetime | None:
    return (
        getattr(pay, "paid_at", None)
        or getattr(pay, "completed_at", None)
        or getattr(pay, "initiated_at", None)
        or getattr(pay, "created_at", None)
    )


def _payment_term_label(*, billing_plan: str, when: datetime | None, request_payload: Any) -> str | None:
    payload = request_payload if isinstance(request_payload, dict) else {}
    for key in ("term_label", "term_code", "term"):
        raw = str(payload.get(key) or "").strip()
        if raw:
            return raw

    if when is None:
        return None

    if billing_plan == "per_year":
        return f"Year {when.year}"

    month = when.month
    if month <= 4:
        term_no = 1
    elif month <= 8:
        term_no = 2
    else:
        term_no = 3
    return f"Term {term_no} {when.year}"


def _saas_subscription_payment_row(
    pay: SubscriptionPayment,
    tenant: Tenant,
    sub: Subscription | None,
) -> dict:
    paid_at = _effective_subscription_payment_datetime(pay)
    billing_plan = _subscription_billing_plan(sub) if sub else "per_term"
    return {
        "id": pay.id,
        "tenant_id": tenant.id,
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
        "subscription_id": pay.subscription_id,
        "checkout_request_id": pay.checkout_request_id,
        "amount_kes": float(pay.amount_kes or 0.0),
        "status": _subscription_payment_status_to_api(getattr(pay, "status", None)),
        "phone_number": getattr(pay, "phone_number", None),
        "mpesa_receipt": getattr(pay, "mpesa_receipt", None),
        "billing_plan": billing_plan,
        "billing_term_label": _payment_term_label(
            billing_plan=billing_plan,
            when=paid_at,
            request_payload=getattr(pay, "request_payload", None),
        ),
        "paid_at": paid_at,
        "created_at": getattr(pay, "created_at", None) or paid_at or datetime.utcnow(),
    }


def list_saas_payment_history(
    db: Session,
    *,
    limit: int = 20,
    offset: int = 0,
    q: Optional[str] = None,
    tenant_id: Optional[UUID] = None,
    status: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> dict:
    paid_at_expr = func.coalesce(
        SubscriptionPayment.paid_at,
        SubscriptionPayment.completed_at,
        SubscriptionPayment.initiated_at,
        SubscriptionPayment.created_at,
    )

    where_clauses = []
    if tenant_id is not None:
        where_clauses.append(SubscriptionPayment.tenant_id == tenant_id)

    if status:
        status_raw = str(status).strip().upper()
        if status_raw not in {"PENDING", "COMPLETED", "FAILED", "CANCELLED"}:
            raise ValueError("Invalid status. Use pending|completed|failed|cancelled")
        where_clauses.append(SubscriptionPayment.status == status_raw)

    if q and q.strip():
        ql = f"%{q.strip()}%"
        where_clauses.append(
            or_(
                Tenant.name.ilike(ql),
                Tenant.slug.ilike(ql),
                SubscriptionPayment.phone_number.ilike(ql),
                SubscriptionPayment.checkout_request_id.ilike(ql),
                SubscriptionPayment.mpesa_receipt.ilike(ql),
            )
        )

    if date_from is not None:
        where_clauses.append(func.date(paid_at_expr) >= date_from)
    if date_to is not None:
        where_clauses.append(func.date(paid_at_expr) <= date_to)

    base_stmt = (
        select(SubscriptionPayment.id)
        .join(Tenant, Tenant.id == SubscriptionPayment.tenant_id)
        .outerjoin(Subscription, Subscription.id == SubscriptionPayment.subscription_id)
    )
    if where_clauses:
        base_stmt = base_stmt.where(and_(*where_clauses))

    total = int(db.scalar(select(func.count()).select_from(base_stmt.subquery())) or 0)

    rows_stmt = (
        select(SubscriptionPayment, Tenant, Subscription)
        .join(Tenant, Tenant.id == SubscriptionPayment.tenant_id)
        .outerjoin(Subscription, Subscription.id == SubscriptionPayment.subscription_id)
    )
    if where_clauses:
        rows_stmt = rows_stmt.where(and_(*where_clauses))
    rows_stmt = (
        rows_stmt.order_by(paid_at_expr.desc(), SubscriptionPayment.id.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = db.execute(rows_stmt).all()

    return {
        "total": total,
        "items": [_saas_subscription_payment_row(pay, tenant, sub) for pay, tenant, sub in rows],
    }


def list_saas_recent_payments(
    db: Session,
    *,
    limit: int = 8,
) -> list[dict]:
    result = list_saas_payment_history(db, limit=limit, offset=0)
    return result["items"]


# ─── SaaS Academic Calendar ──────────────────────────────────────────────────

_TENANT_TERM_TABLE_CANDIDATES = ("core.tenant_terms", "tenant_terms")


def _ensure_saas_academic_calendar_table(db: Session) -> None:
    db.execute(text("CREATE SCHEMA IF NOT EXISTS core"))
    db.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS core.saas_academic_calendar_terms (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                academic_year INT NOT NULL,
                term_no SMALLINT NOT NULL CHECK (term_no BETWEEN 1 AND 3),
                term_code VARCHAR(64) NOT NULL,
                term_name VARCHAR(160) NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT uq_saas_academic_calendar_terms_year_no UNIQUE (academic_year, term_no)
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_saas_academic_calendar_terms_year_active
            ON core.saas_academic_calendar_terms (academic_year, is_active)
            """
        )
    )


def _resolve_existing_table(db: Session, candidates: tuple[str, ...]) -> str:
    for table_name in candidates:
        exists = db.scalar(text("SELECT to_regclass(:name)"), {"name": table_name})
        if exists:
            return table_name
    raise ValueError("Tenant terms storage not found. Apply tenant terms migrations first.")


def _default_academic_calendar_terms(academic_year: int) -> list[dict]:
    return [
        {
            "term_no": n,
            "term_code": f"TERM_{n}_{academic_year}",
            "term_name": f"Term {n} {academic_year}",
            "start_date": None,
            "end_date": None,
            "is_active": True,
            "updated_at": None,
        }
        for n in (1, 2, 3)
    ]


def list_saas_academic_calendar_terms(db: Session, *, academic_year: int) -> dict:
    _ensure_saas_academic_calendar_table(db)
    rows = db.execute(
        text(
            """
            SELECT term_no, term_code, term_name, start_date, end_date,
                   COALESCE(is_active, true) AS is_active, updated_at
            FROM core.saas_academic_calendar_terms
            WHERE academic_year = :academic_year
            ORDER BY term_no ASC
            """
        ),
        {"academic_year": academic_year},
    ).mappings().all()

    if not rows:
        return {
            "academic_year": academic_year,
            "terms": _default_academic_calendar_terms(academic_year),
        }

    return {
        "academic_year": academic_year,
        "terms": [
            {
                "term_no": int(r["term_no"]),
                "term_code": str(r["term_code"]),
                "term_name": str(r["term_name"]),
                "start_date": r["start_date"],
                "end_date": r["end_date"],
                "is_active": bool(r["is_active"]),
                "updated_at": r["updated_at"],
            }
            for r in rows
        ],
    }


def upsert_saas_academic_calendar_terms(
    db: Session,
    *,
    academic_year: int,
    terms: list[dict[str, Any]],
) -> dict:
    _ensure_saas_academic_calendar_table(db)
    if not terms:
        raise ValueError("At least one term is required.")

    seen_term_nos: set[int] = set()
    normalized: list[dict[str, Any]] = []
    for row in terms:
        term_no = int(row.get("term_no"))
        if term_no in seen_term_nos:
            raise ValueError("Duplicate term_no in payload.")
        seen_term_nos.add(term_no)

        start_date = row.get("start_date")
        end_date = row.get("end_date")
        if start_date is None or end_date is None:
            raise ValueError("start_date and end_date are required for each term.")
        if end_date < start_date:
            raise ValueError(f"Term {term_no}: end_date cannot be before start_date.")

        term_code = str(row.get("term_code") or f"TERM_{term_no}_{academic_year}").strip().upper()
        term_name = str(row.get("term_name") or f"Term {term_no} {academic_year}").strip()
        if not term_name:
            term_name = f"Term {term_no} {academic_year}"

        normalized.append(
            {
                "term_no": term_no,
                "term_code": term_code[:64],
                "term_name": term_name[:160],
                "start_date": start_date,
                "end_date": end_date,
                "is_active": bool(row.get("is_active", True)),
            }
        )

    active_ranges = sorted(
        [
            (r["start_date"], r["end_date"], r["term_no"])
            for r in normalized
            if r["is_active"]
        ],
        key=lambda x: x[0],
    )
    for idx in range(1, len(active_ranges)):
        prev = active_ranges[idx - 1]
        cur = active_ranges[idx]
        if cur[0] <= prev[1]:
            raise ValueError(
                f"Active terms overlap: term {prev[2]} and term {cur[2]}."
            )

    for row in normalized:
        payload = {
            "academic_year": academic_year,
            "term_no": row["term_no"],
            "term_code": row["term_code"],
            "term_name": row["term_name"],
            "start_date": row["start_date"],
            "end_date": row["end_date"],
            "is_active": row["is_active"],
        }
        existing = db.execute(
            text(
                """
                SELECT id
                FROM core.saas_academic_calendar_terms
                WHERE academic_year = :academic_year
                  AND term_no = :term_no
                LIMIT 1
                """
            ),
            {
                "academic_year": academic_year,
                "term_no": row["term_no"],
            },
        ).mappings().first()

        if existing:
            db.execute(
                text(
                    """
                    UPDATE core.saas_academic_calendar_terms
                    SET
                        term_code = :term_code,
                        term_name = :term_name,
                        start_date = :start_date,
                        end_date = :end_date,
                        is_active = :is_active,
                        updated_at = now()
                    WHERE id = :id
                    """
                ),
                {
                    **payload,
                    "id": existing["id"],
                },
            )
            continue

        db.execute(
            text(
                """
                INSERT INTO core.saas_academic_calendar_terms (
                    academic_year, term_no, term_code, term_name,
                    start_date, end_date, is_active, updated_at
                )
                VALUES (
                    :academic_year, :term_no, :term_code, :term_name,
                    :start_date, :end_date, :is_active, now()
                )
                """
            ),
            payload,
        )

    return list_saas_academic_calendar_terms(db, academic_year=academic_year)


def apply_saas_academic_calendar_to_tenants(
    db: Session,
    *,
    academic_year: int,
    tenant_ids: list[UUID] | None = None,
    only_missing: bool = True,
) -> dict:
    _ensure_saas_academic_calendar_table(db)
    tenant_term_table = _resolve_existing_table(db, _TENANT_TERM_TABLE_CANDIDATES)

    terms = db.execute(
        text(
            """
            SELECT term_no, term_code, term_name, start_date, end_date, COALESCE(is_active, true) AS is_active
            FROM core.saas_academic_calendar_terms
            WHERE academic_year = :academic_year
              AND COALESCE(is_active, true) = true
            ORDER BY term_no ASC
            """
        ),
        {"academic_year": academic_year},
    ).mappings().all()
    if not terms:
        raise ValueError("No active academic calendar terms found for the selected year.")

    if tenant_ids:
        tenants = db.execute(
            select(Tenant.id).where(Tenant.id.in_(tenant_ids))
        ).scalars().all()
    else:
        tenants = db.execute(
            select(Tenant.id).where(Tenant.is_active == True)
        ).scalars().all()

    if not tenants:
        return {
            "academic_year": academic_year,
            "tenants_targeted": 0,
            "affected_terms": 0,
            "created_terms": 0,
            "updated_terms": 0,
            "skipped_terms": 0,
        }

    created_terms = 0
    updated_terms = 0
    skipped_terms = 0

    for tenant_id in tenants:
        for term in terms:
            code = str(term["term_code"] or f"TERM_{int(term['term_no'])}_{academic_year}").strip().upper()
            name = str(term["term_name"] or f"Term {int(term['term_no'])} {academic_year}").strip()
            start_date = term["start_date"]
            end_date = term["end_date"]
            is_active = bool(term["is_active"])

            exists = db.scalar(
                text(
                    f"""
                    SELECT 1
                    FROM {tenant_term_table}
                    WHERE tenant_id = :tenant_id
                      AND code = :code
                    LIMIT 1
                    """
                ),
                {"tenant_id": tenant_id, "code": code},
            )

            if exists:
                if only_missing:
                    skipped_terms += 1
                    continue
                db.execute(
                    text(
                        f"""
                        UPDATE {tenant_term_table}
                        SET name = :name,
                            is_active = :is_active,
                            start_date = :start_date,
                            end_date = :end_date,
                            updated_at = now()
                        WHERE tenant_id = :tenant_id
                          AND code = :code
                        """
                    ),
                    {
                        "tenant_id": tenant_id,
                        "code": code,
                        "name": name[:160],
                        "is_active": is_active,
                        "start_date": start_date,
                        "end_date": end_date,
                    },
                )
                updated_terms += 1
            else:
                db.execute(
                    text(
                        f"""
                        INSERT INTO {tenant_term_table}
                        (id, tenant_id, code, name, is_active, start_date, end_date, created_at, updated_at)
                        VALUES
                        (gen_random_uuid(), :tenant_id, :code, :name, :is_active, :start_date, :end_date, now(), now())
                        """
                    ),
                    {
                        "tenant_id": tenant_id,
                        "code": code,
                        "name": name[:160],
                        "is_active": is_active,
                        "start_date": start_date,
                        "end_date": end_date,
                    },
                )
                created_terms += 1

    return {
        "academic_year": academic_year,
        "tenants_targeted": len(tenants),
        "affected_terms": created_terms + updated_terms,
        "created_terms": created_terms,
        "updated_terms": updated_terms,
        "skipped_terms": skipped_terms,
    }
