"""
Tests for Phase 2 — Attendance backend.

Endpoints exercised:
  GET    /api/v1/attendance/classes/{id}/roster      — enrolled students
  POST   /api/v1/attendance/classes/{id}/enroll      — enroll student
  PATCH  /api/v1/attendance/classes/{id}/roster/{id} — withdraw/transfer
  GET    /api/v1/attendance/sessions                 — list sessions
  POST   /api/v1/attendance/sessions                 — create session
  GET    /api/v1/attendance/sessions/{id}            — session detail + records
  POST   /api/v1/attendance/sessions/{id}/records    — bulk set records
  POST   /api/v1/attendance/sessions/{id}/submit     — DRAFT → SUBMITTED
  POST   /api/v1/attendance/sessions/{id}/finalize   — SUBMITTED → FINALIZED
  PATCH  /api/v1/attendance/sessions/{id}/records/{id} — correct record
  GET    /api/v1/attendance/students/{id}/summary    — student summary
  GET    /api/v1/attendance/classes/{id}/report      — class report
"""
from __future__ import annotations

import sqlalchemy as sa
import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/attendance"

# Permission bundles
VIEW     = ["attendance.view"]
MARK     = ["attendance.view", "attendance.mark"]
CORRECT  = ["attendance.view", "attendance.mark", "attendance.correct"]
REPORTS  = ["attendance.view", "attendance.reports"]
ENROLL   = ["attendance.view", "attendance.enroll"]
ALL_ATT  = ["attendance.view", "attendance.mark", "attendance.correct",
            "attendance.reports", "attendance.enroll"]


# ── Seed helpers ──────────────────────────────────────────────────────────────

def _seed_student(db: Session, *, tenant_id, admission_no: str = "ADM-001") -> str:
    sid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.students "
            "(id, tenant_id, admission_no, first_name, last_name, status) "
            "VALUES (:id, :tid, :adm, 'Alice', 'Wanjiru', 'ACTIVE')"
        ),
        {"id": sid, "tid": str(tenant_id), "adm": admission_no},
    )
    db.commit()
    return sid


def _seed_class(db: Session, *, tenant_id, code: str = "G7A") -> str:
    cid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.tenant_classes (id, tenant_id, code, name, is_active) "
            "VALUES (:id, :tid, :code, :name, true)"
        ),
        {"id": cid, "tid": str(tenant_id), "code": code, "name": f"Class {code}"},
    )
    db.commit()
    return cid


def _seed_term(db: Session, *, tenant_id, code: str = "2026-T1") -> str:
    tid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.tenant_terms (id, tenant_id, code, name, is_active) "
            "VALUES (:id, :tid, :code, :name, true)"
        ),
        {"id": tid, "tid": str(tenant_id), "code": code, "name": f"Term {code}"},
    )
    db.commit()
    return tid


def _seed_enrollment(
    db: Session, *, tenant_id, student_id: str, class_id: str, term_id: str
) -> str:
    eid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.student_class_enrollments "
            "(id, tenant_id, student_id, class_id, term_id, status) "
            "VALUES (:id, :tid, :sid, :cid, :termid, 'ACTIVE')"
        ),
        {
            "id": eid,
            "tid": str(tenant_id),
            "sid": student_id,
            "cid": class_id,
            "termid": term_id,
        },
    )
    db.commit()
    return eid


def _seed_session(
    db: Session,
    *,
    tenant_id,
    class_id: str,
    term_id: str,
    session_date: str = "2026-03-15",
    session_type: str = "MORNING",
    status: str = "DRAFT",
) -> str:
    ssid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.attendance_sessions "
            "(id, tenant_id, class_id, term_id, session_date, session_type, status) "
            "VALUES (:id, :tid, :cid, :termid, :date, :stype, :status)"
        ),
        {
            "id": ssid,
            "tid": str(tenant_id),
            "cid": class_id,
            "termid": term_id,
            "date": session_date,
            "stype": session_type,
            "status": status,
        },
    )
    db.commit()
    return ssid


def _seed_record(
    db: Session,
    *,
    tenant_id,
    session_id: str,
    enrollment_id: str,
    student_id: str,
    status: str = "PRESENT",
) -> str:
    rid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.attendance_records "
            "(id, tenant_id, session_id, enrollment_id, student_id, status) "
            "VALUES (:id, :tid, :sid, :eid, :stid, :status)"
        ),
        {
            "id": rid,
            "tid": str(tenant_id),
            "sid": session_id,
            "eid": enrollment_id,
            "stid": student_id,
            "status": status,
        },
    )
    db.commit()
    return rid


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Roster — enroll / list / withdraw
# ═══════════════════════════════════════════════════════════════════════════════

class TestRoster:
    def test_enroll_student_created(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=ENROLL)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.post(
            f"{BASE}/classes/{cid}/enroll",
            json={"student_id": sid, "term_id": tid},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["student_id"] == sid
        assert data["class_id"] == cid
        assert data["term_id"] == tid
        assert data["status"] == "ACTIVE"
        assert data["student_name"] == "Alice Wanjiru"

    def test_enroll_duplicate_returns_409(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=ENROLL)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)

        resp = client.post(
            f"{BASE}/classes/{cid}/enroll",
            json={"student_id": sid, "term_id": tid},
            headers=headers,
        )
        assert resp.status_code == 409

    def test_enroll_unknown_student_returns_404(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=ENROLL)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.post(
            f"{BASE}/classes/{cid}/enroll",
            json={"student_id": str(uuid4()), "term_id": tid},
            headers=headers,
        )
        assert resp.status_code == 404

    def test_enroll_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)  # no enroll
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        sid = _seed_student(db_session, tenant_id=tenant.id)

        resp = client.post(
            f"{BASE}/classes/{cid}/enroll",
            json={"student_id": sid, "term_id": tid},
            headers=headers,
        )
        assert resp.status_code == 403

    def test_list_roster_returns_enrolled_students(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)

        resp = client.get(
            f"{BASE}/classes/{cid}/roster?term_id={tid}",
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data) == 1
        assert data[0]["student_id"] == sid

    def test_list_roster_cross_tenant_isolation(self, client: TestClient, db_session: Session):
        t1 = create_tenant(db_session, slug="school-a")
        t2 = create_tenant(db_session, slug="school-b")
        _u, headers = make_actor(db_session, tenant=t1, permissions=VIEW)
        sid = _seed_student(db_session, tenant_id=t2.id)
        cid = _seed_class(db_session, tenant_id=t2.id)
        tid = _seed_term(db_session, tenant_id=t2.id)
        _seed_enrollment(db_session, tenant_id=t2.id, student_id=sid, class_id=cid, term_id=tid)

        # class_id from t2, but headers resolve to t1 — class not found
        cid_t1 = _seed_class(db_session, tenant_id=t1.id, code="G8A")
        tid_t1 = _seed_term(db_session, tenant_id=t1.id)
        resp = client.get(
            f"{BASE}/classes/{cid}/roster?term_id={tid_t1}",
            headers=headers,
        )
        assert resp.status_code == 404

    def test_withdraw_enrollment(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=ENROLL)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)

        resp = client.patch(
            f"{BASE}/classes/{cid}/roster/{eid}",
            json={"status": "WITHDRAWN"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "WITHDRAWN"
        assert resp.json()["withdrawn_at"] is not None

    def test_withdraw_invalid_status_returns_400(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=ENROLL)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)

        resp = client.patch(
            f"{BASE}/classes/{cid}/roster/{eid}",
            json={"status": "EXPELLED"},
            headers=headers,
        )
        assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Sessions — create / list / detail
# ═══════════════════════════════════════════════════════════════════════════════

class TestSessions:
    def test_create_session(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.post(
            f"{BASE}/sessions",
            json={"class_id": cid, "term_id": tid, "session_date": "2026-03-15"},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["status"] == "DRAFT"
        assert data["session_type"] == "MORNING"
        assert "2026-03-15" in data["session_date"]

    def test_create_duplicate_session_returns_409(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        _seed_session(db_session, tenant_id=tenant.id, class_id=cid, term_id=tid)

        resp = client.post(
            f"{BASE}/sessions",
            json={"class_id": cid, "term_id": tid, "session_date": "2026-03-15"},
            headers=headers,
        )
        assert resp.status_code == 409

    def test_create_period_session_requires_period_number(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.post(
            f"{BASE}/sessions",
            json={
                "class_id": cid,
                "term_id": tid,
                "session_date": "2026-03-15",
                "session_type": "PERIOD",
            },
            headers=headers,
        )
        assert resp.status_code == 400

    def test_create_session_requires_mark_permission(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.post(
            f"{BASE}/sessions",
            json={"class_id": cid, "term_id": tid, "session_date": "2026-03-20"},
            headers=headers,
        )
        assert resp.status_code == 403

    def test_list_sessions(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        _seed_session(db_session, tenant_id=tenant.id, class_id=cid, term_id=tid)
        _seed_session(
            db_session, tenant_id=tenant.id, class_id=cid, term_id=tid,
            session_date="2026-03-16"
        )

        resp = client.get(
            f"{BASE}/sessions?class_id={cid}&term_id={tid}",
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert len(resp.json()) == 2

    def test_get_session_includes_records(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)
        ssid = _seed_session(db_session, tenant_id=tenant.id, class_id=cid, term_id=tid)
        _seed_record(
            db_session,
            tenant_id=tenant.id,
            session_id=ssid,
            enrollment_id=eid,
            student_id=sid,
        )

        resp = client.get(f"{BASE}/sessions/{ssid}", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["id"] == ssid
        assert len(data["records"]) == 1
        assert data["records"][0]["student_id"] == sid
        assert data["records"][0]["student_name"] == "Alice Wanjiru"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Records — bulk set, submit, finalize state machine
# ═══════════════════════════════════════════════════════════════════════════════

class TestRecordsAndStateMachine:
    def test_bulk_set_records(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)
        ssid = _seed_session(db_session, tenant_id=tenant.id, class_id=cid, term_id=tid)

        resp = client.post(
            f"{BASE}/sessions/{ssid}/records",
            json={"records": [{"student_id": sid, "status": "ABSENT", "notes": "sick"}]},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        records = resp.json()
        assert len(records) == 1
        assert records[0]["status"] == "ABSENT"
        assert records[0]["notes"] == "sick"

    def test_bulk_set_records_upserts(self, client: TestClient, db_session: Session):
        """Submitting records twice for the same student updates, not duplicates."""
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)
        ssid = _seed_session(db_session, tenant_id=tenant.id, class_id=cid, term_id=tid)

        client.post(
            f"{BASE}/sessions/{ssid}/records",
            json={"records": [{"student_id": sid, "status": "PRESENT"}]},
            headers=headers,
        )
        resp = client.post(
            f"{BASE}/sessions/{ssid}/records",
            json={"records": [{"student_id": sid, "status": "LATE"}]},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()[0]["status"] == "LATE"

    def test_bulk_set_records_rejects_unenrolled_student(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        ssid = _seed_session(db_session, tenant_id=tenant.id, class_id=cid, term_id=tid)
        stranger = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-999")

        resp = client.post(
            f"{BASE}/sessions/{ssid}/records",
            json={"records": [{"student_id": stranger, "status": "PRESENT"}]},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_bulk_set_records_on_finalized_session_fails(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)
        ssid = _seed_session(
            db_session, tenant_id=tenant.id, class_id=cid, term_id=tid, status="FINALIZED"
        )

        resp = client.post(
            f"{BASE}/sessions/{ssid}/records",
            json={"records": [{"student_id": sid, "status": "PRESENT"}]},
            headers=headers,
        )
        assert resp.status_code == 409

    def test_submit_session(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        ssid = _seed_session(db_session, tenant_id=tenant.id, class_id=cid, term_id=tid)

        resp = client.post(f"{BASE}/sessions/{ssid}/submit", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "SUBMITTED"

    def test_submit_non_draft_fails(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        ssid = _seed_session(
            db_session, tenant_id=tenant.id, class_id=cid, term_id=tid, status="SUBMITTED"
        )

        resp = client.post(f"{BASE}/sessions/{ssid}/submit", headers=headers)
        assert resp.status_code == 409

    def test_finalize_session(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        ssid = _seed_session(
            db_session, tenant_id=tenant.id, class_id=cid, term_id=tid, status="SUBMITTED"
        )

        resp = client.post(f"{BASE}/sessions/{ssid}/finalize", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "FINALIZED"
        assert resp.json()["finalized_at"] is not None

    def test_finalize_non_submitted_fails(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        ssid = _seed_session(db_session, tenant_id=tenant.id, class_id=cid, term_id=tid)  # DRAFT

        resp = client.post(f"{BASE}/sessions/{ssid}/finalize", headers=headers)
        assert resp.status_code == 409

    def test_full_state_machine_draft_to_finalized(self, client: TestClient, db_session: Session):
        """End-to-end: DRAFT → mark records → SUBMITTED → FINALIZED."""
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)

        # Create
        r = client.post(
            f"{BASE}/sessions",
            json={"class_id": cid, "term_id": tid, "session_date": "2026-03-17"},
            headers=headers,
        )
        ssid = r.json()["id"]

        # Mark
        client.post(
            f"{BASE}/sessions/{ssid}/records",
            json={"records": [{"student_id": sid, "status": "PRESENT"}]},
            headers=headers,
        )

        # Submit
        r = client.post(f"{BASE}/sessions/{ssid}/submit", headers=headers)
        assert r.json()["status"] == "SUBMITTED"

        # Finalize
        r = client.post(f"{BASE}/sessions/{ssid}/finalize", headers=headers)
        assert r.json()["status"] == "FINALIZED"


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Corrections
# ═══════════════════════════════════════════════════════════════════════════════

class TestCorrections:
    def test_correct_record_stores_original_status(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=CORRECT)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)
        ssid = _seed_session(
            db_session, tenant_id=tenant.id, class_id=cid, term_id=tid, status="FINALIZED"
        )
        rid = _seed_record(
            db_session,
            tenant_id=tenant.id,
            session_id=ssid,
            enrollment_id=eid,
            student_id=sid,
            status="ABSENT",
        )

        resp = client.patch(
            f"{BASE}/sessions/{ssid}/records/{rid}",
            json={"status": "EXCUSED", "notes": "Doctor's note"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "EXCUSED"
        assert data["original_status"] == "ABSENT"
        assert data["corrected_at"] is not None

    def test_correct_record_requires_correct_permission(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        # mark but not correct
        _u, headers = make_actor(db_session, tenant=tenant, permissions=MARK)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)
        ssid = _seed_session(
            db_session, tenant_id=tenant.id, class_id=cid, term_id=tid, status="FINALIZED"
        )
        rid = _seed_record(
            db_session,
            tenant_id=tenant.id,
            session_id=ssid,
            enrollment_id=eid,
            student_id=sid,
        )

        resp = client.patch(
            f"{BASE}/sessions/{ssid}/records/{rid}",
            json={"status": "EXCUSED"},
            headers=headers,
        )
        assert resp.status_code == 403

    def test_correct_record_invalid_status_returns_400(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=CORRECT)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)
        ssid = _seed_session(
            db_session, tenant_id=tenant.id, class_id=cid, term_id=tid, status="FINALIZED"
        )
        rid = _seed_record(
            db_session,
            tenant_id=tenant.id,
            session_id=ssid,
            enrollment_id=eid,
            student_id=sid,
        )

        resp = client.patch(
            f"{BASE}/sessions/{ssid}/records/{rid}",
            json={"status": "EXPELLED"},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_correct_record_cross_tenant_isolation(
        self, client: TestClient, db_session: Session
    ):
        t1 = create_tenant(db_session, slug="school-x")
        t2 = create_tenant(db_session, slug="school-y")
        _u, h1 = make_actor(db_session, tenant=t1, permissions=CORRECT)
        sid = _seed_student(db_session, tenant_id=t2.id)
        cid = _seed_class(db_session, tenant_id=t2.id)
        tid = _seed_term(db_session, tenant_id=t2.id)
        eid = _seed_enrollment(db_session, tenant_id=t2.id, student_id=sid, class_id=cid, term_id=tid)
        ssid = _seed_session(
            db_session, tenant_id=t2.id, class_id=cid, term_id=tid, status="FINALIZED"
        )
        rid = _seed_record(
            db_session,
            tenant_id=t2.id,
            session_id=ssid,
            enrollment_id=eid,
            student_id=sid,
        )

        resp = client.patch(
            f"{BASE}/sessions/{ssid}/records/{rid}",
            json={"status": "EXCUSED"},
            headers=h1,  # t1 actor trying to modify t2 records
        )
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Reports
# ═══════════════════════════════════════════════════════════════════════════════

class TestReports:
    def _setup_finalized_session(self, db_session: Session, tenant, *, status_override: str = "PRESENT"):
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)
        ssid = _seed_session(
            db_session, tenant_id=tenant.id, class_id=cid, term_id=tid, status="FINALIZED"
        )
        _seed_record(
            db_session,
            tenant_id=tenant.id,
            session_id=ssid,
            enrollment_id=eid,
            student_id=sid,
            status=status_override,
        )
        return sid, cid, tid

    def test_student_summary_present(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=REPORTS)
        sid, cid, tid = self._setup_finalized_session(db_session, tenant, status_override="PRESENT")

        resp = client.get(
            f"{BASE}/students/{sid}/summary?term_id={tid}",
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["total_sessions"] == 1
        assert data["present"] == 1
        assert data["absent"] == 0
        assert data["attendance_rate"] == 1.0

    def test_student_summary_absent(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=REPORTS)
        sid, cid, tid = self._setup_finalized_session(db_session, tenant, status_override="ABSENT")

        resp = client.get(
            f"{BASE}/students/{sid}/summary?term_id={tid}",
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["absent"] == 1
        assert data["attendance_rate"] == 0.0

    def test_student_summary_zero_sessions(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=REPORTS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.get(
            f"{BASE}/students/{sid}/summary?term_id={tid}",
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["total_sessions"] == 0
        assert resp.json()["attendance_rate"] == 0.0

    def test_student_summary_requires_reports_permission(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)  # no reports
        sid = _seed_student(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.get(
            f"{BASE}/students/{sid}/summary?term_id={tid}",
            headers=headers,
        )
        assert resp.status_code == 403

    def test_class_report(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=REPORTS)
        _s, cid, tid = self._setup_finalized_session(db_session, tenant)

        resp = client.get(
            f"{BASE}/classes/{cid}/report?term_id={tid}",
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data) == 1
        assert data[0]["total_sessions"] == 1
        assert data[0]["student_name"] == "Alice Wanjiru"

    def test_class_report_requires_reports_permission(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        cid = _seed_class(db_session, tenant_id=tenant.id)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.get(
            f"{BASE}/classes/{cid}/report?term_id={tid}",
            headers=headers,
        )
        assert resp.status_code == 403

    def test_class_report_cross_tenant_isolation(self, client: TestClient, db_session: Session):
        t1 = create_tenant(db_session, slug="alpha")
        t2 = create_tenant(db_session, slug="beta")
        _u, h1 = make_actor(db_session, tenant=t1, permissions=REPORTS)
        _s, cid_t2, tid_t2 = self._setup_finalized_session(db_session, t2)
        tid_t1 = _seed_term(db_session, tenant_id=t1.id)

        resp = client.get(
            f"{BASE}/classes/{cid_t2}/report?term_id={tid_t1}",
            headers=h1,
        )
        assert resp.status_code == 404
