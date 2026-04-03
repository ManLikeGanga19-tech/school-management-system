from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Any, Optional, List, Literal
from uuid import UUID, uuid4
	
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, Field

from sqlalchemy.orm import Session
from sqlalchemy import select, and_
import sqlalchemy as sa
from sqlalchemy.exc import ProgrammingError, OperationalError, InternalError

from app.core.database import get_db
from app.core.dependencies import get_tenant, get_current_user, require_permission

from app.models.tenant import Tenant
from app.models.user import User
from app.models.membership import UserTenant
from app.models.tenant_print_profile import TenantPrintProfile

from app.models.rbac import (
    Role,
    Permission,
    RolePermission,
    UserRole,
    UserPermissionOverride,
)
from app.utils.hashing import hash_password, verify_password
from app.api.v1.support import service as support_service

router = APIRouter()


# ---------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------

class TenantCreate(BaseModel):
    slug: str = Field(..., min_length=2, max_length=80)
    name: str = Field(..., min_length=2, max_length=200)
    primary_domain: Optional[str] = Field(default=None, max_length=255)
    is_active: bool = True
    director_email: Optional[str] = None
    director_password: Optional[str] = None
    director_full_name: Optional[str] = None
    director_phone: Optional[str] = None


class TenantUpdate(BaseModel):
    # Super Admin can update these
    slug: Optional[str] = Field(default=None, min_length=2, max_length=80)
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    primary_domain: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None


_CURRICULUM_TYPES = {"CBC", "8-4-4", "IGCSE"}


class TenantSelfUpdate(BaseModel):
    # Director can update limited fields within their tenant
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    curriculum_type: Optional[str] = Field(default=None, max_length=20)


class RoleCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=60)
    name: str = Field(..., min_length=2, max_length=120)
    description: Optional[str] = Field(default=None, max_length=255)


class RoleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    description: Optional[str] = Field(default=None, max_length=255)


class RolePermissionsSet(BaseModel):
    permission_codes: List[str] = Field(default_factory=list)


class UserRoleAssign(BaseModel):
    role_code: str = Field(..., min_length=2, max_length=60)


class UserPermissionOverrideIn(BaseModel):
    permission_code: str
    effect: Literal["ALLOW", "DENY"]
    reason: Optional[str] = None


class UserPermissionOverridesSet(BaseModel):
    overrides: List[UserPermissionOverrideIn] = Field(default_factory=list)


# ✅ Tenant classes output schema (for /tenants/classes)
class TenantClassOut(BaseModel):
    id: str
    code: str
    name: str
    is_active: bool = True


class TenantClassCreateIn(BaseModel):
    code: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=160)
    is_active: bool = True


class TenantClassUpdateIn(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=80)
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    is_active: Optional[bool] = None


class TenantTermOut(BaseModel):
    id: str
    code: str
    name: str
    is_active: bool = True
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class TenantTermCreateIn(BaseModel):
    code: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=160)
    is_active: bool = True
    start_date: Optional[str] = Field(default=None, max_length=32)
    end_date: Optional[str] = Field(default=None, max_length=32)


class TenantTermUpdateIn(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=80)
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    is_active: Optional[bool] = None
    start_date: Optional[str] = Field(default=None, max_length=32)
    end_date: Optional[str] = Field(default=None, max_length=32)


class TenantSchoolCalendarEventOut(BaseModel):
    id: str
    academic_year: int
    event_type: Literal["HALF_TERM_BREAK", "EXAM_WINDOW"]
    title: str
    term_code: Optional[str] = None
    start_date: str
    end_date: str
    notes: Optional[str] = None
    is_active: bool = True


class TenantSchoolCalendarEventCreateIn(BaseModel):
    academic_year: Optional[int] = Field(default=None, ge=2000, le=2100)
    event_type: Literal["HALF_TERM_BREAK", "EXAM_WINDOW"]
    title: str = Field(..., min_length=2, max_length=160)
    term_code: Optional[str] = Field(default=None, max_length=80)
    start_date: str = Field(..., max_length=32)
    end_date: str = Field(..., max_length=32)
    notes: Optional[str] = Field(default=None, max_length=500)
    is_active: bool = True


class TenantSchoolCalendarEventUpdateIn(BaseModel):
    academic_year: Optional[int] = Field(default=None, ge=2000, le=2100)
    title: Optional[str] = Field(default=None, min_length=2, max_length=160)
    term_code: Optional[str] = Field(default=None, max_length=80)
    start_date: Optional[str] = Field(default=None, max_length=32)
    end_date: Optional[str] = Field(default=None, max_length=32)
    notes: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None


class TenantSubjectOut(BaseModel):
    id: str
    code: str
    name: str
    is_active: bool = True


class TenantSubjectCreateIn(BaseModel):
    code: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=160)
    is_active: bool = True


class TenantSubjectUpdateIn(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=80)
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    is_active: Optional[bool] = None


class TenantSchoolTimetableOut(BaseModel):
    id: str
    term_id: str
    term_code: Optional[str] = None
    term_name: Optional[str] = None
    class_code: str
    day_of_week: str
    slot_type: str
    title: str
    subject_id: Optional[str] = None
    subject_code: Optional[str] = None
    subject_name: Optional[str] = None
    staff_id: Optional[str] = None
    staff_no: Optional[str] = None
    staff_name: Optional[str] = None
    start_time: str
    end_time: str
    location: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TenantSchoolTimetableCreateIn(BaseModel):
    term_id: str = Field(..., max_length=64)
    class_code: str = Field(..., min_length=1, max_length=80)
    day_of_week: str = Field(..., min_length=2, max_length=16)
    slot_type: str = Field(default="LESSON", min_length=2, max_length=32)
    title: Optional[str] = Field(default=None, max_length=200)
    subject_id: Optional[str] = Field(default=None, max_length=64)
    staff_id: Optional[str] = Field(default=None, max_length=64)
    start_time: str = Field(..., min_length=4, max_length=32)
    end_time: str = Field(..., min_length=4, max_length=32)
    location: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=1000)
    is_active: bool = True


class TenantSchoolTimetableUpdateIn(BaseModel):
    term_id: Optional[str] = Field(default=None, max_length=64)
    class_code: Optional[str] = Field(default=None, min_length=1, max_length=80)
    day_of_week: Optional[str] = Field(default=None, min_length=2, max_length=16)
    slot_type: Optional[str] = Field(default=None, min_length=2, max_length=32)
    title: Optional[str] = Field(default=None, max_length=200)
    subject_id: Optional[str] = Field(default=None, max_length=64)
    staff_id: Optional[str] = Field(default=None, max_length=64)
    start_time: Optional[str] = Field(default=None, min_length=4, max_length=32)
    end_time: Optional[str] = Field(default=None, min_length=4, max_length=32)
    location: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=1000)
    is_active: Optional[bool] = None


class TenantSchoolTimetableBreakApplyIn(BaseModel):
    day_of_week: str = Field(..., min_length=2, max_length=16)
    slot_type: str = Field(..., min_length=2, max_length=32)
    start_time: str = Field(..., min_length=4, max_length=32)
    end_time: str = Field(..., min_length=4, max_length=32)
    title: Optional[str] = Field(default=None, max_length=200)
    location: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=1000)
    is_active: bool = True
    term_ids: Optional[list[str]] = Field(default=None)
    class_codes: Optional[list[str]] = Field(default=None)


class TenantSchoolTimetableBreakApplyOut(BaseModel):
    day_of_week: str
    slot_type: str
    start_time: str
    end_time: str
    affected_terms: int
    affected_classes: int
    upserted_entries: int


class TenantStaffOut(BaseModel):
    id: str
    staff_no: str
    staff_type: str
    role_code: Optional[str] = None
    primary_subject_id: Optional[str] = None
    primary_subject_code: Optional[str] = None
    primary_subject_name: Optional[str] = None
    employment_type: Optional[str] = None
    first_name: str
    last_name: str
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    id_number: Optional[str] = None
    tsc_number: Optional[str] = None
    kra_pin: Optional[str] = None
    nssf_number: Optional[str] = None
    nhif_number: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[str] = None
    date_hired: Optional[str] = None
    next_of_kin_name: Optional[str] = None
    next_of_kin_relation: Optional[str] = None
    next_of_kin_phone: Optional[str] = None
    next_of_kin_email: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    separation_status: Optional[str] = None
    separation_reason: Optional[str] = None
    separation_date: Optional[str] = None
    is_active: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TenantStaffCreateIn(BaseModel):
    staff_no: Optional[str] = Field(default=None, max_length=64)
    staff_type: str = Field(default="TEACHING", max_length=32)
    role_code: Optional[str] = Field(default=None, max_length=60)
    primary_subject_id: Optional[str] = Field(default=None, max_length=64)
    employment_type: Optional[str] = Field(default=None, max_length=32)
    first_name: str = Field(..., min_length=1, max_length=120)
    last_name: str = Field(..., min_length=1, max_length=120)
    email: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=64)
    id_number: Optional[str] = Field(default=None, max_length=64)
    tsc_number: Optional[str] = Field(default=None, max_length=64)
    kra_pin: Optional[str] = Field(default=None, max_length=64)
    nssf_number: Optional[str] = Field(default=None, max_length=64)
    nhif_number: Optional[str] = Field(default=None, max_length=64)
    gender: Optional[str] = Field(default=None, max_length=16)
    date_of_birth: Optional[str] = Field(default=None, max_length=32)
    date_hired: Optional[str] = Field(default=None, max_length=32)
    next_of_kin_name: Optional[str] = Field(default=None, max_length=200)
    next_of_kin_relation: Optional[str] = Field(default=None, max_length=120)
    next_of_kin_phone: Optional[str] = Field(default=None, max_length=64)
    next_of_kin_email: Optional[str] = Field(default=None, max_length=255)
    address: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = Field(default=None, max_length=1000)
    is_active: bool = True


class TenantStaffUpdateIn(BaseModel):
    staff_no: Optional[str] = Field(default=None, max_length=64)
    staff_type: Optional[str] = Field(default=None, max_length=32)
    role_code: Optional[str] = Field(default=None, max_length=60)
    primary_subject_id: Optional[str] = Field(default=None, max_length=64)
    employment_type: Optional[str] = Field(default=None, max_length=32)
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    last_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    email: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=64)
    id_number: Optional[str] = Field(default=None, max_length=64)
    tsc_number: Optional[str] = Field(default=None, max_length=64)
    kra_pin: Optional[str] = Field(default=None, max_length=64)
    nssf_number: Optional[str] = Field(default=None, max_length=64)
    nhif_number: Optional[str] = Field(default=None, max_length=64)
    gender: Optional[str] = Field(default=None, max_length=16)
    date_of_birth: Optional[str] = Field(default=None, max_length=32)
    date_hired: Optional[str] = Field(default=None, max_length=32)
    next_of_kin_name: Optional[str] = Field(default=None, max_length=200)
    next_of_kin_relation: Optional[str] = Field(default=None, max_length=120)
    next_of_kin_phone: Optional[str] = Field(default=None, max_length=64)
    next_of_kin_email: Optional[str] = Field(default=None, max_length=255)
    address: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = Field(default=None, max_length=1000)
    separation_status: Optional[str] = Field(default=None, max_length=32)
    separation_reason: Optional[str] = Field(default=None, max_length=1000)
    separation_date: Optional[str] = Field(default=None, max_length=32)
    is_active: Optional[bool] = None


class TenantAssetOut(BaseModel):
    id: str
    asset_code: str
    name: str
    category: str
    description: Optional[str] = None
    condition_status: str
    is_active: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TenantAssetCreateIn(BaseModel):
    asset_code: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    condition_status: str = Field(default="AVAILABLE", max_length=32)
    is_active: bool = True


class TenantAssetUpdateIn(BaseModel):
    asset_code: Optional[str] = Field(default=None, min_length=1, max_length=80)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    condition_status: Optional[str] = Field(default=None, max_length=32)
    is_active: Optional[bool] = None


class TeacherAssignmentOut(BaseModel):
    id: str
    staff_id: str
    staff_no: str
    staff_name: str
    subject_id: str
    subject_code: str
    subject_name: str
    class_code: str
    is_active: bool = True
    assigned_at: Optional[str] = None
    notes: Optional[str] = None


class TeacherAssignmentCreateIn(BaseModel):
    staff_id: str
    subject_id: str
    class_code: str = Field(..., min_length=1, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=500)
    is_active: bool = True


class TeacherAssignmentUpdateIn(BaseModel):
    staff_id: Optional[str] = None
    subject_id: Optional[str] = None
    class_code: Optional[str] = Field(default=None, min_length=1, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None


class ClassTeacherAssignmentOut(BaseModel):
    id: str
    staff_id: str
    staff_no: str
    staff_name: str
    class_code: str
    is_active: bool = True
    assigned_at: Optional[str] = None
    notes: Optional[str] = None


class ClassTeacherAssignmentCreateIn(BaseModel):
    staff_id: str
    class_code: str = Field(..., min_length=1, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=500)
    is_active: bool = True


class ClassTeacherAssignmentUpdateIn(BaseModel):
    staff_id: Optional[str] = None
    class_code: Optional[str] = Field(default=None, min_length=1, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None


class AssetAssignmentOut(BaseModel):
    id: str
    asset_id: str
    asset_code: str
    asset_name: str
    assignee_type: str = "STAFF"
    staff_id: Optional[str] = None
    staff_no: Optional[str] = None
    staff_name: Optional[str] = None
    class_code: Optional[str] = None
    enrollment_id: Optional[str] = None
    student_name: Optional[str] = None
    status: str
    due_at: Optional[str] = None
    is_overdue: bool = False
    assigned_at: Optional[str] = None
    returned_at: Optional[str] = None
    notes: Optional[str] = None


class AssetAssignmentCreateIn(BaseModel):
    asset_id: str
    assignee_type: Literal["STAFF", "CLASS", "STUDENT"] = "STAFF"
    staff_id: Optional[str] = None
    class_code: Optional[str] = Field(default=None, max_length=80)
    enrollment_id: Optional[str] = None
    due_at: Optional[str] = Field(default=None, max_length=64)
    notes: Optional[str] = Field(default=None, max_length=500)


class AssetAssignmentReturnIn(BaseModel):
    returned_at: Optional[str] = Field(default=None, max_length=32)
    notes: Optional[str] = Field(default=None, max_length=500)


class TenantNotificationOut(BaseModel):
    id: str
    type: str
    severity: str
    title: str
    message: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    created_at: str
    due_at: Optional[str] = None
    unread: bool = True


class StudentClearanceOut(BaseModel):
    enrollment_id: str
    student_name: str
    admission_number: Optional[str] = None
    class_code: str
    term_code: str
    status: str
    nemis_no: Optional[str] = None
    assessment_no: Optional[str] = None
    fees_status: str
    fees_balance: str
    fees_cleared: bool = False
    outstanding_assets: int = 0
    assets_cleared: bool = True
    grade9_candidate: bool = False
    transfer_requested: bool = False
    transfer_approved: bool = False
    ready_for_transfer_request: bool = False
    ready_for_director_approval: bool = False
    blockers: list[str] = Field(default_factory=list)
    transfer_requested_at: Optional[str] = None
    transfer_approved_at: Optional[str] = None


class StudentTransferRequestIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class StudentTransferApproveIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class TenantExamOut(BaseModel):
    id: str
    name: str
    term_id: Optional[str] = None
    term_code: Optional[str] = None
    term_name: Optional[str] = None
    class_code: str
    subject_id: Optional[str] = None
    subject_code: Optional[str] = None
    subject_name: Optional[str] = None
    invigilator_staff_id: Optional[str] = None
    invigilator_staff_no: Optional[str] = None
    invigilator_name: Optional[str] = None
    start_date: str
    end_date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    status: str
    location: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TenantExamCreateIn(BaseModel):
    name: str = Field(default="", max_length=160)
    term_id: str = Field(default="", max_length=64)
    class_code: str = Field(default="", max_length=80)
    subject_id: Optional[str] = Field(default=None, max_length=64)
    invigilator_staff_id: Optional[str] = Field(default=None, max_length=64)
    start_date: Optional[str] = Field(default=None, max_length=32)
    end_date: Optional[str] = Field(default=None, max_length=32)
    start_time: Optional[str] = Field(default=None, max_length=32)
    end_time: Optional[str] = Field(default=None, max_length=32)
    status: str = Field(default="SCHEDULED", max_length=32)
    location: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = Field(default=None, max_length=1000)
    is_active: bool = True


class TenantExamUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    term_id: Optional[str] = Field(default=None, max_length=64)
    class_code: Optional[str] = Field(default=None, min_length=1, max_length=80)
    subject_id: Optional[str] = Field(default=None, max_length=64)
    invigilator_staff_id: Optional[str] = Field(default=None, max_length=64)
    start_date: Optional[str] = Field(default=None, max_length=32)
    end_date: Optional[str] = Field(default=None, max_length=32)
    start_time: Optional[str] = Field(default=None, max_length=32)
    end_time: Optional[str] = Field(default=None, max_length=32)
    status: Optional[str] = Field(default=None, max_length=32)
    location: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = Field(default=None, max_length=1000)
    is_active: Optional[bool] = None


class TenantExamMarkOut(BaseModel):
    id: str
    exam_id: str
    exam_name: str
    term_id: Optional[str] = None
    term_code: Optional[str] = None
    term_name: Optional[str] = None
    class_code: str
    subject_id: str
    subject_code: Optional[str] = None
    subject_name: Optional[str] = None
    student_enrollment_id: str
    student_name: str
    admission_number: Optional[str] = None
    marks_obtained: str
    max_marks: str
    grade: Optional[str] = None
    remarks: Optional[str] = None
    recorded_at: Optional[str] = None
    updated_at: Optional[str] = None


class TenantExamMarkUpsertIn(BaseModel):
    exam_id: str
    student_enrollment_id: str
    subject_id: str
    class_code: Optional[str] = Field(default=None, max_length=80)
    marks_obtained: str
    max_marks: str = Field(default="100")
    grade: Optional[str] = Field(default=None, max_length=16)
    remarks: Optional[str] = Field(default=None, max_length=500)


class TenantEventOut(BaseModel):
    id: str
    name: str
    term_id: Optional[str] = None
    term_code: Optional[str] = None
    term_name: Optional[str] = None
    academic_year: int
    start_date: str
    end_date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    target_scope: str
    class_codes: list[str] = Field(default_factory=list)
    student_enrollment_ids: list[str] = Field(default_factory=list)
    student_names: list[str] = Field(default_factory=list)
    is_active: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TenantEventCreateIn(BaseModel):
    name: str = Field(default="", max_length=160)
    term_id: str = Field(default="", max_length=64)
    academic_year: Optional[int] = Field(default=None, ge=2000, le=2200)
    start_date: Optional[str] = Field(default=None, max_length=32)
    end_date: Optional[str] = Field(default=None, max_length=32)
    start_time: Optional[str] = Field(default=None, max_length=32)
    end_time: Optional[str] = Field(default=None, max_length=32)
    location: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    class_codes: list[str] = Field(default_factory=list)
    student_enrollment_ids: list[str] = Field(default_factory=list)
    is_active: bool = True


class TenantEventUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    term_id: Optional[str] = Field(default=None, max_length=64)
    academic_year: Optional[int] = Field(default=None, ge=2000, le=2200)
    start_date: Optional[str] = Field(default=None, max_length=32)
    end_date: Optional[str] = Field(default=None, max_length=32)
    start_time: Optional[str] = Field(default=None, max_length=32)
    end_time: Optional[str] = Field(default=None, max_length=32)
    location: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    class_codes: Optional[list[str]] = None
    student_enrollment_ids: Optional[list[str]] = None
    is_active: Optional[bool] = None


class SecretaryUserOut(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    is_active: bool = True


class SecretaryAuditOut(BaseModel):
    id: str
    action: str
    resource: str
    created_at: str


class SecretaryDashboardOut(BaseModel):
    me: dict | None
    summary: dict | None
    enrollments: list[dict]
    invoices: list[dict]
    users: list[SecretaryUserOut]
    audit: list[SecretaryAuditOut]
    health: dict


class PrincipalDashboardOut(BaseModel):
    me: dict | None
    summary: dict | None
    enrollments: list[dict]
    exams: list[TenantExamOut]
    events: list[TenantEventOut]
    teacher_assignments: list[TeacherAssignmentOut]
    timetable_entries: list[TenantSchoolTimetableOut]
    notifications: list[TenantNotificationOut]
    unread_notifications: int = 0
    health: dict


class DirectorPermissionOut(BaseModel):
    id: str
    code: str
    name: str
    description: Optional[str] = None


class DirectorRoleOut(BaseModel):
    id: str
    code: str
    name: str
    description: Optional[str] = None


class DirectorUserOut(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    is_active: bool = True
    roles: list[str] = Field(default_factory=list)


class DirectorUserUpdateIn(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=160)
    email: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)


class DirectorStaffCandidateOut(BaseModel):
    staff_id: str
    staff_no: str
    full_name: str
    email: str
    staff_type: str
    role_code: Optional[str] = None
    has_account: bool
    user_id: Optional[str] = None


class DirectorUserCredentialIn(BaseModel):
    staff_id: str
    password: str = Field(..., min_length=8, max_length=128)
    role_code: Optional[str] = Field(default=None, max_length=60)


class DirectorUserCredentialOut(BaseModel):
    user_id: str
    staff_id: str
    email: str
    full_name: Optional[str] = None
    role_code: Optional[str] = None
    created_user: bool
    updated_password: bool
    membership_created: bool
    role_assigned: bool


class DirectorUserRoleActionIn(BaseModel):
    mode: Literal["assign", "remove"]
    user_id: str
    role_code: str = Field(..., min_length=2, max_length=60)


class DirectorUserDeleteOut(BaseModel):
    ok: bool
    user_id: str
    membership_deactivated: bool
    user_deactivated: bool
    roles_removed: int = 0
    overrides_removed: int = 0


class DirectorPermissionOverrideOut(BaseModel):
    user_id: str
    email: str
    full_name: Optional[str] = None
    permission_code: str
    effect: str
    reason: Optional[str] = None


class TenantPrintProfileOut(BaseModel):
    tenant_id: str
    logo_url: Optional[str] = None
    school_header: Optional[str] = None
    receipt_footer: Optional[str] = None
    paper_size: str = "A4"
    currency: str = "KES"
    thermal_width_mm: int = 80
    qr_enabled: bool = True
    po_box: Optional[str] = None
    physical_address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    school_motto: Optional[str] = None
    authorized_signatory_name: Optional[str] = None
    authorized_signatory_title: Optional[str] = None


class TenantPrintProfileUpsert(BaseModel):
    school_header: Optional[str] = Field(default=None, max_length=500)
    receipt_footer: Optional[str] = Field(default=None, max_length=500)
    paper_size: Literal["A4", "THERMAL_80MM"] = "A4"
    currency: str = Field(default="KES", min_length=3, max_length=10)
    thermal_width_mm: int = Field(default=80, ge=58, le=120)
    qr_enabled: bool = True
    po_box: Optional[str] = Field(default=None, max_length=100)
    physical_address: Optional[str] = None
    phone: Optional[str] = Field(default=None, max_length=50)
    email: Optional[str] = Field(default=None, max_length=255)
    school_motto: Optional[str] = Field(default=None, max_length=500)
    authorized_signatory_name: Optional[str] = Field(default=None, max_length=200)
    authorized_signatory_title: Optional[str] = Field(default=None, max_length=200)


class TenantSettingsPasswordSelfIn(BaseModel):
    current_password: Optional[str] = Field(default=None, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class TenantSettingsPasswordSecretaryIn(BaseModel):
    secretary_user_id: str
    new_password: str = Field(..., min_length=8, max_length=128)


class TenantSettingsPasswordResetOut(BaseModel):
    ok: bool = True
    user_id: str
    email: str


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _normalize_slug(value: str) -> str:
    return value.strip().lower()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _get_role_by_code(db: Session, *, tenant_id: UUID, role_code: str) -> Role | None:
    # tenant role OR global system role
    return db.execute(
        select(Role).where(
            Role.code == role_code,
            sa.or_(Role.tenant_id.is_(None), Role.tenant_id == tenant_id),
        )
    ).scalar_one_or_none()


def _ensure_user_in_tenant(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    include_inactive: bool = False,
) -> None:
    conditions = [
        UserTenant.tenant_id == tenant_id,
        UserTenant.user_id == user_id,
    ]
    if not include_inactive:
        conditions.append(UserTenant.is_active == True)

    membership = db.execute(
        select(UserTenant).where(and_(*conditions))
    ).scalar_one_or_none()

    if not membership:
        detail = "User does not belong to this tenant" if include_inactive else "User is not active in this tenant"
        raise HTTPException(status_code=400, detail=detail)


def _safe_db_missing_table(err: Exception) -> bool:
    """
    Detect missing table / missing relation in a DB-agnostic-ish way.
    Works for Postgres + psycopg and many common SQLAlchemy configurations.
    """
    msg = str(err).lower()
    return (
        "does not exist" in msg
        or "undefinedtable" in msg
        or "no such table" in msg
        or "relation" in msg and "does not exist" in msg
    )


def _require_any_permission(*codes: str):
    required_codes = tuple(c for c in codes if c and c.strip())

    def _checker(
        request: Request,
        _user=Depends(get_current_user),
    ):
        perms = set(getattr(request.state, "permissions", []) or [])
        if any(code in perms for code in required_codes):
            return

        if not required_codes:
            raise HTTPException(status_code=403, detail="Missing permission")

        raise HTTPException(
            status_code=403,
            detail=f"Missing permission: any of {', '.join(required_codes)}",
        )

    return _checker


def _permission_rows_payload(perms: list[Permission]) -> list[dict]:
    return [
        {
            "id": str(p.id),
            "code": p.code,
            "name": p.name,
            "description": p.description,
        }
        for p in perms
    ]


def _request_permissions(request: Request) -> set[str]:
    raw = getattr(request.state, "permissions", []) or []
    return {str(code) for code in raw if isinstance(code, str)}


def _request_roles(request: Request) -> set[str]:
    raw = getattr(request.state, "roles", []) or []
    return {
        str(role).strip().upper()
        for role in raw
        if isinstance(role, str) and str(role).strip()
    }


def _is_director_context(request: Request) -> bool:
    roles = _request_roles(request)
    return bool({"DIRECTOR", "SUPER_ADMIN"} & roles)


def _normalize_separation_status(value: Optional[str]) -> Optional[str]:
    cleaned = _text_or_none(value, upper=True)
    if cleaned in {None, "ACTIVE", "NONE", "EMPLOYED"}:
        return None
    if cleaned in {"FIRED_MISCONDUCT", "LEFT_PERMANENTLY"}:
        return cleaned
    raise HTTPException(status_code=400, detail="Invalid separation_status")


def _parse_uuid(value: Any, *, field: str) -> UUID:
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except Exception:
        raise HTTPException(status_code=400, detail=f"{field} must be a valid UUID")


def _validated_password(value: str) -> str:
    password = str(value or "").strip()
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")
    if not any(ch.isalpha() for ch in password) or not any(ch.isdigit() for ch in password):
        raise HTTPException(
            status_code=400,
            detail="password must include at least one letter and one number",
        )
    return password


def _parse_decimal(value: Any, *, field: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} must be a valid number")


def _serialize_finance_policy(row: Any) -> dict:
    return {
        "allow_partial_enrollment": bool(getattr(row, "allow_partial_enrollment", False)),
        "min_percent_to_enroll": getattr(row, "min_percent_to_enroll", None),
        "min_amount_to_enroll": (
            str(getattr(row, "min_amount_to_enroll"))
            if getattr(row, "min_amount_to_enroll", None) is not None
            else None
        ),
        "require_interview_fee_before_submit": bool(
            getattr(row, "require_interview_fee_before_submit", True)
        ),
    }


def _serialize_structure_policy(row: Any) -> dict:
    return {
        "id": str(getattr(row, "id")),
        "fee_structure_id": str(getattr(row, "fee_structure_id")),
        "fee_item_id": (
            str(getattr(row, "fee_item_id"))
            if getattr(row, "fee_item_id", None) is not None
            else None
        ),
        "allow_partial_enrollment": bool(getattr(row, "allow_partial_enrollment", False)),
        "min_percent_to_enroll": getattr(row, "min_percent_to_enroll", None),
        "min_amount_to_enroll": (
            str(getattr(row, "min_amount_to_enroll"))
            if getattr(row, "min_amount_to_enroll", None) is not None
            else None
        ),
    }


def _serialize_invoice(row: Any) -> dict:
    return {
        "id": str(getattr(row, "id")),
        "invoice_no": (
            str(getattr(row, "invoice_no"))
            if getattr(row, "invoice_no", None) is not None
            else None
        ),
        "invoice_type": str(getattr(row, "invoice_type", "") or ""),
        "status": str(getattr(row, "status", "") or ""),
        "enrollment_id": (
            str(getattr(row, "enrollment_id"))
            if getattr(row, "enrollment_id", None) is not None
            else None
        ),
        "currency": str(getattr(row, "currency", "KES") or "KES"),
        "total_amount": str(getattr(row, "total_amount", 0) or 0),
        "paid_amount": str(getattr(row, "paid_amount", 0) or 0),
        "balance_amount": str(getattr(row, "balance_amount", 0) or 0),
    }


def _serialize_fee_category(row: Any) -> dict:
    return {
        "id": str(getattr(row, "id")),
        "code": str(getattr(row, "code", "") or ""),
        "name": str(getattr(row, "name", "") or ""),
        "is_active": bool(getattr(row, "is_active", True)),
    }


def _serialize_fee_item(row: Any) -> dict:
    return {
        "id": str(getattr(row, "id")),
        "category_id": str(getattr(row, "category_id")),
        "code": str(getattr(row, "code", "") or ""),
        "name": str(getattr(row, "name", "") or ""),
        "charge_frequency": str(getattr(row, "charge_frequency", "PER_TERM") or "PER_TERM"),
        "is_active": bool(getattr(row, "is_active", True)),
    }


def _serialize_fee_structure(row: Any) -> dict:
    return {
        "id": str(getattr(row, "id")),
        "structure_no": (
            str(getattr(row, "structure_no"))
            if getattr(row, "structure_no", None) is not None
            else None
        ),
        "class_code": str(getattr(row, "class_code", "") or ""),
        "academic_year": int(getattr(row, "academic_year", 0) or 0),
        "student_type": str(getattr(row, "student_type", "RETURNING") or "RETURNING"),
        "name": str(getattr(row, "name", "") or ""),
        "is_active": bool(getattr(row, "is_active", True)),
    }


def _serialize_structure_item(item: dict[str, Any]) -> dict:
    return {
        "fee_item_id": str(item.get("fee_item_id") or ""),
        "term_1_amount": str(item.get("term_1_amount") or 0),
        "term_2_amount": str(item.get("term_2_amount") or 0),
        "term_3_amount": str(item.get("term_3_amount") or 0),
        "charge_frequency": str(item.get("charge_frequency") or "PER_TERM"),
        "fee_item_code": str(item.get("fee_item_code") or ""),
        "fee_item_name": str(item.get("fee_item_name") or ""),
        "category_id": str(item.get("category_id") or ""),
        "category_code": str(item.get("category_code") or ""),
        "category_name": str(item.get("category_name") or ""),
    }


def _serialize_scholarship(row: Any, *, allocated_amount: Decimal | None = None) -> dict:
    total = Decimal(getattr(row, "value", 0) or 0)
    allocated = Decimal(allocated_amount or 0)
    remaining = max(Decimal("0"), total - allocated)
    return {
        "id": str(getattr(row, "id")),
        "name": str(getattr(row, "name", "") or ""),
        "type": str(getattr(row, "type", "") or ""),
        "value": str(total),
        "allocated_amount": str(allocated),
        "remaining_amount": str(remaining),
        "is_active": bool(getattr(row, "is_active", True)),
    }


def _serialize_payment(row: dict[str, Any]) -> dict:
    allocations = row.get("allocations") if isinstance(row, dict) else []
    safe_allocations = allocations if isinstance(allocations, list) else []
    return {
        "id": str(row.get("id") or ""),
        "receipt_no": (str(row.get("receipt_no")) if row.get("receipt_no") is not None else None),
        "provider": str(row.get("provider") or ""),
        "reference": (str(row.get("reference")) if row.get("reference") is not None else None),
        "amount": str(row.get("amount") or 0),
        "allocations": [
            {
                "invoice_id": str(a.get("invoice_id") or ""),
                "amount": str(a.get("amount") or 0),
            }
            for a in safe_allocations
            if isinstance(a, dict)
        ],
    }


TENANT_CLASS_TABLE_CANDIDATES = ("core.tenant_classes", "tenant_classes")
TENANT_TERM_TABLE_CANDIDATES = ("core.tenant_terms", "tenant_terms")
TENANT_SCHOOL_CALENDAR_EVENT_TABLE_CANDIDATES = (
    "core.tenant_school_calendar_events",
    "tenant_school_calendar_events",
)
TENANT_SUBJECT_TABLE_CANDIDATES = ("core.tenant_subjects", "tenant_subjects")
TENANT_STAFF_TABLE_CANDIDATES = ("core.staff_directory", "staff_directory")
TENANT_ASSET_TABLE_CANDIDATES = ("core.school_assets", "school_assets")
TEACHER_ASSIGNMENT_TABLE_CANDIDATES = (
    "core.teacher_subject_assignments",
    "teacher_subject_assignments",
)
CLASS_TEACHER_ASSIGNMENT_TABLE_CANDIDATES = (
    "core.class_teacher_assignments",
    "class_teacher_assignments",
)
ASSET_ASSIGNMENT_TABLE_CANDIDATES = (
    "core.asset_assignments",
    "asset_assignments",
)
TENANT_NOTIFICATION_READ_TABLE_CANDIDATES = (
    "core.tenant_notification_reads",
    "tenant_notification_reads",
)
ENROLLMENT_TABLE_CANDIDATES = (
    "core.enrollments",
    "enrollment.enrollments",
    "enrollments",
)
FEE_STRUCTURE_TABLE_CANDIDATES = ("core.fee_structures", "fee_structures")
FEE_STRUCTURE_ITEM_TABLE_CANDIDATES = ("core.fee_structure_items", "fee_structure_items")
FEE_ITEM_TABLE_CANDIDATES = ("core.fee_items", "fee_items")
FEE_CATEGORY_TABLE_CANDIDATES = ("core.fee_categories", "fee_categories")
TENANT_EXAM_TABLE_CANDIDATES = ("core.tenant_exams", "tenant_exams")
TENANT_EXAM_MARK_TABLE_CANDIDATES = ("core.tenant_exam_marks", "tenant_exam_marks")
TENANT_EVENT_TABLE_CANDIDATES = ("core.tenant_events", "tenant_events")
TENANT_EVENT_CLASS_TABLE_CANDIDATES = ("core.tenant_event_classes", "tenant_event_classes")
TENANT_EVENT_STUDENT_TABLE_CANDIDATES = ("core.tenant_event_students", "tenant_event_students")
TENANT_SCHOOL_TIMETABLE_TABLE_CANDIDATES = (
    "core.school_timetable_entries",
    "school_timetable_entries",
)
TENANT_BADGE_DIR = Path(__file__).resolve().parents[4] / "storage" / "tenant_badges"
TENANT_BADGE_MAX_BYTES = 2 * 1024 * 1024
TENANT_BADGE_EXT_BY_CONTENT_TYPE = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
TENANT_BADGE_CONTENT_TYPE_BY_EXT = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
}


def _normalize_code(value: str) -> str:
    return value.strip().upper()


def _normalize_name(value: str) -> str:
    return value.strip()


def _ensure_tenant_school_calendar_event_table(db: Session) -> str:
    db.execute(sa.text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
    db.execute(sa.text("CREATE SCHEMA IF NOT EXISTS core"))
    db.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS core.tenant_school_calendar_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
                academic_year INT NOT NULL,
                event_type VARCHAR(32) NOT NULL,
                title VARCHAR(160) NOT NULL,
                term_code VARCHAR(80),
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                notes VARCHAR(500),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT ck_tenant_school_calendar_events_type
                    CHECK (event_type IN ('HALF_TERM_BREAK', 'EXAM_WINDOW'))
            )
            """
        )
    )
    db.execute(
        sa.text(
            """
            CREATE INDEX IF NOT EXISTS ix_tenant_school_calendar_events_scope
            ON core.tenant_school_calendar_events (tenant_id, academic_year, event_type, is_active)
            """
        )
    )
    return TENANT_SCHOOL_CALENDAR_EVENT_TABLE_CANDIDATES[0]


def _normalize_staff_type(value: str) -> str:
    raw = value.strip().upper().replace(" ", "_")
    if raw in {"TEACHING", "TEACHER", "LECTURER"}:
        return "TEACHING"
    if raw in {"NON_TEACHING", "NONTEACHING", "SUPPORT", "STAFF"}:
        return "NON_TEACHING"
    raise HTTPException(status_code=400, detail="Invalid staff_type")


def _is_teaching_staff_type(value: Optional[str]) -> bool:
    raw = (value or "").strip().upper().replace(" ", "_")
    return raw in {"TEACHING", "TEACHER", "LECTURER"}


def _text_or_none(value: Optional[str], *, upper: bool = False) -> Optional[str]:
    if value is None:
        return None
    cleaned = str(value).strip()
    if not cleaned:
        return None
    return cleaned.upper() if upper else cleaned


def _normalized_email(value: Optional[str]) -> Optional[str]:
    cleaned = _text_or_none(value, upper=False)
    return cleaned.lower() if cleaned else None


def _is_restricted_tenant_role_code(role_code: str) -> bool:
    return role_code.strip().upper() == "SUPER_ADMIN"


def _ensure_director_assignable_role(role_code: str) -> None:
    if _is_restricted_tenant_role_code(role_code):
        raise HTTPException(
            status_code=403,
            detail="SUPER_ADMIN role cannot be assigned from tenant dashboard",
        )


def _staff_full_name(first_name: str | None, last_name: str | None) -> str:
    parts = [str(first_name or "").strip(), str(last_name or "").strip()]
    full = " ".join(p for p in parts if p)
    return full or "Unnamed staff"


def _director_user_payloads(
    db: Session,
    *,
    tenant_id: UUID,
    user_ids: list[UUID] | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> list[DirectorUserOut]:
    stmt = (
        select(
            User.id,
            User.email,
            User.full_name,
            User.is_active,
            UserTenant.is_active,
        )
        .select_from(UserTenant)
        .join(User, User.id == UserTenant.user_id)
        .where(UserTenant.tenant_id == tenant_id)
        .order_by(User.email.asc())
    )
    if user_ids is not None:
        if not user_ids:
            return []
        stmt = stmt.where(UserTenant.user_id.in_(user_ids))
    if limit is not None:
        stmt = stmt.limit(limit)
    if offset is not None:
        stmt = stmt.offset(offset)

    users_rows = db.execute(stmt).all()
    scoped_user_ids = [row[0] for row in users_rows]
    role_map: dict[UUID, list[str]] = {uid: [] for uid in scoped_user_ids}
    if scoped_user_ids:
        role_rows = db.execute(
            select(UserRole.user_id, Role.code)
            .select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                UserRole.tenant_id == tenant_id,
                UserRole.user_id.in_(scoped_user_ids),
            )
            .order_by(Role.code.asc())
        ).all()
        for scoped_user_id, role_code in role_rows:
            if role_code is None:
                continue
            code = str(role_code).strip().upper()
            if _is_restricted_tenant_role_code(code):
                continue
            role_map.setdefault(scoped_user_id, []).append(code)

    return [
        DirectorUserOut(
            id=str(user_id),
            email=str(email),
            full_name=(str(full_name) if full_name else None),
            is_active=bool(user_is_active and membership_is_active),
            roles=role_map.get(user_id, []),
        )
        for user_id, email, full_name, user_is_active, membership_is_active in users_rows
    ]


def _director_user_has_role(db: Session, *, tenant_id: UUID, user_id: UUID, role_code: str) -> bool:
    return bool(
        db.execute(
            select(UserRole.id)
            .select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                UserRole.tenant_id == tenant_id,
                UserRole.user_id == user_id,
                sa.func.upper(Role.code) == role_code.strip().upper(),
            )
            .limit(1)
        ).first()
    )


def _count_active_tenant_users_for_role(db: Session, *, tenant_id: UUID, role_code: str) -> int:
    return int(
        db.execute(
            select(sa.func.count(sa.distinct(UserRole.user_id)))
            .select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .join(
                UserTenant,
                and_(
                    UserTenant.tenant_id == tenant_id,
                    UserTenant.user_id == UserRole.user_id,
                    UserTenant.is_active == True,
                ),
            )
            .join(User, User.id == UserRole.user_id)
            .where(
                UserRole.tenant_id == tenant_id,
                User.is_active == True,
                sa.func.upper(Role.code) == role_code.strip().upper(),
            )
        ).scalar()
        or 0
    )


def _sync_staff_registry_email_for_user(
    db: Session,
    *,
    tenant_id: UUID,
    current_email: str,
    next_email: str,
) -> None:
    current_normalized = current_email.strip().lower()
    next_normalized = next_email.strip().lower()
    if not current_normalized or current_normalized == next_normalized:
        return

    table_name, cols = _resolve_existing_table(db, candidates=TENANT_STAFF_TABLE_CANDIDATES)
    if not table_name or "email" not in cols:
        return

    duplicate = db.execute(
        sa.text(
            f"""
            SELECT 1
            FROM {table_name}
            WHERE tenant_id = :tenant_id
              AND LOWER(email) = :next_email
              AND LOWER(email) <> :current_email
            LIMIT 1
            """
        ),
        {
            "tenant_id": str(tenant_id),
            "current_email": current_normalized,
            "next_email": next_normalized,
        },
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="Email already exists in the tenant staff registry.",
        )

    db.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET email = :next_email
            WHERE tenant_id = :tenant_id
              AND LOWER(email) = :current_email
            """
        ),
        {
            "tenant_id": str(tenant_id),
            "current_email": current_normalized,
            "next_email": next_normalized,
        },
    )


def _execute_on_first_table(
    db: Session,
    *,
    table_candidates: tuple[str, ...],
    sql_template: str,
    params: dict[str, Any],
):
    last_error: Exception | None = None
    for table_name in table_candidates:
        try:
            stmt = sa.text(sql_template.format(table=table_name))
            return db.execute(stmt, params), table_name
        except (ProgrammingError, OperationalError, InternalError) as err:
            # A missing relation aborts the current transaction in Postgres.
            # Roll back before probing the next candidate table.
            db.rollback()
            if _safe_db_missing_table(err):
                last_error = err
                continue
            raise
        except Exception as err:
            if _safe_db_missing_table(err):
                db.rollback()
                last_error = err
                continue
            raise

    if last_error:
        raise HTTPException(
            status_code=503,
            detail="Tenant setup storage is not configured. Run database migrations.",
        )
    raise HTTPException(status_code=503, detail="Tenant setup storage is unavailable.")


def _read_rows_first_table(
    db: Session,
    *,
    table_candidates: tuple[str, ...],
    sql_template: str,
    params: dict[str, Any],
) -> tuple[list[dict[str, Any]], str | None]:
    try:
        result, table_name = _execute_on_first_table(
            db,
            table_candidates=table_candidates,
            sql_template=sql_template,
            params=params,
        )
        rows = result.mappings().all()
        return [dict(r) for r in rows], table_name
    except HTTPException as exc:
        if exc.status_code == 503:
            return [], None
        raise


def _safe_payload_obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _split_table_ref(table_ref: str) -> tuple[str | None, str]:
    if "." in table_ref:
        schema, table = table_ref.split(".", 1)
        return schema, table
    return None, table_ref


def _resolve_existing_table(
    db: Session,
    *,
    candidates: tuple[str, ...],
) -> tuple[str | None, set[str]]:
    try:
        inspector = sa.inspect(db.get_bind())
    except Exception:
        return None, set()

    for ref in candidates:
        schema, table = _split_table_ref(ref)
        try:
            cols = inspector.get_columns(table, schema=schema)
        except Exception:
            continue
        if cols:
            col_names = {
                str(col.get("name"))
                for col in cols
                if col.get("name") is not None
            }
            return ref, col_names

    return None, set()


def _list_fee_structures_fallback(
    db: Session,
    *,
    tenant_id: UUID,
) -> tuple[list[dict[str, Any]], bool]:
    table_ref, cols = _resolve_existing_table(
        db,
        candidates=FEE_STRUCTURE_TABLE_CANDIDATES,
    )
    if not table_ref:
        return [], False

    required = {"id", "tenant_id", "class_code"}
    if not required.issubset(cols):
        return [], False

    term_expr = "term_code" if "term_code" in cols else "'GENERAL'"
    name_expr = "name" if "name" in cols else "class_code"
    active_expr = "COALESCE(is_active, true)" if "is_active" in cols else "true"
    structure_no_expr = "structure_no" if "structure_no" in cols else "NULL"

    try:
        rows = db.execute(
            sa.text(
                f"""
                SELECT
                    id,
                    class_code,
                    {term_expr} AS term_code,
                    {name_expr} AS name,
                    {active_expr} AS is_active,
                    {structure_no_expr} AS structure_no
                FROM {table_ref}
                WHERE tenant_id = :tenant_id
                ORDER BY class_code ASC, term_code ASC, name ASC
                """
            ),
            {"tenant_id": str(tenant_id)},
        ).mappings().all()
    except Exception:
        db.rollback()
        return [], False

    data = [
        {
            "id": str(row.get("id") or ""),
            "structure_no": (
                str(row.get("structure_no"))
                if row.get("structure_no") is not None
                else None
            ),
            "class_code": str(row.get("class_code") or ""),
            "term_code": str(row.get("term_code") or "GENERAL"),
            "name": str(row.get("name") or ""),
            "is_active": bool(row.get("is_active", True)),
        }
        for row in rows
        if row.get("id") is not None
    ]
    return data, True


def _list_fee_structure_items_fallback(
    db: Session,
    *,
    tenant_id: UUID,
) -> tuple[dict[str, list[dict[str, Any]]], bool]:
    structure_ref, structure_cols = _resolve_existing_table(
        db,
        candidates=FEE_STRUCTURE_TABLE_CANDIDATES,
    )
    item_link_ref, item_link_cols = _resolve_existing_table(
        db,
        candidates=FEE_STRUCTURE_ITEM_TABLE_CANDIDATES,
    )
    fee_item_ref, fee_item_cols = _resolve_existing_table(
        db,
        candidates=FEE_ITEM_TABLE_CANDIDATES,
    )
    category_ref, category_cols = _resolve_existing_table(
        db,
        candidates=FEE_CATEGORY_TABLE_CANDIDATES,
    )

    if not all([structure_ref, item_link_ref, fee_item_ref, category_ref]):
        return {}, False

    if not {"id", "tenant_id"}.issubset(structure_cols):
        return {}, False
    if not {"structure_id", "fee_item_id", "amount"}.issubset(item_link_cols):
        return {}, False
    if not {"id", "category_id", "code", "name"}.issubset(fee_item_cols):
        return {}, False
    if not {"id", "code", "name"}.issubset(category_cols):
        return {}, False

    try:
        rows = db.execute(
            sa.text(
                f"""
                SELECT
                    s.id AS structure_id,
                    fsi.fee_item_id AS fee_item_id,
                    fsi.amount AS amount,
                    fi.code AS fee_item_code,
                    fi.name AS fee_item_name,
                    fc.id AS category_id,
                    fc.code AS category_code,
                    fc.name AS category_name
                FROM {item_link_ref} fsi
                JOIN {structure_ref} s ON s.id = fsi.structure_id
                JOIN {fee_item_ref} fi ON fi.id = fsi.fee_item_id
                JOIN {category_ref} fc ON fc.id = fi.category_id
                WHERE s.tenant_id = :tenant_id
                ORDER BY s.id ASC, fc.code ASC, fi.code ASC
                """
            ),
            {"tenant_id": str(tenant_id)},
        ).mappings().all()
    except Exception:
        db.rollback()
        return {}, False

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        sid = str(row.get("structure_id") or "")
        if not sid:
            continue
        grouped.setdefault(sid, []).append(_serialize_structure_item(dict(row)))
    return grouped, True


def _list_tenant_enrollments_for_finance(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int = 500,
) -> tuple[list[dict[str, Any]], bool]:
    safe_limit = max(1, min(int(limit), 1000))
    rows, table_name = _read_rows_first_table(
        db,
        table_candidates=ENROLLMENT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, status, payload
            FROM {table}
            WHERE tenant_id = :tenant_id
            ORDER BY id DESC
            LIMIT :limit
        """,
        params={
            "tenant_id": str(tenant_id),
            "limit": safe_limit,
        },
    )

    items = [
        {
            "id": str(row.get("id") or ""),
            "status": str(row.get("status") or ""),
            "payload": _safe_payload_obj(row.get("payload")),
        }
        for row in rows
        if row.get("id") is not None
    ]
    return items, bool(table_name)


def _enrollment_student_name(payload: dict[str, Any]) -> str:
    for key in ("student_name", "studentName", "full_name", "fullName", "name"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "Unknown student"


def _enrollment_admission_number(payload: dict[str, Any]) -> Optional[str]:
    for key in ("admission_number", "admissionNo", "admission_no"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _payload_text(payload: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _is_grade9_candidate(class_code: str) -> bool:
    token = _normalize_code(class_code or "").replace("-", "_")
    if token in {"GRADE_9", "GRADE9", "G9"}:
        return True
    return token.startswith("GRADE_9") or token.startswith("GRADE9")


def _latest_school_fee_invoice_map(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_ids: list[str],
) -> dict[str, dict[str, str]]:
    cleaned_ids = [str(value).strip() for value in enrollment_ids if str(value).strip()]
    if not cleaned_ids:
        return {}

    parsed_ids: list[UUID] = []
    for value in cleaned_ids:
        try:
            parsed_ids.append(UUID(value))
        except Exception:
            continue
    if not parsed_ids:
        return {}

    try:
        from app.models.invoice import Invoice  # type: ignore

        rows = db.execute(
            select(Invoice)
            .where(
                Invoice.tenant_id == tenant_id,
                Invoice.enrollment_id.in_(parsed_ids),
                Invoice.invoice_type == "SCHOOL_FEES",
            )
            .order_by(
                Invoice.enrollment_id.asc(),
                Invoice.created_at.desc(),
                Invoice.id.desc(),
            )
        ).scalars().all()
    except Exception:
        db.rollback()
        return {}

    latest: dict[str, dict[str, str]] = {}
    for row in rows:
        enrollment_id = str(getattr(row, "enrollment_id", "") or "").strip()
        if not enrollment_id or enrollment_id in latest:
            continue
        latest[enrollment_id] = {
            "status": str(getattr(row, "status", "") or ""),
            "balance_amount": str(getattr(row, "balance_amount", "0") or "0"),
        }
    return latest


def _student_outstanding_assets_map(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_ids: list[str],
) -> dict[str, int]:
    cleaned_ids = [str(value).strip() for value in enrollment_ids if str(value).strip()]
    if not cleaned_ids:
        return {}

    assignment_ref, assignment_cols = _resolve_existing_table(
        db,
        candidates=ASSET_ASSIGNMENT_TABLE_CANDIDATES,
    )
    if not assignment_ref or "enrollment_id" not in assignment_cols:
        return {}

    assignee_filter = (
        "AND UPPER(COALESCE(assignee_type, 'STAFF')) = 'STUDENT'"
        if "assignee_type" in assignment_cols
        else ""
    )

    rows = db.execute(
        sa.text(
            f"""
            SELECT CAST(enrollment_id AS TEXT) AS enrollment_id, COUNT(1) AS assigned_count
            FROM {assignment_ref}
            WHERE tenant_id = :tenant_id
              AND enrollment_id IS NOT NULL
              AND enrollment_id IN :enrollment_ids
              AND UPPER(status) = 'ASSIGNED'
              AND returned_at IS NULL
              {assignee_filter}
            GROUP BY enrollment_id
            """
        ).bindparams(sa.bindparam("enrollment_ids", expanding=True)),
        {
            "tenant_id": str(tenant_id),
            "enrollment_ids": cleaned_ids,
        },
    ).mappings().all()

    return {
        str(row.get("enrollment_id") or ""): int(row.get("assigned_count") or 0)
        for row in rows
        if row.get("enrollment_id") is not None
    }


def _serialize_student_clearance_row(
    enrollment: dict[str, Any],
    *,
    fee_invoice: Optional[dict[str, str]],
    outstanding_assets: int,
) -> StudentClearanceOut:
    enrollment_id = str(enrollment.get("id") or "")
    status = _text_or_none(enrollment.get("status"), upper=True) or "UNKNOWN"
    payload = _safe_payload_obj(enrollment.get("payload"))

    student_name = _enrollment_student_name(payload)
    admission_number = _enrollment_admission_number(payload)
    class_code = _enrollment_class_code(payload)
    term_code = _enrollment_term_bucket(payload)

    nemis_no = _payload_text(payload, ("nemis_no", "nemisNo"))
    assessment_no = _payload_text(payload, ("assessment_no", "assessmentNo"))
    has_identifiers = bool(nemis_no and assessment_no)

    fees_status = _text_or_none((fee_invoice or {}).get("status"), upper=True) or "MISSING"
    fees_balance = str((fee_invoice or {}).get("balance_amount") or "0")
    fees_cleared = fees_status == "PAID"

    assets_count = max(int(outstanding_assets), 0)
    assets_cleared = assets_count == 0

    transfer_requested = status == "TRANSFER_REQUESTED"
    transfer_approved = status == "TRANSFERRED"
    grade9_candidate = _is_grade9_candidate(class_code)

    blockers: list[str] = []
    if not fees_cleared:
        blockers.append("Outstanding school fees.")
    if not assets_cleared:
        blockers.append("Assigned school assets are not returned.")
    if not has_identifiers:
        blockers.append("NEMIS and Assessment numbers are required.")

    ready_for_transfer_request = (
        status in {"ENROLLED", "ENROLLED_PARTIAL"}
        and fees_cleared
        and assets_cleared
        and has_identifiers
    )
    ready_for_director_approval = (
        transfer_requested
        and fees_cleared
        and assets_cleared
        and has_identifiers
    )

    return StudentClearanceOut(
        enrollment_id=enrollment_id,
        student_name=student_name,
        admission_number=admission_number,
        class_code=class_code,
        term_code=term_code,
        status=status,
        nemis_no=nemis_no or None,
        assessment_no=assessment_no or None,
        fees_status=fees_status,
        fees_balance=fees_balance,
        fees_cleared=fees_cleared,
        outstanding_assets=assets_count,
        assets_cleared=assets_cleared,
        grade9_candidate=grade9_candidate,
        transfer_requested=transfer_requested,
        transfer_approved=transfer_approved,
        ready_for_transfer_request=ready_for_transfer_request,
        ready_for_director_approval=ready_for_director_approval,
        blockers=blockers,
        transfer_requested_at=(
            _payload_text(payload, ("transfer_requested_at",)) or None
        ),
        transfer_approved_at=(
            _payload_text(payload, ("transfer_approved_at",)) or None
        ),
    )


def _tenant_enrollment_index(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int = 2000,
) -> dict[str, dict[str, str]]:
    rows, ok = _list_tenant_enrollments_for_finance(db, tenant_id=tenant_id, limit=limit)
    if not ok:
        return {}

    index: dict[str, dict[str, str]] = {}
    for row in rows:
        eid = str(row.get("id") or "")
        if not eid:
            continue
        payload = _safe_payload_obj(row.get("payload"))
        student_name = _enrollment_student_name(payload)
        admission_number = _enrollment_admission_number(payload) or ""
        index[eid] = {
            "student_name": student_name,
            "admission_number": admission_number,
        }
    return index


def _normalize_iso_datetime(value: Optional[str], *, field: str) -> Optional[str]:
    cleaned = _text_or_none(value)
    if cleaned is None:
        return None
    try:
        parsed = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be a valid ISO datetime")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


EXAM_STATUS_VALUES = {"SCHEDULED", "ONGOING", "COMPLETED", "CANCELLED"}


def _normalize_iso_date_value(
    value: Optional[str],
    *,
    field: str,
    required: bool = False,
) -> Optional[str]:
    cleaned = _text_or_none(value)
    if cleaned is None:
        if required:
            raise HTTPException(status_code=400, detail=f"{field} is required")
        return None

    raw = cleaned.split("T", 1)[0]
    try:
        parsed = date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be a valid ISO date (YYYY-MM-DD)")
    return parsed.isoformat()


def _normalize_exam_time_value(value: Optional[str], *, field: str) -> Optional[str]:
    cleaned = _text_or_none(value)
    if cleaned is None:
        return None

    token = cleaned
    if len(token) == 5 and token.count(":") == 1:
        token = f"{token}:00"
    try:
        parsed = time.fromisoformat(token)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be a valid time (HH:MM or HH:MM:SS)")
    return parsed.strftime("%H:%M:%S")


def _normalize_exam_status_value(value: Optional[str], *, field: str = "status") -> str:
    raw = _text_or_none(value, upper=True) or "SCHEDULED"
    normalized = raw.replace(" ", "_")
    if normalized not in EXAM_STATUS_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be one of: {', '.join(sorted(EXAM_STATUS_VALUES))}",
        )
    return normalized


TIMETABLE_DAY_VALUES = {
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
}
TIMETABLE_DAY_ORDER = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
]
TIMETABLE_SLOT_TYPE_VALUES = {
    "LESSON",
    "SHORT_BREAK",
    "LONG_BREAK",
    "LUNCH_BREAK",
    "GAME_TIME",
    "OTHER",
}
TIMETABLE_BREAK_SLOT_TYPES = {
    "SHORT_BREAK",
    "LONG_BREAK",
    "LUNCH_BREAK",
    "GAME_TIME",
}


def _normalize_timetable_day_value(value: Optional[str], *, field: str = "day_of_week") -> str:
    raw = _text_or_none(value, upper=True) or ""
    normalized = raw.replace(" ", "_")
    if normalized not in TIMETABLE_DAY_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be one of: {', '.join(TIMETABLE_DAY_ORDER)}",
        )
    return normalized


def _normalize_timetable_slot_type_value(value: Optional[str], *, field: str = "slot_type") -> str:
    raw = _text_or_none(value, upper=True) or "LESSON"
    normalized = raw.replace(" ", "_")
    if normalized not in TIMETABLE_SLOT_TYPE_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be one of: {', '.join(sorted(TIMETABLE_SLOT_TYPE_VALUES))}",
        )
    return normalized


def _default_timetable_title(slot_type: str) -> str:
    if slot_type == "SHORT_BREAK":
        return "Short Break"
    if slot_type == "LONG_BREAK":
        return "Long Break"
    if slot_type == "LUNCH_BREAK":
        return "Lunch Break"
    if slot_type == "GAME_TIME":
        return "Game Time"
    if slot_type == "OTHER":
        return "Activity"
    return "Lesson"


def _is_break_slot_type(slot_type: str) -> bool:
    return slot_type in TIMETABLE_BREAK_SLOT_TYPES


def _day_order_case_sql(column_name: str) -> str:
    return (
        "CASE "
        + " ".join(
            [f"WHEN UPPER({column_name}) = '{value}' THEN {index}" for index, value in enumerate(TIMETABLE_DAY_ORDER, start=1)]
        )
        + " ELSE 999 END"
    )


def _enrollment_class_code(payload: dict[str, Any]) -> str:
    for key in ("admission_class", "class_code", "classCode", "grade"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return _normalize_code(value)
    return ""


def _subject_lookup_for_tenant(db: Session, *, tenant_id: UUID) -> dict[str, dict[str, str]]:
    rows, _ = _read_rows_first_table(
        db,
        table_candidates=TENANT_SUBJECT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, code, name
            FROM {table}
            WHERE tenant_id = :tenant_id
            ORDER BY code ASC, name ASC
        """,
        params={"tenant_id": str(tenant_id)},
    )
    lookup: dict[str, dict[str, str]] = {}
    for row in rows:
        sid = str(row.get("id") or "")
        if not sid:
            continue
        lookup[sid] = {
            "code": str(row.get("code") or ""),
            "name": str(row.get("name") or ""),
        }
    return lookup


def _term_lookup_for_tenant(db: Session, *, tenant_id: UUID) -> dict[str, dict[str, str]]:
    rows, _ = _read_rows_first_table(
        db,
        table_candidates=TENANT_TERM_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, code, name
            FROM {table}
            WHERE tenant_id = :tenant_id
            ORDER BY code ASC, name ASC
        """,
        params={"tenant_id": str(tenant_id)},
    )
    lookup: dict[str, dict[str, str]] = {}
    for row in rows:
        tid = str(row.get("id") or "")
        if not tid:
            continue
        lookup[tid] = {
            "code": str(row.get("code") or ""),
            "name": str(row.get("name") or ""),
        }
    return lookup


def _staff_lookup_for_tenant(db: Session, *, tenant_id: UUID) -> dict[str, dict[str, str]]:
    rows, _ = _read_rows_first_table(
        db,
        table_candidates=TENANT_STAFF_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, staff_no, first_name, last_name
            FROM {table}
            WHERE tenant_id = :tenant_id
            ORDER BY last_name ASC, first_name ASC, staff_no ASC
        """,
        params={"tenant_id": str(tenant_id)},
    )
    lookup: dict[str, dict[str, str]] = {}
    for row in rows:
        sid = str(row.get("id") or "")
        if not sid:
            continue
        first_name = str(row.get("first_name") or "").strip()
        last_name = str(row.get("last_name") or "").strip()
        lookup[sid] = {
            "staff_no": str(row.get("staff_no") or ""),
            "full_name": _staff_full_name(first_name, last_name),
        }
    return lookup


def _resolve_exam_table_or_503(db: Session) -> str:
    table_name, cols = _resolve_existing_table(db, candidates=TENANT_EXAM_TABLE_CANDIDATES)
    required = {
        "id",
        "tenant_id",
        "name",
        "term_id",
        "class_code",
        "subject_id",
        "invigilator_staff_id",
        "start_date",
        "end_date",
        "start_time",
        "end_time",
        "status",
        "location",
        "notes",
        "is_active",
        "created_at",
        "updated_at",
    }
    if not table_name or not required.issubset(cols):
        raise HTTPException(
            status_code=503,
            detail="Exams storage is not configured. Run database migrations.",
        )
    return table_name


def _resolve_exam_mark_table_or_503(db: Session) -> str:
    table_name, cols = _resolve_existing_table(db, candidates=TENANT_EXAM_MARK_TABLE_CANDIDATES)
    required = {
        "id",
        "tenant_id",
        "exam_id",
        "student_enrollment_id",
        "subject_id",
        "class_code",
        "marks_obtained",
        "max_marks",
        "grade",
        "remarks",
        "recorded_at",
        "updated_at",
    }
    if not table_name or not required.issubset(cols):
        raise HTTPException(
            status_code=503,
            detail="Exam marks storage is not configured. Run database migrations.",
        )
    return table_name


def _ensure_tenant_class_exists(db: Session, *, tenant_id: UUID, class_code: str) -> None:
    table_name, _ = _resolve_existing_table(db, candidates=TENANT_CLASS_TABLE_CANDIDATES)
    if not table_name:
        return
    exists = db.execute(
        sa.text(
            f"""
            SELECT id
            FROM {table_name}
            WHERE tenant_id = :tenant_id
              AND UPPER(code) = :class_code
            LIMIT 1
            """
        ),
        {"tenant_id": str(tenant_id), "class_code": _normalize_code(class_code)},
    ).first()
    if not exists:
        raise HTTPException(status_code=404, detail="Class not found")


def _ensure_tenant_term_exists(db: Session, *, tenant_id: UUID, term_id: UUID) -> None:
    result, _ = _execute_on_first_table(
        db,
        table_candidates=TENANT_TERM_TABLE_CANDIDATES,
        sql_template="""
            SELECT id
            FROM {table}
            WHERE id = :term_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"term_id": str(term_id), "tenant_id": str(tenant_id)},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Term not found")


def _ensure_tenant_subject_exists(db: Session, *, tenant_id: UUID, subject_id: UUID) -> None:
    result, _ = _execute_on_first_table(
        db,
        table_candidates=TENANT_SUBJECT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id
            FROM {table}
            WHERE id = :subject_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"subject_id": str(subject_id), "tenant_id": str(tenant_id)},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Subject not found")


def _ensure_tenant_invigilator_exists(db: Session, *, tenant_id: UUID, staff_id: UUID) -> None:
    result, _ = _execute_on_first_table(
        db,
        table_candidates=TENANT_STAFF_TABLE_CANDIDATES,
        sql_template="""
            SELECT id
            FROM {table}
            WHERE id = :staff_id
              AND tenant_id = :tenant_id
              AND COALESCE(is_active, true) = true
              AND UPPER(staff_type) = 'TEACHING'
            LIMIT 1
        """,
        params={"staff_id": str(staff_id), "tenant_id": str(tenant_id)},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Invigilator staff not found")


def _list_tenant_term_ids(
    db: Session,
    *,
    tenant_id: UUID,
    include_inactive: bool = False,
) -> list[UUID]:
    rows, _ = _read_rows_first_table(
        db,
        table_candidates=TENANT_TERM_TABLE_CANDIDATES,
        sql_template=(
            """
            SELECT id
            FROM {table}
            WHERE tenant_id = :tenant_id
            """
            + ("" if include_inactive else " AND COALESCE(is_active, true) = true ")
            + " ORDER BY name ASC, code ASC"
        ),
        params={"tenant_id": str(tenant_id)},
    )
    resolved: list[UUID] = []
    for row in rows:
        token = str(row.get("id") or "").strip()
        if not token:
            continue
        try:
            resolved.append(UUID(token))
        except ValueError:
            continue
    return resolved


def _list_tenant_class_codes(
    db: Session,
    *,
    tenant_id: UUID,
    include_inactive: bool = False,
) -> list[str]:
    rows, _ = _read_rows_first_table(
        db,
        table_candidates=TENANT_CLASS_TABLE_CANDIDATES,
        sql_template=(
            """
            SELECT code
            FROM {table}
            WHERE tenant_id = :tenant_id
            """
            + ("" if include_inactive else " AND COALESCE(is_active, true) = true ")
            + " ORDER BY code ASC, name ASC"
        ),
        params={"tenant_id": str(tenant_id)},
    )
    codes: list[str] = []
    for row in rows:
        code = _normalize_code(row.get("code"))
        if code and code not in codes:
            codes.append(code)
    return codes


def _resolve_break_term_ids(
    db: Session,
    *,
    tenant_id: UUID,
    requested_term_ids: Optional[list[str]],
) -> list[UUID]:
    if requested_term_ids is None:
        term_ids = _list_tenant_term_ids(db, tenant_id=tenant_id, include_inactive=False)
        if not term_ids:
            raise HTTPException(
                status_code=400,
                detail="No active terms found. Configure terms before applying break slots.",
            )
        return term_ids

    normalized_tokens = [str(raw or "").strip() for raw in requested_term_ids if str(raw or "").strip()]
    if not normalized_tokens:
        raise HTTPException(status_code=400, detail="term_ids cannot be empty when supplied")

    seen: set[UUID] = set()
    term_ids: list[UUID] = []
    for token in normalized_tokens:
        term_uuid = _parse_uuid(token, field="term_ids")
        if term_uuid in seen:
            continue
        _ensure_tenant_term_exists(db, tenant_id=tenant_id, term_id=term_uuid)
        seen.add(term_uuid)
        term_ids.append(term_uuid)
    return term_ids


def _resolve_break_class_codes(
    db: Session,
    *,
    tenant_id: UUID,
    requested_class_codes: Optional[list[str]],
) -> list[str]:
    if requested_class_codes is None:
        class_codes = _list_tenant_class_codes(db, tenant_id=tenant_id, include_inactive=False)
        if not class_codes:
            raise HTTPException(
                status_code=400,
                detail="No active classes found. Configure classes before applying break slots.",
            )
        return class_codes

    normalized_codes = [_normalize_code(code) for code in (requested_class_codes or [])]
    class_codes = [code for code in normalized_codes if code]
    if not class_codes:
        raise HTTPException(status_code=400, detail="class_codes cannot be empty when supplied")

    deduped: list[str] = []
    for code in class_codes:
        if code in deduped:
            continue
        _ensure_tenant_class_exists(db, tenant_id=tenant_id, class_code=code)
        deduped.append(code)
    return deduped


def _assert_break_slot_no_conflict(
    db: Session,
    *,
    table_name: str,
    tenant_id: UUID,
    term_id: UUID,
    class_code: str,
    day_of_week: str,
    slot_type: str,
    start_time: str,
    end_time: str,
    is_active: bool,
) -> None:
    if not is_active:
        return

    conflict = db.execute(
        sa.text(
            f"""
            SELECT id
            FROM {table_name}
            WHERE tenant_id = :tenant_id
              AND term_id = :term_id
              AND UPPER(class_code) = :class_code
              AND UPPER(day_of_week) = :day_of_week
              AND COALESCE(is_active, true) = true
              AND UPPER(slot_type) <> :slot_type
              AND NOT (end_time <= :start_time OR start_time >= :end_time)
            LIMIT 1
            """
        ),
        {
            "tenant_id": str(tenant_id),
            "term_id": str(term_id),
            "class_code": _normalize_code(class_code),
            "day_of_week": day_of_week,
            "slot_type": slot_type,
            "start_time": start_time,
            "end_time": end_time,
        },
    ).first()
    if conflict:
        raise HTTPException(
            status_code=409,
            detail=f"Break slot conflicts with another active timetable entry for class {class_code}.",
        )


EVENT_TARGET_SCOPE_VALUES = {"ALL", "CLASS", "STUDENT", "MIXED"}


def _normalize_event_target_scope_value(value: Optional[str], *, field: str = "target_scope") -> str:
    cleaned = _text_or_none(value, upper=True) or ""
    normalized = cleaned.replace(" ", "_")
    if normalized not in EVENT_TARGET_SCOPE_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be one of: {', '.join(sorted(EVENT_TARGET_SCOPE_VALUES))}",
        )
    return normalized


def _derive_event_target_scope(*, class_codes: list[str], student_enrollment_ids: list[str]) -> str:
    has_classes = bool(class_codes)
    has_students = bool(student_enrollment_ids)
    if has_classes and has_students:
        return "MIXED"
    if has_classes:
        return "CLASS"
    if has_students:
        return "STUDENT"
    return "ALL"


def _normalize_academic_year(value: Optional[int], *, start_date: Optional[str]) -> int:
    if value is not None:
        return int(value)
    if start_date:
        return date.fromisoformat(start_date).year
    return _now_utc().year


def _resolve_event_table_or_503(db: Session) -> str:
    table_name, cols = _resolve_existing_table(db, candidates=TENANT_EVENT_TABLE_CANDIDATES)
    required = {
        "id",
        "tenant_id",
        "name",
        "term_id",
        "academic_year",
        "start_date",
        "end_date",
        "start_time",
        "end_time",
        "location",
        "description",
        "target_scope",
        "is_active",
        "created_at",
        "updated_at",
    }
    if not table_name or not required.issubset(cols):
        raise HTTPException(
            status_code=503,
            detail="Events storage is not configured. Run database migrations.",
        )
    return table_name


def _resolve_event_class_table_or_503(db: Session) -> str:
    table_name, cols = _resolve_existing_table(db, candidates=TENANT_EVENT_CLASS_TABLE_CANDIDATES)
    required = {"id", "tenant_id", "event_id", "class_code", "created_at"}
    if not table_name or not required.issubset(cols):
        raise HTTPException(
            status_code=503,
            detail="Event class mapping storage is not configured. Run database migrations.",
        )
    return table_name


def _resolve_event_student_table_or_503(db: Session) -> str:
    table_name, cols = _resolve_existing_table(db, candidates=TENANT_EVENT_STUDENT_TABLE_CANDIDATES)
    required = {"id", "tenant_id", "event_id", "student_enrollment_id", "created_at"}
    if not table_name or not required.issubset(cols):
        raise HTTPException(
            status_code=503,
            detail="Event student mapping storage is not configured. Run database migrations.",
        )
    return table_name


def _normalize_class_codes(values: Optional[list[str]]) -> list[str]:
    if not values:
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in values:
        token = _text_or_none(raw, upper=True)
        if not token:
            continue
        if token in seen:
            continue
        seen.add(token)
        normalized.append(token)
    return normalized


def _normalize_student_enrollment_ids(values: Optional[list[str]]) -> list[str]:
    if not values:
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in values:
        token = _text_or_none(raw)
        if not token:
            continue
        student_id = str(_parse_uuid(token, field="student_enrollment_id"))
        if student_id in seen:
            continue
        seen.add(student_id)
        normalized.append(student_id)
    return normalized


def _enrollment_name_lookup_by_ids(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_ids: list[str],
) -> dict[str, str]:
    if not enrollment_ids:
        return {}

    table_name, cols = _resolve_existing_table(db, candidates=ENROLLMENT_TABLE_CANDIDATES)
    if not table_name or not {"id", "tenant_id", "payload"}.issubset(cols):
        return {}

    stmt = sa.text(
        f"""
        SELECT id, payload
        FROM {table_name}
        WHERE tenant_id = :tenant_id
          AND id IN :enrollment_ids
        """
    ).bindparams(sa.bindparam("enrollment_ids", expanding=True))
    rows = db.execute(
        stmt,
        {
            "tenant_id": str(tenant_id),
            "enrollment_ids": enrollment_ids,
        },
    ).mappings().all()

    return {
        str(row.get("id")): _enrollment_student_name(_safe_payload_obj(row.get("payload")))
        for row in rows
        if row.get("id") is not None
    }


def _assert_tenant_enrollments_exist(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_ids: list[str],
) -> None:
    if not enrollment_ids:
        return
    names = _enrollment_name_lookup_by_ids(
        db,
        tenant_id=tenant_id,
        enrollment_ids=enrollment_ids,
    )
    missing = [student_id for student_id in enrollment_ids if student_id not in names]
    if missing:
        raise HTTPException(status_code=404, detail="One or more student enrollments were not found")


def _event_target_maps(
    db: Session,
    *,
    tenant_id: UUID,
    event_ids: list[str],
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    if not event_ids:
        return {}, {}

    class_table: str | None = None
    try:
        class_table = _resolve_event_class_table_or_503(db)
    except HTTPException as exc:
        if exc.status_code != 503:
            raise

    student_table: str | None = None
    try:
        student_table = _resolve_event_student_table_or_503(db)
    except HTTPException as exc:
        if exc.status_code != 503:
            raise

    event_class_map: dict[str, list[str]] = {}
    if class_table:
        class_stmt = sa.text(
            f"""
            SELECT CAST(event_id AS TEXT) AS event_id, class_code
            FROM {class_table}
            WHERE tenant_id = :tenant_id
              AND CAST(event_id AS TEXT) IN :event_ids
            ORDER BY class_code ASC
            """
        ).bindparams(sa.bindparam("event_ids", expanding=True))
        class_rows = db.execute(
            class_stmt,
            {"tenant_id": str(tenant_id), "event_ids": event_ids},
        ).mappings().all()
        for row in class_rows:
            event_id = str(row.get("event_id") or "").strip()
            class_code = _text_or_none(row.get("class_code"), upper=True)
            if not event_id or not class_code:
                continue
            event_class_map.setdefault(event_id, []).append(class_code)

    event_student_map: dict[str, list[str]] = {}
    if student_table:
        student_stmt = sa.text(
            f"""
            SELECT CAST(event_id AS TEXT) AS event_id,
                   CAST(student_enrollment_id AS TEXT) AS student_enrollment_id
            FROM {student_table}
            WHERE tenant_id = :tenant_id
              AND CAST(event_id AS TEXT) IN :event_ids
            ORDER BY student_enrollment_id ASC
            """
        ).bindparams(sa.bindparam("event_ids", expanding=True))
        student_rows = db.execute(
            student_stmt,
            {"tenant_id": str(tenant_id), "event_ids": event_ids},
        ).mappings().all()
        for row in student_rows:
            event_id = str(row.get("event_id") or "").strip()
            student_id = str(row.get("student_enrollment_id") or "").strip()
            if not event_id or not student_id:
                continue
            event_student_map.setdefault(event_id, []).append(student_id)

    return event_class_map, event_student_map


def _serialize_event_row(
    row: dict[str, Any],
    *,
    term_lookup: dict[str, dict[str, str]],
    event_class_map: dict[str, list[str]],
    event_student_map: dict[str, list[str]],
    enrollment_name_lookup: dict[str, str],
) -> TenantEventOut:
    event_id = str(row.get("id") or "")
    term_id = str(row.get("term_id") or "").strip()
    term = term_lookup.get(term_id) if term_id else None
    class_codes = event_class_map.get(event_id, [])
    student_ids = event_student_map.get(event_id, [])
    student_names = [
        enrollment_name_lookup.get(student_id, "Unknown student")
        for student_id in student_ids
    ]

    return TenantEventOut(
        id=event_id,
        name=str(row.get("name") or ""),
        term_id=(term_id or None),
        term_code=(term.get("code") if term else None),
        term_name=(term.get("name") if term else None),
        academic_year=int(row.get("academic_year") or _now_utc().year),
        start_date=str(row.get("start_date") or ""),
        end_date=str(row.get("end_date") or ""),
        start_time=(str(row.get("start_time")) if row.get("start_time") is not None else None),
        end_time=(str(row.get("end_time")) if row.get("end_time") is not None else None),
        location=(str(row.get("location")) if row.get("location") else None),
        description=(str(row.get("description")) if row.get("description") else None),
        target_scope=str(row.get("target_scope") or "ALL"),
        class_codes=class_codes,
        student_enrollment_ids=student_ids,
        student_names=student_names,
        is_active=bool(row.get("is_active", True)),
        created_at=(str(row.get("created_at")) if row.get("created_at") is not None else None),
        updated_at=(str(row.get("updated_at")) if row.get("updated_at") is not None else None),
    )


def _audit_tenant_change_best_effort(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    action: str,
    resource: str,
    resource_id: Optional[UUID],
    payload: Optional[dict[str, Any]] = None,
    request: Optional[Request] = None,
) -> None:
    try:
        from app.core.audit import log_event

        meta: dict[str, Any] = {}
        if request is not None:
            meta = {
                "request_id": str(getattr(request.state, "request_id", "") or ""),
                "method": str(request.method),
                "path": str(request.url.path),
            }

        log_event(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            action=action,
            resource=resource,
            resource_id=resource_id,
            payload=payload or {},
            meta=meta,
        )
    except Exception:
        # Best-effort audit capture; endpoint business flow should still succeed.
        return


def _audit_tenant_event_change_best_effort(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    action: str,
    resource_id: Optional[UUID],
    payload: Optional[dict[str, Any]] = None,
    request: Optional[Request] = None,
) -> None:
    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action=action,
        resource="event",
        resource_id=resource_id,
        payload=payload,
        request=request,
    )


def _query_tenant_events(
    db: Session,
    *,
    tenant_id: UUID,
    term_id: Optional[UUID] = None,
    academic_year: Optional[int] = None,
    target_scope: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    include_inactive: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    table_name, cols = _resolve_existing_table(db, candidates=TENANT_EVENT_TABLE_CANDIDATES)
    if not table_name:
        return []

    required = {"id", "tenant_id", "name", "start_date", "end_date"}
    if not required.issubset(cols):
        return []

    term_expr = "CAST(term_id AS TEXT)" if "term_id" in cols else "NULL::TEXT"
    year_expr = (
        "academic_year"
        if "academic_year" in cols
        else "COALESCE(NULLIF(SUBSTRING(CAST(start_date AS TEXT), 1, 4), '')::INT, EXTRACT(YEAR FROM CURRENT_DATE)::INT)"
    )
    start_time_expr = "CAST(start_time AS TEXT)" if "start_time" in cols else "NULL::TEXT"
    end_time_expr = "CAST(end_time AS TEXT)" if "end_time" in cols else "NULL::TEXT"
    location_expr = "location" if "location" in cols else "NULL::TEXT"
    description_expr = "description" if "description" in cols else "NULL::TEXT"
    target_scope_expr = "target_scope" if "target_scope" in cols else "'ALL'"
    active_expr = "COALESCE(is_active, true)" if "is_active" in cols else "true"
    created_expr = "CAST(created_at AS TEXT)" if "created_at" in cols else "NULL::TEXT"
    updated_expr = "CAST(updated_at AS TEXT)" if "updated_at" in cols else "NULL::TEXT"

    where_parts = ["tenant_id = :tenant_id"]
    params: dict[str, Any] = {
        "tenant_id": str(tenant_id),
        "limit": int(limit),
        "offset": int(offset),
    }
    if not include_inactive and "is_active" in cols:
        where_parts.append("COALESCE(is_active, true) = true")
    if term_id is not None and "term_id" in cols:
        where_parts.append("term_id = :term_id")
        params["term_id"] = str(term_id)
    if academic_year is not None and "academic_year" in cols:
        where_parts.append("academic_year = :academic_year")
        params["academic_year"] = int(academic_year)
    if target_scope and "target_scope" in cols:
        where_parts.append("UPPER(target_scope) = :target_scope")
        params["target_scope"] = _normalize_event_target_scope_value(target_scope)
    if date_from:
        where_parts.append("start_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where_parts.append("end_date <= :date_to")
        params["date_to"] = date_to

    start_time_sort = "start_time ASC NULLS LAST, " if "start_time" in cols else ""
    rows = db.execute(
        sa.text(
            f"""
            SELECT id, name, {term_expr} AS term_id, {year_expr} AS academic_year,
                   CAST(start_date AS TEXT) AS start_date,
                   CAST(end_date AS TEXT) AS end_date,
                   {start_time_expr} AS start_time,
                   {end_time_expr} AS end_time,
                   {location_expr} AS location,
                   {description_expr} AS description,
                   {target_scope_expr} AS target_scope,
                   {active_expr} AS is_active,
                   {created_expr} AS created_at,
                   {updated_expr} AS updated_at
            FROM {table_name}
            WHERE {" AND ".join(where_parts)}
            ORDER BY start_date ASC, {start_time_sort} name ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()
    return [dict(row) for row in rows]


def _resolve_school_timetable_table_or_503(db: Session) -> str:
    table_name, cols = _resolve_existing_table(db, candidates=TENANT_SCHOOL_TIMETABLE_TABLE_CANDIDATES)
    required = {
        "id",
        "tenant_id",
        "term_id",
        "class_code",
        "day_of_week",
        "slot_type",
        "title",
        "subject_id",
        "staff_id",
        "start_time",
        "end_time",
        "location",
        "notes",
        "is_active",
        "created_at",
        "updated_at",
    }
    if not table_name or not required.issubset(cols):
        raise HTTPException(
            status_code=503,
            detail="School timetable storage is not configured. Run database migrations.",
        )
    return table_name


def _validate_timetable_time_window(*, start_time: str, end_time: str) -> None:
    if end_time <= start_time:
        raise HTTPException(
            status_code=400,
            detail="end_time must be later than start_time",
        )


def _assert_timetable_slot_not_overlapping(
    db: Session,
    *,
    table_name: str,
    tenant_id: UUID,
    term_id: UUID,
    class_code: str,
    day_of_week: str,
    start_time: str,
    end_time: str,
    is_active: bool,
    exclude_entry_id: Optional[UUID] = None,
) -> None:
    if not is_active:
        return

    where_parts = [
        "tenant_id = :tenant_id",
        "term_id = :term_id",
        "UPPER(class_code) = :class_code",
        "UPPER(day_of_week) = :day_of_week",
        "COALESCE(is_active, true) = true",
        "NOT (end_time <= :start_time OR start_time >= :end_time)",
    ]
    params: dict[str, Any] = {
        "tenant_id": str(tenant_id),
        "term_id": str(term_id),
        "class_code": _normalize_code(class_code),
        "day_of_week": day_of_week,
        "start_time": start_time,
        "end_time": end_time,
    }
    if exclude_entry_id is not None:
        where_parts.append("id <> :exclude_entry_id")
        params["exclude_entry_id"] = str(exclude_entry_id)

    conflict = db.execute(
        sa.text(
            f"""
            SELECT id
            FROM {table_name}
            WHERE {" AND ".join(where_parts)}
            LIMIT 1
            """
        ),
        params,
    ).first()
    if conflict:
        raise HTTPException(
            status_code=409,
            detail="A timetable entry already exists for this class/day/time window.",
        )


def _serialize_school_timetable_row(
    row: dict[str, Any],
    *,
    term_lookup: dict[str, dict[str, str]],
    subject_lookup: dict[str, dict[str, str]],
    staff_lookup: dict[str, dict[str, str]],
) -> TenantSchoolTimetableOut:
    term_id = str(row.get("term_id") or "").strip()
    subject_id = str(row.get("subject_id") or "").strip()
    staff_id = str(row.get("staff_id") or "").strip()
    term = term_lookup.get(term_id) if term_id else None
    subject = subject_lookup.get(subject_id) if subject_id else None
    staff = staff_lookup.get(staff_id) if staff_id else None

    return TenantSchoolTimetableOut(
        id=str(row.get("id") or ""),
        term_id=term_id,
        term_code=(term.get("code") if term else None),
        term_name=(term.get("name") if term else None),
        class_code=str(row.get("class_code") or ""),
        day_of_week=str(row.get("day_of_week") or ""),
        slot_type=str(row.get("slot_type") or "LESSON"),
        title=str(row.get("title") or ""),
        subject_id=(subject_id or None),
        subject_code=(subject.get("code") if subject else None),
        subject_name=(subject.get("name") if subject else None),
        staff_id=(staff_id or None),
        staff_no=(staff.get("staff_no") if staff else None),
        staff_name=(staff.get("full_name") if staff else None),
        start_time=str(row.get("start_time") or ""),
        end_time=str(row.get("end_time") or ""),
        location=(str(row.get("location")) if row.get("location") else None),
        notes=(str(row.get("notes")) if row.get("notes") else None),
        is_active=bool(row.get("is_active", True)),
        created_at=(str(row.get("created_at")) if row.get("created_at") else None),
        updated_at=(str(row.get("updated_at")) if row.get("updated_at") else None),
    )


def _audit_tenant_timetable_change_best_effort(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    action: str,
    resource_id: Optional[UUID],
    payload: Optional[dict[str, Any]] = None,
    request: Optional[Request] = None,
) -> None:
    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action=action,
        resource="school_timetable",
        resource_id=resource_id,
        payload=payload,
        request=request,
    )


def _serialize_exam_row(
    row: dict[str, Any],
    *,
    term_lookup: dict[str, dict[str, str]],
    subject_lookup: dict[str, dict[str, str]],
    staff_lookup: dict[str, dict[str, str]],
) -> TenantExamOut:
    term_id = str(row.get("term_id") or "").strip()
    subject_id = str(row.get("subject_id") or "").strip()
    staff_id = str(row.get("invigilator_staff_id") or "").strip()
    term = term_lookup.get(term_id) if term_id else None
    subject = subject_lookup.get(subject_id) if subject_id else None
    staff = staff_lookup.get(staff_id) if staff_id else None

    return TenantExamOut(
        id=str(row.get("id") or ""),
        name=str(row.get("name") or ""),
        term_id=(term_id or None),
        term_code=(term.get("code") if term else None),
        term_name=(term.get("name") if term else None),
        class_code=str(row.get("class_code") or ""),
        subject_id=(subject_id or None),
        subject_code=(subject.get("code") if subject else None),
        subject_name=(subject.get("name") if subject else None),
        invigilator_staff_id=(staff_id or None),
        invigilator_staff_no=(staff.get("staff_no") if staff else None),
        invigilator_name=(staff.get("full_name") if staff else None),
        start_date=str(row.get("start_date") or ""),
        end_date=str(row.get("end_date") or ""),
        start_time=(str(row.get("start_time")) if row.get("start_time") is not None else None),
        end_time=(str(row.get("end_time")) if row.get("end_time") is not None else None),
        status=str(row.get("status") or "SCHEDULED"),
        location=(str(row.get("location")) if row.get("location") else None),
        notes=(str(row.get("notes")) if row.get("notes") else None),
        is_active=bool(row.get("is_active", True)),
        created_at=(str(row.get("created_at")) if row.get("created_at") else None),
        updated_at=(str(row.get("updated_at")) if row.get("updated_at") else None),
    )


def _query_tenant_exams(
    db: Session,
    *,
    tenant_id: UUID,
    term_id: Optional[UUID] = None,
    class_code: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    include_inactive: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    table_name = _resolve_exam_table_or_503(db)
    where_parts = ["tenant_id = :tenant_id"]
    params: dict[str, Any] = {
        "tenant_id": str(tenant_id),
        "limit": int(limit),
        "offset": int(offset),
    }
    if not include_inactive:
        where_parts.append("COALESCE(is_active, true) = true")
    if term_id is not None:
        where_parts.append("term_id = :term_id")
        params["term_id"] = str(term_id)
    if class_code:
        where_parts.append("UPPER(class_code) = :class_code")
        params["class_code"] = _normalize_code(class_code)
    if status:
        where_parts.append("UPPER(status) = :status")
        params["status"] = _normalize_exam_status_value(status, field="status")
    if date_from:
        where_parts.append("start_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where_parts.append("end_date <= :date_to")
        params["date_to"] = date_to

    rows = db.execute(
        sa.text(
            f"""
            SELECT id, name,
                   CAST(term_id AS TEXT) AS term_id,
                   class_code,
                   CAST(subject_id AS TEXT) AS subject_id,
                   CAST(invigilator_staff_id AS TEXT) AS invigilator_staff_id,
                   CAST(start_date AS TEXT) AS start_date,
                   CAST(end_date AS TEXT) AS end_date,
                   CAST(start_time AS TEXT) AS start_time,
                   CAST(end_time AS TEXT) AS end_time,
                   status, location, notes, COALESCE(is_active, true) AS is_active,
                   CAST(created_at AS TEXT) AS created_at,
                   CAST(updated_at AS TEXT) AS updated_at
            FROM {table_name}
            WHERE {" AND ".join(where_parts)}
            ORDER BY start_date ASC, start_time ASC NULLS LAST, class_code ASC, name ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()
    return [dict(row) for row in rows]


def _query_tenant_exam_marks(
    db: Session,
    *,
    tenant_id: UUID,
    term_id: Optional[UUID] = None,
    exam_id: Optional[UUID] = None,
    student_enrollment_id: Optional[UUID] = None,
    class_code: Optional[str] = None,
    subject_id: Optional[UUID] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    mark_table = _resolve_exam_mark_table_or_503(db)
    exam_table = _resolve_exam_table_or_503(db)

    where_parts = [
        "m.tenant_id = :tenant_id",
        "e.tenant_id = :tenant_id",
        "m.exam_id = e.id",
    ]
    params: dict[str, Any] = {
        "tenant_id": str(tenant_id),
        "limit": int(limit),
        "offset": int(offset),
    }
    if exam_id is not None:
        where_parts.append("m.exam_id = :exam_id")
        params["exam_id"] = str(exam_id)
    if student_enrollment_id is not None:
        where_parts.append("m.student_enrollment_id = :student_enrollment_id")
        params["student_enrollment_id"] = str(student_enrollment_id)
    if term_id is not None:
        where_parts.append("e.term_id = :term_id")
        params["term_id"] = str(term_id)
    if class_code:
        where_parts.append("UPPER(m.class_code) = :class_code")
        params["class_code"] = _normalize_code(class_code)
    if subject_id is not None:
        where_parts.append("m.subject_id = :subject_id")
        params["subject_id"] = str(subject_id)

    rows = db.execute(
        sa.text(
            f"""
            SELECT m.id,
                   CAST(m.exam_id AS TEXT) AS exam_id,
                   e.name AS exam_name,
                   CAST(e.term_id AS TEXT) AS term_id,
                   m.class_code,
                   CAST(m.subject_id AS TEXT) AS subject_id,
                   CAST(m.student_enrollment_id AS TEXT) AS student_enrollment_id,
                   m.marks_obtained,
                   m.max_marks,
                   m.grade,
                   m.remarks,
                   CAST(m.recorded_at AS TEXT) AS recorded_at,
                   CAST(m.updated_at AS TEXT) AS updated_at
            FROM {mark_table} m
            JOIN {exam_table} e ON e.id = m.exam_id
            WHERE {" AND ".join(where_parts)}
            ORDER BY COALESCE(m.updated_at, m.recorded_at) DESC, m.id DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------
# Tenant Context
# ---------------------------------------------------------------------

@router.get("/whoami")
def whoami(tenant=Depends(get_tenant)):
    return {
        "tenant_id": str(tenant.id),
        "tenant_slug": tenant.slug,
        "tenant_name": tenant.name,
        "curriculum_type": getattr(tenant, "curriculum_type", "CBC") or "CBC",
    }


def _get_or_create_tenant_print_profile(db: Session, *, tenant: Tenant) -> TenantPrintProfile:
    row = db.execute(
        select(TenantPrintProfile).where(TenantPrintProfile.tenant_id == tenant.id)
    ).scalar_one_or_none()
    if row:
        return row

    row = TenantPrintProfile(
        tenant_id=tenant.id,
        school_header=(tenant.name or "").strip() or None,
        receipt_footer="Thank you for partnering with us.",
        paper_size="A4",
        currency="KES",
        thermal_width_mm=80,
        qr_enabled=True,
    )
    db.add(row)
    db.flush()
    return row


def _tenant_badge_storage_dir() -> Path:
    TENANT_BADGE_DIR.mkdir(parents=True, exist_ok=True)
    return TENANT_BADGE_DIR


def _tenant_badge_path(tenant_id: UUID) -> Path | None:
    directory = _tenant_badge_storage_dir()
    for candidate in sorted(directory.glob(f"{tenant_id}.*")):
        if candidate.is_file():
            return candidate
    return None


def _badge_extension_from_upload(badge: UploadFile) -> str:
    content_type = str(getattr(badge, "content_type", "") or "").strip().lower()
    ext = TENANT_BADGE_EXT_BY_CONTENT_TYPE.get(content_type)
    if ext:
        return ext

    suffix = Path(str(getattr(badge, "filename", "") or "")).suffix.lower().lstrip(".")
    if suffix == "jpeg":
        suffix = "jpg"
    if suffix in TENANT_BADGE_CONTENT_TYPE_BY_EXT:
        return suffix

    raise HTTPException(
        status_code=400,
        detail="Unsupported image format. Allowed: PNG, JPG, WEBP, GIF.",
    )


def _replace_tenant_badge_file(*, tenant_id: UUID, extension: str, payload: bytes) -> Path:
    directory = _tenant_badge_storage_dir()
    for existing in directory.glob(f"{tenant_id}.*"):
        if existing.is_file():
            existing.unlink(missing_ok=True)
    target = directory / f"{tenant_id}.{extension}"
    target.write_bytes(payload)
    return target


def _delete_tenant_badge_file(*, tenant_id: UUID) -> None:
    directory = _tenant_badge_storage_dir()
    for existing in directory.glob(f"{tenant_id}.*"):
        if existing.is_file():
            existing.unlink(missing_ok=True)


def _tenant_print_profile_to_out(*, tenant: Tenant, row: TenantPrintProfile | None) -> TenantPrintProfileOut:
    logo_url = (str(getattr(row, "logo_url", "")).strip() or None) if row is not None else None
    if logo_url == "/api/v1/tenants/settings/badge" and _tenant_badge_path(tenant.id) is None:
        logo_url = None

    def _str_or_none(attr: str) -> str | None:
        if row is None:
            return None
        val = str(getattr(row, attr, "") or "").strip()
        return val or None

    return TenantPrintProfileOut(
        tenant_id=str(tenant.id),
        logo_url=logo_url,
        school_header=(
            str(getattr(row, "school_header", "")).strip() or tenant.name
        ) if row is not None else tenant.name,
        receipt_footer=(
            str(getattr(row, "receipt_footer", "")).strip() or "Thank you for partnering with us."
        ) if row is not None else "Thank you for partnering with us.",
        paper_size=str(getattr(row, "paper_size", "A4") or "A4") if row is not None else "A4",
        currency=str(getattr(row, "currency", "KES") or "KES") if row is not None else "KES",
        thermal_width_mm=int(getattr(row, "thermal_width_mm", 80) or 80) if row is not None else 80,
        qr_enabled=bool(getattr(row, "qr_enabled", True)) if row is not None else True,
        po_box=_str_or_none("po_box"),
        physical_address=_str_or_none("physical_address"),
        phone=_str_or_none("phone"),
        email=_str_or_none("email"),
        school_motto=_str_or_none("school_motto"),
        authorized_signatory_name=_str_or_none("authorized_signatory_name"),
        authorized_signatory_title=_str_or_none("authorized_signatory_title"),
    )


@router.get(
    "/print-profile",
    response_model=TenantPrintProfileOut,
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.invoices.view",
                "finance.payments.view",
                "finance.fees.view",
            )
        )
    ],
)
def tenant_print_profile(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    try:
        row = _get_or_create_tenant_print_profile(db, tenant=tenant)
        db.commit()
    except Exception:
        db.rollback()
        row = None

    return _tenant_print_profile_to_out(tenant=tenant, row=row)


@router.put(
    "/print-profile",
    response_model=TenantPrintProfileOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def tenant_update_print_profile(
    payload: TenantPrintProfileUpsert,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    if not _is_director_context(request):
        raise HTTPException(status_code=403, detail="Only the director can update print settings.")

    row = _get_or_create_tenant_print_profile(db, tenant=tenant)

    paper_size = str(payload.paper_size or "A4").upper().strip()
    if paper_size not in {"A4", "THERMAL_80MM"}:
        raise HTTPException(status_code=400, detail="paper_size must be A4 or THERMAL_80MM")

    currency = str(payload.currency or "KES").upper().strip()

    def _clean(val: str | None, max_len: int = 500) -> str | None:
        if val is None:
            return None
        s = str(val).strip()
        return s[:max_len] if s else None

    row.school_header = _clean(payload.school_header)
    row.receipt_footer = _clean(payload.receipt_footer)
    row.paper_size = paper_size
    row.currency = currency
    row.thermal_width_mm = payload.thermal_width_mm
    row.qr_enabled = payload.qr_enabled
    row.po_box = _clean(payload.po_box, 100)
    row.physical_address = _clean(payload.physical_address, 2000)
    row.phone = _clean(payload.phone, 50)
    row.email = _clean(payload.email, 255)
    row.school_motto = _clean(payload.school_motto)
    row.authorized_signatory_name = _clean(payload.authorized_signatory_name, 200)
    row.authorized_signatory_title = _clean(payload.authorized_signatory_title, 200)
    row.updated_by = user.id
    db.commit()
    db.refresh(row)
    return _tenant_print_profile_to_out(tenant=tenant, row=row)


@router.get("/admission-settings")
def get_admission_settings(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    """Return the tenant's admission number configuration."""
    row = db.execute(
        sa.text(
            "SELECT prefix, last_number FROM core.tenant_admission_settings "
            "WHERE tenant_id = :tid LIMIT 1"
        ),
        {"tid": str(tenant.id)},
    ).mappings().first()
    if row:
        return {"prefix": str(row["prefix"] or "ADM-"), "last_number": int(row["last_number"] or 0)}
    return {"prefix": "ADM-", "last_number": 0}


@router.put("/admission-settings")
def save_admission_settings(
    body: dict,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    """Save the tenant's admission number prefix and last issued number."""
    if not _is_director_context(request):
        raise HTTPException(status_code=403, detail="Only the director can update admission settings.")

    raw_prefix = str(body.get("prefix") or "ADM-").strip()[:30]
    raw_last = int(body.get("last_number") or 0)
    if raw_last < 0:
        raise HTTPException(status_code=400, detail="last_number cannot be negative")

    existing = db.execute(
        sa.text(
            "SELECT id FROM core.tenant_admission_settings WHERE tenant_id = :tid LIMIT 1"
        ),
        {"tid": str(tenant.id)},
    ).mappings().first()

    if existing:
        db.execute(
            sa.text(
                "UPDATE core.tenant_admission_settings "
                "SET prefix = :prefix, last_number = :last_number, updated_at = now() "
                "WHERE tenant_id = :tid"
            ),
            {"tid": str(tenant.id), "prefix": raw_prefix, "last_number": raw_last},
        )
    else:
        db.execute(
            sa.text(
                "INSERT INTO core.tenant_admission_settings (tenant_id, prefix, last_number) "
                "VALUES (:tid, :prefix, :last_number)"
            ),
            {"tid": str(tenant.id), "prefix": raw_prefix, "last_number": raw_last},
        )

    db.commit()
    return {"prefix": raw_prefix, "last_number": raw_last}


@router.get("/settings/badge")
def tenant_settings_get_badge(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    row = db.execute(
        select(TenantPrintProfile).where(TenantPrintProfile.tenant_id == tenant.id)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="School badge not configured.")

    badge_path = _tenant_badge_path(tenant.id)
    if badge_path is None or not badge_path.exists() or not badge_path.is_file():
        raise HTTPException(status_code=404, detail="School badge not configured.")

    ext = badge_path.suffix.lower().lstrip(".")
    media_type = TENANT_BADGE_CONTENT_TYPE_BY_EXT.get(ext, "application/octet-stream")
    return Response(
        content=badge_path.read_bytes(),
        media_type=media_type,
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/settings/badge",
    response_model=TenantPrintProfileOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def tenant_settings_upload_badge(
    request: Request,
    badge: UploadFile = File(...),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    if not _is_director_context(request):
        raise HTTPException(status_code=403, detail="Only the director can update the school badge.")

    ext = _badge_extension_from_upload(badge)
    try:
        payload = badge.file.read(TENANT_BADGE_MAX_BYTES + 1)
    finally:
        try:
            badge.file.close()
        except Exception:
            pass
    size = len(payload)
    if size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if size > TENANT_BADGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="School badge must be 2MB or smaller.")

    _replace_tenant_badge_file(tenant_id=tenant.id, extension=ext, payload=payload)
    row = _get_or_create_tenant_print_profile(db, tenant=tenant)
    row.logo_url = "/api/v1/tenants/settings/badge"
    db.commit()
    db.refresh(row)
    return _tenant_print_profile_to_out(tenant=tenant, row=row)


@router.delete(
    "/settings/badge",
    status_code=204,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def tenant_settings_delete_badge(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    if not _is_director_context(request):
        raise HTTPException(status_code=403, detail="Only the director can remove the school badge.")

    row = _get_or_create_tenant_print_profile(db, tenant=tenant)
    _delete_tenant_badge_file(tenant_id=tenant.id)
    row.logo_url = None
    db.commit()
    return Response(status_code=204)


@router.post(
    "/settings/password/self",
    response_model=TenantSettingsPasswordResetOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def tenant_settings_reset_own_password(
    payload: TenantSettingsPasswordSelfIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    # Secretary cannot reset own password from tenant settings.
    if not _is_director_context(request):
        raise HTTPException(
            status_code=403,
            detail="Only the director can reset passwords from tenant settings.",
        )

    new_password = _validated_password(payload.new_password)
    db_user = db.execute(
        select(User)
        .select_from(UserTenant)
        .join(User, User.id == UserTenant.user_id)
        .where(
            UserTenant.tenant_id == tenant.id,
            UserTenant.user_id == user.id,
            UserTenant.is_active == True,
        )
        .limit(1)
    ).scalar_one_or_none()
    if db_user is None:
        raise HTTPException(status_code=404, detail="Current user was not found in this tenant")

    current_password = str(payload.current_password or "").strip()
    if current_password and not verify_password(current_password, db_user.password_hash):
        raise HTTPException(status_code=400, detail="current_password is invalid")

    db_user.password_hash = hash_password(new_password)
    db_user.is_active = True
    db.commit()

    return TenantSettingsPasswordResetOut(
        ok=True,
        user_id=str(db_user.id),
        email=str(db_user.email),
    )


@router.post(
    "/settings/password/secretary",
    response_model=TenantSettingsPasswordResetOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def tenant_settings_reset_secretary_password(
    payload: TenantSettingsPasswordSecretaryIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    if not _is_director_context(request):
        raise HTTPException(
            status_code=403,
            detail="Only the director can reset secretary passwords.",
        )

    secretary_user_id = _parse_uuid(
        payload.secretary_user_id,
        field="payload.secretary_user_id",
    )
    new_password = _validated_password(payload.new_password)

    secretary_user = db.execute(
        select(User)
        .select_from(UserTenant)
        .join(User, User.id == UserTenant.user_id)
        .where(
            UserTenant.tenant_id == tenant.id,
            UserTenant.user_id == secretary_user_id,
            UserTenant.is_active == True,
        )
        .limit(1)
    ).scalar_one_or_none()
    if secretary_user is None:
        raise HTTPException(status_code=404, detail="Secretary user was not found in this tenant")

    has_secretary_role = db.execute(
        select(UserRole.id)
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            UserRole.tenant_id == tenant.id,
            UserRole.user_id == secretary_user_id,
            sa.func.upper(Role.code) == "SECRETARY",
        )
        .limit(1)
    ).first()
    if has_secretary_role is None:
        raise HTTPException(status_code=400, detail="Selected user is not a secretary")

    secretary_user.password_hash = hash_password(new_password)
    secretary_user.is_active = True
    db.commit()

    return TenantSettingsPasswordResetOut(
        ok=True,
        user_id=str(secretary_user.id),
        email=str(secretary_user.email),
    )


# ---------------------------------------------------------------------
# Tenant School Setup (Classes + Terms)
# ---------------------------------------------------------------------

@router.get(
    "/classes",
    response_model=list[TenantClassOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_tenant_classes(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    include_inactive: bool = Query(default=False),
):
    """
    Tenant-scoped classes used by enrollments and finance setup.
    Deterministic ordering: code asc, name asc.
    """
    rows, _ = _read_rows_first_table(
        db,
        table_candidates=TENANT_CLASS_TABLE_CANDIDATES,
        sql_template=(
            """
            SELECT id, code, name, COALESCE(is_active, true) AS is_active
            FROM {table}
            WHERE tenant_id = :tenant_id
            """
            + ("" if include_inactive else " AND COALESCE(is_active, true) = true ")
            + " ORDER BY code ASC, name ASC"
        ),
        params={"tenant_id": str(tenant.id)},
    )

    return [
        TenantClassOut(
            id=str(r.get("id")),
            code=str(r.get("code") or ""),
            name=str(r.get("name") or ""),
            is_active=bool(r.get("is_active", True)),
        )
        for r in rows
    ]


@router.post(
    "/classes",
    response_model=TenantClassOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_tenant_class(
    payload: TenantClassCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    code = _normalize_code(payload.code)
    name = _normalize_name(payload.name)
    if not code or not name:
        raise HTTPException(status_code=400, detail="code and name are required")

    existing_q = """
        SELECT id
        FROM {table}
        WHERE tenant_id = :tenant_id AND UPPER(code) = :code
        LIMIT 1
    """
    existing_result, table_name = _execute_on_first_table(
        db,
        table_candidates=TENANT_CLASS_TABLE_CANDIDATES,
        sql_template=existing_q,
        params={"tenant_id": str(tenant.id), "code": code},
    )
    if existing_result.first():
        raise HTTPException(status_code=409, detail="Class code already exists for this tenant")

    insert_q = """
        INSERT INTO {table} (id, tenant_id, code, name, is_active)
        VALUES (:id, :tenant_id, :code, :name, :is_active)
        RETURNING id, code, name, COALESCE(is_active, true) AS is_active
    """
    result = db.execute(
        sa.text(insert_q.format(table=table_name)),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "code": code,
            "name": name,
            "is_active": bool(payload.is_active),
        },
    ).mappings().first()
    db.commit()

    if not result:
        raise HTTPException(status_code=500, detail="Failed to create class")

    return TenantClassOut(
        id=str(result["id"]),
        code=str(result["code"]),
        name=str(result["name"]),
        is_active=bool(result["is_active"]),
    )


@router.put(
    "/classes/{class_id}",
    response_model=TenantClassOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_tenant_class(
    class_id: UUID,
    payload: TenantClassUpdateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    updates: list[str] = []
    params: dict[str, Any] = {"class_id": str(class_id), "tenant_id": str(tenant.id)}

    if payload.code is not None:
        code = _normalize_code(payload.code)
        if not code:
            raise HTTPException(status_code=400, detail="code cannot be empty")
        updates.append("code = :code")
        params["code"] = code

    if payload.name is not None:
        name = _normalize_name(payload.name)
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        updates.append("name = :name")
        params["name"] = name

    if payload.is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = bool(payload.is_active)

    if not updates:
        raise HTTPException(status_code=400, detail="No updates supplied")

    # Resolve table + ensure row exists within current tenant
    select_q = """
        SELECT id
        FROM {table}
        WHERE id = :class_id AND tenant_id = :tenant_id
        LIMIT 1
    """
    select_result, table_name = _execute_on_first_table(
        db,
        table_candidates=TENANT_CLASS_TABLE_CANDIDATES,
        sql_template=select_q,
        params={"class_id": str(class_id), "tenant_id": str(tenant.id)},
    )
    if not select_result.first():
        raise HTTPException(status_code=404, detail="Class not found")

    if "code" in params:
        dup_check_q = """
            SELECT id
            FROM {table}
            WHERE tenant_id = :tenant_id AND UPPER(code) = :code AND id <> :class_id
            LIMIT 1
        """
        dup = db.execute(
            sa.text(dup_check_q.format(table=table_name)),
            {"tenant_id": str(tenant.id), "code": params["code"], "class_id": str(class_id)},
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail="Class code already exists for this tenant")

    update_q = f"""
        UPDATE {table_name}
        SET {", ".join(updates)}
        WHERE id = :class_id AND tenant_id = :tenant_id
        RETURNING id, code, name, COALESCE(is_active, true) AS is_active
    """
    updated = db.execute(sa.text(update_q), params).mappings().first()
    db.commit()

    if not updated:
        raise HTTPException(status_code=404, detail="Class not found")

    return TenantClassOut(
        id=str(updated["id"]),
        code=str(updated["code"]),
        name=str(updated["name"]),
        is_active=bool(updated["is_active"]),
    )


@router.get(
    "/terms",
    response_model=list[TenantTermOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_tenant_terms(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    include_inactive: bool = Query(default=False),
):
    """
    Tenant-scoped academic terms.
    Deterministic ordering: name asc, code asc.
    """
    rows, _ = _read_rows_first_table(
        db,
        table_candidates=TENANT_TERM_TABLE_CANDIDATES,
        sql_template=(
            """
            SELECT id, code, name, COALESCE(is_active, true) AS is_active,
                   CAST(start_date AS TEXT) AS start_date,
                   CAST(end_date AS TEXT) AS end_date
            FROM {table}
            WHERE tenant_id = :tenant_id
            """
            + ("" if include_inactive else " AND COALESCE(is_active, true) = true ")
            + " ORDER BY name ASC, code ASC"
        ),
        params={"tenant_id": str(tenant.id)},
    )

    return [
        TenantTermOut(
            id=str(r.get("id")),
            code=str(r.get("code") or ""),
            name=str(r.get("name") or ""),
            is_active=bool(r.get("is_active", True)),
            start_date=(str(r.get("start_date")) if r.get("start_date") is not None else None),
            end_date=(str(r.get("end_date")) if r.get("end_date") is not None else None),
        )
        for r in rows
    ]


@router.post(
    "/terms",
    response_model=TenantTermOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_tenant_term(
    payload: TenantTermCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    code = _normalize_code(payload.code)
    name = _normalize_name(payload.name)
    if not code or not name:
        raise HTTPException(status_code=400, detail="code and name are required")

    existing_q = """
        SELECT id
        FROM {table}
        WHERE tenant_id = :tenant_id AND UPPER(code) = :code
        LIMIT 1
    """
    existing_result, table_name = _execute_on_first_table(
        db,
        table_candidates=TENANT_TERM_TABLE_CANDIDATES,
        sql_template=existing_q,
        params={"tenant_id": str(tenant.id), "code": code},
    )
    if existing_result.first():
        raise HTTPException(status_code=409, detail="Term code already exists for this tenant")

    insert_q = """
        INSERT INTO {table} (id, tenant_id, code, name, is_active, start_date, end_date)
        VALUES (:id, :tenant_id, :code, :name, :is_active, :start_date, :end_date)
        RETURNING id, code, name, COALESCE(is_active, true) AS is_active,
                  CAST(start_date AS TEXT) AS start_date,
                  CAST(end_date AS TEXT) AS end_date
    """
    created = db.execute(
        sa.text(insert_q.format(table=table_name)),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "code": code,
            "name": name,
            "is_active": bool(payload.is_active),
            "start_date": payload.start_date,
            "end_date": payload.end_date,
        },
    ).mappings().first()
    db.commit()

    if not created:
        raise HTTPException(status_code=500, detail="Failed to create term")

    return TenantTermOut(
        id=str(created["id"]),
        code=str(created["code"]),
        name=str(created["name"]),
        is_active=bool(created["is_active"]),
        start_date=(str(created["start_date"]) if created["start_date"] is not None else None),
        end_date=(str(created["end_date"]) if created["end_date"] is not None else None),
    )


@router.put(
    "/terms/{term_id}",
    response_model=TenantTermOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_tenant_term(
    term_id: UUID,
    payload: TenantTermUpdateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    updates: list[str] = []
    params: dict[str, Any] = {"term_id": str(term_id), "tenant_id": str(tenant.id)}

    if payload.code is not None:
        code = _normalize_code(payload.code)
        if not code:
            raise HTTPException(status_code=400, detail="code cannot be empty")
        updates.append("code = :code")
        params["code"] = code

    if payload.name is not None:
        name = _normalize_name(payload.name)
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        updates.append("name = :name")
        params["name"] = name

    if payload.is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = bool(payload.is_active)

    if payload.start_date is not None:
        updates.append("start_date = :start_date")
        params["start_date"] = payload.start_date

    if payload.end_date is not None:
        updates.append("end_date = :end_date")
        params["end_date"] = payload.end_date

    if not updates:
        raise HTTPException(status_code=400, detail="No updates supplied")

    select_q = """
        SELECT id
        FROM {table}
        WHERE id = :term_id AND tenant_id = :tenant_id
        LIMIT 1
    """
    select_result, table_name = _execute_on_first_table(
        db,
        table_candidates=TENANT_TERM_TABLE_CANDIDATES,
        sql_template=select_q,
        params={"term_id": str(term_id), "tenant_id": str(tenant.id)},
    )
    if not select_result.first():
        raise HTTPException(status_code=404, detail="Term not found")

    if "code" in params:
        dup_check_q = """
            SELECT id
            FROM {table}
            WHERE tenant_id = :tenant_id AND UPPER(code) = :code AND id <> :term_id
            LIMIT 1
        """
        dup = db.execute(
            sa.text(dup_check_q.format(table=table_name)),
            {"tenant_id": str(tenant.id), "code": params["code"], "term_id": str(term_id)},
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail="Term code already exists for this tenant")

    update_q = f"""
        UPDATE {table_name}
        SET {", ".join(updates)}
        WHERE id = :term_id AND tenant_id = :tenant_id
        RETURNING id, code, name, COALESCE(is_active, true) AS is_active,
                  CAST(start_date AS TEXT) AS start_date,
                  CAST(end_date AS TEXT) AS end_date
    """
    updated = db.execute(sa.text(update_q), params).mappings().first()
    db.commit()

    if not updated:
        raise HTTPException(status_code=404, detail="Term not found")

    return TenantTermOut(
        id=str(updated["id"]),
        code=str(updated["code"]),
        name=str(updated["name"]),
        is_active=bool(updated["is_active"]),
        start_date=(str(updated["start_date"]) if updated["start_date"] is not None else None),
        end_date=(str(updated["end_date"]) if updated["end_date"] is not None else None),
    )


def _serialize_school_calendar_event_row(row: dict[str, Any]) -> TenantSchoolCalendarEventOut:
    return TenantSchoolCalendarEventOut(
        id=str(row.get("id") or ""),
        academic_year=int(row.get("academic_year") or 0),
        event_type=str(row.get("event_type") or "HALF_TERM_BREAK"),
        title=str(row.get("title") or ""),
        term_code=(str(row.get("term_code")) if row.get("term_code") else None),
        start_date=str(row.get("start_date") or ""),
        end_date=str(row.get("end_date") or ""),
        notes=(str(row.get("notes")) if row.get("notes") else None),
        is_active=bool(row.get("is_active", True)),
    )


@router.get(
    "/school-calendar/events",
    response_model=list[TenantSchoolCalendarEventOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_tenant_school_calendar_events(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    academic_year: Optional[int] = Query(default=None, ge=2000, le=2100),
    event_type: Optional[Literal["HALF_TERM_BREAK", "EXAM_WINDOW"]] = Query(default=None),
    include_inactive: bool = Query(default=False),
):
    _ensure_tenant_school_calendar_event_table(db)

    params: dict[str, Any] = {"tenant_id": str(tenant.id)}
    where_parts = ["tenant_id = :tenant_id"]
    if academic_year is not None:
        where_parts.append("academic_year = :academic_year")
        params["academic_year"] = academic_year
    if event_type is not None:
        where_parts.append("event_type = :event_type")
        params["event_type"] = event_type
    if not include_inactive:
        where_parts.append("COALESCE(is_active, true) = true")

    rows, _ = _read_rows_first_table(
        db,
        table_candidates=TENANT_SCHOOL_CALENDAR_EVENT_TABLE_CANDIDATES,
        sql_template=(
            """
            SELECT id, academic_year, event_type, title, term_code,
                   CAST(start_date AS TEXT) AS start_date,
                   CAST(end_date AS TEXT) AS end_date,
                   notes,
                   COALESCE(is_active, true) AS is_active
            FROM {table}
            WHERE """
            + " AND ".join(where_parts)
            + " ORDER BY academic_year ASC, start_date ASC, title ASC"
        ),
        params=params,
    )
    return [_serialize_school_calendar_event_row(row) for row in rows]


@router.post(
    "/school-calendar/events",
    response_model=TenantSchoolCalendarEventOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_tenant_school_calendar_event(
    payload: TenantSchoolCalendarEventCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    _ensure_tenant_school_calendar_event_table(db)

    title = _normalize_name(payload.title or "")
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    term_code = _normalize_code(payload.term_code) if payload.term_code else None
    start_date = _normalize_iso_date_value(payload.start_date, field="start_date", required=True)
    end_date = _normalize_iso_date_value(payload.end_date, field="end_date", required=True)
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")

    academic_year = _normalize_academic_year(payload.academic_year, start_date=start_date)
    created = db.execute(
        sa.text(
            """
            INSERT INTO core.tenant_school_calendar_events (
                id, tenant_id, academic_year, event_type, title, term_code,
                start_date, end_date, notes, is_active, updated_at
            )
            VALUES (
                :id, :tenant_id, :academic_year, :event_type, :title, :term_code,
                :start_date, :end_date, :notes, :is_active, now()
            )
            RETURNING id, academic_year, event_type, title, term_code,
                      CAST(start_date AS TEXT) AS start_date,
                      CAST(end_date AS TEXT) AS end_date,
                      notes,
                      COALESCE(is_active, true) AS is_active
            """
        ),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "academic_year": academic_year,
            "event_type": payload.event_type,
            "title": title,
            "term_code": term_code,
            "start_date": start_date,
            "end_date": end_date,
            "notes": _text_or_none(payload.notes),
            "is_active": bool(payload.is_active),
        },
    ).mappings().first()
    db.commit()

    if not created:
        raise HTTPException(status_code=500, detail="Failed to create school calendar event")

    resource_id = UUID(str(created["id"]))
    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        action="school_calendar.event.create",
        resource="school_calendar_event",
        resource_id=resource_id,
        payload={
            "academic_year": academic_year,
            "event_type": payload.event_type,
            "title": title,
            "term_code": term_code,
            "start_date": start_date,
            "end_date": end_date,
        },
        request=request,
    )
    db.commit()
    return _serialize_school_calendar_event_row(dict(created))


@router.put(
    "/school-calendar/events/{event_id}",
    response_model=TenantSchoolCalendarEventOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_tenant_school_calendar_event(
    event_id: UUID,
    payload: TenantSchoolCalendarEventUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    _ensure_tenant_school_calendar_event_table(db)

    params: dict[str, Any] = {"event_id": str(event_id), "tenant_id": str(tenant.id)}
    updates: list[str] = []

    if payload.title is not None:
        title = _normalize_name(payload.title)
        if not title:
            raise HTTPException(status_code=400, detail="title cannot be empty")
        params["title"] = title
        updates.append("title = :title")

    if payload.term_code is not None:
        params["term_code"] = _normalize_code(payload.term_code) if payload.term_code else None
        updates.append("term_code = :term_code")

    if payload.academic_year is not None:
        params["academic_year"] = int(payload.academic_year)
        updates.append("academic_year = :academic_year")

    normalized_start = None
    normalized_end = None
    if payload.start_date is not None:
        normalized_start = _normalize_iso_date_value(payload.start_date, field="start_date", required=True)
        params["start_date"] = normalized_start
        updates.append("start_date = :start_date")

    if payload.end_date is not None:
        normalized_end = _normalize_iso_date_value(payload.end_date, field="end_date", required=True)
        params["end_date"] = normalized_end
        updates.append("end_date = :end_date")

    if normalized_start and normalized_end and normalized_end < normalized_start:
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")

    if payload.notes is not None:
        params["notes"] = _text_or_none(payload.notes)
        updates.append("notes = :notes")

    if payload.is_active is not None:
        params["is_active"] = bool(payload.is_active)
        updates.append("is_active = :is_active")

    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    params["updated_at"] = datetime.now(timezone.utc).isoformat()
    updated = db.execute(
        sa.text(
            """
            UPDATE core.tenant_school_calendar_events
            SET """
            + ", ".join(updates)
            + """,
                updated_at = now()
            WHERE id = :event_id AND tenant_id = :tenant_id
            RETURNING id, academic_year, event_type, title, term_code,
                      CAST(start_date AS TEXT) AS start_date,
                      CAST(end_date AS TEXT) AS end_date,
                      notes,
                      COALESCE(is_active, true) AS is_active
            """
        ),
        params,
    ).mappings().first()
    db.commit()

    if not updated:
        raise HTTPException(status_code=404, detail="School calendar event not found")

    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        action="school_calendar.event.update",
        resource="school_calendar_event",
        resource_id=event_id,
        payload={"event_type": updated["event_type"], "title": updated["title"]},
        request=request,
    )
    db.commit()
    return _serialize_school_calendar_event_row(dict(updated))


@router.delete(
    "/school-calendar/events/{event_id}",
    response_model=dict,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def delete_tenant_school_calendar_event(
    event_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    _ensure_tenant_school_calendar_event_table(db)

    deleted = db.execute(
        sa.text(
            """
            DELETE FROM core.tenant_school_calendar_events
            WHERE id = :event_id AND tenant_id = :tenant_id
            RETURNING id, event_type, title
            """
        ),
        {"event_id": str(event_id), "tenant_id": str(tenant.id)},
    ).mappings().first()
    db.commit()

    if not deleted:
        raise HTTPException(status_code=404, detail="School calendar event not found")

    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        action="school_calendar.event.delete",
        resource="school_calendar_event",
        resource_id=event_id,
        payload={"event_type": deleted["event_type"], "title": deleted["title"]},
        request=request,
    )
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------
# Tenant Exams
# ---------------------------------------------------------------------

def _serialize_exam_mark_row(
    row: dict[str, Any],
    *,
    term_lookup: dict[str, dict[str, str]],
    subject_lookup: dict[str, dict[str, str]],
    enrollment_index: dict[str, dict[str, str]],
) -> TenantExamMarkOut:
    term_id = str(row.get("term_id") or "")
    subject_id = str(row.get("subject_id") or "")
    enrollment_id = str(row.get("student_enrollment_id") or "")
    term = term_lookup.get(term_id) if term_id else None
    subject = subject_lookup.get(subject_id) if subject_id else None
    enrollment = enrollment_index.get(enrollment_id) if enrollment_id else None

    return TenantExamMarkOut(
        id=str(row.get("id") or ""),
        exam_id=str(row.get("exam_id") or ""),
        exam_name=str(row.get("exam_name") or ""),
        term_id=(term_id or None),
        term_code=(term.get("code") if term else None),
        term_name=(term.get("name") if term else None),
        class_code=str(row.get("class_code") or ""),
        subject_id=subject_id,
        subject_code=(subject.get("code") if subject else None),
        subject_name=(subject.get("name") if subject else None),
        student_enrollment_id=enrollment_id,
        student_name=(enrollment.get("student_name") if enrollment else "Unknown student"),
        admission_number=(enrollment.get("admission_number") if enrollment else None),
        marks_obtained=str(row.get("marks_obtained") or "0"),
        max_marks=str(row.get("max_marks") or "0"),
        grade=(str(row.get("grade")) if row.get("grade") else None),
        remarks=(str(row.get("remarks")) if row.get("remarks") else None),
        recorded_at=(str(row.get("recorded_at")) if row.get("recorded_at") else None),
        updated_at=(str(row.get("updated_at")) if row.get("updated_at") else None),
    )


@router.get(
    "/exams",
    response_model=list[TenantExamOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_tenant_exams(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    term_id: Optional[UUID] = Query(default=None),
    class_code: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    start_date = _normalize_iso_date_value(date_from, field="date_from") if date_from else None
    end_date = _normalize_iso_date_value(date_to, field="date_to") if date_to else None
    rows = _query_tenant_exams(
        db,
        tenant_id=tenant.id,
        term_id=term_id,
        class_code=class_code,
        status=status,
        date_from=start_date,
        date_to=end_date,
        include_inactive=include_inactive,
        limit=limit,
        offset=offset,
    )
    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    staff_lookup = _staff_lookup_for_tenant(db, tenant_id=tenant.id)
    return [
        _serialize_exam_row(
            row,
            term_lookup=term_lookup,
            subject_lookup=subject_lookup,
            staff_lookup=staff_lookup,
        )
        for row in rows
    ]


@router.get(
    "/exams/timetable",
    response_model=list[TenantExamOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def tenant_exam_timetable(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    term_id: Optional[UUID] = Query(default=None),
    class_code: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    start_date = _normalize_iso_date_value(date_from, field="date_from") if date_from else None
    end_date = _normalize_iso_date_value(date_to, field="date_to") if date_to else None
    rows = _query_tenant_exams(
        db,
        tenant_id=tenant.id,
        term_id=term_id,
        class_code=class_code,
        date_from=start_date,
        date_to=end_date,
        include_inactive=include_inactive,
        limit=limit,
        offset=offset,
    )
    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    staff_lookup = _staff_lookup_for_tenant(db, tenant_id=tenant.id)
    return [
        _serialize_exam_row(
            row,
            term_lookup=term_lookup,
            subject_lookup=subject_lookup,
            staff_lookup=staff_lookup,
        )
        for row in rows
    ]


@router.post(
    "/exams",
    response_model=TenantExamOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_tenant_exam(
    payload: TenantExamCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    name = _normalize_name(payload.name)
    term_id = _parse_uuid(payload.term_id, field="term_id")
    class_code = _normalize_code(payload.class_code)
    if not name or not class_code:
        raise HTTPException(status_code=400, detail="name, term_id, and class_code are required")

    start_date = _normalize_iso_date_value(payload.start_date, field="start_date", required=True)
    end_date = _normalize_iso_date_value(payload.end_date, field="end_date") or start_date
    if date.fromisoformat(end_date) < date.fromisoformat(start_date):
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")

    start_time = _normalize_exam_time_value(payload.start_time, field="start_time")
    end_time = _normalize_exam_time_value(payload.end_time, field="end_time")
    if (
        start_date == end_date
        and start_time is not None
        and end_time is not None
        and end_time < start_time
    ):
        raise HTTPException(status_code=400, detail="end_time cannot be earlier than start_time")
    status = _normalize_exam_status_value(payload.status, field="status")

    subject_id: UUID | None = None
    subject_raw = _text_or_none(payload.subject_id)
    if subject_raw:
        subject_id = _parse_uuid(subject_raw, field="subject_id")
        _ensure_tenant_subject_exists(db, tenant_id=tenant.id, subject_id=subject_id)

    invigilator_staff_id: UUID | None = None
    invigilator_raw = _text_or_none(payload.invigilator_staff_id)
    if invigilator_raw:
        invigilator_staff_id = _parse_uuid(invigilator_raw, field="invigilator_staff_id")
        _ensure_tenant_invigilator_exists(
            db,
            tenant_id=tenant.id,
            staff_id=invigilator_staff_id,
        )

    _ensure_tenant_term_exists(db, tenant_id=tenant.id, term_id=term_id)
    _ensure_tenant_class_exists(db, tenant_id=tenant.id, class_code=class_code)
    table_name = _resolve_exam_table_or_503(db)

    duplicate = db.execute(
        sa.text(
            f"""
            SELECT id
            FROM {table_name}
            WHERE tenant_id = :tenant_id
              AND term_id = :term_id
              AND UPPER(class_code) = :class_code
              AND UPPER(name) = :name
              AND start_date = :start_date
              AND COALESCE(CAST(start_time AS TEXT), '') = COALESCE(:start_time, '')
              AND COALESCE(CAST(subject_id AS TEXT), '') = COALESCE(:subject_id, '')
            LIMIT 1
            """
        ),
        {
            "tenant_id": str(tenant.id),
            "term_id": str(term_id),
            "class_code": class_code,
            "name": name.upper(),
            "start_date": start_date,
            "start_time": start_time,
            "subject_id": str(subject_id) if subject_id else None,
        },
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="An exam with the same class, subject, and start slot already exists",
        )

    created = db.execute(
        sa.text(
            f"""
            INSERT INTO {table_name} (
                id, tenant_id, name, term_id, class_code, subject_id, invigilator_staff_id,
                start_date, end_date, start_time, end_time, status, location, notes, is_active
            )
            VALUES (
                :id, :tenant_id, :name, :term_id, :class_code, :subject_id, :invigilator_staff_id,
                :start_date, :end_date, :start_time, :end_time, :status, :location, :notes, :is_active
            )
            RETURNING id, name, CAST(term_id AS TEXT) AS term_id, class_code,
                      CAST(subject_id AS TEXT) AS subject_id,
                      CAST(invigilator_staff_id AS TEXT) AS invigilator_staff_id,
                      CAST(start_date AS TEXT) AS start_date,
                      CAST(end_date AS TEXT) AS end_date,
                      CAST(start_time AS TEXT) AS start_time,
                      CAST(end_time AS TEXT) AS end_time,
                      status, location, notes, COALESCE(is_active, true) AS is_active,
                      CAST(created_at AS TEXT) AS created_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "name": name,
            "term_id": str(term_id),
            "class_code": class_code,
            "subject_id": str(subject_id) if subject_id else None,
            "invigilator_staff_id": str(invigilator_staff_id) if invigilator_staff_id else None,
            "start_date": start_date,
            "end_date": end_date,
            "start_time": start_time,
            "end_time": end_time,
            "status": status,
            "location": _text_or_none(payload.location),
            "notes": _text_or_none(payload.notes),
            "is_active": bool(payload.is_active),
        },
    ).mappings().first()
    db.commit()

    if not created:
        raise HTTPException(status_code=500, detail="Failed to create exam")

    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    staff_lookup = _staff_lookup_for_tenant(db, tenant_id=tenant.id)
    return _serialize_exam_row(
        dict(created),
        term_lookup=term_lookup,
        subject_lookup=subject_lookup,
        staff_lookup=staff_lookup,
    )


@router.put(
    "/exams/{exam_id}",
    response_model=TenantExamOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_tenant_exam(
    exam_id: UUID,
    payload: TenantExamUpdateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    fields_set = _payload_fields_set(payload)
    if not fields_set:
        raise HTTPException(status_code=400, detail="No updates supplied")

    table_name = _resolve_exam_table_or_503(db)
    current = db.execute(
        sa.text(
            f"""
            SELECT id, name, CAST(term_id AS TEXT) AS term_id, class_code, CAST(subject_id AS TEXT) AS subject_id,
                   CAST(start_date AS TEXT) AS start_date,
                   CAST(end_date AS TEXT) AS end_date,
                   CAST(start_time AS TEXT) AS start_time,
                   CAST(end_time AS TEXT) AS end_time
            FROM {table_name}
            WHERE id = :exam_id AND tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"exam_id": str(exam_id), "tenant_id": str(tenant.id)},
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Exam not found")

    updates: list[str] = ["updated_at = now()"]
    params: dict[str, Any] = {"exam_id": str(exam_id), "tenant_id": str(tenant.id)}

    def set_update(column: str, value: Any):
        updates.append(f"{column} = :{column}")
        params[column] = value

    if "name" in fields_set:
        name = _normalize_name(payload.name or "")
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        set_update("name", name)

    if "term_id" in fields_set:
        term_raw = _text_or_none(payload.term_id)
        if not term_raw:
            raise HTTPException(status_code=400, detail="term_id cannot be empty")
        term_uuid = _parse_uuid(term_raw, field="term_id")
        _ensure_tenant_term_exists(db, tenant_id=tenant.id, term_id=term_uuid)
        set_update("term_id", str(term_uuid))

    if "class_code" in fields_set:
        class_code = _normalize_code(payload.class_code or "")
        if not class_code:
            raise HTTPException(status_code=400, detail="class_code cannot be empty")
        _ensure_tenant_class_exists(db, tenant_id=tenant.id, class_code=class_code)
        set_update("class_code", class_code)

    if "subject_id" in fields_set:
        subject_raw = _text_or_none(payload.subject_id)
        if subject_raw:
            subject_id = _parse_uuid(subject_raw, field="subject_id")
            _ensure_tenant_subject_exists(db, tenant_id=tenant.id, subject_id=subject_id)
            set_update("subject_id", str(subject_id))
        else:
            set_update("subject_id", None)

    if "invigilator_staff_id" in fields_set:
        invigilator_raw = _text_or_none(payload.invigilator_staff_id)
        if invigilator_raw:
            staff_id = _parse_uuid(invigilator_raw, field="invigilator_staff_id")
            _ensure_tenant_invigilator_exists(db, tenant_id=tenant.id, staff_id=staff_id)
            set_update("invigilator_staff_id", str(staff_id))
        else:
            set_update("invigilator_staff_id", None)

    if "start_date" in fields_set:
        start_date = _normalize_iso_date_value(payload.start_date, field="start_date", required=True)
        set_update("start_date", start_date)

    if "end_date" in fields_set:
        end_date = _normalize_iso_date_value(payload.end_date, field="end_date", required=True)
        set_update("end_date", end_date)

    if "start_time" in fields_set:
        start_time = _normalize_exam_time_value(payload.start_time, field="start_time")
        set_update("start_time", start_time)

    if "end_time" in fields_set:
        end_time = _normalize_exam_time_value(payload.end_time, field="end_time")
        set_update("end_time", end_time)

    if "status" in fields_set:
        set_update("status", _normalize_exam_status_value(payload.status, field="status"))

    if "location" in fields_set:
        set_update("location", _text_or_none(payload.location))

    if "notes" in fields_set:
        set_update("notes", _text_or_none(payload.notes))

    if "is_active" in fields_set and payload.is_active is not None:
        set_update("is_active", bool(payload.is_active))

    effective_start = str(params.get("start_date") or current.get("start_date") or "")
    effective_end = str(params.get("end_date") or current.get("end_date") or "")
    if not effective_start or not effective_end:
        raise HTTPException(status_code=400, detail="start_date and end_date are required")
    if date.fromisoformat(effective_end) < date.fromisoformat(effective_start):
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")

    effective_start_time = _text_or_none(params.get("start_time")) or _text_or_none(current.get("start_time"))
    effective_end_time = _text_or_none(params.get("end_time")) or _text_or_none(current.get("end_time"))
    if (
        effective_start == effective_end
        and effective_start_time is not None
        and effective_end_time is not None
        and effective_end_time < effective_start_time
    ):
        raise HTTPException(status_code=400, detail="end_time cannot be earlier than start_time")

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET {", ".join(updates)}
            WHERE id = :exam_id AND tenant_id = :tenant_id
            RETURNING id, name, CAST(term_id AS TEXT) AS term_id, class_code,
                      CAST(subject_id AS TEXT) AS subject_id,
                      CAST(invigilator_staff_id AS TEXT) AS invigilator_staff_id,
                      CAST(start_date AS TEXT) AS start_date,
                      CAST(end_date AS TEXT) AS end_date,
                      CAST(start_time AS TEXT) AS start_time,
                      CAST(end_time AS TEXT) AS end_time,
                      status, location, notes, COALESCE(is_active, true) AS is_active,
                      CAST(created_at AS TEXT) AS created_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        params,
    ).mappings().first()
    db.commit()

    if not updated:
        raise HTTPException(status_code=404, detail="Exam not found")

    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    staff_lookup = _staff_lookup_for_tenant(db, tenant_id=tenant.id)
    return _serialize_exam_row(
        dict(updated),
        term_lookup=term_lookup,
        subject_lookup=subject_lookup,
        staff_lookup=staff_lookup,
    )


@router.get(
    "/exams/marks",
    response_model=list[TenantExamMarkOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_tenant_exam_marks(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    term_id: Optional[UUID] = Query(default=None),
    exam_id: Optional[UUID] = Query(default=None),
    student_enrollment_id: Optional[UUID] = Query(default=None),
    class_code: Optional[str] = Query(default=None),
    subject_id: Optional[UUID] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    rows = _query_tenant_exam_marks(
        db,
        tenant_id=tenant.id,
        term_id=term_id,
        exam_id=exam_id,
        student_enrollment_id=student_enrollment_id,
        class_code=class_code,
        subject_id=subject_id,
        limit=limit,
        offset=offset,
    )
    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    enrollment_index = _tenant_enrollment_index(db, tenant_id=tenant.id, limit=5000)
    return [
        _serialize_exam_mark_row(
            row,
            term_lookup=term_lookup,
            subject_lookup=subject_lookup,
            enrollment_index=enrollment_index,
        )
        for row in rows
    ]


# ---------------------------------------------------------------------
# Tenant Events
# ---------------------------------------------------------------------

@router.get(
    "/events",
    response_model=list[TenantEventOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_tenant_events(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    term_id: Optional[UUID] = Query(default=None),
    academic_year: Optional[int] = Query(default=None, ge=2000, le=2200),
    target_scope: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    start_date = _normalize_iso_date_value(date_from, field="date_from") if date_from else None
    end_date = _normalize_iso_date_value(date_to, field="date_to") if date_to else None
    rows = _query_tenant_events(
        db,
        tenant_id=tenant.id,
        term_id=term_id,
        academic_year=academic_year,
        target_scope=target_scope,
        date_from=start_date,
        date_to=end_date,
        include_inactive=include_inactive,
        limit=limit,
        offset=offset,
    )
    event_ids = [str(row.get("id") or "") for row in rows if row.get("id") is not None]
    event_class_map, event_student_map = _event_target_maps(
        db,
        tenant_id=tenant.id,
        event_ids=event_ids,
    )
    enrollment_ids = sorted({sid for ids in event_student_map.values() for sid in ids})
    enrollment_name_lookup = _enrollment_name_lookup_by_ids(
        db,
        tenant_id=tenant.id,
        enrollment_ids=enrollment_ids,
    )
    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    return [
        _serialize_event_row(
            row,
            term_lookup=term_lookup,
            event_class_map=event_class_map,
            event_student_map=event_student_map,
            enrollment_name_lookup=enrollment_name_lookup,
        )
        for row in rows
    ]


@router.post(
    "/events",
    response_model=TenantEventOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_tenant_event(
    payload: TenantEventCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    name = _normalize_name(payload.name)
    term_raw = _text_or_none(payload.term_id)
    if not term_raw:
        raise HTTPException(status_code=400, detail="term_id is required")
    term_id = _parse_uuid(term_raw, field="term_id")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    start_date = _normalize_iso_date_value(payload.start_date, field="start_date", required=True)
    end_date = _normalize_iso_date_value(payload.end_date, field="end_date") or start_date
    if date.fromisoformat(end_date) < date.fromisoformat(start_date):
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")

    start_time = _normalize_exam_time_value(payload.start_time, field="start_time")
    end_time = _normalize_exam_time_value(payload.end_time, field="end_time")
    if (
        start_date == end_date
        and start_time is not None
        and end_time is not None
        and end_time < start_time
    ):
        raise HTTPException(status_code=400, detail="end_time cannot be earlier than start_time")

    _ensure_tenant_term_exists(db, tenant_id=tenant.id, term_id=term_id)

    class_codes = _normalize_class_codes(payload.class_codes)
    for class_code in class_codes:
        _ensure_tenant_class_exists(db, tenant_id=tenant.id, class_code=class_code)

    student_enrollment_ids = _normalize_student_enrollment_ids(payload.student_enrollment_ids)
    _assert_tenant_enrollments_exist(
        db,
        tenant_id=tenant.id,
        enrollment_ids=student_enrollment_ids,
    )

    target_scope = _derive_event_target_scope(
        class_codes=class_codes,
        student_enrollment_ids=student_enrollment_ids,
    )
    academic_year = _normalize_academic_year(payload.academic_year, start_date=start_date)

    event_table = _resolve_event_table_or_503(db)
    event_class_table = _resolve_event_class_table_or_503(db)
    event_student_table = _resolve_event_student_table_or_503(db)

    created = db.execute(
        sa.text(
            f"""
            INSERT INTO {event_table} (
                id, tenant_id, name, term_id, academic_year,
                start_date, end_date, start_time, end_time,
                location, description, target_scope, is_active
            )
            VALUES (
                :id, :tenant_id, :name, :term_id, :academic_year,
                :start_date, :end_date, :start_time, :end_time,
                :location, :description, :target_scope, :is_active
            )
            RETURNING id, name, CAST(term_id AS TEXT) AS term_id, academic_year,
                      CAST(start_date AS TEXT) AS start_date,
                      CAST(end_date AS TEXT) AS end_date,
                      CAST(start_time AS TEXT) AS start_time,
                      CAST(end_time AS TEXT) AS end_time,
                      location, description, target_scope,
                      COALESCE(is_active, true) AS is_active,
                      CAST(created_at AS TEXT) AS created_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "name": name,
            "term_id": str(term_id),
            "academic_year": academic_year,
            "start_date": start_date,
            "end_date": end_date,
            "start_time": start_time,
            "end_time": end_time,
            "location": _text_or_none(payload.location),
            "description": _text_or_none(payload.description),
            "target_scope": target_scope,
            "is_active": bool(payload.is_active),
        },
    ).mappings().first()

    if not created:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create event")

    event_id = str(created.get("id"))
    if class_codes:
        db.execute(
            sa.text(
                f"""
                INSERT INTO {event_class_table} (id, tenant_id, event_id, class_code)
                VALUES (:id, :tenant_id, :event_id, :class_code)
                """
            ),
            [
                {
                    "id": str(uuid4()),
                    "tenant_id": str(tenant.id),
                    "event_id": event_id,
                    "class_code": class_code,
                }
                for class_code in class_codes
            ],
        )

    if student_enrollment_ids:
        db.execute(
            sa.text(
                f"""
                INSERT INTO {event_student_table} (id, tenant_id, event_id, student_enrollment_id)
                VALUES (:id, :tenant_id, :event_id, :student_enrollment_id)
                """
            ),
            [
                {
                    "id": str(uuid4()),
                    "tenant_id": str(tenant.id),
                    "event_id": event_id,
                    "student_enrollment_id": student_id,
                }
                for student_id in student_enrollment_ids
            ],
        )

    _audit_tenant_event_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=getattr(_user, "id", None),
        action="event.create",
        resource_id=_parse_uuid(event_id, field="event_id"),
        payload={
            "name": name,
            "term_id": str(term_id),
            "academic_year": academic_year,
            "target_scope": target_scope,
            "class_count": len(class_codes),
            "student_count": len(student_enrollment_ids),
            "is_active": bool(payload.is_active),
        },
        request=request,
    )

    db.commit()

    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    event_class_map, event_student_map = _event_target_maps(
        db,
        tenant_id=tenant.id,
        event_ids=[event_id],
    )
    enrollment_name_lookup = _enrollment_name_lookup_by_ids(
        db,
        tenant_id=tenant.id,
        enrollment_ids=event_student_map.get(event_id, []),
    )
    return _serialize_event_row(
        dict(created),
        term_lookup=term_lookup,
        event_class_map=event_class_map,
        event_student_map=event_student_map,
        enrollment_name_lookup=enrollment_name_lookup,
    )


@router.put(
    "/events/{event_id}",
    response_model=TenantEventOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_tenant_event(
    event_id: UUID,
    payload: TenantEventUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    fields_set = _payload_fields_set(payload)
    if not fields_set:
        raise HTTPException(status_code=400, detail="No updates supplied")

    event_table = _resolve_event_table_or_503(db)
    event_class_table = _resolve_event_class_table_or_503(db)
    event_student_table = _resolve_event_student_table_or_503(db)

    current = db.execute(
        sa.text(
            f"""
            SELECT id, name, CAST(term_id AS TEXT) AS term_id, academic_year,
                   CAST(start_date AS TEXT) AS start_date,
                   CAST(end_date AS TEXT) AS end_date,
                   CAST(start_time AS TEXT) AS start_time,
                   CAST(end_time AS TEXT) AS end_time,
                   target_scope
            FROM {event_table}
            WHERE id = :event_id AND tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"event_id": str(event_id), "tenant_id": str(tenant.id)},
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Event not found")

    updates: list[str] = ["updated_at = now()"]
    params: dict[str, Any] = {"event_id": str(event_id), "tenant_id": str(tenant.id)}

    def set_update(column: str, value: Any):
        updates.append(f"{column} = :{column}")
        params[column] = value

    if "name" in fields_set:
        name = _normalize_name(payload.name or "")
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        set_update("name", name)

    if "term_id" in fields_set:
        term_raw = _text_or_none(payload.term_id)
        if not term_raw:
            raise HTTPException(status_code=400, detail="term_id cannot be empty")
        term_uuid = _parse_uuid(term_raw, field="term_id")
        _ensure_tenant_term_exists(db, tenant_id=tenant.id, term_id=term_uuid)
        set_update("term_id", str(term_uuid))

    if "academic_year" in fields_set and payload.academic_year is not None:
        set_update("academic_year", int(payload.academic_year))

    if "start_date" in fields_set:
        start_date = _normalize_iso_date_value(payload.start_date, field="start_date", required=True)
        set_update("start_date", start_date)

    if "end_date" in fields_set:
        end_date = _normalize_iso_date_value(payload.end_date, field="end_date", required=True)
        set_update("end_date", end_date)

    if "start_time" in fields_set:
        set_update("start_time", _normalize_exam_time_value(payload.start_time, field="start_time"))

    if "end_time" in fields_set:
        set_update("end_time", _normalize_exam_time_value(payload.end_time, field="end_time"))

    if "location" in fields_set:
        set_update("location", _text_or_none(payload.location))

    if "description" in fields_set:
        set_update("description", _text_or_none(payload.description))

    if "is_active" in fields_set and payload.is_active is not None:
        set_update("is_active", bool(payload.is_active))

    class_codes_touched = "class_codes" in fields_set
    student_ids_touched = "student_enrollment_ids" in fields_set

    event_class_map, event_student_map = _event_target_maps(
        db,
        tenant_id=tenant.id,
        event_ids=[str(event_id)],
    )

    class_codes = (
        _normalize_class_codes(payload.class_codes)
        if class_codes_touched
        else event_class_map.get(str(event_id), [])
    )
    for class_code in class_codes:
        _ensure_tenant_class_exists(db, tenant_id=tenant.id, class_code=class_code)

    student_enrollment_ids = (
        _normalize_student_enrollment_ids(payload.student_enrollment_ids)
        if student_ids_touched
        else event_student_map.get(str(event_id), [])
    )
    _assert_tenant_enrollments_exist(
        db,
        tenant_id=tenant.id,
        enrollment_ids=student_enrollment_ids,
    )

    if class_codes_touched or student_ids_touched:
        set_update(
            "target_scope",
            _derive_event_target_scope(
                class_codes=class_codes,
                student_enrollment_ids=student_enrollment_ids,
            ),
        )

    effective_start = str(params.get("start_date") or current.get("start_date") or "")
    effective_end = str(params.get("end_date") or current.get("end_date") or "")
    if not effective_start or not effective_end:
        raise HTTPException(status_code=400, detail="start_date and end_date are required")
    if date.fromisoformat(effective_end) < date.fromisoformat(effective_start):
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")

    effective_start_time = _text_or_none(params.get("start_time")) or _text_or_none(current.get("start_time"))
    effective_end_time = _text_or_none(params.get("end_time")) or _text_or_none(current.get("end_time"))
    if (
        effective_start == effective_end
        and effective_start_time is not None
        and effective_end_time is not None
        and effective_end_time < effective_start_time
    ):
        raise HTTPException(status_code=400, detail="end_time cannot be earlier than start_time")

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {event_table}
            SET {", ".join(updates)}
            WHERE id = :event_id AND tenant_id = :tenant_id
            RETURNING id, name, CAST(term_id AS TEXT) AS term_id, academic_year,
                      CAST(start_date AS TEXT) AS start_date,
                      CAST(end_date AS TEXT) AS end_date,
                      CAST(start_time AS TEXT) AS start_time,
                      CAST(end_time AS TEXT) AS end_time,
                      location, description, target_scope,
                      COALESCE(is_active, true) AS is_active,
                      CAST(created_at AS TEXT) AS created_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        params,
    ).mappings().first()
    if not updated:
        db.rollback()
        raise HTTPException(status_code=404, detail="Event not found")

    if class_codes_touched:
        db.execute(
            sa.text(
                f"""
                DELETE FROM {event_class_table}
                WHERE tenant_id = :tenant_id AND event_id = :event_id
                """
            ),
            {"tenant_id": str(tenant.id), "event_id": str(event_id)},
        )
        if class_codes:
            db.execute(
                sa.text(
                    f"""
                    INSERT INTO {event_class_table} (id, tenant_id, event_id, class_code)
                    VALUES (:id, :tenant_id, :event_id, :class_code)
                    """
                ),
                [
                    {
                        "id": str(uuid4()),
                        "tenant_id": str(tenant.id),
                        "event_id": str(event_id),
                        "class_code": class_code,
                    }
                    for class_code in class_codes
                ],
            )

    if student_ids_touched:
        db.execute(
            sa.text(
                f"""
                DELETE FROM {event_student_table}
                WHERE tenant_id = :tenant_id AND event_id = :event_id
                """
            ),
            {"tenant_id": str(tenant.id), "event_id": str(event_id)},
        )
        if student_enrollment_ids:
            db.execute(
                sa.text(
                    f"""
                    INSERT INTO {event_student_table} (id, tenant_id, event_id, student_enrollment_id)
                    VALUES (:id, :tenant_id, :event_id, :student_enrollment_id)
                    """
                ),
                [
                    {
                        "id": str(uuid4()),
                        "tenant_id": str(tenant.id),
                        "event_id": str(event_id),
                        "student_enrollment_id": student_id,
                    }
                    for student_id in student_enrollment_ids
                ],
            )

    _audit_tenant_event_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=getattr(_user, "id", None),
        action="event.update",
        resource_id=event_id,
        payload={
            "fields_updated": sorted(fields_set),
            "name": str(updated.get("name") or ""),
            "term_id": str(updated.get("term_id") or ""),
            "academic_year": int(updated.get("academic_year") or _now_utc().year),
            "target_scope": str(updated.get("target_scope") or "ALL"),
            "class_count": len(class_codes),
            "student_count": len(student_enrollment_ids),
            "is_active": bool(updated.get("is_active", True)),
        },
        request=request,
    )

    db.commit()

    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    event_class_map, event_student_map = _event_target_maps(
        db,
        tenant_id=tenant.id,
        event_ids=[str(event_id)],
    )
    enrollment_name_lookup = _enrollment_name_lookup_by_ids(
        db,
        tenant_id=tenant.id,
        enrollment_ids=event_student_map.get(str(event_id), []),
    )
    return _serialize_event_row(
        dict(updated),
        term_lookup=term_lookup,
        event_class_map=event_class_map,
        event_student_map=event_student_map,
        enrollment_name_lookup=enrollment_name_lookup,
    )


@router.delete(
    "/events/{event_id}",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def delete_tenant_event(
    event_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    event_table = _resolve_event_table_or_503(db)
    deleted = db.execute(
        sa.text(
            f"""
            DELETE FROM {event_table}
            WHERE id = :event_id AND tenant_id = :tenant_id
            RETURNING id, name
            """
        ),
        {"event_id": str(event_id), "tenant_id": str(tenant.id)},
    ).mappings().first()
    if not deleted:
        db.rollback()
        raise HTTPException(status_code=404, detail="Event not found")

    _audit_tenant_event_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=getattr(_user, "id", None),
        action="event.delete",
        resource_id=event_id,
        payload={
            "name": str(deleted.get("name") or ""),
        },
        request=request,
    )

    db.commit()
    return {"ok": True, "event_id": str(event_id)}


def _decimal_or_zero(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _decimal_to_text(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _iso_datetime_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    token = str(value).strip()
    return token or None


def _year_bucket(value: Any) -> str:
    if isinstance(value, datetime):
        return str(value.year)

    token = str(value or "").strip()
    if not token:
        return "UNKNOWN"

    try:
        return str(datetime.fromisoformat(token.replace("Z", "+00:00")).year)
    except ValueError:
        if len(token) >= 4 and token[:4].isdigit():
            return token[:4]
        return "UNKNOWN"


def _enrollment_term_bucket(payload: dict[str, Any]) -> str:
    for key in ("admission_term", "term_code", "term", "academic_term"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return _normalize_code(value)
    return "UNSCOPED"


def _invoice_term_bucket(invoice_meta: Any, *, enrollment_payload: dict[str, Any]) -> str:
    if isinstance(invoice_meta, dict):
        term_raw = invoice_meta.get("term_code")
        if isinstance(term_raw, str) and term_raw.strip():
            return _normalize_code(term_raw)
    return _enrollment_term_bucket(enrollment_payload)


def _percent_text(obtained: Decimal, maximum: Decimal) -> Optional[str]:
    if maximum <= 0:
        return None
    pct = (obtained / maximum) * Decimal("100")
    return _decimal_to_text(pct)


def _finance_bucket_payload(
    scope_key: str,
    *,
    invoice_count: int,
    payment_count: int,
    total_invoiced: Decimal,
    total_paid: Decimal,
    total_balance: Decimal,
    allocated_payments: Decimal,
) -> dict[str, Any]:
    return {
        "scope": scope_key,
        "invoice_count": int(invoice_count),
        "payment_count": int(payment_count),
        "total_invoiced": _decimal_to_text(total_invoiced),
        "total_paid": _decimal_to_text(total_paid),
        "total_balance": _decimal_to_text(total_balance),
        "allocated_payments": _decimal_to_text(allocated_payments),
    }


def _fetch_tenant_enrollment_row(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID,
) -> Optional[dict[str, Any]]:
    result, _ = _execute_on_first_table(
        db,
        table_candidates=ENROLLMENT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, status, payload
            FROM {table}
            WHERE tenant_id = :tenant_id
              AND id = :enrollment_id
            LIMIT 1
        """,
        params={
            "tenant_id": str(tenant_id),
            "enrollment_id": str(enrollment_id),
        },
    )
    row = result.mappings().first()
    return dict(row) if row else None


@router.get(
    "/students/clearance",
    response_model=list[StudentClearanceOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def tenant_students_clearance(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    search: Optional[str] = Query(default=None),
    workflow: str = Query(default="all"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    normalized_workflow = (_text_or_none(workflow) or "all").strip().lower()
    valid_workflows = {
        "all",
        "ready_request",
        "pending_approval",
        "approved_transfer",
        "grade9",
    }
    if normalized_workflow not in valid_workflows:
        raise HTTPException(
            status_code=400,
            detail=f"workflow must be one of: {', '.join(sorted(valid_workflows))}",
        )

    scan_limit = max(200, min(3000, int(limit) + int(offset) + 400))
    enrollment_rows, ok = _list_tenant_enrollments_for_finance(
        db,
        tenant_id=tenant.id,
        limit=scan_limit,
    )
    if not ok:
        return []

    relevant_status = {"ENROLLED", "ENROLLED_PARTIAL", "TRANSFER_REQUESTED", "TRANSFERRED"}
    eligible_rows = [
        row
        for row in enrollment_rows
        if _text_or_none(row.get("status"), upper=True) in relevant_status
    ]
    enrollment_ids = [str(row.get("id") or "") for row in eligible_rows if row.get("id") is not None]
    fee_map = _latest_school_fee_invoice_map(db, tenant_id=tenant.id, enrollment_ids=enrollment_ids)
    asset_map = _student_outstanding_assets_map(db, tenant_id=tenant.id, enrollment_ids=enrollment_ids)

    items: list[StudentClearanceOut] = []
    for row in eligible_rows:
        enrollment_id = str(row.get("id") or "")
        if not enrollment_id:
            continue
        item = _serialize_student_clearance_row(
            row,
            fee_invoice=fee_map.get(enrollment_id),
            outstanding_assets=asset_map.get(enrollment_id, 0),
        )
        items.append(item)

    query = (_text_or_none(search) or "").lower()
    if query:
        items = [
            row
            for row in items
            if (
                query in row.student_name.lower()
                or query in (row.admission_number or "").lower()
                or query in row.class_code.lower()
                or query in row.term_code.lower()
                or query in row.status.lower()
                or query in row.enrollment_id.lower()
                or query in (row.nemis_no or "").lower()
                or query in (row.assessment_no or "").lower()
            )
        ]

    if normalized_workflow == "ready_request":
        items = [row for row in items if row.ready_for_transfer_request]
    elif normalized_workflow == "pending_approval":
        items = [row for row in items if row.transfer_requested and not row.transfer_approved]
    elif normalized_workflow == "approved_transfer":
        items = [row for row in items if row.transfer_approved]
    elif normalized_workflow == "grade9":
        items = [row for row in items if row.grade9_candidate]

    status_priority = {
        "TRANSFER_REQUESTED": 0,
        "ENROLLED": 1,
        "ENROLLED_PARTIAL": 2,
        "TRANSFERRED": 3,
    }
    items.sort(
        key=lambda row: (
            status_priority.get(row.status, 99),
            row.student_name.lower(),
            (row.class_code or "").lower(),
            (row.admission_number or "").lower(),
        )
    )

    start = int(offset)
    end = start + int(limit)
    return items[start:end]


@router.post(
    "/students/clearance/{enrollment_id}/transfer/request",
    response_model=StudentClearanceOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def tenant_student_clearance_request_transfer(
    enrollment_id: UUID,
    payload: StudentTransferRequestIn = StudentTransferRequestIn(),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    from app.api.v1.enrollments import service as enrollment_service

    row = _fetch_tenant_enrollment_row(
        db,
        tenant_id=tenant.id,
        enrollment_id=enrollment_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Student enrollment not found")

    enrollment_key = str(enrollment_id)
    clearance = _serialize_student_clearance_row(
        row,
        fee_invoice=_latest_school_fee_invoice_map(
            db,
            tenant_id=tenant.id,
            enrollment_ids=[enrollment_key],
        ).get(enrollment_key),
        outstanding_assets=_student_outstanding_assets_map(
            db,
            tenant_id=tenant.id,
            enrollment_ids=[enrollment_key],
        ).get(enrollment_key, 0),
    )
    if not clearance.ready_for_transfer_request:
        blockers = clearance.blockers or ["Student is not ready for transfer request."]
        raise HTTPException(status_code=400, detail=" ".join(blockers))

    enrollment = enrollment_service.get_enrollment(
        db,
        tenant_id=tenant.id,
        enrollment_id=enrollment_id,
    )
    if not enrollment:
        raise HTTPException(status_code=404, detail="Student enrollment not found")

    try:
        enrollment = enrollment_service.request_transfer(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            enrollment=enrollment,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    enrollment_payload = dict(getattr(enrollment, "payload", None) or {})
    enrollment_payload["transfer_requested_at"] = _now_utc().isoformat()
    enrollment_payload["transfer_requested_by"] = str(getattr(user, "id", "") or "")
    enrollment_payload["transfer_requested_via"] = "CLEARANCE_MODULE"
    reason = _text_or_none(payload.reason)
    if reason:
        enrollment_payload["transfer_request_reason"] = reason
    enrollment.payload = enrollment_payload

    db.commit()
    db.refresh(enrollment)

    refreshed = _fetch_tenant_enrollment_row(
        db,
        tenant_id=tenant.id,
        enrollment_id=enrollment_id,
    )
    if not refreshed:
        raise HTTPException(status_code=500, detail="Unable to load updated clearance row")

    return _serialize_student_clearance_row(
        refreshed,
        fee_invoice=_latest_school_fee_invoice_map(
            db,
            tenant_id=tenant.id,
            enrollment_ids=[enrollment_key],
        ).get(enrollment_key),
        outstanding_assets=_student_outstanding_assets_map(
            db,
            tenant_id=tenant.id,
            enrollment_ids=[enrollment_key],
        ).get(enrollment_key, 0),
    )


@router.post(
    "/students/clearance/{enrollment_id}/transfer/approve",
    response_model=StudentClearanceOut,
    dependencies=[Depends(require_permission("enrollment.transfer.approve"))],
)
def tenant_student_clearance_approve_transfer(
    enrollment_id: UUID,
    payload: StudentTransferApproveIn = StudentTransferApproveIn(),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    from app.api.v1.enrollments import service as enrollment_service

    row = _fetch_tenant_enrollment_row(
        db,
        tenant_id=tenant.id,
        enrollment_id=enrollment_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Student enrollment not found")

    enrollment_key = str(enrollment_id)
    clearance = _serialize_student_clearance_row(
        row,
        fee_invoice=_latest_school_fee_invoice_map(
            db,
            tenant_id=tenant.id,
            enrollment_ids=[enrollment_key],
        ).get(enrollment_key),
        outstanding_assets=_student_outstanding_assets_map(
            db,
            tenant_id=tenant.id,
            enrollment_ids=[enrollment_key],
        ).get(enrollment_key, 0),
    )
    if not clearance.ready_for_director_approval:
        blockers = clearance.blockers or ["Student is not ready for transfer approval."]
        raise HTTPException(status_code=400, detail=" ".join(blockers))

    enrollment = enrollment_service.get_enrollment(
        db,
        tenant_id=tenant.id,
        enrollment_id=enrollment_id,
    )
    if not enrollment:
        raise HTTPException(status_code=404, detail="Student enrollment not found")

    try:
        enrollment = enrollment_service.approve_transfer(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            enrollment=enrollment,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    enrollment_payload = dict(getattr(enrollment, "payload", None) or {})
    enrollment_payload["transfer_approved_at"] = _now_utc().isoformat()
    enrollment_payload["transfer_approved_by"] = str(getattr(user, "id", "") or "")
    enrollment_payload["transfer_approved_via"] = "DIRECTOR_CLEARANCE_MODULE"
    note = _text_or_none(payload.note)
    if note:
        enrollment_payload["transfer_approval_note"] = note
    enrollment.payload = enrollment_payload

    db.commit()
    db.refresh(enrollment)

    refreshed = _fetch_tenant_enrollment_row(
        db,
        tenant_id=tenant.id,
        enrollment_id=enrollment_id,
    )
    if not refreshed:
        raise HTTPException(status_code=500, detail="Unable to load updated clearance row")

    return _serialize_student_clearance_row(
        refreshed,
        fee_invoice=_latest_school_fee_invoice_map(
            db,
            tenant_id=tenant.id,
            enrollment_ids=[enrollment_key],
        ).get(enrollment_key),
        outstanding_assets=_student_outstanding_assets_map(
            db,
            tenant_id=tenant.id,
            enrollment_ids=[enrollment_key],
        ).get(enrollment_key, 0),
    )


@router.get(
    "/students/{enrollment_id}/profile",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def tenant_student_profile(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    from app.api.v1.enrollments import service as enrollment_service
    from app.api.v1.finance import service as finance_service

    enrollment = enrollment_service.get_enrollment(
        db,
        tenant_id=tenant.id,
        enrollment_id=enrollment_id,
    )
    if not enrollment:
        raise HTTPException(status_code=404, detail="Student enrollment not found")

    payload = _safe_payload_obj(getattr(enrollment, "payload", None))
    admission_number = (
        str(getattr(enrollment, "admission_number", "") or "").strip()
        or (_enrollment_admission_number(payload) or "")
    )

    student_name = _enrollment_student_name(payload)
    enrollment_class = _enrollment_class_code(payload)
    enrollment_term = _enrollment_term_bucket(payload)

    # Resolve SIS student_id from core.students via admission_no.
    # If none exists yet for an enrolled student, auto-create it so the
    # profile tabs and carry-forward work immediately.
    sis_student_id: str | None = None
    enrollment_status = str(getattr(enrollment, "status", "") or "").upper()
    if admission_number:
        sis_row = db.execute(
            sa.text(
                "SELECT id FROM core.students "
                "WHERE tenant_id = :tenant_id AND admission_no = :admission_no LIMIT 1"
            ),
            {"tenant_id": str(tenant.id), "admission_no": admission_number},
        ).mappings().first()
        if sis_row:
            sis_student_id = str(sis_row["id"])
        elif enrollment_status in ("ENROLLED", "ENROLLED_PARTIAL"):
            # Auto-create the SIS record from the enrollment payload.
            try:
                enrollment_service._create_student_for_existing_enrollment(
                    db,
                    tenant_id=tenant.id,
                    enrollment=enrollment,
                    admission_no=admission_number,
                )
                db.commit()
                # Re-read the newly created student id.
                new_row = db.execute(
                    sa.text(
                        "SELECT id FROM core.students "
                        "WHERE tenant_id = :tenant_id AND admission_no = :admission_no LIMIT 1"
                    ),
                    {"tenant_id": str(tenant.id), "admission_no": admission_number},
                ).mappings().first()
                if new_row:
                    sis_student_id = str(new_row["id"])
            except Exception:
                db.rollback()

    invoices: list[dict[str, Any]] = []
    payments: list[dict[str, Any]] = []
    finance_term_agg: dict[str, dict[str, Any]] = {}
    finance_year_agg: dict[str, dict[str, Any]] = {}
    invoice_scope_index: dict[str, dict[str, str]] = {}

    total_invoiced = Decimal("0")
    total_paid = Decimal("0")
    total_balance = Decimal("0")
    total_allocated_payments = Decimal("0")

    def ensure_finance_bucket(container: dict[str, dict[str, Any]], key: str) -> dict[str, Any]:
        bucket = container.get(key)
        if bucket is not None:
            return bucket
        created = {
            "invoice_count": 0,
            "payment_count": 0,
            "total_invoiced": Decimal("0"),
            "total_paid": Decimal("0"),
            "total_balance": Decimal("0"),
            "allocated_payments": Decimal("0"),
        }
        container[key] = created
        return created

    try:
        invoice_rows = finance_service.list_invoices(
            db,
            tenant_id=tenant.id,
            enrollment_id=enrollment_id,
        )
    except Exception:
        db.rollback()
        invoice_rows = []

    for inv in invoice_rows:
        invoice_id = str(getattr(inv, "id"))
        meta = getattr(inv, "meta", None)
        term_key = _invoice_term_bucket(meta, enrollment_payload=payload)
        year_key = _year_bucket(getattr(inv, "created_at", None))

        inv_total = _decimal_or_zero(getattr(inv, "total_amount", 0))
        inv_paid = _decimal_or_zero(getattr(inv, "paid_amount", 0))
        inv_balance = _decimal_or_zero(getattr(inv, "balance_amount", 0))

        total_invoiced += inv_total
        total_paid += inv_paid
        total_balance += inv_balance

        term_bucket = ensure_finance_bucket(finance_term_agg, term_key)
        term_bucket["invoice_count"] += 1
        term_bucket["total_invoiced"] += inv_total
        term_bucket["total_paid"] += inv_paid
        term_bucket["total_balance"] += inv_balance

        year_bucket = ensure_finance_bucket(finance_year_agg, year_key)
        year_bucket["invoice_count"] += 1
        year_bucket["total_invoiced"] += inv_total
        year_bucket["total_paid"] += inv_paid
        year_bucket["total_balance"] += inv_balance

        invoice_scope_index[invoice_id] = {"term": term_key, "year": year_key}

        invoices.append(
            {
                "id": invoice_id,
                "invoice_no": (
                    str(getattr(inv, "invoice_no"))
                    if getattr(inv, "invoice_no", None) is not None
                    else None
                ),
                "invoice_type": str(getattr(inv, "invoice_type", "") or ""),
                "status": str(getattr(inv, "status", "") or ""),
                "currency": str(getattr(inv, "currency", "KES") or "KES"),
                "term_code": term_key,
                "year": year_key,
                "total_amount": _decimal_to_text(inv_total),
                "paid_amount": _decimal_to_text(inv_paid),
                "balance_amount": _decimal_to_text(inv_balance),
                "created_at": _iso_datetime_or_none(getattr(inv, "created_at", None)),
                "updated_at": _iso_datetime_or_none(getattr(inv, "updated_at", None)),
            }
        )

    try:
        payment_rows = finance_service.list_payments(
            db,
            tenant_id=tenant.id,
            enrollment_id=enrollment_id,
        )
    except Exception:
        db.rollback()
        payment_rows = []

    payment_received_map: dict[str, Optional[str]] = {}
    try:
        from app.models.payment import Payment  # type: ignore

        payment_ids = [
            _parse_uuid(row.get("id"), field="payment.id")
            for row in payment_rows
            if isinstance(row, dict) and row.get("id")
        ]
        if payment_ids:
            date_rows = db.execute(
                select(Payment.id, Payment.received_at)
                .where(
                    Payment.tenant_id == tenant.id,
                    Payment.id.in_(payment_ids),
                )
            ).all()
            payment_received_map = {
                str(r[0]): _iso_datetime_or_none(r[1])
                for r in date_rows
            }
    except Exception:
        db.rollback()
        payment_received_map = {}

    for pay in payment_rows:
        if not isinstance(pay, dict):
            continue

        payment_id = str(pay.get("id") or "")
        allocations_raw = pay.get("allocations") if isinstance(pay.get("allocations"), list) else []
        allocations: list[dict[str, Any]] = []
        allocated_amount = Decimal("0")

        touched_terms: set[str] = set()
        touched_years: set[str] = set()

        for alloc in allocations_raw:
            if not isinstance(alloc, dict):
                continue
            invoice_id = str(alloc.get("invoice_id") or "")
            amount = _decimal_or_zero(alloc.get("amount"))
            allocated_amount += amount

            scope = invoice_scope_index.get(invoice_id, {"term": "UNSCOPED", "year": "UNKNOWN"})
            term_key = scope["term"]
            year_key = scope["year"]

            term_bucket = ensure_finance_bucket(finance_term_agg, term_key)
            term_bucket["allocated_payments"] += amount
            if term_key not in touched_terms:
                term_bucket["payment_count"] += 1
                touched_terms.add(term_key)

            year_bucket = ensure_finance_bucket(finance_year_agg, year_key)
            year_bucket["allocated_payments"] += amount
            if year_key not in touched_years:
                year_bucket["payment_count"] += 1
                touched_years.add(year_key)

            allocations.append(
                {
                    "invoice_id": invoice_id,
                    "amount": _decimal_to_text(amount),
                    "term_code": term_key,
                    "year": year_key,
                }
            )

        total_allocated_payments += allocated_amount

        payments.append(
            {
                "id": payment_id,
                "receipt_no": (
                    str(pay.get("receipt_no"))
                    if pay.get("receipt_no") is not None
                    else None
                ),
                "provider": str(pay.get("provider") or ""),
                "reference": (
                    str(pay.get("reference"))
                    if pay.get("reference") is not None
                    else None
                ),
                "currency": "KES",
                "amount": _decimal_to_text(_decimal_or_zero(pay.get("amount"))),
                "allocated_amount": _decimal_to_text(allocated_amount),
                "received_at": payment_received_map.get(payment_id),
                "allocations": allocations,
            }
        )

    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    enrollment_index = {
        str(enrollment.id): {
            "student_name": student_name,
            "admission_number": admission_number,
        }
    }

    exam_records: list[dict[str, Any]] = []
    subject_agg: dict[str, dict[str, Any]] = {}
    term_exam_agg: dict[str, dict[str, Any]] = {}

    try:
        mark_rows = _query_tenant_exam_marks(
            db,
            tenant_id=tenant.id,
            student_enrollment_id=enrollment_id,
            limit=1000,
            offset=0,
        )
    except Exception:
        db.rollback()
        mark_rows = []

    for raw in mark_rows:
        serialized = _serialize_exam_mark_row(
            raw,
            term_lookup=term_lookup,
            subject_lookup=subject_lookup,
            enrollment_index=enrollment_index,
        )
        record = serialized.model_dump()
        obtained = _decimal_or_zero(record.get("marks_obtained"))
        maximum = _decimal_or_zero(record.get("max_marks"))
        record["percentage"] = _percent_text(obtained, maximum)
        exam_records.append(record)

        subject_key = str(record.get("subject_id") or "") or "UNSPECIFIED"
        subject_bucket = subject_agg.get(subject_key)
        if subject_bucket is None:
            subject_bucket = {
                "subject_id": record.get("subject_id"),
                "subject_code": record.get("subject_code"),
                "subject_name": record.get("subject_name"),
                "exam_count": 0,
                "total_obtained": Decimal("0"),
                "total_max": Decimal("0"),
            }
            subject_agg[subject_key] = subject_bucket
        subject_bucket["exam_count"] += 1
        subject_bucket["total_obtained"] += obtained
        subject_bucket["total_max"] += maximum

        term_key = str(record.get("term_code") or "UNSCOPED")
        term_bucket = term_exam_agg.get(term_key)
        if term_bucket is None:
            term_bucket = {
                "term_code": term_key,
                "term_name": record.get("term_name"),
                "exam_count": 0,
                "total_obtained": Decimal("0"),
                "total_max": Decimal("0"),
            }
            term_exam_agg[term_key] = term_bucket
        term_bucket["exam_count"] += 1
        term_bucket["total_obtained"] += obtained
        term_bucket["total_max"] += maximum

    subject_summary = sorted(
        [
            {
                "subject_id": row["subject_id"],
                "subject_code": row["subject_code"],
                "subject_name": row["subject_name"],
                "exam_count": int(row["exam_count"]),
                "total_obtained": _decimal_to_text(row["total_obtained"]),
                "total_max": _decimal_to_text(row["total_max"]),
                "average_percentage": _percent_text(row["total_obtained"], row["total_max"]),
            }
            for row in subject_agg.values()
        ],
        key=lambda item: (str(item.get("subject_code") or ""), str(item.get("subject_name") or "")),
    )

    term_exam_summary = sorted(
        [
            {
                "term_code": row["term_code"],
                "term_name": row["term_name"],
                "exam_count": int(row["exam_count"]),
                "total_obtained": _decimal_to_text(row["total_obtained"]),
                "total_max": _decimal_to_text(row["total_max"]),
                "average_percentage": _percent_text(row["total_obtained"], row["total_max"]),
            }
            for row in term_exam_agg.values()
        ],
        key=lambda item: str(item.get("term_code") or ""),
    )

    finance_term_summary = sorted(
        [
            _finance_bucket_payload(
                term_key,
                invoice_count=int(bucket["invoice_count"]),
                payment_count=int(bucket["payment_count"]),
                total_invoiced=bucket["total_invoiced"],
                total_paid=bucket["total_paid"],
                total_balance=bucket["total_balance"],
                allocated_payments=bucket["allocated_payments"],
            )
            for term_key, bucket in finance_term_agg.items()
        ],
        key=lambda item: str(item.get("scope") or ""),
    )

    finance_year_summary = sorted(
        [
            _finance_bucket_payload(
                year_key,
                invoice_count=int(bucket["invoice_count"]),
                payment_count=int(bucket["payment_count"]),
                total_invoiced=bucket["total_invoiced"],
                total_paid=bucket["total_paid"],
                total_balance=bucket["total_balance"],
                allocated_payments=bucket["allocated_payments"],
            )
            for year_key, bucket in finance_year_agg.items()
        ],
        key=lambda item: str(item.get("scope") or ""),
    )

    return {
        "enrollment": {
            "id": str(enrollment.id),
            "status": str(getattr(enrollment, "status", "") or ""),
            "admission_number": (admission_number or None),
            "student_id": sis_student_id,
            "student_name": student_name,
            "class_code": enrollment_class,
            "term_code": enrollment_term,
            "payload": payload,
            "created_at": _iso_datetime_or_none(getattr(enrollment, "created_at", None)),
            "updated_at": _iso_datetime_or_none(getattr(enrollment, "updated_at", None)),
        },
        "finance": {
            "totals": {
                "total_invoiced": _decimal_to_text(total_invoiced),
                "total_paid": _decimal_to_text(total_paid),
                "total_balance": _decimal_to_text(total_balance),
                "allocated_payments": _decimal_to_text(total_allocated_payments),
                "invoice_count": len(invoices),
                "payment_count": len(payments),
            },
            "term_summary": finance_term_summary,
            "year_summary": finance_year_summary,
            "invoices": invoices,
            "payments": payments,
        },
        "exams": {
            "totals": {
                "record_count": len(exam_records),
                "subject_count": len(subject_summary),
                "term_count": len(term_exam_summary),
            },
            "subject_summary": subject_summary,
            "term_summary": term_exam_summary,
            "records": exam_records,
        },
    }


@router.post(
    "/exams/marks",
    response_model=TenantExamMarkOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def upsert_tenant_exam_mark(
    payload: TenantExamMarkUpsertIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    exam_uuid = _parse_uuid(payload.exam_id, field="exam_id")
    enrollment_uuid = _parse_uuid(payload.student_enrollment_id, field="student_enrollment_id")
    subject_uuid = _parse_uuid(payload.subject_id, field="subject_id")
    marks_obtained = _parse_decimal(payload.marks_obtained, field="marks_obtained")
    max_marks = _parse_decimal(payload.max_marks, field="max_marks")

    if max_marks <= 0:
        raise HTTPException(status_code=400, detail="max_marks must be greater than 0")
    if marks_obtained < 0:
        raise HTTPException(status_code=400, detail="marks_obtained cannot be negative")
    if marks_obtained > max_marks:
        raise HTTPException(status_code=400, detail="marks_obtained cannot exceed max_marks")

    exam_table = _resolve_exam_table_or_503(db)
    mark_table = _resolve_exam_mark_table_or_503(db)
    _ensure_tenant_subject_exists(db, tenant_id=tenant.id, subject_id=subject_uuid)

    exam_row = db.execute(
        sa.text(
            f"""
            SELECT id, name, CAST(term_id AS TEXT) AS term_id, class_code, CAST(subject_id AS TEXT) AS subject_id
            FROM {exam_table}
            WHERE id = :exam_id AND tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"exam_id": str(exam_uuid), "tenant_id": str(tenant.id)},
    ).mappings().first()
    if not exam_row:
        raise HTTPException(status_code=404, detail="Exam not found")

    exam_subject_id = str(exam_row.get("subject_id") or "").strip()
    if exam_subject_id and exam_subject_id != str(subject_uuid):
        raise HTTPException(
            status_code=400,
            detail="This exam is configured for a different subject",
        )

    class_code = _normalize_code(payload.class_code or str(exam_row.get("class_code") or ""))
    if not class_code:
        raise HTTPException(status_code=400, detail="class_code is required")
    _ensure_tenant_class_exists(db, tenant_id=tenant.id, class_code=class_code)

    enrollment_result, _ = _execute_on_first_table(
        db,
        table_candidates=ENROLLMENT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, payload
            FROM {table}
            WHERE id = :enrollment_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"enrollment_id": str(enrollment_uuid), "tenant_id": str(tenant.id)},
    )
    enrollment_row = enrollment_result.mappings().first()
    if not enrollment_row:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    enrollment_payload = _safe_payload_obj(enrollment_row.get("payload"))
    enrolled_class_code = _enrollment_class_code(enrollment_payload)
    if enrolled_class_code and enrolled_class_code != class_code:
        raise HTTPException(
            status_code=400,
            detail="Student is not enrolled in the selected class_code",
        )

    upsert_params = {
        "tenant_id": str(tenant.id),
        "exam_id": str(exam_uuid),
        "student_enrollment_id": str(enrollment_uuid),
        "subject_id": str(subject_uuid),
        "class_code": class_code,
        "marks_obtained": marks_obtained,
        "max_marks": max_marks,
        "grade": _text_or_none(payload.grade, upper=True),
        "remarks": _text_or_none(payload.remarks),
        "recorded_by": str(getattr(user, "id", "") or "") or None,
    }

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {mark_table}
            SET class_code = :class_code,
                marks_obtained = :marks_obtained,
                max_marks = :max_marks,
                grade = :grade,
                remarks = :remarks,
                updated_at = now()
            WHERE tenant_id = :tenant_id
              AND exam_id = :exam_id
              AND student_enrollment_id = :student_enrollment_id
              AND subject_id = :subject_id
            RETURNING id,
                      CAST(exam_id AS TEXT) AS exam_id,
                      class_code,
                      CAST(subject_id AS TEXT) AS subject_id,
                      CAST(student_enrollment_id AS TEXT) AS student_enrollment_id,
                      marks_obtained,
                      max_marks,
                      grade,
                      remarks,
                      CAST(recorded_at AS TEXT) AS recorded_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        upsert_params,
    ).mappings().first()

    row = updated
    if not row:
        row = db.execute(
            sa.text(
                f"""
                INSERT INTO {mark_table} (
                    id, tenant_id, exam_id, student_enrollment_id, subject_id,
                    class_code, marks_obtained, max_marks, grade, remarks, recorded_by
                )
                VALUES (
                    :id, :tenant_id, :exam_id, :student_enrollment_id, :subject_id,
                    :class_code, :marks_obtained, :max_marks, :grade, :remarks, :recorded_by
                )
                RETURNING id,
                          CAST(exam_id AS TEXT) AS exam_id,
                          class_code,
                          CAST(subject_id AS TEXT) AS subject_id,
                          CAST(student_enrollment_id AS TEXT) AS student_enrollment_id,
                          marks_obtained,
                          max_marks,
                          grade,
                          remarks,
                          CAST(recorded_at AS TEXT) AS recorded_at,
                          CAST(updated_at AS TEXT) AS updated_at
                """
            ),
            {
                **upsert_params,
                "id": str(uuid4()),
            },
        ).mappings().first()

    db.commit()
    if not row:
        raise HTTPException(status_code=500, detail="Failed to record exam mark")

    mark_row = dict(row)
    mark_row["exam_name"] = str(exam_row.get("name") or "")
    mark_row["term_id"] = str(exam_row.get("term_id") or "")
    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    enrollment_index = _tenant_enrollment_index(db, tenant_id=tenant.id, limit=5000)
    return _serialize_exam_mark_row(
        mark_row,
        term_lookup=term_lookup,
        subject_lookup=subject_lookup,
        enrollment_index=enrollment_index,
    )


def _serialize_staff_row(
    row: dict[str, Any],
    *,
    include_separation: bool = False,
) -> TenantStaffOut:
    first_name = str(row.get("first_name") or "").strip()
    last_name = str(row.get("last_name") or "").strip()
    return TenantStaffOut(
        id=str(row.get("id") or ""),
        staff_no=str(row.get("staff_no") or ""),
        staff_type=str(row.get("staff_type") or ""),
        role_code=(str(row.get("role_code")) if row.get("role_code") else None),
        primary_subject_id=(
            str(row.get("primary_subject_id")) if row.get("primary_subject_id") else None
        ),
        primary_subject_code=(
            str(row.get("primary_subject_code")) if row.get("primary_subject_code") else None
        ),
        primary_subject_name=(
            str(row.get("primary_subject_name")) if row.get("primary_subject_name") else None
        ),
        employment_type=(str(row.get("employment_type")) if row.get("employment_type") else None),
        first_name=first_name,
        last_name=last_name,
        full_name=_staff_full_name(first_name, last_name),
        email=(str(row.get("email")) if row.get("email") else None),
        phone=(str(row.get("phone")) if row.get("phone") else None),
        id_number=(str(row.get("id_number")) if row.get("id_number") else None),
        tsc_number=(str(row.get("tsc_number")) if row.get("tsc_number") else None),
        kra_pin=(str(row.get("kra_pin")) if row.get("kra_pin") else None),
        nssf_number=(str(row.get("nssf_number")) if row.get("nssf_number") else None),
        nhif_number=(str(row.get("nhif_number")) if row.get("nhif_number") else None),
        gender=(str(row.get("gender")) if row.get("gender") else None),
        date_of_birth=(str(row.get("date_of_birth")) if row.get("date_of_birth") else None),
        date_hired=(str(row.get("date_hired")) if row.get("date_hired") else None),
        next_of_kin_name=(str(row.get("next_of_kin_name")) if row.get("next_of_kin_name") else None),
        next_of_kin_relation=(str(row.get("next_of_kin_relation")) if row.get("next_of_kin_relation") else None),
        next_of_kin_phone=(str(row.get("next_of_kin_phone")) if row.get("next_of_kin_phone") else None),
        next_of_kin_email=(str(row.get("next_of_kin_email")) if row.get("next_of_kin_email") else None),
        address=(str(row.get("address")) if row.get("address") else None),
        notes=(str(row.get("notes")) if row.get("notes") else None),
        separation_status=(
            str(row.get("separation_status"))
            if include_separation and row.get("separation_status")
            else None
        ),
        separation_reason=(
            str(row.get("separation_reason"))
            if include_separation and row.get("separation_reason")
            else None
        ),
        separation_date=(
            str(row.get("separation_date"))
            if include_separation and row.get("separation_date")
            else None
        ),
        is_active=bool(row.get("is_active", True)),
        created_at=(str(row.get("created_at")) if row.get("created_at") else None),
        updated_at=(str(row.get("updated_at")) if row.get("updated_at") else None),
    )


def _generate_staff_no(
    db: Session,
    *,
    table_name: str,
    tenant_id: UUID,
) -> str:
    base = db.execute(
        sa.text(
            f"""
            SELECT COUNT(1)
            FROM {table_name}
            WHERE tenant_id = :tenant_id
            """
        ),
        {"tenant_id": str(tenant_id)},
    ).scalar()
    start = int(base or 0) + 1

    for seq in range(start, start + 5000):
        candidate = f"STF-{seq:04d}"
        exists = db.execute(
            sa.text(
                f"""
                SELECT id
                FROM {table_name}
                WHERE tenant_id = :tenant_id AND UPPER(staff_no) = :staff_no
                LIMIT 1
                """
            ),
            {"tenant_id": str(tenant_id), "staff_no": candidate},
        ).first()
        if not exists:
            return candidate
    raise HTTPException(status_code=500, detail="Unable to generate staff number")


def _payload_fields_set(payload: BaseModel) -> set[str]:
    model_fields_set = getattr(payload, "model_fields_set", None)
    if isinstance(model_fields_set, set):
        return {str(item) for item in model_fields_set}
    legacy = getattr(payload, "__fields_set__", None)
    if isinstance(legacy, set):
        return {str(item) for item in legacy}
    return set()


def _validate_primary_subject_id(
    db: Session,
    *,
    tenant_id: UUID,
    subject_id: Optional[str],
) -> Optional[UUID]:
    cleaned_subject_id = _text_or_none(subject_id)
    if not cleaned_subject_id:
        return None

    parsed_subject_id = _parse_uuid(cleaned_subject_id, field="primary_subject_id")
    result, _ = _execute_on_first_table(
        db,
        table_candidates=TENANT_SUBJECT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id
            FROM {table}
            WHERE id = :subject_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"subject_id": str(parsed_subject_id), "tenant_id": str(tenant_id)},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Primary subject not found")

    return parsed_subject_id


def _load_assignable_teaching_staff_row(
    db: Session,
    *,
    tenant_id: UUID,
    staff_id: UUID,
) -> dict[str, Any]:
    staff_table, staff_cols = _resolve_existing_table(
        db,
        candidates=TENANT_STAFF_TABLE_CANDIDATES,
    )
    if not staff_table:
        raise HTTPException(
            status_code=503,
            detail="Staff registry storage is unavailable",
        )

    sep_status_expr = (
        "separation_status"
        if "separation_status" in staff_cols
        else "CAST(NULL AS TEXT) AS separation_status"
    )
    staff_row = db.execute(
        sa.text(
            f"""
            SELECT id, staff_no, first_name, last_name, staff_type,
                   COALESCE(is_active, true) AS is_active,
                   {sep_status_expr}
            FROM {staff_table}
            WHERE id = :staff_id AND tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"staff_id": str(staff_id), "tenant_id": str(tenant_id)},
    ).mappings().first()
    if not staff_row:
        raise HTTPException(status_code=404, detail="Staff not found")
    if _normalize_staff_type(str(staff_row.get("staff_type") or "TEACHING")) != "TEACHING":
        raise HTTPException(status_code=400, detail="Only teaching staff can be assigned")
    if not bool(staff_row.get("is_active", True)):
        raise HTTPException(status_code=400, detail="Cannot assign an inactive teacher")
    if _normalize_separation_status(_text_or_none(staff_row.get("separation_status"), upper=True)) is not None:
        raise HTTPException(status_code=400, detail="Cannot assign a teacher who has left staff")

    return dict(staff_row)


def _deactivate_teacher_assignments_for_staff(
    db: Session,
    *,
    tenant_id: UUID,
    staff_id: UUID,
) -> int:
    assignment_ref, _ = _resolve_existing_table(
        db,
        candidates=TEACHER_ASSIGNMENT_TABLE_CANDIDATES,
    )
    total_updated = 0

    if assignment_ref:
        updated = db.execute(
            sa.text(
                f"""
                UPDATE {assignment_ref}
                SET is_active = false
                WHERE tenant_id = :tenant_id
                  AND staff_id = :staff_id
                  AND COALESCE(is_active, true) = true
                """
            ),
            {"tenant_id": str(tenant_id), "staff_id": str(staff_id)},
        )
        total_updated += int(updated.rowcount or 0)

    class_assignment_ref, _ = _resolve_existing_table(
        db,
        candidates=CLASS_TEACHER_ASSIGNMENT_TABLE_CANDIDATES,
    )
    if class_assignment_ref:
        class_updated = db.execute(
            sa.text(
                f"""
                UPDATE {class_assignment_ref}
                SET is_active = false
                WHERE tenant_id = :tenant_id
                  AND staff_id = :staff_id
                  AND COALESCE(is_active, true) = true
                """
            ),
            {"tenant_id": str(tenant_id), "staff_id": str(staff_id)},
        )
        total_updated += int(class_updated.rowcount or 0)

    return total_updated


def _deactivate_stale_teacher_assignments_for_subject_class(
    db: Session,
    *,
    tenant_id: UUID,
    assignment_table: str,
    subject_id: UUID,
    class_code: str,
    exclude_assignment_id: UUID | None = None,
) -> int:
    staff_ref, staff_cols = _resolve_existing_table(
        db,
        candidates=TENANT_STAFF_TABLE_CANDIDATES,
    )
    if not staff_ref:
        return 0

    separated_expr = (
        "(s.separation_status IS NOT NULL AND BTRIM(s.separation_status) <> '')"
        if "separation_status" in staff_cols
        else "false"
    )

    where_parts = [
        "a.tenant_id = :tenant_id",
        "a.subject_id = :subject_id",
        "UPPER(a.class_code) = :class_code",
        "COALESCE(a.is_active, true) = true",
        f"""
        (
            NOT EXISTS (
                SELECT 1
                FROM {staff_ref} s
                WHERE s.id = a.staff_id
                  AND s.tenant_id = :tenant_id
            )
            OR EXISTS (
                SELECT 1
                FROM {staff_ref} s
                WHERE s.id = a.staff_id
                  AND s.tenant_id = :tenant_id
                  AND (
                      COALESCE(s.is_active, true) = false
                      OR {separated_expr}
                  )
            )
        )
        """,
    ]
    params: dict[str, Any] = {
        "tenant_id": str(tenant_id),
        "subject_id": str(subject_id),
        "class_code": _normalize_code(class_code),
    }
    if exclude_assignment_id is not None:
        where_parts.append("a.id <> :exclude_assignment_id")
        params["exclude_assignment_id"] = str(exclude_assignment_id)

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {assignment_table} a
            SET is_active = false
            WHERE {" AND ".join(where_parts)}
            """
        ),
        params,
    )
    return int(updated.rowcount or 0)


def _deactivate_stale_class_teacher_assignments_for_class(
    db: Session,
    *,
    tenant_id: UUID,
    assignment_table: str,
    class_code: str,
    exclude_assignment_id: UUID | None = None,
) -> int:
    staff_ref, staff_cols = _resolve_existing_table(
        db,
        candidates=TENANT_STAFF_TABLE_CANDIDATES,
    )
    if not staff_ref:
        return 0

    separated_expr = (
        "(s.separation_status IS NOT NULL AND BTRIM(s.separation_status) <> '')"
        if "separation_status" in staff_cols
        else "false"
    )

    where_parts = [
        "a.tenant_id = :tenant_id",
        "UPPER(a.class_code) = :class_code",
        "COALESCE(a.is_active, true) = true",
        f"""
        (
            NOT EXISTS (
                SELECT 1
                FROM {staff_ref} s
                WHERE s.id = a.staff_id
                  AND s.tenant_id = :tenant_id
            )
            OR EXISTS (
                SELECT 1
                FROM {staff_ref} s
                WHERE s.id = a.staff_id
                  AND s.tenant_id = :tenant_id
                  AND (
                      COALESCE(s.is_active, true) = false
                      OR {separated_expr}
                  )
            )
        )
        """,
    ]
    params: dict[str, Any] = {
        "tenant_id": str(tenant_id),
        "class_code": _normalize_code(class_code),
    }
    if exclude_assignment_id is not None:
        where_parts.append("a.id <> :exclude_assignment_id")
        params["exclude_assignment_id"] = str(exclude_assignment_id)

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {assignment_table} a
            SET is_active = false
            WHERE {" AND ".join(where_parts)}
            """
        ),
        params,
    )
    return int(updated.rowcount or 0)


# ---------------------------------------------------------------------
# Tenant School Setup (Subjects)
# ---------------------------------------------------------------------

@router.get(
    "/subjects",
    response_model=list[TenantSubjectOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_tenant_subjects(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    include_inactive: bool = Query(default=False),
):
    rows, _ = _read_rows_first_table(
        db,
        table_candidates=TENANT_SUBJECT_TABLE_CANDIDATES,
        sql_template=(
            """
            SELECT id, code, name, COALESCE(is_active, true) AS is_active
            FROM {table}
            WHERE tenant_id = :tenant_id
            """
            + ("" if include_inactive else " AND COALESCE(is_active, true) = true ")
            + " ORDER BY code ASC, name ASC"
        ),
        params={"tenant_id": str(tenant.id)},
    )

    return [
        TenantSubjectOut(
            id=str(r.get("id") or ""),
            code=str(r.get("code") or ""),
            name=str(r.get("name") or ""),
            is_active=bool(r.get("is_active", True)),
        )
        for r in rows
    ]


@router.post(
    "/subjects",
    response_model=TenantSubjectOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_tenant_subject(
    payload: TenantSubjectCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    code = _normalize_code(payload.code)
    name = _normalize_name(payload.name)
    if not code or not name:
        raise HTTPException(status_code=400, detail="code and name are required")

    existing_result, table_name = _execute_on_first_table(
        db,
        table_candidates=TENANT_SUBJECT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id
            FROM {table}
            WHERE tenant_id = :tenant_id AND UPPER(code) = :code
            LIMIT 1
        """,
        params={"tenant_id": str(tenant.id), "code": code},
    )
    if existing_result.first():
        raise HTTPException(status_code=409, detail="Subject code already exists for this tenant")

    created = db.execute(
        sa.text(
            f"""
            INSERT INTO {table_name} (id, tenant_id, code, name, is_active)
            VALUES (:id, :tenant_id, :code, :name, :is_active)
            RETURNING id, code, name, COALESCE(is_active, true) AS is_active
            """
        ),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "code": code,
            "name": name,
            "is_active": bool(payload.is_active),
        },
    ).mappings().first()
    db.commit()

    if not created:
        raise HTTPException(status_code=500, detail="Failed to create subject")

    return TenantSubjectOut(
        id=str(created.get("id") or ""),
        code=str(created.get("code") or ""),
        name=str(created.get("name") or ""),
        is_active=bool(created.get("is_active", True)),
    )


@router.put(
    "/subjects/{subject_id}",
    response_model=TenantSubjectOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_tenant_subject(
    subject_id: UUID,
    payload: TenantSubjectUpdateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    updates: list[str] = []
    params: dict[str, Any] = {"subject_id": str(subject_id), "tenant_id": str(tenant.id)}

    if payload.code is not None:
        code = _normalize_code(payload.code)
        if not code:
            raise HTTPException(status_code=400, detail="code cannot be empty")
        updates.append("code = :code")
        params["code"] = code

    if payload.name is not None:
        name = _normalize_name(payload.name)
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        updates.append("name = :name")
        params["name"] = name

    if payload.is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = bool(payload.is_active)

    if not updates:
        raise HTTPException(status_code=400, detail="No updates supplied")

    select_result, table_name = _execute_on_first_table(
        db,
        table_candidates=TENANT_SUBJECT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id
            FROM {table}
            WHERE id = :subject_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"subject_id": str(subject_id), "tenant_id": str(tenant.id)},
    )
    if not select_result.first():
        raise HTTPException(status_code=404, detail="Subject not found")

    if "code" in params:
        dup = db.execute(
            sa.text(
                f"""
                SELECT id
                FROM {table_name}
                WHERE tenant_id = :tenant_id
                  AND UPPER(code) = :code
                  AND id <> :subject_id
                LIMIT 1
                """
            ),
            {
                "tenant_id": str(tenant.id),
                "code": params["code"],
                "subject_id": str(subject_id),
            },
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail="Subject code already exists for this tenant")

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET {", ".join(updates)}
            WHERE id = :subject_id AND tenant_id = :tenant_id
            RETURNING id, code, name, COALESCE(is_active, true) AS is_active
            """
        ),
        params,
    ).mappings().first()
    db.commit()

    if not updated:
        raise HTTPException(status_code=404, detail="Subject not found")

    return TenantSubjectOut(
        id=str(updated.get("id") or ""),
        code=str(updated.get("code") or ""),
        name=str(updated.get("name") or ""),
        is_active=bool(updated.get("is_active", True)),
    )


# ---------------------------------------------------------------------
# Tenant School Setup (Timetable)
# ---------------------------------------------------------------------

@router.get(
    "/school-timetable",
    response_model=list[TenantSchoolTimetableOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_tenant_school_timetable(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    term_id: Optional[UUID] = Query(default=None),
    class_code: Optional[str] = Query(default=None),
    day_of_week: Optional[str] = Query(default=None),
    slot_type: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    limit: int = Query(default=500, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
):
    table_name = _resolve_school_timetable_table_or_503(db)
    where_parts = ["tenant_id = :tenant_id"]
    params: dict[str, Any] = {
        "tenant_id": str(tenant.id),
        "limit": int(limit),
        "offset": int(offset),
    }
    if not include_inactive:
        where_parts.append("COALESCE(is_active, true) = true")
    if term_id is not None:
        where_parts.append("term_id = :term_id")
        params["term_id"] = str(term_id)
    if class_code:
        where_parts.append("UPPER(class_code) = :class_code")
        params["class_code"] = _normalize_code(class_code)
    if day_of_week:
        where_parts.append("UPPER(day_of_week) = :day_of_week")
        params["day_of_week"] = _normalize_timetable_day_value(day_of_week)
    if slot_type:
        where_parts.append("UPPER(slot_type) = :slot_type")
        params["slot_type"] = _normalize_timetable_slot_type_value(slot_type)

    rows = db.execute(
        sa.text(
            f"""
            SELECT id,
                   CAST(term_id AS TEXT) AS term_id,
                   class_code,
                   day_of_week,
                   slot_type,
                   title,
                   CAST(subject_id AS TEXT) AS subject_id,
                   CAST(staff_id AS TEXT) AS staff_id,
                   CAST(start_time AS TEXT) AS start_time,
                   CAST(end_time AS TEXT) AS end_time,
                   location,
                   notes,
                   COALESCE(is_active, true) AS is_active,
                   CAST(created_at AS TEXT) AS created_at,
                   CAST(updated_at AS TEXT) AS updated_at
            FROM {table_name}
            WHERE {" AND ".join(where_parts)}
            ORDER BY {_day_order_case_sql("day_of_week")} ASC,
                     start_time ASC,
                     end_time ASC,
                     UPPER(class_code) ASC,
                     title ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    staff_lookup = _staff_lookup_for_tenant(db, tenant_id=tenant.id)
    return [
        _serialize_school_timetable_row(
            dict(row),
            term_lookup=term_lookup,
            subject_lookup=subject_lookup,
            staff_lookup=staff_lookup,
        )
        for row in rows
    ]


@router.get(
    "/school-timetable/print/pdf",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def download_tenant_school_timetable_pdf(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    term_id: Optional[UUID] = Query(default=None),
    class_code: Optional[str] = Query(default=None),
    day_of_week: Optional[str] = Query(default=None),
    slot_type: Optional[str] = Query(default=None),
    status: str = Query(default="active"),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=10000),
):
    table_name = _resolve_school_timetable_table_or_503(db)

    normalized_status = (_text_or_none(status) or "active").lower()
    if normalized_status not in {"active", "inactive", "all"}:
        raise HTTPException(status_code=400, detail="status must be one of: active, inactive, all")

    where_parts = ["tenant_id = :tenant_id"]
    params: dict[str, Any] = {
        "tenant_id": str(tenant.id),
        "limit": int(limit),
    }
    if normalized_status == "active":
        where_parts.append("COALESCE(is_active, true) = true")
    elif normalized_status == "inactive":
        where_parts.append("COALESCE(is_active, true) = false")

    if term_id is not None:
        where_parts.append("term_id = :term_id")
        params["term_id"] = str(term_id)
    if class_code:
        where_parts.append("UPPER(class_code) = :class_code")
        params["class_code"] = _normalize_code(class_code)
    if day_of_week:
        where_parts.append("UPPER(day_of_week) = :day_of_week")
        params["day_of_week"] = _normalize_timetable_day_value(day_of_week)
    if slot_type:
        where_parts.append("UPPER(slot_type) = :slot_type")
        params["slot_type"] = _normalize_timetable_slot_type_value(slot_type)

    search_token = _text_or_none(search, upper=True)
    if search_token:
        params["search"] = f"%{search_token}%"
        where_parts.append(
            "("
            "UPPER(title) LIKE :search OR "
            "UPPER(class_code) LIKE :search OR "
            "UPPER(day_of_week) LIKE :search OR "
            "UPPER(slot_type) LIKE :search"
            ")"
        )

    rows = db.execute(
        sa.text(
            f"""
            SELECT id,
                   CAST(term_id AS TEXT) AS term_id,
                   class_code,
                   day_of_week,
                   slot_type,
                   title,
                   CAST(subject_id AS TEXT) AS subject_id,
                   CAST(staff_id AS TEXT) AS staff_id,
                   CAST(start_time AS TEXT) AS start_time,
                   CAST(end_time AS TEXT) AS end_time,
                   location,
                   notes,
                   COALESCE(is_active, true) AS is_active,
                   CAST(created_at AS TEXT) AS created_at,
                   CAST(updated_at AS TEXT) AS updated_at
            FROM {table_name}
            WHERE {" AND ".join(where_parts)}
            ORDER BY {_day_order_case_sql("day_of_week")} ASC,
                     start_time ASC,
                     end_time ASC,
                     UPPER(class_code) ASC,
                     title ASC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()

    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    staff_lookup = _staff_lookup_for_tenant(db, tenant_id=tenant.id)
    serialized = [
        _serialize_school_timetable_row(
            dict(row),
            term_lookup=term_lookup,
            subject_lookup=subject_lookup,
            staff_lookup=staff_lookup,
        )
        for row in rows
    ]

    from app.api.v1.finance import service as finance_service

    now = _now_utc()
    document_no = f"TT-{now.strftime('%Y%m%d-%H%M%S')}"
    payload = {
        "document_type": "TIMETABLE",
        "document_no": document_no,
        "tenant_name": str(getattr(tenant, "name", "") or getattr(tenant, "slug", "") or "School"),
        "generated_at": now.isoformat(),
        "filters": {
            "term": (
                str(term_lookup.get(str(term_id), {}).get("code") or "")
                if term_id is not None
                else "ALL"
            ),
            "class_code": (_normalize_code(class_code) if class_code else "ALL"),
            "day_of_week": (_normalize_timetable_day_value(day_of_week) if day_of_week else "ALL"),
            "slot_type": (_normalize_timetable_slot_type_value(slot_type) if slot_type else "ALL"),
            "status": normalized_status.upper(),
            "search": (_text_or_none(search) or ""),
        },
        "entries": [
            {
                "day_of_week": str(item.day_of_week or ""),
                "time_range": f"{str(item.start_time or '')} - {str(item.end_time or '')}",
                "class_code": str(item.class_code or ""),
                "slot_type": str(item.slot_type or ""),
                "title": str(item.title or ""),
                "subject": (
                    f"{item.subject_code} - {item.subject_name}" if item.subject_code and item.subject_name else (item.subject_code or item.subject_name or "")
                ),
                "teacher": str(item.staff_name or ""),
                "term": str(item.term_code or item.term_name or ""),
            }
            for item in serialized
        ],
        "profile": {
            "receipt_footer": "Generated by School Management System",
        },
    }
    pdf = finance_service.render_document_pdf(payload)
    filename = f"{document_no}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/school-timetable",
    response_model=TenantSchoolTimetableOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_tenant_school_timetable(
    payload: TenantSchoolTimetableCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    table_name = _resolve_school_timetable_table_or_503(db)

    term_uuid = _parse_uuid(payload.term_id, field="term_id")
    class_code = _normalize_code(payload.class_code)
    day = _normalize_timetable_day_value(payload.day_of_week)
    slot = _normalize_timetable_slot_type_value(payload.slot_type)

    start_time = _normalize_exam_time_value(payload.start_time, field="start_time")
    end_time = _normalize_exam_time_value(payload.end_time, field="end_time")
    if start_time is None or end_time is None:
        raise HTTPException(status_code=400, detail="start_time and end_time are required")
    _validate_timetable_time_window(start_time=start_time, end_time=end_time)

    _ensure_tenant_term_exists(db, tenant_id=tenant.id, term_id=term_uuid)
    _ensure_tenant_class_exists(db, tenant_id=tenant.id, class_code=class_code)

    subject_uuid: UUID | None = None
    if slot == "LESSON":
        subject_token = _text_or_none(payload.subject_id)
        if not subject_token:
            raise HTTPException(status_code=400, detail="subject_id is required for LESSON slot type")
        subject_uuid = _parse_uuid(subject_token, field="subject_id")
        _ensure_tenant_subject_exists(db, tenant_id=tenant.id, subject_id=subject_uuid)

    staff_uuid: UUID | None = None
    if slot == "LESSON":
        staff_token = _text_or_none(payload.staff_id)
        if staff_token:
            staff_uuid = _parse_uuid(staff_token, field="staff_id")
            _ensure_tenant_invigilator_exists(db, tenant_id=tenant.id, staff_id=staff_uuid)

    title = _normalize_name(payload.title or "")
    if not title:
        title = _default_timetable_title(slot)

    is_active = bool(payload.is_active)
    _assert_timetable_slot_not_overlapping(
        db,
        table_name=table_name,
        tenant_id=tenant.id,
        term_id=term_uuid,
        class_code=class_code,
        day_of_week=day,
        start_time=start_time,
        end_time=end_time,
        is_active=is_active,
    )

    created = db.execute(
        sa.text(
            f"""
            INSERT INTO {table_name} (
                id, tenant_id, term_id, class_code, day_of_week, slot_type, title,
                subject_id, staff_id, start_time, end_time, location, notes, is_active
            )
            VALUES (
                :id, :tenant_id, :term_id, :class_code, :day_of_week, :slot_type, :title,
                :subject_id, :staff_id, :start_time, :end_time, :location, :notes, :is_active
            )
            RETURNING id,
                      CAST(term_id AS TEXT) AS term_id,
                      class_code,
                      day_of_week,
                      slot_type,
                      title,
                      CAST(subject_id AS TEXT) AS subject_id,
                      CAST(staff_id AS TEXT) AS staff_id,
                      CAST(start_time AS TEXT) AS start_time,
                      CAST(end_time AS TEXT) AS end_time,
                      location,
                      notes,
                      COALESCE(is_active, true) AS is_active,
                      CAST(created_at AS TEXT) AS created_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "term_id": str(term_uuid),
            "class_code": class_code,
            "day_of_week": day,
            "slot_type": slot,
            "title": title,
            "subject_id": (str(subject_uuid) if subject_uuid else None),
            "staff_id": (str(staff_uuid) if staff_uuid else None),
            "start_time": start_time,
            "end_time": end_time,
            "location": _text_or_none(payload.location),
            "notes": _text_or_none(payload.notes),
            "is_active": is_active,
        },
    ).mappings().first()

    if not created:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create school timetable entry")

    created_id = _parse_uuid(str(created.get("id")), field="id")
    _audit_tenant_timetable_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=getattr(_user, "id", None),
        action="school_timetable.create",
        resource_id=created_id,
        payload={
            "term_id": str(term_uuid),
            "class_code": class_code,
            "day_of_week": day,
            "slot_type": slot,
            "title": title,
            "start_time": start_time,
            "end_time": end_time,
            "is_active": is_active,
        },
        request=request,
    )

    db.commit()

    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    staff_lookup = _staff_lookup_for_tenant(db, tenant_id=tenant.id)
    return _serialize_school_timetable_row(
        dict(created),
        term_lookup=term_lookup,
        subject_lookup=subject_lookup,
        staff_lookup=staff_lookup,
    )


@router.post(
    "/school-timetable/break-slots/apply",
    response_model=TenantSchoolTimetableBreakApplyOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def apply_tenant_school_timetable_break_slot(
    payload: TenantSchoolTimetableBreakApplyIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    table_name = _resolve_school_timetable_table_or_503(db)

    day = _normalize_timetable_day_value(payload.day_of_week)
    slot = _normalize_timetable_slot_type_value(payload.slot_type)
    if not _is_break_slot_type(slot):
        raise HTTPException(
            status_code=400,
            detail="slot_type must be one of: SHORT_BREAK, LONG_BREAK, LUNCH_BREAK, GAME_TIME",
        )

    start_time = _normalize_exam_time_value(payload.start_time, field="start_time")
    end_time = _normalize_exam_time_value(payload.end_time, field="end_time")
    if start_time is None or end_time is None:
        raise HTTPException(status_code=400, detail="start_time and end_time are required")
    _validate_timetable_time_window(start_time=start_time, end_time=end_time)

    term_ids = _resolve_break_term_ids(
        db,
        tenant_id=tenant.id,
        requested_term_ids=payload.term_ids,
    )
    class_codes = _resolve_break_class_codes(
        db,
        tenant_id=tenant.id,
        requested_class_codes=payload.class_codes,
    )

    title = _normalize_name(payload.title or "")
    if not title:
        title = _default_timetable_title(slot)

    location = _text_or_none(payload.location)
    notes = _text_or_none(payload.notes)
    is_active = bool(payload.is_active)

    for term_uuid in term_ids:
        for class_code in class_codes:
            _assert_break_slot_no_conflict(
                db,
                table_name=table_name,
                tenant_id=tenant.id,
                term_id=term_uuid,
                class_code=class_code,
                day_of_week=day,
                slot_type=slot,
                start_time=start_time,
                end_time=end_time,
                is_active=is_active,
            )

    upserted_entries = 0
    for term_uuid in term_ids:
        for class_code in class_codes:
            db.execute(
                sa.text(
                    f"""
                    DELETE FROM {table_name}
                    WHERE tenant_id = :tenant_id
                      AND term_id = :term_id
                      AND UPPER(class_code) = :class_code
                      AND UPPER(day_of_week) = :day_of_week
                      AND UPPER(slot_type) = :slot_type
                    """
                ),
                {
                    "tenant_id": str(tenant.id),
                    "term_id": str(term_uuid),
                    "class_code": _normalize_code(class_code),
                    "day_of_week": day,
                    "slot_type": slot,
                },
            )
            db.execute(
                sa.text(
                    f"""
                    INSERT INTO {table_name} (
                        id, tenant_id, term_id, class_code, day_of_week, slot_type, title,
                        subject_id, staff_id, start_time, end_time, location, notes, is_active
                    )
                    VALUES (
                        :id, :tenant_id, :term_id, :class_code, :day_of_week, :slot_type, :title,
                        NULL, NULL, :start_time, :end_time, :location, :notes, :is_active
                    )
                    """
                ),
                {
                    "id": str(uuid4()),
                    "tenant_id": str(tenant.id),
                    "term_id": str(term_uuid),
                    "class_code": _normalize_code(class_code),
                    "day_of_week": day,
                    "slot_type": slot,
                    "title": title,
                    "start_time": start_time,
                    "end_time": end_time,
                    "location": location,
                    "notes": notes,
                    "is_active": is_active,
                },
            )
            upserted_entries += 1

    _audit_tenant_timetable_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=getattr(_user, "id", None),
        action="school_timetable.breaks.apply",
        resource_id=None,
        payload={
            "day_of_week": day,
            "slot_type": slot,
            "start_time": start_time,
            "end_time": end_time,
            "is_active": is_active,
            "affected_terms": len(term_ids),
            "affected_classes": len(class_codes),
            "upserted_entries": upserted_entries,
        },
        request=request,
    )
    db.commit()

    return TenantSchoolTimetableBreakApplyOut(
        day_of_week=day,
        slot_type=slot,
        start_time=start_time,
        end_time=end_time,
        affected_terms=len(term_ids),
        affected_classes=len(class_codes),
        upserted_entries=upserted_entries,
    )


@router.put(
    "/school-timetable/{entry_id}",
    response_model=TenantSchoolTimetableOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_tenant_school_timetable(
    entry_id: UUID,
    payload: TenantSchoolTimetableUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    fields_set = _payload_fields_set(payload)
    if not fields_set:
        raise HTTPException(status_code=400, detail="No updates supplied")

    table_name = _resolve_school_timetable_table_or_503(db)
    current = db.execute(
        sa.text(
            f"""
            SELECT id,
                   CAST(term_id AS TEXT) AS term_id,
                   class_code,
                   day_of_week,
                   slot_type,
                   title,
                   CAST(subject_id AS TEXT) AS subject_id,
                   CAST(staff_id AS TEXT) AS staff_id,
                   CAST(start_time AS TEXT) AS start_time,
                   CAST(end_time AS TEXT) AS end_time,
                   location,
                   notes,
                   COALESCE(is_active, true) AS is_active
            FROM {table_name}
            WHERE id = :entry_id AND tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"entry_id": str(entry_id), "tenant_id": str(tenant.id)},
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="School timetable entry not found")

    effective_term_id = _text_or_none(payload.term_id) if "term_id" in fields_set else _text_or_none(current.get("term_id"))
    if not effective_term_id:
        raise HTTPException(status_code=400, detail="term_id is required")
    term_uuid = _parse_uuid(effective_term_id, field="term_id")

    effective_class_code = payload.class_code if "class_code" in fields_set else str(current.get("class_code") or "")
    class_code = _normalize_code(effective_class_code)
    if not class_code:
        raise HTTPException(status_code=400, detail="class_code is required")

    effective_day = payload.day_of_week if "day_of_week" in fields_set else str(current.get("day_of_week") or "")
    day = _normalize_timetable_day_value(effective_day)

    effective_slot = payload.slot_type if "slot_type" in fields_set else str(current.get("slot_type") or "")
    slot = _normalize_timetable_slot_type_value(effective_slot)

    effective_start = payload.start_time if "start_time" in fields_set else str(current.get("start_time") or "")
    effective_end = payload.end_time if "end_time" in fields_set else str(current.get("end_time") or "")
    start_time = _normalize_exam_time_value(effective_start, field="start_time")
    end_time = _normalize_exam_time_value(effective_end, field="end_time")
    if start_time is None or end_time is None:
        raise HTTPException(status_code=400, detail="start_time and end_time are required")
    _validate_timetable_time_window(start_time=start_time, end_time=end_time)

    _ensure_tenant_term_exists(db, tenant_id=tenant.id, term_id=term_uuid)
    _ensure_tenant_class_exists(db, tenant_id=tenant.id, class_code=class_code)

    subject_uuid: UUID | None = None
    staff_uuid: UUID | None = None
    if slot == "LESSON":
        subject_token = (
            _text_or_none(payload.subject_id)
            if "subject_id" in fields_set
            else _text_or_none(current.get("subject_id"))
        )
        if not subject_token:
            raise HTTPException(status_code=400, detail="subject_id is required for LESSON slot type")
        subject_uuid = _parse_uuid(subject_token, field="subject_id")
        _ensure_tenant_subject_exists(db, tenant_id=tenant.id, subject_id=subject_uuid)

        staff_token = (
            _text_or_none(payload.staff_id)
            if "staff_id" in fields_set
            else _text_or_none(current.get("staff_id"))
        )
        if staff_token:
            staff_uuid = _parse_uuid(staff_token, field="staff_id")
            _ensure_tenant_invigilator_exists(db, tenant_id=tenant.id, staff_id=staff_uuid)

    title_source = payload.title if "title" in fields_set else current.get("title")
    title = _normalize_name(str(title_source or ""))
    if not title:
        title = _default_timetable_title(slot)

    location = _text_or_none(payload.location) if "location" in fields_set else _text_or_none(current.get("location"))
    notes = _text_or_none(payload.notes) if "notes" in fields_set else _text_or_none(current.get("notes"))
    is_active = bool(payload.is_active) if payload.is_active is not None else bool(current.get("is_active", True))

    _assert_timetable_slot_not_overlapping(
        db,
        table_name=table_name,
        tenant_id=tenant.id,
        term_id=term_uuid,
        class_code=class_code,
        day_of_week=day,
        start_time=start_time,
        end_time=end_time,
        is_active=is_active,
        exclude_entry_id=entry_id,
    )

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET term_id = :term_id,
                class_code = :class_code,
                day_of_week = :day_of_week,
                slot_type = :slot_type,
                title = :title,
                subject_id = :subject_id,
                staff_id = :staff_id,
                start_time = :start_time,
                end_time = :end_time,
                location = :location,
                notes = :notes,
                is_active = :is_active,
                updated_at = now()
            WHERE id = :entry_id AND tenant_id = :tenant_id
            RETURNING id,
                      CAST(term_id AS TEXT) AS term_id,
                      class_code,
                      day_of_week,
                      slot_type,
                      title,
                      CAST(subject_id AS TEXT) AS subject_id,
                      CAST(staff_id AS TEXT) AS staff_id,
                      CAST(start_time AS TEXT) AS start_time,
                      CAST(end_time AS TEXT) AS end_time,
                      location,
                      notes,
                      COALESCE(is_active, true) AS is_active,
                      CAST(created_at AS TEXT) AS created_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        {
            "entry_id": str(entry_id),
            "tenant_id": str(tenant.id),
            "term_id": str(term_uuid),
            "class_code": class_code,
            "day_of_week": day,
            "slot_type": slot,
            "title": title,
            "subject_id": (str(subject_uuid) if subject_uuid else None),
            "staff_id": (str(staff_uuid) if staff_uuid else None),
            "start_time": start_time,
            "end_time": end_time,
            "location": location,
            "notes": notes,
            "is_active": is_active,
        },
    ).mappings().first()
    if not updated:
        db.rollback()
        raise HTTPException(status_code=404, detail="School timetable entry not found")

    _audit_tenant_timetable_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=getattr(_user, "id", None),
        action="school_timetable.update",
        resource_id=entry_id,
        payload={
            "fields_updated": sorted(fields_set),
            "term_id": str(term_uuid),
            "class_code": class_code,
            "day_of_week": day,
            "slot_type": slot,
            "title": title,
            "start_time": start_time,
            "end_time": end_time,
            "is_active": is_active,
        },
        request=request,
    )

    db.commit()

    term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
    subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
    staff_lookup = _staff_lookup_for_tenant(db, tenant_id=tenant.id)
    return _serialize_school_timetable_row(
        dict(updated),
        term_lookup=term_lookup,
        subject_lookup=subject_lookup,
        staff_lookup=staff_lookup,
    )


@router.delete(
    "/school-timetable/{entry_id}",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def delete_tenant_school_timetable(
    entry_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    table_name = _resolve_school_timetable_table_or_503(db)
    deleted = db.execute(
        sa.text(
            f"""
            DELETE FROM {table_name}
            WHERE id = :entry_id AND tenant_id = :tenant_id
            RETURNING id,
                      CAST(term_id AS TEXT) AS term_id,
                      class_code,
                      day_of_week,
                      slot_type,
                      title,
                      CAST(start_time AS TEXT) AS start_time,
                      CAST(end_time AS TEXT) AS end_time
            """
        ),
        {"entry_id": str(entry_id), "tenant_id": str(tenant.id)},
    ).mappings().first()
    if not deleted:
        db.rollback()
        raise HTTPException(status_code=404, detail="School timetable entry not found")

    _audit_tenant_timetable_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=getattr(_user, "id", None),
        action="school_timetable.delete",
        resource_id=entry_id,
        payload={
            "term_id": str(deleted.get("term_id") or ""),
            "class_code": str(deleted.get("class_code") or ""),
            "day_of_week": str(deleted.get("day_of_week") or ""),
            "slot_type": str(deleted.get("slot_type") or ""),
            "title": str(deleted.get("title") or ""),
            "start_time": str(deleted.get("start_time") or ""),
            "end_time": str(deleted.get("end_time") or ""),
        },
        request=request,
    )

    db.commit()
    return {"ok": True, "entry_id": str(entry_id)}


# ---------------------------------------------------------------------
# Tenant HR (Staff, Teacher Assignments, Assets)
# ---------------------------------------------------------------------

@router.get(
    "/hr/staff",
    response_model=list[TenantStaffOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_tenant_staff(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    staff_type: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    include_separated: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    is_director = _is_director_context(request)
    normalized_staff_type = _normalize_staff_type(staff_type) if staff_type else None
    table_name, cols = _resolve_existing_table(db, candidates=TENANT_STAFF_TABLE_CANDIDATES)
    subject_table, _ = _resolve_existing_table(db, candidates=TENANT_SUBJECT_TABLE_CANDIDATES)
    if not table_name:
        return []

    sep_status_expr = (
        "separation_status"
        if "separation_status" in cols
        else "CAST(NULL AS TEXT) AS separation_status"
    )
    role_code_expr = (
        "role_code"
        if "role_code" in cols
        else "CAST(NULL AS TEXT) AS role_code"
    )
    sep_reason_expr = (
        "separation_reason"
        if "separation_reason" in cols
        else "CAST(NULL AS TEXT) AS separation_reason"
    )
    sep_date_expr = (
        "CAST(separation_date AS TEXT) AS separation_date"
        if "separation_date" in cols
        else "CAST(NULL AS TEXT) AS separation_date"
    )
    primary_subject_id_expr = (
        "CAST(primary_subject_id AS TEXT) AS primary_subject_id"
        if "primary_subject_id" in cols
        else "CAST(NULL AS TEXT) AS primary_subject_id"
    )
    if "primary_subject_id" in cols and subject_table:
        primary_subject_code_expr = (
            f"(SELECT sub.code FROM {subject_table} sub WHERE sub.id = primary_subject_id) "
            "AS primary_subject_code"
        )
        primary_subject_name_expr = (
            f"(SELECT sub.name FROM {subject_table} sub WHERE sub.id = primary_subject_id) "
            "AS primary_subject_name"
        )
    else:
        primary_subject_code_expr = "CAST(NULL AS TEXT) AS primary_subject_code"
        primary_subject_name_expr = "CAST(NULL AS TEXT) AS primary_subject_name"

    where_parts = ["tenant_id = :tenant_id"]
    params: dict[str, Any] = {
        "tenant_id": str(tenant.id),
        "limit": int(limit),
        "offset": int(offset),
    }
    if normalized_staff_type:
        where_parts.append("UPPER(staff_type) = :staff_type")
        params["staff_type"] = normalized_staff_type
    if not include_inactive:
        where_parts.append("COALESCE(is_active, true) = true")
    if "separation_status" in cols and not (include_separated and is_director):
        where_parts.append("(separation_status IS NULL OR BTRIM(separation_status) = '')")

    query = f"""
        SELECT id, staff_no, staff_type, {role_code_expr}, employment_type, first_name, last_name, email, phone,
               id_number, tsc_number, kra_pin, nssf_number, nhif_number, gender,
               CAST(date_of_birth AS TEXT) AS date_of_birth,
               CAST(date_hired AS TEXT) AS date_hired,
               next_of_kin_name, next_of_kin_relation, next_of_kin_phone, next_of_kin_email,
               address, notes, COALESCE(is_active, true) AS is_active,
               {sep_status_expr},
               {sep_reason_expr},
               {sep_date_expr},
               {primary_subject_id_expr},
               {primary_subject_code_expr},
               {primary_subject_name_expr},
               CAST(created_at AS TEXT) AS created_at,
               CAST(updated_at AS TEXT) AS updated_at
        FROM {table_name}
        WHERE {" AND ".join(where_parts)}
        ORDER BY last_name ASC, first_name ASC, staff_no ASC
        LIMIT :limit OFFSET :offset
    """
    rows = db.execute(sa.text(query), params).mappings().all()
    return [
        _serialize_staff_row(dict(r), include_separation=is_director)
        for r in rows
    ]


@router.post(
    "/hr/staff",
    response_model=TenantStaffOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_tenant_staff(
    payload: TenantStaffCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    staff_type = _normalize_staff_type(payload.staff_type)
    first_name = _normalize_name(payload.first_name)
    last_name = _normalize_name(payload.last_name)
    if not first_name or not last_name:
        raise HTTPException(status_code=400, detail="first_name and last_name are required")

    existing_result, table_name = _execute_on_first_table(
        db,
        table_candidates=TENANT_STAFF_TABLE_CANDIDATES,
        sql_template="""
            SELECT id
            FROM {table}
            WHERE tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"tenant_id": str(tenant.id)},
    )
    del existing_result
    _, cols = _resolve_existing_table(db, candidates=(table_name,))

    requested_role_code = _text_or_none(payload.role_code, upper=True)
    role_code: str | None = None
    if requested_role_code is not None:
        _ensure_director_assignable_role(requested_role_code)
        if "role_code" not in cols:
            raise HTTPException(
                status_code=503,
                detail="Staff role storage is not configured. Run database migrations.",
            )
        role = _get_role_by_code(db, tenant_id=tenant.id, role_code=requested_role_code)
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")
        role_code = str(role.code)

    primary_subject_id: UUID | None = None
    requested_primary_subject_id = _text_or_none(payload.primary_subject_id)
    if requested_primary_subject_id is not None:
        if "primary_subject_id" not in cols:
            raise HTTPException(
                status_code=503,
                detail="Staff primary subject storage is not configured. Run database migrations.",
            )
        if not _is_teaching_staff_type(staff_type):
            raise HTTPException(
                status_code=400,
                detail="primary_subject_id can only be set for teaching staff",
            )
        primary_subject_id = _validate_primary_subject_id(
            db,
            tenant_id=tenant.id,
            subject_id=requested_primary_subject_id,
        )

    staff_no = _text_or_none(payload.staff_no, upper=True) or _generate_staff_no(
        db, table_name=table_name, tenant_id=tenant.id
    )

    dup_staff = db.execute(
        sa.text(
            f"""
            SELECT id
            FROM {table_name}
            WHERE tenant_id = :tenant_id AND UPPER(staff_no) = :staff_no
            LIMIT 1
            """
        ),
        {"tenant_id": str(tenant.id), "staff_no": staff_no},
    ).first()
    if dup_staff:
        raise HTTPException(status_code=409, detail="Staff number already exists for this tenant")

    tsc_number = _text_or_none(payload.tsc_number, upper=True)
    if tsc_number:
        dup_tsc = db.execute(
            sa.text(
                f"""
                SELECT id
                FROM {table_name}
                WHERE tenant_id = :tenant_id
                  AND UPPER(tsc_number) = :tsc_number
                LIMIT 1
                """
            ),
            {"tenant_id": str(tenant.id), "tsc_number": tsc_number},
        ).first()
        if dup_tsc:
            raise HTTPException(status_code=409, detail="TSC number already exists for this tenant")

    insert_columns = [
        "id",
        "tenant_id",
        "staff_no",
        "staff_type",
    ]
    insert_values = [
        ":id",
        ":tenant_id",
        ":staff_no",
        ":staff_type",
    ]
    if "role_code" in cols:
        insert_columns.append("role_code")
        insert_values.append(":role_code")
    if "primary_subject_id" in cols:
        insert_columns.append("primary_subject_id")
        insert_values.append(":primary_subject_id")
    insert_columns.extend(
        [
            "employment_type",
            "first_name",
            "last_name",
            "email",
            "phone",
            "id_number",
            "tsc_number",
            "kra_pin",
            "nssf_number",
            "nhif_number",
            "gender",
            "date_of_birth",
            "date_hired",
            "next_of_kin_name",
            "next_of_kin_relation",
            "next_of_kin_phone",
            "next_of_kin_email",
            "address",
            "notes",
            "is_active",
        ]
    )
    insert_values.extend(
        [
            ":employment_type",
            ":first_name",
            ":last_name",
            ":email",
            ":phone",
            ":id_number",
            ":tsc_number",
            ":kra_pin",
            ":nssf_number",
            ":nhif_number",
            ":gender",
            ":date_of_birth",
            ":date_hired",
            ":next_of_kin_name",
            ":next_of_kin_relation",
            ":next_of_kin_phone",
            ":next_of_kin_email",
            ":address",
            ":notes",
            ":is_active",
        ]
    )

    role_code_expr = (
        "role_code"
        if "role_code" in cols
        else "CAST(NULL AS TEXT) AS role_code"
    )
    subject_table, _ = _resolve_existing_table(db, candidates=TENANT_SUBJECT_TABLE_CANDIDATES)
    primary_subject_id_expr = (
        "CAST(primary_subject_id AS TEXT) AS primary_subject_id"
        if "primary_subject_id" in cols
        else "CAST(NULL AS TEXT) AS primary_subject_id"
    )
    if "primary_subject_id" in cols and subject_table:
        primary_subject_code_expr = (
            f"(SELECT sub.code FROM {subject_table} sub WHERE sub.id = primary_subject_id) "
            "AS primary_subject_code"
        )
        primary_subject_name_expr = (
            f"(SELECT sub.name FROM {subject_table} sub WHERE sub.id = primary_subject_id) "
            "AS primary_subject_name"
        )
    else:
        primary_subject_code_expr = "CAST(NULL AS TEXT) AS primary_subject_code"
        primary_subject_name_expr = "CAST(NULL AS TEXT) AS primary_subject_name"
    created = db.execute(
        sa.text(
            f"""
            INSERT INTO {table_name} ({", ".join(insert_columns)})
            VALUES ({", ".join(insert_values)})
            RETURNING id, staff_no, staff_type, {role_code_expr},
                      {primary_subject_id_expr}, {primary_subject_code_expr}, {primary_subject_name_expr},
                      employment_type, first_name, last_name, email, phone,
                      id_number, tsc_number, kra_pin, nssf_number, nhif_number, gender,
                      CAST(date_of_birth AS TEXT) AS date_of_birth,
                      CAST(date_hired AS TEXT) AS date_hired,
                      next_of_kin_name, next_of_kin_relation, next_of_kin_phone, next_of_kin_email,
                      address, notes, COALESCE(is_active, true) AS is_active,
                      CAST(created_at AS TEXT) AS created_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "staff_no": staff_no,
            "staff_type": staff_type,
            "role_code": role_code,
            "primary_subject_id": str(primary_subject_id) if primary_subject_id else None,
            "employment_type": _text_or_none(payload.employment_type, upper=True),
            "first_name": first_name,
            "last_name": last_name,
            "email": _text_or_none(payload.email),
            "phone": _text_or_none(payload.phone),
            "id_number": _text_or_none(payload.id_number, upper=True),
            "tsc_number": tsc_number,
            "kra_pin": _text_or_none(payload.kra_pin, upper=True),
            "nssf_number": _text_or_none(payload.nssf_number, upper=True),
            "nhif_number": _text_or_none(payload.nhif_number, upper=True),
            "gender": _text_or_none(payload.gender, upper=True),
            "date_of_birth": _text_or_none(payload.date_of_birth),
            "date_hired": _text_or_none(payload.date_hired),
            "next_of_kin_name": _text_or_none(payload.next_of_kin_name),
            "next_of_kin_relation": _text_or_none(payload.next_of_kin_relation),
            "next_of_kin_phone": _text_or_none(payload.next_of_kin_phone),
            "next_of_kin_email": _text_or_none(payload.next_of_kin_email),
            "address": _text_or_none(payload.address),
            "notes": _text_or_none(payload.notes),
            "is_active": bool(payload.is_active),
        },
    ).mappings().first()
    db.commit()

    if not created:
        raise HTTPException(status_code=500, detail="Failed to create staff")
    return _serialize_staff_row(dict(created))


@router.put(
    "/hr/staff/{staff_id}",
    response_model=TenantStaffOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_tenant_staff(
    staff_id: UUID,
    payload: TenantStaffUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    select_result, table_name = _execute_on_first_table(
        db,
        table_candidates=TENANT_STAFF_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, staff_type
            FROM {table}
            WHERE id = :staff_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"staff_id": str(staff_id), "tenant_id": str(tenant.id)},
    )
    current_row = select_result.mappings().first()
    if not current_row:
        raise HTTPException(status_code=404, detail="Staff not found")

    _, cols = _resolve_existing_table(db, candidates=(table_name,))
    fields_set = _payload_fields_set(payload)
    is_director = _is_director_context(request)
    role_field_touched = "role_code" in fields_set
    primary_subject_field_touched = "primary_subject_id" in fields_set
    requested_primary_subject_id = (
        _text_or_none(payload.primary_subject_id) if primary_subject_field_touched else None
    )
    separation_fields_touched = bool(
        {"separation_status", "separation_reason", "separation_date"} & fields_set
    )
    if role_field_touched and "role_code" not in cols:
        raise HTTPException(
            status_code=503,
            detail="Staff role storage is not configured. Run database migrations.",
        )
    if (
        primary_subject_field_touched
        and "primary_subject_id" not in cols
        and requested_primary_subject_id is not None
    ):
        raise HTTPException(
            status_code=503,
            detail="Staff primary subject storage is not configured. Run database migrations.",
        )
    if separation_fields_touched and not is_director:
        raise HTTPException(
            status_code=403,
            detail="Only directors can manage fired/left staff records",
        )

    updates: list[str] = ["updated_at = now()"]
    params: dict[str, Any] = {"staff_id": str(staff_id), "tenant_id": str(tenant.id)}
    target_staff_type = str(current_row.get("staff_type") or "")

    def set_update(column: str, value: Any):
        prefix = f"{column} ="
        updates[:] = [entry for entry in updates if not entry.strip().startswith(prefix)]
        updates.append(f"{column} = :{column}")
        params[column] = value

    if payload.staff_no is not None:
        staff_no = _text_or_none(payload.staff_no, upper=True)
        if not staff_no:
            raise HTTPException(status_code=400, detail="staff_no cannot be empty")
        dup = db.execute(
            sa.text(
                f"""
                SELECT id
                FROM {table_name}
                WHERE tenant_id = :tenant_id
                  AND UPPER(staff_no) = :staff_no
                  AND id <> :staff_id
                LIMIT 1
                """
            ),
            {"tenant_id": str(tenant.id), "staff_no": staff_no, "staff_id": str(staff_id)},
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail="Staff number already exists for this tenant")
        set_update("staff_no", staff_no)

    if payload.staff_type is not None:
        target_staff_type = _normalize_staff_type(payload.staff_type)
        set_update("staff_type", target_staff_type)
    if primary_subject_field_touched and "primary_subject_id" in cols:
        if requested_primary_subject_id and not _is_teaching_staff_type(target_staff_type):
            raise HTTPException(
                status_code=400,
                detail="primary_subject_id can only be set for teaching staff",
            )
        validated_primary_subject_id = _validate_primary_subject_id(
            db,
            tenant_id=tenant.id,
            subject_id=requested_primary_subject_id,
        )
        set_update(
            "primary_subject_id",
            str(validated_primary_subject_id) if validated_primary_subject_id else None,
        )
    elif "staff_type" in fields_set and "primary_subject_id" in cols and not _is_teaching_staff_type(
        target_staff_type
    ):
        set_update("primary_subject_id", None)
    if payload.role_code is not None:
        role_code = _text_or_none(payload.role_code, upper=True)
        if role_code is None:
            set_update("role_code", None)
        else:
            _ensure_director_assignable_role(role_code)
            role = _get_role_by_code(db, tenant_id=tenant.id, role_code=role_code)
            if not role:
                raise HTTPException(status_code=404, detail="Role not found")
            set_update("role_code", str(role.code))
    if payload.employment_type is not None:
        set_update("employment_type", _text_or_none(payload.employment_type, upper=True))
    if payload.first_name is not None:
        first_name = _normalize_name(payload.first_name)
        if not first_name:
            raise HTTPException(status_code=400, detail="first_name cannot be empty")
        set_update("first_name", first_name)
    if payload.last_name is not None:
        last_name = _normalize_name(payload.last_name)
        if not last_name:
            raise HTTPException(status_code=400, detail="last_name cannot be empty")
        set_update("last_name", last_name)
    if payload.email is not None:
        set_update("email", _text_or_none(payload.email))
    if payload.phone is not None:
        set_update("phone", _text_or_none(payload.phone))
    if payload.id_number is not None:
        set_update("id_number", _text_or_none(payload.id_number, upper=True))
    if payload.tsc_number is not None:
        tsc_number = _text_or_none(payload.tsc_number, upper=True)
        if tsc_number:
            dup_tsc = db.execute(
                sa.text(
                    f"""
                    SELECT id
                    FROM {table_name}
                    WHERE tenant_id = :tenant_id
                      AND UPPER(tsc_number) = :tsc_number
                      AND id <> :staff_id
                    LIMIT 1
                    """
                ),
                {
                    "tenant_id": str(tenant.id),
                    "tsc_number": tsc_number,
                    "staff_id": str(staff_id),
                },
            ).first()
            if dup_tsc:
                raise HTTPException(status_code=409, detail="TSC number already exists for this tenant")
        set_update("tsc_number", tsc_number)
    if payload.kra_pin is not None:
        set_update("kra_pin", _text_or_none(payload.kra_pin, upper=True))
    if payload.nssf_number is not None:
        set_update("nssf_number", _text_or_none(payload.nssf_number, upper=True))
    if payload.nhif_number is not None:
        set_update("nhif_number", _text_or_none(payload.nhif_number, upper=True))
    if payload.gender is not None:
        set_update("gender", _text_or_none(payload.gender, upper=True))
    if payload.date_of_birth is not None:
        set_update("date_of_birth", _text_or_none(payload.date_of_birth))
    if payload.date_hired is not None:
        set_update("date_hired", _text_or_none(payload.date_hired))
    if payload.next_of_kin_name is not None:
        set_update("next_of_kin_name", _text_or_none(payload.next_of_kin_name))
    if payload.next_of_kin_relation is not None:
        set_update("next_of_kin_relation", _text_or_none(payload.next_of_kin_relation))
    if payload.next_of_kin_phone is not None:
        set_update("next_of_kin_phone", _text_or_none(payload.next_of_kin_phone))
    if payload.next_of_kin_email is not None:
        set_update("next_of_kin_email", _text_or_none(payload.next_of_kin_email))
    if payload.address is not None:
        set_update("address", _text_or_none(payload.address))
    if payload.notes is not None:
        set_update("notes", _text_or_none(payload.notes))
    if payload.is_active is not None:
        set_update("is_active", bool(payload.is_active))

    if separation_fields_touched:
        required_sep_cols = {"separation_status", "separation_reason", "separation_date"}
        if not required_sep_cols.issubset(cols):
            raise HTTPException(
                status_code=503,
                detail="Staff separation storage is not configured. Run database migrations.",
            )

        if "separation_status" in fields_set:
            normalized_status = _normalize_separation_status(payload.separation_status)
            set_update("separation_status", normalized_status)
            if normalized_status is None:
                set_update("separation_reason", None)
                set_update("separation_date", None)
                if payload.is_active is None:
                    set_update("is_active", True)
            else:
                if normalized_status == "FIRED_MISCONDUCT":
                    reason = _text_or_none(payload.separation_reason)
                    if not reason:
                        raise HTTPException(
                            status_code=400,
                            detail="separation_reason is required for FIRED_MISCONDUCT",
                        )
                    set_update("separation_reason", reason)
                elif "separation_reason" in fields_set:
                    set_update("separation_reason", _text_or_none(payload.separation_reason))

                if "separation_date" in fields_set:
                    set_update("separation_date", _text_or_none(payload.separation_date))
                else:
                    set_update("separation_date", datetime.now(timezone.utc).date().isoformat())

                set_update("is_active", False)
        else:
            if "separation_reason" in fields_set:
                set_update("separation_reason", _text_or_none(payload.separation_reason))
            if "separation_date" in fields_set:
                set_update("separation_date", _text_or_none(payload.separation_date))

    if len(updates) == 1:
        raise HTTPException(status_code=400, detail="No updates supplied")

    sep_status_expr = (
        "separation_status"
        if "separation_status" in cols
        else "CAST(NULL AS TEXT) AS separation_status"
    )
    role_code_expr = (
        "role_code"
        if "role_code" in cols
        else "CAST(NULL AS TEXT) AS role_code"
    )
    sep_reason_expr = (
        "separation_reason"
        if "separation_reason" in cols
        else "CAST(NULL AS TEXT) AS separation_reason"
    )
    sep_date_expr = (
        "CAST(separation_date AS TEXT) AS separation_date"
        if "separation_date" in cols
        else "CAST(NULL AS TEXT) AS separation_date"
    )
    subject_table, _ = _resolve_existing_table(db, candidates=TENANT_SUBJECT_TABLE_CANDIDATES)
    primary_subject_id_expr = (
        "CAST(primary_subject_id AS TEXT) AS primary_subject_id"
        if "primary_subject_id" in cols
        else "CAST(NULL AS TEXT) AS primary_subject_id"
    )
    if "primary_subject_id" in cols and subject_table:
        primary_subject_code_expr = (
            f"(SELECT sub.code FROM {subject_table} sub WHERE sub.id = primary_subject_id) "
            "AS primary_subject_code"
        )
        primary_subject_name_expr = (
            f"(SELECT sub.name FROM {subject_table} sub WHERE sub.id = primary_subject_id) "
            "AS primary_subject_name"
        )
    else:
        primary_subject_code_expr = "CAST(NULL AS TEXT) AS primary_subject_code"
        primary_subject_name_expr = "CAST(NULL AS TEXT) AS primary_subject_name"

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET {", ".join(updates)}
            WHERE id = :staff_id AND tenant_id = :tenant_id
            RETURNING id, staff_no, staff_type, {role_code_expr},
                      {primary_subject_id_expr}, {primary_subject_code_expr}, {primary_subject_name_expr},
                      employment_type, first_name, last_name, email, phone,
                      id_number, tsc_number, kra_pin, nssf_number, nhif_number, gender,
                      CAST(date_of_birth AS TEXT) AS date_of_birth,
                      CAST(date_hired AS TEXT) AS date_hired,
                      next_of_kin_name, next_of_kin_relation, next_of_kin_phone, next_of_kin_email,
                      {sep_status_expr},
                      {sep_reason_expr},
                      {sep_date_expr},
                      address, notes, COALESCE(is_active, true) AS is_active,
                      CAST(created_at AS TEXT) AS created_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        params,
    ).mappings().first()

    if not updated:
        raise HTTPException(status_code=404, detail="Staff not found")

    updated_separation_status = _normalize_separation_status(
        _text_or_none(updated.get("separation_status"), upper=True)
    )
    if (
        updated_separation_status is not None
        and _is_teaching_staff_type(
            str(updated.get("staff_type") or current_row.get("staff_type") or "")
        )
    ):
        _deactivate_teacher_assignments_for_staff(
            db,
            tenant_id=tenant.id,
            staff_id=staff_id,
        )

    db.commit()
    return _serialize_staff_row(dict(updated), include_separation=is_director)


@router.get(
    "/hr/assets",
    response_model=list[TenantAssetOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_tenant_assets(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    include_inactive: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    rows, _ = _read_rows_first_table(
        db,
        table_candidates=TENANT_ASSET_TABLE_CANDIDATES,
        sql_template=(
            """
            SELECT id, asset_code, name, category, description, condition_status,
                   COALESCE(is_active, true) AS is_active,
                   CAST(created_at AS TEXT) AS created_at,
                   CAST(updated_at AS TEXT) AS updated_at
            FROM {table}
            WHERE tenant_id = :tenant_id
            """
            + ("" if include_inactive else " AND COALESCE(is_active, true) = true ")
            + " ORDER BY asset_code ASC, name ASC LIMIT :limit OFFSET :offset"
        ),
        params={"tenant_id": str(tenant.id), "limit": int(limit), "offset": int(offset)},
    )
    return [
        TenantAssetOut(
            id=str(r.get("id") or ""),
            asset_code=str(r.get("asset_code") or ""),
            name=str(r.get("name") or ""),
            category=str(r.get("category") or ""),
            description=(str(r.get("description")) if r.get("description") else None),
            condition_status=str(r.get("condition_status") or "AVAILABLE"),
            is_active=bool(r.get("is_active", True)),
            created_at=(str(r.get("created_at")) if r.get("created_at") else None),
            updated_at=(str(r.get("updated_at")) if r.get("updated_at") else None),
        )
        for r in rows
    ]


@router.post(
    "/hr/assets",
    response_model=TenantAssetOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_tenant_asset(
    payload: TenantAssetCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    asset_code = _normalize_code(payload.asset_code)
    name = _normalize_name(payload.name)
    category = _normalize_name(payload.category)
    if not asset_code or not name or not category:
        raise HTTPException(status_code=400, detail="asset_code, name and category are required")

    existing_result, table_name = _execute_on_first_table(
        db,
        table_candidates=TENANT_ASSET_TABLE_CANDIDATES,
        sql_template="""
            SELECT id
            FROM {table}
            WHERE tenant_id = :tenant_id
              AND UPPER(asset_code) = :asset_code
            LIMIT 1
        """,
        params={"tenant_id": str(tenant.id), "asset_code": asset_code},
    )
    if existing_result.first():
        raise HTTPException(status_code=409, detail="Asset code already exists for this tenant")

    created = db.execute(
        sa.text(
            f"""
            INSERT INTO {table_name} (
                id, tenant_id, asset_code, name, category, description, condition_status, is_active
            )
            VALUES (
                :id, :tenant_id, :asset_code, :name, :category, :description, :condition_status, :is_active
            )
            RETURNING id, asset_code, name, category, description, condition_status,
                      COALESCE(is_active, true) AS is_active,
                      CAST(created_at AS TEXT) AS created_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "asset_code": asset_code,
            "name": name,
            "category": category,
            "description": _text_or_none(payload.description),
            "condition_status": _text_or_none(payload.condition_status, upper=True) or "AVAILABLE",
            "is_active": bool(payload.is_active),
        },
    ).mappings().first()
    db.commit()

    if not created:
        raise HTTPException(status_code=500, detail="Failed to create asset")

    return TenantAssetOut(
        id=str(created.get("id") or ""),
        asset_code=str(created.get("asset_code") or ""),
        name=str(created.get("name") or ""),
        category=str(created.get("category") or ""),
        description=(str(created.get("description")) if created.get("description") else None),
        condition_status=str(created.get("condition_status") or "AVAILABLE"),
        is_active=bool(created.get("is_active", True)),
        created_at=(str(created.get("created_at")) if created.get("created_at") else None),
        updated_at=(str(created.get("updated_at")) if created.get("updated_at") else None),
    )


@router.put(
    "/hr/assets/{asset_id}",
    response_model=TenantAssetOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_tenant_asset(
    asset_id: UUID,
    payload: TenantAssetUpdateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    select_result, table_name = _execute_on_first_table(
        db,
        table_candidates=TENANT_ASSET_TABLE_CANDIDATES,
        sql_template="""
            SELECT id
            FROM {table}
            WHERE id = :asset_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"asset_id": str(asset_id), "tenant_id": str(tenant.id)},
    )
    if not select_result.first():
        raise HTTPException(status_code=404, detail="Asset not found")

    updates: list[str] = ["updated_at = now()"]
    params: dict[str, Any] = {"asset_id": str(asset_id), "tenant_id": str(tenant.id)}

    def set_update(column: str, value: Any):
        updates.append(f"{column} = :{column}")
        params[column] = value

    if payload.asset_code is not None:
        asset_code = _normalize_code(payload.asset_code)
        if not asset_code:
            raise HTTPException(status_code=400, detail="asset_code cannot be empty")
        dup = db.execute(
            sa.text(
                f"""
                SELECT id
                FROM {table_name}
                WHERE tenant_id = :tenant_id
                  AND UPPER(asset_code) = :asset_code
                  AND id <> :asset_id
                LIMIT 1
                """
            ),
            {"tenant_id": str(tenant.id), "asset_code": asset_code, "asset_id": str(asset_id)},
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail="Asset code already exists for this tenant")
        set_update("asset_code", asset_code)

    if payload.name is not None:
        name = _normalize_name(payload.name)
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        set_update("name", name)
    if payload.category is not None:
        category = _normalize_name(payload.category)
        if not category:
            raise HTTPException(status_code=400, detail="category cannot be empty")
        set_update("category", category)
    if payload.description is not None:
        set_update("description", _text_or_none(payload.description))
    if payload.condition_status is not None:
        set_update("condition_status", _text_or_none(payload.condition_status, upper=True))
    if payload.is_active is not None:
        set_update("is_active", bool(payload.is_active))

    if len(updates) == 1:
        raise HTTPException(status_code=400, detail="No updates supplied")

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET {", ".join(updates)}
            WHERE id = :asset_id AND tenant_id = :tenant_id
            RETURNING id, asset_code, name, category, description, condition_status,
                      COALESCE(is_active, true) AS is_active,
                      CAST(created_at AS TEXT) AS created_at,
                      CAST(updated_at AS TEXT) AS updated_at
            """
        ),
        params,
    ).mappings().first()
    db.commit()

    if not updated:
        raise HTTPException(status_code=404, detail="Asset not found")

    return TenantAssetOut(
        id=str(updated.get("id") or ""),
        asset_code=str(updated.get("asset_code") or ""),
        name=str(updated.get("name") or ""),
        category=str(updated.get("category") or ""),
        description=(str(updated.get("description")) if updated.get("description") else None),
        condition_status=str(updated.get("condition_status") or "AVAILABLE"),
        is_active=bool(updated.get("is_active", True)),
        created_at=(str(updated.get("created_at")) if updated.get("created_at") else None),
        updated_at=(str(updated.get("updated_at")) if updated.get("updated_at") else None),
    )


@router.get(
    "/hr/teacher-assignments",
    response_model=list[TeacherAssignmentOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_teacher_assignments(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    class_code: Optional[str] = Query(default=None),
    staff_id: Optional[str] = Query(default=None),
    subject_id: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    assignment_ref, _ = _resolve_existing_table(db, candidates=TEACHER_ASSIGNMENT_TABLE_CANDIDATES)
    staff_ref, _ = _resolve_existing_table(db, candidates=TENANT_STAFF_TABLE_CANDIDATES)
    subject_ref, _ = _resolve_existing_table(db, candidates=TENANT_SUBJECT_TABLE_CANDIDATES)
    if not assignment_ref or not staff_ref or not subject_ref:
        return []

    rows = db.execute(
        sa.text(
            f"""
            SELECT a.id, a.staff_id, a.subject_id, a.class_code, COALESCE(a.is_active, true) AS is_active,
                   CAST(a.assigned_at AS TEXT) AS assigned_at, a.notes,
                   s.staff_no, s.first_name, s.last_name,
                   sub.code AS subject_code, sub.name AS subject_name
            FROM {assignment_ref} a
            JOIN {staff_ref} s ON s.id = a.staff_id
            JOIN {subject_ref} sub ON sub.id = a.subject_id
            WHERE a.tenant_id = :tenant_id
              {"AND UPPER(a.class_code) = :class_code" if class_code else ""}
              {"AND a.staff_id = :staff_id" if staff_id else ""}
              {"AND a.subject_id = :subject_id" if subject_id else ""}
              {"" if include_inactive else "AND COALESCE(a.is_active, true) = true"}
            ORDER BY a.class_code ASC, sub.code ASC, s.last_name ASC, s.first_name ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        {
            "tenant_id": str(tenant.id),
            "class_code": _normalize_code(class_code) if class_code else None,
            "staff_id": staff_id,
            "subject_id": subject_id,
            "limit": int(limit),
            "offset": int(offset),
        },
    ).mappings().all()

    return [
        TeacherAssignmentOut(
            id=str(r.get("id") or ""),
            staff_id=str(r.get("staff_id") or ""),
            staff_no=str(r.get("staff_no") or ""),
            staff_name=_staff_full_name(r.get("first_name"), r.get("last_name")),
            subject_id=str(r.get("subject_id") or ""),
            subject_code=str(r.get("subject_code") or ""),
            subject_name=str(r.get("subject_name") or ""),
            class_code=str(r.get("class_code") or ""),
            is_active=bool(r.get("is_active", True)),
            assigned_at=(str(r.get("assigned_at")) if r.get("assigned_at") else None),
            notes=(str(r.get("notes")) if r.get("notes") else None),
        )
        for r in rows
    ]


@router.post(
    "/hr/teacher-assignments",
    response_model=TeacherAssignmentOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_teacher_assignment(
    payload: TeacherAssignmentCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    normalized_class_code = _normalize_code(payload.class_code)
    if not normalized_class_code:
        raise HTTPException(status_code=400, detail="class_code is required")

    staff_uuid = _parse_uuid(payload.staff_id, field="staff_id")
    subject_uuid = _parse_uuid(payload.subject_id, field="subject_id")

    staff_table, staff_cols = _resolve_existing_table(
        db,
        candidates=TENANT_STAFF_TABLE_CANDIDATES,
    )
    if not staff_table:
        raise HTTPException(
            status_code=503,
            detail="Staff registry storage is unavailable",
        )
    sep_status_expr = (
        "separation_status"
        if "separation_status" in staff_cols
        else "CAST(NULL AS TEXT) AS separation_status"
    )
    staff_row = db.execute(
        sa.text(
            f"""
            SELECT id, staff_no, first_name, last_name, staff_type,
                   COALESCE(is_active, true) AS is_active,
                   {sep_status_expr}
            FROM {staff_table}
            WHERE id = :staff_id AND tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        params={"staff_id": str(staff_uuid), "tenant_id": str(tenant.id)},
    ).mappings().first()
    if not staff_row:
        raise HTTPException(status_code=404, detail="Staff not found")
    if _normalize_staff_type(str(staff_row.get("staff_type") or "TEACHING")) != "TEACHING":
        raise HTTPException(status_code=400, detail="Only teaching staff can be assigned to subjects")
    if not bool(staff_row.get("is_active", True)):
        raise HTTPException(status_code=400, detail="Cannot assign an inactive teacher")
    if _normalize_separation_status(_text_or_none(staff_row.get("separation_status"), upper=True)) is not None:
        raise HTTPException(status_code=400, detail="Cannot assign a teacher who has left staff")

    subject_result, subject_table = _execute_on_first_table(
        db,
        table_candidates=TENANT_SUBJECT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, code, name
            FROM {table}
            WHERE id = :subject_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"subject_id": str(subject_uuid), "tenant_id": str(tenant.id)},
    )
    subject_row = subject_result.mappings().first()
    if not subject_row:
        raise HTTPException(status_code=404, detail="Subject not found")

    existing_result, assignment_table = _execute_on_first_table(
        db,
        table_candidates=TEACHER_ASSIGNMENT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, staff_id, COALESCE(is_active, true) AS is_active
            FROM {table}
            WHERE tenant_id = :tenant_id
              AND subject_id = :subject_id
              AND UPPER(class_code) = :class_code
              AND COALESCE(is_active, true) = true
            LIMIT 1
        """,
        params={
            "tenant_id": str(tenant.id),
            "subject_id": str(subject_uuid),
            "class_code": normalized_class_code,
        },
    )
    existing_row = existing_result.mappings().first()
    if existing_row and str(existing_row.get("staff_id") or "") != str(staff_uuid):
        cleaned = _deactivate_stale_teacher_assignments_for_subject_class(
            db,
            tenant_id=tenant.id,
            assignment_table=assignment_table,
            subject_id=subject_uuid,
            class_code=normalized_class_code,
        )
        if cleaned > 0:
            existing_row = db.execute(
                sa.text(
                    f"""
                    SELECT id, staff_id, COALESCE(is_active, true) AS is_active
                    FROM {assignment_table}
                    WHERE tenant_id = :tenant_id
                      AND subject_id = :subject_id
                      AND UPPER(class_code) = :class_code
                      AND COALESCE(is_active, true) = true
                    LIMIT 1
                    """
                ),
                {
                    "tenant_id": str(tenant.id),
                    "subject_id": str(subject_uuid),
                    "class_code": normalized_class_code,
                },
            ).mappings().first()

    if existing_row and str(existing_row.get("staff_id") or "") != str(staff_uuid):
        raise HTTPException(
            status_code=409,
            detail="This subject is already assigned to another teacher for the selected class",
        )
    if existing_row and str(existing_row.get("staff_id") or "") == str(staff_uuid):
        return TeacherAssignmentOut(
            id=str(existing_row.get("id") or ""),
            staff_id=str(staff_uuid),
            staff_no=str(staff_row.get("staff_no") or ""),
            staff_name=_staff_full_name(staff_row.get("first_name"), staff_row.get("last_name")),
            subject_id=str(subject_uuid),
            subject_code=str(subject_row.get("code") or ""),
            subject_name=str(subject_row.get("name") or ""),
            class_code=normalized_class_code,
            is_active=True,
            assigned_at=None,
            notes=_text_or_none(payload.notes),
        )

    created = db.execute(
        sa.text(
            f"""
            INSERT INTO {assignment_table} (
                id, tenant_id, staff_id, subject_id, class_code, notes, is_active, assigned_by
            )
            VALUES (
                :id, :tenant_id, :staff_id, :subject_id, :class_code, :notes, :is_active, :assigned_by
            )
            RETURNING id, CAST(assigned_at AS TEXT) AS assigned_at, COALESCE(is_active, true) AS is_active, notes
            """
        ),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "staff_id": str(staff_uuid),
            "subject_id": str(subject_uuid),
            "class_code": normalized_class_code,
            "notes": _text_or_none(payload.notes),
            "is_active": bool(payload.is_active),
            "assigned_by": str(getattr(_user, "id", "") or "") or None,
        },
    ).mappings().first()
    db.commit()

    if not created:
        raise HTTPException(status_code=500, detail="Failed to create teacher assignment")

    return TeacherAssignmentOut(
        id=str(created.get("id") or ""),
        staff_id=str(staff_uuid),
        staff_no=str(staff_row.get("staff_no") or ""),
        staff_name=_staff_full_name(staff_row.get("first_name"), staff_row.get("last_name")),
        subject_id=str(subject_uuid),
        subject_code=str(subject_row.get("code") or ""),
        subject_name=str(subject_row.get("name") or ""),
        class_code=normalized_class_code,
        is_active=bool(created.get("is_active", True)),
        assigned_at=(str(created.get("assigned_at")) if created.get("assigned_at") else None),
        notes=(str(created.get("notes")) if created.get("notes") else None),
    )


@router.put(
    "/hr/teacher-assignments/{assignment_id}",
    response_model=TeacherAssignmentOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_teacher_assignment(
    assignment_id: UUID,
    payload: TeacherAssignmentUpdateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    select_result, assignment_table = _execute_on_first_table(
        db,
        table_candidates=TEACHER_ASSIGNMENT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, staff_id, subject_id, class_code, COALESCE(is_active, true) AS is_active, notes
            FROM {table}
            WHERE id = :assignment_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"assignment_id": str(assignment_id), "tenant_id": str(tenant.id)},
    )
    current = select_result.mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Teacher assignment not found")

    staff_uuid = _parse_uuid(payload.staff_id, field="staff_id") if payload.staff_id else _parse_uuid(
        current.get("staff_id"), field="staff_id"
    )
    subject_uuid = _parse_uuid(payload.subject_id, field="subject_id") if payload.subject_id else _parse_uuid(
        current.get("subject_id"), field="subject_id"
    )
    class_code = _normalize_code(payload.class_code) if payload.class_code is not None else _normalize_code(
        str(current.get("class_code") or "")
    )
    is_active = bool(payload.is_active) if payload.is_active is not None else bool(current.get("is_active", True))
    notes = _text_or_none(payload.notes) if payload.notes is not None else current.get("notes")

    staff_table, staff_cols = _resolve_existing_table(
        db,
        candidates=TENANT_STAFF_TABLE_CANDIDATES,
    )
    if not staff_table:
        raise HTTPException(
            status_code=503,
            detail="Staff registry storage is unavailable",
        )
    sep_status_expr = (
        "separation_status"
        if "separation_status" in staff_cols
        else "CAST(NULL AS TEXT) AS separation_status"
    )
    staff_row = db.execute(
        sa.text(
            f"""
            SELECT id, staff_no, first_name, last_name, staff_type,
                   COALESCE(is_active, true) AS is_active,
                   {sep_status_expr}
            FROM {staff_table}
            WHERE id = :staff_id AND tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"staff_id": str(staff_uuid), "tenant_id": str(tenant.id)},
    ).mappings().first()
    if not staff_row:
        raise HTTPException(status_code=404, detail="Staff not found")
    if _normalize_staff_type(str(staff_row.get("staff_type") or "TEACHING")) != "TEACHING":
        raise HTTPException(status_code=400, detail="Only teaching staff can be assigned to subjects")
    if not bool(staff_row.get("is_active", True)):
        raise HTTPException(status_code=400, detail="Cannot assign an inactive teacher")
    if _normalize_separation_status(_text_or_none(staff_row.get("separation_status"), upper=True)) is not None:
        raise HTTPException(status_code=400, detail="Cannot assign a teacher who has left staff")

    subject_result, _ = _execute_on_first_table(
        db,
        table_candidates=TENANT_SUBJECT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, code, name
            FROM {table}
            WHERE id = :subject_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"subject_id": str(subject_uuid), "tenant_id": str(tenant.id)},
    )
    subject_row = subject_result.mappings().first()
    if not subject_row:
        raise HTTPException(status_code=404, detail="Subject not found")

    dup = db.execute(
        sa.text(
            f"""
            SELECT id
            FROM {assignment_table}
            WHERE tenant_id = :tenant_id
              AND subject_id = :subject_id
              AND UPPER(class_code) = :class_code
              AND COALESCE(is_active, true) = true
              AND id <> :assignment_id
            LIMIT 1
            """
        ),
        {
            "tenant_id": str(tenant.id),
            "subject_id": str(subject_uuid),
            "class_code": class_code,
            "assignment_id": str(assignment_id),
        },
    ).first()
    if dup and is_active:
        cleaned = _deactivate_stale_teacher_assignments_for_subject_class(
            db,
            tenant_id=tenant.id,
            assignment_table=assignment_table,
            subject_id=subject_uuid,
            class_code=class_code,
            exclude_assignment_id=assignment_id,
        )
        if cleaned > 0:
            dup = db.execute(
                sa.text(
                    f"""
                    SELECT id
                    FROM {assignment_table}
                    WHERE tenant_id = :tenant_id
                      AND subject_id = :subject_id
                      AND UPPER(class_code) = :class_code
                      AND COALESCE(is_active, true) = true
                      AND id <> :assignment_id
                    LIMIT 1
                    """
                ),
                {
                    "tenant_id": str(tenant.id),
                    "subject_id": str(subject_uuid),
                    "class_code": class_code,
                    "assignment_id": str(assignment_id),
                },
            ).first()

    if dup and is_active:
        raise HTTPException(
            status_code=409,
            detail="This subject is already assigned to another teacher for the selected class",
        )

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {assignment_table}
            SET staff_id = :staff_id,
                subject_id = :subject_id,
                class_code = :class_code,
                is_active = :is_active,
                notes = :notes
            WHERE id = :assignment_id AND tenant_id = :tenant_id
            RETURNING id, CAST(assigned_at AS TEXT) AS assigned_at, COALESCE(is_active, true) AS is_active, notes
            """
        ),
        {
            "assignment_id": str(assignment_id),
            "tenant_id": str(tenant.id),
            "staff_id": str(staff_uuid),
            "subject_id": str(subject_uuid),
            "class_code": class_code,
            "is_active": is_active,
            "notes": notes,
        },
    ).mappings().first()
    db.commit()

    if not updated:
        raise HTTPException(status_code=404, detail="Teacher assignment not found")

    return TeacherAssignmentOut(
        id=str(updated.get("id") or ""),
        staff_id=str(staff_uuid),
        staff_no=str(staff_row.get("staff_no") or ""),
        staff_name=_staff_full_name(staff_row.get("first_name"), staff_row.get("last_name")),
        subject_id=str(subject_uuid),
        subject_code=str(subject_row.get("code") or ""),
        subject_name=str(subject_row.get("name") or ""),
        class_code=class_code,
        is_active=bool(updated.get("is_active", True)),
        assigned_at=(str(updated.get("assigned_at")) if updated.get("assigned_at") else None),
        notes=(str(updated.get("notes")) if updated.get("notes") else None),
    )


@router.delete(
    "/hr/teacher-assignments/{assignment_id}",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def delete_teacher_assignment(
    assignment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    assignment_ref, _ = _resolve_existing_table(db, candidates=TEACHER_ASSIGNMENT_TABLE_CANDIDATES)
    if not assignment_ref:
        raise HTTPException(status_code=503, detail="Teacher assignment storage is unavailable")

    deleted = db.execute(
        sa.text(
            f"""
            DELETE FROM {assignment_ref}
            WHERE id = :assignment_id
              AND tenant_id = :tenant_id
            """
        ),
        {"assignment_id": str(assignment_id), "tenant_id": str(tenant.id)},
    )
    if not (deleted.rowcount or 0):
        raise HTTPException(status_code=404, detail="Teacher assignment not found")

    db.commit()
    return {"ok": True, "deleted_id": str(assignment_id)}


@router.get(
    "/hr/class-teacher-assignments",
    response_model=list[ClassTeacherAssignmentOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_class_teacher_assignments(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    class_code: Optional[str] = Query(default=None),
    staff_id: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    assignment_ref, _ = _resolve_existing_table(db, candidates=CLASS_TEACHER_ASSIGNMENT_TABLE_CANDIDATES)
    staff_ref, _ = _resolve_existing_table(db, candidates=TENANT_STAFF_TABLE_CANDIDATES)
    if not assignment_ref or not staff_ref:
        return []

    parsed_staff_id = _parse_uuid(staff_id, field="staff_id") if staff_id else None

    rows = db.execute(
        sa.text(
            f"""
            SELECT a.id, a.staff_id, a.class_code, COALESCE(a.is_active, true) AS is_active,
                   CAST(a.assigned_at AS TEXT) AS assigned_at, a.notes,
                   s.staff_no, s.first_name, s.last_name
            FROM {assignment_ref} a
            JOIN {staff_ref} s ON s.id = a.staff_id
            WHERE a.tenant_id = :tenant_id
              {"AND UPPER(a.class_code) = :class_code" if class_code else ""}
              {"AND a.staff_id = :staff_id" if parsed_staff_id else ""}
              {"" if include_inactive else "AND COALESCE(a.is_active, true) = true"}
            ORDER BY a.class_code ASC, s.last_name ASC, s.first_name ASC, a.assigned_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        {
            "tenant_id": str(tenant.id),
            "class_code": _normalize_code(class_code) if class_code else None,
            "staff_id": str(parsed_staff_id) if parsed_staff_id else None,
            "limit": int(limit),
            "offset": int(offset),
        },
    ).mappings().all()

    return [
        ClassTeacherAssignmentOut(
            id=str(r.get("id") or ""),
            staff_id=str(r.get("staff_id") or ""),
            staff_no=str(r.get("staff_no") or ""),
            staff_name=_staff_full_name(r.get("first_name"), r.get("last_name")),
            class_code=str(r.get("class_code") or ""),
            is_active=bool(r.get("is_active", True)),
            assigned_at=(str(r.get("assigned_at")) if r.get("assigned_at") else None),
            notes=(str(r.get("notes")) if r.get("notes") else None),
        )
        for r in rows
    ]


@router.post(
    "/hr/class-teacher-assignments",
    response_model=ClassTeacherAssignmentOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_class_teacher_assignment(
    payload: ClassTeacherAssignmentCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    normalized_class_code = _normalize_code(payload.class_code)
    if not normalized_class_code:
        raise HTTPException(status_code=400, detail="class_code is required")
    _ensure_tenant_class_exists(db, tenant_id=tenant.id, class_code=normalized_class_code)

    staff_uuid = _parse_uuid(payload.staff_id, field="staff_id")
    staff_row = _load_assignable_teaching_staff_row(
        db,
        tenant_id=tenant.id,
        staff_id=staff_uuid,
    )

    assignment_table = None
    existing_row = None
    if bool(payload.is_active):
        existing_result, assignment_table = _execute_on_first_table(
            db,
            table_candidates=CLASS_TEACHER_ASSIGNMENT_TABLE_CANDIDATES,
            sql_template="""
                SELECT id, staff_id, COALESCE(is_active, true) AS is_active,
                       CAST(assigned_at AS TEXT) AS assigned_at, notes
                FROM {table}
                WHERE tenant_id = :tenant_id
                  AND UPPER(class_code) = :class_code
                  AND COALESCE(is_active, true) = true
                LIMIT 1
            """,
            params={
                "tenant_id": str(tenant.id),
                "class_code": normalized_class_code,
            },
        )
        existing_row = existing_result.mappings().first()
        if existing_row and str(existing_row.get("staff_id") or "") != str(staff_uuid):
            cleaned = _deactivate_stale_class_teacher_assignments_for_class(
                db,
                tenant_id=tenant.id,
                assignment_table=assignment_table,
                class_code=normalized_class_code,
            )
            if cleaned > 0:
                existing_row = db.execute(
                    sa.text(
                        f"""
                        SELECT id, staff_id, COALESCE(is_active, true) AS is_active,
                               CAST(assigned_at AS TEXT) AS assigned_at, notes
                        FROM {assignment_table}
                        WHERE tenant_id = :tenant_id
                          AND UPPER(class_code) = :class_code
                          AND COALESCE(is_active, true) = true
                        LIMIT 1
                        """
                    ),
                    {
                        "tenant_id": str(tenant.id),
                        "class_code": normalized_class_code,
                    },
                ).mappings().first()

        if existing_row and str(existing_row.get("staff_id") or "") != str(staff_uuid):
            raise HTTPException(
                status_code=409,
                detail="This class is already assigned to another active class teacher",
            )
        if existing_row and str(existing_row.get("staff_id") or "") == str(staff_uuid):
            return ClassTeacherAssignmentOut(
                id=str(existing_row.get("id") or ""),
                staff_id=str(staff_uuid),
                staff_no=str(staff_row.get("staff_no") or ""),
                staff_name=_staff_full_name(staff_row.get("first_name"), staff_row.get("last_name")),
                class_code=normalized_class_code,
                is_active=True,
                assigned_at=(str(existing_row.get("assigned_at")) if existing_row.get("assigned_at") else None),
                notes=(str(existing_row.get("notes")) if existing_row.get("notes") else None),
            )
    if not assignment_table:
        _, assignment_table = _execute_on_first_table(
            db,
            table_candidates=CLASS_TEACHER_ASSIGNMENT_TABLE_CANDIDATES,
            sql_template="SELECT 1 FROM {table} WHERE 1=1 LIMIT 1",
            params={},
        )

    created = db.execute(
        sa.text(
            f"""
            INSERT INTO {assignment_table} (
                id, tenant_id, staff_id, class_code, notes, is_active, assigned_by
            )
            VALUES (
                :id, :tenant_id, :staff_id, :class_code, :notes, :is_active, :assigned_by
            )
            RETURNING id, CAST(assigned_at AS TEXT) AS assigned_at, COALESCE(is_active, true) AS is_active, notes
            """
        ),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "staff_id": str(staff_uuid),
            "class_code": normalized_class_code,
            "notes": _text_or_none(payload.notes),
            "is_active": bool(payload.is_active),
            "assigned_by": str(getattr(_user, "id", "") or "") or None,
        },
    ).mappings().first()
    db.commit()

    if not created:
        raise HTTPException(status_code=500, detail="Failed to create class teacher assignment")

    return ClassTeacherAssignmentOut(
        id=str(created.get("id") or ""),
        staff_id=str(staff_uuid),
        staff_no=str(staff_row.get("staff_no") or ""),
        staff_name=_staff_full_name(staff_row.get("first_name"), staff_row.get("last_name")),
        class_code=normalized_class_code,
        is_active=bool(created.get("is_active", True)),
        assigned_at=(str(created.get("assigned_at")) if created.get("assigned_at") else None),
        notes=(str(created.get("notes")) if created.get("notes") else None),
    )


@router.put(
    "/hr/class-teacher-assignments/{assignment_id}",
    response_model=ClassTeacherAssignmentOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def update_class_teacher_assignment(
    assignment_id: UUID,
    payload: ClassTeacherAssignmentUpdateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    select_result, assignment_table = _execute_on_first_table(
        db,
        table_candidates=CLASS_TEACHER_ASSIGNMENT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, staff_id, class_code, COALESCE(is_active, true) AS is_active, notes
            FROM {table}
            WHERE id = :assignment_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"assignment_id": str(assignment_id), "tenant_id": str(tenant.id)},
    )
    current = select_result.mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Class teacher assignment not found")

    staff_uuid = _parse_uuid(payload.staff_id, field="staff_id") if payload.staff_id else _parse_uuid(
        current.get("staff_id"), field="staff_id"
    )
    class_code = _normalize_code(payload.class_code) if payload.class_code is not None else _normalize_code(
        str(current.get("class_code") or "")
    )
    is_active = bool(payload.is_active) if payload.is_active is not None else bool(current.get("is_active", True))
    notes = _text_or_none(payload.notes) if payload.notes is not None else current.get("notes")

    _ensure_tenant_class_exists(db, tenant_id=tenant.id, class_code=class_code)
    staff_row = _load_assignable_teaching_staff_row(
        db,
        tenant_id=tenant.id,
        staff_id=staff_uuid,
    )

    dup = None
    if is_active:
        dup = db.execute(
            sa.text(
                f"""
                SELECT id
                FROM {assignment_table}
                WHERE tenant_id = :tenant_id
                  AND UPPER(class_code) = :class_code
                  AND COALESCE(is_active, true) = true
                  AND id <> :assignment_id
                LIMIT 1
                """
            ),
            {
                "tenant_id": str(tenant.id),
                "class_code": class_code,
                "assignment_id": str(assignment_id),
            },
        ).first()
        if dup:
            cleaned = _deactivate_stale_class_teacher_assignments_for_class(
                db,
                tenant_id=tenant.id,
                assignment_table=assignment_table,
                class_code=class_code,
                exclude_assignment_id=assignment_id,
            )
            if cleaned > 0:
                dup = db.execute(
                    sa.text(
                        f"""
                        SELECT id
                        FROM {assignment_table}
                        WHERE tenant_id = :tenant_id
                          AND UPPER(class_code) = :class_code
                          AND COALESCE(is_active, true) = true
                          AND id <> :assignment_id
                        LIMIT 1
                        """
                    ),
                    {
                        "tenant_id": str(tenant.id),
                        "class_code": class_code,
                        "assignment_id": str(assignment_id),
                    },
                ).first()

    if dup and is_active:
        raise HTTPException(
            status_code=409,
            detail="This class is already assigned to another active class teacher",
        )

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {assignment_table}
            SET staff_id = :staff_id,
                class_code = :class_code,
                is_active = :is_active,
                notes = :notes
            WHERE id = :assignment_id AND tenant_id = :tenant_id
            RETURNING id, CAST(assigned_at AS TEXT) AS assigned_at, COALESCE(is_active, true) AS is_active, notes
            """
        ),
        {
            "assignment_id": str(assignment_id),
            "tenant_id": str(tenant.id),
            "staff_id": str(staff_uuid),
            "class_code": class_code,
            "is_active": is_active,
            "notes": notes,
        },
    ).mappings().first()
    db.commit()

    if not updated:
        raise HTTPException(status_code=404, detail="Class teacher assignment not found")

    return ClassTeacherAssignmentOut(
        id=str(updated.get("id") or ""),
        staff_id=str(staff_uuid),
        staff_no=str(staff_row.get("staff_no") or ""),
        staff_name=_staff_full_name(staff_row.get("first_name"), staff_row.get("last_name")),
        class_code=class_code,
        is_active=bool(updated.get("is_active", True)),
        assigned_at=(str(updated.get("assigned_at")) if updated.get("assigned_at") else None),
        notes=(str(updated.get("notes")) if updated.get("notes") else None),
    )


@router.delete(
    "/hr/class-teacher-assignments/{assignment_id}",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def delete_class_teacher_assignment(
    assignment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    assignment_ref, _ = _resolve_existing_table(db, candidates=CLASS_TEACHER_ASSIGNMENT_TABLE_CANDIDATES)
    if not assignment_ref:
        raise HTTPException(status_code=503, detail="Class teacher assignment storage is unavailable")

    deleted = db.execute(
        sa.text(
            f"""
            DELETE FROM {assignment_ref}
            WHERE id = :assignment_id
              AND tenant_id = :tenant_id
            """
        ),
        {"assignment_id": str(assignment_id), "tenant_id": str(tenant.id)},
    )
    if not (deleted.rowcount or 0):
        raise HTTPException(status_code=404, detail="Class teacher assignment not found")

    db.commit()
    return {"ok": True, "deleted_id": str(assignment_id)}


@router.get(
    "/hr/asset-assignments",
    response_model=list[AssetAssignmentOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def list_asset_assignments(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    staff_id: Optional[str] = Query(default=None),
    asset_id: Optional[str] = Query(default=None),
    class_code: Optional[str] = Query(default=None),
    enrollment_id: Optional[str] = Query(default=None),
    assignee_type: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    assignment_ref, assignment_cols = _resolve_existing_table(
        db,
        candidates=ASSET_ASSIGNMENT_TABLE_CANDIDATES,
    )
    asset_ref, _ = _resolve_existing_table(db, candidates=TENANT_ASSET_TABLE_CANDIDATES)
    staff_ref, _ = _resolve_existing_table(db, candidates=TENANT_STAFF_TABLE_CANDIDATES)
    if not assignment_ref or not asset_ref:
        return []

    status_filter = _text_or_none(status, upper=True)
    assignee_filter = _text_or_none(assignee_type, upper=True)
    if assignee_filter and assignee_filter not in {"STAFF", "CLASS", "STUDENT"}:
        raise HTTPException(status_code=400, detail="Invalid assignee_type")

    assignee_type_expr = (
        "COALESCE(a.assignee_type, 'STAFF') AS assignee_type"
        if "assignee_type" in assignment_cols
        else "'STAFF' AS assignee_type"
    )
    staff_id_expr = (
        "CAST(a.staff_id AS TEXT) AS staff_id"
        if "staff_id" in assignment_cols
        else "CAST(NULL AS TEXT) AS staff_id"
    )
    class_code_expr = (
        "a.class_code AS class_code"
        if "class_code" in assignment_cols
        else "CAST(NULL AS TEXT) AS class_code"
    )
    enrollment_id_expr = (
        "CAST(a.enrollment_id AS TEXT) AS enrollment_id"
        if "enrollment_id" in assignment_cols
        else "CAST(NULL AS TEXT) AS enrollment_id"
    )
    due_at_expr = (
        "CAST(a.due_at AS TEXT) AS due_at"
        if "due_at" in assignment_cols
        else "CAST(NULL AS TEXT) AS due_at"
    )

    where_parts = ["a.tenant_id = :tenant_id"]
    params: dict[str, Any] = {
        "tenant_id": str(tenant.id),
        "limit": int(limit),
        "offset": int(offset),
    }
    if staff_id and "staff_id" in assignment_cols:
        where_parts.append("a.staff_id = :staff_id")
        params["staff_id"] = staff_id
    if asset_id:
        where_parts.append("a.asset_id = :asset_id")
        params["asset_id"] = asset_id
    if class_code and "class_code" in assignment_cols:
        where_parts.append("UPPER(a.class_code) = :class_code")
        params["class_code"] = _normalize_code(class_code)
    if enrollment_id and "enrollment_id" in assignment_cols:
        where_parts.append("a.enrollment_id = :enrollment_id")
        params["enrollment_id"] = enrollment_id
    if assignee_filter:
        where_parts.append("UPPER(COALESCE(a.assignee_type, 'STAFF')) = :assignee_type")
        params["assignee_type"] = assignee_filter
    if status_filter:
        where_parts.append("UPPER(a.status) = :status")
        params["status"] = status_filter

    rows = db.execute(
        sa.text(
            f"""
            SELECT a.id, a.asset_id, {assignee_type_expr}, {staff_id_expr},
                   {class_code_expr}, {enrollment_id_expr}, a.status, a.notes,
                   CAST(a.assigned_at AS TEXT) AS assigned_at,
                   CAST(a.returned_at AS TEXT) AS returned_at,
                   {due_at_expr},
                   ass.asset_code, ass.name AS asset_name,
                   s.staff_no, s.first_name, s.last_name
            FROM {assignment_ref} a
            JOIN {asset_ref} ass ON ass.id = a.asset_id
            {f"LEFT JOIN {staff_ref} s ON s.id = a.staff_id" if staff_ref and "staff_id" in assignment_cols else "LEFT JOIN (SELECT NULL::text AS staff_no, NULL::text AS first_name, NULL::text AS last_name) s ON true"}
            WHERE {" AND ".join(where_parts)}
            ORDER BY a.assigned_at DESC, a.id DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    enrollment_ids = {
        str(r.get("enrollment_id"))
        for r in rows
        if r.get("enrollment_id") is not None
    }
    enrollment_index = _tenant_enrollment_index(db, tenant_id=tenant.id) if enrollment_ids else {}

    now_utc = datetime.now(timezone.utc)
    response: list[AssetAssignmentOut] = []
    for r in rows:
        assignee = _text_or_none(r.get("assignee_type"), upper=True) or "STAFF"
        enrollment_key = str(r.get("enrollment_id") or "")
        enrollment_row = enrollment_index.get(enrollment_key, {})
        staff_id_value = str(r.get("staff_id") or "") or None
        staff_no_value = str(r.get("staff_no") or "") or None
        staff_name_value = (
            _staff_full_name(r.get("first_name"), r.get("last_name"))
            if r.get("first_name") or r.get("last_name")
            else None
        )
        due_at_value = str(r.get("due_at")) if r.get("due_at") else None
        due_dt: datetime | None = None
        if due_at_value:
            try:
                due_dt = datetime.fromisoformat(due_at_value.replace("Z", "+00:00"))
            except Exception:
                due_dt = None
            if due_dt is not None and due_dt.tzinfo is None:
                due_dt = due_dt.replace(tzinfo=timezone.utc)
        status_value = str(r.get("status") or "ASSIGNED").upper()
        is_overdue = bool(
            due_dt is not None
            and status_value == "ASSIGNED"
            and not r.get("returned_at")
            and due_dt < now_utc
        )

        response.append(
            AssetAssignmentOut(
                id=str(r.get("id") or ""),
                asset_id=str(r.get("asset_id") or ""),
                asset_code=str(r.get("asset_code") or ""),
                asset_name=str(r.get("asset_name") or ""),
                assignee_type=assignee,
                staff_id=staff_id_value if assignee == "STAFF" else None,
                staff_no=staff_no_value if assignee == "STAFF" else None,
                staff_name=staff_name_value if assignee == "STAFF" else None,
                class_code=(str(r.get("class_code")) if assignee == "CLASS" and r.get("class_code") else None),
                enrollment_id=(enrollment_key if assignee == "STUDENT" and enrollment_key else None),
                student_name=(
                    enrollment_row.get("student_name")
                    if assignee == "STUDENT"
                    else None
                ),
                status=status_value,
                due_at=due_at_value,
                is_overdue=is_overdue,
                assigned_at=(str(r.get("assigned_at")) if r.get("assigned_at") else None),
                returned_at=(str(r.get("returned_at")) if r.get("returned_at") else None),
                notes=(str(r.get("notes")) if r.get("notes") else None),
            )
        )

    return response


@router.post(
    "/hr/asset-assignments",
    response_model=AssetAssignmentOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def create_asset_assignment(
    payload: AssetAssignmentCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    asset_uuid = _parse_uuid(payload.asset_id, field="asset_id")
    assignee_type = _text_or_none(payload.assignee_type, upper=True) or "STAFF"
    if assignee_type not in {"STAFF", "CLASS", "STUDENT"}:
        raise HTTPException(status_code=400, detail="Invalid assignee_type")

    asset_result, asset_table = _execute_on_first_table(
        db,
        table_candidates=TENANT_ASSET_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, asset_code, name
            FROM {table}
            WHERE id = :asset_id AND tenant_id = :tenant_id
            LIMIT 1
        """,
        params={"asset_id": str(asset_uuid), "tenant_id": str(tenant.id)},
    )
    asset_row = asset_result.mappings().first()
    if not asset_row:
        raise HTTPException(status_code=404, detail="Asset not found")

    assignment_table, assignment_cols = _resolve_existing_table(
        db,
        candidates=ASSET_ASSIGNMENT_TABLE_CANDIDATES,
    )
    if not assignment_table:
        raise HTTPException(status_code=503, detail="Asset assignment storage is unavailable")
    if assignee_type != "STAFF":
        if "assignee_type" not in assignment_cols:
            raise HTTPException(
                status_code=503,
                detail="Asset assignment scope is not configured. Run database migrations.",
            )
        if assignee_type == "CLASS" and "class_code" not in assignment_cols:
            raise HTTPException(
                status_code=503,
                detail="Asset class assignment storage is not configured. Run database migrations.",
            )
        if assignee_type == "STUDENT" and "enrollment_id" not in assignment_cols:
            raise HTTPException(
                status_code=503,
                detail="Asset student assignment storage is not configured. Run database migrations.",
            )

    if payload.due_at is not None and "due_at" not in assignment_cols:
        raise HTTPException(
            status_code=503,
            detail="Asset due date storage is not configured. Run database migrations.",
        )

    staff_uuid: UUID | None = None
    staff_row: Optional[dict[str, Any]] = None
    class_code: str | None = None
    enrollment_uuid: UUID | None = None
    student_name: str | None = None

    if assignee_type == "STAFF":
        staff_uuid = _parse_uuid(payload.staff_id, field="staff_id")
        staff_result, _ = _execute_on_first_table(
            db,
            table_candidates=TENANT_STAFF_TABLE_CANDIDATES,
            sql_template="""
                SELECT id, staff_no, first_name, last_name
                FROM {table}
                WHERE id = :staff_id AND tenant_id = :tenant_id
                LIMIT 1
            """,
            params={"staff_id": str(staff_uuid), "tenant_id": str(tenant.id)},
        )
        staff_row = staff_result.mappings().first()
        if not staff_row:
            raise HTTPException(status_code=404, detail="Staff not found")
    elif assignee_type == "CLASS":
        class_code = _normalize_code(payload.class_code or "")
        if not class_code:
            raise HTTPException(status_code=400, detail="class_code is required for CLASS assignment")
        class_result, _ = _execute_on_first_table(
            db,
            table_candidates=TENANT_CLASS_TABLE_CANDIDATES,
            sql_template="""
                SELECT id
                FROM {table}
                WHERE tenant_id = :tenant_id
                  AND UPPER(code) = :class_code
                LIMIT 1
            """,
            params={"tenant_id": str(tenant.id), "class_code": class_code},
        )
        if not class_result.first():
            raise HTTPException(status_code=404, detail="Class not found")
    else:
        enrollment_uuid = _parse_uuid(payload.enrollment_id, field="enrollment_id")
        enrollment_result, _ = _execute_on_first_table(
            db,
            table_candidates=ENROLLMENT_TABLE_CANDIDATES,
            sql_template="""
                SELECT id, payload
                FROM {table}
                WHERE id = :enrollment_id
                  AND tenant_id = :tenant_id
                LIMIT 1
            """,
            params={"enrollment_id": str(enrollment_uuid), "tenant_id": str(tenant.id)},
        )
        enrollment_row = enrollment_result.mappings().first()
        if not enrollment_row:
            raise HTTPException(status_code=404, detail="Student enrollment not found")
        student_payload = _safe_payload_obj(enrollment_row.get("payload"))
        student_name = _enrollment_student_name(student_payload)

    existing_result = db.execute(
        sa.text(
            f"""
            SELECT id
            FROM {assignment_table}
            WHERE tenant_id = :tenant_id
              AND asset_id = :asset_id
              AND UPPER(status) = 'ASSIGNED'
              AND returned_at IS NULL
            LIMIT 1
            """
        ),
        {"tenant_id": str(tenant.id), "asset_id": str(asset_uuid)},
    )
    if existing_result.first():
        raise HTTPException(status_code=409, detail="Asset is currently assigned and not yet returned")

    insert_columns = ["id", "tenant_id", "asset_id", "assigned_by", "status", "notes"]
    insert_values = [":id", ":tenant_id", ":asset_id", ":assigned_by", ":status", ":notes"]
    if "staff_id" in assignment_cols:
        insert_columns.append("staff_id")
        insert_values.append(":staff_id")
    if "assignee_type" in assignment_cols:
        insert_columns.append("assignee_type")
        insert_values.append(":assignee_type")
    if "class_code" in assignment_cols:
        insert_columns.append("class_code")
        insert_values.append(":class_code")
    if "enrollment_id" in assignment_cols:
        insert_columns.append("enrollment_id")
        insert_values.append(":enrollment_id")
    if "due_at" in assignment_cols:
        insert_columns.append("due_at")
        insert_values.append(":due_at")

    assignee_type_expr = (
        "COALESCE(assignee_type, 'STAFF') AS assignee_type"
        if "assignee_type" in assignment_cols
        else "'STAFF' AS assignee_type"
    )
    class_code_expr = (
        "class_code"
        if "class_code" in assignment_cols
        else "CAST(NULL AS TEXT) AS class_code"
    )
    enrollment_id_expr = (
        "CAST(enrollment_id AS TEXT) AS enrollment_id"
        if "enrollment_id" in assignment_cols
        else "CAST(NULL AS TEXT) AS enrollment_id"
    )
    due_at_expr = (
        "CAST(due_at AS TEXT) AS due_at"
        if "due_at" in assignment_cols
        else "CAST(NULL AS TEXT) AS due_at"
    )

    created = db.execute(
        sa.text(
            f"""
            INSERT INTO {assignment_table} ({", ".join(insert_columns)})
            VALUES ({", ".join(insert_values)})
            RETURNING id, CAST(assigned_at AS TEXT) AS assigned_at,
                      CAST(returned_at AS TEXT) AS returned_at,
                      {assignee_type_expr},
                      CAST(staff_id AS TEXT) AS staff_id,
                      {class_code_expr},
                      {enrollment_id_expr},
                      {due_at_expr},
                      status, notes
            """
        ),
        {
            "id": str(uuid4()),
            "tenant_id": str(tenant.id),
            "asset_id": str(asset_uuid),
            "staff_id": str(staff_uuid) if staff_uuid is not None else None,
            "assignee_type": assignee_type,
            "class_code": class_code,
            "enrollment_id": str(enrollment_uuid) if enrollment_uuid is not None else None,
            "due_at": _normalize_iso_datetime(payload.due_at, field="due_at"),
            "assigned_by": str(getattr(_user, "id", "") or "") or None,
            "status": "ASSIGNED",
            "notes": _text_or_none(payload.notes),
        },
    ).mappings().first()
    db.commit()

    if not created:
        raise HTTPException(status_code=500, detail="Failed to create asset assignment")

    return AssetAssignmentOut(
        id=str(created.get("id") or ""),
        asset_id=str(asset_uuid),
        asset_code=str(asset_row.get("asset_code") or ""),
        asset_name=str(asset_row.get("name") or ""),
        assignee_type=str(created.get("assignee_type") or assignee_type),
        staff_id=(str(staff_uuid) if assignee_type == "STAFF" and staff_uuid else None),
        staff_no=(str(staff_row.get("staff_no") or "") if assignee_type == "STAFF" and staff_row else None),
        staff_name=(
            _staff_full_name(staff_row.get("first_name"), staff_row.get("last_name"))
            if assignee_type == "STAFF" and staff_row
            else None
        ),
        class_code=(class_code if assignee_type == "CLASS" else None),
        enrollment_id=(str(enrollment_uuid) if assignee_type == "STUDENT" and enrollment_uuid else None),
        student_name=(student_name if assignee_type == "STUDENT" else None),
        status=str(created.get("status") or "ASSIGNED"),
        due_at=(str(created.get("due_at")) if created.get("due_at") else None),
        is_overdue=False,
        assigned_at=(str(created.get("assigned_at")) if created.get("assigned_at") else None),
        returned_at=(str(created.get("returned_at")) if created.get("returned_at") else None),
        notes=(str(created.get("notes")) if created.get("notes") else None),
    )


@router.put(
    "/hr/asset-assignments/{assignment_id}/return",
    response_model=AssetAssignmentOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def return_asset_assignment(
    assignment_id: UUID,
    payload: AssetAssignmentReturnIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    assignment_ref, assignment_cols = _resolve_existing_table(
        db,
        candidates=ASSET_ASSIGNMENT_TABLE_CANDIDATES,
    )
    asset_ref, _ = _resolve_existing_table(db, candidates=TENANT_ASSET_TABLE_CANDIDATES)
    staff_ref, _ = _resolve_existing_table(db, candidates=TENANT_STAFF_TABLE_CANDIDATES)
    if not assignment_ref or not asset_ref:
        raise HTTPException(status_code=503, detail="Asset assignment storage is unavailable")

    assignee_type_expr = (
        "COALESCE(assignee_type, 'STAFF') AS assignee_type"
        if "assignee_type" in assignment_cols
        else "'STAFF' AS assignee_type"
    )
    class_code_expr = (
        "class_code"
        if "class_code" in assignment_cols
        else "CAST(NULL AS TEXT) AS class_code"
    )
    enrollment_id_expr = (
        "CAST(enrollment_id AS TEXT) AS enrollment_id"
        if "enrollment_id" in assignment_cols
        else "CAST(NULL AS TEXT) AS enrollment_id"
    )
    due_at_expr = (
        "CAST(due_at AS TEXT) AS due_at"
        if "due_at" in assignment_cols
        else "CAST(NULL AS TEXT) AS due_at"
    )

    updated = db.execute(
        sa.text(
            f"""
            UPDATE {assignment_ref}
            SET status = 'RETURNED',
                returned_at = COALESCE(:returned_at, now()),
                notes = COALESCE(:notes, notes)
            WHERE id = :assignment_id
              AND tenant_id = :tenant_id
              AND UPPER(status) = 'ASSIGNED'
              AND returned_at IS NULL
            RETURNING id, asset_id, CAST(staff_id AS TEXT) AS staff_id,
                      {assignee_type_expr}, {class_code_expr}, {enrollment_id_expr}, {due_at_expr},
                      status, notes,
                      CAST(assigned_at AS TEXT) AS assigned_at,
                      CAST(returned_at AS TEXT) AS returned_at
            """
        ),
        {
            "assignment_id": str(assignment_id),
            "tenant_id": str(tenant.id),
            "returned_at": _text_or_none(payload.returned_at),
            "notes": _text_or_none(payload.notes),
        },
    ).mappings().first()
    if not updated:
        raise HTTPException(status_code=404, detail="Active asset assignment not found")

    asset_staff = db.execute(
        sa.text(
            f"""
            SELECT ass.asset_code, ass.name AS asset_name,
                   s.staff_no, s.first_name, s.last_name
            FROM {assignment_ref} a
            JOIN {asset_ref} ass ON ass.id = a.asset_id
            {f"LEFT JOIN {staff_ref} s ON s.id = a.staff_id" if staff_ref and "staff_id" in assignment_cols else "LEFT JOIN (SELECT NULL::text AS staff_no, NULL::text AS first_name, NULL::text AS last_name) s ON true"}
            WHERE a.id = :assignment_id AND a.tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"assignment_id": str(assignment_id), "tenant_id": str(tenant.id)},
    ).mappings().first()

    enrollment_key = str(updated.get("enrollment_id") or "")
    student_name: str | None = None
    if enrollment_key:
        enrollment_index = _tenant_enrollment_index(db, tenant_id=tenant.id)
        student_name = enrollment_index.get(enrollment_key, {}).get("student_name")

    db.commit()

    assignee = _text_or_none(updated.get("assignee_type"), upper=True) or "STAFF"
    return AssetAssignmentOut(
        id=str(updated.get("id") or ""),
        asset_id=str(updated.get("asset_id") or ""),
        asset_code=str(asset_staff.get("asset_code") if asset_staff else ""),
        asset_name=str(asset_staff.get("asset_name") if asset_staff else ""),
        assignee_type=assignee,
        staff_id=(
            str(updated.get("staff_id") or "")
            if assignee == "STAFF" and updated.get("staff_id") is not None
            else None
        ),
        staff_no=(
            str(asset_staff.get("staff_no") if asset_staff else "") or None
            if assignee == "STAFF"
            else None
        ),
        staff_name=(
            _staff_full_name(
                asset_staff.get("first_name") if asset_staff else None,
                asset_staff.get("last_name") if asset_staff else None,
            )
            if assignee == "STAFF"
            else None
        ),
        class_code=(str(updated.get("class_code") or "") or None) if assignee == "CLASS" else None,
        enrollment_id=enrollment_key or None if assignee == "STUDENT" else None,
        student_name=student_name if assignee == "STUDENT" else None,
        status=str(updated.get("status") or "RETURNED"),
        due_at=(str(updated.get("due_at")) if updated.get("due_at") else None),
        is_overdue=False,
        assigned_at=(str(updated.get("assigned_at")) if updated.get("assigned_at") else None),
        returned_at=(str(updated.get("returned_at")) if updated.get("returned_at") else None),
        notes=(str(updated.get("notes")) if updated.get("notes") else None),
    )


# ---------------------------------------------------------------------
# Tenant Notifications
# ---------------------------------------------------------------------

def _list_overdue_asset_notifications(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int,
    offset: int,
) -> list[TenantNotificationOut]:
    assignment_ref, assignment_cols = _resolve_existing_table(
        db,
        candidates=ASSET_ASSIGNMENT_TABLE_CANDIDATES,
    )
    asset_ref, _ = _resolve_existing_table(db, candidates=TENANT_ASSET_TABLE_CANDIDATES)
    staff_ref, _ = _resolve_existing_table(db, candidates=TENANT_STAFF_TABLE_CANDIDATES)
    if not assignment_ref or not asset_ref or "due_at" not in assignment_cols:
        return []

    assignee_type_expr = (
        "COALESCE(a.assignee_type, 'STAFF') AS assignee_type"
        if "assignee_type" in assignment_cols
        else "'STAFF' AS assignee_type"
    )
    class_code_expr = (
        "a.class_code AS class_code"
        if "class_code" in assignment_cols
        else "CAST(NULL AS TEXT) AS class_code"
    )
    enrollment_id_expr = (
        "CAST(a.enrollment_id AS TEXT) AS enrollment_id"
        if "enrollment_id" in assignment_cols
        else "CAST(NULL AS TEXT) AS enrollment_id"
    )
    staff_id_expr = (
        "CAST(a.staff_id AS TEXT) AS staff_id"
        if "staff_id" in assignment_cols
        else "CAST(NULL AS TEXT) AS staff_id"
    )

    rows = db.execute(
        sa.text(
            f"""
            SELECT a.id, {assignee_type_expr}, {staff_id_expr}, {class_code_expr},
                   {enrollment_id_expr}, CAST(a.due_at AS TEXT) AS due_at,
                   ass.asset_code, ass.name AS asset_name,
                   s.staff_no, s.first_name, s.last_name
            FROM {assignment_ref} a
            JOIN {asset_ref} ass ON ass.id = a.asset_id
            {f"LEFT JOIN {staff_ref} s ON s.id = a.staff_id" if staff_ref and "staff_id" in assignment_cols else "LEFT JOIN (SELECT NULL::text AS staff_no, NULL::text AS first_name, NULL::text AS last_name) s ON true"}
            WHERE a.tenant_id = :tenant_id
              AND UPPER(a.status) = 'ASSIGNED'
              AND a.returned_at IS NULL
              AND a.due_at IS NOT NULL
              AND a.due_at < now()
            ORDER BY a.due_at ASC, a.id ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        {
            "tenant_id": str(tenant_id),
            "limit": int(limit),
            "offset": int(offset),
        },
    ).mappings().all()

    enrollment_ids = {
        str(row.get("enrollment_id"))
        for row in rows
        if row.get("enrollment_id") is not None
    }
    enrollment_index = _tenant_enrollment_index(db, tenant_id=tenant_id) if enrollment_ids else {}

    notifications: list[TenantNotificationOut] = []
    for row in rows:
        assignee_type = _text_or_none(row.get("assignee_type"), upper=True) or "STAFF"
        due_at = str(row.get("due_at") or "")
        asset_code = str(row.get("asset_code") or "")
        asset_name = str(row.get("asset_name") or "Asset")

        assignee_label = "Unassigned"
        if assignee_type == "STAFF":
            assignee_label = _staff_full_name(row.get("first_name"), row.get("last_name"))
            staff_no = str(row.get("staff_no") or "")
            if staff_no:
                assignee_label = f"{assignee_label} ({staff_no})"
        elif assignee_type == "CLASS":
            code = str(row.get("class_code") or "").strip()
            assignee_label = f"Class {code}" if code else "Class assignment"
        elif assignee_type == "STUDENT":
            enrollment_key = str(row.get("enrollment_id") or "")
            student = enrollment_index.get(enrollment_key, {})
            student_name = student.get("student_name") or "Student"
            adm = (student.get("admission_number") or "").strip()
            assignee_label = f"{student_name} ({adm})" if adm else student_name

        notifications.append(
            TenantNotificationOut(
                id=f"asset-due-{row.get('id')}",
                type="ASSET_DUE",
                severity="warning",
                title=f"Asset return overdue · {asset_code}",
                message=f"{asset_name} assigned to {assignee_label} is overdue since {due_at}.",
                entity_type="asset_assignment",
                entity_id=str(row.get("id") or ""),
                created_at=due_at or datetime.now(timezone.utc).isoformat(),
                due_at=due_at or None,
                unread=True,
            )
        )
    return notifications


def _count_overdue_asset_notifications(
    db: Session,
    *,
    tenant_id: UUID,
) -> int:
    assignment_ref, assignment_cols = _resolve_existing_table(
        db,
        candidates=ASSET_ASSIGNMENT_TABLE_CANDIDATES,
    )
    if not assignment_ref or "due_at" not in assignment_cols:
        return 0
    count = db.execute(
        sa.text(
            f"""
            SELECT COUNT(1)
            FROM {assignment_ref}
            WHERE tenant_id = :tenant_id
              AND UPPER(status) = 'ASSIGNED'
              AND returned_at IS NULL
              AND due_at IS NOT NULL
              AND due_at < now()
            """
        ),
        {"tenant_id": str(tenant_id)},
    ).scalar()
    return int(count or 0)


def _teacher_unfilled_assignment_slots_for_staff(
    db: Session,
    *,
    tenant_id: UUID,
    staff_id: str,
    assignment_table: str,
    subject_table: str | None,
) -> tuple[int, list[str]]:
    count_row = db.execute(
        sa.text(
            f"""
            WITH lost_slots AS (
                SELECT DISTINCT subject_id, UPPER(class_code) AS class_code
                FROM {assignment_table}
                WHERE tenant_id = :tenant_id
                  AND staff_id = :staff_id
            ),
            covered_slots AS (
                SELECT DISTINCT subject_id, UPPER(class_code) AS class_code
                FROM {assignment_table}
                WHERE tenant_id = :tenant_id
                  AND COALESCE(is_active, true) = true
                  AND staff_id <> :staff_id
            )
            SELECT COUNT(1)
            FROM lost_slots ls
            LEFT JOIN covered_slots cs
              ON cs.subject_id = ls.subject_id
             AND cs.class_code = ls.class_code
            WHERE cs.subject_id IS NULL
            """
        ),
        {"tenant_id": str(tenant_id), "staff_id": str(staff_id)},
    ).scalar()
    unresolved_count = int(count_row or 0)
    if unresolved_count <= 0:
        return 0, []

    if subject_table:
        preview_rows = db.execute(
            sa.text(
                f"""
                WITH lost_slots AS (
                    SELECT DISTINCT subject_id, UPPER(class_code) AS class_code
                    FROM {assignment_table}
                    WHERE tenant_id = :tenant_id
                      AND staff_id = :staff_id
                ),
                covered_slots AS (
                    SELECT DISTINCT subject_id, UPPER(class_code) AS class_code
                    FROM {assignment_table}
                    WHERE tenant_id = :tenant_id
                      AND COALESCE(is_active, true) = true
                      AND staff_id <> :staff_id
                )
                SELECT ls.class_code, sub.code AS subject_code
                FROM lost_slots ls
                LEFT JOIN covered_slots cs
                  ON cs.subject_id = ls.subject_id
                 AND cs.class_code = ls.class_code
                LEFT JOIN {subject_table} sub ON sub.id = ls.subject_id
                WHERE cs.subject_id IS NULL
                ORDER BY ls.class_code ASC, COALESCE(sub.code, '') ASC
                LIMIT 4
                """
            ),
            {"tenant_id": str(tenant_id), "staff_id": str(staff_id)},
        ).mappings().all()
    else:
        preview_rows = db.execute(
            sa.text(
                f"""
                WITH lost_slots AS (
                    SELECT DISTINCT subject_id, UPPER(class_code) AS class_code
                    FROM {assignment_table}
                    WHERE tenant_id = :tenant_id
                      AND staff_id = :staff_id
                ),
                covered_slots AS (
                    SELECT DISTINCT subject_id, UPPER(class_code) AS class_code
                    FROM {assignment_table}
                    WHERE tenant_id = :tenant_id
                      AND COALESCE(is_active, true) = true
                      AND staff_id <> :staff_id
                )
                SELECT ls.class_code, CAST(NULL AS TEXT) AS subject_code
                FROM lost_slots ls
                LEFT JOIN covered_slots cs
                  ON cs.subject_id = ls.subject_id
                 AND cs.class_code = ls.class_code
                WHERE cs.subject_id IS NULL
                ORDER BY ls.class_code ASC
                LIMIT 4
                """
            ),
            {"tenant_id": str(tenant_id), "staff_id": str(staff_id)},
        ).mappings().all()

    preview = []
    for row in preview_rows[:3]:
        class_code = str(row.get("class_code") or "").strip()
        subject_code = str(row.get("subject_code") or "").strip()
        if subject_code and class_code:
            preview.append(f"{subject_code} · {class_code}")
        elif class_code:
            preview.append(f"Class {class_code}")
        elif subject_code:
            preview.append(subject_code)
    return unresolved_count, preview


def _list_separated_teacher_notifications(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int,
    offset: int,
) -> list[TenantNotificationOut]:
    staff_ref, staff_cols = _resolve_existing_table(
        db,
        candidates=TENANT_STAFF_TABLE_CANDIDATES,
    )
    if not staff_ref:
        return []

    if "separation_status" not in staff_cols:
        return []

    sep_reason_expr = (
        "s.separation_reason"
        if "separation_reason" in staff_cols
        else "CAST(NULL AS TEXT) AS separation_reason"
    )
    sep_date_expr = (
        "CAST(s.separation_date AS TEXT) AS separation_date"
        if "separation_date" in staff_cols
        else "CAST(NULL AS TEXT) AS separation_date"
    )
    updated_at_expr = (
        "CAST(s.updated_at AS TEXT) AS updated_at"
        if "updated_at" in staff_cols
        else "CAST(NULL AS TEXT) AS updated_at"
    )
    created_at_expr = (
        "CAST(s.created_at AS TEXT) AS created_at"
        if "created_at" in staff_cols
        else "CAST(NULL AS TEXT) AS created_at"
    )

    rows = db.execute(
        sa.text(
            f"""
            SELECT
                CAST(s.id AS TEXT) AS id,
                s.staff_no,
                s.first_name,
                s.last_name,
                UPPER(COALESCE(s.separation_status, '')) AS separation_status,
                {sep_reason_expr},
                {sep_date_expr},
                {updated_at_expr},
                {created_at_expr}
            FROM {staff_ref} s
            WHERE s.tenant_id = :tenant_id
              AND UPPER(COALESCE(s.staff_type, '')) IN ('TEACHING', 'TEACHER', 'LECTURER')
              AND UPPER(COALESCE(s.separation_status, '')) IN ('FIRED_MISCONDUCT', 'LEFT_PERMANENTLY')
            ORDER BY COALESCE(s.updated_at, s.created_at) DESC, s.staff_no ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        {
            "tenant_id": str(tenant_id),
            "limit": int(limit),
            "offset": int(offset),
        },
    ).mappings().all()

    assignment_ref, _ = _resolve_existing_table(
        db,
        candidates=TEACHER_ASSIGNMENT_TABLE_CANDIDATES,
    )
    subject_ref, _ = _resolve_existing_table(
        db,
        candidates=TENANT_SUBJECT_TABLE_CANDIDATES,
    )

    notifications: list[TenantNotificationOut] = []
    for row in rows:
        staff_id = str(row.get("id") or "")
        if not staff_id:
            continue

        unresolved_count = 0
        unresolved_preview: list[str] = []
        if assignment_ref:
            unresolved_count, unresolved_preview = _teacher_unfilled_assignment_slots_for_staff(
                db,
                tenant_id=tenant_id,
                staff_id=staff_id,
                assignment_table=assignment_ref,
                subject_table=subject_ref,
            )
            # When assignment storage exists, notify only when there are uncovered slots.
            if unresolved_count <= 0:
                continue

        staff_no = str(row.get("staff_no") or "").strip()
        staff_name = _staff_full_name(row.get("first_name"), row.get("last_name"))
        sep_status = str(row.get("separation_status") or "").upper()
        sep_reason = _text_or_none(row.get("separation_reason"))
        sep_date = _text_or_none(row.get("separation_date"))
        created_at = (
            sep_date
            or _text_or_none(row.get("updated_at"))
            or _text_or_none(row.get("created_at"))
            or datetime.now(timezone.utc).isoformat()
        )

        if sep_status == "FIRED_MISCONDUCT":
            title = f"Teacher fired · {staff_no or staff_name}"
            status_text = "was fired due to misconduct"
            severity = "error"
        else:
            title = f"Teacher left school · {staff_no or staff_name}"
            status_text = "left school permanently"
            severity = "warning"

        message_parts = [f"{staff_name} ({staff_no or 'no staff number'}) {status_text}."]
        if unresolved_count > 0:
            message_parts.append(
                f"{unresolved_count} subject/class assignment slot(s) need reassignment."
            )
        if unresolved_preview:
            message_parts.append(
                "Action now: reassign " + ", ".join(unresolved_preview)
                + (" and others." if unresolved_count > len(unresolved_preview) else ".")
            )
        if sep_reason:
            message_parts.append(f"Reason: {sep_reason}.")

        notifications.append(
            TenantNotificationOut(
                id=f"teacher-separated-{staff_id}",
                type="TEACHER_SEPARATED",
                severity=severity,
                title=title,
                message=" ".join(part.strip() for part in message_parts if part.strip()),
                entity_type="staff",
                entity_id=staff_id,
                created_at=created_at,
                due_at=None,
                unread=True,
            )
        )

    return notifications


def _list_transfer_approved_notifications(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int,
    offset: int,
) -> list[TenantNotificationOut]:
    safe_limit = max(1, min(int(limit), 1000))
    safe_offset = max(0, int(offset))
    scan_limit = min(3000, safe_limit + safe_offset + 500)

    rows, _table_name = _read_rows_first_table(
        db,
        table_candidates=ENROLLMENT_TABLE_CANDIDATES,
        sql_template="""
            SELECT id, status, payload
            FROM {table}
            WHERE tenant_id = :tenant_id
              AND UPPER(COALESCE(status, '')) = 'TRANSFERRED'
            ORDER BY id DESC
            LIMIT :limit
        """,
        params={
            "tenant_id": str(tenant_id),
            "limit": int(scan_limit),
        },
    )

    notifications: list[TenantNotificationOut] = []
    for row in rows:
        enrollment_id = str(row.get("id") or "").strip()
        if not enrollment_id:
            continue

        payload = _safe_payload_obj(row.get("payload"))
        approved_at = _payload_text(payload, ("transfer_approved_at",))
        if not approved_at:
            continue

        student_name = _enrollment_student_name(payload)
        admission_number = _enrollment_admission_number(payload) or "N/A"
        nemis_no = _payload_text(payload, ("nemis_no", "nemisNo")) or "N/A"
        assessment_no = _payload_text(payload, ("assessment_no", "assessmentNo")) or "N/A"
        class_code = _enrollment_class_code(payload) or "N/A"
        term_code = _enrollment_term_bucket(payload) or "N/A"

        notifications.append(
            TenantNotificationOut(
                id=f"transfer-approved-{enrollment_id}",
                type="TRANSFER_APPROVED",
                severity="success",
                title=f"Transfer approved · {student_name}",
                message=(
                    f"{student_name} ({admission_number}) transfer has been approved. "
                    f"NEMIS: {nemis_no}. Assessment: {assessment_no}. "
                    f"Class: {class_code}. Term: {term_code}."
                ),
                entity_type="enrollment",
                entity_id=enrollment_id,
                created_at=approved_at,
                due_at=None,
                unread=True,
            )
        )

    notifications.sort(
        key=lambda n: (
            str(n.created_at or ""),
            str(n.id or ""),
        ),
        reverse=True,
    )

    start = safe_offset
    end = start + safe_limit
    return notifications[start:end]


def _count_separated_teacher_notifications(
    db: Session,
    *,
    tenant_id: UUID,
) -> int:
    # One notification per separated teacher with unresolved teaching slots.
    rows = _list_separated_teacher_notifications(
        db,
        tenant_id=tenant_id,
        limit=1000,
        offset=0,
    )
    return len(rows)


def _list_support_reply_notifications(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    limit: int,
    offset: int,
) -> list[TenantNotificationOut]:
    safe_limit = max(1, min(int(limit), 1000))
    safe_offset = max(0, int(offset))
    try:
        rows = support_service.tenant_thread_for_notifications(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            limit=safe_limit,
            offset=safe_offset,
        )
    except Exception:
        db.rollback()
        return []

    notifications: list[TenantNotificationOut] = []
    for row in rows:
        notification_id = str(row.get("id") or "").strip()
        if not notification_id:
            continue
        created_at = str(row.get("created_at") or "").strip() or _now_utc().isoformat()
        thread_id = str(row.get("thread_id") or "").strip()
        title = str(row.get("title") or "").strip() or "Admin replied to your support request"
        message = str(row.get("message") or "").strip() or "Open Contact Admin to view the reply."
        notifications.append(
            TenantNotificationOut(
                id=notification_id,
                type="SUPPORT_REPLY",
                severity="info",
                title=title,
                message=message,
                entity_type="support_thread",
                entity_id=thread_id or None,
                created_at=created_at,
                due_at=None,
                unread=True,
            )
        )
    return notifications


def _collect_tenant_notifications(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    limit: int,
) -> list[TenantNotificationOut]:
    fetch_limit = max(50, min(2000, int(limit)))
    notifications = _list_overdue_asset_notifications(
        db,
        tenant_id=tenant_id,
        limit=fetch_limit,
        offset=0,
    ) + _list_separated_teacher_notifications(
        db,
        tenant_id=tenant_id,
        limit=fetch_limit,
        offset=0,
    ) + _list_transfer_approved_notifications(
        db,
        tenant_id=tenant_id,
        limit=fetch_limit,
        offset=0,
    ) + _list_support_reply_notifications(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        limit=fetch_limit,
        offset=0,
    )
    notifications.sort(
        key=lambda n: (
            str(n.created_at or ""),
            str(n.id or ""),
        ),
        reverse=True,
    )
    return notifications


def _read_notification_ids_for_user(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    notification_ids: list[str],
) -> set[str]:
    ids = [str(nid).strip() for nid in notification_ids if str(nid).strip()]
    if not ids:
        return set()

    table_ref, cols = _resolve_existing_table(
        db,
        candidates=TENANT_NOTIFICATION_READ_TABLE_CANDIDATES,
    )
    if not table_ref:
        return set()

    deleted_filter = "AND deleted_at IS NULL" if "deleted_at" in cols else ""
    stmt = sa.text(
        f"""
        SELECT notification_id
        FROM {table_ref}
        WHERE tenant_id = :tenant_id
          AND user_id = :user_id
          AND notification_id IN :notification_ids
          {deleted_filter}
        """
    ).bindparams(sa.bindparam("notification_ids", expanding=True))

    rows = db.execute(
        stmt,
        {
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
            "notification_ids": ids,
        },
    ).all()
    return {str(row[0]) for row in rows if row and row[0] is not None}


def _read_deleted_notification_ids_for_user(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    notification_ids: list[str],
) -> set[str]:
    ids = [str(nid).strip() for nid in notification_ids if str(nid).strip()]
    if not ids:
        return set()

    table_ref, cols = _resolve_existing_table(
        db,
        candidates=TENANT_NOTIFICATION_READ_TABLE_CANDIDATES,
    )
    if not table_ref or "deleted_at" not in cols:
        return set()

    stmt = sa.text(
        f"""
        SELECT notification_id
        FROM {table_ref}
        WHERE tenant_id = :tenant_id
          AND user_id = :user_id
          AND notification_id IN :notification_ids
          AND deleted_at IS NOT NULL
        """
    ).bindparams(sa.bindparam("notification_ids", expanding=True))

    rows = db.execute(
        stmt,
        {
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
            "notification_ids": ids,
        },
    ).all()
    return {str(row[0]) for row in rows if row and row[0] is not None}


def _apply_notification_read_state(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    notifications: list[TenantNotificationOut],
) -> list[TenantNotificationOut]:
    notification_ids = [str(n.id) for n in notifications if getattr(n, "id", None)]
    deleted_ids = _read_deleted_notification_ids_for_user(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        notification_ids=notification_ids,
    )
    read_ids = _read_notification_ids_for_user(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        notification_ids=notification_ids,
    )
    visible_notifications: list[TenantNotificationOut] = []
    for notification in notifications:
        notification_id = str(notification.id)
        if notification_id in deleted_ids:
            continue
        notification.unread = notification_id not in read_ids
        visible_notifications.append(notification)
    return visible_notifications


def _mark_notification_read(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    notification_id: str,
) -> bool:
    table_ref, cols = _resolve_existing_table(
        db,
        candidates=TENANT_NOTIFICATION_READ_TABLE_CANDIDATES,
    )
    if not table_ref:
        return False

    if "deleted_at" in cols:
        on_conflict_sql = (
            "DO UPDATE SET read_at = EXCLUDED.read_at "
            f"WHERE {table_ref}.deleted_at IS NULL"
        )
    else:
        on_conflict_sql = "DO UPDATE SET read_at = EXCLUDED.read_at"

    db.execute(
        sa.text(
            f"""
            INSERT INTO {table_ref} (
                tenant_id, user_id, notification_id, read_at, created_at
            )
            VALUES (
                :tenant_id, :user_id, :notification_id, now(), now()
            )
            ON CONFLICT (tenant_id, user_id, notification_id)
            {on_conflict_sql}
            """
        ),
        {
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
            "notification_id": str(notification_id),
        },
    )
    return True


def _mark_notifications_read_bulk(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    notification_ids: list[str],
) -> int:
    ids = sorted({str(nid).strip() for nid in notification_ids if str(nid).strip()})
    if not ids:
        return 0

    table_ref, cols = _resolve_existing_table(
        db,
        candidates=TENANT_NOTIFICATION_READ_TABLE_CANDIDATES,
    )
    if not table_ref:
        return 0

    if "deleted_at" in cols:
        on_conflict_sql = (
            "DO UPDATE SET read_at = EXCLUDED.read_at "
            f"WHERE {table_ref}.deleted_at IS NULL"
        )
    else:
        on_conflict_sql = "DO UPDATE SET read_at = EXCLUDED.read_at"

    db.execute(
        sa.text(
            f"""
            INSERT INTO {table_ref} (
                tenant_id, user_id, notification_id, read_at, created_at
            )
            VALUES (
                :tenant_id, :user_id, :notification_id, now(), now()
            )
            ON CONFLICT (tenant_id, user_id, notification_id)
            {on_conflict_sql}
            """
        ),
        [
            {
                "tenant_id": str(tenant_id),
                "user_id": str(user_id),
                "notification_id": nid,
            }
            for nid in ids
        ],
    )
    return len(ids)


def _delete_notification_for_user(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    notification_id: str,
) -> bool:
    table_ref, cols = _resolve_existing_table(
        db,
        candidates=TENANT_NOTIFICATION_READ_TABLE_CANDIDATES,
    )
    if not table_ref or "deleted_at" not in cols:
        return False

    db.execute(
        sa.text(
            f"""
            INSERT INTO {table_ref} (
                tenant_id, user_id, notification_id, read_at, deleted_at, created_at
            )
            VALUES (
                :tenant_id, :user_id, :notification_id, now(), now(), now()
            )
            ON CONFLICT (tenant_id, user_id, notification_id)
            DO UPDATE SET deleted_at = now()
            """
        ),
        {
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
            "notification_id": str(notification_id),
        },
    )
    return True


@router.post(
    "/notifications/{notification_id}/read",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def tenant_notification_mark_read(
    notification_id: str,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    cleaned_id = str(notification_id or "").strip()
    if not cleaned_id:
        raise HTTPException(status_code=400, detail="notification_id is required")
    if len(cleaned_id) > 255:
        raise HTTPException(status_code=400, detail="notification_id is too long")

    user_id = _parse_uuid(getattr(_user, "id", None), field="current_user.id")
    marked = _mark_notification_read(
        db,
        tenant_id=tenant.id,
        user_id=user_id,
        notification_id=cleaned_id,
    )
    if not marked:
        raise HTTPException(
            status_code=503,
            detail="Notification read storage is not configured. Run database migrations.",
        )
    db.commit()
    return {"ok": True, "notification_id": cleaned_id}


@router.post(
    "/notifications/{notification_id}/delete",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def tenant_notification_delete(
    notification_id: str,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    cleaned_id = str(notification_id or "").strip()
    if not cleaned_id:
        raise HTTPException(status_code=400, detail="notification_id is required")
    if len(cleaned_id) > 255:
        raise HTTPException(status_code=400, detail="notification_id is too long")

    user_id = _parse_uuid(getattr(_user, "id", None), field="current_user.id")
    deleted = _delete_notification_for_user(
        db,
        tenant_id=tenant.id,
        user_id=user_id,
        notification_id=cleaned_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=503,
            detail="Notification delete storage is not configured. Run database migrations.",
        )
    db.commit()
    return {"ok": True, "notification_id": cleaned_id}


@router.post(
    "/notifications/mark-all-read",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def tenant_notifications_mark_all_read(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    user_id = _parse_uuid(getattr(_user, "id", None), field="current_user.id")
    notifications = _collect_tenant_notifications(
        db,
        tenant_id=tenant.id,
        user_id=user_id,
        limit=2000,
    )
    notifications = _apply_notification_read_state(
        db,
        tenant_id=tenant.id,
        user_id=user_id,
        notifications=notifications,
    )
    marked_count = _mark_notifications_read_bulk(
        db,
        tenant_id=tenant.id,
        user_id=user_id,
        notification_ids=[str(n.id) for n in notifications],
    )
    if notifications and marked_count == 0:
        raise HTTPException(
            status_code=503,
            detail="Notification read storage is not configured. Run database migrations.",
        )
    db.commit()
    return {"ok": True, "marked_count": int(marked_count)}


@router.get(
    "/notifications",
    response_model=list[TenantNotificationOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def tenant_notifications(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    user_id = _parse_uuid(getattr(_user, "id", None), field="current_user.id")
    notifications = _collect_tenant_notifications(
        db,
        tenant_id=tenant.id,
        user_id=user_id,
        limit=int(limit) + int(offset) + 100,
    )
    notifications = _apply_notification_read_state(
        db,
        tenant_id=tenant.id,
        user_id=user_id,
        notifications=notifications,
    )
    start = int(offset)
    end = start + int(limit)
    return notifications[start:end]


@router.get(
    "/notifications/unread-count",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def tenant_notifications_unread_count(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    user_id = _parse_uuid(getattr(_user, "id", None), field="current_user.id")
    notifications = _collect_tenant_notifications(
        db,
        tenant_id=tenant.id,
        user_id=user_id,
        limit=2000,
    )
    notifications = _apply_notification_read_state(
        db,
        tenant_id=tenant.id,
        user_id=user_id,
        notifications=notifications,
    )
    unread_count = sum(1 for notification in notifications if bool(notification.unread))
    return {"unread_count": int(unread_count)}


# ---------------------------------------------------------------------
# Super Admin: Tenants Management (SaaS Operator)
# ---------------------------------------------------------------------

@router.get(
    "",
    dependencies=[Depends(require_permission("tenants.read_all"))],
)
def list_tenants(
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
    include_inactive: bool = True,
):
    q = select(Tenant)
    if not include_inactive:
        q = q.where(Tenant.is_active == True)

    rows = db.execute(q.order_by(Tenant.created_at.desc())).scalars().all()

    return [
        {
            "id": str(t.id),
            "slug": t.slug,
            "name": t.name,
            "primary_domain": t.primary_domain,
            "is_active": bool(t.is_active),
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        }
        for t in rows
    ]


@router.post(
    "",
    dependencies=[Depends(require_permission("tenants.create"))],
)
def create_tenant(
    payload: TenantCreate,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    slug = _normalize_slug(payload.slug)

    exists = db.execute(select(Tenant).where(Tenant.slug == slug)).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Tenant slug already exists")

    if payload.primary_domain:
        dom = payload.primary_domain.strip().lower()
        dom_exists = db.execute(select(Tenant).where(Tenant.primary_domain == dom)).scalar_one_or_none()
        if dom_exists:
            raise HTTPException(status_code=409, detail="Primary domain already mapped to another tenant")
    else:
        dom = None

    t = Tenant(
        id=uuid4(),
        slug=slug,
        name=payload.name.strip(),
        primary_domain=dom,
        is_active=payload.is_active,
    )
    db.add(t)

    if payload.director_email and payload.director_password:
        email = payload.director_email.strip().lower()

        existing_user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if existing_user is None:
            existing_user = User(
                id=uuid4(),
                email=email,
                password_hash=hash_password(payload.director_password),
                full_name=(payload.director_full_name.strip() if payload.director_full_name else None),
                phone=(payload.director_phone.strip() if payload.director_phone else None),
                is_active=True,
            )
            db.add(existing_user)

        membership = db.execute(
            select(UserTenant).where(
                UserTenant.tenant_id == t.id,
                UserTenant.user_id == existing_user.id,
            )
        ).scalar_one_or_none()

        if membership is None:
            db.add(UserTenant(
                id=uuid4(),
                tenant_id=t.id,
                user_id=existing_user.id,
                is_active=True,
            ))

        director_role = db.execute(
            select(Role).where(Role.code == "DIRECTOR", Role.tenant_id.is_(None))
        ).scalar_one_or_none()

        if not director_role:
            raise HTTPException(status_code=500, detail="System role DIRECTOR not seeded")

        ur = db.execute(
            select(UserRole).where(
                UserRole.user_id == existing_user.id,
                UserRole.role_id == director_role.id,
                UserRole.tenant_id == t.id,
            )
        ).scalar_one_or_none()

        if ur is None:
            db.add(UserRole(
                id=uuid4(),
                tenant_id=t.id,
                user_id=existing_user.id,
                role_id=director_role.id,
            ))

    db.commit()
    db.refresh(t)

    return {
        "id": str(t.id),
        "slug": t.slug,
        "name": t.name,
        "primary_domain": t.primary_domain,
        "is_active": bool(t.is_active),
    }


# ---------------------------------------------------------------------
# Tenant Admin: Update own tenant basics (Director use-case)
# NOTE: /me must be defined BEFORE /{tenant_id} or FastAPI will match /me
# as the tenant_id path parameter.
# ---------------------------------------------------------------------

@router.get(
    "/profile",
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.fees.view",
                "finance.fees.manage",
            )
        )
    ],
)
def get_tenant_profile(
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    return {
        "curriculum_type": getattr(tenant, "curriculum_type", "CBC") or "CBC",
        "name": str(getattr(tenant, "name", "") or ""),
    }


@router.put(
    "/profile",
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def put_tenant_profile(
    payload: TenantSelfUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    t = db.get(Tenant, tenant.id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if payload.curriculum_type is not None:
        val = payload.curriculum_type.strip().upper()
        canonical = {"CBC": "CBC", "844": "8-4-4", "8-4-4": "8-4-4", "IGCSE": "IGCSE"}
        if val not in canonical:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid curriculum_type '{payload.curriculum_type}'. Must be one of: CBC, 8-4-4, IGCSE",
            )
        t.curriculum_type = canonical[val]
        t.updated_at = _now_utc()

    db.commit()
    db.refresh(t)
    return {
        "curriculum_type": getattr(t, "curriculum_type", "CBC") or "CBC",
        "name": str(getattr(t, "name", "") or ""),
    }


@router.patch(
    "/me",
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def update_my_tenant(
    payload: TenantSelfUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    t = db.get(Tenant, tenant.id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if payload.name is not None:
        t.name = payload.name.strip()
        t.updated_at = _now_utc()

    if payload.curriculum_type is not None:
        val = payload.curriculum_type.strip().upper().replace("8-4-4", "8-4-4")
        # Normalise to canonical form
        canonical = {"CBC": "CBC", "844": "8-4-4", "8-4-4": "8-4-4", "IGCSE": "IGCSE"}
        if val not in canonical:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid curriculum_type '{payload.curriculum_type}'. Must be one of: CBC, 8-4-4, IGCSE",
            )
        t.curriculum_type = canonical[val]
        t.updated_at = _now_utc()

    db.commit()
    db.refresh(t)

    return {
        "id": str(t.id),
        "slug": t.slug,
        "name": t.name,
        "primary_domain": t.primary_domain,
        "is_active": bool(t.is_active),
        "curriculum_type": getattr(t, "curriculum_type", "CBC") or "CBC",
    }


@router.patch(
    "/{tenant_id}",
    dependencies=[Depends(require_permission("tenants.update"))],
)
def update_tenant(
    tenant_id: UUID,
    payload: TenantUpdate,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if payload.slug is not None:
        new_slug = _normalize_slug(payload.slug)
        if new_slug != t.slug:
            slug_exists = db.execute(select(Tenant).where(Tenant.slug == new_slug)).scalar_one_or_none()
            if slug_exists:
                raise HTTPException(status_code=409, detail="Tenant slug already exists")
            t.slug = new_slug

    if payload.primary_domain is not None:
        dom = payload.primary_domain.strip().lower() if payload.primary_domain else None
        if dom != t.primary_domain and dom is not None:
            dom_exists = db.execute(select(Tenant).where(Tenant.primary_domain == dom)).scalar_one_or_none()
            if dom_exists:
                raise HTTPException(status_code=409, detail="Primary domain already mapped to another tenant")
        t.primary_domain = dom

    if payload.name is not None:
        t.name = payload.name.strip()

    if payload.is_active is not None:
        t.is_active = bool(payload.is_active)

    t.updated_at = _now_utc()

    db.commit()
    db.refresh(t)

    return {
        "id": str(t.id),
        "slug": t.slug,
        "name": t.name,
        "primary_domain": t.primary_domain,
        "is_active": bool(t.is_active),
    }


@router.post(
    "/{tenant_id}/suspend",
    dependencies=[Depends(require_permission("tenants.suspend"))],
)
def suspend_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    t.is_active = False
    t.updated_at = _now_utc()
    db.commit()

    return {"ok": True, "tenant_id": str(t.id), "is_active": bool(t.is_active)}


@router.post(
    "/{tenant_id}/activate",
    dependencies=[Depends(require_permission("tenants.update"))],
)
def activate_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    t.is_active = True
    t.updated_at = _now_utc()
    db.commit()

    return {"ok": True, "tenant_id": str(t.id), "is_active": bool(t.is_active)}


@router.delete(
    "/{tenant_id}",
    dependencies=[Depends(require_permission("tenants.delete"))],
)
def soft_delete_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    t.is_active = False
    t.primary_domain = None

    suffix = str(uuid4())[:8]
    t.slug = f"{t.slug}-deleted-{suffix}"

    t.updated_at = _now_utc()
    db.commit()

    return {"ok": True, "tenant_id": str(t.id)}


# ---------------------------------------------------------------------
# RBAC Management (Tenant-scoped, enterprise)
# ---------------------------------------------------------------------

@router.get(
    "/rbac/permissions",
    dependencies=[Depends(require_permission("rbac.permissions.manage"))],
)
def list_permissions(
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    perms = db.execute(select(Permission).order_by(Permission.code.asc())).scalars().all()
    return _permission_rows_payload(perms)


@router.get(
    "/rbac/roles",
    dependencies=[Depends(require_permission("rbac.roles.manage"))],
)
def list_roles(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    include_system: bool = True,
):
    q = select(Role).where(sa.or_(Role.tenant_id.is_(None), Role.tenant_id == tenant.id))
    if not include_system:
        q = q.where(Role.tenant_id == tenant.id)

    roles = db.execute(q.order_by(Role.code.asc())).scalars().all()
    return [
        {
            "id": str(r.id),
            "tenant_id": str(r.tenant_id) if r.tenant_id else None,
            "code": r.code,
            "name": r.name,
            "description": r.description,
            "is_system": bool(r.is_system),
            "is_system": bool(r.is_system),
        }
        for r in roles
    ]


@router.post(
    "/rbac/roles",
    dependencies=[Depends(require_permission("rbac.roles.manage"))],
)
def create_role(
    payload: RoleCreate,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    code = payload.code.strip().upper()

    exists = db.execute(
        select(Role).where(
            Role.code == code,
            Role.tenant_id == tenant.id,
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Role code already exists in this tenant")

    r = Role(
        id=uuid4(),
        tenant_id=tenant.id,
        code=code,
        name=payload.name.strip(),
        description=(payload.description.strip() if payload.description else None),
        is_system=False,
    )
    db.add(r)
    db.flush()
    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=_user.id,
        action="rbac.role.create",
        resource="role",
        resource_id=r.id,
        payload={
            "code": r.code,
            "name": r.name,
            "description": r.description,
        },
        request=request,
    )
    db.commit()
    db.refresh(r)

    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "code": r.code,
        "name": r.name,
        "description": r.description,
        "is_system": bool(r.is_system),
    }


@router.patch(
    "/rbac/roles/{role_id}",
    dependencies=[Depends(require_permission("rbac.roles.manage"))],
)
def update_role(
    role_id: UUID,
    payload: RoleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    if r.tenant_id is None or r.is_system:
        raise HTTPException(status_code=403, detail="System roles cannot be modified")

    if r.tenant_id != tenant.id:
        raise HTTPException(status_code=403, detail="Role not in this tenant")

    if payload.name is not None:
        r.name = payload.name.strip()
    if payload.description is not None:
        r.description = payload.description.strip() if payload.description else None

    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=_user.id,
        action="rbac.role.update",
        resource="role",
        resource_id=r.id,
        payload={
            "code": r.code,
            "name": r.name,
            "description": r.description,
        },
        request=request,
    )
    db.commit()
    db.refresh(r)

    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "code": r.code,
        "name": r.name,
        "description": r.description,
        "is_system": bool(r.is_system),
    }


@router.delete(
    "/rbac/roles/{role_id}",
    dependencies=[Depends(require_permission("rbac.roles.manage"))],
)
def delete_role(
    role_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    if r.tenant_id is None or r.is_system:
        raise HTTPException(status_code=403, detail="System roles cannot be deleted")

    if r.tenant_id != tenant.id:
        raise HTTPException(status_code=403, detail="Role not in this tenant")

    role_name = str(r.name)
    role_code = str(r.code)
    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=_user.id,
        action="rbac.role.delete",
        resource="role",
        resource_id=r.id,
        payload={"code": role_code, "name": role_name},
        request=request,
    )
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.put(
    "/rbac/roles/{role_id}/permissions",
    dependencies=[Depends(require_permission("rbac.permissions.manage"))],
)
def set_role_permissions(
    role_id: UUID,
    payload: RolePermissionsSet,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    if r.tenant_id is None or r.is_system:
        raise HTTPException(status_code=403, detail="System role permissions cannot be changed here")

    if r.tenant_id != tenant.id:
        raise HTTPException(status_code=403, detail="Role not in this tenant")

    codes = sorted({c.strip() for c in payload.permission_codes if c and c.strip()})

    perm_rows = db.execute(select(Permission).where(Permission.code.in_(codes))).scalars().all()
    found_codes = {p.code for p in perm_rows}
    missing = [c for c in codes if c not in found_codes]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown permission codes: {missing}")

    db.execute(sa.delete(RolePermission).where(RolePermission.role_id == r.id))
    for p in perm_rows:
        db.add(RolePermission(role_id=r.id, permission_id=p.id))

    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=_user.id,
        action="rbac.role.permissions.update",
        resource="role",
        resource_id=r.id,
        payload={
            "code": r.code,
            "permission_codes": codes,
        },
        request=request,
    )
    db.commit()
    return {"ok": True, "role_id": str(r.id), "permission_codes": codes}


@router.get(
    "/rbac/users/{user_id}/roles",
    dependencies=[Depends(require_permission("rbac.user_roles.manage"))],
)
def list_user_roles(
    user_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    rows = db.execute(
        select(Role.code, Role.name, UserRole.tenant_id)
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            UserRole.user_id == user_id,
            sa.or_(UserRole.tenant_id.is_(None), UserRole.tenant_id == tenant.id),
        )
    ).all()

    return [
        {
            "role_code": code,
            "role_name": name,
            "scope": "GLOBAL" if tid is None else "TENANT",
        }
        for code, name, tid in rows
    ]


@router.post(
    "/rbac/users/{user_id}/roles",
    dependencies=[Depends(require_permission("rbac.user_roles.manage"))],
)
def assign_user_role(
    user_id: UUID,
    payload: UserRoleAssign,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    role_code = payload.role_code.strip().upper()
    _ensure_director_assignable_role(role_code)
    r = _get_role_by_code(db, tenant_id=tenant.id, role_code=role_code)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    assign_scope_tenant_id = tenant.id

    exists = db.execute(
        select(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role_id == r.id,
            sa.or_(
                (UserRole.tenant_id.is_(None) if assign_scope_tenant_id is None else False),
                UserRole.tenant_id == assign_scope_tenant_id,
            ),
        )
    ).scalar_one_or_none()

    if exists:
        return {"ok": True}

    ur = UserRole(
        id=uuid4(),
        tenant_id=assign_scope_tenant_id,
        user_id=user_id,
        role_id=r.id,
    )
    db.add(ur)
    db.flush()
    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=_user.id,
        action="rbac.user_role.assign",
        resource="user_role",
        resource_id=ur.id,
        payload={
            "user_id": str(user_id),
            "role_code": r.code,
        },
        request=request,
    )
    db.commit()
    return {"ok": True}


@router.delete(
    "/rbac/users/{user_id}/roles/{role_code}",
    dependencies=[Depends(require_permission("rbac.user_roles.manage"))],
)
def remove_user_role(
    user_id: UUID,
    role_code: str,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    code = role_code.strip().upper()
    _ensure_director_assignable_role(code)
    r = _get_role_by_code(db, tenant_id=tenant.id, role_code=code)
    if not r:
        raise HTTPException(status_code=404, detail="Role not found")

    removed = db.execute(
        sa.delete(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role_id == r.id,
            UserRole.tenant_id == tenant.id,
        )
    ).rowcount or 0
    if removed:
        _audit_tenant_change_best_effort(
            db,
            tenant_id=tenant.id,
            actor_user_id=_user.id,
            action="rbac.user_role.remove",
            resource="user_role",
            resource_id=None,
            payload={
                "user_id": str(user_id),
                "role_code": r.code,
                "removed_count": int(removed),
            },
            request=request,
        )
    db.commit()
    return {"ok": True}


@router.get(
    "/rbac/users/{user_id}/permission-overrides",
    dependencies=[Depends(require_permission("rbac.user_permissions.manage"))],
)
def list_user_permission_overrides(
    user_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    rows = db.execute(
        select(Permission.code, UserPermissionOverride.effect, UserPermissionOverride.reason)
        .select_from(UserPermissionOverride)
        .join(Permission, Permission.id == UserPermissionOverride.permission_id)
        .where(
            UserPermissionOverride.user_id == user_id,
            UserPermissionOverride.tenant_id == tenant.id,
        )
        .order_by(Permission.code.asc())
    ).all()

    return [
        {"permission_code": code, "effect": effect, "reason": reason}
        for code, effect, reason in rows
    ]


@router.put(
    "/rbac/users/{user_id}/permission-overrides",
    dependencies=[Depends(require_permission("rbac.user_permissions.manage"))],
)
def set_user_permission_overrides(
    user_id: UUID,
    payload: UserPermissionOverridesSet,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    requested = payload.overrides or []
    codes = sorted({o.permission_code.strip() for o in requested if o.permission_code and o.permission_code.strip()})
    perm_rows = db.execute(select(Permission).where(Permission.code.in_(codes))).scalars().all()
    found = {p.code: p for p in perm_rows}
    missing = [c for c in codes if c not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown permission codes: {missing}")

    db.execute(
        sa.delete(UserPermissionOverride).where(
            UserPermissionOverride.user_id == user_id,
            UserPermissionOverride.tenant_id == tenant.id,
        )
    )

    for o in requested:
        code = o.permission_code.strip()
        if code not in found:
            continue
        db.add(
            UserPermissionOverride(
                id=uuid4(),
                tenant_id=tenant.id,
                user_id=user_id,
                permission_id=found[code].id,
                effect=o.effect,
                reason=(o.reason.strip() if o.reason else None),
            )
        )

    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=_user.id,
        action="rbac.user_permission_overrides.update",
        resource="user_permission_override",
        resource_id=None,
        payload={
            "user_id": str(user_id),
            "overrides": [
                {
                    "permission_code": o.permission_code.strip(),
                    "effect": o.effect,
                    "reason": (o.reason.strip() if o.reason else None),
                }
                for o in requested
                if o.permission_code and o.permission_code.strip()
            ],
        },
        request=request,
    )
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------
# Secretary endpoints (tenant-safe)
# ---------------------------------------------------------------------

@router.get(
    "/secretary/users",
    response_model=list[SecretaryUserOut],
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def secretary_users(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """
    Tenant-scoped user list for secretary dashboard.
    """
    rows = db.execute(
        select(User.id, User.email, User.full_name, User.is_active)
        .select_from(UserTenant)
        .join(User, User.id == UserTenant.user_id)
        .where(
            UserTenant.tenant_id == tenant.id,
            UserTenant.is_active == True,
        )
        .order_by(User.created_at.desc() if hasattr(User, "created_at") else User.email.asc())
        .limit(limit)
        .offset(offset)
    ).all()

    return [
        SecretaryUserOut(
            id=str(r[0]),
            email=str(r[1]),
            full_name=(str(r[2]) if r[2] is not None else None),
            is_active=bool(r[3]) if r[3] is not None else True,
        )
        for r in rows
    ]


@router.get(
    "/secretary/audit",
    response_model=list[SecretaryAuditOut],
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def secretary_audit(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    include_http_events: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """
    Tenant-scoped audit list for secretary dashboard.

    ✅ Canonical source of truth:
    - AuditMiddleware calls app.core.audit.log_event
    - log_event writes to app.models.audit_log.AuditLog

    So we read from AuditLog directly.
    """
    include_http_events = include_http_events if isinstance(include_http_events, bool) else False

    try:
        from app.models.audit_log import AuditLog  # canonical model used by log_event
    except Exception:
        return []

    try:
        q = (
            select(AuditLog)
            .where(AuditLog.tenant_id == tenant.id)
            .where(
                sa.true()
                if include_http_events
                else sa.not_(
                    sa.and_(
                        AuditLog.action == "http.request",
                        AuditLog.resource == "http",
                    )
                )
            )
            .order_by(AuditLog.created_at.desc())
            .limit(int(limit))
            .offset(int(offset))
        )
        logs = db.execute(q).scalars().all()
    except (ProgrammingError, OperationalError) as e:
        # Missing relation/table/migration not run → do NOT break dashboards
        if _safe_db_missing_table(e):
            return []
        return []
    except Exception as e:
        if _safe_db_missing_table(e):
            return []
        return []

    return [
        SecretaryAuditOut(
            id=str(getattr(l, "id")),
            action=str(getattr(l, "action", "") or ""),
            resource=str(getattr(l, "resource", "") or ""),
            created_at=(
                getattr(l, "created_at").isoformat()
                if getattr(l, "created_at", None)
                else ""
            ),
        )
        for l in logs
    ]


# ---------------------------------------------------------------------
# Secretary finance compatibility endpoints (tenant-safe)
# ---------------------------------------------------------------------

@router.get(
    "/secretary/finance",
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.policy.view",
                "finance.fees.view",
                "finance.invoices.view",
                "finance.payments.view",
                "finance.scholarships.view",
                "enrollment.manage",
            )
        )
    ],
)
@router.get(
    "/secretary/finance/setup",
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.policy.view",
                "finance.fees.view",
                "finance.invoices.view",
                "finance.payments.view",
                "finance.scholarships.view",
                "enrollment.manage",
            )
        )
    ],
)
def secretary_finance(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    from app.api.v1.finance import service as finance_service

    perms = _request_permissions(request)
    can_admin_view_tenant = "admin.dashboard.view_tenant" in perms
    can_view_policy = can_admin_view_tenant or "finance.policy.view" in perms
    can_view_invoices = can_admin_view_tenant or "finance.invoices.view" in perms
    can_manage_invoices = can_admin_view_tenant or "finance.invoices.manage" in perms
    can_view_fees = (
        can_admin_view_tenant
        or "finance.fees.view" in perms
        or "finance.invoices.view" in perms
        or "finance.invoices.manage" in perms
    )
    can_view_scholarships = can_admin_view_tenant or "finance.scholarships.view" in perms
    can_view_payments = can_admin_view_tenant or "finance.payments.view" in perms
    can_manage_payments = can_admin_view_tenant or "finance.payments.manage" in perms
    can_view_enrollments = (
        can_admin_view_tenant
        or "enrollment.manage" in perms
        or can_view_invoices
        or can_manage_invoices
        or can_view_payments
        or can_manage_payments
    )

    policy: dict | None = None
    invoices: list[dict] = []
    fee_categories: list[dict] = []
    fee_items: list[dict] = []
    fee_structures: list[dict] = []
    fee_structure_items: dict[str, list[dict]] = {}
    structure_policies: list[dict] = []
    scholarships: list[dict] = []
    enrollments: list[dict] = []
    payments: list[dict] = []

    health = {
        "policy": False,
        "invoices": False,
        "fee_categories": False,
        "fee_items": False,
        "fee_structures": False,
        "fee_structure_items": False,
        "structure_policies": False,
        "scholarships": False,
        "enrollments": False,
        "payments": False,
    }

    if can_view_policy:
        try:
            row = finance_service.get_or_create_policy(db, tenant_id=tenant.id)
            db.commit()
            policy = _serialize_finance_policy(row)
            health["policy"] = True
        except Exception:
            policy = None

        try:
            rows = finance_service.list_fee_structure_policies(
                db,
                tenant_id=tenant.id,
            )
            structure_policies = [_serialize_structure_policy(r) for r in rows]
            health["structure_policies"] = True
        except Exception:
            structure_policies = []

    if can_view_invoices:
        try:
            rows = finance_service.list_invoices(db, tenant_id=tenant.id)
            invoices = [_serialize_invoice(r) for r in rows]
            health["invoices"] = True
        except Exception:
            invoices = []

    if can_view_fees:
        try:
            rows = finance_service.list_fee_categories(db, tenant_id=tenant.id)
            fee_categories = [_serialize_fee_category(r) for r in rows]
            health["fee_categories"] = True
        except Exception:
            fee_categories = []

        try:
            rows = finance_service.list_fee_items(db, tenant_id=tenant.id)
            fee_items = [_serialize_fee_item(r) for r in rows]
            health["fee_items"] = True
        except Exception:
            fee_items = []

        structure_rows: list[Any] = []
        loaded_structures_via_service = False
        try:
            structure_rows = finance_service.list_fee_structures(db, tenant_id=tenant.id)
            fee_structures = [_serialize_fee_structure(r) for r in structure_rows]
            health["fee_structures"] = True
            loaded_structures_via_service = True
        except Exception:
            db.rollback()
            fee_structures, fallback_ok = _list_fee_structures_fallback(
                db,
                tenant_id=tenant.id,
            )
            health["fee_structures"] = fallback_ok
            structure_rows = []

        if health["fee_structures"]:
            items_ok = True
            if loaded_structures_via_service:
                for structure in structure_rows:
                    sid = str(getattr(structure, "id"))
                    try:
                        _, items = finance_service.get_structure_with_items(
                            db,
                            tenant_id=tenant.id,
                            structure_id=getattr(structure, "id"),
                        )
                        fee_structure_items[sid] = [_serialize_structure_item(i) for i in items]
                    except Exception:
                        items_ok = False
                        fee_structure_items[sid] = []

                if not items_ok:
                    fallback_items, fallback_items_ok = _list_fee_structure_items_fallback(
                        db,
                        tenant_id=tenant.id,
                    )
                    if fallback_items_ok:
                        fee_structure_items = fallback_items
                        items_ok = True
            else:
                fallback_items, fallback_items_ok = _list_fee_structure_items_fallback(
                    db,
                    tenant_id=tenant.id,
                )
                fee_structure_items = fallback_items if fallback_items_ok else {}
                items_ok = fallback_items_ok

            for structure in fee_structures:
                sid = str(structure.get("id") or "")
                if sid and sid not in fee_structure_items:
                    fee_structure_items[sid] = []

            health["fee_structure_items"] = items_ok

    if can_view_scholarships:
        try:
            rows = finance_service.list_scholarships(db, tenant_id=tenant.id)
            usage_map = finance_service.scholarship_usage_map(
                db,
                tenant_id=tenant.id,
                scholarship_ids=[getattr(r, "id") for r in rows] if rows else None,
            )
            scholarships = [
                _serialize_scholarship(
                    r,
                    allocated_amount=usage_map.get(getattr(r, "id"), Decimal("0")),
                )
                for r in rows
            ]
            health["scholarships"] = True
        except Exception:
            scholarships = []

    if can_view_enrollments:
        try:
            enrollments, ok = _list_tenant_enrollments_for_finance(
                db,
                tenant_id=tenant.id,
                limit=500,
            )
            health["enrollments"] = ok
        except Exception:
            db.rollback()
            try:
                enrollments, ok = _list_tenant_enrollments_for_finance(
                    db,
                    tenant_id=tenant.id,
                    limit=500,
                )
                health["enrollments"] = ok
            except Exception:
                enrollments = []

    if can_view_payments:
        try:
            rows = finance_service.list_payments(db, tenant_id=tenant.id)
            payments = [_serialize_payment(r) for r in rows if isinstance(r, dict)]
            health["payments"] = True
        except Exception:
            payments = []

    return {
        "policy": policy,
        "invoices": invoices,
        "fee_categories": fee_categories,
        "fee_items": fee_items,
        "fee_structures": fee_structures,
        "fee_structure_items": fee_structure_items,
        "structure_policies": structure_policies,
        "scholarships": scholarships,
        "enrollments": enrollments,
        "payments": payments,
        "health": health,
    }


@router.post(
    "/secretary/finance",
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.policy.manage",
                "finance.fees.manage",
                "finance.invoices.manage",
                "finance.payments.manage",
                "finance.scholarships.manage",
            )
        )
    ],
)
@router.post(
    "/secretary/finance/setup",
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.policy.manage",
                "finance.fees.manage",
                "finance.invoices.manage",
                "finance.payments.manage",
                "finance.scholarships.manage",
            )
        )
    ],
)
def secretary_finance_action(
    body: dict,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    from app.api.v1.finance import service as finance_service

    action = str((body or {}).get("action") or "").strip()
    payload = (body or {}).get("payload")
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    required_permissions = {
        "create_invoice": "finance.invoices.manage",
        "generate_fees_invoice": "finance.invoices.manage",
        "generate_fees_invoice_v2": "finance.invoices.manage",
        "record_payment": "finance.payments.manage",
        "update_policy": "finance.policy.manage",
        "create_fee_category": "finance.fees.manage",
        "update_fee_category": "finance.fees.manage",
        "delete_fee_category": "finance.fees.manage",
        "create_fee_item": "finance.fees.manage",
        "update_fee_item": "finance.fees.manage",
        "delete_fee_item": "finance.fees.manage",
        "create_fee_structure": "finance.fees.manage",
        "update_fee_structure": "finance.fees.manage",
        "delete_fee_structure": "finance.fees.manage",
        "add_structure_item": "finance.fees.manage",
        "remove_structure_item": "finance.fees.manage",
        "upsert_structure_items": "finance.fees.manage",
        "create_scholarship": "finance.scholarships.manage",
        "update_scholarship": "finance.scholarships.manage",
        "delete_scholarship": "finance.scholarships.manage",
        "list_carry_forward": "finance.invoices.view",
        "get_carry_forward_summary": "finance.invoices.view",
        "add_carry_forward": "finance.invoices.manage",
        "edit_carry_forward": "finance.invoices.manage",
        "delete_carry_forward": "finance.invoices.manage",
    }

    if action not in required_permissions:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid action. Use "
                "create_invoice|generate_fees_invoice|generate_fees_invoice_v2|record_payment|update_policy|"
                "create_fee_category|update_fee_category|delete_fee_category|"
                "create_fee_item|update_fee_item|delete_fee_item|"
                "create_fee_structure|update_fee_structure|delete_fee_structure|"
                "add_structure_item|remove_structure_item|upsert_structure_items|"
                "create_scholarship|update_scholarship|delete_scholarship"
            ),
        )

    perms = _request_permissions(request)
    needed = required_permissions[action]
    if needed not in perms:
        raise HTTPException(status_code=403, detail=f"Missing permission: {needed}")

    try:
        data: Any

        if action == "create_invoice":
            invoice_type = str(payload.get("invoice_type") or "").strip()
            enrollment_id = _parse_uuid(payload.get("enrollment_id"), field="payload.enrollment_id")
            lines_raw = payload.get("lines")
            if not isinstance(lines_raw, list) or len(lines_raw) == 0:
                raise HTTPException(status_code=400, detail="payload.lines is required")

            lines: list[dict[str, Any]] = []
            for idx, line in enumerate(lines_raw):
                if not isinstance(line, dict):
                    raise HTTPException(
                        status_code=400,
                        detail=f"payload.lines[{idx}] must be an object",
                    )
                description = str(line.get("description") or "").strip()
                if not description:
                    raise HTTPException(
                        status_code=400,
                        detail=f"payload.lines[{idx}].description is required",
                    )
                lines.append(
                    {
                        "description": description,
                        "amount": _parse_decimal(
                            line.get("amount"),
                            field=f"payload.lines[{idx}].amount",
                        ),
                        "meta": line.get("meta"),
                    }
                )

            row = finance_service.create_invoice(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                invoice_type=invoice_type,
                enrollment_id=enrollment_id,
                lines=lines,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_invoice(row)

        elif action == "generate_fees_invoice":
            enrollment_id = _parse_uuid(payload.get("enrollment_id"), field="payload.enrollment_id")
            class_code = str(payload.get("class_code") or "").strip()
            if not class_code:
                raise HTTPException(status_code=400, detail="payload.class_code is required")
            term_code_raw = payload.get("term_code")
            term_code = str(term_code_raw).strip() if term_code_raw not in (None, "") else None

            scholarship_raw = payload.get("scholarship_id")
            scholarship_id = None
            scholarship_amount = None
            scholarship_reason = None
            if scholarship_raw not in (None, ""):
                scholarship_id = _parse_uuid(
                    scholarship_raw,
                    field="payload.scholarship_id",
                )
                scholarship_amount = _parse_decimal(
                    payload.get("scholarship_amount"),
                    field="payload.scholarship_amount",
                )
                scholarship_reason_raw = payload.get("scholarship_reason")
                scholarship_reason = (
                    str(scholarship_reason_raw).strip()
                    if scholarship_reason_raw not in (None, "")
                    else None
                )

            row = finance_service.generate_school_fees_invoice_from_structure(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                enrollment_id=enrollment_id,
                class_code=class_code,
                term_code=term_code,
                scholarship_id=scholarship_id,
                scholarship_amount=scholarship_amount,
                scholarship_reason=scholarship_reason,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_invoice(row)

        elif action == "generate_fees_invoice_v2":
            enrollment_id = _parse_uuid(payload.get("enrollment_id"), field="payload.enrollment_id")
            term_number_raw = payload.get("term_number")
            try:
                term_number = int(term_number_raw)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="payload.term_number must be 1, 2, or 3")
            academic_year_raw = payload.get("academic_year")
            try:
                invoice_academic_year = int(academic_year_raw)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="payload.academic_year must be an integer")

            v2_scholarship_raw = payload.get("scholarship_id")
            v2_scholarship_id = None
            v2_scholarship_amount = None
            v2_scholarship_reason = None
            if v2_scholarship_raw not in (None, ""):
                v2_scholarship_id = _parse_uuid(v2_scholarship_raw, field="payload.scholarship_id")
                v2_scholarship_amount = _parse_decimal(
                    payload.get("scholarship_amount"),
                    field="payload.scholarship_amount",
                )
                v2_scholarship_reason_raw = payload.get("scholarship_reason")
                v2_scholarship_reason = (
                    str(v2_scholarship_reason_raw).strip()
                    if v2_scholarship_reason_raw not in (None, "")
                    else None
                )

            include_cf = bool(payload.get("include_carry_forward", False))
            row = finance_service.generate_school_fees_invoice_v2(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                enrollment_id=enrollment_id,
                term_number=term_number,
                academic_year=invoice_academic_year,
                scholarship_id=v2_scholarship_id,
                scholarship_amount=v2_scholarship_amount,
                scholarship_reason=v2_scholarship_reason,
                include_carry_forward=include_cf,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_invoice(row)

        elif action == "record_payment":
            provider = str(payload.get("provider") or "").strip()
            amount = _parse_decimal(payload.get("amount"), field="payload.amount")
            reference_raw = payload.get("reference")
            reference = str(reference_raw).strip() if reference_raw not in (None, "") else None

            allocations_raw = payload.get("allocations")
            if not isinstance(allocations_raw, list) or len(allocations_raw) == 0:
                raise HTTPException(status_code=400, detail="payload.allocations is required")

            allocations: list[dict[str, Any]] = []
            for idx, row in enumerate(allocations_raw):
                if not isinstance(row, dict):
                    raise HTTPException(
                        status_code=400,
                        detail=f"payload.allocations[{idx}] must be an object",
                    )
                allocations.append(
                    {
                        "invoice_id": _parse_uuid(
                            row.get("invoice_id"),
                            field=f"payload.allocations[{idx}].invoice_id",
                        ),
                        "amount": _parse_decimal(
                            row.get("amount"),
                            field=f"payload.allocations[{idx}].amount",
                        ),
                    }
                )

            payment = finance_service.create_payment(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                provider=provider,
                reference=reference,
                amount=amount,
                allocations=allocations,
            )
            db.commit()
            db.refresh(payment)
            data = {
                "id": str(payment.id),
                "provider": str(payment.provider),
                "reference": payment.reference,
                "amount": str(payment.amount),
            }

        elif action == "update_policy":
            row = finance_service.upsert_policy(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                data=payload,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_finance_policy(row)

        elif action == "create_fee_category":
            row = finance_service.create_fee_category(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                code=str(payload.get("code") or ""),
                name=str(payload.get("name") or ""),
                is_active=bool(payload.get("is_active", True)),
            )
            db.commit()
            db.refresh(row)
            data = _serialize_fee_category(row)

        elif action == "update_fee_category":
            category_id = _parse_uuid(payload.get("category_id"), field="payload.category_id")
            updates = payload.get("updates")
            if not isinstance(updates, dict):
                raise HTTPException(status_code=400, detail="payload.updates is required")
            row = finance_service.update_fee_category(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                category_id=category_id,
                updates=updates,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_fee_category(row)

        elif action == "delete_fee_category":
            category_id = _parse_uuid(payload.get("category_id"), field="payload.category_id")
            finance_service.delete_fee_category(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                category_id=category_id,
            )
            db.commit()
            data = {"ok": True}

        elif action == "create_fee_item":
            row = finance_service.create_fee_item(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                category_id=_parse_uuid(payload.get("category_id"), field="payload.category_id"),
                code=str(payload.get("code") or ""),
                name=str(payload.get("name") or ""),
                is_active=bool(payload.get("is_active", True)),
            )
            db.commit()
            db.refresh(row)
            data = _serialize_fee_item(row)

        elif action == "update_fee_item":
            item_id = _parse_uuid(payload.get("item_id"), field="payload.item_id")
            updates = payload.get("updates")
            if not isinstance(updates, dict):
                raise HTTPException(status_code=400, detail="payload.updates is required")
            if "category_id" in updates and updates["category_id"] not in (None, ""):
                updates["category_id"] = _parse_uuid(updates["category_id"], field="payload.updates.category_id")
            row = finance_service.update_fee_item(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                item_id=item_id,
                updates=updates,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_fee_item(row)

        elif action == "delete_fee_item":
            item_id = _parse_uuid(payload.get("item_id"), field="payload.item_id")
            finance_service.delete_fee_item(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                item_id=item_id,
            )
            db.commit()
            data = {"ok": True}

        elif action == "create_fee_structure":
            academic_year_raw = payload.get("academic_year")
            try:
                academic_year_int = int(academic_year_raw)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="payload.academic_year must be an integer")
            student_type_val = str(payload.get("student_type") or "RETURNING").upper()
            if student_type_val not in ("NEW", "RETURNING"):
                raise HTTPException(status_code=400, detail="payload.student_type must be NEW or RETURNING")
            row = finance_service.create_fee_structure(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                class_code=str(payload.get("class_code") or ""),
                academic_year=academic_year_int,
                student_type=student_type_val,
                name=str(payload.get("name") or ""),
                is_active=bool(payload.get("is_active", True)),
            )
            db.commit()
            db.refresh(row)
            data = _serialize_fee_structure(row)

        elif action == "update_fee_structure":
            structure_id = _parse_uuid(payload.get("structure_id"), field="payload.structure_id")
            updates = payload.get("updates")
            if not isinstance(updates, dict):
                raise HTTPException(status_code=400, detail="payload.updates is required")
            row = finance_service.update_fee_structure(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                structure_id=structure_id,
                updates=updates,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_fee_structure(row)

        elif action == "delete_fee_structure":
            structure_id = _parse_uuid(payload.get("structure_id"), field="payload.structure_id")
            finance_service.delete_fee_structure(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                structure_id=structure_id,
            )
            db.commit()
            data = {"ok": True}

        elif action == "add_structure_item":
            structure_id = _parse_uuid(payload.get("structure_id"), field="payload.structure_id")
            item = payload.get("item")
            if not isinstance(item, dict):
                raise HTTPException(status_code=400, detail="payload.item is required")

            normalized_item = dict(item)
            if normalized_item.get("fee_item_id") not in (None, ""):
                normalized_item["fee_item_id"] = _parse_uuid(
                    normalized_item.get("fee_item_id"),
                    field="payload.item.fee_item_id",
                )
            if isinstance(normalized_item.get("fee_item"), dict):
                fee_item_payload = dict(normalized_item["fee_item"])
                fee_item_payload["category_id"] = _parse_uuid(
                    fee_item_payload.get("category_id"),
                    field="payload.item.fee_item.category_id",
                )
                normalized_item["fee_item"] = fee_item_payload

            normalized_item["term_1_amount"] = _parse_decimal(
                normalized_item.get("term_1_amount"),
                field="payload.item.term_1_amount",
            )
            normalized_item["term_2_amount"] = _parse_decimal(
                normalized_item.get("term_2_amount"),
                field="payload.item.term_2_amount",
            )
            normalized_item["term_3_amount"] = _parse_decimal(
                normalized_item.get("term_3_amount"),
                field="payload.item.term_3_amount",
            )

            row = finance_service.add_or_update_structure_item(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                structure_id=structure_id,
                item=normalized_item,
            )
            db.commit()
            data = _serialize_structure_item(row)

        elif action == "remove_structure_item":
            structure_id = _parse_uuid(payload.get("structure_id"), field="payload.structure_id")
            fee_item_id = _parse_uuid(payload.get("fee_item_id"), field="payload.fee_item_id")
            finance_service.remove_structure_item(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                structure_id=structure_id,
                fee_item_id=fee_item_id,
            )
            db.commit()
            data = {"ok": True}

        elif action == "upsert_structure_items":
            structure_id = _parse_uuid(payload.get("structure_id"), field="payload.structure_id")
            items_raw = payload.get("items")
            if not isinstance(items_raw, list):
                raise HTTPException(status_code=400, detail="payload.items must be an array")

            items: list[dict[str, Any]] = []
            for idx, item in enumerate(items_raw):
                if not isinstance(item, dict):
                    raise HTTPException(
                        status_code=400,
                        detail=f"payload.items[{idx}] must be an object",
                    )
                items.append(
                    {
                        "fee_item_id": _parse_uuid(
                            item.get("fee_item_id"),
                            field=f"payload.items[{idx}].fee_item_id",
                        ),
                        "term_1_amount": _parse_decimal(
                            item.get("term_1_amount"),
                            field=f"payload.items[{idx}].term_1_amount",
                        ),
                        "term_2_amount": _parse_decimal(
                            item.get("term_2_amount"),
                            field=f"payload.items[{idx}].term_2_amount",
                        ),
                        "term_3_amount": _parse_decimal(
                            item.get("term_3_amount"),
                            field=f"payload.items[{idx}].term_3_amount",
                        ),
                    }
                )

            finance_service.upsert_fee_structure_items(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                structure_id=structure_id,
                items=items,
            )
            db.commit()
            data = {"ok": True}

        elif action == "create_scholarship":
            row = finance_service.create_scholarship(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                name=str(payload.get("name") or ""),
                type_=str(payload.get("type") or ""),
                value=_parse_decimal(payload.get("value"), field="payload.value"),
                is_active=bool(payload.get("is_active", True)),
            )
            db.commit()
            db.refresh(row)
            data = _serialize_scholarship(row)

        elif action == "update_scholarship":
            scholarship_id = _parse_uuid(payload.get("scholarship_id"), field="payload.scholarship_id")
            updates = payload.get("updates")
            if not isinstance(updates, dict):
                raise HTTPException(status_code=400, detail="payload.updates is required")
            row = finance_service.update_scholarship(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                scholarship_id=scholarship_id,
                updates=updates,
            )
            db.commit()
            db.refresh(row)
            data = _serialize_scholarship(row)

        elif action == "delete_scholarship":
            scholarship_id = _parse_uuid(payload.get("scholarship_id"), field="payload.scholarship_id")
            finance_service.delete_scholarship(
                db,
                tenant_id=tenant.id,
                actor_user_id=user.id,
                scholarship_id=scholarship_id,
            )
            db.commit()
            data = {"ok": True}

        elif action == "list_carry_forward":
            student_id = _parse_uuid(payload.get("student_id"), field="payload.student_id")
            items = finance_service.list_carry_forward(db, tenant_id=tenant.id, student_id=student_id)
            data = {"items": items}

        elif action == "get_carry_forward_summary":
            student_id = _parse_uuid(payload.get("student_id"), field="payload.student_id")
            data = finance_service.get_carry_forward_summary(db, tenant_id=tenant.id, student_id=student_id)

        elif action == "add_carry_forward":
            student_id = _parse_uuid(payload.get("student_id"), field="payload.student_id")
            term_label_raw = str(payload.get("term_label") or "").strip()
            if not term_label_raw:
                raise HTTPException(status_code=400, detail="payload.term_label is required")
            amount = _parse_decimal(payload.get("amount"), field="payload.amount")
            academic_year_raw = payload.get("academic_year")
            term_number_raw = payload.get("term_number")
            try:
                cf_academic_year = int(academic_year_raw) if academic_year_raw not in (None, "") else None
            except (TypeError, ValueError):
                cf_academic_year = None
            try:
                cf_term_number = int(term_number_raw) if term_number_raw not in (None, "") else None
            except (TypeError, ValueError):
                cf_term_number = None
            description_raw = payload.get("description")
            description = str(description_raw).strip() if description_raw not in (None, "") else None
            data = finance_service.add_carry_forward(
                db,
                tenant_id=tenant.id,
                student_id=student_id,
                actor_user_id=user.id,
                term_label=term_label_raw,
                academic_year=cf_academic_year,
                term_number=cf_term_number,
                amount=amount,
                description=description,
            )
            db.commit()

        elif action == "edit_carry_forward":
            balance_id = _parse_uuid(payload.get("balance_id"), field="payload.balance_id")
            amount_raw = payload.get("amount")
            edit_amount = _parse_decimal(amount_raw, field="payload.amount") if amount_raw not in (None, "") else None
            term_label_raw = payload.get("term_label")
            edit_term_label = str(term_label_raw).strip() if term_label_raw not in (None, "") else None
            description_raw = payload.get("description")
            edit_description = str(description_raw) if description_raw is not None else None
            data = finance_service.edit_carry_forward(
                db,
                tenant_id=tenant.id,
                balance_id=balance_id,
                amount=edit_amount,
                term_label=edit_term_label,
                description=edit_description,
            )
            db.commit()

        elif action == "delete_carry_forward":
            balance_id = _parse_uuid(payload.get("balance_id"), field="payload.balance_id")
            finance_service.delete_carry_forward(db, tenant_id=tenant.id, balance_id=balance_id)
            db.commit()
            data = {"ok": True}

        else:
            raise HTTPException(status_code=400, detail="Unhandled action")

        return {"ok": True, "data": data}

    except HTTPException:
        db.rollback()
        raise
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Finance action failed")


# ---------------------------------------------------------------------
# Director endpoints (tenant-safe)
# ---------------------------------------------------------------------

@router.get(
    "/director/finance",
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.policy.view",
                "finance.fees.view",
                "finance.invoices.view",
                "finance.payments.view",
                "finance.scholarships.view",
            )
        )
    ],
)
@router.get(
    "/director/finance/setup",
    dependencies=[
        Depends(
            _require_any_permission(
                "admin.dashboard.view_tenant",
                "finance.policy.view",
                "finance.fees.view",
                "finance.invoices.view",
                "finance.payments.view",
                "finance.scholarships.view",
            )
        )
    ],
)
def director_finance(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    return secretary_finance(request=request, db=db, tenant=tenant, _user=_user)


@router.put(
    "/director/finance/policy",
    dependencies=[Depends(require_permission("finance.policy.manage"))],
)
def director_finance_policy_update(
    payload: dict,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    from app.api.v1.finance import service as finance_service

    row = finance_service.upsert_policy(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        data=payload,
    )
    db.commit()
    db.refresh(row)
    return _serialize_finance_policy(row)


@router.get(
    "/director/finance/policy/structure",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "finance.policy.view"))],
)
def director_finance_structure_policy_list(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    fee_structure_id: UUID | None = Query(default=None),
):
    from app.api.v1.finance import service as finance_service

    rows = finance_service.list_fee_structure_policies(
        db,
        tenant_id=tenant.id,
        fee_structure_id=fee_structure_id,
    )
    return [_serialize_structure_policy(r) for r in rows]


@router.put(
    "/director/finance/policy/structure",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "finance.policy.manage"))],
)
def director_finance_structure_policy_upsert(
    payload: dict,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    fee_structure_id = _parse_uuid(
        payload.get("fee_structure_id"),
        field="payload.fee_structure_id",
    )
    fee_item_raw = payload.get("fee_item_id")
    fee_item_id = (
        _parse_uuid(fee_item_raw, field="payload.fee_item_id")
        if fee_item_raw not in (None, "")
        else None
    )

    min_percent_raw = payload.get("min_percent_to_enroll")
    min_percent = None
    if min_percent_raw not in (None, ""):
        try:
            min_percent = int(min_percent_raw)
        except Exception:
            raise HTTPException(status_code=400, detail="payload.min_percent_to_enroll must be an integer")
        if min_percent < 0 or min_percent > 100:
            raise HTTPException(status_code=400, detail="payload.min_percent_to_enroll must be between 0 and 100")

    min_amount_raw = payload.get("min_amount_to_enroll")
    min_amount = (
        _parse_decimal(min_amount_raw, field="payload.min_amount_to_enroll")
        if min_amount_raw not in (None, "")
        else None
    )

    from app.api.v1.finance import service as finance_service

    row = finance_service.upsert_fee_structure_policy(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        fee_structure_id=fee_structure_id,
        fee_item_id=fee_item_id,
        allow_partial_enrollment=bool(payload.get("allow_partial_enrollment", False)),
        min_percent_to_enroll=min_percent,
        min_amount_to_enroll=min_amount,
    )
    db.commit()
    db.refresh(row)
    return _serialize_structure_policy(row)


@router.delete(
    "/director/finance/policy/structure",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "finance.policy.manage"))],
)
def director_finance_structure_policy_delete(
    payload: dict,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    fee_structure_id = _parse_uuid(
        payload.get("fee_structure_id"),
        field="payload.fee_structure_id",
    )
    fee_item_raw = payload.get("fee_item_id")
    fee_item_id = (
        _parse_uuid(fee_item_raw, field="payload.fee_item_id")
        if fee_item_raw not in (None, "")
        else None
    )

    from app.api.v1.finance import service as finance_service

    finance_service.delete_fee_structure_policy(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        fee_structure_id=fee_structure_id,
        fee_item_id=fee_item_id,
    )
    db.commit()
    return {"ok": True}


@router.get(
    "/director/users",
    response_model=list[DirectorUserOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def director_users(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    return _director_user_payloads(
        db,
        tenant_id=tenant.id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/director/roles",
    response_model=dict[str, list[DirectorRoleOut]],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "rbac.roles.manage"))],
)
def director_roles(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    roles = db.execute(
        select(Role)
        .where(
            sa.or_(Role.tenant_id.is_(None), Role.tenant_id == tenant.id),
            sa.func.upper(Role.code) != "SUPER_ADMIN",
        )
        .order_by(Role.code.asc(), Role.name.asc())
    ).scalars().all()
    payload = [
        DirectorRoleOut(
            id=str(role.id),
            code=str(role.code),
            name=str(role.name),
            description=(str(role.description) if role.description is not None else None),
        ).model_dump()
        for role in roles
    ]
    return {"roles": payload}


@router.get(
    "/director/users/staff-candidates",
    response_model=list[DirectorStaffCandidateOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def director_user_staff_candidates(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    table_name, cols = _resolve_existing_table(db, candidates=TENANT_STAFF_TABLE_CANDIDATES)
    if not table_name:
        return []

    role_code_expr = (
        "s.role_code"
        if "role_code" in cols
        else "CAST(NULL AS TEXT) AS role_code"
    )
    sep_status_expr = (
        "s.separation_status"
        if "separation_status" in cols
        else "CAST(NULL AS TEXT) AS separation_status"
    )

    rows = db.execute(
        sa.text(
            f"""
            SELECT
                s.id AS staff_id,
                s.staff_no,
                s.staff_type,
                {role_code_expr},
                s.first_name,
                s.last_name,
                s.email,
                COALESCE(s.is_active, true) AS is_active,
                {sep_status_expr},
                u.id AS user_id,
                CASE WHEN ut.user_id IS NULL THEN false ELSE true END AS has_account
            FROM {table_name} s
            LEFT JOIN core.users u
              ON LOWER(u.email) = LOWER(s.email)
            LEFT JOIN core.user_tenants ut
              ON ut.user_id = u.id
             AND ut.tenant_id = :tenant_id
             AND ut.is_active = true
            WHERE s.tenant_id = :tenant_id
              AND COALESCE(s.is_active, true) = true
              AND s.email IS NOT NULL
              AND BTRIM(s.email) <> ''
            ORDER BY s.last_name ASC, s.first_name ASC, s.staff_no ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        {"tenant_id": str(tenant.id), "limit": int(limit), "offset": int(offset)},
    ).mappings().all()

    payload: list[DirectorStaffCandidateOut] = []
    for row in rows:
        separation_status = _text_or_none(row.get("separation_status"), upper=True)
        if separation_status in {"FIRED_MISCONDUCT", "LEFT_PERMANENTLY"}:
            continue

        role_code = _text_or_none(row.get("role_code"), upper=True)
        if role_code and _is_restricted_tenant_role_code(role_code):
            role_code = None

        first_name = _text_or_none(row.get("first_name")) or ""
        last_name = _text_or_none(row.get("last_name")) or ""
        full_name = _staff_full_name(first_name, last_name)
        email = _normalized_email(row.get("email"))
        if not email:
            continue

        payload.append(
            DirectorStaffCandidateOut(
                staff_id=str(row.get("staff_id") or ""),
                staff_no=str(row.get("staff_no") or ""),
                full_name=full_name,
                email=email,
                staff_type=str(row.get("staff_type") or ""),
                role_code=role_code,
                has_account=bool(row.get("has_account", False)),
                user_id=(str(row.get("user_id")) if row.get("user_id") else None),
            )
        )
    return payload


@router.post(
    "/director/users/credentials",
    response_model=DirectorUserCredentialOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def director_user_credentials_create_or_reset(
    payload: DirectorUserCredentialIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    password = _validated_password(payload.password)

    staff_id = _parse_uuid(payload.staff_id, field="payload.staff_id")
    table_name, cols = _resolve_existing_table(db, candidates=TENANT_STAFF_TABLE_CANDIDATES)
    if not table_name:
        raise HTTPException(
            status_code=503,
            detail="Staff registry storage is not configured. Run database migrations.",
        )

    role_code_expr = (
        "role_code"
        if "role_code" in cols
        else "CAST(NULL AS TEXT) AS role_code"
    )
    staff_row = db.execute(
        sa.text(
            f"""
            SELECT id, staff_no, staff_type, first_name, last_name, email, phone, {role_code_expr},
                   COALESCE(is_active, true) AS is_active
            FROM {table_name}
            WHERE id = :staff_id AND tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"staff_id": str(staff_id), "tenant_id": str(tenant.id)},
    ).mappings().first()
    if not staff_row:
        raise HTTPException(status_code=404, detail="Staff record not found")
    if not bool(staff_row.get("is_active", True)):
        raise HTTPException(status_code=400, detail="Cannot create credentials for inactive staff")

    email = _normalized_email(staff_row.get("email"))
    if not email:
        raise HTTPException(
            status_code=400,
            detail="Staff email is required before creating login credentials",
        )

    first_name = _text_or_none(staff_row.get("first_name")) or ""
    last_name = _text_or_none(staff_row.get("last_name")) or ""
    full_name = _staff_full_name(first_name, last_name)
    phone = _text_or_none(staff_row.get("phone"))

    requested_role_code = _text_or_none(payload.role_code, upper=True)
    role_code = requested_role_code
    if role_code is None:
        role_code = _text_or_none(staff_row.get("role_code"), upper=True)
    if role_code is not None and _is_restricted_tenant_role_code(role_code):
        if requested_role_code is not None:
            _ensure_director_assignable_role(role_code)
        role_code = None
    if role_code is not None:
        _ensure_director_assignable_role(role_code)

    existing_user = db.execute(
        select(User).where(sa.func.lower(User.email) == email)
    ).scalar_one_or_none()

    existing_membership: UserTenant | None = None
    if existing_user is not None:
        existing_membership = db.execute(
            select(UserTenant).where(
                UserTenant.tenant_id == tenant.id,
                UserTenant.user_id == existing_user.id,
            )
        ).scalar_one_or_none()

        if existing_membership is None:
            active_other_membership = db.execute(
                select(UserTenant.id).where(
                    UserTenant.user_id == existing_user.id,
                    UserTenant.tenant_id != tenant.id,
                    UserTenant.is_active == True,
                )
                .limit(1)
            ).first()
            if active_other_membership:
                raise HTTPException(
                    status_code=409,
                    detail="Email is already used by an account in another tenant. Use a tenant-specific staff email.",
                )

    created_user = False
    if existing_user is None:
        existing_user = User(
            id=uuid4(),
            email=email,
            password_hash=hash_password(password),
            full_name=full_name or None,
            phone=phone,
            is_active=True,
        )
        db.add(existing_user)
        created_user = True
    else:
        existing_user.password_hash = hash_password(password)
        if not existing_user.full_name and full_name:
            existing_user.full_name = full_name
        if not existing_user.phone and phone:
            existing_user.phone = phone
        existing_user.is_active = True

    db.flush()

    membership = existing_membership
    membership_created = False
    if membership is None:
        db.add(
            UserTenant(
                id=uuid4(),
                tenant_id=tenant.id,
                user_id=existing_user.id,
                is_active=True,
            )
        )
        membership_created = True
    elif not bool(membership.is_active):
        membership.is_active = True

    role_assigned = False
    assigned_role_code: str | None = None
    if role_code:
        role = _get_role_by_code(db, tenant_id=tenant.id, role_code=role_code)
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")
        _ensure_director_assignable_role(str(role.code))

        existing_assignment = db.execute(
            select(UserRole).where(
                UserRole.user_id == existing_user.id,
                UserRole.tenant_id == tenant.id,
                UserRole.role_id == role.id,
            )
        ).scalar_one_or_none()
        if existing_assignment is None:
            db.add(
                UserRole(
                    id=uuid4(),
                    tenant_id=tenant.id,
                    user_id=existing_user.id,
                    role_id=role.id,
                )
            )
            role_assigned = True
        assigned_role_code = str(role.code)

    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=_user.id,
        action="tenant_user.credentials.upsert",
        resource="user",
        resource_id=existing_user.id,
        payload={
            "staff_id": str(staff_row.get("id") or ""),
            "email": str(existing_user.email),
            "role_code": assigned_role_code,
            "created_user": created_user,
            "membership_created": membership_created,
            "role_assigned": role_assigned,
        },
        request=request,
    )
    db.commit()

    return DirectorUserCredentialOut(
        user_id=str(existing_user.id),
        staff_id=str(staff_row.get("id")),
        email=str(existing_user.email),
        full_name=(str(existing_user.full_name) if existing_user.full_name else None),
        role_code=assigned_role_code,
        created_user=created_user,
        updated_password=True,
        membership_created=membership_created,
        role_assigned=role_assigned,
    )


@router.post(
    "/director/users/roles",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def director_user_role_action(
    payload: DirectorUserRoleActionIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    user_id = _parse_uuid(payload.user_id, field="payload.user_id")
    role_code = payload.role_code.strip().upper()
    _ensure_director_assignable_role(role_code)

    if payload.mode == "assign":
        assign_user_role(
            user_id=user_id,
            payload=UserRoleAssign(role_code=role_code),
            request=request,
            db=db,
            tenant=tenant,
            _user=_user,
        )
    else:
        remove_user_role(
            user_id=user_id,
            role_code=role_code,
            request=request,
            db=db,
            tenant=tenant,
            _user=_user,
        )
    return {"ok": True}


@router.patch(
    "/director/users/{user_id}",
    response_model=DirectorUserOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def director_user_update(
    user_id: str,
    payload: DirectorUserUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    target_user_id = _parse_uuid(user_id, field="user_id")
    _ensure_user_in_tenant(
        db,
        tenant_id=tenant.id,
        user_id=target_user_id,
        include_inactive=True,
    )

    fields_set = set(payload.model_fields_set)
    if not fields_set:
        rows = _director_user_payloads(db, tenant_id=tenant.id, user_ids=[target_user_id])
        if not rows:
            raise HTTPException(status_code=404, detail="User not found")
        return rows[0]

    user_row = db.execute(
        select(User, UserTenant)
        .select_from(UserTenant)
        .join(User, User.id == UserTenant.user_id)
        .where(
            UserTenant.tenant_id == tenant.id,
            UserTenant.user_id == target_user_id,
        )
        .limit(1)
    ).first()
    if not user_row:
        raise HTTPException(status_code=404, detail="User not found")

    target_user: User = user_row[0]
    membership: UserTenant = user_row[1]

    if "is_active" in fields_set and payload.is_active is False and target_user_id == _user.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own tenant access.")

    if _director_user_has_role(db, tenant_id=tenant.id, user_id=target_user_id, role_code="DIRECTOR"):
        last_director_count = _count_active_tenant_users_for_role(
            db,
            tenant_id=tenant.id,
            role_code="DIRECTOR",
        )
        if "is_active" in fields_set and payload.is_active is False and last_director_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="At least one active director must remain assigned to this tenant.",
            )

    if "full_name" in fields_set:
        target_user.full_name = _text_or_none(payload.full_name)

    if "email" in fields_set:
        email = _normalized_email(payload.email)
        if not email:
            raise HTTPException(status_code=400, detail="Email is required")

        duplicate_user = db.execute(
            select(User.id)
            .where(
                sa.func.lower(User.email) == email,
                User.id != target_user_id,
            )
            .limit(1)
        ).first()
        if duplicate_user:
            raise HTTPException(status_code=409, detail="Email is already in use.")

        has_other_active_membership = db.execute(
            select(UserTenant.id)
            .where(
                UserTenant.user_id == target_user_id,
                UserTenant.tenant_id != tenant.id,
                UserTenant.is_active == True,
            )
            .limit(1)
        ).first()
        if has_other_active_membership:
            raise HTTPException(
                status_code=409,
                detail="Cannot change email for a user with active access in another tenant.",
            )

        current_email = str(target_user.email)
        target_user.email = email
        _sync_staff_registry_email_for_user(
            db,
            tenant_id=tenant.id,
            current_email=current_email,
            next_email=email,
        )

    if "password" in fields_set:
        if payload.password is None:
            raise HTTPException(status_code=400, detail="Password cannot be null")
        target_user.password_hash = hash_password(_validated_password(payload.password))
        target_user.is_active = True

    if "is_active" in fields_set and payload.is_active is not None:
        membership.is_active = payload.is_active
        if payload.is_active:
            target_user.is_active = True
        else:
            has_other_active_membership = db.execute(
                select(UserTenant.id)
                .where(
                    UserTenant.user_id == target_user_id,
                    UserTenant.tenant_id != tenant.id,
                    UserTenant.is_active == True,
                )
                .limit(1)
            ).first()
            if not has_other_active_membership:
                target_user.is_active = False

    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=_user.id,
        action="tenant_user.update",
        resource="user",
        resource_id=target_user.id,
        payload={
            "user_id": str(target_user.id),
            "updated_fields": sorted(fields_set),
            "email": str(target_user.email),
            "full_name": target_user.full_name,
            "is_active": bool(membership.is_active),
        },
        request=request,
    )
    db.commit()
    rows = _director_user_payloads(db, tenant_id=tenant.id, user_ids=[target_user_id])
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")
    return rows[0]


@router.delete(
    "/director/users/{user_id}",
    response_model=DirectorUserDeleteOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "users.manage"))],
)
def director_user_delete(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    target_user_id = _parse_uuid(user_id, field="user_id")
    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=target_user_id)

    if target_user_id == _user.id:
        raise HTTPException(status_code=400, detail="You cannot remove your own tenant access.")

    if _director_user_has_role(db, tenant_id=tenant.id, user_id=target_user_id, role_code="DIRECTOR"):
        if _count_active_tenant_users_for_role(db, tenant_id=tenant.id, role_code="DIRECTOR") <= 1:
            raise HTTPException(
                status_code=400,
                detail="At least one active director must remain assigned to this tenant.",
            )

    user_row = db.execute(
        select(User, UserTenant)
        .select_from(UserTenant)
        .join(User, User.id == UserTenant.user_id)
        .where(
            UserTenant.tenant_id == tenant.id,
            UserTenant.user_id == target_user_id,
        )
        .limit(1)
    ).first()
    if not user_row:
        raise HTTPException(status_code=404, detail="User not found")

    target_user: User = user_row[0]
    membership: UserTenant = user_row[1]
    membership.is_active = False

    roles_removed = db.execute(
        sa.delete(UserRole).where(
            UserRole.tenant_id == tenant.id,
            UserRole.user_id == target_user_id,
        )
    ).rowcount or 0
    overrides_removed = db.execute(
        sa.delete(UserPermissionOverride).where(
            UserPermissionOverride.tenant_id == tenant.id,
            UserPermissionOverride.user_id == target_user_id,
        )
    ).rowcount or 0

    has_other_active_membership = db.execute(
        select(UserTenant.id)
        .where(
            UserTenant.user_id == target_user_id,
            UserTenant.tenant_id != tenant.id,
            UserTenant.is_active == True,
        )
        .limit(1)
    ).first()
    user_deactivated = False
    if not has_other_active_membership:
        target_user.is_active = False
        user_deactivated = True

    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=_user.id,
        action="tenant_user.remove_access",
        resource="user",
        resource_id=target_user.id,
        payload={
            "user_id": str(target_user.id),
            "email": str(target_user.email),
            "membership_deactivated": True,
            "user_deactivated": user_deactivated,
            "roles_removed": int(roles_removed),
            "overrides_removed": int(overrides_removed),
        },
        request=request,
    )
    db.commit()
    return DirectorUserDeleteOut(
        ok=True,
        user_id=str(target_user_id),
        membership_deactivated=True,
        user_deactivated=user_deactivated,
        roles_removed=int(roles_removed),
        overrides_removed=int(overrides_removed),
    )


@router.get(
    "/director/audit",
    response_model=list[SecretaryAuditOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "audit.read"))],
)
def director_audit(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    try:
        return secretary_audit(db=db, tenant=tenant, _user=_user, limit=limit, offset=offset)
    except Exception:
        # Director dashboard must not fail if audit logging is unavailable.
        return []


@router.get(
    "/director/rbac/permissions",
    response_model=list[DirectorPermissionOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "rbac.permissions.manage"))],
)
def director_rbac_permissions(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    # Tenant dependency is required for context isolation, even though permissions are global.
    _ = tenant
    perms = db.execute(select(Permission).order_by(Permission.code.asc())).scalars().all()
    return _permission_rows_payload(perms)


@router.get(
    "/director/rbac/overrides",
    response_model=list[DirectorPermissionOverrideOut],
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "rbac.user_permissions.manage"))],
)
def director_rbac_overrides(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    rows = db.execute(
        select(
            UserPermissionOverride.user_id,
            User.email,
            User.full_name,
            Permission.code,
            UserPermissionOverride.effect,
            UserPermissionOverride.reason,
        )
        .select_from(UserPermissionOverride)
        .join(Permission, Permission.id == UserPermissionOverride.permission_id)
        .join(User, User.id == UserPermissionOverride.user_id)
        .join(
            UserTenant,
            and_(
                UserTenant.tenant_id == tenant.id,
                UserTenant.user_id == UserPermissionOverride.user_id,
                UserTenant.is_active == True,
            ),
        )
        .where(UserPermissionOverride.tenant_id == tenant.id)
        .order_by(
            UserPermissionOverride.created_at.desc(),
            User.email.asc(),
            Permission.code.asc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()

    return [
        DirectorPermissionOverrideOut(
            user_id=str(r[0]),
            email=str(r[1]),
            full_name=(str(r[2]) if r[2] is not None else None),
            permission_code=str(r[3]),
            effect=str(r[4]),
            reason=(str(r[5]) if r[5] is not None else None),
        )
        for r in rows
    ]


@router.post(
    "/director/rbac/overrides",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "rbac.user_permissions.manage"))],
)
def director_rbac_override_upsert(
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    user_id = _parse_uuid(payload.get("user_id"), field="payload.user_id")
    permission_code = str(payload.get("permission_code") or "").strip()
    effect = str(payload.get("effect") or "").upper().strip()
    reason_raw = payload.get("reason")
    reason = str(reason_raw).strip() if reason_raw not in (None, "") else None

    if not permission_code:
        raise HTTPException(status_code=400, detail="payload.permission_code is required")
    if effect not in {"ALLOW", "DENY"}:
        raise HTTPException(status_code=400, detail="payload.effect must be ALLOW or DENY")

    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    permission = db.execute(
        select(Permission).where(Permission.code == permission_code)
    ).scalar_one_or_none()
    if not permission:
        raise HTTPException(status_code=404, detail="Permission not found")

    row = db.execute(
        select(UserPermissionOverride).where(
            UserPermissionOverride.tenant_id == tenant.id,
            UserPermissionOverride.user_id == user_id,
            UserPermissionOverride.permission_id == permission.id,
        )
    ).scalar_one_or_none()

    if row:
        row.effect = effect
        row.reason = reason
    else:
        db.add(
            UserPermissionOverride(
                id=uuid4(),
                tenant_id=tenant.id,
                user_id=user_id,
                permission_id=permission.id,
                effect=effect,
                reason=reason,
            )
        )

    _audit_tenant_change_best_effort(
        db,
        tenant_id=tenant.id,
        actor_user_id=_user.id,
        action="rbac.user_permission_override.upsert",
        resource="user_permission_override",
        resource_id=None,
        payload={
            "user_id": str(user_id),
            "permission_code": permission.code,
            "effect": effect,
            "reason": reason,
        },
        request=request,
    )
    db.commit()
    return {"ok": True}


@router.delete(
    "/director/rbac/overrides",
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "rbac.user_permissions.manage"))],
)
def director_rbac_override_delete(
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")

    user_id = _parse_uuid(payload.get("user_id"), field="payload.user_id")
    permission_code = str(payload.get("permission_code") or "").strip()
    if not permission_code:
        raise HTTPException(status_code=400, detail="payload.permission_code is required")

    _ensure_user_in_tenant(db, tenant_id=tenant.id, user_id=user_id)

    permission = db.execute(
        select(Permission).where(Permission.code == permission_code)
    ).scalar_one_or_none()
    if not permission:
        raise HTTPException(status_code=404, detail="Permission not found")

    removed = db.execute(
        sa.delete(UserPermissionOverride).where(
            UserPermissionOverride.tenant_id == tenant.id,
            UserPermissionOverride.user_id == user_id,
            UserPermissionOverride.permission_id == permission.id,
        )
    ).rowcount or 0
    if removed:
        _audit_tenant_change_best_effort(
            db,
            tenant_id=tenant.id,
            actor_user_id=_user.id,
            action="rbac.user_permission_override.delete",
            resource="user_permission_override",
            resource_id=None,
            payload={
                "user_id": str(user_id),
                "permission_code": permission.code,
                "removed_count": int(removed),
            },
            request=request,
        )
    db.commit()
    return {"ok": True}


@router.get(
    "/principal/dashboard",
    response_model=PrincipalDashboardOut,
    dependencies=[Depends(_require_any_permission("admin.dashboard.view_tenant", "enrollment.manage"))],
)
def principal_dashboard(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """
    Principal / Head Teacher academic summary endpoint.

    Enterprise behavior:
    - One aggregated payload for principal dashboard data.
    - Tenant-scoped and permission-gated.
    - Best-effort: each section degrades independently and never blocks the full payload.
    """
    me = {
        "user": {
            "id": str(getattr(user, "id", "") or ""),
            "email": str(getattr(user, "email", "") or ""),
            "full_name": (str(getattr(user, "full_name")) if getattr(user, "full_name", None) else None),
        },
        "tenant": {
            "id": str(getattr(tenant, "id", "") or ""),
            "slug": str(getattr(tenant, "slug", "") or ""),
            "name": str(getattr(tenant, "name", "") or ""),
        },
        "roles": sorted(_request_roles(request)),
        "permissions": sorted(_request_permissions(request)),
    }

    health = {
        "summary": False,
        "enrollments": False,
        "exams": False,
        "events": False,
        "teacher_assignments": False,
        "timetable_entries": False,
        "notifications": False,
    }

    enrollments: list[dict[str, Any]] = []
    exams: list[TenantExamOut] = []
    events: list[TenantEventOut] = []
    teacher_assignments: list[TeacherAssignmentOut] = []
    timetable_entries: list[TenantSchoolTimetableOut] = []
    notifications: list[TenantNotificationOut] = []
    unread_notifications = 0

    total_users = 0
    total_roles = 0
    total_audit_logs = 0

    try:
        value = db.execute(
            select(sa.func.count())
            .select_from(UserTenant)
            .where(
                UserTenant.tenant_id == tenant.id,
                UserTenant.is_active == True,
            )
        ).scalar()
        total_users = int(value or 0)

        value = db.execute(
            select(sa.func.count(sa.distinct(Role.code)))
            .select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .join(
                UserTenant,
                and_(
                    UserTenant.user_id == UserRole.user_id,
                    UserTenant.tenant_id == tenant.id,
                    UserTenant.is_active == True,
                ),
            )
            .where(
                sa.or_(
                    UserRole.tenant_id == tenant.id,
                    UserRole.tenant_id.is_(None),
                )
            )
        ).scalar()
        total_roles = int(value or 0)

        try:
            from app.models.audit_log import AuditLog  # type: ignore

            value = db.execute(
                select(sa.func.count())
                .select_from(AuditLog)
                .where(AuditLog.tenant_id == tenant.id)
            ).scalar()
            total_audit_logs = int(value or 0)
        except Exception:
            total_audit_logs = 0

        health["summary"] = True
    except Exception:
        db.rollback()
        total_users = 0
        total_roles = 0
        total_audit_logs = 0

    try:
        enrollment_rows, table_name = _read_rows_first_table(
            db,
            table_candidates=ENROLLMENT_TABLE_CANDIDATES,
            sql_template="""
                SELECT id, status, payload
                FROM {table}
                WHERE tenant_id = :tenant_id
                ORDER BY id DESC
                LIMIT :limit OFFSET :offset
            """,
            params={
                "tenant_id": str(tenant.id),
                "limit": 500,
                "offset": 0,
            },
        )
        enrollments = [
            {
                "id": str(row.get("id") or ""),
                "status": str(row.get("status") or ""),
                "payload": _safe_payload_obj(row.get("payload")),
            }
            for row in enrollment_rows
            if row.get("id") is not None
        ]
        health["enrollments"] = bool(table_name)
    except Exception:
        db.rollback()
        enrollments = []

    try:
        exam_rows = _query_tenant_exams(
            db,
            tenant_id=tenant.id,
            include_inactive=True,
            limit=500,
            offset=0,
        )
        term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
        subject_lookup = _subject_lookup_for_tenant(db, tenant_id=tenant.id)
        staff_lookup = _staff_lookup_for_tenant(db, tenant_id=tenant.id)
        exams = [
            _serialize_exam_row(
                row,
                term_lookup=term_lookup,
                subject_lookup=subject_lookup,
                staff_lookup=staff_lookup,
            )
            for row in exam_rows
        ]
        health["exams"] = True
    except Exception:
        db.rollback()
        exams = []

    try:
        event_rows = _query_tenant_events(
            db,
            tenant_id=tenant.id,
            include_inactive=True,
            limit=500,
            offset=0,
        )
        event_ids = [str(row.get("id") or "") for row in event_rows if row.get("id") is not None]
        event_class_map, event_student_map = _event_target_maps(
            db,
            tenant_id=tenant.id,
            event_ids=event_ids,
        )
        enrollment_ids = sorted({sid for ids in event_student_map.values() for sid in ids})
        enrollment_name_lookup = _enrollment_name_lookup_by_ids(
            db,
            tenant_id=tenant.id,
            enrollment_ids=enrollment_ids,
        )
        term_lookup = _term_lookup_for_tenant(db, tenant_id=tenant.id)
        events = [
            _serialize_event_row(
                row,
                term_lookup=term_lookup,
                event_class_map=event_class_map,
                event_student_map=event_student_map,
                enrollment_name_lookup=enrollment_name_lookup,
            )
            for row in event_rows
        ]
        health["events"] = True
    except Exception:
        db.rollback()
        events = []

    try:
        teacher_assignments = list_teacher_assignments(
            db=db,
            tenant=tenant,
            _user=user,
            class_code=None,
            staff_id=None,
            subject_id=None,
            include_inactive=True,
            limit=500,
            offset=0,
        )
        health["teacher_assignments"] = True
    except Exception:
        db.rollback()
        teacher_assignments = []

    try:
        timetable_entries = list_tenant_school_timetable(
            db=db,
            tenant=tenant,
            _user=user,
            term_id=None,
            class_code=None,
            day_of_week=None,
            slot_type=None,
            include_inactive=True,
            limit=1000,
            offset=0,
        )
        health["timetable_entries"] = True
    except Exception:
        db.rollback()
        timetable_entries = []

    try:
        current_user_id = _parse_uuid(getattr(user, "id", None), field="current_user.id")
        notification_rows = _collect_tenant_notifications(
            db,
            tenant_id=tenant.id,
            user_id=current_user_id,
            limit=500,
        )
        notification_rows = _apply_notification_read_state(
            db,
            tenant_id=tenant.id,
            user_id=current_user_id,
            notifications=notification_rows,
        )
        unread_notifications = sum(1 for row in notification_rows if bool(getattr(row, "unread", False)))
        notifications = notification_rows[:50]
        health["notifications"] = True
    except Exception:
        db.rollback()
        notifications = []
        unread_notifications = 0

    active_statuses = {"ENROLLED", "APPROVED", "ENROLLED_PARTIAL"}
    total_students = sum(
        1
        for row in enrollments
        if str(row.get("status") or "").strip().upper() in active_statuses
    )

    summary = {
        "total_users": int(total_users),
        "total_roles": int(total_roles),
        "total_audit_logs": int(total_audit_logs),
        "total_students": int(total_students),
        "total_exams": int(len(exams)),
        "total_events": int(len(events)),
        "total_teacher_assignments": int(len(teacher_assignments)),
        "total_timetable_entries": int(len(timetable_entries)),
        "unread_notifications": int(unread_notifications),
    }

    return PrincipalDashboardOut(
        me=me,
        summary=summary,
        enrollments=enrollments,
        exams=exams,
        events=events,
        teacher_assignments=teacher_assignments,
        timetable_entries=timetable_entries,
        notifications=notifications,
        unread_notifications=int(unread_notifications),
        health=health,
    )


@router.get(
    "/secretary/dashboard",
    response_model=SecretaryDashboardOut,
    dependencies=[Depends(require_permission("admin.dashboard.view_tenant"))],
)
def secretary_dashboard(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """
    Secretary dashboard aggregate endpoint.
    """
    me = {
        "tenant": {"slug": tenant.slug, "name": tenant.name},
        "roles": (getattr(user, "roles", None) or []),
    }

    users = secretary_users(db=db, tenant=tenant, _user=user, limit=100, offset=0)

    try:
        audit = secretary_audit(db=db, tenant=tenant, _user=user, limit=8, offset=0)
    except Exception:
        audit = []

    enrollments: list[dict] = []
    invoices: list[dict] = []

    # Best-effort enrollments
    try:
        from app.models.enrollment import Enrollment  # type: ignore

        ers = db.execute(
            select(Enrollment)
            .where(Enrollment.tenant_id == tenant.id)
            .order_by(Enrollment.created_at.desc())
            .limit(8)
        ).scalars().all()

        enrollments = [
            {
                "id": str(e.id),
                "status": str(getattr(e, "status", "")),
                "payload": getattr(e, "payload", None),
            }
            for e in ers
        ]
    except Exception:
        enrollments = []

    # Best-effort invoices
    try:
        from app.models.finance import Invoice  # type: ignore

        invs = db.execute(
            select(Invoice)
            .where(Invoice.tenant_id == tenant.id)
            .order_by(Invoice.created_at.desc())
            .limit(10)
        ).scalars().all()

        invoices = [
            {
                "id": str(i.id),
                "invoice_type": str(getattr(i, "invoice_type", "")),
                "status": str(getattr(i, "status", "")),
                "total_amount": getattr(i, "total_amount", 0),
                "paid_amount": getattr(i, "paid_amount", 0),
                "balance_amount": getattr(i, "balance_amount", 0),
            }
            for i in invs
        ]
    except Exception:
        invoices = []

    summary = {
        "total_users": len(users),
        "total_roles": 0,
        "total_audit_logs": len(audit),
    }

    health = {"api": True}

    return SecretaryDashboardOut(
        me=me,
        summary=summary,
        enrollments=enrollments,
        invoices=invoices,
        users=users,
        audit=audit,
        health=health,
    )
