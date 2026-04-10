"""Service layer for Phase 6 HR module (leave, payroll) and SMS recipients."""
from __future__ import annotations

import calendar
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.hr import StaffLeaveRequest, StaffSalaryStructure, StaffPayslip


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Kenya statutory deduction calculators ─────────────────────────────────────

def _calc_paye(gross: Decimal) -> Decimal:
    """PAYE on gross monthly pay (Kenya 2024 tax bands)."""
    bands = [
        (Decimal("24000"), Decimal("0.10")),
        (Decimal("8333"),  Decimal("0.25")),
    ]
    tax = Decimal("0")
    remaining = gross
    for band_size, rate in bands:
        if remaining <= 0:
            break
        taxable = min(remaining, band_size)
        tax += taxable * rate
        remaining -= taxable
    if remaining > 0:
        tax += remaining * Decimal("0.30")
    personal_relief = Decimal("2400")
    return max(Decimal("0"), tax - personal_relief).quantize(Decimal("0.01"))


def _calc_nhif(gross: Decimal) -> Decimal:
    """NHIF contribution (Kenya sliding scale)."""
    bands = [
        (5999,   150), (7999,   300), (11999,  400), (14999,  500),
        (19999,  600), (24999,  750), (29999,  850), (34999,  900),
        (39999, 1000), (44999, 1100), (49999, 1200), (59999, 1300),
        (69999, 1400), (79999, 1500), (89999, 1600), (99999, 1700),
    ]
    g = int(gross)
    for ceiling, amount in bands:
        if g <= ceiling:
            return Decimal(str(amount))
    return Decimal("1700")


def _calc_nssf(gross: Decimal) -> tuple[Decimal, Decimal]:
    """NSSF employee + employer (6% each, capped at KES 2,160)."""
    rate = Decimal("0.06")
    cap = Decimal("2160")
    employee = min(gross * rate, cap).quantize(Decimal("0.01"))
    employer = min(gross * rate, cap).quantize(Decimal("0.01"))
    return employee, employer


# ── Staff lookup helper ────────────────────────────────────────────────────────

def _staff_name(db: Session, staff_id: UUID, tenant_id: UUID) -> str:
    row = db.execute(text("""
        SELECT first_name, last_name
        FROM core.staff_directory
        WHERE id = :id AND tenant_id = :tid
    """), {"id": str(staff_id), "tid": str(tenant_id)}).first()
    if not row:
        return str(staff_id)
    return f"{row.first_name or ''} {row.last_name or ''}".strip()


def _reviewer_name(db: Session, user_id: UUID | None) -> str | None:
    if not user_id:
        return None
    row = db.execute(text("""
        SELECT full_name FROM core.users WHERE id = :id
    """), {"id": str(user_id)}).first()
    return row.full_name if row else str(user_id)


# ── Leave ──────────────────────────────────────────────────────────────────────

def _business_days(start: date, end: date) -> int:
    total = 0
    current = start
    while current <= end:
        if current.weekday() < 5:
            total += 1
        from datetime import timedelta
        current += timedelta(days=1)
    return max(1, total)


def create_leave_request(
    db: Session,
    *,
    tenant_id: UUID,
    staff_id: UUID,
    leave_type: str,
    start_date: date,
    end_date: date,
    reason: str | None,
    created_by: UUID,
) -> dict:
    days = _business_days(start_date, end_date)
    req = StaffLeaveRequest(
        tenant_id=tenant_id,
        staff_id=staff_id,
        leave_type=leave_type,
        start_date=start_date,
        end_date=end_date,
        days_requested=days,
        reason=reason,
        status="PENDING",
        created_by=created_by,
    )
    db.add(req)
    db.flush()
    return _serialize_leave(db, req, tenant_id)


def list_leave_requests(
    db: Session,
    *,
    tenant_id: UUID,
    staff_id: UUID | None = None,
    status: str | None = None,
) -> list[dict]:
    q = select(StaffLeaveRequest).where(
        StaffLeaveRequest.tenant_id == tenant_id
    )
    if staff_id:
        q = q.where(StaffLeaveRequest.staff_id == staff_id)
    if status:
        q = q.where(StaffLeaveRequest.status == status)
    q = q.order_by(StaffLeaveRequest.created_at.desc())
    rows = db.execute(q).scalars().all()
    return [_serialize_leave(db, r, tenant_id) for r in rows]


def review_leave_request(
    db: Session,
    *,
    tenant_id: UUID,
    request_id: UUID,
    status: str,
    review_note: str | None,
    reviewed_by: UUID,
) -> dict:
    req = db.execute(
        select(StaffLeaveRequest).where(
            StaffLeaveRequest.id == request_id,
            StaffLeaveRequest.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not req:
        raise ValueError("Leave request not found")
    if req.status != "PENDING":
        raise ValueError(f"Cannot review a request with status '{req.status}'")
    req.status = status
    req.reviewed_by = reviewed_by
    req.reviewed_at = _now()
    req.review_note = review_note
    req.updated_at = _now()
    db.flush()
    return _serialize_leave(db, req, tenant_id)


def cancel_leave_request(
    db: Session,
    *,
    tenant_id: UUID,
    request_id: UUID,
    requester_id: UUID,
) -> dict:
    req = db.execute(
        select(StaffLeaveRequest).where(
            StaffLeaveRequest.id == request_id,
            StaffLeaveRequest.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not req:
        raise ValueError("Leave request not found")
    if req.status not in ("PENDING",):
        raise ValueError("Only PENDING requests can be cancelled")
    if req.created_by != requester_id:
        raise ValueError("You can only cancel your own requests")
    req.status = "CANCELLED"
    req.updated_at = _now()
    db.flush()
    return _serialize_leave(db, req, tenant_id)


def _serialize_leave(db: Session, r: StaffLeaveRequest, tenant_id: UUID) -> dict:
    return {
        "id": str(r.id),
        "staff_id": str(r.staff_id),
        "staff_name": _staff_name(db, r.staff_id, tenant_id),
        "leave_type": r.leave_type,
        "start_date": r.start_date.isoformat() if r.start_date else None,
        "end_date": r.end_date.isoformat() if r.end_date else None,
        "days_requested": r.days_requested,
        "reason": r.reason,
        "status": r.status,
        "reviewed_by": _reviewer_name(db, r.reviewed_by),
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "review_note": r.review_note,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# ── Salary structure ───────────────────────────────────────────────────────────

def upsert_salary_structure(
    db: Session,
    *,
    tenant_id: UUID,
    staff_id: UUID,
    basic_salary: Decimal,
    house_allowance: Decimal,
    transport_allowance: Decimal,
    other_allowances: Decimal,
    helb_deduction: Decimal,
    loan_deduction: Decimal,
    effective_from: date,
    notes: str | None,
    actor: UUID,
) -> dict:
    existing = db.execute(
        select(StaffSalaryStructure).where(
            StaffSalaryStructure.staff_id == staff_id,
            StaffSalaryStructure.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()

    if existing:
        existing.basic_salary = basic_salary
        existing.house_allowance = house_allowance
        existing.transport_allowance = transport_allowance
        existing.other_allowances = other_allowances
        existing.helb_deduction = helb_deduction
        existing.loan_deduction = loan_deduction
        existing.effective_from = effective_from
        existing.notes = notes
        existing.updated_by = actor
        existing.updated_at = _now()
        db.flush()
        return _serialize_salary(db, existing, tenant_id)
    else:
        s = StaffSalaryStructure(
            tenant_id=tenant_id,
            staff_id=staff_id,
            basic_salary=basic_salary,
            house_allowance=house_allowance,
            transport_allowance=transport_allowance,
            other_allowances=other_allowances,
            helb_deduction=helb_deduction,
            loan_deduction=loan_deduction,
            effective_from=effective_from,
            notes=notes,
            created_by=actor,
            updated_by=actor,
        )
        db.add(s)
        db.flush()
        return _serialize_salary(db, s, tenant_id)


def get_salary_structure(
    db: Session, *, tenant_id: UUID, staff_id: UUID
) -> dict | None:
    s = db.execute(
        select(StaffSalaryStructure).where(
            StaffSalaryStructure.staff_id == staff_id,
            StaffSalaryStructure.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not s:
        return None
    return _serialize_salary(db, s, tenant_id)


def list_salary_structures(db: Session, *, tenant_id: UUID) -> list[dict]:
    rows = db.execute(
        select(StaffSalaryStructure).where(
            StaffSalaryStructure.tenant_id == tenant_id
        ).order_by(StaffSalaryStructure.updated_at.desc())
    ).scalars().all()
    return [_serialize_salary(db, r, tenant_id) for r in rows]


def _serialize_salary(db: Session, s: StaffSalaryStructure, tenant_id: UUID) -> dict:
    gross = (
        Decimal(str(s.basic_salary)) +
        Decimal(str(s.house_allowance)) +
        Decimal(str(s.transport_allowance)) +
        Decimal(str(s.other_allowances))
    )
    return {
        "id": str(s.id),
        "staff_id": str(s.staff_id),
        "staff_name": _staff_name(db, s.staff_id, tenant_id),
        "basic_salary": float(s.basic_salary),
        "house_allowance": float(s.house_allowance),
        "transport_allowance": float(s.transport_allowance),
        "other_allowances": float(s.other_allowances),
        "helb_deduction": float(s.helb_deduction),
        "loan_deduction": float(s.loan_deduction),
        "gross_pay": float(gross),
        "effective_from": s.effective_from.isoformat() if s.effective_from else None,
        "notes": s.notes,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


# ── Payroll generation ─────────────────────────────────────────────────────────

def generate_payslips(
    db: Session,
    *,
    tenant_id: UUID,
    pay_month: int,
    pay_year: int,
    staff_ids: list[UUID] | None,
    generated_by: UUID,
) -> list[dict]:
    q = select(StaffSalaryStructure).where(
        StaffSalaryStructure.tenant_id == tenant_id
    )
    if staff_ids:
        q = q.where(StaffSalaryStructure.staff_id.in_([str(s) for s in staff_ids]))
    salary_rows = db.execute(q).scalars().all()

    results = []
    for s in salary_rows:
        # Skip if already generated for this month
        exists = db.execute(
            select(StaffPayslip).where(
                StaffPayslip.staff_id == s.staff_id,
                StaffPayslip.tenant_id == tenant_id,
                StaffPayslip.pay_month == pay_month,
                StaffPayslip.pay_year == pay_year,
            )
        ).scalar_one_or_none()
        if exists:
            continue  # already generated — skip, return only newly created slips

        gross = (
            Decimal(str(s.basic_salary)) +
            Decimal(str(s.house_allowance)) +
            Decimal(str(s.transport_allowance)) +
            Decimal(str(s.other_allowances))
        )
        paye = _calc_paye(gross)
        nhif = _calc_nhif(gross)
        nssf_e, nssf_er = _calc_nssf(gross)
        helb = Decimal(str(s.helb_deduction))
        loan = Decimal(str(s.loan_deduction))
        total_ded = paye + nhif + nssf_e + helb + loan
        net = gross - total_ded

        slip = StaffPayslip(
            tenant_id=tenant_id,
            staff_id=s.staff_id,
            pay_month=pay_month,
            pay_year=pay_year,
            basic_salary=s.basic_salary,
            house_allowance=s.house_allowance,
            transport_allowance=s.transport_allowance,
            other_allowances=s.other_allowances,
            gross_pay=gross,
            paye=paye,
            nhif=nhif,
            nssf_employee=nssf_e,
            nssf_employer=nssf_er,
            helb_deduction=helb,
            loan_deduction=loan,
            total_deductions=total_ded,
            net_pay=net,
            generated_by=generated_by,
        )
        db.add(slip)
        db.flush()
        results.append(_serialize_payslip(db, slip, tenant_id))

    return results


def list_payslips(
    db: Session,
    *,
    tenant_id: UUID,
    staff_id: UUID | None = None,
    pay_year: int | None = None,
    pay_month: int | None = None,
) -> list[dict]:
    q = select(StaffPayslip).where(StaffPayslip.tenant_id == tenant_id)
    if staff_id:
        q = q.where(StaffPayslip.staff_id == staff_id)
    if pay_year:
        q = q.where(StaffPayslip.pay_year == pay_year)
    if pay_month:
        q = q.where(StaffPayslip.pay_month == pay_month)
    q = q.order_by(StaffPayslip.pay_year.desc(), StaffPayslip.pay_month.desc())
    rows = db.execute(q).scalars().all()
    return [_serialize_payslip(db, r, tenant_id) for r in rows]


def _serialize_payslip(db: Session, p: StaffPayslip, tenant_id: UUID) -> dict:
    staff = db.execute(text("""
        SELECT first_name, last_name, staff_no
        FROM core.staff_directory WHERE id = :id AND tenant_id = :tid
    """), {"id": str(p.staff_id), "tid": str(tenant_id)}).first()
    staff_name = f"{staff.first_name or ''} {staff.last_name or ''}".strip() if staff else str(p.staff_id)
    staff_no = staff.staff_no if staff else ""
    return {
        "id": str(p.id),
        "staff_id": str(p.staff_id),
        "staff_name": staff_name,
        "staff_no": staff_no,
        "pay_month": p.pay_month,
        "pay_year": p.pay_year,
        "basic_salary": float(p.basic_salary),
        "house_allowance": float(p.house_allowance),
        "transport_allowance": float(p.transport_allowance),
        "other_allowances": float(p.other_allowances),
        "gross_pay": float(p.gross_pay),
        "paye": float(p.paye),
        "nhif": float(p.nhif),
        "nssf_employee": float(p.nssf_employee),
        "nssf_employer": float(p.nssf_employer),
        "helb_deduction": float(p.helb_deduction),
        "loan_deduction": float(p.loan_deduction),
        "total_deductions": float(p.total_deductions),
        "net_pay": float(p.net_pay),
        "generated_at": p.generated_at.isoformat() if p.generated_at else None,
    }


# ── SMS recipients ─────────────────────────────────────────────────────────────

def get_sms_recipients(
    db: Session,
    *,
    tenant_id: UUID,
    class_id: UUID | None = None,
) -> list[dict]:
    """Return parent phone numbers, optionally filtered to a specific class."""
    if class_id:
        rows = db.execute(text("""
            SELECT DISTINCT
                p.last_name AS p_last,
                p.first_name AS p_first,
                p.first_name || ' ' || p.last_name AS name,
                p.phone,
                s.first_name || ' ' || s.last_name AS student_name,
                c.name AS class_name
            FROM core.parents p
            JOIN core.parent_students ps ON ps.parent_id = p.id
                AND ps.tenant_id = :tid AND ps.is_active = true
            JOIN core.students s ON s.id = ps.student_id
                AND s.tenant_id = :tid AND s.status = 'ACTIVE'
            JOIN core.student_class_enrollments sce ON sce.student_id = s.id
                AND sce.tenant_id = :tid AND sce.status = 'ACTIVE'
                AND sce.class_id = :class_id
            JOIN core.tenant_classes c ON c.id = sce.class_id
                AND c.tenant_id = :tid
            WHERE p.tenant_id = :tid
              AND p.is_active = true
              AND p.phone IS NOT NULL
              AND p.phone != ''
            ORDER BY p.last_name, p.first_name
        """), {"tid": str(tenant_id), "class_id": str(class_id)}).fetchall()
    else:
        rows = db.execute(text("""
            SELECT DISTINCT
                p.last_name AS p_last,
                p.first_name AS p_first,
                p.first_name || ' ' || p.last_name AS name,
                p.phone,
                s.first_name || ' ' || s.last_name AS student_name,
                c.name AS class_name
            FROM core.parents p
            JOIN core.parent_students ps ON ps.parent_id = p.id
                AND ps.tenant_id = :tid AND ps.is_active = true
            JOIN core.students s ON s.id = ps.student_id
                AND s.tenant_id = :tid AND s.status = 'ACTIVE'
            LEFT JOIN core.student_class_enrollments sce ON sce.student_id = s.id
                AND sce.tenant_id = :tid AND sce.status = 'ACTIVE'
            LEFT JOIN core.tenant_classes c ON c.id = sce.class_id
                AND c.tenant_id = :tid
            WHERE p.tenant_id = :tid
              AND p.is_active = true
              AND p.phone IS NOT NULL
              AND p.phone != ''
            ORDER BY p.last_name, p.first_name
        """), {"tid": str(tenant_id)}).fetchall()

    return [
        {
            "name": row.name or "",
            "phone": row.phone,
            "student_name": row.student_name or "",
            "class_name": row.class_name,
        }
        for row in rows
    ]


# ── SMS default template seeding on tenant creation ───────────────────────────

_DEFAULT_TEMPLATES = [
    (
        "Fee Reminder",
        "Dear {parent_name}, this is a reminder that {student_name}'s school fees of KES {amount} are due on {due_date}. Please pay promptly to avoid inconvenience. Thank you.",
        ["parent_name", "student_name", "amount", "due_date"],
    ),
    (
        "Attendance Alert",
        "Dear {parent_name}, {student_name} was absent from school today ({date}). Please contact the school office if you need to report this absence.",
        ["parent_name", "student_name", "date"],
    ),
    (
        "Report Card Ready",
        "Dear {parent_name}, {student_name}'s report card for {term} is now ready for collection at the school office. Kindly visit during working hours.",
        ["parent_name", "student_name", "term"],
    ),
    (
        "Event Notification",
        "Dear {parent_name}, {school_name} wishes to inform you about an upcoming event: {event_name} on {date} at {time}. We look forward to your participation.",
        ["parent_name", "school_name", "event_name", "date", "time"],
    ),
    (
        "School Closure",
        "Dear Parent, please note that {school_name} will be closed on {date} due to {reason}. Normal operations resume on {resume_date}.",
        ["school_name", "date", "reason", "resume_date"],
    ),
    (
        "Parents Meeting",
        "Dear {parent_name}, you are cordially invited to a parents' meeting on {date} at {time} in {venue}. Your attendance is highly encouraged.",
        ["parent_name", "date", "time", "venue"],
    ),
]


def seed_default_sms_templates(db: Session, *, tenant_id: UUID) -> None:
    """Seed default SMS templates for a newly created tenant."""
    from app.models.sms import SmsTemplate
    import json
    for name, body, variables in _DEFAULT_TEMPLATES:
        exists = db.execute(text("""
            SELECT 1 FROM core.sms_templates
            WHERE tenant_id = :tid AND name = :name
        """), {"tid": str(tenant_id), "name": name}).first()
        if not exists:
            db.add(SmsTemplate(
                tenant_id=tenant_id,
                name=name,
                body=body,
                variables=variables,
            ))
    db.flush()
