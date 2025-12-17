from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy.orm import Session
from sqlalchemy import select, and_

from app.models.user import User
from app.models.membership import UserTenant
from app.models.auth import AuthSession
from app.utils.hashing import verify_password, hash_password
from app.utils.tokens import create_access_token, create_refresh_token, decode_token

# NOTE: RBAC permissions/roles will be loaded from DB in the next step.
# For now we’ll read them from DB once you add RBAC query helpers.
# To unblock you immediately, we’ll return roles/permissions as empty lists,
# then we’ll upgrade to real RBAC loading next.


def _load_roles_permissions(db: Session, tenant_id, user_id) -> tuple[list[str], list[str]]:
    # TODO: implement DB lookup from core.user_roles -> core.roles + core.role_permissions -> core.permissions
    return [], []


def login(db: Session, *, tenant_id, email: str, password: str) -> tuple[str, str]:
    user = db.execute(select(User).where(
        User.email == email)).scalar_one_or_none()
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
    db.add(AuthSession(
        id=session_id,
        tenant_id=tenant_id,
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        expires_at=refresh_exp,
        revoked_at=None,
        last_used_at=None,
    ))
    db.commit()

    return access, refresh_token


def refresh(db: Session, *, tenant_id, refresh_token: str) -> tuple[str, str]:
    payload = decode_token(refresh_token)
    if payload.get("type") != "refresh":
        raise ValueError("Invalid token type")

    if payload.get("tenant_id") != str(tenant_id):
        raise ValueError("Tenant mismatch")

    session_id = payload.get("sid")
    user_id = payload.get("sub")

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

    # Verify refresh token against stored hash
    if not verify_password(refresh_token, session.refresh_token_hash):
        raise ValueError("Invalid refresh token")

    roles, permissions = _load_roles_permissions(db, tenant_id, user_id)

    new_access = create_access_token(
        sub=str(user_id),
        tenant_id=str(tenant_id),
        roles=roles,
        permissions=permissions,
    )

    # Rotate refresh token (best practice)
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

    session_id = payload.get("sid")
    session = db.execute(
        select(AuthSession).where(
            and_(AuthSession.id == session_id,
                 AuthSession.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()

    if session and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()
