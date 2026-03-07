from sqlalchemy import (
    Column,
    String,
    DateTime,
    ForeignKey,
    Numeric,
    Date,
    CheckConstraint,
    Integer,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func

from app.core.database import Base


class Subscription(Base):
    __tablename__ = "subscriptions"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    plan = Column(String(64), nullable=False)
    billing_cycle = Column(String(16), nullable=False)  # 'per_term' | 'full_year'
    status = Column(String(16), nullable=False, server_default=text("'trialing'"))  # 'active' | 'trialing' | 'past_due' | 'cancelled' | 'paused'
    amount_kes = Column(Numeric(12, 2), nullable=False)
    discount_percent = Column(Numeric(5, 2), server_default=text("0.0"))
    period_start = Column(Date(), nullable=True)
    period_end = Column(Date(), nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True)


class SubscriptionPayment(Base):
    __tablename__ = "subscription_payments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_subscription_payments_status",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    subscription_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.subscriptions.id", ondelete="SET NULL"),
        nullable=True,
    )
    initiated_by_user_id = Column(UUID(as_uuid=True), nullable=True)

    provider = Column(String(32), nullable=False, server_default=text("'MPESA_DARAJA'"))
    phone_number = Column(String(20), nullable=False)
    amount_kes = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(10), nullable=False, server_default=text("'KES'"))

    checkout_request_id = Column(String(120), nullable=False, unique=True)
    merchant_request_id = Column(String(120), nullable=True)
    mpesa_receipt = Column(String(120), nullable=True)

    status = Column(String(16), nullable=False, server_default=text("'PENDING'"))
    result_code = Column(Integer, nullable=True)
    result_desc = Column(Text, nullable=True)

    request_payload = Column(JSONB, nullable=True)
    callback_payload = Column(JSONB, nullable=True)

    initiated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
