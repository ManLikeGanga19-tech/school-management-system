from sqlalchemy import Column, String, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func

from app.core.database import Base


class StudentFeeAssignment(Base):
    __tablename__ = "student_fee_assignments"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    enrollment_id = Column(UUID(as_uuid=True), nullable=False)
    fee_structure_id = Column(UUID(as_uuid=True), ForeignKey("core.fee_structures.id", ondelete="SET NULL"), nullable=False)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(String, nullable=False, server_default=text("'assigned'"))
    meta = Column(JSONB, nullable=True)
