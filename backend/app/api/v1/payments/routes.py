from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.v1.payments import service
from app.api.v1.payments.schemas import (
    DarajaCallbackAckOut,
    SubscriptionOut,
    SubscriptionPaymentHistoryRow,
    SubscriptionPaymentInitiateIn,
    SubscriptionPaymentInitiateOut,
    SubscriptionPaymentStatusOut,
)
from app.core.database import get_db
from app.core.dependencies import get_current_user, get_tenant, require_permission
from app.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get(
    "/subscription",
    response_model=SubscriptionOut | None,
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def get_tenant_subscription(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    try:
        return service.get_tenant_subscription(db, tenant_id=tenant.id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get(
    "/subscription/payments",
    response_model=list[SubscriptionPaymentHistoryRow],
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def list_tenant_subscription_payments(
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    try:
        return service.list_tenant_subscription_payments(
            db,
            tenant_id=tenant.id,
            limit=limit,
            offset=offset,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post(
    "/subscription/pay",
    response_model=SubscriptionPaymentInitiateOut,
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def initiate_subscription_payment(
    payload: SubscriptionPaymentInitiateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        out = service.initiate_tenant_subscription_payment(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            phone_number=payload.phone_number,
            amount=payload.amount,
            subscription_id=payload.subscription_id,
        )
        db.commit()
        return out
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))


@router.get(
    "/subscription/payment-status",
    response_model=SubscriptionPaymentStatusOut,
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def get_subscription_payment_status(
    checkout_request_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    try:
        out = service.get_tenant_subscription_payment_status(
            db, tenant_id=tenant.id, checkout_request_id=checkout_request_id
        )
        db.commit()
        return out
    except ValueError as exc:
        db.rollback()
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail=str(exc))
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))


@router.post("/daraja/callback", response_model=DarajaCallbackAckOut)
@limiter.limit("30/minute")
def daraja_callback(
    request: Request,
    payload: dict,
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    client_ip = request.client.host if request.client else "unknown"
    logger.info(
        "Daraja callback received from ip=%s request_id=%s",
        client_ip,
        getattr(request.state, "request_id", "-"),
    )
    try:
        out = service.handle_daraja_callback(
            db,
            payload=payload,
            callback_token=token,
        )
        db.commit()
        return out
    except PermissionError as exc:
        db.rollback()
        logger.warning("Daraja callback rejected (invalid token) from ip=%s", client_ip)
        raise HTTPException(status_code=401, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))
