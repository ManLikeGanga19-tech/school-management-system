"""Pydantic schemas for the SIS students API."""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Student bio-data ──────────────────────────────────────────────────────────

class StudentBiodataUpdate(BaseModel):
    first_name:           Optional[str] = Field(default=None, min_length=1, max_length=120)
    last_name:            Optional[str] = Field(default=None, min_length=1, max_length=120)
    other_names:          Optional[str] = Field(default=None, max_length=120)
    gender:               Optional[str] = Field(default=None, max_length=20)
    date_of_birth:        Optional[str] = Field(default=None)          # ISO date string
    phone:                Optional[str] = Field(default=None, max_length=50)
    email:                Optional[str] = Field(default=None, max_length=200)
    nationality:          Optional[str] = Field(default=None, max_length=80)
    religion:             Optional[str] = Field(default=None, max_length=80)
    home_address:         Optional[str] = Field(default=None)
    county:               Optional[str] = Field(default=None, max_length=80)
    sub_county:           Optional[str] = Field(default=None, max_length=80)
    upi:                  Optional[str] = Field(default=None, max_length=100)
    birth_certificate_no: Optional[str] = Field(default=None, max_length=100)
    previous_school:      Optional[str] = Field(default=None, max_length=200)
    previous_class:       Optional[str] = Field(default=None, max_length=80)


class StudentOut(BaseModel):
    id:                   str
    tenant_id:            str
    admission_no:         str
    first_name:           str
    last_name:            str
    other_names:          Optional[str]
    gender:               Optional[str]
    date_of_birth:        Optional[str]
    status:               str
    phone:                Optional[str]
    email:                Optional[str]
    nationality:          Optional[str]
    religion:             Optional[str]
    home_address:         Optional[str]
    county:               Optional[str]
    sub_county:           Optional[str]
    upi:                  Optional[str]
    birth_certificate_no: Optional[str]
    previous_school:      Optional[str]
    previous_class:       Optional[str]
    created_at:           Optional[str]
    updated_at:           Optional[str]


# ── Guardian (parent) ─────────────────────────────────────────────────────────

class GuardianContactUpdate(BaseModel):
    first_name: Optional[str] = Field(default=None, max_length=120)
    last_name:  Optional[str] = Field(default=None, max_length=120)
    phone:      Optional[str] = Field(default=None, max_length=50)
    phone_alt:  Optional[str] = Field(default=None, max_length=50)
    email:      Optional[str] = Field(default=None, max_length=200)
    id_type:    Optional[str] = Field(default=None, max_length=30)
    address:    Optional[str] = Field(default=None)
    occupation: Optional[str] = Field(default=None, max_length=120)


class GuardianOut(BaseModel):
    id:           str
    relationship: str
    first_name:   Optional[str]
    last_name:    Optional[str]
    phone:        Optional[str]
    phone_alt:    Optional[str]
    email:        Optional[str]
    id_type:      Optional[str]
    national_id:  Optional[str]
    occupation:   Optional[str]
    address:      Optional[str]
    is_active:    bool


# ── Emergency contacts ────────────────────────────────────────────────────────

class EmergencyContactCreate(BaseModel):
    name:         str  = Field(..., min_length=1, max_length=120)
    relationship: Optional[str] = Field(default=None, max_length=80)
    phone:        str  = Field(..., min_length=7, max_length=50)
    phone_alt:    Optional[str] = Field(default=None, max_length=50)
    email:        Optional[str] = Field(default=None, max_length=200)
    is_primary:   bool = False
    notes:        Optional[str] = Field(default=None, max_length=500)


class EmergencyContactUpdate(BaseModel):
    name:         Optional[str] = Field(default=None, min_length=1, max_length=120)
    relationship: Optional[str] = Field(default=None, max_length=80)
    phone:        Optional[str] = Field(default=None, min_length=7, max_length=50)
    phone_alt:    Optional[str] = Field(default=None, max_length=50)
    email:        Optional[str] = Field(default=None, max_length=200)
    is_primary:   Optional[bool] = None
    notes:        Optional[str] = Field(default=None, max_length=500)


class EmergencyContactOut(BaseModel):
    id:           str
    student_id:   str
    name:         str
    relationship: Optional[str]
    phone:        str
    phone_alt:    Optional[str]
    email:        Optional[str]
    is_primary:   bool
    notes:        Optional[str]
    created_at:   Optional[str]
    updated_at:   Optional[str]


# ── Student documents ─────────────────────────────────────────────────────────

_VALID_DOC_TYPES = {
    "BIRTH_CERTIFICATE", "TRANSFER_LETTER", "NEMIS_REPORT",
    "ID_COPY", "MEDICAL_CERT", "OTHER",
}


class StudentDocumentCreate(BaseModel):
    document_type: str  = Field(..., max_length=80)
    title:         Optional[str] = Field(default=None, max_length=200)
    file_url:      str  = Field(..., min_length=4)
    storage_key:   Optional[str] = Field(default=None)
    content_type:  Optional[str] = Field(default=None, max_length=100)
    size_bytes:    Optional[int] = Field(default=None, ge=0)
    notes:         Optional[str] = Field(default=None, max_length=500)


class StudentDocumentOut(BaseModel):
    id:            str
    student_id:    str
    document_type: str
    title:         Optional[str]
    file_url:      str
    storage_key:   Optional[str]
    content_type:  Optional[str]
    size_bytes:    Optional[int]
    notes:         Optional[str]
    uploaded_by:   Optional[str]
    uploaded_at:   Optional[str]
