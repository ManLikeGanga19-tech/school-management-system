from __future__ import annotations

from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ORMOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ─────────────────────────────────────────────
# Parent CRUD
# ─────────────────────────────────────────────

class ParentCreate(BaseModel):
    first_name: str
    last_name: str
    phone: str
    email: Optional[str] = None
    phone_alt: Optional[str] = None
    national_id: Optional[str] = None
    occupation: Optional[str] = None
    address: Optional[str] = None


class ParentUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    phone_alt: Optional[str] = None
    national_id: Optional[str] = None
    occupation: Optional[str] = None
    address: Optional[str] = None


# ─────────────────────────────────────────────
# Enrollment linking
# ─────────────────────────────────────────────

class LinkEnrollmentRequest(BaseModel):
    enrollment_id: UUID
    relationship: str = "GUARDIAN"
    is_primary: bool = False


# ─────────────────────────────────────────────
# Response shapes
# ─────────────────────────────────────────────

class LinkedChildOut(BaseModel):
    link_id: str
    enrollment_id: str
    student_name: str
    class_code: str
    admission_number: Optional[str] = None
    relationship: str
    is_primary: bool
    outstanding: Decimal = Decimal("0")


class ParentListItem(BaseModel):
    id: str
    name: str
    phone: str
    email: Optional[str] = None
    child_count: int = 0
    outstanding_total: Decimal = Decimal("0")
    has_portal_access: bool = False


class ParentDetail(BaseModel):
    id: str
    first_name: str
    last_name: str
    name: str
    phone: str
    email: Optional[str] = None
    phone_alt: Optional[str] = None
    national_id: Optional[str] = None
    occupation: Optional[str] = None
    address: Optional[str] = None
    has_portal_access: bool = False
    children: List[LinkedChildOut] = Field(default_factory=list)
    outstanding_total: Decimal = Decimal("0")


class ParentInvoiceOut(BaseModel):
    invoice_id: str
    enrollment_id: str
    student_name: str
    invoice_type: str
    invoice_no: Optional[str] = None
    status: str
    total_amount: Decimal
    paid_amount: Decimal
    balance_amount: Decimal


class DistributionLine(BaseModel):
    invoice_id: str
    enrollment_id: str
    student_name: str
    invoice_type: str
    amount: Decimal


class PaymentPreviewOut(BaseModel):
    total: Decimal
    lines: List[DistributionLine]
    unallocated: Decimal


# ─────────────────────────────────────────────
# Bulk payment
# ─────────────────────────────────────────────

class ParentPaymentAllocation(BaseModel):
    invoice_id: UUID
    amount: Decimal


class ParentBulkPayment(BaseModel):
    provider: str               # CASH | MPESA | BANK | CHEQUE
    reference: Optional[str] = None
    amount: Decimal
    allocations: List[ParentPaymentAllocation]


# ─────────────────────────────────────────────
# Sync
# ─────────────────────────────────────────────

class SyncResult(BaseModel):
    created: int = 0
    linked: int = 0
    already_existed: int = 0
    skipped_no_phone: int = 0


# ─────────────────────────────────────────────
# Parent portal tokens
# ─────────────────────────────────────────────

class PortalTokenCreate(BaseModel):
    label: Optional[str] = Field(default=None, max_length=160)


class PortalTokenOut(BaseModel):
    id: str
    label: Optional[str] = None
    is_active: bool
    expires_at: Optional[str] = None
    last_used_at: Optional[str] = None
    created_at: str


class PortalTokenCreated(PortalTokenOut):
    raw_token: str
    school_slug: str


class PortalSmsRequest(BaseModel):
    portal_base_url: str = Field(min_length=1, max_length=255)
    label: Optional[str] = Field(default=None, max_length=160)


# ─────────────────────────────────────────────
# Public portal resolution
# ─────────────────────────────────────────────

class PortalChildGradeOut(BaseModel):
    subject: str
    strand: Optional[str] = None
    sub_strand: Optional[str] = None
    grade: Optional[str] = None
    comments: Optional[str] = None


class PortalInvoiceOut(BaseModel):
    id: str
    invoice_type: str
    term_label: Optional[str] = None
    status: str
    billed: Decimal = Decimal("0")
    paid: Decimal = Decimal("0")
    balance: Decimal = Decimal("0")


class PortalPaymentOut(BaseModel):
    id: str
    date: str
    provider: str
    reference: Optional[str] = None
    amount: Decimal = Decimal("0")


class PortalAttendanceOut(BaseModel):
    date: str
    status: str


class PortalIncidentOut(BaseModel):
    id: str
    date: str
    incident_type: str
    title: str
    description: Optional[str] = None
    status: str


class PortalChildOut(BaseModel):
    enrollment_id: str
    student_name: str
    admission_number: Optional[str] = None
    class_code: str
    class_name: Optional[str] = None
    relationship: str
    outstanding: Decimal = Decimal("0")
    grades: List[PortalChildGradeOut] = Field(default_factory=list)
    invoices: List[PortalInvoiceOut] = Field(default_factory=list)
    payments: List[PortalPaymentOut] = Field(default_factory=list)
    attendance: List[PortalAttendanceOut] = Field(default_factory=list)
    incidents: List[PortalIncidentOut] = Field(default_factory=list)


class PortalResolveOut(BaseModel):
    parent_id: str
    parent_name: str
    school_name: str
    school_slug: str
    children: List[PortalChildOut] = Field(default_factory=list)
