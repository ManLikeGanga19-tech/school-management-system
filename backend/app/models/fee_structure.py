from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Numeric, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class FeeStructure(Base):
    __tablename__ = "fee_structures"
    __table_args__ = (
        UniqueConstraint("tenant_id", "class_code", name="uq_fee_structures_tenant_class"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)

    class_code = Column(String(50), nullable=False)
    name = Column(String(160), nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FeeStructureItem(Base):
    __tablename__ = "fee_structure_items"
    __table_args__ = (
        UniqueConstraint("structure_id", "fee_item_id", name="uq_fee_structure_item"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    structure_id = Column(UUID(as_uuid=True), ForeignKey("core.fee_structures.id", ondelete="CASCADE"), nullable=False)
    fee_item_id = Column(UUID(as_uuid=True), ForeignKey("core.fee_items.id", ondelete="RESTRICT"), nullable=False)

    amount = Column(Numeric(12, 2), nullable=False)
