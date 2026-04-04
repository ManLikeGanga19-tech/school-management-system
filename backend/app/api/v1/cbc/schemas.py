"""Pydantic schemas for Phase 3B — CBC Assessments."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, field_validator

VALID_GRADE_BANDS = {"LOWER_PRIMARY", "UPPER_PRIMARY", "JUNIOR_SECONDARY"}
VALID_PERFORMANCE_LEVELS = {"BE", "AE", "ME", "EE"}


# ── Learning Area ─────────────────────────────────────────────────────────────

class LearningAreaCreate(BaseModel):
    name: str
    code: str
    grade_band: str
    display_order: int = 0

    @field_validator("grade_band")
    @classmethod
    def validate_band(cls, v: str) -> str:
        v = v.upper()
        if v not in VALID_GRADE_BANDS:
            raise ValueError(f"grade_band must be one of {sorted(VALID_GRADE_BANDS)}")
        return v

    @field_validator("code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        return v.strip().upper()


class LearningAreaUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    grade_band: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None

    @field_validator("grade_band")
    @classmethod
    def validate_band(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.upper()
            if v not in VALID_GRADE_BANDS:
                raise ValueError(f"grade_band must be one of {sorted(VALID_GRADE_BANDS)}")
        return v


class LearningAreaOut(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    code: str
    grade_band: str
    display_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Strand ────────────────────────────────────────────────────────────────────

class StrandCreate(BaseModel):
    learning_area_id: UUID
    name: str
    code: str
    display_order: int = 0

    @field_validator("code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        return v.strip().upper()


class StrandUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


class StrandOut(BaseModel):
    id: UUID
    tenant_id: UUID
    learning_area_id: UUID
    name: str
    code: str
    display_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Sub-strand ────────────────────────────────────────────────────────────────

class SubStrandCreate(BaseModel):
    strand_id: UUID
    name: str
    code: str
    display_order: int = 0

    @field_validator("code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        return v.strip().upper()


class SubStrandUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


class SubStrandOut(BaseModel):
    id: UUID
    tenant_id: UUID
    strand_id: UUID
    name: str
    code: str
    display_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Curriculum tree ───────────────────────────────────────────────────────────

class SubStrandNode(BaseModel):
    id: UUID
    name: str
    code: str
    display_order: int
    is_active: bool

    model_config = {"from_attributes": True}


class StrandNode(BaseModel):
    id: UUID
    name: str
    code: str
    display_order: int
    is_active: bool
    sub_strands: list[SubStrandNode] = []

    model_config = {"from_attributes": True}


class LearningAreaNode(BaseModel):
    id: UUID
    name: str
    code: str
    grade_band: str
    display_order: int
    is_active: bool
    strands: list[StrandNode] = []

    model_config = {"from_attributes": True}


class CurriculumTreeOut(BaseModel):
    learning_areas: list[LearningAreaNode] = []


# ── Assessment ────────────────────────────────────────────────────────────────

class AssessmentItem(BaseModel):
    sub_strand_id: UUID
    performance_level: str
    teacher_observations: Optional[str] = None

    @field_validator("performance_level")
    @classmethod
    def validate_level(cls, v: str) -> str:
        v = v.upper()
        if v not in VALID_PERFORMANCE_LEVELS:
            raise ValueError(f"performance_level must be one of {sorted(VALID_PERFORMANCE_LEVELS)}")
        return v


class BulkAssessmentUpsert(BaseModel):
    enrollment_id: UUID
    term_id: UUID
    assessments: list[AssessmentItem]


class AssessmentOut(BaseModel):
    id: UUID
    tenant_id: UUID
    enrollment_id: UUID
    student_id: UUID
    sub_strand_id: UUID
    term_id: UUID
    performance_level: str
    teacher_observations: Optional[str] = None
    assessed_by_user_id: Optional[UUID] = None
    assessed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Report ────────────────────────────────────────────────────────────────────

class ReportSubStrand(BaseModel):
    sub_strand_id: UUID
    sub_strand_name: str
    sub_strand_code: str
    performance_level: str
    teacher_observations: Optional[str] = None


class ReportStrand(BaseModel):
    strand_id: UUID
    strand_name: str
    strand_code: str
    sub_strands: list[ReportSubStrand] = []


class ReportLearningArea(BaseModel):
    learning_area_id: UUID
    learning_area_name: str
    learning_area_code: str
    grade_band: str
    strands: list[ReportStrand] = []


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
    learning_areas: list[ReportLearningArea] = []
