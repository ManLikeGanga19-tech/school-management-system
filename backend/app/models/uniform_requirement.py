"""ORM model for class-level uniform requirements.

Schools — junior secondary especially — need a structured uniform list rather
than a single generic fee line: each item carries a quantity, a unit price and
a mandatory/optional flag. Mandatory items are billed automatically when a
class's fees invoice is generated.
"""
from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class UniformRequirement(Base):
    __tablename__ = "uniform_requirements"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.tenants.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The class/level this uniform item is for — keyed like fee structures.
    class_code = Column(String(50), nullable=False)
    item_name = Column(String(160), nullable=False)
    # Free text for sizes, colour, supplier notes, etc.
    description = Column(Text, nullable=True)
    quantity = Column(Integer, nullable=False, server_default=text("1"))
    unit_price = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    # Mandatory items are auto-added to the class fees invoice; optional ones
    # are recorded for reference but not billed automatically.
    is_mandatory = Column(Boolean, nullable=False, server_default=text("true"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
