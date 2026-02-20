from __future__ import annotations

from sqlalchemy.orm import Session
from sqlalchemy import select
from uuid import UUID

from app.models.enrollment import Enrollment
from app.core.audit import log_event

from app.api.v1.finance import service as finance_service


def _require_payload_fields(enrollment: Enrollment, fields: list[str]) -> None:
    payload = enrollment.payload or {}
    missing = [f for f in fields if not payload.get(f)]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")


def create_enrollment(db: Session, *, tenant_id, actor_user_id, payload: dict) -> Enrollment:
    row = Enrollment(
        tenant_id=tenant_id,
        payload=payload,
        status="DRAFT",
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(row)
    db.flush()
    # If payload contains a fee structure selection, create an assignment record
    fee_structure_id = None
    if isinstance(payload, dict):
        fee_structure_id = payload.get("_fee_structure_id") or payload.get("fee_structure_id")

    if fee_structure_id:
        try:
            finance_service.assign_fee_structure_to_enrollment(
                db,
                tenant_id=tenant_id,
                actor_user_id=actor_user_id,
                enrollment_id=row.id,
                fee_structure_id=UUID(fee_structure_id),
                generate_invoice=False,
            )
        except Exception:
            # let caller decide on transaction rollback/commit; surface error
            raise
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="enrollment.create",
        resource="enrollment",
        resource_id=row.id,
        payload={"status": row.status},
        meta=None,
    )
    return row


def list_enrollments(db: Session, *, tenant_id, status: str | None = None) -> list[Enrollment]:
    q = select(Enrollment).where(Enrollment.tenant_id == tenant_id)
    if status:
        q = q.where(Enrollment.status == status)
    return db.execute(q.order_by(Enrollment.created_at.desc())).scalars().all()


def get_enrollment(db: Session, *, tenant_id, enrollment_id) -> Enrollment | None:
    return db.execute(
        select(Enrollment).where(
            Enrollment.tenant_id == tenant_id,
            Enrollment.id == enrollment_id,
        )
    ).scalar_one_or_none()


def update_enrollment(db: Session, *, tenant_id, actor_user_id, enrollment: Enrollment, payload: dict | None) -> Enrollment:
    # allow edits until ENROLLED / TRANSFERRED
    if enrollment.status in ("FULLY_ENROLLED", "TRANSFERRED"):
        raise ValueError("Cannot edit enrollment in this status")

    if payload is not None:
        enrollment.payload = payload

    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="enrollment.update",
        resource="enrollment",
        resource_id=enrollment.id,
        payload={"status": enrollment.status},
        meta=None,
    )
    return enrollment


def submit_enrollment(db: Session, *, tenant_id, actor_user_id, enrollment: Enrollment) -> Enrollment:
    if enrollment.status != "DRAFT":
        raise ValueError("Only DRAFT enrollments can be submitted")

    # If tenant policy requires interview fee before submit, enforce it here.
    finance = finance_service.get_enrollment_finance_status(db, tenant_id=tenant_id, enrollment_id=enrollment.id)
    if finance["policy"]["require_interview_fee_before_submit"]:
        if not finance["interview"]["paid_ok"]:
            raise ValueError("Interview fee must be fully paid before submission")

    enrollment.status = "SUBMITTED"
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="enrollment.submit", resource="enrollment", resource_id=enrollment.id, payload={"status": enrollment.status}, meta=None)
    return enrollment


def approve_enrollment(db: Session, *, tenant_id, actor_user_id, enrollment: Enrollment) -> Enrollment:
    if enrollment.status != "SUBMITTED":
        raise ValueError("Only SUBMITTED enrollments can be approved")

    enrollment.status = "APPROVED"
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="enrollment.approve", resource="enrollment", resource_id=enrollment.id, payload={"status": enrollment.status}, meta=None)
    return enrollment


def reject_enrollment(db: Session, *, tenant_id, actor_user_id, enrollment: Enrollment, reason: str | None) -> Enrollment:
    if enrollment.status not in ("SUBMITTED", "APPROVED"):
        raise ValueError("Only SUBMITTED/APPROVED enrollments can be rejected")

    enrollment.status = "REJECTED"
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="enrollment.reject", resource="enrollment", resource_id=enrollment.id, payload={"status": enrollment.status, "reason": reason}, meta=None)
    return enrollment


def mark_enrolled(db: Session, *, tenant_id, actor_user_id, enrollment: Enrollment) -> Enrollment:
    """
    Moves enrollment into:
      - FULLY_ENROLLED if fees invoice PAID
      - ENROLLED_PARTIAL if policy allows partial and threshold met
    Requires assessment_no + nemis_no in payload.
    """
    if enrollment.status not in ("APPROVED", "SUBMITTED"):
        raise ValueError("Enrollment must be SUBMITTED or APPROVED first")

    _require_payload_fields(enrollment, ["assessment_no", "nemis_no"])

    finance = finance_service.get_enrollment_finance_status(db, tenant_id=tenant_id, enrollment_id=enrollment.id)

    if not finance["interview"]["paid_ok"]:
        raise ValueError("Interview fee must be fully paid")

    # fees logic
    if finance["fees"]["paid_ok"]:
        enrollment.status = "FULLY_ENROLLED"
    elif finance["fees"]["partial_ok"]:
        enrollment.status = "ENROLLED_PARTIAL"
    else:
        raise ValueError("School fees not cleared and partial enrollment policy not satisfied")

    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="enrollment.enroll", resource="enrollment", resource_id=enrollment.id, payload={"status": enrollment.status}, meta=None)
    return enrollment


def request_transfer(db: Session, *, tenant_id, actor_user_id, enrollment: Enrollment) -> Enrollment:
    if enrollment.status not in ("FULLY_ENROLLED", "ENROLLED_PARTIAL"):
        raise ValueError("Only enrolled students can request transfer")

    enrollment.status = "TRANSFER_REQUESTED"
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="enrollment.transfer.request", resource="enrollment", resource_id=enrollment.id, payload={"status": enrollment.status}, meta=None)
    return enrollment


def approve_transfer(db: Session, *, tenant_id, actor_user_id, enrollment: Enrollment) -> Enrollment:
    if enrollment.status != "TRANSFER_REQUESTED":
        raise ValueError("Transfer must be requested first")

    # director rule: fees must be fully cleared before transfer completes
    finance = finance_service.get_enrollment_finance_status(db, tenant_id=tenant_id, enrollment_id=enrollment.id)
    if not finance["fees"]["paid_ok"]:
        raise ValueError("School fees must be fully cleared before transfer is approved")

    _require_payload_fields(enrollment, ["assessment_no", "nemis_no"])

    enrollment.status = "TRANSFERRED"
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action="enrollment.transfer.approve", resource="enrollment", resource_id=enrollment.id, payload={"status": enrollment.status}, meta=None)
    return enrollment
