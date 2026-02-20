# app/core/dependencies.py

from __future__ import annotations

from fastapi import Request, HTTPException, Depends
from sqlalchemy.orm import Session
from jose import JWTError
from sqlalchemy.exc import SQLAlchemyError

from app.core.database import get_db
from app.utils.tokens import decode_token
from app.models.user import User

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
# Auth: Tenant Mode (School Users)
# -----------------------------
def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token")

    token = auth.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    # tenant safety: token must match resolved tenant
    if payload.get("tenant_id") != str(tenant.id):
        raise HTTPException(status_code=401, detail="Tenant mismatch")

    user_id = payload.get("sub")
    try:
        user = db.get(User, user_id)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid user")

    # For AuditMiddleware + RBAC checks
    request.state.user_id = user.id
    request.state.roles = payload.get("roles", []) or []
    request.state.permissions = payload.get("permissions", []) or []

    return user


# -----------------------------
# Auth: SaaS Mode (SUPER_ADMIN)
# -----------------------------
def get_current_user_saas(
    request: Request,
    db: Session = Depends(get_db),
):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token")

    token = auth.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    # SaaS safety: token must be a SaaS token
    if payload.get("tenant_id") != SAAS_TENANT_MARKER:
        raise HTTPException(status_code=401, detail="Not a SaaS token")

    user_id = payload.get("sub")
    try:
        user = db.get(User, user_id)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid user")

    # For AuditMiddleware + RBAC checks
    request.state.user_id = user.id
    request.state.roles = payload.get("roles", []) or []
    request.state.permissions = payload.get("permissions", []) or []

    return user


# -----------------------------
# RBAC Permission Checks
# -----------------------------
def require_permission(code: str):
    """
    Tenant-scoped permission checker.
    Ensures:
      1) Tenant resolved
      2) User authenticated
      3) Permission exists in token permissions
    """
    def _checker(
        request: Request,
        _user=Depends(get_current_user),
    ):
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
        perms = getattr(request.state, "permissions", []) or []
        if code not in perms:
            raise HTTPException(status_code=403, detail=f"Missing permission: {code}")
    return _checker
