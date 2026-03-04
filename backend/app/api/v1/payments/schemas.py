from __future__ import annotations

from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


SubscriptionPaymentStatus = Literal["pending", "completed", "failed", "cancelled"]


class SubscriptionOut(BaseModel):
    id: str
    billing_plan: Literal["per_term", "per_year"]
    # Backward-compatible mirrors.
    plan: str
    billing_cycle: str
    status: str
    amount_kes: float
    discount_percent: Optional[float] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    next_payment_date: Optional[str] = None
    next_payment_amount: Optional[float] = None
    created_at: Optional[str] = None
    notes: Optional[str] = None
    tenant_name: Optional[str] = None
    tenant_slug: Optional[str] = None


class SubscriptionPaymentHistoryRow(BaseModel):
    id: str
    amount_kes: float
    paid_at: Optional[str] = None
    mpesa_receipt: Optional[str] = None
    phone: Optional[str] = None
    period_label: Optional[str] = None
    status: SubscriptionPaymentStatus


class SubscriptionPaymentInitiateIn(BaseModel):
    phone_number: str = Field(..., min_length=10, max_length=20)
    amount: Optional[Decimal] = Field(default=None, gt=0)
    subscription_id: Optional[UUID] = None


class SubscriptionPaymentInitiateOut(BaseModel):
    checkout_request_id: str
    merchant_request_id: str
    response_description: str
    customer_message: Optional[str] = None
    status: SubscriptionPaymentStatus = "pending"


class SubscriptionPaymentStatusOut(BaseModel):
    checkout_request_id: str
    status: SubscriptionPaymentStatus
    mpesa_receipt: Optional[str] = None
    result_code: Optional[int] = None
    result_desc: Optional[str] = None


class DarajaCallbackAckOut(BaseModel):
    ResultCode: int = 0
    ResultDesc: str = "Accepted"
