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
    is_active: bool = True


class ScholarshipOut(ORMOutModel, ScholarshipCreate):
    id: UUID


class ScholarshipUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    value: Optional[Decimal] = None
    is_active: Optional[bool] = None


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
    assessment_books_amount: Optional[Decimal] = None
    assessment_books_note: Optional[str] = None


class TenantPaymentSettingsOut(ORMOutModel, TenantPaymentSettingsUpsert):
    id: UUID
    tenant_id: UUID
