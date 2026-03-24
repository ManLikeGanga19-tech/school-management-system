# app/core/dependencies.py

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from jose import JWTError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.v1.auth.service import _load_roles_permissions
from app.core.database import get_db
from app.core.session_cache import (
    blacklist_token,
    cache_session,
    get_cached_session,
    invalidate_session,
    is_blacklisted,
)
from app.models.user import User
from app.utils.tokens import decode_token

SAAS_TENANT_MARKER = "__saas__"


# -----------------------------
# Tenant Context
# -----------------------------
def get_tenant(request: Request):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context missing")
    return tenant


# -----------------------------
# Shared: Bearer parsing + token decode
# -----------------------------
def _read_bearer_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token")
    return auth.split(" ", 1)[1].strip()


def _decode_access_token(token: str) -> dict:
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    return payload


def _load_active_user(db: Session, user_id: str | None) -> User:
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid user")
    try:
        user = db.get(User, user_id)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid user")
    return user


def _load_effective_permissions(
    db: Session,
    *,
    user_id: str,
    tenant_id,
) -> tuple[list[str], list[str]]:
    try:
        return _load_roles_permissions(db, tenant_id, user_id)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database unavailable")


def _remaining_ttl(payload: dict) -> int:
    exp = payload.get("exp")
    if exp is None:
        return 60
    return max(1, int(exp) - int(datetime.now(timezone.utc).timestamp()))


# -----------------------------
# Auth: Tenant Mode (School Users)
# -----------------------------
async def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
):
    """
    Tenant-auth for school users AND safe SaaS-operator impersonation.

    Rules:
      - Normal tenant token must match resolved tenant.id
      - SaaS token (tenant_id="__saas__") is allowed ONLY if tenant context
        exists (i.e. request has a valid X-Tenant-Slug / domain mapping).

    Session caching:
      - On the first authenticated request the user + permissions are loaded
        from DB and cached in Redis for the remaining token lifetime.
      - Subsequent requests with the same token are served from cache,
        avoiding DB round-trips for the full 15-minute access window.

    Blacklist check:
      - Tokens blacklisted at logout are rejected immediately, before any
        DB lookup.
    """
    token = _read_bearer_token(request)

    # Fast-path: reject revoked tokens before touching the DB.
    if await is_blacklisted(token):
        raise HTTPException(status_code=401, detail="Token has been revoked")

    payload = _decode_access_token(token)
    token_tenant_id = payload.get("tenant_id")

    if token_tenant_id == SAAS_TENANT_MARKER:
        # SaaS token allowed here only because get_tenant already confirmed
        # the tenant exists. Supports operator impersonation with X-Tenant-Slug.
        pass
    else:
        if token_tenant_id != str(tenant.id):
            raise HTTPException(status_code=401, detail="Tenant mismatch")

    user_id = payload.get("sub")

    # Cache hit: skip DB permission round-trip.
    cached = await get_cached_session(token)
    if cached:
        user = _load_active_user(db, cached.get("user_id") or user_id)
        request.state.user_id = user.id
        request.state.roles = cached.get("roles", [])
        request.state.permissions = cached.get("permissions", [])
        return user

    # Cache miss: full DB load then populate cache.
    user = _load_active_user(db, user_id)
    roles, permissions = _load_effective_permissions(
        db,
        user_id=str(user.id),
        tenant_id=tenant.id,
    )
    request.state.user_id = user.id
    request.state.roles = roles
    request.state.permissions = permissions

    await cache_session(
        token,
        {"user_id": str(user.id), "roles": roles, "permissions": permissions},
        ttl_seconds=_remaining_ttl(payload),
    )

    return user


# -----------------------------
# Auth: SaaS Mode (SUPER_ADMIN)
# -----------------------------
async def get_current_user_saas(
    request: Request,
    db: Session = Depends(get_db),
):
    token = _read_bearer_token(request)

    if await is_blacklisted(token):
        raise HTTPException(status_code=401, detail="Token has been revoked")

    payload = _decode_access_token(token)

    if payload.get("tenant_id") != SAAS_TENANT_MARKER:
        raise HTTPException(status_code=401, detail="Not a SaaS token")

    user_id = payload.get("sub")

    cached = await get_cached_session(token)
    if cached:
        user = _load_active_user(db, cached.get("user_id") or user_id)
        request.state.user_id = user.id
        request.state.roles = cached.get("roles", [])
        request.state.permissions = cached.get("permissions", [])
        return user

    user = _load_active_user(db, user_id)
    roles, permissions = _load_effective_permissions(
        db,
        user_id=str(user.id),
        tenant_id=None,
    )
    request.state.user_id = user.id
    request.state.roles = roles
    request.state.permissions = permissions

    await cache_session(
        token,
        {"user_id": str(user.id), "roles": roles, "permissions": permissions},
        ttl_seconds=_remaining_ttl(payload),
    )

    return user


# -----------------------------
# RBAC Permission Checks
# -----------------------------
def require_permission(code: str):
    """
    Tenant-scoped permission checker.
    Ensures:
      1) Tenant resolved
      2) User authenticated (tenant token OR SaaS token with tenant context)
      3) Permission exists in token permissions
    """
    def _checker(
        request: Request,
        _user=Depends(get_current_user),
    ):
        roles = {
            str(role).strip().upper()
            for role in (getattr(request.state, "roles", []) or [])
            if isinstance(role, str) and str(role).strip()
        }
        if "SUPER_ADMIN" in roles:
            return
        perms = getattr(request.state, "permissions", []) or []
        if code not in perms:
            raise HTTPException(status_code=403, detail=f"Missing permission: {code}")
    return _checker


def require_permission_saas(code: str):
    """
    SaaS permission checker (no tenant resolution).
    Ensures:
      1) SaaS token authenticated
      2) Permission exists in token permissions
    """
    def _checker(
        request: Request,
        _user=Depends(get_current_user_saas),
    ):
        roles = {
            str(role).strip().upper()
            for role in (getattr(request.state, "roles", []) or [])
            if isinstance(role, str) and str(role).strip()
        }
        if "SUPER_ADMIN" in roles:
            return
        perms = getattr(request.state, "permissions", []) or []
        if code not in perms:
            raise HTTPException(status_code=403, detail=f"Missing permission: {code}")
    return _checker
