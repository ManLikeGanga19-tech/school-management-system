"""SMS communications API routes (Phase 5).

Tenant routes  (/sms/*)        — Director and Secretary
Admin routes   (/admin/sms/*)  — SaaS operator only (mounted separately in router.py)
"""
from __future__ import annotations

import logging
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.v1.sms import service
from app.api.v1.sms.schemas import (
    AdminAdjustCreditsIn,
    AdminCreditAccountOut,
    BroadcastOut,
    BroadcastSmsIn,
    SendSmsIn,
    SmsCreditAccountOut,
    SmsMessageOut,
    SmsPricingOut,
    SmsPricingUpdateIn,
    TemplateCreateIn,
    TemplateOut,
    TemplateUpdateIn,
    TopupInitiateIn,
    TopupInitiateOut,
    TopupStatusOut,
)
from app.core.database import get_db
from app.core.dependencies import (
    get_current_user,
    get_current_user_saas,
    get_tenant,
    require_permission,
    require_permission_saas,
)

logger = logging.getLogger(__name__)

# ── Tenant router ─────────────────────────────────────────────────────────────
router = APIRouter()

# Admin sub-router (mounted at /admin/sms in api router)
admin_router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# TENANT — Credit account & pricing
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/account",
    response_model=SmsCreditAccountOut,
    dependencies=[Depends(require_permission("sms.credits.view"))],
    summary="Get SMS credit balance and current price per unit",
)
def get_account(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.get_credit_account(db, tenant_id=tenant.id)


# ─────────────────────────────────────────────────────────────────────────────
# TENANT — Top-up
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/topup",
    response_model=TopupInitiateOut,
    dependencies=[Depends(require_permission("sms.credits.topup"))],
    summary="Initiate M-Pesa STK push to purchase SMS credits",
)
def initiate_topup(
    body: TopupInitiateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        result = service.initiate_topup(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            phone_number=body.phone_number,
            units_requested=body.units_requested,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))


@router.get(
    "/topup/status",
    response_model=TopupStatusOut,
    dependencies=[Depends(require_permission("sms.credits.view"))],
    summary="Poll top-up payment status by checkout_request_id",
)
def topup_status(
    checkout_request_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    try:
        result = service.get_topup_status(
            db, tenant_id=tenant.id, checkout_request_id=checkout_request_id
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/topup/history",
    response_model=list[TopupStatusOut],
    dependencies=[Depends(require_permission("sms.credits.view"))],
    summary="List all top-up purchase history for this tenant",
)
def topup_history(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_topup_history(
        db, tenant_id=tenant.id, limit=limit, offset=offset
    )


# ─────────────────────────────────────────────────────────────────────────────
# TENANT — Send / broadcast
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/send",
    response_model=SmsMessageOut,
    dependencies=[Depends(require_permission("sms.send"))],
    summary="Send a single SMS to a recipient",
)
def send_single(
    body: SendSmsIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        result = service.send_single_sms(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            to_phone=body.to_phone,
            message_body=body.message_body,
            recipient_name=body.recipient_name,
            template_id=body.template_id,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))


@router.post(
    "/send/broadcast",
    response_model=BroadcastOut,
    dependencies=[Depends(require_permission("sms.send"))],
    summary="Send the same message to multiple recipients (up to 500)",
)
def broadcast(
    body: BroadcastSmsIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    recipients = [{"phone": r.phone, "name": r.name} for r in body.recipients]
    try:
        result = service.broadcast_sms(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            recipients=recipients,
            message_body=body.message_body,
            template_id=body.template_id,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))


@router.get(
    "/messages",
    response_model=list[SmsMessageOut],
    dependencies=[Depends(require_permission("sms.credits.view"))],
    summary="List sent messages for this tenant",
)
def list_messages(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_messages(db, tenant_id=tenant.id, limit=limit, offset=offset)


# ─────────────────────────────────────────────────────────────────────────────
# TENANT — Templates
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/templates",
    response_model=list[TemplateOut],
    dependencies=[Depends(require_permission("sms.templates.manage"))],
    summary="List all SMS templates for this tenant",
)
def list_templates(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_templates(db, tenant_id=tenant.id)


@router.post(
    "/templates",
    response_model=TemplateOut,
    status_code=201,
    dependencies=[Depends(require_permission("sms.templates.manage"))],
    summary="Create a new SMS template",
)
def create_template(
    body: TemplateCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        result = service.create_template(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            name=body.name,
            body=body.body,
            variables=body.variables,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch(
    "/templates/{template_id}",
    response_model=TemplateOut,
    dependencies=[Depends(require_permission("sms.templates.manage"))],
    summary="Update an SMS template",
)
def update_template(
    template_id: UUID,
    body: TemplateUpdateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    try:
        result = service.update_template(
            db,
            tenant_id=tenant.id,
            template_id=template_id,
            name=body.name,
            body=body.body,
            variables=body.variables,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete(
    "/templates/{template_id}",
    status_code=204,
    dependencies=[Depends(require_permission("sms.templates.manage"))],
    summary="Delete an SMS template",
)
def delete_template(
    template_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    try:
        service.delete_template(db, tenant_id=tenant.id, template_id=template_id)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# ADMIN routes (SaaS operator only)
# ─────────────────────────────────────────────────────────────────────────────

@admin_router.get(
    "/pricing",
    response_model=SmsPricingOut,
    summary="Get current platform SMS per-unit price",
)
def admin_get_pricing(
    db: Session = Depends(get_db),
    _=Depends(get_current_user_saas),
):
    return service.admin_get_pricing(db)


@admin_router.patch(
    "/pricing",
    response_model=SmsPricingOut,
    summary="Update platform SMS per-unit price (affects all future top-ups)",
)
def admin_update_pricing(
    body: SmsPricingUpdateIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_saas),
):
    try:
        result = service.admin_update_pricing(
            db,
            actor_user_id=user.id,
            price_per_unit_kes=body.price_per_unit_kes,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@admin_router.get(
    "/accounts",
    response_model=list[AdminCreditAccountOut],
    summary="List all tenant SMS credit balances",
)
def admin_list_accounts(
    db: Session = Depends(get_db),
    _=Depends(get_current_user_saas),
):
    return service.admin_list_credit_accounts(db)


@admin_router.post(
    "/accounts/{tenant_id}/adjust",
    summary="Manually adjust SMS credits for a tenant (refunds / gifts)",
)
def admin_adjust_credits(
    tenant_id: UUID,
    body: AdminAdjustCreditsIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_saas),
):
    try:
        result = service.admin_adjust_credits(
            db,
            tenant_id=tenant_id,
            actor_user_id=user.id,
            adjustment=body.adjustment,
            reason=body.reason,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
