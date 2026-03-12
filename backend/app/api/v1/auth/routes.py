from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Response, Cookie, HTTPException, Request
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.core.dependencies import get_tenant, get_current_user, get_current_user_saas
from app.api.v1.schemas import LoginRequest, TokenResponse, MeResponse
from app.api.v1.auth import service

router = APIRouter()

REFRESH_COOKIE = "sms_refresh"
def _refresh_cookie_options() -> dict[str, object]:
    options: dict[str, object] = {
        "key": REFRESH_COOKIE,
        "httponly": True,
        "secure": settings.COOKIE_SECURE,
        "samesite": settings.COOKIE_SAMESITE,
        "path": "/api/v1/auth",
    }
    if settings.COOKIE_DOMAIN:
        options["domain"] = settings.COOKIE_DOMAIN
    return options


def _set_refresh_cookie(response: Response, value: str) -> None:
    response.set_cookie(value=value, **_refresh_cookie_options())


def _clear_refresh_cookie(response: Response) -> None:
    options = {
        "key": REFRESH_COOKIE,
        "path": "/api/v1/auth",
    }
    if settings.COOKIE_DOMAIN:
        options["domain"] = settings.COOKIE_DOMAIN
    response.delete_cookie(**options)


# -------------------------
# Tenant Login (DIRECTOR/SECRETARY/etc)
# -------------------------

@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
):
    try:
        access, refresh = service.login(
            db,
            tenant_id=tenant.id,
            email=payload.email,
            password=payload.password,
        )
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    _set_refresh_cookie(response, refresh)

    return TokenResponse(access_token=access)


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    response: Response,
    db: Session = Depends(get_db),
    sms_refresh: Optional[str] = Cookie(default=None),
):
    if not sms_refresh:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    try:
        payload = decode_token(sms_refresh)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        tenant_id_raw = payload.get("tenant_id")
        if not tenant_id_raw or tenant_id_raw == SAAS_TENANT_MARKER:
            raise HTTPException(status_code=401, detail="Invalid tenant refresh token")
        tenant_id = UUID(str(tenant_id_raw))

        access, new_refresh = service.refresh(
            db,
            tenant_id=tenant_id,
            refresh_token=sms_refresh,
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    _set_refresh_cookie(response, new_refresh)

    return TokenResponse(access_token=access)


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    sms_refresh: Optional[str] = Cookie(default=None),
):
    if sms_refresh:
        try:
            payload = decode_token(sms_refresh)
            tenant_id_raw = payload.get("tenant_id")
            if payload.get("type") == "refresh" and tenant_id_raw and tenant_id_raw != SAAS_TENANT_MARKER:
                service.logout(
                    db,
                    tenant_id=UUID(str(tenant_id_raw)),
                    refresh_token=sms_refresh,
                )
        except Exception:
            # Logout should be best-effort and always clear cookie client-side.
            pass

    _clear_refresh_cookie(response)

    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(
    request: Request,
    tenant=Depends(get_tenant),
    _db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    roles = getattr(request.state, "roles", []) or []
    perms = getattr(request.state, "permissions", []) or []

    return MeResponse(
        user={
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "phone": user.phone,
            "is_active": bool(user.is_active),
        },
        tenant={
            "id": str(tenant.id),
            "slug": tenant.slug,
            "name": tenant.name,
        },
        roles=roles,
        permissions=perms,
    )


# -------------------------
# SaaS Login (SUPER_ADMIN) - Global (NO tenant)
# -------------------------

@router.post("/login/saas", response_model=TokenResponse)
def login_saas(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    try:
        access, refresh = service.login_saas(
            db,
            email=payload.email,
            password=payload.password,
        )
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    # Keep cookie path consistent with other auth endpoints
    _set_refresh_cookie(response, refresh)

    return TokenResponse(access_token=access)


@router.post("/refresh/saas", response_model=TokenResponse)
def refresh_saas(
    response: Response,
    db: Session = Depends(get_db),
    sms_refresh: Optional[str] = Cookie(default=None),
):
    if not sms_refresh:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    try:
        access, new_refresh = service.refresh_saas(
            db,
            refresh_token=sms_refresh,
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

    _set_refresh_cookie(response, new_refresh)

    return TokenResponse(access_token=access)


@router.post("/logout/saas")
def logout_saas(
    response: Response,
    db: Session = Depends(get_db),
    sms_refresh: Optional[str] = Cookie(default=None),
):
    if sms_refresh:
        service.logout_saas(db, refresh_token=sms_refresh)

    _clear_refresh_cookie(response)

    return {"ok": True}


@router.get("/me/saas")
def me_saas(
    request: Request,
    user=Depends(get_current_user_saas),
):
    """
    SaaS Me endpoint: no tenant middleware required.
    Frontend can use this to confirm SUPER_ADMIN session.
    """
    return {
        "user_id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "roles": getattr(request.state, "roles", []) or [],
        "permissions": getattr(request.state, "permissions", []) or [],
        "mode": "saas",
    }
