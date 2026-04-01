from sqlalchemy import Column, Enum, SmallInteger, String, Boolean, DateTime, ForeignKey, Numeric, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base

StudentType = Enum("NEW", "RETURNING", name="student_type", schema="core")


class FeeStructure(Base):
    __tablename__ = "fee_structures"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "class_code", "academic_year", "student_type",
            name="uq_fee_structures_tenant_class_year_type",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)

    class_code = Column(String(50), nullable=False)
    term_code = Column(String(80), nullable=False, server_default=text("'GENERAL'"))  # kept for legacy
    academic_year = Column(SmallInteger(), nullable=False)
    student_type = Column(StudentType, nullable=False)
    name = Column(String(160), nullable=False)
    structure_no = Column(String(50), nullable=True)
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

    # Per-term amounts — ONCE_PER_YEAR and ONCE_EVER items use term_1_amount as the canonical value
    term_1_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    term_2_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    term_3_amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))

    # Legacy amount kept for backwards compat — will be removed after migration
    amount = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
