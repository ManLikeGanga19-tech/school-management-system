"""Attendance API — Phase 2.

Endpoints:

  Roster management (requires attendance.enroll):
    GET    /attendance/classes/{class_id}/roster          — enrolled students
    POST   /attendance/classes/{class_id}/enroll          — enroll a student
    PATCH  /attendance/classes/{class_id}/roster/{id}     — withdraw/transfer

  Session lifecycle (attendance.mark / attendance.view):
    GET    /attendance/sessions                           — list sessions
    POST   /attendance/sessions                           — create session
    GET    /attendance/sessions/{session_id}              — session + records
    POST   /attendance/sessions/{session_id}/records      — bulk set records
    POST   /attendance/sessions/{session_id}/submit       — DRAFT → SUBMITTED
    POST   /attendance/sessions/{session_id}/finalize     — SUBMITTED → FINALIZED

  Corrections (attendance.correct):
    PATCH  /attendance/sessions/{session_id}/records/{record_id} — correct record

  Reports (attendance.reports):
    GET    /attendance/students/{student_id}/summary      — student summary
    GET    /attendance/classes/{class_id}/report          — class report
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_tenant, require_permission

from .schemas import (
    AttendanceRecordOut,
    BulkRecordsIn,
    ClassRosterReportRow,
    CorrectRecordIn,
    EnrollmentOut,
    EnrollStudentIn,
    SessionCreateIn,
    SessionOut,
    StudentAttendanceSummary,
    WithdrawEnrollmentIn,
    _VALID_ATTENDANCE_STATUSES,
    _VALID_ENROLLMENT_STATUSES,
    _VALID_SESSION_TYPES,
)

router = APIRouter()

_SESSION_TRANSITIONS = {
    "DRAFT": "SUBMITTED",
    "SUBMITTED": "FINALIZED",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _str(v: object) -> str | None:
    return str(v) if v is not None else None


def _require_class(db: Session, *, class_id: UUID, tenant_id: UUID) -> dict:
    row = db.execute(
        sa.text(
            "SELECT id, code, name FROM core.tenant_classes "
            "WHERE id = :id AND tenant_id = :tid AND is_active = true LIMIT 1"
        ),
        {"id": str(class_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Class not found or inactive")
    return dict(row)


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


def _require_enrollment(
    db: Session, *, enrollment_id: UUID, tenant_id: UUID
) -> dict:
    row = db.execute(
        sa.text(
            "SELECT id, student_id, class_id, term_id, status "
            "FROM core.student_class_enrollments "
            "WHERE id = :id AND tenant_id = :tid LIMIT 1"
        ),
        {"id": str(enrollment_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    return dict(row)


def _require_session(
    db: Session, *, session_id: UUID, tenant_id: UUID
) -> dict:
    row = db.execute(
        sa.text(
            """
            SELECT id, tenant_id, class_id, term_id, subject_id, session_date,
                   session_type, period_number, status, notes,
                   marked_by_user_id, submitted_at,
                   finalized_by_user_id, finalized_at,
                   CAST(created_at AS TEXT) AS created_at,
                   CAST(updated_at AS TEXT) AS updated_at
            FROM core.attendance_sessions
            WHERE id = :id AND tenant_id = :tid LIMIT 1
            """
        ),
        {"id": str(session_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    return dict(row)


def _require_record(
    db: Session, *, record_id: UUID, session_id: UUID, tenant_id: UUID
) -> dict:
    row = db.execute(
        sa.text(
            "SELECT id, session_id, enrollment_id, student_id, status, notes, "
            "original_status, corrected_by_user_id, corrected_at, "
            "CAST(created_at AS TEXT) AS created_at, "
            "CAST(updated_at AS TEXT) AS updated_at "
            "FROM core.attendance_records "
            "WHERE id = :id AND session_id = :sid AND tenant_id = :tid LIMIT 1"
        ),
        {"id": str(record_id), "sid": str(session_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Attendance record not found")
    return dict(row)


def _fetch_records_for_session(db: Session, *, session_id: UUID, tenant_id: UUID) -> list[AttendanceRecordOut]:
    rows = db.execute(
        sa.text(
            """
            SELECT ar.id, ar.tenant_id, ar.session_id, ar.enrollment_id,
                   ar.student_id, ar.status, ar.notes,
                   ar.original_status, ar.corrected_by_user_id,
                   CAST(ar.corrected_at AS TEXT) AS corrected_at,
                   CAST(ar.created_at AS TEXT) AS created_at,
                   CAST(ar.updated_at AS TEXT) AS updated_at,
                   s.first_name || ' ' || s.last_name AS student_name,
                   s.admission_no
            FROM core.attendance_records ar
            JOIN core.students s ON s.id = ar.student_id
            WHERE ar.session_id = :sid AND ar.tenant_id = :tid
            ORDER BY s.last_name ASC, s.first_name ASC
            """
        ),
        {"sid": str(session_id), "tid": str(tenant_id)},
    ).mappings().all()

    return [
        AttendanceRecordOut(
            id=_str(r["id"]) or "",
            tenant_id=_str(r["tenant_id"]) or "",
            session_id=_str(r["session_id"]) or "",
            enrollment_id=_str(r["enrollment_id"]) or "",
            student_id=_str(r["student_id"]) or "",
            status=str(r["status"]),
            notes=_str(r.get("notes")),
            original_status=_str(r.get("original_status")),
            corrected_by_user_id=_str(r.get("corrected_by_user_id")),
            corrected_at=_str(r.get("corrected_at")),
            created_at=_str(r.get("created_at")),
            updated_at=_str(r.get("updated_at")),
            student_name=_str(r.get("student_name")),
            admission_no=_str(r.get("admission_no")),
        )
        for r in rows
    ]


def _session_out(row: dict, records: list[AttendanceRecordOut] | None = None) -> SessionOut:
    return SessionOut(
        id=_str(row["id"]) or "",
        tenant_id=_str(row["tenant_id"]) or "",
        class_id=_str(row["class_id"]) or "",
        term_id=_str(row["term_id"]) or "",
        subject_id=_str(row.get("subject_id")),
        session_date=str(row["session_date"]),
        session_type=str(row["session_type"]),
        period_number=row.get("period_number"),
        status=str(row["status"]),
        notes=_str(row.get("notes")),
        marked_by_user_id=_str(row.get("marked_by_user_id")),
        submitted_at=_str(row.get("submitted_at")),
        finalized_by_user_id=_str(row.get("finalized_by_user_id")),
        finalized_at=_str(row.get("finalized_at")),
        created_at=_str(row.get("created_at")),
        updated_at=_str(row.get("updated_at")),
        records=records,
    )


# ── Class roster (enrollments) ─────────────────────────────────────────────────

@router.get(
    "/classes/{class_id}/roster",
    response_model=list[EnrollmentOut],
    dependencies=[Depends(require_permission("attendance.view"))],
)
def get_class_roster(
    class_id: UUID,
    term_id: UUID = Query(...),
    status: str = Query(default="ACTIVE"),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_class(db, class_id=class_id, tenant_id=tenant.id)
    _require_term(db, term_id=term_id, tenant_id=tenant.id)

    rows = db.execute(
        sa.text(
            """
            SELECT sce.id, sce.tenant_id, sce.student_id, sce.class_id,
                   sce.term_id, sce.status,
                   CAST(sce.enrolled_at AS TEXT) AS enrolled_at,
                   CAST(sce.withdrawn_at AS TEXT) AS withdrawn_at,
                   sce.notes,
                   s.first_name || ' ' || s.last_name AS student_name,
                   s.admission_no
            FROM core.student_class_enrollments sce
            JOIN core.students s ON s.id = sce.student_id
            WHERE sce.class_id = :class_id
              AND sce.term_id = :term_id
              AND sce.tenant_id = :tid
              AND sce.status = :status
            ORDER BY s.last_name ASC, s.first_name ASC
            """
        ),
        {
            "class_id": str(class_id),
            "term_id": str(term_id),
            "tid": str(tenant.id),
            "status": status.upper(),
        },
    ).mappings().all()

    return [
        EnrollmentOut(
            id=_str(r["id"]) or "",
            tenant_id=_str(r["tenant_id"]) or "",
            student_id=_str(r["student_id"]) or "",
            class_id=_str(r["class_id"]) or "",
            term_id=_str(r["term_id"]) or "",
            status=str(r["status"]),
            enrolled_at=_str(r.get("enrolled_at")),
            withdrawn_at=_str(r.get("withdrawn_at")),
            notes=_str(r.get("notes")),
            student_name=_str(r.get("student_name")),
            admission_no=_str(r.get("admission_no")),
        )
        for r in rows
    ]


@router.post(
    "/classes/{class_id}/enroll",
    response_model=EnrollmentOut,
    status_code=201,
    dependencies=[Depends(require_permission("attendance.enroll"))],
)
def enroll_student(
    class_id: UUID,
    payload: EnrollStudentIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    _require_class(db, class_id=class_id, tenant_id=tenant.id)
    term_id = UUID(payload.term_id)
    _require_term(db, term_id=term_id, tenant_id=tenant.id)

    # Verify student belongs to tenant
    student_row = db.execute(
        sa.text(
            "SELECT id FROM core.students WHERE id = :sid AND tenant_id = :tid LIMIT 1"
        ),
        {"sid": payload.student_id, "tid": str(tenant.id)},
    ).first()
    if not student_row:
        raise HTTPException(status_code=404, detail="Student not found")

    new_id = str(uuid4())
    try:
        db.execute(
            sa.text(
                """
                INSERT INTO core.student_class_enrollments
                    (id, tenant_id, student_id, class_id, term_id, status, notes, created_by_user_id)
                VALUES
                    (:id, :tid, :student_id, :class_id, :term_id, 'ACTIVE', :notes, :created_by)
                """
            ),
            {
                "id": new_id,
                "tid": str(tenant.id),
                "student_id": payload.student_id,
                "class_id": str(class_id),
                "term_id": payload.term_id,
                "notes": (payload.notes or "").strip() or None,
                "created_by": str(user.id) if user else None,
            },
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        if "uq_sce_student_class_term" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail="Student is already enrolled in this class for the selected term",
            )
        raise

    row = db.execute(
        sa.text(
            """
            SELECT sce.id, sce.tenant_id, sce.student_id, sce.class_id,
                   sce.term_id, sce.status,
                   CAST(sce.enrolled_at AS TEXT) AS enrolled_at,
                   CAST(sce.withdrawn_at AS TEXT) AS withdrawn_at,
                   sce.notes,
                   s.first_name || ' ' || s.last_name AS student_name,
                   s.admission_no
            FROM core.student_class_enrollments sce
            JOIN core.students s ON s.id = sce.student_id
            WHERE sce.id = :id
            """
        ),
        {"id": new_id},
    ).mappings().first()

    return EnrollmentOut(
        id=_str(row["id"]) or "",
        tenant_id=_str(row["tenant_id"]) or "",
        student_id=_str(row["student_id"]) or "",
        class_id=_str(row["class_id"]) or "",
        term_id=_str(row["term_id"]) or "",
        status=str(row["status"]),
        enrolled_at=_str(row.get("enrolled_at")),
        withdrawn_at=_str(row.get("withdrawn_at")),
        notes=_str(row.get("notes")),
        student_name=_str(row.get("student_name")),
        admission_no=_str(row.get("admission_no")),
    )


@router.patch(
    "/classes/{class_id}/roster/{enrollment_id}",
    response_model=EnrollmentOut,
    dependencies=[Depends(require_permission("attendance.enroll"))],
)
def update_enrollment_status(
    class_id: UUID,
    enrollment_id: UUID,
    payload: WithdrawEnrollmentIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    enrollment = _require_enrollment(db, enrollment_id=enrollment_id, tenant_id=tenant.id)

    if str(enrollment["class_id"]) != str(class_id):
        raise HTTPException(status_code=404, detail="Enrollment not found for this class")

    new_status = payload.status.strip().upper()
    if new_status not in _VALID_ENROLLMENT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(_VALID_ENROLLMENT_STATUSES))}",
        )

    now = _now_utc()
    withdrawn_at = now if new_status in ("WITHDRAWN", "TRANSFERRED") else None

    db.execute(
        sa.text(
            """
            UPDATE core.student_class_enrollments
            SET status = :status,
                withdrawn_at = COALESCE(withdrawn_at, :withdrawn_at),
                notes = COALESCE(:notes, notes),
                updated_at = :now
            WHERE id = :id AND tenant_id = :tid
            """
        ),
        {
            "id": str(enrollment_id),
            "tid": str(tenant.id),
            "status": new_status,
            "withdrawn_at": withdrawn_at,
            "notes": (payload.notes or "").strip() or None,
            "now": now,
        },
    )
    db.commit()

    row = db.execute(
        sa.text(
            """
            SELECT sce.id, sce.tenant_id, sce.student_id, sce.class_id,
                   sce.term_id, sce.status,
                   CAST(sce.enrolled_at AS TEXT) AS enrolled_at,
                   CAST(sce.withdrawn_at AS TEXT) AS withdrawn_at,
                   sce.notes,
                   s.first_name || ' ' || s.last_name AS student_name,
                   s.admission_no
            FROM core.student_class_enrollments sce
            JOIN core.students s ON s.id = sce.student_id
            WHERE sce.id = :id
            """
        ),
        {"id": str(enrollment_id)},
    ).mappings().first()

    return EnrollmentOut(
        id=_str(row["id"]) or "",
        tenant_id=_str(row["tenant_id"]) or "",
        student_id=_str(row["student_id"]) or "",
        class_id=_str(row["class_id"]) or "",
        term_id=_str(row["term_id"]) or "",
        status=str(row["status"]),
        enrolled_at=_str(row.get("enrolled_at")),
        withdrawn_at=_str(row.get("withdrawn_at")),
        notes=_str(row.get("notes")),
        student_name=_str(row.get("student_name")),
        admission_no=_str(row.get("admission_no")),
    )


# ── Attendance sessions ────────────────────────────────────────────────────────

@router.get(
    "/sessions",
    response_model=list[SessionOut],
    dependencies=[Depends(require_permission("attendance.view"))],
)
def list_sessions(
    class_id: UUID = Query(...),
    term_id: UUID = Query(...),
    session_date: str | None = Query(default=None, description="ISO date, e.g. 2026-03-15"),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    where = [
        "tenant_id = :tid",
        "class_id = :class_id",
        "term_id = :term_id",
    ]
    params: dict = {
        "tid": str(tenant.id),
        "class_id": str(class_id),
        "term_id": str(term_id),
    }

    if session_date:
        where.append("session_date = :session_date")
        params["session_date"] = session_date
    if status:
        where.append("status = :status")
        params["status"] = status.upper()

    rows = db.execute(
        sa.text(
            f"""
            SELECT id, tenant_id, class_id, term_id, subject_id, session_date,
                   session_type, period_number, status, notes,
                   marked_by_user_id, submitted_at,
                   finalized_by_user_id, finalized_at,
                   CAST(created_at AS TEXT) AS created_at,
                   CAST(updated_at AS TEXT) AS updated_at
            FROM core.attendance_sessions
            WHERE {' AND '.join(where)}
            ORDER BY session_date DESC, session_type, period_number NULLS LAST
            """
        ),
        params,
    ).mappings().all()

    return [_session_out(dict(r)) for r in rows]


@router.post(
    "/sessions",
    response_model=SessionOut,
    status_code=201,
    dependencies=[Depends(require_permission("attendance.mark"))],
)
def create_session(
    payload: SessionCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    session_type = payload.session_type.strip().upper()
    if session_type not in _VALID_SESSION_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid session_type. Must be one of: {', '.join(sorted(_VALID_SESSION_TYPES))}",
        )

    class_id = UUID(payload.class_id)
    term_id = UUID(payload.term_id)
    _require_class(db, class_id=class_id, tenant_id=tenant.id)
    _require_term(db, term_id=term_id, tenant_id=tenant.id)

    if session_type == "PERIOD" and not payload.period_number:
        raise HTTPException(
            status_code=400, detail="period_number is required for PERIOD sessions"
        )

    new_id = str(uuid4())
    try:
        db.execute(
            sa.text(
                """
                INSERT INTO core.attendance_sessions
                    (id, tenant_id, class_id, term_id, subject_id, session_date,
                     session_type, period_number, status, notes, marked_by_user_id)
                VALUES
                    (:id, :tid, :class_id, :term_id, :subject_id, :session_date,
                     :session_type, :period_number, 'DRAFT', :notes, :marked_by)
                """
            ),
            {
                "id": new_id,
                "tid": str(tenant.id),
                "class_id": payload.class_id,
                "term_id": payload.term_id,
                "subject_id": payload.subject_id or None,
                "session_date": payload.session_date,
                "session_type": session_type,
                "period_number": payload.period_number,
                "notes": (payload.notes or "").strip() or None,
                "marked_by": str(user.id) if user else None,
            },
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        if "unique" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail="An attendance session of this type already exists for this class on this date",
            )
        raise

    row = _require_session(db, session_id=UUID(new_id), tenant_id=tenant.id)
    return _session_out(row)


@router.get(
    "/sessions/{session_id}",
    response_model=SessionOut,
    dependencies=[Depends(require_permission("attendance.view"))],
)
def get_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    row = _require_session(db, session_id=session_id, tenant_id=tenant.id)
    records = _fetch_records_for_session(db, session_id=session_id, tenant_id=tenant.id)
    return _session_out(row, records=records)


@router.post(
    "/sessions/{session_id}/records",
    response_model=list[AttendanceRecordOut],
    dependencies=[Depends(require_permission("attendance.mark"))],
)
def bulk_set_records(
    session_id: UUID,
    payload: BulkRecordsIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    session = _require_session(db, session_id=session_id, tenant_id=tenant.id)

    if session["status"] == "FINALIZED":
        raise HTTPException(
            status_code=409,
            detail="Session is FINALIZED. Use the correction endpoint to change records.",
        )

    now = _now_utc()
    for rec in payload.records:
        status = rec.status.strip().upper()
        if status not in _VALID_ATTENDANCE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{rec.status}'. Must be one of: {', '.join(sorted(_VALID_ATTENDANCE_STATUSES))}",
            )

        # Find the enrollment for this student in the session's class+term
        enrollment = db.execute(
            sa.text(
                """
                SELECT id FROM core.student_class_enrollments
                WHERE student_id = :student_id
                  AND class_id = :class_id
                  AND term_id = :term_id
                  AND tenant_id = :tid
                  AND status = 'ACTIVE'
                LIMIT 1
                """
            ),
            {
                "student_id": rec.student_id,
                "class_id": str(session["class_id"]),
                "term_id": str(session["term_id"]),
                "tid": str(tenant.id),
            },
        ).first()

        if not enrollment:
            raise HTTPException(
                status_code=422,
                detail=f"Student {rec.student_id} is not actively enrolled in this class for the given term",
            )

        # Upsert: one record per student per session
        db.execute(
            sa.text(
                """
                INSERT INTO core.attendance_records
                    (id, tenant_id, session_id, enrollment_id, student_id, status, notes)
                VALUES
                    (:id, :tid, :session_id, :enrollment_id, :student_id, :status, :notes)
                ON CONFLICT (session_id, student_id) DO UPDATE
                SET status = EXCLUDED.status,
                    notes = EXCLUDED.notes,
                    updated_at = :now
                """
            ),
            {
                "id": str(uuid4()),
                "tid": str(tenant.id),
                "session_id": str(session_id),
                "enrollment_id": str(enrollment[0]),
                "student_id": rec.student_id,
                "status": status,
                "notes": (rec.notes or "").strip() or None,
                "now": now,
            },
        )

    db.commit()
    return _fetch_records_for_session(db, session_id=session_id, tenant_id=tenant.id)


@router.post(
    "/sessions/{session_id}/submit",
    response_model=SessionOut,
    dependencies=[Depends(require_permission("attendance.mark"))],
)
def submit_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    session = _require_session(db, session_id=session_id, tenant_id=tenant.id)

    if session["status"] != "DRAFT":
        raise HTTPException(
            status_code=409,
            detail=f"Session is {session['status']}. Only DRAFT sessions can be submitted.",
        )

    now = _now_utc()
    db.execute(
        sa.text(
            "UPDATE core.attendance_sessions "
            "SET status = 'SUBMITTED', submitted_at = :now, updated_at = :now "
            "WHERE id = :id AND tenant_id = :tid"
        ),
        {"id": str(session_id), "tid": str(tenant.id), "now": now},
    )
    db.commit()

    row = _require_session(db, session_id=session_id, tenant_id=tenant.id)
    return _session_out(row)


@router.post(
    "/sessions/{session_id}/finalize",
    response_model=SessionOut,
    dependencies=[Depends(require_permission("attendance.mark"))],
)
def finalize_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    session = _require_session(db, session_id=session_id, tenant_id=tenant.id)

    if session["status"] != "SUBMITTED":
        raise HTTPException(
            status_code=409,
            detail=f"Session is {session['status']}. Only SUBMITTED sessions can be finalized.",
        )

    now = _now_utc()
    db.execute(
        sa.text(
            """
            UPDATE core.attendance_sessions
            SET status = 'FINALIZED',
                finalized_by_user_id = :finalized_by,
                finalized_at = :now,
                updated_at = :now
            WHERE id = :id AND tenant_id = :tid
            """
        ),
        {
            "id": str(session_id),
            "tid": str(tenant.id),
            "finalized_by": str(user.id) if user else None,
            "now": now,
        },
    )
    db.commit()

    row = _require_session(db, session_id=session_id, tenant_id=tenant.id)
    return _session_out(row)


# ── Corrections ────────────────────────────────────────────────────────────────

@router.patch(
    "/sessions/{session_id}/records/{record_id}",
    response_model=AttendanceRecordOut,
    dependencies=[Depends(require_permission("attendance.correct"))],
)
def correct_record(
    session_id: UUID,
    record_id: UUID,
    payload: CorrectRecordIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    _require_session(db, session_id=session_id, tenant_id=tenant.id)
    record = _require_record(db, record_id=record_id, session_id=session_id, tenant_id=tenant.id)

    new_status = payload.status.strip().upper()
    if new_status not in _VALID_ATTENDANCE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(_VALID_ATTENDANCE_STATUSES))}",
        )

    now = _now_utc()
    # Preserve the original status only on first correction
    original_status = record.get("original_status") or record["status"]

    db.execute(
        sa.text(
            """
            UPDATE core.attendance_records
            SET status = :new_status,
                notes = COALESCE(:notes, notes),
                original_status = :original_status,
                corrected_by_user_id = :corrected_by,
                corrected_at = :now,
                updated_at = :now
            WHERE id = :id AND session_id = :sid AND tenant_id = :tid
            """
        ),
        {
            "id": str(record_id),
            "sid": str(session_id),
            "tid": str(tenant.id),
            "new_status": new_status,
            "notes": (payload.notes or "").strip() or None,
            "original_status": original_status,
            "corrected_by": str(user.id) if user else None,
            "now": now,
        },
    )
    db.commit()

    updated = _require_record(db, record_id=record_id, session_id=session_id, tenant_id=tenant.id)
    # Fetch student name for response
    student = db.execute(
        sa.text(
            "SELECT first_name || ' ' || last_name AS student_name, admission_no "
            "FROM core.students WHERE id = :id LIMIT 1"
        ),
        {"id": str(updated["student_id"])},
    ).mappings().first()

    return AttendanceRecordOut(
        id=_str(updated["id"]) or "",
        tenant_id=_str(updated.get("tenant_id")) or str(tenant.id),
        session_id=_str(updated["session_id"]) or "",
        enrollment_id=_str(updated["enrollment_id"]) or "",
        student_id=_str(updated["student_id"]) or "",
        status=str(updated["status"]),
        notes=_str(updated.get("notes")),
        original_status=_str(updated.get("original_status")),
        corrected_by_user_id=_str(updated.get("corrected_by_user_id")),
        corrected_at=_str(updated.get("corrected_at")),
        created_at=_str(updated.get("created_at")),
        updated_at=_str(updated.get("updated_at")),
        student_name=_str(student["student_name"]) if student else None,
        admission_no=_str(student["admission_no"]) if student else None,
    )


# ── Reports ────────────────────────────────────────────────────────────────────

@router.get(
    "/students/{student_id}/summary",
    response_model=StudentAttendanceSummary,
    dependencies=[Depends(require_permission("attendance.reports"))],
)
def get_student_attendance_summary(
    student_id: UUID,
    term_id: UUID = Query(...),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_term(db, term_id=term_id, tenant_id=tenant.id)

    # Verify student belongs to this tenant
    student = db.execute(
        sa.text("SELECT id FROM core.students WHERE id = :id AND tenant_id = :tid LIMIT 1"),
        {"id": str(student_id), "tid": str(tenant.id)},
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    row = db.execute(
        sa.text(
            """
            SELECT
                COUNT(*) FILTER (WHERE ar.status = 'PRESENT')   AS present,
                COUNT(*) FILTER (WHERE ar.status = 'ABSENT')    AS absent,
                COUNT(*) FILTER (WHERE ar.status = 'LATE')      AS late,
                COUNT(*) FILTER (WHERE ar.status = 'EXCUSED')   AS excused,
                COUNT(*) FILTER (WHERE ar.status = 'OFF_GROUNDS') AS off_grounds,
                COUNT(*) AS total
            FROM core.attendance_records ar
            JOIN core.attendance_sessions sess ON sess.id = ar.session_id
            WHERE ar.student_id = :student_id
              AND ar.tenant_id = :tid
              AND sess.term_id = :term_id
              AND sess.status = 'FINALIZED'
            """
        ),
        {"student_id": str(student_id), "tid": str(tenant.id), "term_id": str(term_id)},
    ).mappings().first()

    total = int(row["total"] or 0)
    present = int(row["present"] or 0)
    rate = round(present / total, 4) if total > 0 else 0.0

    return StudentAttendanceSummary(
        student_id=str(student_id),
        term_id=str(term_id),
        total_sessions=total,
        present=present,
        absent=int(row["absent"] or 0),
        late=int(row["late"] or 0),
        excused=int(row["excused"] or 0),
        off_grounds=int(row["off_grounds"] or 0),
        attendance_rate=rate,
    )


@router.get(
    "/classes/{class_id}/report",
    response_model=list[ClassRosterReportRow],
    dependencies=[Depends(require_permission("attendance.reports"))],
)
def get_class_attendance_report(
    class_id: UUID,
    term_id: UUID = Query(...),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_class(db, class_id=class_id, tenant_id=tenant.id)
    _require_term(db, term_id=term_id, tenant_id=tenant.id)

    rows = db.execute(
        sa.text(
            """
            SELECT
                s.id AS student_id,
                s.first_name || ' ' || s.last_name AS student_name,
                s.admission_no,
                COUNT(*) FILTER (WHERE ar.status = 'PRESENT')     AS present,
                COUNT(*) FILTER (WHERE ar.status = 'ABSENT')      AS absent,
                COUNT(*) FILTER (WHERE ar.status = 'LATE')        AS late,
                COUNT(*) FILTER (WHERE ar.status = 'EXCUSED')     AS excused,
                COUNT(*) FILTER (WHERE ar.status = 'OFF_GROUNDS') AS off_grounds,
                COUNT(*)                                           AS total
            FROM core.student_class_enrollments sce
            JOIN core.students s ON s.id = sce.student_id
            LEFT JOIN core.attendance_records ar ON ar.student_id = s.id
                AND ar.tenant_id = sce.tenant_id
            LEFT JOIN core.attendance_sessions sess ON sess.id = ar.session_id
                AND sess.class_id = sce.class_id
                AND sess.term_id = sce.term_id
                AND sess.status = 'FINALIZED'
            WHERE sce.class_id = :class_id
              AND sce.term_id = :term_id
              AND sce.tenant_id = :tid
              AND sce.status = 'ACTIVE'
            GROUP BY s.id, s.first_name, s.last_name, s.admission_no
            ORDER BY s.last_name ASC, s.first_name ASC
            """
        ),
        {"class_id": str(class_id), "term_id": str(term_id), "tid": str(tenant.id)},
    ).mappings().all()

    result = []
    for r in rows:
        total = int(r["total"] or 0)
        present = int(r["present"] or 0)
        rate = round(present / total, 4) if total > 0 else 0.0
        result.append(
            ClassRosterReportRow(
                student_id=_str(r["student_id"]) or "",
                student_name=str(r["student_name"]),
                admission_no=_str(r.get("admission_no")),
                total_sessions=total,
                present=present,
                absent=int(r["absent"] or 0),
                late=int(r["late"] or 0),
                excused=int(r["excused"] or 0),
                off_grounds=int(r["off_grounds"] or 0),
                attendance_rate=rate,
            )
        )
    return result
