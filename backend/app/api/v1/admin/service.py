from sqlalchemy.orm import Session
from sqlalchemy import select, func
from uuid import uuid4

from app.models.tenant import Tenant
from app.models.user import User
from app.models.membership import UserTenant
from app.models.rbac import Role, UserRole, Permission, UserPermissionOverride
from app.models.audit_log import AuditLog


# -------------------------
# SaaS Summary
# -------------------------

def get_saas_summary(db: Session):
    total = db.scalar(select(func.count()).select_from(Tenant))
    active = db.scalar(select(func.count()).select_from(Tenant).where(Tenant.is_active == True))
    inactive = total - active

    return {
        "total_tenants": total,
        "active_tenants": active,
        "inactive_tenants": inactive,
    }


# -------------------------
# Tenant Dashboard
# -------------------------

def get_tenant_dashboard(db: Session, tenant_id):
    total_users = db.scalar(
        select(func.count())
        .select_from(UserTenant)
        .where(UserTenant.tenant_id == tenant_id)
    )

    total_roles = db.scalar(
        select(func.count())
        .select_from(UserRole)
        .where(UserRole.tenant_id == tenant_id)
    )

    total_audit = db.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(AuditLog.tenant_id == tenant_id)
    )

    return {
        "total_users": total_users,
        "total_roles": total_roles,
        "total_audit_logs": total_audit,
    }


# -------------------------
# Update Tenant
# -------------------------

def update_tenant(db: Session, tenant_id, data):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        return None

    for field, value in data.items():
        if value is not None:
            setattr(tenant, field, value)

    db.commit()
    db.refresh(tenant)
    return tenant


# -------------------------
# List Users (Tenant)
# -------------------------

def list_users(db: Session, tenant_id):
    users = db.execute(
        select(User)
        .join(UserTenant, UserTenant.user_id == User.id)
        .where(UserTenant.tenant_id == tenant_id)
    ).scalars().all()

    return users


# -------------------------
# Assign Role
# -------------------------

def assign_role(db: Session, tenant_id, user_id, role_code):
    role = db.execute(
        select(Role).where(
            Role.code == role_code,
            Role.tenant_id.is_(None)
        )
    ).scalar_one_or_none()

    if not role:
        raise ValueError("Role not found")

    exists = db.execute(
        select(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role_id == role.id,
            UserRole.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()

    if exists:
        return

    db.add(UserRole(
        id=uuid4(),
        tenant_id=tenant_id,
        user_id=user_id,
        role_id=role.id,
    ))
    db.commit()


# -------------------------
# Permission Override
# -------------------------

def set_permission_override(db: Session, tenant_id, user_id, permission_code, effect):
    perm = db.execute(
        select(Permission).where(Permission.code == permission_code)
    ).scalar_one_or_none()

    if not perm:
        raise ValueError("Permission not found")

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
        db.add(UserPermissionOverride(
            id=uuid4(),
            tenant_id=tenant_id,
            user_id=user_id,
            permission_id=perm.id,
            effect=effect,
        ))

    db.commit()
