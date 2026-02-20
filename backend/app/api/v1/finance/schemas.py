from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Optional, List, Dict, Any
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
    require_interview_fee_before_submit: bool = True


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


class FeeItemCreate(BaseModel):
    category_id: UUID
    code: str
    name: str
    is_active: bool = True


class FeeItemOut(ORMOutModel, FeeItemCreate):
    id: UUID


# -------------------------
# Fee Structure
# -------------------------
class FeeStructureCreate(BaseModel):
    class_code: str
    name: str
    is_active: bool = True


class FeeStructureUpdate(BaseModel):
    class_code: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


class FeeStructureOut(ORMOutModel, FeeStructureCreate):
    id: UUID


class FeeStructureItemUpsert(BaseModel):
    fee_item_id: UUID
    amount: Decimal


class FeeStructureItemInlineFeeItem(BaseModel):
    category_id: UUID
    code: str
    name: str
    is_active: bool = True


class FeeStructureItemAdd(BaseModel):
    amount: Decimal
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
    amount: Decimal
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
    type: str  # PERCENT|FIXED
    value: Decimal
    is_active: bool = True


class ScholarshipOut(ORMOutModel, ScholarshipCreate):
    id: UUID


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
    invoice_type: str
    status: str
    enrollment_id: Optional[UUID] = None
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
    scholarship_id: Optional[UUID] = None


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
    provider: str
    reference: Optional[str] = None
    amount: Decimal


class PaymentAllocationOut(BaseModel):
    invoice_id: UUID
    amount: Decimal


class PaymentWithAllocationsOut(PaymentOut):
    allocations: List[PaymentAllocationOut] = Field(default_factory=list)
