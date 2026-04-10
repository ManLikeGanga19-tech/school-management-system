"""Discipline module models."""
from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, String, Text, UniqueConstraint, text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class DisciplineIncident(Base):
    """A discipline incident reported at school."""
    __tablename__ = "discipline_incidents"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    incident_date = Column(Date, nullable=False)
    incident_type = Column(String(80), nullable=False)
    severity = Column(String(20), nullable=False, server_default=text("'LOW'"))
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    location = Column(String(200), nullable=True)
    reported_by_user_id = Column(UUID(as_uuid=True), nullable=True)

    status = Column(String(30), nullable=False, server_default=text("'OPEN'"))
    resolution_notes = Column(Text, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class DisciplineStudent(Base):
    """Links a student to a discipline incident with their role and action taken."""
    __tablename__ = "discipline_students"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    incident_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.discipline_incidents.id", ondelete="CASCADE"),
        nullable=False,
    )
    student_id = Column(UUID(as_uuid=True), nullable=False)   # soft ref — no FK
    enrollment_id = Column(UUID(as_uuid=True), nullable=True)  # denormalized

    role = Column(String(30), nullable=False, server_default=text("'PERPETRATOR'"))
    # PERPETRATOR | VICTIM | WITNESS

    action_taken = Column(String(50), nullable=True)
    # WARNING | DETENTION | SUSPENSION | EXPULSION | PARENT_MEETING | COUNSELLING | NONE

    action_notes = Column(Text, nullable=True)
    parent_notified = Column(Boolean, nullable=False, server_default=text("false"))
    parent_notified_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DisciplineFollowup(Base):
    """Follow-up notes added after the initial incident report."""
    __tablename__ = "discipline_followups"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    incident_id = Column(
        UUID(as_uuid=True),
        ForeignKey("core.discipline_incidents.id", ondelete="CASCADE"),
        nullable=False,
    )

    followup_date = Column(Date, nullable=False)
    notes = Column(Text, nullable=False)
    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
