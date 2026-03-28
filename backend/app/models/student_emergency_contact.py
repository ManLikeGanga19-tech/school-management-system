from sqlalchemy import Boolean, Column, DateTime, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class StudentEmergencyContact(Base):
    __tablename__ = "student_emergency_contacts"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    student_id = Column(UUID(as_uuid=True), nullable=False)

    name = Column(String(120), nullable=False)
    relationship = Column(String(80))       # UNCLE, AUNT, GRANDPARENT, SIBLING, FRIEND, etc.
    phone = Column(String(50), nullable=False)
    phone_alt = Column(String(50))
    email = Column(String(200))
    is_primary = Column(Boolean, nullable=False, server_default=text("false"))
    notes = Column(String(500))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
