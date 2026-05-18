from sqlalchemy import Column, String, DateTime, Date, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class TenantGroup(Base):
    """A multi-campus Enterprise customer. Each campus is a full Tenant
    linked via tenants.group_id; the group carries the shared subscription
    tier that every campus inherits."""

    __tablename__ = "tenant_groups"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name = Column(String(200), nullable=False)
    slug = Column(String(120), nullable=False, unique=True)
    billing_email = Column(String(200), nullable=True)
    primary_contact = Column(String(200), nullable=True)

    # Shared subscription tier — inherited by every campus in the group.
    plan_code = Column(String(64), nullable=True)
    period_end = Column(Date(), nullable=True)
    # Manual lifecycle override — 'active' | 'grace' | 'locked'; null = auto.
    state_override = Column(String(16), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True)
