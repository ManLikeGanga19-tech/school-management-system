from __future__ import annotations

from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone
from typing import Any, Optional, List, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from sqlalchemy.orm import Session
from sqlalchemy import select, and_
import sqlalchemy as sa
from sqlalchemy.exc import ProgrammingError, OperationalError

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


# ✅ Tenant classes output schema (for /tenants/classes)
class TenantClassOut(BaseModel):
    id: str
    code: str
    name: str
    is_active: bool = True


class SecretaryUserOut(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    is_active: bool = True


class SecretaryAuditOut(BaseModel):
    id: str
    action: str
    resource: str
    created_at: str


class SecretaryDashboardOut(BaseModel):
    me: dict | None
    summary: dict | None
    enrollments: list[dict]
    invoices: list[dict]
    users: list[SecretaryUserOut]
    audit: list[SecretaryAuditOut]
    health: dict


class DirectorPermissionOut(BaseModel):
    id: str
    code: str
    name: str
    description: Optional[str] = None


class DirectorPermissionOverrideOut(BaseModel):
    user_id: str
    email: str
    full_name: Optional[str] = None
    permission_code: str
    effect: str
    reason: Optional[str] = None


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


def _safe_db_missing_table(err: Exception) -> bool:
    """
    Detect missing table / missing relation in a DB-agnostic-ish way.
    Works for Postgres + psycopg and many common SQLAlchemy configurations.
    """
    msg = str(err).lower()
    return (
        "does not exist" in msg
        or "undefinedtable" in msg
        or "no such table" in msg
        or "relation" in msg and "does not exist" in msg
    )


def _require_any_permission(*codes: str):
    required_codes = tuple(c for c in codes if c and c.strip())

    def _checker(
        request: Request,
        _user=Depends(get_current_user),
    ):
        perms = set(getattr(request.state, "permissions", []) or [])
        if any(code in perms for code in required_codes):
            return

        if not required_codes:
            raise HTTPException(status_code=403, detail="Missing permission")

        raise HTTPException(
            status_code=403,
            detail=f"Missing permission: any of {', '.join(required_codes)}",
        )

    return _checker


def _permission_rows_payload(perms: list[Permission]) -> list[dict]:
    return [
        {
            "id": str(p.id),
            "code": p.code,
            "name": p.name,
            "description": p.description,
        }
        for p in perms
    ]


def _request_permissions(request: Request) -> set[str]:
    raw = getattr(request.state, "permissions", []) or []
    return {str(code) for code in raw if isinstance(code, str)}


def _parse_uuid(value: Any, *, field: str) -> UUID:
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except Exception:
        raise HTTPException(status_code=400, detail=f"{field} must be a valid UUID")


def _parse_decimal(value: Any, *, field: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} must be a valid number")


def _serialize_finance_policy(row: Any) -> dict:
    return {
        "allow_partial_enrollment": bool(getattr(row, "allow_partial_enrollment", False)),
        "min_percent_to_enroll": getattr(row, "min_percent_to_enroll", None),
        "min_amount_to_enroll": (
            str(getattr(row, "min_amount_to_enroll"))
            if getattr(row, "min_amount_to_enroll", None) is not None
            else None
        ),
        "require_interview_fee_before_submit": bool(
            getattr(row, "require_interview_fee_before_submit", True)
        ),
    }


def _serialize_invoice(row: Any) -> dict:
    return {
        "id": str(getattr(row, "id")),
        "invoice_type": str(getattr(row, "invoice_type", "") or ""),
        "status": str(getattr(row, "status", "") or ""),
        "enrollment_id": (
            str(getattr(row, "enrollment_id"))
            if getattr(row, "enrollment_id", None) is not None
            else None
        ),
        "currency": str(getattr(row, "currency", "KES") or "KES"),
        "total_amount": str(getattr(row, "total_amount", 0) or 0),
        "paid_amount": str(getattr(row, "paid_amount", 0) or 0),
        "balance_amount": str(getattr(row, "balance_amount", 0) or 0),
    }


def _serialize_fee_category(row: Any) -> dict:
    return {
        "id": str(getattr(row, "id")),
        "code": str(getattr(row, "code", "") or ""),
        "name": str(getattr(row, "name", "") or ""),
        "is_active": bool(getattr(row, "is_active", True)),
    }


def _serialize_fee_item(row: Any) -> dict:
    return {
        "id": str(getattr(row, "id")),
        "category_id": str(getattr(row, "category_id")),
        "code": str(getattr(row, "code", "") or ""),
        "name": str(getattr(row, "name", "") or ""),
        "is_active": bool(getattr(row, "is_active", True)),
    }


def _serialize_fee_structure(row: Any) -> dict:
    return {
        "id": str(getattr(row, "id")),
        "class_code": str(getattr(row, "class_code", "") or ""),
        "name": str(getattr(row, "name", "") or ""),
        "is_active": bool(getattr(row, "is_active", True)),
    }


def _serialize_structure_item(item: dict[str, Any]) -> dict:
    return {
        "fee_item_id": str(item.get("fee_item_id") or ""),
        "amount": str(item.get("amount") or 0),
        "fee_item_code": str(item.get("fee_item_code") or ""),
        "fee_item_name": str(item.get("fee_item_name") or ""),
        "category_id": str(item.get("category_id") or ""),
        "category_code": str(item.get("category_code") or ""),
        "category_name": str(item.get("category_name") or ""),
    }


def _serialize_scholarship(row: Any) -> dict:
    return {
        "id": str(getattr(row, "id")),
        "name": str(getattr(row, "name", "") or ""),
        "type": str(getattr(row, "type", "") or ""),
        "value": str(getattr(row, "value", 0) or 0),
        "is_active": bool(getattr(row, "is_active", True)),
    }


def _serialize_payment(row: dict[str, Any]) -> dict:
    allocations = row.get("allocations") if isinstance(row, dict) else []
    safe_allocations = allocations if isinstance(allocations, list) else []
    return {
        "id": str(row.get("id") or ""),
        "provider": str(row.get("provider") or ""),
        "reference": (str(row.get("reference")) if row.get("reference") is not None else None),
        "amount": str(row.get("amount") or 0),
        "allocations": [
            {
                "invoice_id": str(a.get("invoice_id") or ""),
                "amount": str(a.get("amount") or 0),
            }
            for a in safe_allocations
            if isinstance(a, dict)
        ],
    }


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
# ✅ Tenant-scoped Classes (used by Secretary Enrollments UI)
# ---------------------------------------------------------------------

@router.get(
    "/classes",
    response_model=list[TenantClassOut],
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def list_tenant_classes(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    include_inactive: bool = Query(default=False),
):
    """
    Returns configured school classes for the current tenant.
    """
    # 1) Try ORM model if present in your project
    try:
        from app.models.tenant_class import TenantClass  # type: ignore

        q = select(TenantClass).where(TenantClass.tenant_id == tenant.id)
        if not include_inactive:
            q = q.where(TenantClass.is_active == True)

        rows = db.execute(q.order_by(TenantClass.code.asc())).scalars().all()
        return [
            TenantClassOut(
                id=str(r.id),
                code=str(r.code),
                name=str(r.name),
                is_active=bool(getattr(r, "is_active", True)),
            )
            for r in rows
        ]

    except Exception:
        # 2) Fallback: raw SQL
        sql = sa.text(
            """
            SELECT id, code, name, COALESCE(is_active, true) AS is_active
            FROM tenant_classes
            WHERE tenant_id = :tenant_id
            """
            + ("" if include_inactive else " AND COALESCE(is_active, true) = true ")
            + " ORDER BY code ASC"
        )
        try:
            rows = db.execute(sql, {"tenant_id": str(tenant.id)}).mappings().all()
        except Exception:
            return []

        if rows is None:
            return []

        return [
            TenantClassOut(
                id=str(r.get("id")),
                code=str(r.get("code") or ""),
                name=str(r.get("name") or ""),
                is_active=bool(r.get("is_active", True)),
            )
            for r in rows
        ]


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

    if payload.director_email and payload.director_password:
        email = payload.director_email.strip().lower()

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
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    t.is_active = False
    t.primary_domain = None

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
    return _permission_rows_payload(perms)


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

    if r.tenant_id is None or r.is_system:
        raise HTTPException(status_code=403, detail="System role permissions cannot be changed here")

    if r.tenant_id != tenant.id:
        raise HTTPException(status_code=403, detail="Role not in this tenant")

    codes = sorted({c.strip() for c in payload.permission_codes if c and c.strip()})

    perm_rows = db.execute(select(Permission).where(Permission.code.in_(codes))).scalars().all()
    found_codes = {p.code for p in perm_rows}
    missing = [c for c in codes if c not in found_codes]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown permission codes: {missing}")

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

    if r.code == "SUPER_ADMIN" and (r.tenant_id is None):
        raise HTTPException(status_code=403, detail="SUPER_ADMIN role can only be managed by SaaS operator")

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
        return {"ok": True}

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

    if r.code == "SUPER_ADMIN" and r.tenant_id is None:
        raise HTTPException(status_code=403, detail="SUPER_ADMIN role can only be managed by SaaS operator")

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

    requested = payload.overrides or []
    codes = sorted({o.permission_code.strip() for o in requested if o.permission_code and o.permission_code.strip()})
    perm_rows = db.execute(select(Permission).where(Permission.code.in_(codes))).scalars().all()
    found = {p.code: p for p in perm_rows}
    missing = [c for c in codes if c not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown permission codes: {missing}")

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


# ---------------------------------------------------------------------
# Secretary endpoints (tenant-safe)
# ---------------------------------------------------------------------

@router.get(
    "/secretary/users",
    response_model=list[SecretaryUserOut],
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def secretary_users(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """
    Tenant-scoped user list for secretary dashboard.
    """
    rows = db.execute(
        select(User.id, User.email, User.full_name, User.is_active)
        .select_from(UserTenant)
        .join(User, User.id == UserTenant.user_id)
        .where(
            UserTenant.tenant_id == tenant.id,
            UserTenant.is_active == True,
        )
        .order_by(User.created_at.desc() if hasattr(User, "created_at") else User.email.asc())
        .limit(limit)
        .offset(offset)
    ).all()

    return [
        SecretaryUserOut(
            id=str(r[0]),
            email=str(r[1]),
            full_name=(str(r[2]) if r[2] is not None else None),
            is_active=bool(r[3]) if r[3] is not None else True,
        )
        for r in rows
    ]


@router.get(
    "/secretary/audit",
    response_model=list[SecretaryAuditOut],
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def secretary_audit(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """
    Tenant-scoped audit list for secretary dashboard.

    ✅ Canonical source of truth:
    - AuditMiddleware calls app.core.audit.log_event
    - log_event writes to app.models.audit_log.AuditLog

    So we read from AuditLog directly.
    """
    try:
        from app.models.audit_log import AuditLog  # canonical model used by log_event
    except Exception:
        return []

    try:
        q = (
            select(AuditLog)
            .where(AuditLog.tenant_id == tenant.id)
            .order_by(AuditLog.created_at.desc())
            .limit(int(limit))
            .offset(int(offset))
        )
        logs = db.execute(q).scalars().all()
    except (ProgrammingError, OperationalError) as e:
        # Missing relation/table/migration not run → do NOT break dashboards
        if _safe_db_missing_table(e):
            return []
        return []
    except Exception as e:
        if _safe_db_missing_table(e):
            return []
        return []

    return [
        SecretaryAuditOut(
            id=str(getattr(l, "id")),
            action=str(getattr(l, "action", "") or ""),
            resource=str(getattr(l, "resource", "") or ""),
            created_at=(
                getattr(l, "created_at").isoformat()
                if getattr(l, "created_at", None)
                else ""
            ),
        )
        for l in logs
    ]


# ---------------------------------------------------------------------
# Secretary finance compatibility endpoints (tenant-safe)
# ---------------------------------------------------------------------

@router.get(
    "/secretary/finance",
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.policy.view",
                "finance.fees.view",
                "finance.invoices.view",
                "finance.payments.view",
                "finance.scholarships.view",
                "enrollment.manage",
            )
        )
    ],
)
def secretary_finance(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    from app.api.v1.finance import service as finance_service

    perms = _request_permissions(request)

    policy: dict | None = None
    invoices: list[dict] = []
    fee_categories: list[dict] = []
    fee_items: list[dict] = []
    fee_structures: list[dict] = []
    fee_structure_items: dict[str, list[dict]] = {}
    scholarships: list[dict] = []
    enrollments: list[dict] = []
    payments: list[dict] = []

    health = {
        "policy": False,
        "invoices": False,
        "fee_categories": False,
        "fee_items": False,
        "fee_structures": False,
        "fee_structure_items": False,
        "scholarships": False,
        "enrollments": False,
        "payments": False,
    }

    if "finance.policy.view" in perms:
        try:
            row = finance_service.get_or_create_policy(db, tenant_id=tenant.id)
            db.commit()
            policy = _serialize_finance_policy(row)
            health["policy"] = True
        except Exception:
            policy = None

    if "finance.invoices.view" in perms:
        try:
            rows = finance_service.list_invoices(db, tenant_id=tenant.id)
            invoices = [_serialize_invoice(r) for r in rows]
            health["invoices"] = True
        except Exception:
            invoices = []

    if "finance.fees.view" in perms:
        try:
            rows = finance_service.list_fee_categories(db, tenant_id=tenant.id)
            fee_categories = [_serialize_fee_category(r) for r in rows]
            health["fee_categories"] = True
        except Exception:
            fee_categories = []

        try:
            rows = finance_service.list_fee_items(db, tenant_id=tenant.id)
            fee_items = [_serialize_fee_item(r) for r in rows]
            health["fee_items"] = True
        except Exception:
            fee_items = []

        structure_rows: list[Any] = []
        try:
            structure_rows = finance_service.list_fee_structures(db, tenant_id=tenant.id)
            fee_structures = [_serialize_fee_structure(r) for r in structure_rows]
            health["fee_structures"] = True
        except Exception:
            fee_structures = []
            structure_rows = []

        if health["fee_structures"]:
            items_ok = True
            for structure in structure_rows:
                sid = str(getattr(structure, "id"))
                try:
                    _, items = finance_service.get_structure_with_items(
                        db,
                        tenant_id=tenant.id,
                        structure_id=getattr(structure, "id"),
                    )
                    fee_structure_items[sid] = [_serialize_structure_item(i) for i in items]
                except Exception:
                    items_ok = False
                    fee_structure_items[sid] = []
            health["fee_structure_items"] = items_ok

    if "finance.scholarships.view" in perms:
        try:
            rows = finance_service.list_scholarships(db, tenant_id=tenant.id)
            scholarships = [_serialize_scholarship(r) for r in rows]
            health["scholarships"] = True
        except Exception:
            scholarships = []

    if "enrollment.manage" in perms:
        try:
            from app.models.enrollment import Enrollment  # type: ignore

            rows = db.execute(
                select(Enrollment)
                .where(Enrollment.tenant_id == tenant.id)
                .order_by(Enrollment.created_at.desc())
            ).scalars().all()
            enrollments = [
                {
                    "id": str(getattr(r, "id")),
                    "status": str(getattr(r, "status", "") or ""),
                    "payload": getattr(r, "payload", None),
                }
                for r in rows
            ]
            health["enrollments"] = True
        except Exception:
            enrollments = []

    if "finance.payments.view" in perms:
        try:
            rows = finance_service.list_payments(db, tenant_id=tenant.id)
            payments = [_serialize_payment(r) for r in rows if isinstance(r, dict)]
            health["payments"] = True
        except Exception:
            payments = []

    return {
        "policy": policy,
        "invoices": invoices,
        "fee_categories": fee_categories,
        "fee_items": fee_items,
        "fee_structures": fee_structures,
        "fee_structure_items": fee_structure_items,
        "scholarships": scholarships,
        "enrollments": enrollments,
        "payments": payments,
        "health": health,
    }


@router.post(
    "/secretary/finance",
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.policy.manage",
                "finance.fees.manage",
                "finance.invoices.manage",
                "finance.payments.manage",
                "finance.scholarships.manage",
            )
        )
    ],
)
def secretary_finance_action(
    body: dict,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    from app.api.v1.finance import service as finance_service

    action = str((body or {}).get("action") or "").strip()
    payload = (body or {}).get("payload")
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    required_permissions = {
        "create_invoice": "finance.invoices.manage",
        "generate_fees_invoice": "finance.invoices.manage",
        "record_payment": "finance.payments.manage",
        "update_policy": "finance.policy.manage",
        "create_fee_category": "finance.fees.manage",
        "create_fee_item": "finance.fees.manage",
        "create_fee_structure": "finance.fees.manage",
        "update_fee_structure": "finance.fees.manage",
        "delete_fee_structure": "finance.fees.manage",
        "add_structure_item": "finance.fees.manage",
        "remove_structure_item": "finance.fees.manage",
        "upsert_structure_items": "finance.fees.manage",
        "create_scholarship": "finance.scholarships.manage",
    }

    if action not in required_permissions:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid action. Use "
                "create_invoice|generate_fees_invoice|record_payment|update_policy|"
                "create_fee_category|create_fee_item|create_fee_structure|"
                "update_fee_structure|delete_fee_structure|add_structure_item|"
                "remove_structure_item|upsert_structure_items|create_scholarship"
            ),
        )

    perms = _request_permissions(request)
    needed = required_permissions[action]
    if needed not in perms:
        raise HTTPException(status_code=403, detail=f"Missing permission: {needed}")

    try:
        data: Any

        if action == "create_invoice":
            invoice_type = str(payload.get("invoice_type") or "").strip()
            enrollment_id = _parse_uuid(payload.get("enrollment_id"), field="payload.enrollment_id")
            lines_raw = payload.get("lines")
            if not isinstance(lines_raw, list) or len(lines_raw) == 0:
                raise HTTPException(status_code=400, detail="payload.lines is required")

            lines: list[dict[str, Any]] = []
            for idx, line in enumerate(lines_raw):
                if not isinstance(line, dict):
                    raise HTTPException(
                        status_code=400,
                        detail=f"payload.lines[{idx}] must be an object",
                    )
                description = str(line.get("description") or "").strip()
                if not description:
                    raise HTTPException(
                        status_code=400,
                        detail=f"payload.lines[{idx}].description is required",
                    )
                lines.append(
                    {
                        "description": description,
                        "amount": _parse_decimal(
                            line.get("amount"),
                            field=f"payload.lines[{idx}].amount",
                        ),
                        "meta": line.get("meta"),
                    }
                )

            row = finance_service.create_invoice(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                invoice_type=invoice_type,
                enrollment_id=enrollment_id,
                lines=lines,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_invoice(row)

        elif action == "generate_fees_invoice":
            enrollment_id = _parse_uuid(payload.get("enrollment_id"), field="payload.enrollment_id")
            class_code = str(payload.get("class_code") or "").strip()
            if not class_code:
                raise HTTPException(status_code=400, detail="payload.class_code is required")

            scholarship_raw = payload.get("scholarship_id")
            scholarship_id = None
            if scholarship_raw not in (None, ""):
                scholarship_id = _parse_uuid(
                    scholarship_raw,
                    field="payload.scholarship_id",
                )

            row = finance_service.generate_school_fees_invoice_from_structure(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                enrollment_id=enrollment_id,
                class_code=class_code,
                scholarship_id=scholarship_id,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_invoice(row)

        elif action == "record_payment":
            provider = str(payload.get("provider") or "").strip()
            amount = _parse_decimal(payload.get("amount"), field="payload.amount")
            reference_raw = payload.get("reference")
            reference = str(reference_raw).strip() if reference_raw not in (None, "") else None

            allocations_raw = payload.get("allocations")
            if not isinstance(allocations_raw, list) or len(allocations_raw) == 0:
                raise HTTPException(status_code=400, detail="payload.allocations is required")

            allocations: list[dict[str, Any]] = []
            for idx, row in enumerate(allocations_raw):
                if not isinstance(row, dict):
                    raise HTTPException(
                        status_code=400,
                        detail=f"payload.allocations[{idx}] must be an object",
                    )
                allocations.append(
                    {
                        "invoice_id": _parse_uuid(
                            row.get("invoice_id"),
                            field=f"payload.allocations[{idx}].invoice_id",
                        ),
                        "amount": _parse_decimal(
                            row.get("amount"),
                            field=f"payload.allocations[{idx}].amount",
                        ),
                    }
                )

            payment = finance_service.create_payment(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                provider=provider,
                reference=reference,
                amount=amount,
                allocations=allocations,
            )
            db.commit()
            db.refresh(payment)
            data = {
                "id": str(payment.id),
                "provider": str(payment.provider),
                "reference": payment.reference,
                "amount": str(payment.amount),
            }

        elif action == "update_policy":
            row = finance_service.upsert_policy(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                data=payload,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_finance_policy(row)

        elif action == "create_fee_category":
            row = finance_service.create_fee_category(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                code=str(payload.get("code") or ""),
                name=str(payload.get("name") or ""),
                is_active=bool(payload.get("is_active", True)),
            )
            db.commit()
            db.refresh(row)
            data = _serialize_fee_category(row)

        elif action == "create_fee_item":
            row = finance_service.create_fee_item(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                category_id=_parse_uuid(payload.get("category_id"), field="payload.category_id"),
                code=str(payload.get("code") or ""),
                name=str(payload.get("name") or ""),
                is_active=bool(payload.get("is_active", True)),
            )
            db.commit()
            db.refresh(row)
            data = _serialize_fee_item(row)

        elif action == "create_fee_structure":
            row = finance_service.create_fee_structure(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                class_code=str(payload.get("class_code") or ""),
                name=str(payload.get("name") or ""),
                is_active=bool(payload.get("is_active", True)),
            )
            db.commit()
            db.refresh(row)
            data = _serialize_fee_structure(row)

        elif action == "update_fee_structure":
            structure_id = _parse_uuid(payload.get("structure_id"), field="payload.structure_id")
            updates = payload.get("updates")
            if not isinstance(updates, dict):
                raise HTTPException(status_code=400, detail="payload.updates is required")
            row = finance_service.update_fee_structure(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                structure_id=structure_id,
                updates=updates,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_fee_structure(row)

        elif action == "delete_fee_structure":
            structure_id = _parse_uuid(payload.get("structure_id"), field="payload.structure_id")
            finance_service.delete_fee_structure(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                structure_id=structure_id,
            )
            db.commit()
            data = {"ok": True}

        elif action == "add_structure_item":
            structure_id = _parse_uuid(payload.get("structure_id"), field="payload.structure_id")
            item = payload.get("item")
            if not isinstance(item, dict):
                raise HTTPException(status_code=400, detail="payload.item is required")

            normalized_item = dict(item)
            if normalized_item.get("fee_item_id") not in (None, ""):
                normalized_item["fee_item_id"] = _parse_uuid(
                    normalized_item.get("fee_item_id"),
                    field="payload.item.fee_item_id",
                )
            if isinstance(normalized_item.get("fee_item"), dict):
                fee_item_payload = dict(normalized_item["fee_item"])
                fee_item_payload["category_id"] = _parse_uuid(
                    fee_item_payload.get("category_id"),
                    field="payload.item.fee_item.category_id",
                )
                normalized_item["fee_item"] = fee_item_payload

            normalized_item["amount"] = _parse_decimal(
                normalized_item.get("amount"),
                field="payload.item.amount",
            )

            row = finance_service.add_or_update_structure_item(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                structure_id=structure_id,
                item=normalized_item,
            )
            db.commit()
            data = _serialize_structure_item(row)

        elif action == "remove_structure_item":
            structure_id = _parse_uuid(payload.get("structure_id"), field="payload.structure_id")
            fee_item_id = _parse_uuid(payload.get("fee_item_id"), field="payload.fee_item_id")
            finance_service.remove_structure_item(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                structure_id=structure_id,
                fee_item_id=fee_item_id,
            )
            db.commit()
            data = {"ok": True}

        elif action == "upsert_structure_items":
            structure_id = _parse_uuid(payload.get("structure_id"), field="payload.structure_id")
            items_raw = payload.get("items")
            if not isinstance(items_raw, list):
                raise HTTPException(status_code=400, detail="payload.items must be an array")

            items: list[dict[str, Any]] = []
            for idx, item in enumerate(items_raw):
                if not isinstance(item, dict):
                    raise HTTPException(
                        status_code=400,
                        detail=f"payload.items[{idx}] must be an object",
                    )
                items.append(
                    {
                        "fee_item_id": _parse_uuid(
                            item.get("fee_item_id"),
                            field=f"payload.items[{idx}].fee_item_id",
                        ),
                        "amount": _parse_decimal(
                            item.get("amount"),
                            field=f"payload.items[{idx}].amount",
                        ),
                    }
                )

            finance_service.upsert_fee_structure_items(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                structure_id=structure_id,
                items=items,
            )
            db.commit()
            data = {"ok": True}

        else:
            row = finance_service.create_scholarship(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                name=str(payload.get("name") or ""),
                type_=str(payload.get("type") or ""),
                value=_parse_decimal(payload.get("value"), field="payload.value"),
                is_active=bool(payload.get("is_active", True)),
            )
            db.commit()
            db.refresh(row)
            data = _serialize_scholarship(row)

        return {"ok": True, "data": data}

    except HTTPException:
        db.rollback()
        raise
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Finance action failed")


# ---------------------------------------------------------------------
# Director endpoints (tenant-safe)
# ---------------------------------------------------------------------

@router.get(
    "/director/finance",
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.policy.view",
                "finance.fees.view",
                "finance.invoices.view",
                "finance.payments.view",
                "finance.scholarships.view",
            )
        )
    ],
)
def director_finance(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    return secretary_finance(request=request, db=db, tenant=tenant, _user=_user)


@router.put(
    "/director/finance/policy",
    dependencies=[Depends(require_permission("finance.policy.manage"))],
)
def director_finance_policy_update(
    payload: dict,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    from app.api.v1.finance import service as finance_service

    row = finance_service.upsert_policy(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        data=payload,
    )
    db.commit()
    db.refresh(row)
    return _serialize_finance_policy(row)


@router.get(
    "/director/users",
    response_model=list[SecretaryUserOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def director_users(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    return secretary_users(db=db, tenant=tenant, _user=_user, limit=limit, offset=offset)


@router.get(
    "/director/audit",
    response_model=list[SecretaryAuditOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "audit.read"))],
)
def director_audit(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    try:
        return secretary_audit(db=db, tenant=tenant, _user=_user, limit=limit, offset=offset)
    except Exception:
        # Director dashboard must not fail if audit logging is unavailable.
        return []


@router.get(
    "/director/rbac/permissions",
    response_model=list[DirectorPermissionOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "rbac.permissions.manage"))],
)
def director_rbac_permissions(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    # Tenant dependency is required for context isolation, even though permissions are global.
    _ = tenant
    perms = db.execute(select(Permission).order_by(Permission.code.asc())).scalars().all()
    return _permission_rows_payload(perms)


@router.get(
    "/director/rbac/overrides",
    response_model=list[DirectorPermissionOverrideOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "rbac.user_permissions.manage"))],
)
def director_rbac_overrides(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    rows = db.execute(
        select(
            UserPermissionOverride.user_id,
            User.email,
            User.full_name,
            Permission.code,
            UserPermissionOverride.effect,
            UserPermissionOverride.reason,
        )
        .select_from(UserPermissionOverride)
        .join(Permission, Permission.id == UserPermissionOverride.permission_id)
        .join(User, User.id == UserPermissionOverride.user_id)
        .join(
            UserTenant,
            and_(
                UserTenant.tenant_id == tenant.id,
                UserTenant.user_id == UserPermissionOverride.user_id,
                UserTenant.is_active == True,
            ),
        )
        .where(UserPermissionOverride.tenant_id == tenant.id)
        .order_by(
            UserPermissionOverride.created_at.desc(),
            User.email.asc(),
            Permission.code.asc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()

    return [
        DirectorPermissionOverrideOut(
            user_id=str(r[0]),
            email=str(r[1]),
            full_name=(str(r[2]) if r[2] is not None else None),
            permission_code=str(r[3]),
            effect=str(r[4]),
            reason=(str(r[5]) if r[5] is not None else None),
        )
        for r in rows
    ]


@router.post(
    "/director/rbac/overrides",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "rbac.user_permissions.manage"))],
)
def director_rbac_override_upsert(
    payload: dict,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    user_id = _parse_uuid(payload.get("user_id"), field="payload.user_id")
    permission_code = str(payload.get("permission_code") or "").strip()
    effect = str(payload.get("effect") or "").upper().strip()
    reason_raw = payload.get("reason")
    reason = str(reason_raw).strip() if reason_raw not in (None, "") else None

    if not permission_code:
        raise HTTPException(status_code=400, detail="payload.permission_code is required")
    if effect not in {"ALLOW", "DENY"}:
        raise HTTPException(status_code=400, detail="payload.effect must be ALLOW or DENY")

    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    permission = db.execute(
        select(Permission).where(Permission.code == permission_code)
    ).scalar_one_or_none()
    if not permission:
        raise HTTPException(status_code=404, detail="Permission not found")

    row = db.execute(
        select(UserPermissionOverride).where(
            UserPermissionOverride.tenant_id == tenant.id,
            UserPermissionOverride.user_id == user_id,
            UserPermissionOverride.permission_id == permission.id,
        )
    ).scalar_one_or_none()

    if row:
        row.effect = effect
        row.reason = reason
    else:
        db.add(
            UserPermissionOverride(
                id=uuid4(),
                tenant_id=tenant.id,
                user_id=user_id,
                permission_id=permission.id,
                effect=effect,
                reason=reason,
            )
        )

    db.commit()
    return {"ok": True}


@router.delete(
    "/director/rbac/overrides",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "rbac.user_permissions.manage"))],
)
def director_rbac_override_delete(
    payload: dict,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    user_id = _parse_uuid(payload.get("user_id"), field="payload.user_id")
    permission_code = str(payload.get("permission_code") or "").strip()
    if not permission_code:
        raise HTTPException(status_code=400, detail="payload.permission_code is required")

    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    permission = db.execute(
        select(Permission).where(Permission.code == permission_code)
    ).scalar_one_or_none()
    if not permission:
        raise HTTPException(status_code=404, detail="Permission not found")

    db.execute(
        sa.delete(UserPermissionOverride).where(
            UserPermissionOverride.tenant_id == tenant.id,
            UserPermissionOverride.user_id == user_id,
            UserPermissionOverride.permission_id == permission.id,
        )
    )
    db.commit()
    return {"ok": True}


@router.get(
    "/secretary/dashboard",
    response_model=SecretaryDashboardOut,
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def secretary_dashboard(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """
    Secretary dashboard aggregate endpoint.
    """
    me = {
        "tenant": {"slug": tenant.slug, "name": tenant.name},
        "roles": (getattr(user, "roles", None) or []),
    }

    users = secretary_users(db=db, tenant=tenant, _user=user, limit=100, offset=0)

    try:
        audit = secretary_audit(db=db, tenant=tenant, _user=user, limit=8, offset=0)
    except Exception:
        audit = []

    enrollments: list[dict] = []
    invoices: list[dict] = []

    # Best-effort enrollments
    try:
        from app.models.enrollment import Enrollment  # type: ignore

        ers = db.execute(
            select(Enrollment)
            .where(Enrollment.tenant_id == tenant.id)
            .order_by(Enrollment.created_at.desc())
            .limit(8)
        ).scalars().all()

        enrollments = [
            {
                "id": str(e.id),
                "status": str(getattr(e, "status", "")),
                "payload": getattr(e, "payload", None),
            }
            for e in ers
        ]
    except Exception:
        enrollments = []

    # Best-effort invoices
    try:
        from app.models.finance import Invoice  # type: ignore

        invs = db.execute(
            select(Invoice)
            .where(Invoice.tenant_id == tenant.id)
            .order_by(Invoice.created_at.desc())
            .limit(10)
        ).scalars().all()

        invoices = [
            {
                "id": str(i.id),
                "invoice_type": str(getattr(i, "invoice_type", "")),
                "status": str(getattr(i, "status", "")),
                "total_amount": getattr(i, "total_amount", 0),
                "paid_amount": getattr(i, "paid_amount", 0),
                "balance_amount": getattr(i, "balance_amount", 0),
            }
            for i in invs
        ]
    except Exception:
        invoices = []

    summary = {
        "total_users": len(users),
        "total_roles": 0,
        "total_audit_logs": len(audit),
    }

    health = {"api": True}

    return SecretaryDashboardOut(
        me=me,
        summary=summary,
        enrollments=enrollments,
        invoices=invoices,
        users=users,
        audit=audit,
        health=health,
    )
