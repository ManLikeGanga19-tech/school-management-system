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

from sqlalchemy import Boolean

from app.core.database import Base


class SubscriptionPlan(Base):
    """Catalogue of subscription tiers. DB-driven so plans, pricing and the
    modules each tier unlocks can change without a redeploy."""

    __tablename__ = "subscription_plans"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    code = Column(String(64), nullable=False, unique=True)          # 'basic' | 'standard' | 'premium'
    name = Column(String(120), nullable=False)
    # Gateable module codes this plan unlocks (core modules are always on).
    modules = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    price_kes = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    billing_cycle = Column(String(16), nullable=False, server_default=text("'per_term'"))
    # Days after period_end the tenant stays usable (renewal banner) before lockout.
    grace_days = Column(Integer, nullable=False, server_default=text("14"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    sort_order = Column(Integer, nullable=False, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True)


class Subscription(Base):
    __tablename__ = "subscriptions"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    plan = Column(String(64), nullable=False)            # billing plan: 'per_term' | 'per_year'
    # Subscription tier — references subscription_plans.code. Drives module
    # gating; null means no tier assigned (tenant grandfathered to full access).
    plan_code = Column(String(64), nullable=True, index=True)
    billing_cycle = Column(String(16), nullable=False)  # 'per_term' | 'full_year'
    status = Column(String(16), nullable=False, server_default=text("'trialing'"))  # 'active' | 'trialing' | 'past_due' | 'cancelled' | 'paused'
    amount_kes = Column(Numeric(12, 2), nullable=False)
    discount_percent = Column(Numeric(5, 2), server_default=text("0.0"))
    period_start = Column(Date(), nullable=True)
    period_end = Column(Date(), nullable=True)
    # Manual lifecycle override — 'active' | 'grace' | 'locked'; null = auto.
    state_override = Column(String(16), nullable=True)
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
