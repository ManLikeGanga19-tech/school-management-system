"""
Shared helper functions for the SMS backend test suite.

These are plain functions (not pytest fixtures) — import them directly in test
modules.  Fixtures that use these helpers are defined in conftest.py.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.core.dependencies import SAAS_TENANT_MARKER
from app.models.membership import UserTenant
from app.models.rbac import Permission, Role, RolePermission, UserPermissionOverride, UserRole
from app.models.tenant import Tenant
from app.models.user import User
from app.utils.hashing import hash_password
from app.utils.tokens import create_access_token

# ── Tenant ────────────────────────────────────────────────────────────────────

def create_tenant(
    db: Session,
    *,
    slug: str = "test-school",
    name: str = "Test School",
    domain: str | None = None,
    is_active: bool = True,
) -> Tenant:
    tenant = Tenant(
        id=uuid4(),
        slug=slug,
        name=name,
        primary_domain=domain or f"{slug}.example.com",
        is_active=is_active,
    )
    db.add(tenant)
    db.commit()
    return tenant


# ── Users ─────────────────────────────────────────────────────────────────────

def create_user(
    db: Session,
    *,
    email: str = "user@example.com",
    password: str = "Test1234!",
    full_name: str = "Test User",
    is_active: bool = True,
) -> User:
    user = User(
        id=uuid4(),
        email=email,
        password_hash=hash_password(password),
        full_name=full_name,
        is_active=is_active,
    )
    db.add(user)
    db.flush()
    return user


def create_super_admin_user(db: Session, email: str = "admin@example.com") -> User:
    user = User(
        id=uuid4(),
        email=email,
        password_hash=hash_password("Admin1234!"),
        full_name="Super Admin",
        is_active=True,
    )
    db.add(user)
    db.flush()

    role = Role(
        id=uuid4(),
        code="SUPER_ADMIN",
        name="Super Admin",
        tenant_id=None,
        is_system=True,
    )
    db.add(role)
    db.flush()

    db.add(UserRole(id=uuid4(), user_id=user.id, role_id=role.id, tenant_id=None))
    db.commit()
    return user


# ── RBAC ──────────────────────────────────────────────────────────────────────

def create_role(
    db: Session,
    code: str,
    *,
    name: str | None = None,
    tenant_id: UUID | None = None,
    is_system: bool = False,
) -> Role:
    role = Role(
        id=uuid4(),
        code=code,
        name=name or code.replace("_", " ").title(),
        tenant_id=tenant_id,
        is_system=is_system,
    )
    db.add(role)
    db.flush()
    return role


def create_permission(db: Session, code: str, *, name: str | None = None) -> Permission:
    perm = Permission(
        id=uuid4(),
        code=code,
        name=name or code.replace(".", " ").replace("_", " ").title(),
    )
    db.add(perm)
    db.flush()
    return perm


def assign_permission_to_role(db: Session, role: Role, permission: Permission) -> None:
    db.add(RolePermission(role_id=role.id, permission_id=permission.id))
    db.flush()


# ── Tenant users ──────────────────────────────────────────────────────────────

def create_tenant_user(
    db: Session,
    *,
    tenant: Tenant,
    email: str,
    password: str = "Test1234!",
    full_name: str = "Tenant User",
    role: Role | None = None,
    is_active: bool = True,
) -> User:
    user = User(
        id=uuid4(),
        email=email,
        password_hash=hash_password(password),
        full_name=full_name,
        is_active=is_active,
    )
    db.add(user)
    db.flush()

    db.add(UserTenant(id=uuid4(), tenant_id=tenant.id, user_id=user.id, is_active=is_active))

    if role is not None:
        db.add(UserRole(id=uuid4(), user_id=user.id, role_id=role.id, tenant_id=tenant.id))

    db.flush()
    return user


def make_actor(
    db: Session,
    *,
    tenant: Tenant,
    permissions: list[str],
    email: str | None = None,
    role_code: str = "TEST_ROLE",
) -> tuple[User, dict[str, str]]:
    """
    Create a tenant user that has exactly the given permissions and return
    both the User and the request headers needed to call tenant endpoints.

    Each call creates a fresh role with a unique code to avoid DB uniqueness
    conflicts when called multiple times within the same test.
    """
    unique_code = f"{role_code}_{uuid4().hex[:8]}"
    role = Role(
        id=uuid4(),
        code=unique_code,
        name=unique_code,
        tenant_id=tenant.id,
        is_system=False,
    )
    db.add(role)
    db.flush()

    for perm_code in dict.fromkeys(permissions):  # deduplicate while preserving order
        # Reuse existing permission or create a new one.
        from sqlalchemy import select
        from app.models.rbac import Permission as Perm
        existing = db.execute(
            select(Perm).where(Perm.code == perm_code)
        ).scalar_one_or_none()
        if existing is None:
            existing = Permission(id=uuid4(), code=perm_code, name=perm_code)
            db.add(existing)
            db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=existing.id))
        db.flush()

    user = create_tenant_user(
        db,
        tenant=tenant,
        email=email or f"{uuid4().hex[:8]}@test.com",
        role=role,
    )
    db.commit()

    token = create_access_token(
        subject=str(user.id),
        tenant_id=str(tenant.id),
        roles=[unique_code],
        permissions=permissions,
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Tenant-ID": str(tenant.id),
    }
    return user, headers


# ── Token helpers ─────────────────────────────────────────────────────────────

def get_saas_token(user: User) -> str:
    return create_access_token(
        subject=str(user.id),
        tenant_id=SAAS_TENANT_MARKER,
        roles=["SUPER_ADMIN"],
        permissions=[
            "tenants.read_all", "tenants.create", "subscriptions.read",
            "subscriptions.manage", "admin.dashboard.view_all",
            "rbac.permissions.manage",
        ],
    )


def get_saas_token_with_claims(
    user: User,
    *,
    roles: list[str] | None = None,
    permissions: list[str] | None = None,
) -> str:
    return create_access_token(
        subject=str(user.id),
        tenant_id=SAAS_TENANT_MARKER,
        roles=roles or [],
        permissions=permissions or [],
    )


def get_tenant_token(
    user: User,
    tenant: Tenant,
    *,
    roles: list[str] | None = None,
    permissions: list[str] | None = None,
) -> str:
    return create_access_token(
        subject=str(user.id),
        tenant_id=str(tenant.id),
        roles=roles or [],
        permissions=permissions or [],
    )


def saas_headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {get_saas_token(user)}"}


def tenant_headers(user: User, tenant: Tenant, *, roles=None, permissions=None) -> dict[str, str]:
    token = get_tenant_token(user, tenant, roles=roles, permissions=permissions)
    return {
        "Authorization": f"Bearer {token}",
        "X-Tenant-ID": str(tenant.id),
    }
