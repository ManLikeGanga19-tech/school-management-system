"""Reports API — Phase 3A (8-4-4 Term Report Cards).

Endpoints:

  GET  /reports/8-4-4/classes/{class_code}/term/{term_id}
         — class results overview, all students ranked by position

  GET  /reports/8-4-4/enrollments/{enrollment_id}/term/{term_id}
         — full report card for one student (subjects, grades, remarks)

  PUT  /reports/8-4-4/enrollments/{enrollment_id}/term/{term_id}/remarks
         — save / update class-teacher + principal remarks

  POST /reports/8-4-4/classes/{class_code}/term/{term_id}/publish
         — mark all DRAFT remarks in the class as PUBLISHED

  GET  /reports/8-4-4/enrollments/{enrollment_id}/term/{term_id}/pdf
         — download the report card as a PDF (A4)
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_tenant, require_permission

from .schemas import (
    ClassResultRow,
    ReportCardOut,
    RemarksOut,
    RemarksUpsertIn,
    SubjectResultOut,
    _VALID_CONDUCT,
)

router = APIRouter()

# ── 8-4-4 grade helpers ───────────────────────────────────────────────────────

_GRADE_SCALE = [
    (80, "A",  12),
    (75, "A-", 11),
    (70, "B+", 10),
    (65, "B",   9),
    (60, "B-",  8),
    (55, "C+",  7),
    (50, "C",   6),
    (45, "C-",  5),
    (40, "D+",  4),
    (35, "D",   3),
    (30, "D-",  2),
    (0,  "E",   1),
]

_MEAN_GRADE_POINTS = [
    (11.5, "A"),
    (10.5, "A-"),
    (9.5,  "B+"),
    (8.5,  "B"),
    (7.5,  "B-"),
    (6.5,  "C+"),
    (5.5,  "C"),
    (4.5,  "C-"),
    (3.5,  "D+"),
    (2.5,  "D"),
    (1.5,  "D-"),
    (0.0,  "E"),
]


def _grade_for_pct(pct: float) -> tuple[str, int]:
    for threshold, letter, pts in _GRADE_SCALE:
        if pct >= threshold:
            return letter, pts
    return "E", 1


def _mean_grade(mean_pts: float) -> str:
    for threshold, letter in _MEAN_GRADE_POINTS:
        if mean_pts >= threshold:
            return letter
    return "E"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _str(v: object) -> str | None:
    return str(v) if v is not None else None


def _require_term(db: Session, *, term_id: UUID, tenant_id: UUID) -> dict:
    row = db.execute(
        sa.text(
            "SELECT id, code, name FROM core.tenant_terms "
            "WHERE id = :id AND tenant_id = :tid LIMIT 1"
        ),
        {"id": str(term_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Term not found")
    return dict(row)


def _require_enrollment(db: Session, *, enrollment_id: UUID, tenant_id: UUID) -> dict:
    row = db.execute(
        sa.text(
            "SELECT id, student_id, status FROM core.enrollments "
            "WHERE id = :id AND tenant_id = :tid LIMIT 1"
        ),
        {"id": str(enrollment_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    return dict(row)


def _student_info(db: Session, *, student_id: str | None, tenant_id: UUID) -> dict:
    if not student_id:
        return {"student_name": "Unknown Student", "admission_no": None, "gender": None}
    row = db.execute(
        sa.text(
            "SELECT first_name || ' ' || last_name AS student_name, admission_no, gender "
            "FROM core.students WHERE id = :id AND tenant_id = :tid LIMIT 1"
        ),
        {"id": str(student_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not row:
        return {"student_name": "Unknown Student", "admission_no": None, "gender": None}
    return dict(row)


def _get_marks(db: Session, *, enrollment_id: UUID, term_id: UUID, tenant_id: UUID) -> list[SubjectResultOut]:
    """Aggregate all exam marks for one enrollment in a term."""
    rows = db.execute(
        sa.text(
            """
            SELECT
                em.subject_id,
                ts.name AS subject_name,
                SUM(em.marks_obtained) AS total_marks,
                SUM(em.max_marks)      AS total_max,
                MAX(em.remarks)        AS remarks
            FROM core.tenant_exam_marks em
            JOIN core.tenant_exams e  ON e.id  = em.exam_id
            JOIN core.tenant_subjects ts ON ts.id = em.subject_id
            WHERE em.student_enrollment_id = :eid
              AND em.tenant_id = :tid
              AND e.term_id    = :term_id
            GROUP BY em.subject_id, ts.name
            ORDER BY ts.name ASC
            """
        ),
        {"eid": str(enrollment_id), "tid": str(tenant_id), "term_id": str(term_id)},
    ).mappings().all()

    results = []
    for r in rows:
        total_m = float(r["total_marks"] or 0)
        total_x = float(r["total_max"] or 100)
        pct = round(total_m / total_x * 100, 2) if total_x else 0.0
        grade, pts = _grade_for_pct(pct)
        results.append(SubjectResultOut(
            subject_id=_str(r["subject_id"]) or "",
            subject_name=str(r["subject_name"]),
            marks_obtained=round(total_m, 2),
            max_marks=round(total_x, 2),
            percentage=pct,
            grade=grade,
            grade_points=pts,
            remarks=_str(r.get("remarks")),
        ))
    return results


def _get_remarks(db: Session, *, enrollment_id: UUID, term_id: UUID, tenant_id: UUID) -> dict | None:
    row = db.execute(
        sa.text(
            "SELECT id, class_teacher_comment, principal_comment, conduct, "
            "CAST(next_term_begins AS TEXT) AS next_term_begins, "
            "status, CAST(published_at AS TEXT) AS published_at "
            "FROM core.term_report_remarks "
            "WHERE student_enrollment_id = :eid AND term_id = :term_id AND tenant_id = :tid LIMIT 1"
        ),
        {"eid": str(enrollment_id), "term_id": str(term_id), "tid": str(tenant_id)},
    ).mappings().first()
    return dict(row) if row else None


def _build_report_card(
    db: Session,
    *,
    enrollment_id: UUID,
    tenant_id: UUID,
    term: dict,
    all_class_means: dict[str, float] | None = None,
) -> ReportCardOut:
    enr = _require_enrollment(db, enrollment_id=enrollment_id, tenant_id=tenant_id)
    info = _student_info(db, student_id=_str(enr.get("student_id")), tenant_id=tenant_id)

    subjects = _get_marks(db, enrollment_id=enrollment_id, term_id=UUID(str(term["id"])), tenant_id=tenant_id)

    # Aggregate
    n = len(subjects)
    mean_pct = round(sum(s.percentage for s in subjects) / n, 2) if n else 0.0
    mean_pts = round(sum(s.grade_points for s in subjects) / n, 2) if n else 0.0
    total_marks = round(sum(s.marks_obtained for s in subjects), 2)
    overall_grade = _mean_grade(mean_pts) if n else "—"

    # Attendance (Phase 2)
    att = db.execute(
        sa.text(
            """
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE ar.status = 'PRESENT') AS present
            FROM core.attendance_records ar
            JOIN core.attendance_sessions sess ON sess.id = ar.session_id
            JOIN core.student_class_enrollments sce ON sce.student_id = ar.student_id
                AND sce.tenant_id = ar.tenant_id
                AND sce.term_id = :term_id
            WHERE ar.student_id = (
                    SELECT student_id FROM core.enrollments
                    WHERE id = :eid AND tenant_id = :tid LIMIT 1
                )
              AND ar.tenant_id = :tid
              AND sess.term_id = :term_id
              AND sess.status  = 'FINALIZED'
            """
        ),
        {"eid": str(enrollment_id), "tid": str(tenant_id), "term_id": str(term["id"])},
    ).mappings().first()

    att_total   = int(att["total"] or 0) if att else None
    att_present = int(att["present"] or 0) if att else None
    att_rate    = round(att_present / att_total, 4) if att_total else None

    # Class code (from marks table or remarks)
    class_code_row = db.execute(
        sa.text(
            "SELECT class_code FROM core.tenant_exam_marks "
            "WHERE student_enrollment_id = :eid AND tenant_id = :tid LIMIT 1"
        ),
        {"eid": str(enrollment_id), "tid": str(tenant_id)},
    ).mappings().first()
    class_code = str(class_code_row["class_code"]) if class_code_row else ""

    # Position
    position = None
    out_of = None
    if all_class_means is not None and str(enrollment_id) in all_class_means:
        sorted_means = sorted(all_class_means.values(), reverse=True)
        my_mean = all_class_means[str(enrollment_id)]
        position = sorted_means.index(my_mean) + 1
        out_of = len(all_class_means)

    remarks = _get_remarks(db, enrollment_id=enrollment_id, term_id=UUID(str(term["id"])), tenant_id=tenant_id)

    return ReportCardOut(
        enrollment_id=str(enrollment_id),
        student_id=_str(enr.get("student_id")),
        student_name=str(info.get("student_name") or ""),
        admission_no=_str(info.get("admission_no")),
        class_code=class_code,
        term_id=str(term["id"]),
        term_name=str(term["name"]),
        subjects=subjects,
        total_marks=total_marks,
        mean_percentage=mean_pct,
        mean_grade_points=mean_pts,
        mean_grade=overall_grade,
        position=position,
        out_of=out_of,
        attendance_total=att_total if att_total is not None and att_total > 0 else None,
        attendance_present=att_present,
        attendance_rate=att_rate,
        remarks_id=_str(remarks["id"]) if remarks else None,
        class_teacher_comment=_str(remarks.get("class_teacher_comment")) if remarks else None,
        principal_comment=_str(remarks.get("principal_comment")) if remarks else None,
        conduct=_str(remarks.get("conduct")) if remarks else None,
        next_term_begins=_str(remarks.get("next_term_begins")) if remarks else None,
        status=str(remarks["status"]) if remarks else "DRAFT",
    )


def _get_class_enrollment_ids(db: Session, *, class_code: str, term_id: UUID, tenant_id: UUID) -> list[str]:
    """Return all enrollment IDs that have marks for this class + term."""
    rows = db.execute(
        sa.text(
            """
            SELECT DISTINCT em.student_enrollment_id
            FROM core.tenant_exam_marks em
            JOIN core.tenant_exams e ON e.id = em.exam_id
            WHERE em.class_code = :class_code
              AND em.tenant_id  = :tid
              AND e.term_id     = :term_id
            """
        ),
        {"class_code": class_code, "tid": str(tenant_id), "term_id": str(term_id)},
    ).fetchall()
    return [str(r[0]) for r in rows]


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get(
    "/8-4-4/classes/{class_code}/term/{term_id}",
    response_model=list[ClassResultRow],
    dependencies=[Depends(require_permission("reports.view"))],
)
def get_class_results(
    class_code: str,
    term_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    term = _require_term(db, term_id=term_id, tenant_id=tenant.id)
    enrollment_ids = _get_class_enrollment_ids(db, class_code=class_code, term_id=term_id, tenant_id=tenant.id)

    if not enrollment_ids:
        return []

    # Compute mean percentage per enrollment for ranking
    class_means: dict[str, float] = {}
    rows_data: list[dict] = []

    for eid in enrollment_ids:
        enr = db.execute(
            sa.text("SELECT id, student_id FROM core.enrollments WHERE id = :id AND tenant_id = :tid LIMIT 1"),
            {"id": eid, "tid": str(tenant.id)},
        ).mappings().first()
        if not enr:
            continue

        subjects = _get_marks(db, enrollment_id=UUID(eid), term_id=term_id, tenant_id=tenant.id)
        n = len(subjects)
        mean_pct = round(sum(s.percentage for s in subjects) / n, 2) if n else 0.0
        mean_pts = round(sum(s.grade_points for s in subjects) / n, 2) if n else 0.0
        total_marks = round(sum(s.marks_obtained for s in subjects), 2)
        overall_grade = _mean_grade(mean_pts) if n else "—"

        info = _student_info(db, student_id=_str(enr.get("student_id")), tenant_id=tenant.id)
        class_means[eid] = mean_pct
        rows_data.append({
            "enrollment_id": eid,
            "student_id": _str(enr.get("student_id")),
            "student_name": str(info.get("student_name") or ""),
            "admission_no": _str(info.get("admission_no")),
            "total_marks": total_marks,
            "mean_percentage": mean_pct,
            "mean_grade": overall_grade,
            "subjects_sat": n,
        })

    # Rank by mean percentage (descending)
    rows_data.sort(key=lambda r: r["mean_percentage"], reverse=True)
    results = []
    for pos, r in enumerate(rows_data, start=1):
        results.append(ClassResultRow(
            enrollment_id=r["enrollment_id"],
            student_id=r["student_id"],
            student_name=r["student_name"],
            admission_no=r["admission_no"],
            total_marks=r["total_marks"],
            mean_percentage=r["mean_percentage"],
            mean_grade=r["mean_grade"],
            position=pos,
            subjects_sat=r["subjects_sat"],
        ))
    return results


@router.get(
    "/8-4-4/enrollments/{enrollment_id}/term/{term_id}",
    response_model=ReportCardOut,
    dependencies=[Depends(require_permission("reports.view"))],
)
def get_student_report_card(
    enrollment_id: UUID,
    term_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    term = _require_term(db, term_id=term_id, tenant_id=tenant.id)

    # Get class_code from marks to compute position within class
    cc_row = db.execute(
        sa.text(
            "SELECT class_code FROM core.tenant_exam_marks "
            "WHERE student_enrollment_id = :eid AND tenant_id = :tid LIMIT 1"
        ),
        {"eid": str(enrollment_id), "tid": str(tenant.id)},
    ).mappings().first()
    class_code = str(cc_row["class_code"]) if cc_row else ""

    class_means: dict[str, float] = {}
    if class_code:
        eids = _get_class_enrollment_ids(db, class_code=class_code, term_id=term_id, tenant_id=tenant.id)
        for eid in eids:
            subjs = _get_marks(db, enrollment_id=UUID(eid), term_id=term_id, tenant_id=tenant.id)
            n = len(subjs)
            class_means[eid] = round(sum(s.percentage for s in subjs) / n, 2) if n else 0.0

    return _build_report_card(
        db,
        enrollment_id=enrollment_id,
        tenant_id=tenant.id,
        term=term,
        all_class_means=class_means or None,
    )


@router.put(
    "/8-4-4/enrollments/{enrollment_id}/term/{term_id}/remarks",
    response_model=RemarksOut,
    dependencies=[Depends(require_permission("reports.edit"))],
)
def upsert_remarks(
    enrollment_id: UUID,
    term_id: UUID,
    payload: RemarksUpsertIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_term(db, term_id=term_id, tenant_id=tenant.id)
    enr = _require_enrollment(db, enrollment_id=enrollment_id, tenant_id=tenant.id)

    if payload.conduct and payload.conduct.strip().upper() not in _VALID_CONDUCT:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid conduct. Must be one of: {', '.join(sorted(_VALID_CONDUCT))}",
        )

    # Determine class_code from existing marks
    cc_row = db.execute(
        sa.text(
            "SELECT class_code FROM core.tenant_exam_marks "
            "WHERE student_enrollment_id = :eid AND tenant_id = :tid LIMIT 1"
        ),
        {"eid": str(enrollment_id), "tid": str(tenant.id)},
    ).mappings().first()
    class_code = str(cc_row["class_code"]) if cc_row else ""

    existing = _get_remarks(db, enrollment_id=enrollment_id, term_id=term_id, tenant_id=tenant.id)
    now = _now_utc()

    if existing:
        if existing.get("status") == "PUBLISHED":
            raise HTTPException(
                status_code=409,
                detail="Report card is already PUBLISHED. Revoke publication before editing.",
            )
        updates = ["updated_at = :now"]
        params: dict = {
            "eid": str(enrollment_id),
            "tid": str(tenant.id),
            "term_id": str(term_id),
            "now": now,
        }
        if payload.class_teacher_comment is not None:
            updates.append("class_teacher_comment = :ct")
            params["ct"] = payload.class_teacher_comment.strip() or None
        if payload.principal_comment is not None:
            updates.append("principal_comment = :pc")
            params["pc"] = payload.principal_comment.strip() or None
        if payload.conduct is not None:
            updates.append("conduct = :conduct")
            params["conduct"] = payload.conduct.strip().upper() or None
        if payload.next_term_begins is not None:
            updates.append("next_term_begins = :ntb")
            params["ntb"] = payload.next_term_begins.strip() or None

        db.execute(
            sa.text(
                f"UPDATE core.term_report_remarks SET {', '.join(updates)} "
                "WHERE student_enrollment_id = :eid AND term_id = :term_id AND tenant_id = :tid"
            ),
            params,
        )
    else:
        new_id = str(uuid4())
        db.execute(
            sa.text(
                """
                INSERT INTO core.term_report_remarks
                    (id, tenant_id, student_enrollment_id, term_id, class_code,
                     class_teacher_comment, principal_comment, conduct, next_term_begins)
                VALUES
                    (:id, :tid, :eid, :term_id, :class_code,
                     :ct, :pc, :conduct, :ntb)
                """
            ),
            {
                "id": new_id,
                "tid": str(tenant.id),
                "eid": str(enrollment_id),
                "term_id": str(term_id),
                "class_code": class_code,
                "ct": (payload.class_teacher_comment or "").strip() or None,
                "pc": (payload.principal_comment or "").strip() or None,
                "conduct": (payload.conduct or "").strip().upper() or None,
                "ntb": (payload.next_term_begins or "").strip() or None,
            },
        )

    db.commit()

    updated = _get_remarks(db, enrollment_id=enrollment_id, term_id=term_id, tenant_id=tenant.id)
    return RemarksOut(
        id=_str(updated["id"]) or "",
        enrollment_id=str(enrollment_id),
        term_id=str(term_id),
        class_code=class_code,
        class_teacher_comment=_str(updated.get("class_teacher_comment")),
        principal_comment=_str(updated.get("principal_comment")),
        conduct=_str(updated.get("conduct")),
        next_term_begins=_str(updated.get("next_term_begins")),
        status=str(updated["status"]),
        published_at=_str(updated.get("published_at")),
    )


@router.post(
    "/8-4-4/classes/{class_code}/term/{term_id}/publish",
    dependencies=[Depends(require_permission("reports.publish"))],
)
def publish_class_report_cards(
    class_code: str,
    term_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    _require_term(db, term_id=term_id, tenant_id=tenant.id)
    now = _now_utc()

    result = db.execute(
        sa.text(
            """
            UPDATE core.term_report_remarks
            SET status = 'PUBLISHED',
                published_at = :now,
                published_by_user_id = :uid,
                updated_at = :now
            WHERE tenant_id  = :tid
              AND term_id    = :term_id
              AND class_code = :class_code
              AND status     = 'DRAFT'
            """
        ),
        {
            "tid": str(tenant.id),
            "term_id": str(term_id),
            "class_code": class_code,
            "now": now,
            "uid": str(user.id) if user else None,
        },
    )
    db.commit()
    published_count = result.rowcount or 0
    return {"published": published_count, "class_code": class_code}


@router.get(
    "/8-4-4/enrollments/{enrollment_id}/term/{term_id}/pdf",
    dependencies=[Depends(require_permission("reports.view"))],
)
def download_report_card_pdf(
    enrollment_id: UUID,
    term_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    from app.utils.report_card_pdf import generate_report_card_pdf

    term = _require_term(db, term_id=term_id, tenant_id=tenant.id)

    # Gather the same data as the JSON endpoint
    cc_row = db.execute(
        sa.text(
            "SELECT class_code FROM core.tenant_exam_marks "
            "WHERE student_enrollment_id = :eid AND tenant_id = :tid LIMIT 1"
        ),
        {"eid": str(enrollment_id), "tid": str(tenant.id)},
    ).mappings().first()
    class_code = str(cc_row["class_code"]) if cc_row else ""

    class_means: dict[str, float] = {}
    if class_code:
        eids = _get_class_enrollment_ids(db, class_code=class_code, term_id=term_id, tenant_id=tenant.id)
        for eid in eids:
            subjs = _get_marks(db, enrollment_id=UUID(eid), term_id=term_id, tenant_id=tenant.id)
            n = len(subjs)
            class_means[eid] = round(sum(s.percentage for s in subjs) / n, 2) if n else 0.0

    card = _build_report_card(
        db,
        enrollment_id=enrollment_id,
        tenant_id=tenant.id,
        term=term,
        all_class_means=class_means or None,
    )

    # Tenant name for school header
    tenant_name = getattr(tenant, "name", "School")

    pdf_data = {
        "school_name": tenant_name,
        "school_address": "",
        "term_name": str(term["name"]),
        "academic_year": "",
        "student_name": card.student_name,
        "admission_no": card.admission_no,
        "class_code": card.class_code,
        "gender": None,
        "position": card.position,
        "out_of": card.out_of,
        "subjects": [
            {
                "name": s.subject_name,
                "marks": s.marks_obtained,
                "max_marks": s.max_marks,
                "grade": s.grade,
                "remarks": s.remarks,
            }
            for s in card.subjects
        ],
        "attendance_total": card.attendance_total,
        "attendance_present": card.attendance_present,
        "class_teacher_comment": card.class_teacher_comment,
        "principal_comment": card.principal_comment,
        "conduct": card.conduct,
        "next_term_begins": card.next_term_begins,
    }

    pdf_bytes = generate_report_card_pdf(pdf_data)
    filename = f"report-{card.admission_no or enrollment_id}-{term['name'].replace(' ', '-')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
