"""Pydantic schemas for the Reports API — Phase 3A (8-4-4 Report Cards)."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

_VALID_CONDUCT = {
    "EXCELLENT", "VERY GOOD", "GOOD", "SATISFACTORY", "UNSATISFACTORY"
}


# ── Subject result ─────────────────────────────────────────────────────────────

class SubjectResultOut(BaseModel):
    subject_id: str
    subject_name: str
    marks_obtained: float
    max_marks: float
    percentage: float
    grade: str
    grade_points: int
    remarks: Optional[str]


# ── Student report card ────────────────────────────────────────────────────────

class ReportCardOut(BaseModel):
    enrollment_id: str
    student_id: Optional[str]
    student_name: str
    admission_no: Optional[str]
    class_code: str
    term_id: str
    term_name: str

    subjects: list[SubjectResultOut]
    total_marks: float
    mean_percentage: float
    mean_grade_points: float
    mean_grade: str
    position: Optional[int]
    out_of: Optional[int]

    # Attendance (Phase 2)
    attendance_total: Optional[int]
    attendance_present: Optional[int]
    attendance_rate: Optional[float]

    # Remarks (from term_report_remarks)
    remarks_id: Optional[str]
    class_teacher_comment: Optional[str]
    principal_comment: Optional[str]
    conduct: Optional[str]
    next_term_begins: Optional[str]
    status: str  # DRAFT / PUBLISHED


# ── Class results summary ──────────────────────────────────────────────────────

class ClassResultRow(BaseModel):
    enrollment_id: str
    student_id: Optional[str]
    student_name: str
    admission_no: Optional[str]
    total_marks: float
    mean_percentage: float
    mean_grade: str
    position: int
    subjects_sat: int


# ── Remarks update ─────────────────────────────────────────────────────────────

class RemarksUpsertIn(BaseModel):
    class_teacher_comment: Optional[str] = Field(default=None, max_length=1000)
    principal_comment: Optional[str] = Field(default=None, max_length=1000)
    conduct: Optional[str] = Field(default=None)
    next_term_begins: Optional[str] = Field(default=None, description="ISO date string")


class RemarksOut(BaseModel):
    id: str
    enrollment_id: str
    term_id: str
    class_code: str
    class_teacher_comment: Optional[str]
    principal_comment: Optional[str]
    conduct: Optional[str]
    next_term_begins: Optional[str]
    status: str
    published_at: Optional[str]
