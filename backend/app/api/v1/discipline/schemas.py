"""Discipline module schemas."""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, field_validator


# ── Constants ─────────────────────────────────────────────────────────────────

VALID_TYPES = {
    "BULLYING", "FIGHTING", "TRUANCY", "MISCONDUCT", "VANDALISM",
    "SUBSTANCE_ABUSE", "HARASSMENT", "THEFT", "INSUBORDINATION", "OTHER",
}
VALID_SEVERITIES = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_STATUSES = {"OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED"}
VALID_ROLES = {"PERPETRATOR", "VICTIM", "WITNESS"}
VALID_ACTIONS = {
    "WARNING", "DETENTION", "SUSPENSION", "EXPULSION",
    "PARENT_MEETING", "COUNSELLING", "NONE",
}


# ── Student link ──────────────────────────────────────────────────────────────

class IncidentStudentCreate(BaseModel):
    student_id: UUID
    enrollment_id: Optional[UUID] = None
    role: str = "PERPETRATOR"
    action_taken: Optional[str] = None
    action_notes: Optional[str] = None
    parent_notified: bool = False

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}")
        return v

    @field_validator("action_taken")
    @classmethod
    def validate_action(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().upper()
        if v not in VALID_ACTIONS:
            raise ValueError(f"action_taken must be one of {VALID_ACTIONS}")
        return v


class IncidentStudentUpdate(BaseModel):
    role: Optional[str] = None
    action_taken: Optional[str] = None
    action_notes: Optional[str] = None
    parent_notified: Optional[bool] = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().upper()
        if v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}")
        return v

    @field_validator("action_taken")
    @classmethod
    def validate_action(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().upper()
        if v not in VALID_ACTIONS:
            raise ValueError(f"action_taken must be one of {VALID_ACTIONS}")
        return v


class IncidentStudentOut(BaseModel):
    id: UUID
    student_id: UUID
    enrollment_id: Optional[UUID]
    role: str
    action_taken: Optional[str]
    action_notes: Optional[str]
    parent_notified: bool
    parent_notified_at: Optional[datetime]
    # Joined fields
    student_name: Optional[str] = None
    admission_no: Optional[str] = None
    class_name: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Follow-up ─────────────────────────────────────────────────────────────────

class FollowupCreate(BaseModel):
    followup_date: date
    notes: str

    @field_validator("notes")
    @classmethod
    def notes_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("notes cannot be empty")
        return v.strip()


class FollowupOut(BaseModel):
    id: UUID
    incident_id: UUID
    followup_date: date
    notes: str
    created_by_user_id: Optional[UUID]
    created_at: datetime
    created_by_name: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Incident ──────────────────────────────────────────────────────────────────

class IncidentCreate(BaseModel):
    incident_date: date
    incident_type: str
    severity: str = "LOW"
    title: str
    description: Optional[str] = None
    location: Optional[str] = None
    students: List[IncidentStudentCreate] = []

    @field_validator("incident_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in VALID_TYPES:
            raise ValueError(f"incident_type must be one of {VALID_TYPES}")
        return v

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in VALID_SEVERITIES:
            raise ValueError(f"severity must be one of {VALID_SEVERITIES}")
        return v

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("title cannot be empty")
        return v.strip()


class IncidentUpdate(BaseModel):
    incident_date: Optional[date] = None
    incident_type: Optional[str] = None
    severity: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    resolution_notes: Optional[str] = None

    @field_validator("incident_type")
    @classmethod
    def validate_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().upper()
        if v not in VALID_TYPES:
            raise ValueError(f"incident_type must be one of {VALID_TYPES}")
        return v

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().upper()
        if v not in VALID_SEVERITIES:
            raise ValueError(f"severity must be one of {VALID_SEVERITIES}")
        return v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().upper()
        if v not in VALID_STATUSES:
            raise ValueError(f"status must be one of {VALID_STATUSES}")
        return v


class IncidentOut(BaseModel):
    id: UUID
    tenant_id: UUID
    incident_date: date
    incident_type: str
    severity: str
    title: str
    description: Optional[str]
    location: Optional[str]
    reported_by_user_id: Optional[UUID]
    status: str
    resolution_notes: Optional[str]
    resolved_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    reported_by_name: Optional[str] = None
    students: List[IncidentStudentOut] = []
    followups: List[FollowupOut] = []

    model_config = {"from_attributes": True}


class IncidentListItem(BaseModel):
    """Lightweight list view — no nested students/followups."""
    id: UUID
    incident_date: date
    incident_type: str
    severity: str
    title: str
    status: str
    location: Optional[str]
    reported_by_name: Optional[str] = None
    student_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Student delete ────────────────────────────────────────────────────────────

class StudentHardDeleteRequest(BaseModel):
    confirm: str  # Must equal "DELETE {admission_no}"


class StudentHardDeleteResult(BaseModel):
    ok: bool
    deleted_student_name: str
    admission_no: str
    records_removed: dict
