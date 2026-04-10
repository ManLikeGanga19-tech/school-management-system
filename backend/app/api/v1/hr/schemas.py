"""Pydantic schemas for Phase 6 HR module."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

LeaveType = Literal["ANNUAL", "SICK", "MATERNITY", "PATERNITY", "UNPAID", "OTHER"]
LeaveStatus = Literal["PENDING", "APPROVED", "REJECTED", "CANCELLED"]

# ── Leave ──────────────────────────────────────────────────────────────────────

class LeaveRequestIn(BaseModel):
    staff_id: UUID
    leave_type: LeaveType
    start_date: date
    end_date: date
    reason: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def dates_valid(self) -> "LeaveRequestIn":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be >= start_date")
        return self


class LeaveReviewIn(BaseModel):
    status: Literal["APPROVED", "REJECTED"]
    review_note: str | None = Field(default=None, max_length=1000)


class LeaveRequestOut(BaseModel):
    id: str
    staff_id: str
    staff_name: str
    leave_type: str
    start_date: str
    end_date: str
    days_requested: int
    reason: str | None
    status: str
    reviewed_by: str | None
    reviewed_at: str | None
    review_note: str | None
    created_at: str | None


# ── Salary structure ───────────────────────────────────────────────────────────

class SalaryStructureIn(BaseModel):
    basic_salary: Decimal = Field(..., ge=0, decimal_places=2)
    house_allowance: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    transport_allowance: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    other_allowances: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    helb_deduction: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    loan_deduction: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    effective_from: date
    notes: str | None = Field(default=None, max_length=1000)


class SalaryStructureOut(BaseModel):
    id: str
    staff_id: str
    staff_name: str
    basic_salary: float
    house_allowance: float
    transport_allowance: float
    other_allowances: float
    helb_deduction: float
    loan_deduction: float
    gross_pay: float
    effective_from: str
    notes: str | None
    updated_at: str | None


# ── Payslip ────────────────────────────────────────────────────────────────────

class GeneratePayslipsIn(BaseModel):
    pay_month: int = Field(..., ge=1, le=12)
    pay_year: int = Field(..., ge=2020, le=2100)
    staff_ids: list[UUID] | None = Field(
        default=None,
        description="Specific staff to generate for; None = all active staff with salary structure",
    )


class PayslipOut(BaseModel):
    id: str
    staff_id: str
    staff_name: str
    staff_no: str
    pay_month: int
    pay_year: int
    basic_salary: float
    house_allowance: float
    transport_allowance: float
    other_allowances: float
    gross_pay: float
    paye: float
    nhif: float
    nssf_employee: float
    nssf_employer: float
    helb_deduction: float
    loan_deduction: float
    total_deductions: float
    net_pay: float
    generated_at: str


# ── SMS recipients ─────────────────────────────────────────────────────────────

class SmsRecipientOut(BaseModel):
    name: str
    phone: str
    student_name: str
    class_name: str | None
