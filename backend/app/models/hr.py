"""ORM models for Phase 6 HR module (leave, salary, payslips)."""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import Column, Date, DateTime, Integer, Numeric, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func, text

from app.core.database import Base


class StaffLeaveRequest(Base):
    __tablename__ = "staff_leave_requests"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    staff_id = Column(UUID(as_uuid=True), nullable=False)
    leave_type = Column(String(50), nullable=False)
    start_date = Column(Date(), nullable=False)
    end_date = Column(Date(), nullable=False)
    days_requested = Column(Integer(), nullable=False)
    reason = Column(Text(), nullable=True)
    status = Column(String(20), nullable=False, server_default=text("'PENDING'"))
    reviewed_by = Column(UUID(as_uuid=True), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    review_note = Column(Text(), nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class StaffSalaryStructure(Base):
    __tablename__ = "staff_salary_structures"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    staff_id = Column(UUID(as_uuid=True), nullable=False, unique=True)
    basic_salary = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    house_allowance = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    transport_allowance = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    other_allowances = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    helb_deduction = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    loan_deduction = Column(Numeric(12, 2), nullable=False, server_default=text("0"))
    effective_from = Column(Date(), nullable=False)
    notes = Column(Text(), nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class StaffPayslip(Base):
    __tablename__ = "staff_payslips"
    __table_args__ = (
        UniqueConstraint("tenant_id", "staff_id", "pay_month", "pay_year",
                         name="uq_staff_payslips_staff_month_year"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    staff_id = Column(UUID(as_uuid=True), nullable=False)
    pay_month = Column(SmallInteger(), nullable=False)
    pay_year = Column(SmallInteger(), nullable=False)
    # Earnings
    basic_salary = Column(Numeric(12, 2), nullable=False)
    house_allowance = Column(Numeric(12, 2), nullable=False)
    transport_allowance = Column(Numeric(12, 2), nullable=False)
    other_allowances = Column(Numeric(12, 2), nullable=False)
    gross_pay = Column(Numeric(12, 2), nullable=False)
    # Statutory deductions
    paye = Column(Numeric(12, 2), nullable=False)
    nhif = Column(Numeric(12, 2), nullable=False)
    nssf_employee = Column(Numeric(12, 2), nullable=False)
    nssf_employer = Column(Numeric(12, 2), nullable=False)
    # Other deductions
    helb_deduction = Column(Numeric(12, 2), nullable=False)
    loan_deduction = Column(Numeric(12, 2), nullable=False)
    total_deductions = Column(Numeric(12, 2), nullable=False)
    net_pay = Column(Numeric(12, 2), nullable=False)
    generated_by = Column(UUID(as_uuid=True), nullable=True)
    generated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
