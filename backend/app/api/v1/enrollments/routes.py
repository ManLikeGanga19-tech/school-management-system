from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.core.dependencies import get_tenant, get_current_user, require_permission
from app.api.v1.enrollments import service
from app.api.v1.enrollments.schemas import (
    EnrollmentCreate,
    EnrollmentUpdate,
    EnrollmentEnrollRequest,
    EnrollmentRejectRequest,
    EnrollmentDirectorOverrideRequest,
    EnrollmentOut,
    EnrollmentPageOut,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_or_404(db: Session, tenant_id, enrollment_id: UUID) -> object:
    row = service.get_enrollment(db, tenant_id=tenant_id, enrollment_id=enrollment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found.")
    return row


def _parse_csv_param(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------

@router.post(
    "/",
    response_model=EnrollmentOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("enrollment.manage"))],
    summary="Create a new DRAFT enrollment",
)
def create_enrollment(
    body: EnrollmentCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = service.create_enrollment(
        db, tenant_id=tenant.id, actor_user_id=user.id, payload=body.payload,
    )
    db.commit()
    db.refresh(row)
    return row


@router.get(
    "/",
    response_model=list[EnrollmentOut],
    dependencies=[Depends(require_permission("enrollment.manage"))],
    summary="List enrollments for this tenant",
)
def list_enrollments(
    status: str | None = None,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_enrollments(db, tenant_id=tenant.id, status=status)


@router.get(
    "/paged",
    response_model=EnrollmentPageOut,
    dependencies=[Depends(require_permission("enrollment.manage"))],
    summary="List enrollments with server-side pagination and filters",
)
def list_enrollments_paged(
    limit: int = Query(default=10, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    status: str | None = Query(default=None),
    status_in: str | None = Query(
        default=None,
        description="Comma-separated statuses to include.",
    ),
    status_not_in: str | None = Query(
        default=None,
        description="Comma-separated statuses to exclude.",
    ),
    search: str | None = Query(
        default=None,
        description="Search student name, class, term, admission number, or ID.",
    ),
    class_code: str | None = Query(default=None),
    term_code: str | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    rows, total = service.list_enrollments_paged(
        db,
        tenant_id=tenant.id,
        limit=limit,
        offset=offset,
        status=status,
        status_in=_parse_csv_param(status_in),
        status_not_in=_parse_csv_param(status_not_in),
        search=search,
        class_code=class_code,
        term_code=term_code,
    )
    return EnrollmentPageOut(items=rows, total=total, limit=limit, offset=offset)


# ---------------------------------------------------------------------------
# Single record
# ---------------------------------------------------------------------------

@router.get(
    "/{enrollment_id}",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("enrollment.manage"))],
    summary="Fetch a single enrollment by ID",
)
def get_enrollment(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return _get_or_404(db, tenant.id, enrollment_id)


@router.patch(
    "/{enrollment_id}",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("enrollment.manage"))],
    summary="Merge-update an enrollment's payload. Directors bypass the secretary edit limit.",
)
def patch_enrollment(
    enrollment_id: UUID,
    body: EnrollmentUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = _get_or_404(db, tenant.id, enrollment_id)
    # Directors (enrollment.director.override permission) are never edit-counted or blocked.
    is_director = getattr(user, "has_permission", lambda _: False)("enrollment.director.override")
    try:
        row = service.update_enrollment(
            db, tenant_id=tenant.id, actor_user_id=user.id,
            enrollment=row, payload=body.payload,
            bypass_edit_limit=is_director,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# Workflow transitions
# ---------------------------------------------------------------------------

@router.post(
    "/{enrollment_id}/submit",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("enrollment.manage"))],
    summary="Submit a DRAFT enrollment for office review",
)
def submit_enrollment(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = _get_or_404(db, tenant.id, enrollment_id)
    try:
        row = service.submit_enrollment(
            db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post(
    "/{enrollment_id}/approve",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("enrollment.manage"))],
    summary="Approve a SUBMITTED enrollment",
)
def approve_enrollment(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = _get_or_404(db, tenant.id, enrollment_id)
    try:
        row = service.approve_enrollment(
            db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post(
    "/{enrollment_id}/reject",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("enrollment.manage"))],
    summary="Reject a SUBMITTED or APPROVED enrollment",
)
def reject_enrollment(
    enrollment_id: UUID,
    body: EnrollmentRejectRequest = EnrollmentRejectRequest(),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = _get_or_404(db, tenant.id, enrollment_id)
    try:
        row = service.reject_enrollment(
            db, tenant_id=tenant.id, actor_user_id=user.id,
            enrollment=row, reason=body.reason,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post(
    "/{enrollment_id}/enroll",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("enrollment.manage"))],
    summary="Mark an APPROVED enrollment as ENROLLED and assign admission number",
)
def mark_enrolled(
    enrollment_id: UUID,
    body: EnrollmentEnrollRequest = EnrollmentEnrollRequest(),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = _get_or_404(db, tenant.id, enrollment_id)
    try:
        row = service.mark_enrolled(
            db, tenant_id=tenant.id, actor_user_id=user.id,
            enrollment=row, admission_number=body.admission_number,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# Director-level actions
# ---------------------------------------------------------------------------

@router.delete(
    "/{enrollment_id}",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_permission("enrollment.director.override"))],
    summary="Permanently delete an incomplete enrollment application and its finance records",
)
def delete_enrollment(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """
    Permanently removes a non-enrolled application (DRAFT, SUBMITTED, APPROVED, REJECTED, etc.)
    and any invoices / payments exclusively linked to it.
    Active enrollments (ENROLLED / ENROLLED_PARTIAL) must be removed via student hard-delete.
    Requires `enrollment.director.override`.
    """
    row = _get_or_404(db, tenant.id, enrollment_id)
    try:
        result = service.delete_enrollment(
            db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row,
        )
        db.commit()
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post(
    "/{enrollment_id}/director-override",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("enrollment.director.override"))],
    summary="Director: reset secretary edit lock on an enrolled student record",
)
def director_override(
    enrollment_id: UUID,
    body: EnrollmentDirectorOverrideRequest = EnrollmentDirectorOverrideRequest(),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """
    Clears the secretary edit lock and resets the edit counter to 0,
    allowing the secretary to make further updates.

    Requires the `enrollment.director.override` permission.
    The director's note is stored in the audit log.
    """
    row = _get_or_404(db, tenant.id, enrollment_id)
    try:
        row = service.director_override(
            db, tenant_id=tenant.id, actor_user_id=user.id,
            enrollment=row, note=body.note,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# Transfer flow
# ---------------------------------------------------------------------------

@router.post(
    "/{enrollment_id}/transfer/request",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("enrollment.manage"))],
    summary="Raise a transfer request for an enrolled student",
)
def request_transfer(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = _get_or_404(db, tenant.id, enrollment_id)
    try:
        row = service.request_transfer(
            db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post(
    "/{enrollment_id}/transfer/approve",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("enrollment.transfer.approve"))],
    summary="Approve a pending transfer request (director level)",
)
def approve_transfer(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = _get_or_404(db, tenant.id, enrollment_id)
    try:
        row = service.approve_transfer(
            db, tenant_id=tenant.id, actor_user_id=user.id, enrollment=row,
        )
        db.commit()
        db.refresh(row)
        return row
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# Director-only: soft delete + hard delete
# ---------------------------------------------------------------------------

@router.post(
    "/{enrollment_id}/soft-delete",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("enrollment.director.override"))],
    summary="Soft-delete: mark enrollment status as DELETED (director only)",
)
def soft_delete_enrollment(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """
    Sets the enrollment status to DELETED.  The record remains in the database
    and can be inspected but is hidden from all standard views.
    A second hard-delete call permanently removes it.
    """
    row = _get_or_404(db, tenant.id, enrollment_id)
    if row.status == "DELETED":
        # Idempotent — already soft-deleted, return current state
        return row
    row.status = "DELETED"
    row.updated_by = user.id
    db.commit()
    db.refresh(row)
    from app.core.audit import log_event
    log_event(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        action="enrollment.soft_delete",
        resource="enrollment",
        resource_id=row.id,
        payload={"previous_status": row.status},
        meta=None,
    )
    return row


@router.delete(
    "/{enrollment_id}",
    status_code=204,
    dependencies=[Depends(require_permission("enrollment.director.override"))],
    summary="Hard-delete: permanently remove an enrollment record (director only)",
)
def hard_delete_enrollment(
    enrollment_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    """
    Permanently removes the enrollment row and all related data from the
    tenant's database.  This action cannot be undone.

    Should only be called after a soft-delete (status=DELETED) has been
    confirmed — the frontend enforces this two-step flow.
    """
    from sqlalchemy import delete as sql_delete
    from app.models.enrollment import Enrollment

    row = _get_or_404(db, tenant.id, enrollment_id)

    # Log before deletion so the audit trail is preserved
    from app.core.audit import log_event
    log_event(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        action="enrollment.hard_delete",
        resource="enrollment",
        resource_id=row.id,
        payload={
            "student_name": (row.payload or {}).get("student_name", "unknown"),
            "admission_number": row.admission_number,
            "status_at_deletion": row.status,
        },
        meta=None,
    )

    db.delete(row)
    db.commit()
    # 204 No Content — no body
