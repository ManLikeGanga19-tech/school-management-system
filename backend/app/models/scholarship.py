from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Numeric, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class Scholarship(Base):
    __tablename__ = "scholarships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_scholarships_tenant_name"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)

    name = Column(String(160), nullable=False)
    type = Column(String(20), nullable=False)  # PERCENT|FIXED
    value = Column(Numeric(12, 2), nullable=False)

    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
