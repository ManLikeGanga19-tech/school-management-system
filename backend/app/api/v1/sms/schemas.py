"""Pydantic schemas for the SMS communications module."""
from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ── Pricing ───────────────────────────────────────────────────────────────────

class SmsPricingOut(BaseModel):
    id: str
    price_per_unit_kes: float
    updated_at: str | None = None


class SmsPricingUpdateIn(BaseModel):
    price_per_unit_kes: Decimal = Field(..., gt=0, decimal_places=4)


# ── Credit account ────────────────────────────────────────────────────────────

class SmsCreditAccountOut(BaseModel):
    balance_units: int
    price_per_unit_kes: float
    updated_at: str | None = None


class AdminCreditAccountOut(BaseModel):
    tenant_id: str
    balance_units: int
    updated_at: str | None = None


class AdminAdjustCreditsIn(BaseModel):
    adjustment: int = Field(..., description="Positive = add units, negative = deduct")
    reason: str = Field(default="", max_length=500)


# ── Top-up ────────────────────────────────────────────────────────────────────

class TopupInitiateIn(BaseModel):
    phone_number: str = Field(..., min_length=9, max_length=20)
    units_requested: int = Field(..., ge=10, le=50_000)

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        digits = "".join(ch for ch in v if ch.isdigit())
        if not (
            (digits.startswith("254") and len(digits) == 12)
            or (digits.startswith("0") and len(digits) == 10)
        ):
            raise ValueError("Invalid Kenyan phone number (07XX / 01XX / 254XXXXXXXXX)")
        return v


class TopupInitiateOut(BaseModel):
    topup_id: str
    checkout_request_id: str | None = None
    units_requested: int
    amount_kes: float
    status: str
    duplicate: bool = False


class TopupStatusOut(BaseModel):
    id: str
    units_requested: int
    amount_kes: float
    price_per_unit_kes: float
    phone_number: str
    status: str
    mpesa_receipt: str | None = None
    checkout_request_id: str | None = None
    created_at: str | None = None
    completed_at: str | None = None


# ── Send / broadcast ──────────────────────────────────────────────────────────

class SendSmsIn(BaseModel):
    to_phone: str = Field(..., min_length=9, max_length=20)
    message_body: str = Field(..., min_length=1, max_length=1600)
    recipient_name: str | None = Field(default=None, max_length=200)
    template_id: UUID | None = None

    @field_validator("to_phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        digits = "".join(ch for ch in v if ch.isdigit())
        if not (
            (digits.startswith("254") and len(digits) == 12)
            or (digits.startswith("0") and len(digits) == 10)
        ):
            raise ValueError("Invalid Kenyan phone number")
        return v


class BroadcastRecipient(BaseModel):
    phone: str
    name: str | None = None


class BroadcastSmsIn(BaseModel):
    recipients: list[BroadcastRecipient] = Field(..., min_length=1, max_length=500)
    message_body: str = Field(..., min_length=1, max_length=1600)
    template_id: UUID | None = None


class SmsMessageOut(BaseModel):
    id: str
    to_phone: str
    recipient_name: str | None = None
    message_body: str
    units_deducted: int
    status: str
    provider_message_id: str | None = None
    error_message: str | None = None
    template_id: str | None = None
    created_at: str | None = None
    sent_at: str | None = None
    delivered_at: str | None = None


class BroadcastResultItem(BaseModel):
    phone: str
    name: str | None = None
    status: str
    message_id: str
    error: str | None = None


class BroadcastOut(BaseModel):
    total: int
    sent: int
    failed: int
    units_deducted: int
    results: list[BroadcastResultItem]


# ── Templates ─────────────────────────────────────────────────────────────────

class TemplateCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    body: str = Field(..., min_length=1, max_length=1600)
    variables: list[str] = Field(default_factory=list)


class TemplateUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    body: str | None = Field(default=None, min_length=1, max_length=1600)
    variables: list[str] | None = None


class TemplateOut(BaseModel):
    id: str
    name: str
    body: str
    variables: list[str]
    created_at: str | None = None
    updated_at: str | None = None
