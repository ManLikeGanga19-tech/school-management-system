# app/api/v1/admin/service.py

from __future__ import annotations

from datetime import datetime, date, timedelta
from typing import Optional, Any
from uuid import UUID, uuid4
import secrets

from sqlalchemy.orm import Session
from sqlalchemy import select, func, or_

from app.models.tenant import Tenant
from app.models.user import User
from app.models.membership import UserTenant
from app.models.rbac import Role, UserRole, Permission, UserPermissionOverride
from app.models.audit_log import AuditLog
from app.models.subscription import Subscription
from app.models.payment import Payment
from app.models.enrollment import Enrollment
from app.models.invoice import Invoice
from app.models.tenant_print_profile import TenantPrintProfile

# If your project has hashing util (it does, used in tenants/routes.py)
from app.utils.hashing import hash_password


# ─── Billing prices (KES per term) ───────────────────────────────────────────

PLAN_PRICES: dict[str, float] = {
    "Starter": 5_000.0,
    "Basic": 12_000.0,
    "Professional": 25_000.0,
    "Enterprise": 50_000.0,
}

ALLOWED_BILLING_CYCLES = {"per_term", "full_year"}
ALLOWED_SUB_STATUSES = {"active", "trialing", "past_due", "cancelled", "paused"}


def _clean_optional_text(value: Any, *, max_len: int) -> str | None:
    if value is None:
        return None
    out = str(value).strip()
    if not out:
        return None
    return out[:max_len]


def _compute_amount_and_end(
    *,
    plan: str,
    billing_cycle: str,
    discount_percent: float,
    period_start: date,
) -> tuple[float, date]:
    if plan not in PLAN_PRICES:
        raise ValueError(f"Invalid plan: {plan}")
    if billing_cycle not in ALLOWED_BILLING_CYCLES:
        raise ValueError(f"Invalid billing_cycle: {billing_cycle}")

    base = PLAN_PRICES[plan]
    discount = max(0.0, float(discount_percent or 0.0))

    if billing_cycle == "per_term":
        amount = base * (1 - discount / 100)
        end = period_start + timedelta(days=90)
    else:
        amount = base * 3 * (1 - discount / 100)
        end = period_start + timedelta(days=365)

    return float(amount), end


def _send_invitation_email_or_raise(email: str, tenant: Tenant) -> None:
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

    for field, value in data.items():
        if value is not None and hasattr(tenant, field):
            setattr(tenant, field, value)

    db.commit()
    db.refresh(tenant)
    return tenant


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
        user_count = db.scalar(
            select(func.count()).select_from(UserTenant).where(UserTenant.tenant_id == t.id)
        )

        sub = db.execute(
            select(Subscription)
            .where(Subscription.tenant_id == t.id, Subscription.status == "active")
            .order_by(Subscription.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()

        result.append(
            {
                "id": t.id,
                "slug": t.slug,
                "name": t.name,
                "primary_domain": t.primary_domain,
                "is_active": bool(t.is_active),
                "plan": sub.plan if sub else None,
                "user_count": int(user_count) if user_count is not None else None,
                "created_at": t.created_at,
                "updated_at": getattr(t, "updated_at", None),
            }
        )

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
) -> dict:
    slug = slug.strip()
    name = name.strip()

    existing = db.execute(select(Tenant).where(Tenant.slug == slug)).scalar_one_or_none()
    if existing:
        raise ValueError("Slug already exists")

    tenant = Tenant(name=name, slug=slug, primary_domain=primary_domain, is_active=True)
    db.add(tenant)
    db.flush()  # materialise tenant.id

    # Optional initial subscription (trialing, per_term, 90 days)
    if plan:
        if plan not in PLAN_PRICES:
            raise ValueError(f"Invalid plan: {plan}")
        today = date.today()
        amount, end = _compute_amount_and_end(
            plan=plan,
            billing_cycle="per_term",
            discount_percent=0.0,
            period_start=today,
        )
        db.add(
            Subscription(
                tenant_id=tenant.id,
                plan=plan,
                billing_cycle="per_term",
                status="trialing",
                amount_kes=amount,
                discount_percent=0.0,
                period_start=today,
                period_end=end,
            )
        )

    # Optional admin user + director role + invitation email
    created_user: Optional[User] = None
    if admin_email:
        email = admin_email.strip().lower()
        if not email:
            raise ValueError("admin_email is invalid")

        created_user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if created_user is None:
            # Create temporary password, user will set password via invite flow
            temp_pwd = secrets.token_urlsafe(18)
            created_user = User(
                id=uuid4(),
                email=email,
                password_hash=hash_password(temp_pwd),
                is_active=True,
            )
            db.add(created_user)
            db.flush()

        # Membership
        membership = db.execute(
            select(UserTenant).where(
                UserTenant.tenant_id == tenant.id,
                UserTenant.user_id == created_user.id,
            )
        ).scalar_one_or_none()
        if membership is None:
            db.add(
                UserTenant(
                    id=uuid4(),
                    tenant_id=tenant.id,
                    user_id=created_user.id,
                    is_active=True,
                )
            )

        # Director role assignment (global DIRECTOR role, tenant-scoped assignment)
        director_role = db.execute(
            select(Role).where(Role.code == "DIRECTOR", Role.tenant_id.is_(None))
        ).scalar_one_or_none()
        if not director_role:
            raise RuntimeError("System role DIRECTOR not seeded")

        ur = db.execute(
            select(UserRole).where(
                UserRole.user_id == created_user.id,
                UserRole.role_id == director_role.id,
                UserRole.tenant_id == tenant.id,
            )
        ).scalar_one_or_none()
        if ur is None:
            db.add(
                UserRole(
                    id=uuid4(),
                    tenant_id=tenant.id,
                    user_id=created_user.id,
                    role_id=director_role.id,
                )
            )

        # Send invitation email (after flush so tenant exists)
        _send_invitation_email_or_raise(email=email, tenant=tenant)

    db.commit()
    db.refresh(tenant)

    # Return TenantRow shape
    user_count = db.scalar(
        select(func.count()).select_from(UserTenant).where(UserTenant.tenant_id == tenant.id)
    )

    active_sub = db.execute(
        select(Subscription)
        .where(Subscription.tenant_id == tenant.id, Subscription.status == "active")
        .order_by(Subscription.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    return {
        "id": tenant.id,
        "slug": tenant.slug,
        "name": tenant.name,
        "primary_domain": tenant.primary_domain,
        "is_active": bool(tenant.is_active),
        "plan": active_sub.plan if active_sub else (plan if plan else None),
        "user_count": int(user_count) if user_count is not None else None,
        "created_at": tenant.created_at,
        "updated_at": getattr(tenant, "updated_at", None),
    }


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
                "plan": sub.plan if sub else None,
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
        if sub.billing_cycle == "per_term":
            mrr += float(sub.amount_kes) / 4
        elif sub.billing_cycle == "full_year":
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
            if s.billing_cycle == "per_term":
                val += float(s.amount_kes) / 4
            elif s.billing_cycle == "full_year":
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

    plan_rows = db.execute(
        select(Subscription.plan, func.count(Subscription.id), func.avg(Subscription.amount_kes))
        .where(Subscription.status == "active")
        .group_by(Subscription.plan)
        .order_by(func.count(Subscription.id).desc())
    ).all()
    plans = [{"name": r[0], "count": int(r[1]), "price": float(r[2] or 0)} for r in plan_rows]

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
    plan: Optional[str] = None,
    billing_cycle: Optional[str] = None,
    tenant_id: Optional[UUID] = None,
) -> list[dict]:
    stmt = select(Subscription, Tenant).join(Tenant, Tenant.id == Subscription.tenant_id)

    if status:
        stmt = stmt.where(Subscription.status == status)
    if plan:
        stmt = stmt.where(Subscription.plan == plan)
    if billing_cycle:
        stmt = stmt.where(Subscription.billing_cycle == billing_cycle)
    if tenant_id:
        stmt = stmt.where(Subscription.tenant_id == tenant_id)

    rows = db.execute(stmt.order_by(Subscription.created_at.desc())).all()

    result: list[dict] = []
    for sub, tenant in rows:
        # IMPORTANT: don't drop 0.0
        discount = float(sub.discount_percent) if sub.discount_percent is not None else None

        result.append(
            {
                "id": sub.id,
                "tenant_id": sub.tenant_id,
                "tenant_name": tenant.name,
                "tenant_slug": tenant.slug,
                "plan": sub.plan,
                "billing_cycle": sub.billing_cycle,
                "status": sub.status,
                "amount_kes": float(sub.amount_kes),
                "discount_percent": discount,
                "period_start": sub.period_start,
                "period_end": sub.period_end,
                "next_payment_date": sub.period_end,
                "next_payment_amount": float(sub.amount_kes),
                "created_at": sub.created_at,
                "notes": sub.notes,
            }
        )
    return result


def create_subscription(
    db: Session,
    *,
    tenant_id: UUID,
    plan: str,
    billing_cycle: str,
    discount_percent: float = 0.0,
    notes: Optional[str] = None,
    period_start: Optional[date] = None,
) -> dict:
    if plan not in PLAN_PRICES:
        raise ValueError(f"Invalid plan: {plan}")

    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise ValueError("Tenant not found")

    start = period_start or date.today()
    amount_kes, end = _compute_amount_and_end(
        plan=plan,
        billing_cycle=billing_cycle,
        discount_percent=discount_percent,
        period_start=start,
    )

    has_prior = (
        db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.tenant_id == tenant_id)
        )
        or 0
    ) > 0

    sub = Subscription(
        tenant_id=tenant_id,
        plan=plan,
        billing_cycle=billing_cycle,
        status="active" if has_prior else "trialing",
        amount_kes=float(amount_kes),
        discount_percent=discount_percent,
        period_start=start,
        period_end=end,
        notes=notes,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    return {
        "id": sub.id,
        "tenant_id": sub.tenant_id,
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
        "plan": sub.plan,
        "billing_cycle": sub.billing_cycle,
        "status": sub.status,
        "amount_kes": float(sub.amount_kes),
        "discount_percent": float(sub.discount_percent) if sub.discount_percent is not None else None,
        "period_start": sub.period_start,
        "period_end": sub.period_end,
        "next_payment_date": sub.period_end,
        "next_payment_amount": float(sub.amount_kes),
        "created_at": sub.created_at,
        "notes": sub.notes,
    }


def update_subscription(db: Session, subscription_id: UUID, **kwargs) -> dict:
    sub = db.get(Subscription, subscription_id)
    if not sub:
        raise ValueError("Subscription not found")

    # Validate status if provided
    if "status" in kwargs and kwargs["status"] is not None:
        if kwargs["status"] not in ALLOWED_SUB_STATUSES:
            raise ValueError(f"Invalid status: {kwargs['status']}")

    plan = kwargs.get("plan") or sub.plan
    billing_cycle = kwargs.get("billing_cycle") or sub.billing_cycle

    discount_percent = kwargs.get("discount_percent")
    if discount_percent is None:
        discount_percent = float(sub.discount_percent) if sub.discount_percent is not None else 0.0

    if any(k in kwargs for k in ("plan", "billing_cycle", "discount_percent")):
        amount, _end = _compute_amount_and_end(
            plan=plan,
            billing_cycle=billing_cycle,
            discount_percent=float(discount_percent),
            period_start=sub.period_start or date.today(),
        )
        # Spec says: don't change period_start/end on patch
        sub.amount_kes = float(amount)

    for field in ("plan", "billing_cycle", "status", "discount_percent", "notes"):
        if field in kwargs and kwargs[field] is not None:
            setattr(sub, field, kwargs[field])

    sub.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(sub)

    tenant = db.get(Tenant, sub.tenant_id)
    return {
        "id": sub.id,
        "tenant_id": sub.tenant_id,
        "tenant_name": tenant.name if tenant else "",
        "tenant_slug": tenant.slug if tenant else "",
        "plan": sub.plan,
        "billing_cycle": sub.billing_cycle,
        "status": sub.status,
        "amount_kes": float(sub.amount_kes),
        "discount_percent": float(sub.discount_percent) if sub.discount_percent is not None else None,
        "period_start": sub.period_start,
        "period_end": sub.period_end,
        "next_payment_date": sub.period_end,
        "next_payment_amount": float(sub.amount_kes),
        "created_at": sub.created_at,
        "notes": sub.notes,
    }


def cancel_subscription(db: Session, subscription_id: UUID) -> None:
    sub = db.get(Subscription, subscription_id)
    if not sub:
        raise ValueError("Subscription not found")
    sub.status = "cancelled"
    sub.updated_at = datetime.utcnow()
    db.commit()
