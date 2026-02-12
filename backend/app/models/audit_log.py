from sqlalchemy import Column, String, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func

from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("core.users.id", ondelete="SET NULL"), nullable=True)

    action = Column(String(150), nullable=False)     # e.g. "enrollment.create"
    resource = Column(String(120), nullable=False)   # e.g. "enrollment"
    resource_id = Column(UUID(as_uuid=True), nullable=True)

    payload = Column(JSONB, nullable=True)  # sanitized request/extra info
    meta = Column(JSONB, nullable=True)     # ip, ua, request_id, method, path, status, duration_ms

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
