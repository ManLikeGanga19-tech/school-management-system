"""Phase X — Principal Roll Call tests.

Endpoints:
    GET  /tenants/principal/roll-call?date=
    POST /tenants/principal/roll-call/finalize
    POST /tenants/principal/roll-call/notify-absentees
"""
from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor


PERMS = ["enrollment.manage"]
TODAY = date(2026, 7, 6)


def _seed_class(db: Session, *, tenant_id, code: str) -> str:
    cid = str(uuid4())
    db.execute(text(
        "INSERT INTO core.tenant_classes (id, tenant_id, code, name) "
        "VALUES (:id, :tid, :code, :name)"
    ), {"id": cid, "tid": str(tenant_id), "code": code, "name": code.title()})
    db.commit()
    return cid


def _seed_term(db: Session, *, tenant_id) -> str:
    tid_ = str(uuid4())
    db.execute(text(
        "INSERT INTO core.tenant_terms (id, tenant_id, code, name, is_active) "
        "VALUES (:id, :tid, :code, 'Term 2 2026', TRUE)"
    ), {"id": tid_, "tid": str(tenant_id), "code": f"T2-{uuid4().hex[:4]}"})
    db.commit()
    return tid_


def _seed_student(db: Session, *, tenant_id, name: str = "Roll Call") -> tuple[str, str]:
    sid, eid = str(uuid4()), str(uuid4())
    first, last = (name.split(" ", 1) + [""])[:2]
    db.execute(text(
        "INSERT INTO core.students (id, tenant_id, admission_no, first_name, last_name, status, admission_year) "
        "VALUES (:id, :tid, :adm, :fn, :ln, 'ACTIVE', 2026)"
    ), {"id": sid, "tid": str(tenant_id), "adm": f"RC-{uuid4().hex[:6].upper()}",
        "fn": first, "ln": last})
    db.execute(text(
        "INSERT INTO core.enrollments (id, tenant_id, student_id, status, payload) "
        "VALUES (:id, :tid, :sid, 'ENROLLED', CAST(:pl AS jsonb))"
    ), {"id": eid, "tid": str(tenant_id), "sid": sid,
        "pl": '{"student_name": "' + name + '", "guardian_phone": "0712345678"}'})
    db.commit()
    return sid, eid


def _seed_session(
    db: Session, *, tenant_id, class_id: str, term_id: str,
    on_date: date, status: str = "SUBMITTED",
    records: list[tuple[str, str, str]] = (),  # (student_id, enrollment_id, status)
) -> str:
    sess = str(uuid4())
    db.execute(text(
        "INSERT INTO core.attendance_sessions "
        "(id, tenant_id, class_id, term_id, session_date, session_type, status) "
        "VALUES (:id, :tid, :cid, :term, :d, 'MORNING', :status)"
    ), {"id": sess, "tid": str(tenant_id), "cid": class_id, "term": term_id,
        "d": on_date, "status": status})
    for stu, enr, st in records:
        db.execute(text(
            "INSERT INTO core.attendance_records "
            "(id, tenant_id, session_id, enrollment_id, student_id, status) "
            "VALUES (:id, :tid, :sess, :eid, :sid, :st)"
        ), {"id": str(uuid4()), "tid": str(tenant_id), "sess": sess,
            "eid": enr, "sid": stu, "st": st})
    db.commit()
    return sess


class TestRollCallBoard:
    def test_board_marks_and_counts(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        term = _seed_term(db_session, tenant_id=tenant.id)
        c1 = _seed_class(db_session, tenant_id=tenant.id, code="G1")
        _seed_class(db_session, tenant_id=tenant.id, code="G2")  # unmarked
        s1, e1 = _seed_student(db_session, tenant_id=tenant.id, name="Amina Hassan")
        s2, e2 = _seed_student(db_session, tenant_id=tenant.id, name="Brian Otieno")
        _seed_session(
            db_session, tenant_id=tenant.id, class_id=c1, term_id=term,
            on_date=TODAY,
            records=[(s1, e1, "PRESENT"), (s2, e2, "ABSENT")],
        )

        r = client.get(
            f"/api/v1/tenants/principal/roll-call?date={TODAY.isoformat()}",
            headers=headers,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["summary"]["total_classes"] == 2
        assert b["summary"]["marked_classes"] == 1
        assert b["summary"]["unmarked_classes"] == 1
        assert b["summary"]["present"] == 1
        assert b["summary"]["absent"] == 1
        assert b["summary"]["attendance_rate"] == 50.0
        assert b["summary"]["day_finalized"] is False

        g1 = next(c for c in b["classes"] if c["class_code"] == "G1")
        assert g1["marked"] and g1["absent"] == 1
        g2 = next(c for c in b["classes"] if c["class_code"] == "G2")
        assert not g2["marked"]

        assert len(b["absentees"]) == 1
        assert b["absentees"][0]["student_name"] == "Brian Otieno"
        assert b["absentees"][0]["guardian_phone_available"] is True

    def test_chronic_radar_flags_3_of_7(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        term = _seed_term(db_session, tenant_id=tenant.id)
        c1 = _seed_class(db_session, tenant_id=tenant.id, code="G1")
        s1, e1 = _seed_student(db_session, tenant_id=tenant.id, name="Chronic Kid")
        s2, e2 = _seed_student(db_session, tenant_id=tenant.id, name="Fine Kid")
        # 3 absences across the last week for s1; s2 present throughout.
        for i in range(3):
            _seed_session(
                db_session, tenant_id=tenant.id, class_id=c1, term_id=term,
                on_date=TODAY - timedelta(days=i),
                records=[(s1, e1, "ABSENT"), (s2, e2, "PRESENT")],
            )
        r = client.get(
            f"/api/v1/tenants/principal/roll-call?date={TODAY.isoformat()}",
            headers=headers,
        )
        chronic = r.json()["chronic_absentees"]
        assert len(chronic) == 1
        assert chronic[0]["student_name"] == "Chronic Kid"
        assert chronic[0]["absence_count"] == 3

    def test_board_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        r = client.get("/api/v1/tenants/principal/roll-call", headers=headers)
        assert r.status_code == 403


class TestRollCallActions:
    def test_finalize_day_locks_marked_sessions(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        term = _seed_term(db_session, tenant_id=tenant.id)
        c1 = _seed_class(db_session, tenant_id=tenant.id, code="G1")
        s1, e1 = _seed_student(db_session, tenant_id=tenant.id)
        sess = _seed_session(
            db_session, tenant_id=tenant.id, class_id=c1, term_id=term,
            on_date=TODAY, records=[(s1, e1, "PRESENT")],
        )
        r = client.post(
            "/api/v1/tenants/principal/roll-call/finalize",
            headers=headers, json={"date": TODAY.isoformat()},
        )
        assert r.status_code == 200, r.text
        assert r.json()["sessions_finalized"] == 1
        status = db_session.execute(text(
            "SELECT status FROM core.attendance_sessions WHERE id = :id"
        ), {"id": sess}).scalar()
        assert status == "FINALIZED"
        cnt = db_session.execute(text(
            "SELECT COUNT(*) FROM core.audit_logs WHERE tenant_id = :tid "
            "AND action = 'attendance.rollcall.day_finalized'"
        ), {"tid": str(tenant.id)}).scalar()
        assert cnt == 1

    def test_notify_absentees_once_per_day(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        term = _seed_term(db_session, tenant_id=tenant.id)
        c1 = _seed_class(db_session, tenant_id=tenant.id, code="G1")
        s1, e1 = _seed_student(db_session, tenant_id=tenant.id, name="Away Kid")
        _seed_session(
            db_session, tenant_id=tenant.id, class_id=c1, term_id=term,
            on_date=TODAY, records=[(s1, e1, "ABSENT")],
        )
        r1 = client.post(
            "/api/v1/tenants/principal/roll-call/notify-absentees",
            headers=headers, json={"date": TODAY.isoformat()},
        )
        assert r1.status_code == 200, r1.text
        body = r1.json()
        assert body["absentees"] == 1
        # sent OR skipped depending on SMS provider config in test env —
        # both are legitimate; the ledger event is what matters.
        assert body["sent"] + body["skipped"] == 1

        # Second click same day → refused (no double-texting the school).
        r2 = client.post(
            "/api/v1/tenants/principal/roll-call/notify-absentees",
            headers=headers, json={"date": TODAY.isoformat()},
        )
        assert r2.status_code == 400
        assert "already notified" in r2.json()["detail"].lower()

    def test_notify_with_no_absentees_400(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        r = client.post(
            "/api/v1/tenants/principal/roll-call/notify-absentees",
            headers=headers, json={"date": TODAY.isoformat()},
        )
        assert r.status_code == 400
