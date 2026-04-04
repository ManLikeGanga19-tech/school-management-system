"""IGCSE Assessment service."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.igcse import IgcseSubject, IgcseScore


# ── Subjects ──────────────────────────────────────────────────────────────────

def list_subjects(db: Session, *, tenant_id: UUID, active_only: bool = True) -> list[IgcseSubject]:
    q = select(IgcseSubject).where(IgcseSubject.tenant_id == tenant_id)
    if active_only:
        q = q.where(IgcseSubject.is_active.is_(True))
    return list(db.execute(q.order_by(IgcseSubject.display_order, IgcseSubject.name)).scalars().all())


def create_subject(db: Session, *, tenant_id: UUID, data: dict[str, Any]) -> IgcseSubject:
    code = (data.get("code") or "").strip().upper()
    if not code:
        raise ValueError("Subject code is required")
    row = IgcseSubject(
        tenant_id=tenant_id,
        name=(data.get("name") or "").strip(),
        code=code,
        display_order=int(data.get("display_order") or 0),
        is_active=bool(data.get("is_active", True)),
    )
    db.add(row)
    db.flush()
    return row


def update_subject(db: Session, *, tenant_id: UUID, subject_id: UUID, updates: dict[str, Any]) -> IgcseSubject:
    row = db.execute(
        select(IgcseSubject).where(
            IgcseSubject.id == subject_id,
            IgcseSubject.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Subject not found")
    for key in ("name", "code", "display_order", "is_active"):
        if key in updates and updates[key] is not None:
            if key == "code":
                setattr(row, key, str(updates[key]).strip().upper())
            else:
                setattr(row, key, updates[key])
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    return row


# ── Scores ────────────────────────────────────────────────────────────────────

VALID_GRADES = {"A*", "A", "B", "C", "D", "E", "F", "G", "U"}


def bulk_upsert_scores(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID,
    term_id: UUID,
    actor_user_id: UUID | None,
    items: list[dict[str, Any]],
) -> list[IgcseScore]:
    # Resolve student_id from enrollment
    sce = db.execute(
        sa.text(
            "SELECT student_id FROM core.student_class_enrollments WHERE id = :eid AND tenant_id = :tid"
        ),
        {"eid": str(enrollment_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not sce:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    student_id = sce["student_id"]

    now = datetime.now(timezone.utc)
    results: list[IgcseScore] = []

    for item in items:
        subject_id = item.get("subject_id")
        if not subject_id:
            continue
        grade = (item.get("grade") or "").strip().upper() or None
        if grade and grade not in VALID_GRADES:
            raise ValueError(f"Invalid IGCSE grade: {grade}")

        existing = db.execute(
            select(IgcseScore).where(
                IgcseScore.tenant_id == tenant_id,
                IgcseScore.enrollment_id == enrollment_id,
                IgcseScore.subject_id == subject_id,
                IgcseScore.term_id == term_id,
            )
        ).scalar_one_or_none()

        if existing:
            existing.grade = grade
            existing.percentage = item.get("percentage")
            existing.effort = str(item.get("effort") or "") or None
            existing.teacher_comment = item.get("teacher_comment")
            existing.assessed_by_user_id = actor_user_id
            existing.assessed_at = now
            existing.updated_at = now
            results.append(existing)
        else:
            row = IgcseScore(
                tenant_id=tenant_id,
                enrollment_id=enrollment_id,
                student_id=student_id,
                subject_id=subject_id,
                term_id=term_id,
                grade=grade,
                percentage=item.get("percentage"),
                effort=str(item.get("effort") or "") or None,
                teacher_comment=item.get("teacher_comment"),
                assessed_by_user_id=actor_user_id,
                assessed_at=now,
            )
            db.add(row)
            results.append(row)

    db.flush()
    return results


def list_scores(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID | None = None,
    term_id: UUID | None = None,
    student_id: UUID | None = None,
) -> list[IgcseScore]:
    q = select(IgcseScore).where(IgcseScore.tenant_id == tenant_id)
    if enrollment_id:
        q = q.where(IgcseScore.enrollment_id == enrollment_id)
    if term_id:
        q = q.where(IgcseScore.term_id == term_id)
    if student_id:
        q = q.where(IgcseScore.student_id == student_id)
    return list(db.execute(q.order_by(IgcseScore.assessed_at.desc())).scalars().all())


# ── Report ────────────────────────────────────────────────────────────────────

def get_learner_report(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID,
    term_id: UUID,
) -> dict[str, Any]:
    """Build a structured IGCSE report dict for PDF/JSON output."""
    row = db.execute(
        sa.text(
            """
            SELECT
                sce.id          AS enrollment_id,
                sce.student_id,
                s.first_name || ' ' || s.last_name AS student_name,
                s.admission_no,
                s.gender,
                TO_CHAR(s.date_of_birth, 'DD/MM/YYYY') AS date_of_birth,
                tc.name         AS class_name,
                tc.code         AS class_code,
                tt.name         AS term_name,
                tt.start_date   AS term_start_date,
                EXTRACT(YEAR FROM tt.start_date)::text AS academic_year
            FROM core.student_class_enrollments sce
            JOIN core.students s          ON s.id = sce.student_id
            JOIN core.tenant_classes tc   ON tc.id = sce.class_id
            JOIN core.tenant_terms tt     ON tt.id = sce.term_id
            WHERE sce.id = :eid AND sce.tenant_id = :tid
            """
        ),
        {"eid": str(enrollment_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    # Remarks
    remarks_row = db.execute(
        sa.text(
            """
            SELECT class_teacher_comment, principal_comment, conduct,
                   TO_CHAR(next_term_begins, 'DD MMM YYYY') AS next_term_begins
            FROM core.term_report_remarks
            WHERE tenant_id = :tid
              AND student_enrollment_id = :eid
              AND term_id = :trid
            LIMIT 1
            """
        ),
        {"tid": str(tenant_id), "eid": str(enrollment_id), "trid": str(term_id)},
    ).mappings().first()

    next_term_begins = remarks_row["next_term_begins"] if remarks_row else None
    if not next_term_begins and row["term_start_date"]:
        nxt = db.execute(
            sa.text(
                """
                SELECT TO_CHAR(start_date, 'DD MMM YYYY') AS start_date
                FROM core.tenant_terms
                WHERE tenant_id = :tid
                  AND start_date > :cur_start
                ORDER BY start_date ASC
                LIMIT 1
                """
            ),
            {"tid": str(tenant_id), "cur_start": row["term_start_date"]},
        ).mappings().first()
        if nxt:
            next_term_begins = nxt["start_date"]

    # Scores joined with subject names
    scores = db.execute(
        sa.text(
            """
            SELECT
                sc.grade,
                sc.percentage,
                sc.effort,
                sc.teacher_comment,
                sub.name    AS subject_name,
                sub.code    AS subject_code,
                sub.display_order
            FROM core.igcse_scores sc
            JOIN core.igcse_subjects sub ON sub.id = sc.subject_id
            WHERE sc.enrollment_id = :eid
              AND sc.term_id       = :trid
              AND sc.tenant_id     = :tnid
            ORDER BY sub.display_order, sub.name
            """
        ),
        {"eid": str(enrollment_id), "trid": str(term_id), "tnid": str(tenant_id)},
    ).mappings().all()

    subjects = [
        {
            "subject_name": s["subject_name"],
            "subject_code": s["subject_code"],
            "grade": s["grade"] or "",
            "percentage": float(s["percentage"]) if s["percentage"] is not None else None,
            "effort": s["effort"] or "",
            "teacher_comment": s["teacher_comment"] or "",
        }
        for s in scores
    ]

    return {
        "enrollment_id": row["enrollment_id"],
        "student_id": row["student_id"],
        "student_name": row["student_name"],
        "admission_no": row["admission_no"],
        "gender": row["gender"] or "",
        "date_of_birth": row["date_of_birth"] or "",
        "class_name": row["class_name"],
        "class_code": row["class_code"],
        "term_name": row["term_name"],
        "academic_year": row["academic_year"] or "",
        "class_teacher_comment": (remarks_row["class_teacher_comment"] if remarks_row else None) or "",
        "principal_comment": (remarks_row["principal_comment"] if remarks_row else None) or "",
        "conduct": (remarks_row["conduct"] if remarks_row else None) or "",
        "next_term_begins": next_term_begins or "",
        "subjects": subjects,
    }
