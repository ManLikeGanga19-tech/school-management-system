from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class TenantAdmissionSettings(Base):
    __tablename__ = "tenant_admission_settings"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.tenants.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Optional prefix, e.g. "ADM-" or "SCH/" or "" for plain numbers
    prefix = Column(String(30), nullable=False, server_default=text("'ADM-'"))

    # The last admission number issued. Next number = last_number + 1.
    last_number = Column(Integer, nullable=False, server_default=text("0"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
