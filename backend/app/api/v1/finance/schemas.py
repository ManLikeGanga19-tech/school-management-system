from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal, Optional, List, Dict, Any
from uuid import UUID
from decimal import Decimal


class ORMOutModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# -------------------------
# Policy
# -------------------------
class FinancePolicyUpsert(BaseModel):
    allow_partial_enrollment: bool = False
    min_percent_to_enroll: Optional[int] = Field(default=None, ge=0, le=100)
    min_amount_to_enroll: Optional[Decimal] = None
    require_interview_fee_before_submit: bool = False


class FinancePolicyOut(ORMOutModel, FinancePolicyUpsert):
    id: UUID
    tenant_id: UUID


# -------------------------
# Fee Catalog
# -------------------------
class FeeCategoryCreate(BaseModel):
    code: str
    name: str
    is_active: bool = True


class FeeCategoryOut(ORMOutModel, FeeCategoryCreate):
    id: UUID


class FeeCategoryUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


class FeeItemCreate(BaseModel):
    category_id: UUID
    code: str
    name: str
    charge_frequency: Literal["PER_TERM", "ONCE_PER_YEAR", "ONCE_EVER"] = "PER_TERM"
    is_active: bool = True


class FeeItemOut(ORMOutModel, FeeItemCreate):
    id: UUID


class FeeItemUpdate(BaseModel):
    category_id: Optional[UUID] = None
    code: Optional[str] = None
    name: Optional[str] = None
    charge_frequency: Optional[Literal["PER_TERM", "ONCE_PER_YEAR", "ONCE_EVER"]] = None
    is_active: Optional[bool] = None


# -------------------------
# Fee Structure
# -------------------------
class FeeStructureCreate(BaseModel):
    class_code: str
    academic_year: int
    student_type: Literal["NEW", "RETURNING"]
    name: str
    is_active: bool = True


class FeeStructureUpdate(BaseModel):
    class_code: Optional[str] = None
    academic_year: Optional[int] = None
    student_type: Optional[Literal["NEW", "RETURNING"]] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


class FeeStructureOut(ORMOutModel):
    id: UUID
    class_code: str
    academic_year: int
    student_type: str
    name: str
    is_active: bool
    structure_no: Optional[str] = None


class FeeStructureItemUpsert(BaseModel):
    fee_item_id: UUID
    term_1_amount: Decimal
    term_2_amount: Decimal
    term_3_amount: Decimal


class FeeStructureItemInlineFeeItem(BaseModel):
    category_id: UUID
    code: str
    name: str
    charge_frequency: Literal["PER_TERM", "ONCE_PER_YEAR", "ONCE_EVER"] = "PER_TERM"
    is_active: bool = True


class FeeStructureItemAdd(BaseModel):
    term_1_amount: Decimal
    term_2_amount: Decimal
    term_3_amount: Decimal
    fee_item_id: Optional[UUID] = None
    fee_item: Optional[FeeStructureItemInlineFeeItem] = None

    @model_validator(mode="after")
    def validate_item_source(self):
        has_fee_item_id = self.fee_item_id is not None
        has_inline_item = self.fee_item is not None
        if has_fee_item_id == has_inline_item:
            raise ValueError("Provide exactly one of fee_item_id or fee_item payload")
        return self


class FeeStructureItemOut(BaseModel):
    fee_item_id: UUID
    term_1_amount: Decimal
    term_2_amount: Decimal
    term_3_amount: Decimal
    charge_frequency: str
    fee_item_code: str
    fee_item_name: str
    category_id: UUID
    category_code: str
    category_name: str


class FeeStructureWithItemsOut(FeeStructureOut):
    items: List[FeeStructureItemOut] = Field(default_factory=list)


# -------------------------
# Scholarships
# -------------------------
class ScholarshipCreate(BaseModel):
    name: str
    type: str  # PERCENTAGE|FIXED
    value: Decimal
    max_recipients: Optional[int] = None  # if set, value / max_recipients = per-student amount
    description: Optional[str] = None
    is_active: bool = True


class ScholarshipOut(ORMOutModel, ScholarshipCreate):
    id: UUID


class ScholarshipUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    value: Optional[Decimal] = None
    max_recipients: Optional[int] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class ScholarshipAllocationOut(BaseModel):
    allocation_id: str
    student_name: str
    admission_no: str
    amount: str
    reason: str
    invoice_no: str
    enrollment_id: Optional[str] = None
    student_id: Optional[str] = None
    created_at: Optional[str] = None


# -------------------------
# Invoices
# -------------------------
class InvoiceLineIn(BaseModel):
    description: str
    amount: Decimal
    meta: Optional[Dict[str, Any]] = None


class InvoiceCreate(BaseModel):
    invoice_type: str  # INTERVIEW|SCHOOL_FEES
    enrollment_id: UUID
    lines: List[InvoiceLineIn] = Field(default_factory=list)


class InvoiceOut(ORMOutModel):
    id: UUID
    tenant_id: UUID
    invoice_no: Optional[str] = None
    invoice_type: str
    status: str
    enrollment_id: Optional[UUID] = None
    term_number: Optional[int] = None
    academic_year: Optional[int] = None
    student_type_snapshot: Optional[str] = None
    currency: str
    total_amount: Decimal
    paid_amount: Decimal
    balance_amount: Decimal
    # Stashed by _recalc_invoice_amounts whenever the invoice has bundled
    # carry-forward arrears. Lets the UI split "Previous balance" vs current term
    # without needing line-level payment tracking. Absent if no arrears bundled.
    meta: Optional[Dict[str, Any]] = None


# -------------------------
# Generate Fee Invoice from Structure (+ optional scholarship)
# -------------------------
class GenerateFeesInvoiceRequest(BaseModel):
    enrollment_id: UUID
    class_code: str
    term_code: Optional[str] = None
    scholarship_id: Optional[UUID] = None
    scholarship_amount: Optional[Decimal] = None
    scholarship_reason: Optional[str] = None


class GenerateFeesInvoiceV2Request(BaseModel):
    enrollment_id: UUID
    term_number: int = Field(..., ge=1, le=3)
    academic_year: int = Field(..., ge=2000, le=2100)
    scholarship_id: Optional[UUID] = None
    scholarship_amount: Optional[Decimal] = None
    scholarship_reason: Optional[str] = None
    # Default True: open balance adjustments (arrears or credits) for the
    # student are always rolled into the new invoice as a single 'Arrears
    # (Brought Forward)' line. Match the service-level default; the UI no
    # longer exposes a checkbox.
    include_carry_forward: bool = True
    force_student_type: Optional[Literal["NEW", "RETURNING"]] = None


# -------------------------
# Structure-level / item-level policy
# -------------------------
class FinanceStructurePolicyUpsert(BaseModel):
    fee_structure_id: UUID
    fee_item_id: Optional[UUID] = None
    allow_partial_enrollment: bool = False
    min_percent_to_enroll: Optional[int] = Field(default=None, ge=0, le=100)
    min_amount_to_enroll: Optional[Decimal] = None


class FinanceStructurePolicyOut(ORMOutModel):
    id: UUID
    tenant_id: UUID
    fee_structure_id: UUID
    fee_item_id: Optional[UUID] = None
    allow_partial_enrollment: bool
    min_percent_to_enroll: Optional[int] = None
    min_amount_to_enroll: Optional[Decimal] = None


# -------------------------
# Payments
# -------------------------
class PaymentAllocationIn(BaseModel):
    invoice_id: UUID
    amount: Decimal


class PaymentCreate(BaseModel):
    provider: str  # CASH|MPESA|BANK|CHEQUE
    reference: Optional[str] = None
    amount: Decimal
    allocations: List[PaymentAllocationIn]


class PaymentOut(ORMOutModel):
    id: UUID
    tenant_id: UUID
    receipt_no: Optional[str] = None
    provider: str
    reference: Optional[str] = None
    amount: Decimal


class PaymentAllocationOut(BaseModel):
    invoice_id: UUID
    amount: Decimal


class PaymentWithAllocationsOut(PaymentOut):
    allocations: List[PaymentAllocationOut] = Field(default_factory=list)


# -------------------------
# Record Payment by Student (smart auto-allocation)
# -------------------------
class StudentPaymentSummaryInvoiceOut(BaseModel):
    invoice_id: UUID
    invoice_no: Optional[str] = None
    invoice_type: str
    status: str
    term_number: Optional[int] = None
    academic_year: Optional[int] = None
    total_amount: Decimal
    paid_amount: Decimal
    balance_amount: Decimal


class StudentPaymentSummaryOut(BaseModel):
    """Snapshot of what the student owes (or is credited) right now, used by
    the by-student record-payment view to render the breakdown."""
    student_id: UUID
    student_name: str
    admission_no: Optional[str] = None
    class_code: Optional[str] = None
    pending_balance_net: Decimal     # open carry-forward net (signed)
    pending_balance_debit: Decimal   # sum of open debits (positive)
    pending_balance_credit: Decimal  # sum of open credits (negative)
    current_term_total: Decimal      # sum of CURRENT-term invoice totals
    current_term_paid: Decimal
    current_term_balance: Decimal
    prior_terms_balance: Decimal     # sum of outstanding from OLDER terms
    total_outstanding: Decimal       # net the parent should pay now
    invoices: List[StudentPaymentSummaryInvoiceOut] = Field(default_factory=list)


class StudentPaymentRecordRequest(BaseModel):
    """Body for POST /finance/students/{student_id}/payments.

    Allocation is automatic: oldest unpaid school-fees invoice first, then
    current term; surplus becomes an OVERPAYMENT_CREDIT carry-forward on the
    student. provider/reference behave the same as on the manual endpoint.
    """
    amount: Decimal
    provider: str
    reference: Optional[str] = None


class StudentPaymentRecordAllocationOut(BaseModel):
    invoice_id: UUID
    invoice_no: Optional[str] = None
    term_number: Optional[int] = None
    academic_year: Optional[int] = None
    amount: Decimal


class StudentPaymentRecordOut(BaseModel):
    payment_id: UUID
    receipt_no: Optional[str] = None
    amount: Decimal
    allocated_total: Decimal
    surplus_credit: Decimal
    credit_balance_id: Optional[UUID] = None
    allocations: List[StudentPaymentRecordAllocationOut] = Field(default_factory=list)


# -------------------------
# Family Record Payment (multi-student, single receipt)
# -------------------------
class ParentPaymentSummaryOut(BaseModel):
    """All of a parent's children's payment summaries + family rollup. Used by
    the by-parent record-payment view so the secretary sees the whole family
    on one screen and records one Payment for the whole transaction."""
    parent_id: UUID
    parent_name: str
    children: List[StudentPaymentSummaryOut] = Field(default_factory=list)
    family_total_outstanding: Decimal


class FamilyPerStudentAllocationIn(BaseModel):
    """Manual-mode per-student split. Each amount is allocated FIFO inside that
    student's open invoices on the server."""
    student_id: UUID
    amount: Decimal


class ParentPaymentRecordRequest(BaseModel):
    """Body for POST /finance/parents/{parent_id}/payments.

    mode controls allocation:
      - "auto": one amount is FIFO-allocated across the UNION of the family's
        open school-fees invoices, oldest term first across all children.
      - "manual": per_student_allocations[] is required. Each (student_id,
        amount) is FIFO-allocated inside that student's invoices. Each amount
        must not exceed the student's outstanding (no silent overflow to
        siblings — that would re-create the ambiguity we just killed).

    credit_to_student_id is required whenever a surplus would result (auto
    surplus when amount > family total; manual surplus when per-student sum <
    amount).
    """
    amount: Decimal
    provider: str
    reference: Optional[str] = None
    mode: str = "auto"
    per_student_allocations: Optional[List[FamilyPerStudentAllocationIn]] = None
    credit_to_student_id: Optional[UUID] = None


class FamilyAllocationLineOut(BaseModel):
    invoice_id: UUID
    invoice_no: Optional[str] = None
    student_id: UUID
    student_name: str
    term_number: Optional[int] = None
    academic_year: Optional[int] = None
    amount: Decimal


class FamilyStudentBreakdownOut(BaseModel):
    student_id: UUID
    student_name: str
    admission_no: Optional[str] = None
    class_code: Optional[str] = None
    subtotal: Decimal
    allocations: List[FamilyAllocationLineOut] = Field(default_factory=list)


class ParentPaymentRecordOut(BaseModel):
    payment_id: UUID
    receipt_no: Optional[str] = None
    amount: Decimal
    allocated_total: Decimal
    surplus_credit: Decimal
    credit_balance_id: Optional[UUID] = None
    credit_to_student_id: Optional[UUID] = None
    credit_to_student_name: Optional[str] = None
    students: List[FamilyStudentBreakdownOut] = Field(default_factory=list)


# -------------------------
# Paginated list responses
# -------------------------
class PageMeta(BaseModel):
    total: int
    page: int
    page_size: int
    pages: int


class InvoicePageOut(BaseModel):
    items: List[InvoiceOut]
    meta: PageMeta


class PaymentPageOut(BaseModel):
    items: List[PaymentWithAllocationsOut]
    meta: PageMeta


# -------------------------
# Tenant Payment Settings
# -------------------------
class TenantPaymentSettingsUpsert(BaseModel):
    mpesa_paybill: Optional[str] = None
    mpesa_business_no: Optional[str] = None
    mpesa_account_format: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_branch: Optional[str] = None
    cash_payment_instructions: Optional[str] = None
    uniform_details_text: Optional[str] = None
    uniform_details_text_jss: Optional[str] = None
    assessment_books_amount: Optional[Decimal] = None
    assessment_books_note: Optional[str] = None
    remedial_fee_amount: Optional[Decimal] = None


class TenantPaymentSettingsOut(ORMOutModel, TenantPaymentSettingsUpsert):
    id: UUID
    tenant_id: UUID

