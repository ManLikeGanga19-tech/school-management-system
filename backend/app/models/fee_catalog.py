from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class FeeCategory(Base):
    __tablename__ = "fee_categories"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_fee_categories_tenant_code"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)

    code = Column(String(60), nullable=False)
    name = Column(String(120), nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FeeItem(Base):
    __tablename__ = "fee_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_fee_items_tenant_code"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)

    category_id = Column(UUID(as_uuid=True), ForeignKey("core.fee_categories.id", ondelete="RESTRICT"), nullable=False)

    code = Column(String(60), nullable=False)
    name = Column(String(160), nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
