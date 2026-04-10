"""ORM models for the SMS communications module (Phase 5)."""
from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class SmsPricing(Base):
    """Platform-wide per-unit SMS price — managed by SaaS admin.
    Typically one row; new price takes effect immediately for all future top-ups.
    """
    __tablename__ = "sms_pricing"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True,
                server_default=text("gen_random_uuid()"))
    price_per_unit_kes = Column(Numeric(10, 4), nullable=False,
                                server_default=text("1.50"))
    updated_by = Column(UUID(as_uuid=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=func.now())


class SmsCreditAccount(Base):
    """Per-tenant SMS credit balance (one row per tenant)."""
    __tablename__ = "sms_credit_accounts"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True,
                server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True),
                       ForeignKey("core.tenants.id", ondelete="CASCADE"),
                       nullable=False, unique=True)
    balance_units = Column(Integer(), nullable=False, server_default=text("0"))
    updated_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=func.now())


class SmsCreditTopup(Base):
    """Every M-Pesa top-up purchase attempt."""
    __tablename__ = "sms_credit_topups"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING','COMPLETED','FAILED','CANCELLED')",
            name="ck_sms_credit_topups_status",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True,
                server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True),
                       ForeignKey("core.tenants.id", ondelete="CASCADE"),
                       nullable=False)
    units_requested = Column(Integer(), nullable=False)
    amount_kes = Column(Numeric(12, 2), nullable=False)
    price_per_unit_snapshot = Column(Numeric(10, 4), nullable=False)
    phone_number = Column(String(20), nullable=False)
    provider = Column(String(32), nullable=False,
                      server_default=text("'MPESA_DARAJA'"))
    checkout_request_id = Column(String(120), nullable=True, unique=True)
    merchant_request_id = Column(String(120), nullable=True)
    mpesa_receipt = Column(String(120), nullable=True)
    status = Column(String(16), nullable=False, server_default=text("'PENDING'"))
    result_code = Column(Integer(), nullable=True)
    result_desc = Column(Text(), nullable=True)
    request_payload = Column(JSONB(), nullable=True)
    callback_payload = Column(JSONB(), nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


class SmsMessage(Base):
    """Log of every outbound SMS sent from any tenant."""
    __tablename__ = "sms_messages"
    __table_args__ = (
        CheckConstraint(
            "status IN ('QUEUED','SENT','DELIVERED','FAILED')",
            name="ck_sms_messages_status",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True,
                server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True),
                       ForeignKey("core.tenants.id", ondelete="CASCADE"),
                       nullable=False)
    to_phone = Column(String(20), nullable=False)
    recipient_name = Column(String(200), nullable=True)
    message_body = Column(Text(), nullable=False)
    units_deducted = Column(Integer(), nullable=False, server_default=text("1"))
    status = Column(String(16), nullable=False, server_default=text("'QUEUED'"))
    provider_message_id = Column(String(120), nullable=True)
    error_message = Column(Text(), nullable=True)
    template_id = Column(UUID(as_uuid=True), nullable=True)
    meta = Column(JSONB(), nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)


class SmsTemplate(Base):
    """Reusable message templates per tenant."""
    __tablename__ = "sms_templates"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_sms_templates_tenant_name"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True,
                server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True),
                       ForeignKey("core.tenants.id", ondelete="CASCADE"),
                       nullable=False)
    name = Column(String(120), nullable=False)
    body = Column(Text(), nullable=False)
    variables = Column(JSONB(), nullable=True, server_default=text("'[]'::jsonb"))
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=func.now())
