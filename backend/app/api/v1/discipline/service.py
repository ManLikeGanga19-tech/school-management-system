"""Discipline module service."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.discipline import DisciplineFollowup, DisciplineIncident, DisciplineStudent


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _incident_or_404(db: Session, *, tenant_id: UUID, incident_id: UUID) -> DisciplineIncident:
    row = db.execute(
        select(DisciplineIncident).where(
            DisciplineIncident.id == incident_id,
            DisciplineIncident.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
    return row


def _safe_uuid_list(ids: list[str]) -> str:
    """Produce a safe SQL IN literal from a list of UUID strings."""
    from uuid import UUID as _UUID
    validated = [str(_UUID(str(i))) for i in ids]
    return ", ".join(f"'{v}'" for v in validated)


def _enrich_incidents(db: Session, incidents: list[DisciplineIncident]) -> list[dict]:
    """Join reporter names and student counts for list view."""
    if not incidents:
        return []

    incident_ids = [str(i.id) for i in incidents]
    ids_sql = _safe_uuid_list(incident_ids)

    # Student counts per incident
    counts_rows = db.execute(
        sa.text(
            f"""
            SELECT incident_id, COUNT(*) AS cnt
            FROM core.discipline_students
            WHERE incident_id IN ({ids_sql})
            GROUP BY incident_id
            """
        ),
    ).mappings().all()
    counts = {str(r["incident_id"]): int(r["cnt"]) for r in counts_rows}

    # Reporter names
    reporter_ids = list({str(i.reported_by_user_id) for i in incidents if i.reported_by_user_id})
    reporter_names: dict[str, str] = {}
    if reporter_ids:
        rids_sql = _safe_uuid_list(reporter_ids)
        name_rows = db.execute(
            sa.text(
                f"""
                SELECT id, COALESCE(full_name, email, 'Unknown') AS name
                FROM core.users
                WHERE id IN ({rids_sql})
                """
            ),
        ).mappings().all()
        reporter_names = {str(r["id"]): r["name"] for r in name_rows}

    result = []
    for inc in incidents:
        result.append({
            "id": inc.id,
            "incident_date": inc.incident_date,
            "incident_type": inc.incident_type,
            "severity": inc.severity,
            "title": inc.title,
            "status": inc.status,
            "location": inc.location,
            "reported_by_name": reporter_names.get(str(inc.reported_by_user_id)) if inc.reported_by_user_id else None,
            "student_count": counts.get(str(inc.id), 0),
            "created_at": inc.created_at,
        })
    return result


def _enrich_incident_detail(db: Session, incident: DisciplineIncident) -> dict:
    """Build full incident detail with students and followups."""
    # Students
    student_rows = db.execute(
        sa.text(
            """
            SELECT
                ds.id,
                ds.student_id,
                ds.enrollment_id,
                ds.role,
                ds.action_taken,
                ds.action_notes,
                ds.parent_notified,
                ds.parent_notified_at,
                s.first_name || ' ' || s.last_name AS student_name,
                s.admission_no,
                tc.name AS class_name
            FROM core.discipline_students ds
            JOIN core.students s ON s.id = ds.student_id
            LEFT JOIN core.student_class_enrollments sce ON sce.id = ds.enrollment_id
            LEFT JOIN core.tenant_classes tc ON tc.id = sce.class_id
            WHERE ds.incident_id = :iid
            ORDER BY ds.role, s.last_name, s.first_name
            """
        ),
        {"iid": str(incident.id)},
    ).mappings().all()

    # Followups
    followup_rows = db.execute(
        sa.text(
            """
            SELECT
                df.id,
                df.incident_id,
                df.followup_date,
                df.notes,
                df.created_by_user_id,
                df.created_at,
                COALESCE(u.full_name, u.email, 'Unknown') AS created_by_name
            FROM core.discipline_followups df
            LEFT JOIN core.users u ON u.id = df.created_by_user_id
            WHERE df.incident_id = :iid
            ORDER BY df.followup_date DESC, df.created_at DESC
            """
        ),
        {"iid": str(incident.id)},
    ).mappings().all()

    # Reporter name
    reporter_name = None
    if incident.reported_by_user_id:
        rr = db.execute(
            sa.text(
                "SELECT COALESCE(full_name, email, 'Unknown') AS name FROM core.users WHERE id = :uid"
            ),
            {"uid": str(incident.reported_by_user_id)},
        ).mappings().first()
        if rr:
            reporter_name = rr["name"]

    return {
        "id": incident.id,
        "tenant_id": incident.tenant_id,
        "incident_date": incident.incident_date,
        "incident_type": incident.incident_type,
        "severity": incident.severity,
        "title": incident.title,
        "description": incident.description,
        "location": incident.location,
        "reported_by_user_id": incident.reported_by_user_id,
        "reported_by_name": reporter_name,
        "status": incident.status,
        "resolution_notes": incident.resolution_notes,
        "resolved_at": incident.resolved_at,
        "created_at": incident.created_at,
        "updated_at": incident.updated_at,
        "students": [dict(r) for r in student_rows],
        "followups": [dict(r) for r in followup_rows],
    }


# ── Incidents ─────────────────────────────────────────────────────────────────

def list_incidents(
    db: Session,
    *,
    tenant_id: UUID,
    student_id: UUID | None = None,
    status: str | None = None,
    incident_type: str | None = None,
    severity: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Return (items, total) for paginated listing."""

    if student_id:
        # Filter by student — join through discipline_students
        base_q = (
            select(DisciplineIncident)
            .join(
                DisciplineStudent,
                DisciplineStudent.incident_id == DisciplineIncident.id,
            )
            .where(
                DisciplineIncident.tenant_id == tenant_id,
                DisciplineStudent.student_id == student_id,
            )
            .distinct()
        )
    else:
        base_q = select(DisciplineIncident).where(
            DisciplineIncident.tenant_id == tenant_id
        )

    if status:
        base_q = base_q.where(DisciplineIncident.status == status.upper())
    if incident_type:
        base_q = base_q.where(DisciplineIncident.incident_type == incident_type.upper())
    if severity:
        base_q = base_q.where(DisciplineIncident.severity == severity.upper())
    if date_from:
        base_q = base_q.where(DisciplineIncident.incident_date >= date_from)
    if date_to:
        base_q = base_q.where(DisciplineIncident.incident_date <= date_to)

    total = db.execute(
        select(sa.func.count()).select_from(base_q.subquery())
    ).scalar_one()

    incidents = list(
        db.execute(
            base_q.order_by(DisciplineIncident.incident_date.desc(), DisciplineIncident.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).scalars().all()
    )

    return _enrich_incidents(db, incidents), total


def create_incident(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID | None,
    data: dict[str, Any],
) -> dict:
    now = _now()
    incident = DisciplineIncident(
        tenant_id=tenant_id,
        incident_date=data["incident_date"],
        incident_type=data["incident_type"],
        severity=data.get("severity", "LOW"),
        title=data["title"],
        description=data.get("description"),
        location=data.get("location"),
        reported_by_user_id=actor_user_id,
        status="OPEN",
    )
    db.add(incident)
    db.flush()

    for s_data in data.get("students", []):
        link = DisciplineStudent(
            tenant_id=tenant_id,
            incident_id=incident.id,
            student_id=s_data["student_id"],
            enrollment_id=s_data.get("enrollment_id"),
            role=s_data.get("role", "PERPETRATOR"),
            action_taken=s_data.get("action_taken"),
            action_notes=s_data.get("action_notes"),
            parent_notified=s_data.get("parent_notified", False),
        )
        db.add(link)

    db.flush()
    return _enrich_incident_detail(db, incident)


def get_incident(db: Session, *, tenant_id: UUID, incident_id: UUID) -> dict:
    incident = _incident_or_404(db, tenant_id=tenant_id, incident_id=incident_id)
    return _enrich_incident_detail(db, incident)


def update_incident(
    db: Session,
    *,
    tenant_id: UUID,
    incident_id: UUID,
    updates: dict[str, Any],
) -> dict:
    incident = _incident_or_404(db, tenant_id=tenant_id, incident_id=incident_id)

    if incident.status in ("CLOSED",):
        raise HTTPException(status_code=409, detail="Cannot edit a closed incident")

    for field in ("incident_date", "incident_type", "severity", "title", "description", "location"):
        if field in updates and updates[field] is not None:
            setattr(incident, field, updates[field])

    new_status = updates.get("status")
    if new_status:
        incident.status = new_status
        if new_status in ("RESOLVED", "CLOSED") and not incident.resolved_at:
            incident.resolved_at = _now()

    if "resolution_notes" in updates:
        incident.resolution_notes = updates["resolution_notes"]

    incident.updated_at = _now()
    db.flush()
    return _enrich_incident_detail(db, incident)


def add_student_to_incident(
    db: Session,
    *,
    tenant_id: UUID,
    incident_id: UUID,
    data: dict[str, Any],
) -> dict:
    incident = _incident_or_404(db, tenant_id=tenant_id, incident_id=incident_id)

    # Check not already linked
    existing = db.execute(
        select(DisciplineStudent).where(
            DisciplineStudent.incident_id == incident_id,
            DisciplineStudent.student_id == data["student_id"],
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Student already linked to this incident")

    link = DisciplineStudent(
        tenant_id=tenant_id,
        incident_id=incident_id,
        student_id=data["student_id"],
        enrollment_id=data.get("enrollment_id"),
        role=data.get("role", "PERPETRATOR"),
        action_taken=data.get("action_taken"),
        action_notes=data.get("action_notes"),
        parent_notified=data.get("parent_notified", False),
    )
    db.add(link)
    db.flush()
    return _enrich_incident_detail(db, incident)


def update_incident_student(
    db: Session,
    *,
    tenant_id: UUID,
    incident_id: UUID,
    link_id: UUID,
    updates: dict[str, Any],
) -> dict:
    _incident_or_404(db, tenant_id=tenant_id, incident_id=incident_id)

    link = db.execute(
        select(DisciplineStudent).where(
            DisciplineStudent.id == link_id,
            DisciplineStudent.incident_id == incident_id,
        )
    ).scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Student link not found")

    for field in ("role", "action_taken", "action_notes"):
        if field in updates and updates[field] is not None:
            setattr(link, field, updates[field])

    if "parent_notified" in updates and updates["parent_notified"] is not None:
        link.parent_notified = updates["parent_notified"]
        if updates["parent_notified"] and not link.parent_notified_at:
            link.parent_notified_at = _now()

    db.flush()

    incident = _incident_or_404(db, tenant_id=tenant_id, incident_id=incident_id)
    return _enrich_incident_detail(db, incident)


def remove_student_from_incident(
    db: Session,
    *,
    tenant_id: UUID,
    incident_id: UUID,
    link_id: UUID,
) -> None:
    _incident_or_404(db, tenant_id=tenant_id, incident_id=incident_id)
    link = db.execute(
        select(DisciplineStudent).where(
            DisciplineStudent.id == link_id,
            DisciplineStudent.incident_id == incident_id,
        )
    ).scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Student link not found")
    db.delete(link)
    db.flush()


def add_followup(
    db: Session,
    *,
    tenant_id: UUID,
    incident_id: UUID,
    actor_user_id: UUID | None,
    data: dict[str, Any],
) -> dict:
    incident = _incident_or_404(db, tenant_id=tenant_id, incident_id=incident_id)
    followup = DisciplineFollowup(
        tenant_id=tenant_id,
        incident_id=incident_id,
        followup_date=data["followup_date"],
        notes=data["notes"],
        created_by_user_id=actor_user_id,
    )
    db.add(followup)
    db.flush()
    return _enrich_incident_detail(db, incident)


def get_student_discipline_history(
    db: Session,
    *,
    tenant_id: UUID,
    student_id: UUID,
) -> list[dict]:
    """All incidents for a student, lightweight."""
    rows = db.execute(
        sa.text(
            """
            SELECT
                di.id,
                di.incident_date,
                di.incident_type,
                di.severity,
                di.title,
                di.status,
                di.location,
                ds.role,
                ds.action_taken,
                ds.parent_notified,
                di.created_at
            FROM core.discipline_incidents di
            JOIN core.discipline_students ds ON ds.incident_id = di.id
            WHERE di.tenant_id = :tid
              AND ds.student_id = :sid
            ORDER BY di.incident_date DESC, di.created_at DESC
            """
        ),
        {"tid": str(tenant_id), "sid": str(student_id)},
    ).mappings().all()
    return [dict(r) for r in rows]


# ── Student hard-delete ───────────────────────────────────────────────────────

def hard_delete_student(
    db: Session,
    *,
    tenant_id: UUID,
    student_id: UUID,
    confirm: str,
) -> dict:
    """
    Permanently delete a student and ALL their records from the system.
    Requires confirm == "DELETE {admission_no}".
    Returns a summary of deleted record counts.
    """
    # 1. Fetch student
    student_row = db.execute(
        sa.text(
            """
            SELECT id, first_name, last_name, admission_no, status
            FROM core.students
            WHERE id = :sid AND tenant_id = :tid
            """
        ),
        {"sid": str(student_id), "tid": str(tenant_id)},
    ).mappings().first()

    if not student_row:
        raise HTTPException(status_code=404, detail="Student not found")

    admission_no = student_row["admission_no"]
    student_name = f"{student_row['first_name']} {student_row['last_name']}"

    # 2. Validate confirmation token
    expected = f"DELETE {admission_no}"
    if confirm.strip() != expected:
        raise HTTPException(
            status_code=422,
            detail=f"Confirmation must be exactly: {expected}",
        )

    counts: dict[str, int] = {}
    sid_str = str(student_id)
    tid_str = str(tenant_id)

    # 3. Collect class enrollment IDs (for marks/IGCSE/reports/fee_assignments cleanup)
    class_enrollment_ids = [
        str(r["id"])
        for r in db.execute(
            sa.text(
                "SELECT id FROM core.student_class_enrollments WHERE student_id = :sid AND tenant_id = :tid"
            ),
            {"sid": sid_str, "tid": tid_str},
        ).mappings().all()
    ]

    # 4. Find invoice IDs via JOIN through core.enrollments (works regardless of whether
    #    enrollment.student_id was set before the student record was created).
    invoice_rows = db.execute(
        sa.text(
            """
            SELECT i.id
            FROM core.invoices i
            JOIN core.enrollments e ON e.id = i.enrollment_id
            WHERE e.student_id = :sid
              AND i.tenant_id = :tid
            """
        ),
        {"sid": sid_str, "tid": tid_str},
    ).mappings().all()
    invoice_ids = [str(r["id"]) for r in invoice_rows]

    # 5. Collect payment IDs that are exclusively allocated to this student's invoices.
    #    We only delete a payment if ALL its allocations are against invoices we're deleting,
    #    so shared payments (covering multiple students) are not wiped.
    payment_ids: list[str] = []
    if invoice_ids:
        iids_sql = _safe_uuid_list(invoice_ids)
        payment_rows = db.execute(
            sa.text(
                f"""
                SELECT pa.payment_id
                FROM core.payment_allocations pa
                WHERE pa.invoice_id IN ({iids_sql})
                GROUP BY pa.payment_id
                HAVING COUNT(*) = (
                    SELECT COUNT(*) FROM core.payment_allocations pa2
                    WHERE pa2.payment_id = pa.payment_id
                )
                """
            ),
        ).mappings().all()
        payment_ids = [str(r["payment_id"]) for r in payment_rows]

    # ── TEARDOWN ──────────────────────────────────────────────────────────────

    # 6. Payment allocations (all allocations touching our invoices)
    if invoice_ids:
        iids_sql = _safe_uuid_list(invoice_ids)
        r = db.execute(
            sa.text(f"DELETE FROM core.payment_allocations WHERE invoice_id IN ({iids_sql})"),
        )
        counts["payment_allocations"] = r.rowcount

    # 7. Payments (only those that were exclusively for this student)
    if payment_ids:
        pids_sql = _safe_uuid_list(payment_ids)
        r = db.execute(
            sa.text(f"DELETE FROM core.payments WHERE id IN ({pids_sql}) AND tenant_id = :tid"),
            {"tid": tid_str},
        )
        counts["payments"] = r.rowcount

    # 8. Invoice lines
    if invoice_ids:
        iids_sql = _safe_uuid_list(invoice_ids)
        r = db.execute(
            sa.text(f"DELETE FROM core.invoice_lines WHERE invoice_id IN ({iids_sql})"),
        )
        counts["invoice_lines"] = r.rowcount

    # 9. Invoices
    if invoice_ids:
        iids_sql = _safe_uuid_list(invoice_ids)
        r = db.execute(
            sa.text(f"DELETE FROM core.invoices WHERE id IN ({iids_sql}) AND tenant_id = :tid"),
            {"tid": tid_str},
        )
        counts["invoices"] = r.rowcount

    # 10. Admission enrollment application forms (now safe to delete — invoices FK is gone)
    r = db.execute(
        sa.text(
            "DELETE FROM core.enrollments WHERE student_id = :sid AND tenant_id = :tid"
        ),
        {"sid": sid_str, "tid": tid_str},
    )
    counts["enrollment_applications"] = r.rowcount

    # 11. Exam marks (via class enrollment)
    if class_enrollment_ids:
        eids_sql = _safe_uuid_list(class_enrollment_ids)
        r = db.execute(
            sa.text(
                f"DELETE FROM core.tenant_exam_marks WHERE student_enrollment_id IN ({eids_sql}) AND tenant_id = :tid"
            ),
            {"tid": tid_str},
        )
        counts["exam_marks"] = r.rowcount

    # 12. Term report remarks (via class enrollment)
    if class_enrollment_ids:
        eids_sql = _safe_uuid_list(class_enrollment_ids)
        r = db.execute(
            sa.text(
                f"DELETE FROM core.term_report_remarks WHERE student_enrollment_id IN ({eids_sql}) AND tenant_id = :tid"
            ),
            {"tid": tid_str},
        )
        counts["report_remarks"] = r.rowcount

    # 13. IGCSE scores (via class enrollment)
    if class_enrollment_ids:
        eids_sql = _safe_uuid_list(class_enrollment_ids)
        r = db.execute(
            sa.text(
                f"DELETE FROM core.igcse_scores WHERE enrollment_id IN ({eids_sql}) AND tenant_id = :tid"
            ),
            {"tid": tid_str},
        )
        counts["igcse_scores"] = r.rowcount

    # 14. Attendance records
    r = db.execute(
        sa.text(
            "DELETE FROM core.attendance_records WHERE student_id = :sid AND tenant_id = :tid"
        ),
        {"sid": sid_str, "tid": tid_str},
    )
    counts["attendance_records"] = r.rowcount

    # 15. Student fee assignments (keyed by class enrollment_id)
    if class_enrollment_ids:
        eids_sql = _safe_uuid_list(class_enrollment_ids)
        r = db.execute(
            sa.text(
                f"DELETE FROM core.student_fee_assignments WHERE enrollment_id IN ({eids_sql}) AND tenant_id = :tid"
            ),
            {"tid": tid_str},
        )
        counts["fee_assignments"] = r.rowcount

    # 16. Scholarship allocations — nullify student_id (preserve the scholarship record)
    r = db.execute(
        sa.text(
            "UPDATE core.scholarship_allocations SET student_id = NULL WHERE student_id = :sid AND tenant_id = :tid"
        ),
        {"sid": sid_str, "tid": tid_str},
    )
    counts["scholarship_allocations_cleared"] = r.rowcount

    # 17. Discipline student links
    r = db.execute(
        sa.text(
            "DELETE FROM core.discipline_students WHERE student_id = :sid AND tenant_id = :tid"
        ),
        {"sid": sid_str, "tid": tid_str},
    )
    counts["discipline_links"] = r.rowcount

    # 18. Parent-student links
    r = db.execute(
        sa.text(
            "DELETE FROM core.parent_students WHERE student_id = :sid AND tenant_id = :tid"
        ),
        {"sid": sid_str, "tid": tid_str},
    )
    counts["parent_links"] = r.rowcount

    # 19. Class enrollments
    r = db.execute(
        sa.text(
            "DELETE FROM core.student_class_enrollments WHERE student_id = :sid AND tenant_id = :tid"
        ),
        {"sid": sid_str, "tid": tid_str},
    )
    counts["class_enrollments"] = r.rowcount

    # 20. Delete the student — CASCADE handles:
    #     emergency_contacts, documents, carry_forward_balances, cbc_assessments
    r = db.execute(
        sa.text(
            "DELETE FROM core.students WHERE id = :sid AND tenant_id = :tid"
        ),
        {"sid": sid_str, "tid": tid_str},
    )
    counts["student"] = r.rowcount

    db.flush()

    return {
        "ok": True,
        "deleted_student_name": student_name,
        "admission_no": admission_no,
        "records_removed": counts,
    }
