from sqlalchemy import Column, Boolean, DateTime, Integer, ForeignKey, Numeric, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class FinanceStructurePolicy(Base):
    __tablename__ = "finance_structure_policies"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    fee_structure_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.fee_structures.id", ondelete="CASCADE"),
        nullable=False,
    )
    fee_item_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.fee_items.id", ondelete="CASCADE"),
        nullable=True,
    )

    allow_partial_enrollment = Column(Boolean, nullable=False, server_default=text("false"))
    min_percent_to_enroll = Column(Integer, nullable=True)
    min_amount_to_enroll = Column(Numeric(12, 2), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
