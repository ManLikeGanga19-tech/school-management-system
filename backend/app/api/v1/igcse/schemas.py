"""IGCSE Assessment schemas."""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from pydantic import BaseModel


# ── Subjects ──────────────────────────────────────────────────────────────────

class SubjectCreate(BaseModel):
    name: str
    code: str
    display_order: int = 0
    is_active: bool = True


class SubjectUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


class SubjectOut(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    code: str
    display_order: int
    is_active: bool

    model_config = {"from_attributes": True}


# ── Scores ────────────────────────────────────────────────────────────────────

class ScoreItem(BaseModel):
    subject_id: UUID
    grade: Optional[str] = None
    percentage: Optional[float] = None
    effort: Optional[str] = None
    teacher_comment: Optional[str] = None


class BulkScoreUpsert(BaseModel):
    enrollment_id: UUID
    term_id: UUID
    scores: list[ScoreItem]


class ScoreOut(BaseModel):
    id: UUID
    tenant_id: UUID
    enrollment_id: UUID
    student_id: Optional[UUID]
    subject_id: UUID
    term_id: UUID
    grade: Optional[str]
    percentage: Optional[float]
    effort: Optional[str]
    teacher_comment: Optional[str]
    assessed_by_user_id: Optional[UUID]

    model_config = {"from_attributes": True}


# ── Report ────────────────────────────────────────────────────────────────────

class SubjectReportItem(BaseModel):
    subject_name: str
    subject_code: str
    grade: str = ""
    percentage: Optional[float] = None
    effort: str = ""
    teacher_comment: str = ""


class LearnerReportOut(BaseModel):
    enrollment_id: UUID
    student_id: UUID
    student_name: str
    admission_no: str
    gender: str = ""
    date_of_birth: str = ""
    class_name: str
    class_code: str = ""
    term_name: str
    academic_year: str = ""
    class_teacher_comment: str = ""
    principal_comment: str = ""
    conduct: str = ""
    next_term_begins: str = ""
    subjects: list[SubjectReportItem] = []
