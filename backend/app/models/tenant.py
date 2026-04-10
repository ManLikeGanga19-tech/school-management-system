from sqlalchemy import Column, String, Boolean, DateTime, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class Tenant(Base):
    __tablename__ = "tenants"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    slug = Column(String, nullable=False, unique=True)
    primary_domain = Column(String, unique=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    curriculum_type = Column(String(20), nullable=False, server_default=text("'CBC'"))

    # Branding & contact info (used in PDF headers)
    brand_color = Column(String(7), nullable=True)          # hex e.g. "#1A3C6B"
    school_address = Column(String(300), nullable=True)
    school_phone = Column(String(60), nullable=True)
    school_email = Column(String(200), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())

    # SOFT DELETE
    deleted_at = Column(DateTime(timezone=True), nullable=True)
