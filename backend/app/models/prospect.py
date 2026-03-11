from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class ProspectAccount(Base):
    __tablename__ = "prospect_accounts"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    email = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    organization_name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    job_title = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ProspectAuthSession(Base):
    __tablename__ = "prospect_auth_sessions"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    account_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.prospect_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    refresh_token_hash = Column(String, nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), nullable=True)


class ProspectRequest(Base):
    __tablename__ = "prospect_requests"
    __table_args__ = (
        CheckConstraint(
            "request_type IN ('DEMO', 'ENQUIRY', 'SCHOOL_VISIT')",
            name="ck_prospect_requests_type",
        ),
        CheckConstraint(
            "status IN ('NEW', 'CONTACTING', 'SCHEDULED', 'CLOSED')",
            name="ck_prospect_requests_status",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    account_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.prospect_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    request_type = Column(String, nullable=False)
    status = Column(String, nullable=False, server_default=text("'NEW'"))
    organization_name = Column(String, nullable=False)
    contact_name = Column(String, nullable=False)
    contact_email = Column(String, nullable=False)
    contact_phone = Column(String, nullable=True)
    student_count = Column(Integer, nullable=True)
    preferred_contact_method = Column(String, nullable=True)
    preferred_contact_window = Column(String, nullable=True)
    requested_domain = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
