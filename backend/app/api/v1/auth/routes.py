from typing import Optional

from fastapi import APIRouter, Depends, Response, Cookie, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_tenant
from app.api.v1.schemas import LoginRequest, TokenResponse
from app.api.v1.auth import service

router = APIRouter()

REFRESH_COOKIE = "sms_refresh"


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

    # Store refresh token in httpOnly cookie
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh,
        httponly=True,
        secure=False,      # set True behind HTTPS in prod
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
        secure=False,      # set True behind HTTPS in prod
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
