from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.v1.auth import service
from app.api.v1.schemas import LoginRequest, MeResponse, TokenResponse
from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import (
    SAAS_TENANT_MARKER,
    get_current_user,
    get_current_user_saas,
    get_tenant,
)
from app.core.rate_limit import limiter
from app.core.session_cache import blacklist_token, invalidate_session
from app.utils.tokens import decode_token

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


# ── Tenant Login (DIRECTOR / SECRETARY / etc.) ────────────────────────────────

@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(
    request: Request,
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
async def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    sms_refresh: Optional[str] = Cookie(default=None),
):
    # Best-effort: blacklist the access token so it is immediately unusable.
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        access_token = auth_header.split(" ", 1)[1].strip()
        try:
            token_payload = decode_token(access_token)
            await blacklist_token(access_token, token_payload)
            await invalidate_session(access_token)
        except Exception:
            pass  # Never block logout due to Redis or decode errors.

    if sms_refresh:
        try:
            payload = decode_token(sms_refresh)
            tenant_id_raw = payload.get("tenant_id")
            if (
                payload.get("type") == "refresh"
                and tenant_id_raw
                and tenant_id_raw != SAAS_TENANT_MARKER
            ):
                service.logout(
                    db,
                    tenant_id=UUID(str(tenant_id_raw)),
                    refresh_token=sms_refresh,
                )
        except Exception:
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


# ── SaaS Login (SUPER_ADMIN) — no tenant resolution ───────────────────────────

@router.post("/login/saas", response_model=TokenResponse)
@limiter.limit("5/minute")
def login_saas(
    request: Request,
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
async def logout_saas(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    sms_refresh: Optional[str] = Cookie(default=None),
):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        access_token = auth_header.split(" ", 1)[1].strip()
        try:
            token_payload = decode_token(access_token)
            await blacklist_token(access_token, token_payload)
            await invalidate_session(access_token)
        except Exception:
            pass

    if sms_refresh:
        try:
            service.logout_saas(db, refresh_token=sms_refresh)
        except Exception:
            pass

    _clear_refresh_cookie(response)
    return {"ok": True}


@router.get("/me/saas")
def me_saas(
    request: Request,
    user=Depends(get_current_user_saas),
):
    """
    SaaS Me endpoint: no tenant middleware required.
    Frontend uses this to confirm SUPER_ADMIN session.
    """
    return {
        "user_id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "roles": getattr(request.state, "roles", []) or [],
        "permissions": getattr(request.state, "permissions", []) or [],
        "mode": "saas",
    }
