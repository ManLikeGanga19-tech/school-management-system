from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.core.dependencies import get_tenant, get_current_user, require_permission
from app.api.v1.enrollments import service
from app.api.v1.enrollments.schemas import EnrollmentCreate, EnrollmentUpdate, EnrollmentOut

router = APIRouter()


@router.post("/", response_model=EnrollmentOut, dependencies=[Depends(require_permission("enrollment.manage"))])
def create_enrollment(
    payload: EnrollmentCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.create_enrollment(db, tenant_id=tenant.id, actor_user_id=user.id, payload=payload.payload)
    db.commit()
    db.refresh(row)
    return row


@router.get("/", response_model=list[EnrollmentOut], dependencies=[Depends(require_permission("enrollment.manage"))])
def list_enrollments(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_enrollments(db, tenant_id=tenant.id, status=status)


@router.get("/{enrollment_id}", response_model=EnrollmentOut, dependencies=[Depends(require_permission("enrollment.manage"))])
def get_enrollment(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.get_enrollment(db, tenant_id=tenant.id, enrollment_id=enrollment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    return row


@router.patch("/{enrollment_id}", response_model=EnrollmentOut, dependencies=[Depends(require_permission("enrollment.manage"))])
def patch_enrollment(
    enrollment_id: UUID,
    payload: EnrollmentUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.get_enrollment(db, tenant_id=tenant.id, enrollment_id=enrollment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    try:
        row = service.update_enrollment(db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row, payload=payload.payload)
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{enrollment_id}/submit", response_model=EnrollmentOut, dependencies=[Depends(require_permission("enrollment.manage"))])
def submit_enrollment(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.get_enrollment(db, tenant_id=tenant.id, enrollment_id=enrollment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    try:
        row = service.submit_enrollment(db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row)
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{enrollment_id}/approve", response_model=EnrollmentOut, dependencies=[Depends(require_permission("enrollment.manage"))])
def approve_enrollment(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.get_enrollment(db, tenant_id=tenant.id, enrollment_id=enrollment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    try:
        row = service.approve_enrollment(db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row)
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{enrollment_id}/reject", response_model=EnrollmentOut, dependencies=[Depends(require_permission("enrollment.manage"))])
def reject_enrollment(
    enrollment_id: UUID,
    reason: str | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.get_enrollment(db, tenant_id=tenant.id, enrollment_id=enrollment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    try:
        row = service.reject_enrollment(db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row, reason=reason)
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# -------------------------
# NEW: Mark as enrolled (based on finance + assessment/nemis)
# -------------------------
@router.post("/{enrollment_id}/enroll", response_model=EnrollmentOut, dependencies=[Depends(require_permission("enrollment.manage"))])
def mark_enrolled(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.get_enrollment(db, tenant_id=tenant.id, enrollment_id=enrollment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    try:
        row = service.mark_enrolled(db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row)
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# -------------------------
# NEW: Transfer flow
# -------------------------
@router.post("/{enrollment_id}/transfer/request", response_model=EnrollmentOut, dependencies=[Depends(require_permission("enrollment.manage"))])
def request_transfer(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.get_enrollment(db, tenant_id=tenant.id, enrollment_id=enrollment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    try:
        row = service.request_transfer(db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row)
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{enrollment_id}/transfer/approve", response_model=EnrollmentOut, dependencies=[Depends(require_permission("enrollment.transfer.approve"))])
def approve_transfer(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.get_enrollment(db, tenant_id=tenant.id, enrollment_id=enrollment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    try:
        row = service.approve_transfer(db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row)
        db.commit()
        db.refresh(row)
        return row
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
