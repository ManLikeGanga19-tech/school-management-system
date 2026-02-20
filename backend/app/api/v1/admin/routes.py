# app/api/v1/admin/routes.py

from __future__ import annotations

from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, and_

from app.core.database import get_db
from app.core.dependencies import get_tenant, require_permission, require_permission_saas

from app.api.v1.admin import service
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

router = APIRouter()

# -------------------------
# SaaS Dashboard (SUPER_ADMIN)
# -------------------------
@router.get("/saas/summary", response_model=SaaSSummary)
def saas_summary(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("admin.dashboard.view_all")),
):
    return service.get_saas_summary(db)


# -------------------------
# Tenant Dashboard (tenant scoped)
# -------------------------
@router.get("/summary", response_model=TenantDashboardSummary)
def tenant_summary(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("admin.dashboard.view_tenant")),
):
    return service.get_tenant_dashboard(db, tenant.id)


# -------------------------
# Tenant Management (SUPER_ADMIN)
# -------------------------
@router.get("/tenants", dependencies=[Depends(require_permission_saas("tenants.read_all"))])
def list_tenants(
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
):
    stmt = select(Tenant)

    if q:
        ql = q.strip().lower()
        stmt = stmt.where(
            (Tenant.slug.ilike(f"%{ql}%")) |
            (Tenant.name.ilike(f"%{ql}%")) |
            (Tenant.primary_domain.ilike(f"%{ql}%"))
        )

    if is_active is not None:
        stmt = stmt.where(Tenant.is_active == is_active)

    rows = db.execute(stmt).scalars().all()
    return [
        {
            "id": str(t.id),
            "slug": t.slug,
            "name": t.name,
            "primary_domain": t.primary_domain,
            "is_active": bool(t.is_active),
            "created_at": getattr(t, "created_at", None),
            "updated_at": getattr(t, "updated_at", None),
        }
        for t in rows
    ]


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
    return {"ok": True}


@router.delete("/tenants/{tenant_id}")
def soft_delete_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("tenants.delete")),
):
    """
    Soft delete: mark inactive.
    (We do NOT hard delete rows to preserve history/audit/billing evidence.)
    """
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    t.is_active = False
    db.commit()
    return {"ok": True}


# -------------------------
# Update Tenant (DIRECTOR / SUPER_ADMIN via perms) - tenant scoped
# -------------------------
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


# -------------------------
# Users (tenant scoped)
# -------------------------
@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("users.manage")),
):
    return service.list_users(db, tenant.id)


# -------------------------
# RBAC: Permissions (SUPER_ADMIN - global)
# -------------------------
@router.get("/rbac/permissions")
def list_permissions(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.permissions.manage")),
):
    perms = db.execute(select(Permission).order_by(Permission.code.asc())).scalars().all()
    return [
        {
            "id": str(p.id),
            "code": p.code,
            "name": p.name,
            "description": p.description,
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

    exists = db.execute(select(Permission).where(Permission.code == code)).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Permission code already exists")

    p = Permission(code=code, name=name, description=description)
    db.add(p)
    db.commit()
    db.refresh(p)
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
    return {"ok": True}


# ============================================================
# ✅ RBAC: Roles (SaaS SUPER_ADMIN)
#
# Enterprise behavior:
# - global roles: tenant_id is NULL (no tenant context required)
# - tenant roles: require explicit tenant_id (query/body) to prevent accidental full-table scans
# ============================================================

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
            raise HTTPException(status_code=400, detail="tenant_id is required when scope=tenant")
        stmt = stmt.where(Role.tenant_id == tenant_id)

    else:  # scope == "all"
        # Enterprise safe default: require tenant_id so you get (global + one tenant)
        if not tenant_id:
            raise HTTPException(status_code=400, detail="tenant_id is required when scope=all")
        stmt = stmt.where((Role.tenant_id == None) | (Role.tenant_id == tenant_id))

    roles = db.execute(stmt.order_by(Role.code.asc())).scalars().all()
    return [
        {
            "id": str(r.id),
            "tenant_id": str(r.tenant_id) if r.tenant_id else None,
            "code": r.code,
            "name": r.name,
            "description": r.description,
            "is_system": bool(r.is_system),
            "created_at": r.created_at,
        }
        for r in roles
    ]


@router.post("/rbac/roles")
def create_role(
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.roles.manage")),
    code: str = Body(...),
    name: str = Body(...),
    description: Optional[str] = Body(default=None),
    scope: str = Body(default="global"),  # "tenant" | "global"
    tenant_id: Optional[UUID] = Body(default=None),  # required if scope="tenant"
):
    code = code.strip()
    if scope not in {"tenant", "global"}:
        raise HTTPException(status_code=400, detail="scope must be 'tenant' or 'global'")

    resolved_tenant_id: Optional[UUID] = None
    if scope == "tenant":
        if not tenant_id:
            raise HTTPException(status_code=400, detail="tenant_id is required when scope='tenant'")
        # validate tenant exists
        t = db.get(Tenant, tenant_id)
        if not t:
            raise HTTPException(status_code=404, detail="Tenant not found")
        resolved_tenant_id = tenant_id

    exists = db.execute(
        select(Role).where(and_(Role.tenant_id == resolved_tenant_id, Role.code == code))
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Role code already exists in this scope")

    r = Role(
        tenant_id=resolved_tenant_id,
        code=code,
        name=name,
        description=description,
        is_system=False,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
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
    return {"ok": True}


# -------------------------
# RBAC: Role Permissions (SaaS SUPER_ADMIN)
# -------------------------
@router.get("/rbac/roles/{role_id}/permissions")
def get_role_permissions(
    role_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_permission_saas("rbac.roles.manage")),
):
    r = db.get(Role, role_id)
    if not r:
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
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    codes = [c.strip() for c in permission_codes if c and c.strip()]
    if not codes:
        return {"ok": True}

    perms = db.execute(select(Permission).where(Permission.code.in_(codes))).scalars().all()
    found = {p.code for p in perms}
    missing = sorted(set(codes) - found)
    if missing:
        raise HTTPException(status_code=400, detail={"missing_permissions": missing})

    for p in perms:
        exists = db.execute(
            select(RolePermission).where(
                and_(RolePermission.role_id == role_id, RolePermission.permission_id == p.id)
            )
        ).scalar_one_or_none()
        if not exists:
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
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    codes = [c.strip() for c in permission_codes if c and c.strip()]
    if not codes:
        return {"ok": True}

    perms = db.execute(select(Permission).where(Permission.code.in_(codes))).scalars().all()
    perm_ids = [p.id for p in perms]

    if perm_ids:
        rows = db.execute(
            select(RolePermission).where(
                and_(RolePermission.role_id == role_id, RolePermission.permission_id.in_(perm_ids))
            )
        ).scalars().all()
        for rp in rows:
            db.delete(rp)

    db.commit()
    return {"ok": True}


# -------------------------
# Assign Role (tenant scoped)
# -------------------------
@router.post("/roles/assign")
def assign_role(
    payload: AssignRoleRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("rbac.user_roles.manage")),
):
    service.assign_role(db, tenant.id, payload.user_id, payload.role_code)
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
            and_(
                Role.code == role_code,
                ((Role.tenant_id == None) | (Role.tenant_id == tenant.id)),
            )
        )
    ).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    ur = db.execute(
        select(UserRole).where(
            and_(
                UserRole.user_id == user_id,
                UserRole.role_id == role.id,
                ((UserRole.tenant_id == None) | (UserRole.tenant_id == tenant.id)),
            )
        )
    ).scalar_one_or_none()

    if ur:
        db.delete(ur)
        db.commit()

    return {"ok": True}


# -------------------------
# Permission Override (tenant scoped)
# -------------------------
@router.post("/permissions/override")
def override_permission(
    payload: PermissionOverrideRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("rbac.user_permissions.manage")),
):
    service.set_permission_override(
        db,
        tenant.id,
        payload.user_id,
        payload.permission_code,
        payload.effect,
    )
    return {"ok": True}


@router.delete("/permissions/override")
def delete_permission_override(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(require_permission("rbac.user_permissions.manage")),
    user_id: UUID = Body(...),
    permission_code: str = Body(...),
):
    perm = db.execute(select(Permission).where(Permission.code == permission_code)).scalar_one_or_none()
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")

    row = db.execute(
        select(UserPermissionOverride).where(
            and_(
                UserPermissionOverride.user_id == user_id,
                UserPermissionOverride.permission_id == perm.id,
                ((UserPermissionOverride.tenant_id == None) | (UserPermissionOverride.tenant_id == tenant.id)),
            )
        )
    ).scalar_one_or_none()

    if row:
        db.delete(row)
        db.commit()

    return {"ok": True}
