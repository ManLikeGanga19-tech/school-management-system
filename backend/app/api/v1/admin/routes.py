# app/api/v1/admin/routes.py

from __future__ import annotations

import re
import time
from typing import Optional, List, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, and_, or_

from app.core.database import get_db
from app.core.dependencies import (
    get_tenant,
    get_current_user,
    require_permission,
    require_permission_saas,
)

from app.api.v1.admin import service
from app.api.v1.payments import service as payments_service
from app.api.v1.admin.schemas import (
    SaaSSummary,
    TenantDashboardSummary,
    TenantUpdate,
    UserOut,
    AssignRoleRequest,
    PermissionOverrideRequest,
)

from app.models.tenant import Tenant
from app.models.membership import UserTenant
from app.models.rbac import (
    Role,
    Permission,
    RolePermission,
    UserRole,
    UserPermissionOverride,
)
from datetime import date as _date
from app.api.v1.admin.schemas import (
    SaaSMetricsResponse,
    RecentTenantsResponse,
    SaaSPaymentHistoryRow,
    SaaSPaymentHistoryResponse,
    SaaSAcademicCalendarResponse,
    SaaSAcademicCalendarUpsertRequest,
    SaaSAcademicCalendarApplyRequest,
    SaaSAcademicCalendarApplyResponse,
    TenantRow,
    TenantPrintProfileOut,
    TenantPrintProfileUpsert,
    CreateTenantRequest,
    SubscriptionRow,
    CreateSubscriptionRequest,
    UpdateSubscriptionRequest,
    PermissionRow,
    DarajaPaymentsHealthResponse,
    DarajaConnectivityCheckResponse,
)

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# In-process TTL cache (no external dependency)
# One instance per worker process — good enough for a dashboard endpoint.
# Invalidated explicitly after any mutation that affects the cached counts.
# ─────────────────────────────────────────────────────────────────────────────

class _TTLCache:
    def __init__(self, ttl_seconds: int) -> None:
        self._ttl        = ttl_seconds
        self._value: Any = None
        self._expires    = 0.0

    def get(self) -> Any | None:
        return self._value if time.monotonic() < self._expires else None

    def set(self, value: Any) -> None:
        self._value   = value
        self._expires = time.monotonic() + self._ttl

    def invalidate(self) -> None:
        self._expires = 0.0


_metrics_cache = _TTLCache(ttl_seconds=60)
_recent_cache  = _TTLCache(ttl_seconds=30)
_daraja_connectivity_cache = _TTLCache(ttl_seconds=45)


# ─────────────────────────────────────────────────────────────────────────────
# SaaS Dashboard — Super Admin
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/saas/summary", response_model=SaaSSummary)
def saas_summary(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("admin.dashboard.view_all")),
):
    return service.get_saas_summary(db)


@router.get("/saas/metrics", response_model=SaaSMetricsResponse)
def saas_metrics(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("admin.dashboard.view_all")),
):
    """Platform-wide KPI metrics. Response is cached for 60 s."""
    cached = _metrics_cache.get()
    if cached is not None:
        return cached
    result = service.get_saas_metrics(db)
    _metrics_cache.set(result)
    return result


@router.get("/saas/tenants/recent", response_model=RecentTenantsResponse)
def saas_recent_tenants(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("admin.dashboard.view_all")),
):
    """Six most recently onboarded tenants. Cached for 30 s."""
    cached = _recent_cache.get()
    if cached is not None:
        return cached
    result = service.get_recent_tenants(db)
    _recent_cache.set(result)
    return result


@router.get("/saas/payments/recent", response_model=list[SaaSPaymentHistoryRow])
def saas_recent_payments(
    limit: int = Query(default=8, ge=1, le=50),
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("admin.dashboard.view_all")),
):
    return service.list_saas_recent_payments(db, limit=limit)


@router.get("/saas/payments/history", response_model=SaaSPaymentHistoryResponse)
def saas_payment_history(
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: Optional[str] = Query(default=None),
    tenant_id: Optional[UUID] = Query(default=None),
    status: Optional[str] = Query(default=None),
    date_from: Optional[_date] = Query(default=None),
    date_to: Optional[_date] = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("admin.dashboard.view_all")),
):
    try:
        return service.list_saas_payment_history(
            db,
            limit=limit,
            offset=offset,
            q=q,
            tenant_id=tenant_id,
            status=status,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/saas/academic-calendar", response_model=SaaSAcademicCalendarResponse)
def get_saas_academic_calendar(
    academic_year: int = Query(default=_date.today().year, ge=2000, le=2100),
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("admin.dashboard.view_all")),
):
    return service.list_saas_academic_calendar_terms(db, academic_year=academic_year)


@router.put("/saas/academic-calendar", response_model=SaaSAcademicCalendarResponse)
def upsert_saas_academic_calendar(
    payload: SaaSAcademicCalendarUpsertRequest,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("subscriptions.manage")),
):
    try:
        result = service.upsert_saas_academic_calendar_terms(
            db,
            academic_year=payload.academic_year,
            terms=[t.model_dump() for t in payload.terms],
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/saas/academic-calendar/apply", response_model=SaaSAcademicCalendarApplyResponse)
def apply_saas_academic_calendar(
    payload: SaaSAcademicCalendarApplyRequest,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("subscriptions.manage")),
):
    try:
        result = service.apply_saas_academic_calendar_to_tenants(
            db,
            academic_year=payload.academic_year,
            tenant_ids=payload.tenant_ids,
            only_missing=payload.only_missing,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        msg = str(exc)
        status = 404 if "not found" in msg.lower() else 422
        raise HTTPException(status_code=status, detail=msg)


@router.get("/saas/payments/health", response_model=DarajaPaymentsHealthResponse)
def saas_payments_health(
    _=Depends(require_permission_saas("admin.dashboard.view_all")),
):
    return payments_service.get_daraja_health()


@router.get("/saas/payments/health/connectivity", response_model=DarajaConnectivityCheckResponse)
def saas_payments_connectivity_check(
    force: bool = Query(default=False),
    _=Depends(require_permission_saas("admin.dashboard.view_all")),
):
    if not force:
        cached = _daraja_connectivity_cache.get()
        if cached is not None:
            return cached
    result = payments_service.get_daraja_connectivity_check()
    _daraja_connectivity_cache.set(result)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Tenant Dashboard — tenant scoped
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/summary", response_model=TenantDashboardSummary)
def tenant_summary(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("admin.dashboard.view_tenant")),
):
    return service.get_tenant_dashboard(db, tenant.id)


# ─────────────────────────────────────────────────────────────────────────────
# Tenant Management — Super Admin
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/tenants", response_model=list[TenantRow], dependencies=[Depends(require_permission_saas("tenants.read_all"))])
def list_tenants(
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
):
    return service.list_tenants_with_metadata(db, q=q, is_active=is_active)


@router.get(
    "/tenants/{tenant_id}/print-profile",
    response_model=TenantPrintProfileOut,
    dependencies=[Depends(require_permission_saas("tenants.read_all"))],
)
def get_tenant_print_profile(
    tenant_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        row = service.get_or_create_tenant_print_profile(db, tenant_id=tenant_id)
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception:
        db.rollback()
        tenant = db.get(Tenant, tenant_id)
        if tenant is None:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return TenantPrintProfileOut(
            tenant_id=tenant.id,
            logo_url=None,
            school_header=tenant.name,
            receipt_footer="Thank you for partnering with us.",
            paper_size="A4",
            currency="KES",
            thermal_width_mm=80,
            qr_enabled=True,
            updated_by=None,
            updated_at=None,
        )


@router.put(
    "/tenants/{tenant_id}/print-profile",
    response_model=TenantPrintProfileOut,
    dependencies=[Depends(require_permission_saas("tenants.update"))],
)
def update_tenant_print_profile(
    tenant_id: UUID,
    payload: TenantPrintProfileUpsert,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        row = service.upsert_tenant_print_profile(
            db,
            tenant_id=tenant_id,
            actor_user_id=getattr(user, "id", None),
            data=payload.model_dump(),
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        db.rollback()
        detail = str(exc)
        status = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status, detail=detail)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Unable to update print profile. Ensure latest migrations are applied.",
        )


@router.post("/tenants")
def create_tenant_endpoint(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("tenants.create")),
    name: str                   = Body(...),
    slug: str                   = Body(...),
    primary_domain: Optional[str] = Body(default=None),
    plan: Optional[str]         = Body(default=None),
):
    if not re.match(r"^[a-z0-9-]+$", slug):
        raise HTTPException(
            status_code=422,
            detail="slug must be lowercase letters, numbers, and hyphens only",
        )
    try:
        tenant = service.create_tenant(db, name=name, slug=slug, primary_domain=primary_domain, plan=plan)
    except ValueError as exc:
        code = 409 if "already exists" in str(exc) else 422
        raise HTTPException(status_code=code, detail=str(exc))

    _metrics_cache.invalidate()
    _recent_cache.invalidate()
    return {
        "id":             str(tenant.id),
        "slug":           tenant.slug,
        "name":           tenant.name,
        "primary_domain": tenant.primary_domain,
        "is_active":      tenant.is_active,
        "created_at":     tenant.created_at,
    }


@router.post("/tenants/{tenant_id}/suspend")
def suspend_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("tenants.suspend")),
):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    t.is_active = False
    db.commit()
    _metrics_cache.invalidate()
    _recent_cache.invalidate()
    return {"ok": True}


@router.post("/tenants/{tenant_id}/restore")
def restore_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("tenants.update")),
):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    t.is_active = True
    db.commit()
    _metrics_cache.invalidate()
    _recent_cache.invalidate()
    return {"ok": True}


@router.delete("/tenants/{tenant_id}")
def soft_delete_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("tenants.delete")),
):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    t.is_active = False
    db.commit()
    _metrics_cache.invalidate()
    _recent_cache.invalidate()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Update Tenant — tenant scoped (director / super admin via perms)
# ─────────────────────────────────────────────────────────────────────────────

@router.patch("/tenant")
def update_tenant(
    payload: TenantUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("tenants.update")),
):
    updated = service.update_tenant(db, tenant.id, payload.model_dump())
    if not updated:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Users — tenant scoped
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("users.manage")),
):
    return service.list_users(db, tenant.id)


# ─────────────────────────────────────────────────────────────────────────────
# Subscriptions — Super Admin
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/subscriptions", response_model=list[SubscriptionRow])
def list_subscriptions(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("subscriptions.manage")),
    status: Optional[str] = Query(default=None),
    billing_plan: Optional[str] = Query(default=None),
    # Backward-compatible query aliases.
    plan: Optional[str] = Query(default=None),
    billing_cycle: Optional[str] = Query(default=None),
    tenant_id: Optional[UUID] = Query(default=None),
):
    try:
        return service.list_subscriptions(
            db,
            status=status,
            billing_plan=billing_plan,
            plan=plan,
            billing_cycle=billing_cycle,
            tenant_id=tenant_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/subscriptions", response_model=SubscriptionRow, status_code=201)
def create_subscription(
    payload: CreateSubscriptionRequest,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("subscriptions.manage")),
):
    try:
        sub_row = service.create_subscription(
            db,
            tenant_id=payload.tenant_id,
            billing_plan=payload.billing_plan,
            amount_kes=payload.amount_kes,
            discount_percent=payload.discount_percent,
            notes=payload.notes,
            period_start=payload.period_start,
        )
    except ValueError as exc:
        msg = str(exc)
        if "Tenant not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=422, detail=msg)

    _metrics_cache.invalidate()
    return sub_row


@router.patch("/subscriptions/{subscription_id}", response_model=SubscriptionRow)
def update_subscription(
    subscription_id: UUID,
    payload: UpdateSubscriptionRequest,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("subscriptions.manage")),
):
    kwargs = {k: v for k, v in payload.model_dump().items() if v is not None}

    try:
        row = service.update_subscription(db, subscription_id, **kwargs)
    except ValueError as exc:
        msg = str(exc)
        if "not found" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=422, detail=msg)

    _metrics_cache.invalidate()
    return row


@router.delete("/subscriptions/{subscription_id}")
def cancel_subscription(
    subscription_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("subscriptions.manage")),
):
    try:
        service.cancel_subscription(db, subscription_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    _metrics_cache.invalidate()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# RBAC: Permissions — Super Admin global
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/rbac/permissions", response_model=list[PermissionRow])
def list_permissions(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.permissions.manage")),
):
    perms = db.execute(select(Permission).order_by(Permission.code.asc())).scalars().all()
    return [
        {
            "id": p.id,
            "code": p.code,
            "name": p.name,
            "description": p.description,
            "category": getattr(p, "category", None),
            "created_at": p.created_at,
        }
        for p in perms
    ]


@router.post("/rbac/permissions")
def create_permission(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.permissions.manage")),
    code: str = Body(...),
    name: str = Body(...),
    description: Optional[str] = Body(default=None),
):
    code = code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if db.execute(select(Permission).where(Permission.code == code)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Permission code already exists")
    p = Permission(code=code, name=name, description=description)
    db.add(p)
    db.commit()
    db.refresh(p)
    _metrics_cache.invalidate()
    return {"ok": True, "id": str(p.id)}


@router.patch("/rbac/permissions/{code}")
def update_permission(
    code: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.permissions.manage")),
    name: Optional[str] = Body(default=None),
    description: Optional[str] = Body(default=None),
):
    p = db.execute(select(Permission).where(Permission.code == code)).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Permission not found")
    if name is not None:
        p.name = name
    if description is not None:
        p.description = description
    db.commit()
    return {"ok": True}


@router.delete("/rbac/permissions/{code}")
def delete_permission(
    code: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.permissions.manage")),
):
    p = db.execute(select(Permission).where(Permission.code == code)).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Permission not found")
    db.delete(p)
    db.commit()
    _metrics_cache.invalidate()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# RBAC: Roles — Super Admin
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/rbac/roles")
def list_roles(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.roles.manage")),
    scope: str = Query(default="global", pattern="^(tenant|global|all)$"),
    tenant_id: Optional[UUID] = Query(default=None),
):
    stmt = select(Role)
    if scope == "global":
        stmt = stmt.where(Role.tenant_id == None)
    elif scope == "tenant":
        if not tenant_id:
            raise HTTPException(status_code=400, detail="tenant_id required when scope=tenant")
        stmt = stmt.where(Role.tenant_id == tenant_id)
    else:
        if not tenant_id:
            raise HTTPException(status_code=400, detail="tenant_id required when scope=all")
        stmt = stmt.where(or_(Role.tenant_id == None, Role.tenant_id == tenant_id))

    roles = db.execute(stmt.order_by(Role.code.asc())).scalars().all()
    return [
        {"id": str(r.id), "tenant_id": str(r.tenant_id) if r.tenant_id else None,
         "code": r.code, "name": r.name, "description": r.description,
         "is_system": bool(r.is_system), "created_at": r.created_at}
        for r in roles
    ]


@router.post("/rbac/roles")
def create_role(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.roles.manage")),
    code: str = Body(...),
    name: str = Body(...),
    description: Optional[str] = Body(default=None),
    scope: str = Body(default="global"),
    tenant_id: Optional[UUID] = Body(default=None),
):
    code = code.strip()
    if scope not in {"tenant", "global"}:
        raise HTTPException(status_code=400, detail="scope must be 'tenant' or 'global'")

    resolved_tid: Optional[UUID] = None
    if scope == "tenant":
        if not tenant_id:
            raise HTTPException(status_code=400, detail="tenant_id required when scope=tenant")
        if not db.get(Tenant, tenant_id):
            raise HTTPException(status_code=404, detail="Tenant not found")
        resolved_tid = tenant_id

    if db.execute(
        select(Role).where(and_(Role.tenant_id == resolved_tid, Role.code == code))
    ).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Role code already exists in this scope")

    r = Role(tenant_id=resolved_tid, code=code, name=name, description=description, is_system=False)
    db.add(r)
    db.commit()
    db.refresh(r)
    _metrics_cache.invalidate()
    return {"ok": True, "id": str(r.id)}


@router.patch("/rbac/roles/{role_id}")
def update_role(
    role_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.roles.manage")),
    name: Optional[str] = Body(default=None),
    description: Optional[str] = Body(default=None),
):
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")
    if name is not None:
        r.name = name
    if description is not None:
        r.description = description
    db.commit()
    return {"ok": True}


@router.delete("/rbac/roles/{role_id}")
def delete_role(
    role_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.roles.manage")),
):
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")
    if r.is_system:
        raise HTTPException(status_code=400, detail="System roles cannot be deleted")
    db.delete(r)
    db.commit()
    _metrics_cache.invalidate()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# RBAC: Role ↔ Permission mapping
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/rbac/roles/{role_id}/permissions")
def get_role_permissions(
    role_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.roles.manage")),
):
    if not db.get(Role, role_id):
        raise HTTPException(status_code=404, detail="Role not found")
    rows = db.execute(
        select(Permission.code)
        .select_from(RolePermission)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(RolePermission.role_id == role_id)
        .order_by(Permission.code.asc())
    ).all()
    return {"role_id": str(role_id), "permissions": [x[0] for x in rows]}


@router.post("/rbac/roles/{role_id}/permissions")
def add_role_permissions(
    role_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.roles.manage")),
    permission_codes: List[str] = Body(...),
):
    if not db.get(Role, role_id):
        raise HTTPException(status_code=404, detail="Role not found")

    codes = [c.strip() for c in permission_codes if c and c.strip()]
    if not codes:
        return {"ok": True}

    perms   = db.execute(select(Permission).where(Permission.code.in_(codes))).scalars().all()
    missing = sorted(set(codes) - {p.code for p in perms})
    if missing:
        raise HTTPException(status_code=400, detail={"missing_permissions": missing})

    for p in perms:
        if not db.execute(
            select(RolePermission).where(
                and_(RolePermission.role_id == role_id, RolePermission.permission_id == p.id)
            )
        ).scalar_one_or_none():
            db.add(RolePermission(role_id=role_id, permission_id=p.id))

    db.commit()
    return {"ok": True}


@router.delete("/rbac/roles/{role_id}/permissions")
def remove_role_permissions(
    role_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.roles.manage")),
    permission_codes: List[str] = Body(...),
):
    if not db.get(Role, role_id):
        raise HTTPException(status_code=404, detail="Role not found")

    codes    = [c.strip() for c in permission_codes if c and c.strip()]
    perm_ids = [
        p.id for p in db.execute(
            select(Permission).where(Permission.code.in_(codes))
        ).scalars().all()
    ]

    if perm_ids:
        for rp in db.execute(
            select(RolePermission).where(
                and_(RolePermission.role_id == role_id, RolePermission.permission_id.in_(perm_ids))
            )
        ).scalars().all():
            db.delete(rp)
        db.commit()

    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Assign / Remove Role — tenant scoped
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/roles/assign")
def assign_role(
    payload: AssignRoleRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("rbac.user_roles.manage")),
):
    try:
        service.assign_role(db, tenant.id, payload.user_id, payload.role_code)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}


@router.post("/roles/remove")
def remove_role(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("rbac.user_roles.manage")),
    user_id: UUID = Body(...),
    role_code: str = Body(...),
):
    role = db.execute(
        select(Role).where(
            Role.code == role_code,
            or_(Role.tenant_id == None, Role.tenant_id == tenant.id),
        )
    ).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    ur = db.execute(
        select(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role_id == role.id,
            or_(UserRole.tenant_id == None, UserRole.tenant_id == tenant.id),
        )
    ).scalar_one_or_none()

    if ur:
        db.delete(ur)
        db.commit()

    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Permission Override — tenant scoped
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/permissions/override")
def override_permission(
    payload: PermissionOverrideRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("rbac.user_permissions.manage")),
):
    try:
        service.set_permission_override(
            db, tenant.id, payload.user_id, payload.permission_code, payload.effect
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}


@router.delete("/permissions/override")
def delete_permission_override(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("rbac.user_permissions.manage")),
    user_id: UUID = Body(...),
    permission_code: str = Body(...),
):
    perm = db.execute(
        select(Permission).where(Permission.code == permission_code)
    ).scalar_one_or_none()
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")

    row = db.execute(
        select(UserPermissionOverride).where(
            UserPermissionOverride.user_id == user_id,
            UserPermissionOverride.permission_id == perm.id,
            or_(
                UserPermissionOverride.tenant_id == None,
                UserPermissionOverride.tenant_id == tenant.id,
            ),
        )
    ).scalar_one_or_none()

    if row:
        db.delete(row)
        db.commit()

    return {"ok": True}
