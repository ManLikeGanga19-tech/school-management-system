from datetime import datetime, timezone
from uuid import uuid4, UUID as UUIDType

from sqlalchemy.orm import Session
from sqlalchemy import select, and_
import sqlalchemy as sa

from app.models.user import User
from app.models.membership import UserTenant
from app.models.auth import AuthSession

from app.utils.hashing import verify_password, hash_password
from app.utils.tokens import create_access_token, create_refresh_token, decode_token

from app.models.rbac import Role, Permission, RolePermission, UserRole, UserPermissionOverride


def _load_roles_permissions(db: Session, tenant_id, user_id) -> tuple[list[str], list[str]]:
    """
    Returns:
      roles: role codes (merged global + tenant roles)
      permissions: effective permission codes after overrides
    """
    # 1) Roles: global (tenant_id is NULL) + tenant-scoped
    role_rows = db.execute(
        select(Role.code)
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            UserRole.user_id == user_id,
            sa.or_(UserRole.tenant_id.is_(None), UserRole.tenant_id == tenant_id),
        )
    ).all()
    role_codes = sorted({r[0] for r in role_rows})

    # 2) Role permissions (from those roles)
    perm_rows = db.execute(
        select(Permission.code)
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .join(RolePermission, RolePermission.role_id == Role.id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(
            UserRole.user_id == user_id,
            sa.or_(UserRole.tenant_id.is_(None), UserRole.tenant_id == tenant_id),
        )
    ).all()
    role_perm_codes = {p[0] for p in perm_rows}

    # 3) Overrides (tenant + global)
    override_rows = db.execute(
        select(Permission.code, UserPermissionOverride.effect)
        .select_from(UserPermissionOverride)
        .join(Permission, Permission.id == UserPermissionOverride.permission_id)
        .where(
            UserPermissionOverride.user_id == user_id,
            sa.or_(UserPermissionOverride.tenant_id.is_(None), UserPermissionOverride.tenant_id == tenant_id),
        )
    ).all()

    allow = {code for code, eff in override_rows if eff == "ALLOW"}
    deny = {code for code, eff in override_rows if eff == "DENY"}

    effective = (role_perm_codes | allow) - deny
    return role_codes, sorted(effective)


def login(db: Session, *, tenant_id, email: str, password: str) -> tuple[str, str]:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or not user.is_active:
        raise ValueError("Invalid credentials")

    if not verify_password(password, user.password_hash):
        raise ValueError("Invalid credentials")

    membership = db.execute(
        select(UserTenant).where(
            and_(
                UserTenant.tenant_id == tenant_id,
                UserTenant.user_id == user.id,
                UserTenant.is_active == True,
            )
        )
    ).scalar_one_or_none()

    if not membership:
        raise ValueError("User not allowed in this school")

    roles, permissions = _load_roles_permissions(db, tenant_id, user.id)

    access = create_access_token(
        sub=str(user.id),
        tenant_id=str(tenant_id),
        roles=roles,
        permissions=permissions,
    )

    session_id = uuid4()
    refresh_token, refresh_exp = create_refresh_token(
        session_id=str(session_id),
        sub=str(user.id),
        tenant_id=str(tenant_id),
    )

    refresh_hash = hash_password(refresh_token)
    db.add(
        AuthSession(
            id=session_id,
            tenant_id=tenant_id,
            user_id=user.id,
            refresh_token_hash=refresh_hash,
            expires_at=refresh_exp,
            revoked_at=None,
            last_used_at=None,
        )
    )
    db.commit()

    return access, refresh_token


def refresh(db: Session, *, tenant_id, refresh_token: str) -> tuple[str, str]:
    payload = decode_token(refresh_token)

    if payload.get("type") != "refresh":
        raise ValueError("Invalid token type")

    if payload.get("tenant_id") != str(tenant_id):
        raise ValueError("Tenant mismatch")

    session_id_raw = payload.get("sid")
    user_id_raw = payload.get("sub")

    if not session_id_raw or not user_id_raw:
        raise ValueError("Invalid refresh token payload")

    #  Normalize to UUID types (prevents uuid/text mismatch bugs)
    try:
        session_id = UUIDType(str(session_id_raw))
        user_id = UUIDType(str(user_id_raw))
    except Exception:
        raise ValueError("Invalid token identifiers")

    session = db.execute(
        select(AuthSession).where(
            and_(
                AuthSession.id == session_id,
                AuthSession.tenant_id == tenant_id,
                AuthSession.user_id == user_id,
            )
        )
    ).scalar_one_or_none()

    if not session:
        raise ValueError("Session not found")

    if session.revoked_at is not None:
        raise ValueError("Session revoked")

    if session.expires_at <= datetime.now(timezone.utc):
        raise ValueError("Session expired")

    if not verify_password(refresh_token, session.refresh_token_hash):
        raise ValueError("Invalid refresh token")

    roles, permissions = _load_roles_permissions(db, tenant_id, user_id)

    new_access = create_access_token(
        sub=str(user_id),
        tenant_id=str(tenant_id),
        roles=roles,
        permissions=permissions,
    )

    # Rotate refresh token
    new_refresh_token, new_exp = create_refresh_token(
        session_id=str(session.id),
        sub=str(user_id),
        tenant_id=str(tenant_id),
    )

    session.refresh_token_hash = hash_password(new_refresh_token)
    session.expires_at = new_exp
    session.last_used_at = datetime.now(timezone.utc)
    db.commit()

    return new_access, new_refresh_token


def logout(db: Session, *, tenant_id, refresh_token: str) -> None:
    payload = decode_token(refresh_token)

    if payload.get("type") != "refresh":
        return

    if payload.get("tenant_id") != str(tenant_id):
        return

    session_id_raw = payload.get("sid")
    if not session_id_raw:
        return

    try:
        session_id = UUIDType(str(session_id_raw))
    except Exception:
        return

    session = db.execute(
        select(AuthSession).where(
            and_(
                AuthSession.id == session_id,
                AuthSession.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()

    if session and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()
