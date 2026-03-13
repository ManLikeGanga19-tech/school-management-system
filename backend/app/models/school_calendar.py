from sqlalchemy import Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class SaaSAcademicCalendarTerm(Base):
    __tablename__ = "saas_academic_calendar_terms"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    academic_year = Column(Integer, nullable=False)
    term_no = Column(Integer, nullable=False)
    term_code = Column(String(64), nullable=False)
    term_name = Column(String(160), nullable=False)
    start_date = Column(Date(), nullable=False)
    end_date = Column(Date(), nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class TenantSchoolCalendarEvent(Base):
    __tablename__ = "tenant_school_calendar_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('HALF_TERM_BREAK', 'EXAM_WINDOW')",
            name="ck_tenant_school_calendar_events_type",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("core.tenants.id", ondelete="CASCADE"), nullable=False)
    academic_year = Column(Integer, nullable=False)
    event_type = Column(String(32), nullable=False)
    title = Column(String(160), nullable=False)
    term_code = Column(String(80), nullable=True)
    start_date = Column(Date(), nullable=False)
    end_date = Column(Date(), nullable=False)
    notes = Column(String(500), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
