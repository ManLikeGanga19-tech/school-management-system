"""SMS notification helpers for automated finance events.

These functions are called from route handlers AFTER db.commit() so that
SMS failures never roll back a committed invoice or payment. All errors
are caught and logged — the caller always succeeds.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# ── Guardian lookup ───────────────────────────────────────────────────────────

def _lookup_guardian(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID,
) -> dict | None:
    """Return {"name": str, "phone": str} for the primary guardian of an enrollment.

    Priority order:
    1. Primary parent record (parent_enrollment_links.is_primary = true)
    2. Any linked parent record
    3. guardian_phone / guardian_name fields from enrollment payload
    Returns None if no phone can be resolved.
    """
    tid = str(tenant_id)
    eid = str(enrollment_id)

    # 1. Primary parent
    row = db.execute(sa.text("""
        SELECT p.first_name || ' ' || p.last_name AS name, p.phone
        FROM core.parents p
        JOIN core.parent_enrollment_links pel ON pel.parent_id = p.id
        WHERE pel.enrollment_id = :eid AND pel.tenant_id = :tid
          AND pel.is_primary = true AND p.phone IS NOT NULL AND p.phone <> ''
        LIMIT 1
    """), {"eid": eid, "tid": tid}).mappings().first()

    if row:
        return {"name": row["name"], "phone": row["phone"]}

    # 2. Any linked parent
    row = db.execute(sa.text("""
        SELECT p.first_name || ' ' || p.last_name AS name, p.phone
        FROM core.parents p
        JOIN core.parent_enrollment_links pel ON pel.parent_id = p.id
        WHERE pel.enrollment_id = :eid AND pel.tenant_id = :tid
          AND p.phone IS NOT NULL AND p.phone <> ''
        LIMIT 1
    """), {"eid": eid, "tid": tid}).mappings().first()

    if row:
        return {"name": row["name"], "phone": row["phone"]}

    # 3. Enrollment payload fallback
    row = db.execute(sa.text("""
        SELECT payload->>'guardian_phone' AS phone,
               payload->>'guardian_name'  AS name
        FROM core.enrollments
        WHERE id = :eid AND tenant_id = :tid
        LIMIT 1
    """), {"eid": eid, "tid": tid}).mappings().first()

    if row and row["phone"]:
        return {"name": row["name"] or "Parent", "phone": row["phone"]}

    return None


def _student_name_for_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID,
) -> str:
    row = db.execute(sa.text("""
        SELECT payload->>'student_name' AS name
        FROM core.enrollments
        WHERE id = :eid AND tenant_id = :tid
        LIMIT 1
    """), {"eid": str(enrollment_id), "tid": str(tenant_id)}).mappings().first()
    return (row["name"] if row and row["name"] else "your child")


def _fmt_kes(amount: object) -> str:
    try:
        return f"KES {Decimal(str(amount)):,.2f}"
    except Exception:
        return f"KES {amount}"


# ── Finance event notifications ───────────────────────────────────────────────

def fire_invoice_notification(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment_id: UUID,
    invoice_no: str | None,
    total_amount: object,
) -> None:
    """Send SMS to guardian when a fee invoice is raised. Silently no-ops on any error."""
    try:
        from app.api.v1.sms.service import send_single_sms  # local import avoids circular dep

        guardian = _lookup_guardian(db, tenant_id=tenant_id, enrollment_id=enrollment_id)
        if not guardian:
            return  # no phone on record — skip

        student = _student_name_for_enrollment(db, tenant_id=tenant_id, enrollment_id=enrollment_id)
        inv_ref = f" (Inv No: {invoice_no})" if invoice_no else ""
        body = (
            f"Dear {guardian['name']}, a fee invoice of {_fmt_kes(total_amount)} has been "
            f"raised for {student}{inv_ref}. Please visit the school office to make payment. Thank you."
        )

        send_single_sms(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            to_phone=guardian["phone"],
            message_body=body,
            recipient_name=guardian["name"],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("fire_invoice_notification failed (non-fatal): %s", exc)


def fire_payment_notification(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment_id: UUID | None,
    receipt_no: str | None,
    amount: object,
    new_balance: object,
) -> None:
    """Send SMS to guardian when a payment is recorded. Silently no-ops on any error."""
    if enrollment_id is None:
        return

    try:
        from app.api.v1.sms.service import send_single_sms

        guardian = _lookup_guardian(db, tenant_id=tenant_id, enrollment_id=enrollment_id)
        if not guardian:
            return

        student = _student_name_for_enrollment(db, tenant_id=tenant_id, enrollment_id=enrollment_id)
        receipt_ref = f" Receipt: {receipt_no}." if receipt_no else ""
        bal = Decimal(str(new_balance))
        balance_msg = "All fees are now settled." if bal <= 0 else f"Outstanding balance: {_fmt_kes(bal)}."

        body = (
            f"Dear {guardian['name']}, payment of {_fmt_kes(amount)} received for {student}.{receipt_ref} "
            f"{balance_msg} Thank you."
        )

        send_single_sms(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            to_phone=guardian["phone"],
            message_body=body,
            recipient_name=guardian["name"],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("fire_payment_notification failed (non-fatal): %s", exc)


# ── Bulk fee reminder ─────────────────────────────────────────────────────────

def send_bulk_fee_reminders(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
) -> dict:
    """Send fee reminder SMS to all parents with outstanding balances.

    Groups by parent phone so each parent gets one consolidated message even
    if they have multiple children with outstanding fees. Returns a summary dict.
    """
    from app.api.v1.sms.service import send_single_sms

    tid = str(tenant_id)

    # Aggregate outstanding per parent-phone, collecting student names
    rows = db.execute(sa.text("""
        SELECT
            p.phone,
            p.first_name || ' ' || p.last_name AS guardian_name,
            SUM(i.balance_amount)               AS total_outstanding,
            STRING_AGG(DISTINCT e.payload->>'student_name', ', ') AS student_names
        FROM core.parents p
        JOIN core.parent_enrollment_links pel ON pel.parent_id = p.id
        JOIN core.enrollments e  ON e.id = pel.enrollment_id
        JOIN core.invoices i     ON i.enrollment_id = e.id
        WHERE pel.tenant_id = :tid
          AND i.tenant_id   = :tid
          AND i.balance_amount > 0
          AND p.phone IS NOT NULL AND p.phone <> ''
        GROUP BY p.id, p.phone, p.first_name, p.last_name
        HAVING SUM(i.balance_amount) > 0
        ORDER BY SUM(i.balance_amount) DESC
    """), {"tid": tid}).mappings().all()

    sent = 0
    failed = 0
    skipped = 0

    for row in rows:
        students = row["student_names"] or "your child"
        balance = _fmt_kes(row["total_outstanding"])
        body = (
            f"Dear {row['guardian_name']}, this is a reminder that {students} "
            f"has/have an outstanding fee balance of {balance}. "
            f"Please visit the school office to make payment. Thank you."
        )
        try:
            send_single_sms(
                db,
                tenant_id=tenant_id,
                actor_user_id=actor_user_id,
                to_phone=row["phone"],
                message_body=body,
                recipient_name=row["guardian_name"],
            )
            sent += 1
        except ValueError:
            # Insufficient credits — stop sending, report how far we got
            skipped += len(rows) - sent - failed - 1
            break
        except Exception as exc:  # noqa: BLE001
            logger.warning("Bulk reminder failed for %s: %s", row["phone"], exc)
            failed += 1

    return {"sent": sent, "failed": failed, "skipped": skipped, "total": len(rows)}
