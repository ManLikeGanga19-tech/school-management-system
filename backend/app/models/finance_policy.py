from sqlalchemy import Column, Boolean, DateTime, Integer, ForeignKey, Numeric, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class FinancePolicy(Base):
    __tablename__ = "finance_policies"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False, unique=True)

    allow_partial_enrollment = Column(Boolean, nullable=False, server_default=text("false"))
    min_percent_to_enroll = Column(Integer, nullable=True)
    min_amount_to_enroll = Column(Numeric(12, 2), nullable=True)

    require_interview_fee_before_submit = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
