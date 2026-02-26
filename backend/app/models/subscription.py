from sqlalchemy import Column, String, DateTime, ForeignKey, Numeric, Date, CheckConstraint, text
from sqlalchemy.dialects.postgresql import UUID
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
