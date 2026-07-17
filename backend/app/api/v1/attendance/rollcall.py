"""Phase X — Principal Roll Call.

The daily school-wide layer on top of the attendance module:

  * Teachers mark their class's MORNING session (existing endpoints —
    Decision D4A: one MORNING session per class per day IS the roll call;
    AFTERNOON/PERIOD sessions stay ordinary attendance).
  * The principal's Roll Call board shows every class × marked?/counts,
    the day's absentee digest with guardian-phone availability, and the
    chronic-absence radar (Decision D5: 3+ absences in the last 7 school
    days — days that actually had roll call).
  * The principal finalizes the whole day in one action and can notify
    all absentees' guardians by SMS in one click (Decision D3A —
    deliberate action, never automatic).
"""
from __future__ import annotations

from datetime import date as date_type, datetime, timezone
from typing import Any, Optional
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.audit import log_event


CHRONIC_ABSENCE_THRESHOLD = 3
CHRONIC_WINDOW_SCHOOL_DAYS = 7


def build_rollcall_board(
    db: Session, *, tenant_id: UUID, on_date: date_type,
) -> dict[str, Any]:
    """Everything the principal's Roll Call board needs, in 4 queries."""
    tid = str(tenant_id)

    # 1. Every active class × its MORNING session (if any) on the date.
    class_rows = db.execute(sa.text(
        """
        SELECT tc.id AS class_id, tc.code, tc.name,
               s.id AS session_id, s.status AS session_status,
               COALESCE(SUM(CASE WHEN ar.status = 'PRESENT'     THEN 1 ELSE 0 END), 0) AS present,
               COALESCE(SUM(CASE WHEN ar.status = 'ABSENT'      THEN 1 ELSE 0 END), 0) AS absent,
               COALESCE(SUM(CASE WHEN ar.status = 'LATE'        THEN 1 ELSE 0 END), 0) AS late,
               COALESCE(SUM(CASE WHEN ar.status = 'EXCUSED'     THEN 1 ELSE 0 END), 0) AS excused,
               COALESCE(SUM(CASE WHEN ar.status = 'OFF_GROUNDS' THEN 1 ELSE 0 END), 0) AS off_grounds,
               (SELECT COUNT(*) FROM core.student_class_enrollments sce
                 WHERE sce.class_id = tc.id AND sce.tenant_id = tc.tenant_id
                   AND sce.status = 'ACTIVE') AS roster_size
        FROM core.tenant_classes tc
        LEFT JOIN core.attendance_sessions s
               ON s.class_id = tc.id AND s.tenant_id = tc.tenant_id
              AND s.session_date = :on_date AND s.session_type = 'MORNING'
        LEFT JOIN core.attendance_records ar ON ar.session_id = s.id
        WHERE tc.tenant_id = :tid
        GROUP BY tc.id, tc.code, tc.name, s.id, s.status
        ORDER BY tc.code ASC
        """
    ), {"tid": tid, "on_date": on_date}).mappings().all()

    classes: list[dict] = []
    totals = {"present": 0, "absent": 0, "late": 0, "excused": 0, "off_grounds": 0}
    marked = 0
    finalized = 0
    for r in class_rows:
        has_session = r["session_id"] is not None
        if has_session:
            marked += 1
            if str(r["session_status"] or "") == "FINALIZED":
                finalized += 1
            for k in totals:
                totals[k] += int(r[k] or 0)
        classes.append({
            "class_id": str(r["class_id"]),
            "class_code": str(r["code"] or ""),
            "class_name": str(r["name"] or ""),
            "roster_size": int(r["roster_size"] or 0),
            "session_id": str(r["session_id"]) if has_session else None,
            "session_status": str(r["session_status"]) if has_session else None,
            "marked": has_session,
            "present": int(r["present"] or 0),
            "absent": int(r["absent"] or 0),
            "late": int(r["late"] or 0),
            "excused": int(r["excused"] or 0),
            "off_grounds": int(r["off_grounds"] or 0),
        })

    total_records = sum(totals.values())
    attendance_rate = (
        round(100.0 * (totals["present"] + totals["late"]) / total_records, 1)
        if total_records else None
    )

    # 2. Today's absentee digest with guardian-phone availability.
    absentees = [
        {
            "record_id": str(r["record_id"]),
            "enrollment_id": str(r["enrollment_id"]) if r["enrollment_id"] else None,
            "student_id": str(r["student_id"]) if r["student_id"] else None,
            "student_name": str(r["student_name"] or "Unknown student"),
            "class_code": str(r["class_code"] or ""),
            "status": str(r["status"]),
            "guardian_phone_available": bool(r["guardian_phone"]),
        }
        for r in db.execute(sa.text(
            """
            SELECT ar.id AS record_id, ar.enrollment_id, ar.student_id, ar.status,
                   COALESCE(
                     NULLIF(TRIM(st.first_name || ' ' || COALESCE(st.last_name, '')), ''),
                     e.payload->>'student_name', 'Unknown student'
                   ) AS student_name,
                   tc.code AS class_code,
                   COALESCE(
                     (SELECT p.phone FROM core.parents p
                       JOIN core.parent_enrollment_links pel ON pel.parent_id = p.id
                      WHERE pel.enrollment_id = ar.enrollment_id
                        AND pel.tenant_id = ar.tenant_id
                        AND p.phone IS NOT NULL AND p.phone <> ''
                      ORDER BY pel.is_primary DESC LIMIT 1),
                     NULLIF(e.payload->>'guardian_phone', '')
                   ) AS guardian_phone
            FROM core.attendance_records ar
            JOIN core.attendance_sessions s ON s.id = ar.session_id
            JOIN core.tenant_classes tc ON tc.id = s.class_id
            LEFT JOIN core.enrollments e ON e.id = ar.enrollment_id
            LEFT JOIN core.students st ON st.id = ar.student_id
            WHERE ar.tenant_id = :tid AND s.session_date = :on_date
              AND s.session_type = 'MORNING' AND ar.status = 'ABSENT'
            ORDER BY tc.code, student_name
            """
        ), {"tid": tid, "on_date": on_date}).mappings().all()
    ]

    # 3. Chronic-absence radar: 3+ ABSENT marks over the last 7 SCHOOL days
    # (dates ≤ on_date that actually had a MORNING session).
    chronic = [
        {
            "student_id": str(r["student_id"]) if r["student_id"] else None,
            "enrollment_id": str(r["enrollment_id"]) if r["enrollment_id"] else None,
            "student_name": str(r["student_name"] or "Unknown student"),
            "class_code": str(r["class_code"] or ""),
            "absence_count": int(r["absence_count"]),
        }
        for r in db.execute(sa.text(
            """
            WITH school_days AS (
                SELECT DISTINCT session_date
                FROM core.attendance_sessions
                WHERE tenant_id = :tid AND session_type = 'MORNING'
                  AND session_date <= :on_date
                ORDER BY session_date DESC
                LIMIT :window
            )
            SELECT ar.student_id, ar.enrollment_id,
                   COALESCE(
                     NULLIF(TRIM(st.first_name || ' ' || COALESCE(st.last_name, '')), ''),
                     e.payload->>'student_name', 'Unknown student'
                   ) AS student_name,
                   MAX(tc.code) AS class_code,
                   COUNT(*) AS absence_count
            FROM core.attendance_records ar
            JOIN core.attendance_sessions s ON s.id = ar.session_id
            JOIN core.tenant_classes tc ON tc.id = s.class_id
            LEFT JOIN core.enrollments e ON e.id = ar.enrollment_id
            LEFT JOIN core.students st ON st.id = ar.student_id
            WHERE ar.tenant_id = :tid AND ar.status = 'ABSENT'
              AND s.session_type = 'MORNING'
              AND s.session_date IN (SELECT session_date FROM school_days)
            GROUP BY ar.student_id, ar.enrollment_id, st.first_name, st.last_name,
                     e.payload->>'student_name'
            HAVING COUNT(*) >= :threshold
            ORDER BY absence_count DESC, student_name
            """
        ), {"tid": tid, "on_date": on_date,
            "window": CHRONIC_WINDOW_SCHOOL_DAYS,
            "threshold": CHRONIC_ABSENCE_THRESHOLD}).mappings().all()
    ]

    return {
        "date": on_date.isoformat(),
        "summary": {
            "total_classes": len(classes),
            "marked_classes": marked,
            "unmarked_classes": len(classes) - marked,
            "finalized_classes": finalized,
            "day_finalized": marked > 0 and finalized == marked,
            **totals,
            "attendance_rate": attendance_rate,
        },
        "classes": classes,
        "absentees": absentees,
        "chronic_absentees": chronic,
        "chronic_rule": {
            "threshold": CHRONIC_ABSENCE_THRESHOLD,
            "window_school_days": CHRONIC_WINDOW_SCHOOL_DAYS,
        },
    }


def finalize_rollcall_day(
    db: Session, *, tenant_id: UUID, actor_user_id: UUID, on_date: date_type,
) -> dict[str, Any]:
    """Finalize every non-FINALIZED MORNING session of the day in one action.
    Sessions without records are left untouched (nothing to lock)."""
    now = datetime.now(timezone.utc)
    rows = db.execute(sa.text(
        """
        UPDATE core.attendance_sessions s
        SET status = 'FINALIZED', finalized_by_user_id = :uid,
            finalized_at = :now, updated_at = :now
        WHERE s.tenant_id = :tid AND s.session_date = :on_date
          AND s.session_type = 'MORNING' AND s.status <> 'FINALIZED'
          AND EXISTS (SELECT 1 FROM core.attendance_records ar
                       WHERE ar.session_id = s.id)
        RETURNING s.id
        """
    ), {"tid": str(tenant_id), "uid": str(actor_user_id),
        "now": now, "on_date": on_date}).all()
    finalized_ids = [str(r[0]) for r in rows]
    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="attendance.rollcall.day_finalized", resource="tenant",
        resource_id=tenant_id,
        payload={"date": on_date.isoformat(),
                 "sessions_finalized": len(finalized_ids),
                 "session_ids": finalized_ids},
        meta=None,
    )
    return {"date": on_date.isoformat(), "sessions_finalized": len(finalized_ids)}


def notify_absentee_guardians(
    db: Session, *, tenant_id: UUID, actor_user_id: UUID, on_date: date_type,
) -> dict[str, Any]:
    """One-click SMS to every absentee's guardian for the date (D3A).

    Idempotency guard: a second click on the same day is refused unless
    force=True-style resend is added later — prevents accidental
    double-texting the whole school. Detected via the audit trail.
    """
    already = db.execute(sa.text(
        """
        SELECT 1 FROM core.audit_logs
        WHERE tenant_id = :tid AND action = 'attendance.rollcall.absentees_notified'
          AND payload->>'date' = :d
        LIMIT 1
        """
    ), {"tid": str(tenant_id), "d": on_date.isoformat()}).first()
    if already:
        raise ValueError(
            "Guardians were already notified for this date. "
            "Absentee SMS is sent at most once per day to avoid duplicates."
        )

    board = build_rollcall_board(db, tenant_id=tenant_id, on_date=on_date)
    absentees = board["absentees"]
    if not absentees:
        raise ValueError("No absentees recorded for this date.")

    from app.api.v1.sms.notifications import _lookup_guardian
    from app.api.v1.sms.service import send_single_sms

    sent, skipped = 0, 0
    for a in absentees:
        if not a["enrollment_id"]:
            skipped += 1
            continue
        try:
            guardian = _lookup_guardian(
                db, tenant_id=tenant_id, enrollment_id=UUID(a["enrollment_id"]),
            )
            if not guardian:
                skipped += 1
                continue
            body = (
                f"Dear {guardian['name']}, {a['student_name']} "
                f"({a['class_code'] or 'class'}) was NOT present at school "
                f"roll call today {on_date.strftime('%d/%m/%Y')}. Please "
                "contact the school office if this is unexpected."
            )
            send_single_sms(
                db, tenant_id=tenant_id, actor_user_id=actor_user_id,
                to_phone=guardian["phone"], message_body=body,
                recipient_name=guardian["name"],
            )
            sent += 1
        except Exception:
            skipped += 1

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="attendance.rollcall.absentees_notified", resource="tenant",
        resource_id=tenant_id,
        payload={"date": on_date.isoformat(), "sent": sent,
                 "skipped": skipped, "absentees": len(absentees)},
        meta=None,
    )
    return {"date": on_date.isoformat(), "sent": sent, "skipped": skipped,
            "absentees": len(absentees)}
