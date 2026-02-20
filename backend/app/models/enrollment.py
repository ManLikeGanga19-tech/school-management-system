from sqlalchemy import Column, String, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func

from app.core.database import Base


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)

    # optional linkage if you later create students table
    student_id = Column(UUID(as_uuid=True), nullable=True)

    status = Column(String, nullable=False, server_default=text("'DRAFT'"))  # DRAFT|SUBMITTED|APPROVED|REJECTED

    # flexible payload so step 3.1 can evolve without schema churn
    payload = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))

    created_by = Column(UUID(as_uuid=True), nullable=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
