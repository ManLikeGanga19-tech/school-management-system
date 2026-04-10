"""Phase 6 HR routes: leave management, payroll, SMS recipients."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.v1.hr import service
from app.api.v1.hr.schemas import (
    GeneratePayslipsIn,
    LeaveRequestIn,
    LeaveRequestOut,
    LeaveReviewIn,
    PayslipOut,
    SalaryStructureIn,
    SalaryStructureOut,
    SmsRecipientOut,
)
from app.core.database import get_db
from app.core.dependencies import get_current_user, get_tenant, require_permission
from sqlalchemy.orm import Session

router = APIRouter()


def _perm(code: str):
    return Depends(require_permission(code))


# ── SMS recipients ─────────────────────────────────────────────────────────────

@router.get(
    "/sms/recipients",
    response_model=list[SmsRecipientOut],
    summary="List parent phone numbers for SMS broadcast, optionally filtered by class",
)
def get_sms_recipients(
    class_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    return service.get_sms_recipients(db, tenant_id=tenant.id, class_id=class_id)


# ── Leave ──────────────────────────────────────────────────────────────────────

@router.get(
    "/hr/leave",
    response_model=list[LeaveRequestOut],
    summary="List leave requests for this tenant",
    dependencies=[_perm("hr.leave.view")],
)
def list_leave_requests(
    staff_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    return service.list_leave_requests(db, tenant_id=tenant.id, staff_id=staff_id, status=status)


@router.post(
    "/hr/leave",
    response_model=LeaveRequestOut,
    status_code=201,
    summary="Submit a leave request",
    dependencies=[_perm("hr.leave.view")],
)
def create_leave_request(
    body: LeaveRequestIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        result = service.create_leave_request(
            db,
            tenant_id=tenant.id,
            staff_id=body.staff_id,
            leave_type=body.leave_type,
            start_date=body.start_date,
            end_date=body.end_date,
            reason=body.reason,
            created_by=user.id,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch(
    "/hr/leave/{request_id}/review",
    response_model=LeaveRequestOut,
    summary="Approve or reject a leave request",
    dependencies=[_perm("hr.leave.approve")],
)
def review_leave_request(
    request_id: UUID,
    body: LeaveReviewIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        result = service.review_leave_request(
            db,
            tenant_id=tenant.id,
            request_id=request_id,
            status=body.status,
            review_note=body.review_note,
            reviewed_by=user.id,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch(
    "/hr/leave/{request_id}/cancel",
    response_model=LeaveRequestOut,
    summary="Cancel a pending leave request",
    dependencies=[_perm("hr.leave.view")],
)
def cancel_leave_request(
    request_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        result = service.cancel_leave_request(
            db,
            tenant_id=tenant.id,
            request_id=request_id,
            requester_id=user.id,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


# ── Salary structures ──────────────────────────────────────────────────────────

@router.get(
    "/hr/salary-structures",
    response_model=list[SalaryStructureOut],
    summary="List all staff salary structures",
    dependencies=[_perm("hr.payroll.view")],
)
def list_salary_structures(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    return service.list_salary_structures(db, tenant_id=tenant.id)


@router.get(
    "/hr/salary-structures/{staff_id}",
    response_model=SalaryStructureOut,
    summary="Get salary structure for a staff member",
    dependencies=[_perm("hr.payroll.view")],
)
def get_salary_structure(
    staff_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    result = service.get_salary_structure(db, tenant_id=tenant.id, staff_id=staff_id)
    if not result:
        raise HTTPException(status_code=404, detail="No salary structure found for this staff member")
    return result


@router.put(
    "/hr/salary-structures/{staff_id}",
    response_model=SalaryStructureOut,
    summary="Create or update salary structure for a staff member",
    dependencies=[_perm("hr.payroll.manage")],
)
def upsert_salary_structure(
    staff_id: UUID,
    body: SalaryStructureIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        result = service.upsert_salary_structure(
            db,
            tenant_id=tenant.id,
            staff_id=staff_id,
            basic_salary=body.basic_salary,
            house_allowance=body.house_allowance,
            transport_allowance=body.transport_allowance,
            other_allowances=body.other_allowances,
            helb_deduction=body.helb_deduction,
            loan_deduction=body.loan_deduction,
            effective_from=body.effective_from,
            notes=body.notes,
            actor=user.id,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


# ── Payroll ────────────────────────────────────────────────────────────────────

@router.post(
    "/hr/payroll/generate",
    response_model=list[PayslipOut],
    summary="Generate payslips for a pay month/year",
    dependencies=[_perm("hr.payroll.manage")],
)
def generate_payslips(
    body: GeneratePayslipsIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        result = service.generate_payslips(
            db,
            tenant_id=tenant.id,
            pay_month=body.pay_month,
            pay_year=body.pay_year,
            staff_ids=body.staff_ids,
            generated_by=user.id,
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.get(
    "/hr/payroll/payslips",
    response_model=list[PayslipOut],
    summary="List payslips with optional filters",
    dependencies=[_perm("hr.payroll.view")],
)
def list_payslips(
    staff_id: UUID | None = Query(default=None),
    pay_year: int | None = Query(default=None),
    pay_month: int | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    return service.list_payslips(
        db,
        tenant_id=tenant.id,
        staff_id=staff_id,
        pay_year=pay_year,
        pay_month=pay_month,
    )
