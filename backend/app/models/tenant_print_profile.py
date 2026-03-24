from sqlalchemy import Column, String, DateTime, ForeignKey, Boolean, Integer, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class TenantPrintProfile(Base):
    __tablename__ = "tenant_print_profiles"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.tenants.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    logo_url = Column(String(500), nullable=True)
    school_header = Column(String(500), nullable=True)
    receipt_footer = Column(String(500), nullable=True)
    paper_size = Column(String(32), nullable=False, server_default=text("'A4'"))
    currency = Column(String(10), nullable=False, server_default=text("'KES'"))
    thermal_width_mm = Column(Integer, nullable=False, server_default=text("80"))
    qr_enabled = Column(Boolean, nullable=False, server_default=text("true"))

    # Receipt print details (enterprise template)
    po_box = Column(String(100), nullable=True)
    physical_address = Column(String, nullable=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    school_motto = Column(String(500), nullable=True)
    authorized_signatory_name = Column(String(200), nullable=True)
    authorized_signatory_title = Column(String(200), nullable=True)

    updated_by = Column(UUID(as_uuid=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())

