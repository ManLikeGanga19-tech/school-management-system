from typing import Optional

from fastapi import APIRouter, Depends, Response, Cookie, HTTPException, Request
from sqlalchemy.orm import Session
from jose import JWTError

from app.core.database import get_db
from app.core.dependencies import get_tenant, get_current_user
from app.api.v1.schemas import LoginRequest, TokenResponse, MeResponse
from app.api.v1.auth import service
from app.utils.tokens import decode_token

router = APIRouter()

REFRESH_COOKIE = "sms_refresh"
SAAS_TENANT_MARKER = "__saas__"


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

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh,
        httponly=True,
        secure=False,  # set True behind HTTPS in prod
        samesite="lax",
        path="/api/v1/auth",
    )

    return TokenResponse(access_token=access)


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    response: Response,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    sms_refresh: Optional[str] = Cookie(default=None),
):
    if not sms_refresh:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    try:
        access, new_refresh = service.refresh(
            db,
            tenant_id=tenant.id,
            refresh_token=sms_refresh,
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=new_refresh,
        httponly=True,
        secure=False,  # set True behind HTTPS in prod
        samesite="lax",
        path="/api/v1/auth",
    )

    return TokenResponse(access_token=access)


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    sms_refresh: Optional[str] = Cookie(default=None),
):
    if sms_refresh:
        service.logout(
            db,
            tenant_id=tenant.id,
            refresh_token=sms_refresh,
        )

    response.delete_cookie(
        key=REFRESH_COOKIE,
        path="/api/v1/auth",
    )

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
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh,
        httponly=True,
        secure=False,  # set True behind HTTPS in prod
        samesite="lax",
        path="/api/v1/auth",
    )

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

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=new_refresh,
        httponly=True,
        secure=False,  # set True behind HTTPS in prod
        samesite="lax",
        path="/api/v1/auth",
    )

    return TokenResponse(access_token=access)


@router.post("/logout/saas")
def logout_saas(
    response: Response,
    db: Session = Depends(get_db),
    sms_refresh: Optional[str] = Cookie(default=None),
):
    if sms_refresh:
        service.logout_saas(db, refresh_token=sms_refresh)

    response.delete_cookie(
        key=REFRESH_COOKIE,
        path="/api/v1/auth",
    )

    return {"ok": True}


@router.get("/me/saas")
def me_saas(
    request: Request,
):
    """
    SaaS Me endpoint: no tenant middleware required.
    Frontend can use this to confirm SUPER_ADMIN session.
    """
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

    if payload.get("tenant_id") != SAAS_TENANT_MARKER:
        raise HTTPException(status_code=401, detail="Not a SaaS token")

    return {
        "user_id": payload.get("sub"),
        "roles": payload.get("roles", []),
        "permissions": payload.get("permissions", []),
        "mode": "saas",
    }
