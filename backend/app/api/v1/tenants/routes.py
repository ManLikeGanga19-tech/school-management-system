from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, List, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from sqlalchemy.orm import Session
from sqlalchemy import select, and_
import sqlalchemy as sa

from app.core.database import get_db
from app.core.dependencies import get_tenant, get_current_user, require_permission

from app.models.tenant import Tenant
from app.models.user import User
from app.models.membership import UserTenant

from app.models.rbac import (
    Role,
    Permission,
    RolePermission,
    UserRole,
    UserPermissionOverride,
)
from app.utils.hashing import hash_password

router = APIRouter()


# ---------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------

class TenantCreate(BaseModel):
    slug: str = Field(..., min_length=2, max_length=80)
    name: str = Field(..., min_length=2, max_length=200)
    primary_domain: Optional[str] = Field(default=None, max_length=255)
    is_active: bool = True
    director_email: Optional[str] = None
    director_password: Optional[str] = None
    director_full_name: Optional[str] = None
    director_phone: Optional[str] = None


class TenantUpdate(BaseModel):
    # Super Admin can update these
    slug: Optional[str] = Field(default=None, min_length=2, max_length=80)
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    primary_domain: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None


class TenantSelfUpdate(BaseModel):
    # Director can update limited fields within their tenant
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)


class RoleCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=60)
    name: str = Field(..., min_length=2, max_length=120)
    description: Optional[str] = Field(default=None, max_length=255)


class RoleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    description: Optional[str] = Field(default=None, max_length=255)


class RolePermissionsSet(BaseModel):
    permission_codes: List[str] = Field(default_factory=list)


class UserRoleAssign(BaseModel):
    role_code: str = Field(..., min_length=2, max_length=60)


class UserPermissionOverrideIn(BaseModel):
    permission_code: str
    effect: Literal["ALLOW", "DENY"]
    reason: Optional[str] = None


class UserPermissionOverridesSet(BaseModel):
    overrides: List[UserPermissionOverrideIn] = Field(default_factory=list)


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _normalize_slug(value: str) -> str:
    return value.strip().lower()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _get_role_by_code(db: Session, *, tenant_id: UUID, role_code: str) -> Role | None:
    # tenant role OR global system role
    return db.execute(
        select(Role).where(
            Role.code == role_code,
            sa.or_(Role.tenant_id.is_(None), Role.tenant_id == tenant_id),
        )
    ).scalar_one_or_none()


def _ensure_user_in_tenant(db: Session, *, tenant_id: UUID, user_id: UUID) -> None:
    membership = db.execute(
        select(UserTenant).where(
            and_(
                UserTenant.tenant_id == tenant_id,
                UserTenant.user_id == user_id,
                UserTenant.is_active == True,
            )
        )
    ).scalar_one_or_none()

    if not membership:
        raise HTTPException(status_code=400, detail="User is not active in this tenant")


# ---------------------------------------------------------------------
# Tenant Context
# ---------------------------------------------------------------------

@router.get("/whoami")
def whoami(tenant=Depends(get_tenant)):
    return {
        "tenant_id": str(tenant.id),
        "tenant_slug": tenant.slug,
        "tenant_name": tenant.name
    }


# ---------------------------------------------------------------------
# Super Admin: Tenants Management (SaaS Operator)
# ---------------------------------------------------------------------

@router.get(
    "",
    dependencies=[Depends(require_permission("tenants.read_all"))],
)
def list_tenants(
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    include_inactive: bool = True,
):
    q = select(Tenant)
    if not include_inactive:
        q = q.where(Tenant.is_active == True)

    rows = db.execute(q.order_by(Tenant.created_at.desc())).scalars().all()

    return [
        {
            "id": str(t.id),
            "slug": t.slug,
            "name": t.name,
            "primary_domain": t.primary_domain,
            "is_active": bool(t.is_active),
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        }
        for t in rows
    ]


@router.post(
    "",
    dependencies=[Depends(require_permission("tenants.create"))],
)
def create_tenant(
    payload: TenantCreate,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    slug = _normalize_slug(payload.slug)

    # simple uniqueness guard (DB constraints still enforce this)
    exists = db.execute(select(Tenant).where(Tenant.slug == slug)).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Tenant slug already exists")

    if payload.primary_domain:
        dom = payload.primary_domain.strip().lower()
        dom_exists = db.execute(select(Tenant).where(Tenant.primary_domain == dom)).scalar_one_or_none()
        if dom_exists:
            raise HTTPException(status_code=409, detail="Primary domain already mapped to another tenant")
    else:
        dom = None

    t = Tenant(
        id=uuid4(),
        slug=slug,
        name=payload.name.strip(),
        primary_domain=dom,
        is_active=payload.is_active,
    )
    db.add(t)

    # Optional bootstrap: create director user + membership + role assignment
    if payload.director_email and payload.director_password:
        email = payload.director_email.strip().lower()

        # User is global unique by email
        existing_user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if existing_user is None:
            existing_user = User(
                id=uuid4(),
                email=email,
                password_hash=hash_password(payload.director_password),
                full_name=(payload.director_full_name.strip() if payload.director_full_name else None),
                phone=(payload.director_phone.strip() if payload.director_phone else None),
                is_active=True,
            )
            db.add(existing_user)

        # Membership
        membership = db.execute(
            select(UserTenant).where(
                UserTenant.tenant_id == t.id,
                UserTenant.user_id == existing_user.id,
            )
        ).scalar_one_or_none()

        if membership is None:
            db.add(UserTenant(
                id=uuid4(),
                tenant_id=t.id,
                user_id=existing_user.id,
                is_active=True,
            ))

        # Role assignment (tenant-scoped DIRECTOR)
        director_role = db.execute(
            select(Role).where(Role.code == "DIRECTOR", Role.tenant_id.is_(None))
        ).scalar_one_or_none()

        if not director_role:
            raise HTTPException(status_code=500, detail="System role DIRECTOR not seeded")

        ur = db.execute(
            select(UserRole).where(
                UserRole.user_id == existing_user.id,
                UserRole.role_id == director_role.id,
                UserRole.tenant_id == t.id,
            )
        ).scalar_one_or_none()

        if ur is None:
            db.add(UserRole(
                id=uuid4(),
                tenant_id=t.id,
                user_id=existing_user.id,
                role_id=director_role.id,
            ))



    db.commit()
    db.refresh(t)

    return {
        "id": str(t.id),
        "slug": t.slug,
        "name": t.name,
        "primary_domain": t.primary_domain,
        "is_active": bool(t.is_active),
    }


@router.patch(
    "/{tenant_id}",
    dependencies=[Depends(require_permission("tenants.update"))],
)
def update_tenant(
    tenant_id: UUID,
    payload: TenantUpdate,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if payload.slug is not None:
        new_slug = _normalize_slug(payload.slug)
        if new_slug != t.slug:
            slug_exists = db.execute(select(Tenant).where(Tenant.slug == new_slug)).scalar_one_or_none()
            if slug_exists:
                raise HTTPException(status_code=409, detail="Tenant slug already exists")
            t.slug = new_slug

    if payload.primary_domain is not None:
        dom = payload.primary_domain.strip().lower() if payload.primary_domain else None
        if dom != t.primary_domain and dom is not None:
            dom_exists = db.execute(select(Tenant).where(Tenant.primary_domain == dom)).scalar_one_or_none()
            if dom_exists:
                raise HTTPException(status_code=409, detail="Primary domain already mapped to another tenant")
        t.primary_domain = dom

    if payload.name is not None:
        t.name = payload.name.strip()

    if payload.is_active is not None:
        t.is_active = bool(payload.is_active)

    # keep updated_at fresh (if your DB default is enough, still okay)
    t.updated_at = _now_utc()

    db.commit()
    db.refresh(t)

    return {
        "id": str(t.id),
        "slug": t.slug,
        "name": t.name,
        "primary_domain": t.primary_domain,
        "is_active": bool(t.is_active),
    }


@router.post(
    "/{tenant_id}/suspend",
    dependencies=[Depends(require_permission("tenants.suspend"))],
)
def suspend_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    t.is_active = False
    t.updated_at = _now_utc()
    db.commit()

    return {"ok": True, "tenant_id": str(t.id), "is_active": bool(t.is_active)}


@router.post(
    "/{tenant_id}/activate",
    dependencies=[Depends(require_permission("tenants.update"))],
)
def activate_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    t.is_active = True
    t.updated_at = _now_utc()
    db.commit()

    return {"ok": True, "tenant_id": str(t.id), "is_active": bool(t.is_active)}


@router.delete(
    "/{tenant_id}",
    dependencies=[Depends(require_permission("tenants.delete"))],
)
def soft_delete_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """
    Soft delete strategy using your current schema:
      - deactivate tenant
      - detach primary_domain (frees unique constraint)
      - optionally rename slug to avoid slug uniqueness collisions
    """
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    t.is_active = False
    t.primary_domain = None

    # optional slug rename (prevents future slug collision if you want to reuse it)
    # keep readable and deterministic
    suffix = str(uuid4())[:8]
    t.slug = f"{t.slug}-deleted-{suffix}"

    t.updated_at = _now_utc()
    db.commit()

    return {"ok": True, "tenant_id": str(t.id)}


# ---------------------------------------------------------------------
# Tenant Admin: Update own tenant basics (Director use-case)
# ---------------------------------------------------------------------

@router.patch(
    "/me",
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def update_my_tenant(
    payload: TenantSelfUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    t = db.get(Tenant, tenant.id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if payload.name is not None:
        t.name = payload.name.strip()
        t.updated_at = _now_utc()

    db.commit()
    db.refresh(t)

    return {
        "id": str(t.id),
        "slug": t.slug,
        "name": t.name,
        "primary_domain": t.primary_domain,
        "is_active": bool(t.is_active),
    }


# ---------------------------------------------------------------------
# RBAC Management (Tenant-scoped, enterprise)
# Director can manage within tenant; Super Admin can also manage.
# ---------------------------------------------------------------------

@router.get(
    "/rbac/permissions",
    dependencies=[Depends(require_permission("rbac.permissions.manage"))],
)
def list_permissions(
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    perms = db.execute(select(Permission).order_by(Permission.code.asc())).scalars().all()
    return [
        {
            "id": str(p.id),
            "code": p.code,
            "name": p.name,
            "description": p.description,
        }
        for p in perms
    ]


@router.get(
    "/rbac/roles",
    dependencies=[Depends(require_permission("rbac.roles.manage"))],
)
def list_roles(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    include_system: bool = True,
):
    q = select(Role).where(sa.or_(Role.tenant_id.is_(None), Role.tenant_id == tenant.id))
    if not include_system:
        q = q.where(Role.tenant_id == tenant.id)

    roles = db.execute(q.order_by(Role.code.asc())).scalars().all()
    return [
        {
            "id": str(r.id),
            "tenant_id": str(r.tenant_id) if r.tenant_id else None,
            "code": r.code,
            "name": r.name,
            "description": r.description,
            "is_system": bool(r.is_system),
        }
        for r in roles
    ]


@router.post(
    "/rbac/roles",
    dependencies=[Depends(require_permission("rbac.roles.manage"))],
)
def create_role(
    payload: RoleCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    code = payload.code.strip().upper()

    exists = db.execute(
        select(Role).where(
            Role.code == code,
            Role.tenant_id == tenant.id,
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Role code already exists in this tenant")

    r = Role(
        id=uuid4(),
        tenant_id=tenant.id,
        code=code,
        name=payload.name.strip(),
        description=(payload.description.strip() if payload.description else None),
        is_system=False,
    )
    db.add(r)
    db.commit()
    db.refresh(r)

    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "code": r.code,
        "name": r.name,
        "description": r.description,
        "is_system": bool(r.is_system),
    }


@router.patch(
    "/rbac/roles/{role_id}",
    dependencies=[Depends(require_permission("rbac.roles.manage"))],
)
def update_role(
    role_id: UUID,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    # protect system roles from tenant edits
    if r.tenant_id is None or r.is_system:
        raise HTTPException(status_code=403, detail="System roles cannot be modified")

    if r.tenant_id != tenant.id:
        raise HTTPException(status_code=403, detail="Role not in this tenant")

    if payload.name is not None:
        r.name = payload.name.strip()
    if payload.description is not None:
        r.description = payload.description.strip() if payload.description else None

    db.commit()
    db.refresh(r)

    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "code": r.code,
        "name": r.name,
        "description": r.description,
        "is_system": bool(r.is_system),
    }


@router.delete(
    "/rbac/roles/{role_id}",
    dependencies=[Depends(require_permission("rbac.roles.manage"))],
)
def delete_role(
    role_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    if r.tenant_id is None or r.is_system:
        raise HTTPException(status_code=403, detail="System roles cannot be deleted")

    if r.tenant_id != tenant.id:
        raise HTTPException(status_code=403, detail="Role not in this tenant")

    db.delete(r)
    db.commit()
    return {"ok": True}


@router.put(
    "/rbac/roles/{role_id}/permissions",
    dependencies=[Depends(require_permission("rbac.permissions.manage"))],
)
def set_role_permissions(
    role_id: UUID,
    payload: RolePermissionsSet,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    # allow mapping updates for system roles too (Director can manage mapping? usually no)
    # For safety: only allow mapping update if role is in tenant scope OR user is SUPER_ADMIN.
    # We don't have a direct "is super admin" flag here; permissions already gate.
    # We'll restrict: system roles mapping not editable from tenant to avoid breaking platform.
    if r.tenant_id is None or r.is_system:
        raise HTTPException(status_code=403, detail="System role permissions cannot be changed here")

    if r.tenant_id != tenant.id:
        raise HTTPException(status_code=403, detail="Role not in this tenant")

    # validate permissions
    codes = sorted({c.strip() for c in payload.permission_codes if c and c.strip()})
    if not codes:
        codes = []

    perm_rows = db.execute(select(Permission).where(Permission.code.in_(codes))).scalars().all()
    found_codes = {p.code for p in perm_rows}
    missing = [c for c in codes if c not in found_codes]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown permission codes: {missing}")

    # Replace mapping
    db.execute(sa.delete(RolePermission).where(RolePermission.role_id == r.id))
    for p in perm_rows:
        db.add(RolePermission(role_id=r.id, permission_id=p.id))

    db.commit()
    return {"ok": True, "role_id": str(r.id), "permission_codes": codes}


@router.get(
    "/rbac/users/{user_id}/roles",
    dependencies=[Depends(require_permission("rbac.user_roles.manage"))],
)
def list_user_roles(
    user_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    rows = db.execute(
        select(Role.code, Role.name, UserRole.tenant_id)
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            UserRole.user_id == user_id,
            sa.or_(UserRole.tenant_id.is_(None), UserRole.tenant_id == tenant.id),
        )
    ).all()

    return [
        {
            "role_code": code,
            "role_name": name,
            "scope": "GLOBAL" if tid is None else "TENANT",
        }
        for code, name, tid in rows
    ]


@router.post(
    "/rbac/users/{user_id}/roles",
    dependencies=[Depends(require_permission("rbac.user_roles.manage"))],
)
def assign_user_role(
    user_id: UUID,
    payload: UserRoleAssign,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    role_code = payload.role_code.strip().upper()
    r = _get_role_by_code(db, tenant_id=tenant.id, role_code=role_code)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    # prevent tenant from assigning SUPER_ADMIN globally
    if r.code == "SUPER_ADMIN" and (r.tenant_id is None):
        raise HTTPException(status_code=403, detail="SUPER_ADMIN role can only be managed by SaaS operator")

    # If role is global system role: scope assignment is tenant-scoped (not NULL) unless SUPER_ADMIN
    assign_scope_tenant_id = tenant.id
    if r.tenant_id is None and r.code == "SUPER_ADMIN":
        assign_scope_tenant_id = None

    exists = db.execute(
        select(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role_id == r.id,
            sa.or_(
                (UserRole.tenant_id.is_(None) if assign_scope_tenant_id is None else False),
                UserRole.tenant_id == assign_scope_tenant_id,
            ),
        )
    ).scalar_one_or_none()

    if exists:
        return {"ok": True}  # idempotent

    ur = UserRole(
        id=uuid4(),
        tenant_id=assign_scope_tenant_id,
        user_id=user_id,
        role_id=r.id,
    )
    db.add(ur)
    db.commit()
    return {"ok": True}


@router.delete(
    "/rbac/users/{user_id}/roles/{role_code}",
    dependencies=[Depends(require_permission("rbac.user_roles.manage"))],
)
def remove_user_role(
    user_id: UUID,
    role_code: str,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    code = role_code.strip().upper()
    r = _get_role_by_code(db, tenant_id=tenant.id, role_code=code)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    # Don't allow tenant-admin to touch global SUPER_ADMIN assignment
    if r.code == "SUPER_ADMIN" and r.tenant_id is None:
        raise HTTPException(status_code=403, detail="SUPER_ADMIN role can only be managed by SaaS operator")

    # Remove tenant scoped assignment (even if role is global)
    db.execute(
        sa.delete(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role_id == r.id,
            UserRole.tenant_id == tenant.id,
        )
    )
    db.commit()
    return {"ok": True}


@router.get(
    "/rbac/users/{user_id}/permission-overrides",
    dependencies=[Depends(require_permission("rbac.user_permissions.manage"))],
)
def list_user_permission_overrides(
    user_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    rows = db.execute(
        select(Permission.code, UserPermissionOverride.effect, UserPermissionOverride.reason)
        .select_from(UserPermissionOverride)
        .join(Permission, Permission.id == UserPermissionOverride.permission_id)
        .where(
            UserPermissionOverride.user_id == user_id,
            UserPermissionOverride.tenant_id == tenant.id,
        )
        .order_by(Permission.code.asc())
    ).all()

    return [
        {"permission_code": code, "effect": effect, "reason": reason}
        for code, effect, reason in rows
    ]


@router.put(
    "/rbac/users/{user_id}/permission-overrides",
    dependencies=[Depends(require_permission("rbac.user_permissions.manage"))],
)
def set_user_permission_overrides(
    user_id: UUID,
    payload: UserPermissionOverridesSet,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    # validate codes
    requested = payload.overrides or []
    codes = sorted({o.permission_code.strip() for o in requested if o.permission_code and o.permission_code.strip()})
    perm_rows = db.execute(select(Permission).where(Permission.code.in_(codes))).scalars().all()
    found = {p.code: p for p in perm_rows}
    missing = [c for c in codes if c not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown permission codes: {missing}")

    # Replace tenant-scoped overrides for this user (keeps global overrides intact)
    db.execute(
        sa.delete(UserPermissionOverride).where(
            UserPermissionOverride.user_id == user_id,
            UserPermissionOverride.tenant_id == tenant.id,
        )
    )

    for o in requested:
        code = o.permission_code.strip()
        if code not in found:
            continue
        db.add(
            UserPermissionOverride(
                id=uuid4(),
                tenant_id=tenant.id,
                user_id=user_id,
                permission_id=found[code].id,
                effect=o.effect,
                reason=(o.reason.strip() if o.reason else None),
            )
        )

    db.commit()
    return {"ok": True}
