"""Pydantic schemas for the Attendance API — Phase 2."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

_VALID_SESSION_TYPES = {"MORNING", "AFTERNOON", "PERIOD"}
_VALID_ATTENDANCE_STATUSES = {"PRESENT", "ABSENT", "LATE", "EXCUSED", "OFF_GROUNDS"}
_VALID_ENROLLMENT_STATUSES = {"ACTIVE", "WITHDRAWN", "TRANSFERRED"}


# ── Student-class enrollment ──────────────────────────────────────────────────

class EnrollStudentIn(BaseModel):
    student_id: str = Field(min_length=36, max_length=36)
    term_id: str = Field(min_length=36, max_length=36)
    notes: Optional[str] = Field(default=None, max_length=500)


class EnrollmentOut(BaseModel):
    id: str
    tenant_id: str
    student_id: str
    class_id: str
    term_id: str
    status: str
    enrolled_at: Optional[str]
    withdrawn_at: Optional[str]
    notes: Optional[str]
    # Joined fields
    student_name: Optional[str] = None
    admission_no: Optional[str] = None


class WithdrawEnrollmentIn(BaseModel):
    status: str = Field(default="WITHDRAWN")
    notes: Optional[str] = Field(default=None, max_length=500)


# ── Attendance sessions ───────────────────────────────────────────────────────

class SessionCreateIn(BaseModel):
    class_id: str = Field(min_length=36, max_length=36)
    term_id: str = Field(min_length=36, max_length=36)
    session_date: str = Field(description="ISO date string, e.g. 2026-03-15")
    session_type: str = Field(default="MORNING")
    period_number: Optional[int] = Field(default=None, ge=1, le=20)
    subject_id: Optional[str] = Field(default=None, min_length=36, max_length=36)
    notes: Optional[str] = Field(default=None, max_length=500)


class SessionOut(BaseModel):
    id: str
    tenant_id: str
    class_id: str
    term_id: str
    subject_id: Optional[str]
    session_date: str
    session_type: str
    period_number: Optional[int]
    status: str
    notes: Optional[str]
    marked_by_user_id: Optional[str]
    submitted_at: Optional[str]
    finalized_by_user_id: Optional[str]
    finalized_at: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]
    records: Optional[list[AttendanceRecordOut]] = None


# ── Attendance records ────────────────────────────────────────────────────────

class AttendanceRecordIn(BaseModel):
    student_id: str = Field(min_length=36, max_length=36)
    status: str = Field(default="PRESENT")
    notes: Optional[str] = Field(default=None, max_length=500)


class BulkRecordsIn(BaseModel):
    records: list[AttendanceRecordIn] = Field(min_length=1)


class AttendanceRecordOut(BaseModel):
    id: str
    tenant_id: str
    session_id: str
    enrollment_id: str
    student_id: str
    status: str
    notes: Optional[str]
    original_status: Optional[str]
    corrected_by_user_id: Optional[str]
    corrected_at: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]
    # Joined
    student_name: Optional[str] = None
    admission_no: Optional[str] = None


class CorrectRecordIn(BaseModel):
    status: str
    notes: Optional[str] = Field(default=None, max_length=500)


# ── Reports ───────────────────────────────────────────────────────────────────

class StudentAttendanceSummary(BaseModel):
    student_id: str
    term_id: str
    total_sessions: int
    present: int
    absent: int
    late: int
    excused: int
    off_grounds: int
    attendance_rate: float  # 0.0–1.0


class ClassRosterReportRow(BaseModel):
    student_id: str
    student_name: str
    admission_no: Optional[str]
    total_sessions: int
    present: int
    absent: int
    late: int
    excused: int
    off_grounds: int
    attendance_rate: float


# Forward-reference resolution
SessionOut.model_rebuild()
