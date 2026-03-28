"""
Tests for Phase 3A — 8-4-4 Report Cards.

Endpoints exercised:
  GET  /api/v1/reports/8-4-4/classes/{class_code}/term/{term_id}
  GET  /api/v1/reports/8-4-4/enrollments/{enrollment_id}/term/{term_id}
  PUT  /api/v1/reports/8-4-4/enrollments/{enrollment_id}/term/{term_id}/remarks
  POST /api/v1/reports/8-4-4/classes/{class_code}/term/{term_id}/publish
  GET  /api/v1/reports/8-4-4/enrollments/{enrollment_id}/term/{term_id}/pdf
"""
from __future__ import annotations

import sqlalchemy as sa
import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/reports/8-4-4"

VIEW    = ["reports.view"]
EDIT    = ["reports.view", "reports.edit"]
PUBLISH = ["reports.view", "reports.edit", "reports.publish"]


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


def _seed_enrollment(db: Session, *, tenant_id, student_id: str) -> str:
    """Seed a core.enrollments (admission enrollment) row."""
    eid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.enrollments (id, tenant_id, student_id, status) "
            "VALUES (:id, :tid, :sid, 'APPROVED')"
        ),
        {"id": eid, "tid": str(tenant_id), "sid": student_id},
    )
    db.commit()
    return eid


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


def _seed_subject(db: Session, *, tenant_id, code: str = "MATH", name: str = "Mathematics") -> str:
    sid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.tenant_subjects (id, tenant_id, code, name) "
            "VALUES (:id, :tid, :code, :name)"
        ),
        {"id": sid, "tid": str(tenant_id), "code": code, "name": name},
    )
    db.commit()
    return sid


def _seed_exam(
    db: Session,
    *,
    tenant_id,
    term_id: str,
    subject_id: str,
    class_code: str = "G9A",
    name: str = "End-Term Exam",
) -> str:
    eid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.tenant_exams "
            "(id, tenant_id, name, class_code, subject_id, term_id, start_date, end_date, status) "
            "VALUES (:id, :tid, :name, :cc, :sid, :term_id, '2026-03-01', '2026-03-01', 'COMPLETED')"
        ),
        {
            "id": eid,
            "tid": str(tenant_id),
            "name": name,
            "cc": class_code,
            "sid": subject_id,
            "term_id": term_id,
        },
    )
    db.commit()
    return eid


def _seed_mark(
    db: Session,
    *,
    tenant_id,
    exam_id: str,
    enrollment_id: str,
    subject_id: str,
    class_code: str = "G9A",
    marks: float = 75.0,
    max_marks: float = 100.0,
) -> str:
    mid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.tenant_exam_marks "
            "(id, tenant_id, exam_id, student_enrollment_id, subject_id, class_code, "
            "marks_obtained, max_marks) "
            "VALUES (:id, :tid, :eid, :enr_id, :sid, :cc, :marks, :max)"
        ),
        {
            "id": mid,
            "tid": str(tenant_id),
            "eid": exam_id,
            "enr_id": enrollment_id,
            "sid": subject_id,
            "cc": class_code,
            "marks": marks,
            "max": max_marks,
        },
    )
    db.commit()
    return mid


def _setup_full_student(
    db: Session,
    *,
    tenant_id,
    class_code: str = "G9A",
    marks: float = 75.0,
    admission_no: str = "ADM-001",
    subject_code: str | None = None,
) -> tuple[str, str, str, str, str]:
    """Seed student → enrollment → term → subject → exam → mark. Returns (student_id, enrollment_id, term_id, subject_id, exam_id)."""
    sid = _seed_student(db, tenant_id=tenant_id, admission_no=admission_no)
    eid = _seed_enrollment(db, tenant_id=tenant_id, student_id=sid)
    tid = _seed_term(db, tenant_id=tenant_id)
    # Use a unique subject code to avoid collisions when called multiple times for the same tenant
    code = subject_code or f"MATH-{str(uuid4())[:8]}"
    subj_id = _seed_subject(db, tenant_id=tenant_id, code=code)
    exam_id = _seed_exam(db, tenant_id=tenant_id, term_id=tid, subject_id=subj_id, class_code=class_code)
    _seed_mark(
        db,
        tenant_id=tenant_id,
        exam_id=exam_id,
        enrollment_id=eid,
        subject_id=subj_id,
        class_code=class_code,
        marks=marks,
    )
    return sid, eid, tid, subj_id, exam_id


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Class results overview
# ═══════════════════════════════════════════════════════════════════════════════

class TestClassResults:
    def test_class_results_returns_students(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        _sid, eid, tid, _subj, _exam = _setup_full_student(db_session, tenant_id=tenant.id)

        resp = client.get(f"{BASE}/classes/G9A/term/{tid}", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data) == 1
        assert data[0]["enrollment_id"] == eid
        assert data[0]["position"] == 1
        assert data[0]["subjects_sat"] == 1

    def test_class_results_ranking(self, client: TestClient, db_session: Session):
        """Student with higher marks ranked first."""
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)

        # Use same term and subject for both students
        s1 = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-001")
        e1 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=s1)
        s2 = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-002")
        e2 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=s2)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        subj_id = _seed_subject(db_session, tenant_id=tenant.id)
        exam_id = _seed_exam(db_session, tenant_id=tenant.id, term_id=tid, subject_id=subj_id)

        _seed_mark(db_session, tenant_id=tenant.id, exam_id=exam_id, enrollment_id=e1,
                   subject_id=subj_id, marks=90.0)
        _seed_mark(db_session, tenant_id=tenant.id, exam_id=exam_id, enrollment_id=e2,
                   subject_id=subj_id, marks=60.0)

        resp = client.get(f"{BASE}/classes/G9A/term/{tid}", headers=headers)
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 2
        assert rows[0]["position"] == 1
        assert rows[0]["enrollment_id"] == e1  # higher marks first

    def test_class_results_empty_class(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.get(f"{BASE}/classes/UNKNOWN/term/{tid}", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_class_results_requires_view_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=EDIT)  # no view
        tid = _seed_term(db_session, tenant_id=tenant.id)

        # EDIT includes VIEW in our setup but let's use only edit-not-view
        _u2, h2 = make_actor(db_session, tenant=tenant, permissions=["reports.edit"])
        resp = client.get(f"{BASE}/classes/G9A/term/{tid}", headers=h2)
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Individual report card
# ═══════════════════════════════════════════════════════════════════════════════

class TestStudentReportCard:
    def test_report_card_returns_subjects(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        _sid, eid, tid, _subj, _exam = _setup_full_student(
            db_session, tenant_id=tenant.id, marks=80.0
        )

        resp = client.get(f"{BASE}/enrollments/{eid}/term/{tid}", headers=headers)
        assert resp.status_code == 200, resp.text
        card = resp.json()
        assert len(card["subjects"]) == 1
        assert card["subjects"][0]["grade"] == "A"
        assert card["mean_grade"] == "A"
        assert card["status"] == "DRAFT"  # no remarks yet

    def test_report_card_grade_calculation(self, client: TestClient, db_session: Session):
        """55% → C+, 45% → C-"""
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)

        for pct, expected_grade, adm in [(55.0, "C+", "ADM-A"), (45.0, "C-", "ADM-B")]:
            _sid, eid, tid, _subj, _exam = _setup_full_student(
                db_session, tenant_id=tenant.id, marks=pct, admission_no=adm
            )
            resp = client.get(f"{BASE}/enrollments/{eid}/term/{tid}", headers=headers)
            assert resp.status_code == 200
            assert resp.json()["subjects"][0]["grade"] == expected_grade

    def test_report_card_position_set(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)

        s1 = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-001")
        e1 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=s1)
        s2 = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-002")
        e2 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=s2)
        tid = _seed_term(db_session, tenant_id=tenant.id)
        subj_id = _seed_subject(db_session, tenant_id=tenant.id)
        exam_id = _seed_exam(db_session, tenant_id=tenant.id, term_id=tid, subject_id=subj_id)
        _seed_mark(db_session, tenant_id=tenant.id, exam_id=exam_id, enrollment_id=e1,
                   subject_id=subj_id, marks=90.0)
        _seed_mark(db_session, tenant_id=tenant.id, exam_id=exam_id, enrollment_id=e2,
                   subject_id=subj_id, marks=60.0)

        resp = client.get(f"{BASE}/enrollments/{e1}/term/{tid}", headers=headers)
        assert resp.status_code == 200
        card = resp.json()
        assert card["position"] == 1
        assert card["out_of"] == 2

    def test_report_card_unknown_enrollment_returns_404(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.get(f"{BASE}/enrollments/{uuid4()}/term/{tid}", headers=headers)
        assert resp.status_code == 404

    def test_report_card_cross_tenant_isolation(self, client: TestClient, db_session: Session):
        t1 = create_tenant(db_session, slug="school-a")
        t2 = create_tenant(db_session, slug="school-b")
        _u, h1 = make_actor(db_session, tenant=t1, permissions=VIEW)
        _sid, eid, tid, _, _ = _setup_full_student(db_session, tenant_id=t2.id)

        resp = client.get(f"{BASE}/enrollments/{eid}/term/{tid}", headers=h1)
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Remarks — upsert
# ═══════════════════════════════════════════════════════════════════════════════

class TestRemarks:
    def test_create_remarks(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=EDIT)
        _sid, eid, tid, _, _ = _setup_full_student(db_session, tenant_id=tenant.id)

        resp = client.put(
            f"{BASE}/enrollments/{eid}/term/{tid}/remarks",
            json={
                "class_teacher_comment": "Excellent student",
                "principal_comment": "Keep it up",
                "conduct": "EXCELLENT",
                "next_term_begins": "2026-09-01",
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["class_teacher_comment"] == "Excellent student"
        assert data["conduct"] == "EXCELLENT"
        assert data["status"] == "DRAFT"

    def test_update_existing_remarks(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=EDIT)
        _sid, eid, tid, _, _ = _setup_full_student(db_session, tenant_id=tenant.id)

        client.put(
            f"{BASE}/enrollments/{eid}/term/{tid}/remarks",
            json={"class_teacher_comment": "Good"},
            headers=headers,
        )
        resp = client.put(
            f"{BASE}/enrollments/{eid}/term/{tid}/remarks",
            json={"class_teacher_comment": "Excellent"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["class_teacher_comment"] == "Excellent"

    def test_invalid_conduct_returns_400(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=EDIT)
        _sid, eid, tid, _, _ = _setup_full_student(db_session, tenant_id=tenant.id)

        resp = client.put(
            f"{BASE}/enrollments/{eid}/term/{tid}/remarks",
            json={"conduct": "PERFECT"},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_edit_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        _sid, eid, tid, _, _ = _setup_full_student(db_session, tenant_id=tenant.id)

        resp = client.put(
            f"{BASE}/enrollments/{eid}/term/{tid}/remarks",
            json={"class_teacher_comment": "Nice"},
            headers=headers,
        )
        assert resp.status_code == 403

    def test_remarks_reflected_in_report_card(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=EDIT)
        _sid, eid, tid, _, _ = _setup_full_student(db_session, tenant_id=tenant.id)

        client.put(
            f"{BASE}/enrollments/{eid}/term/{tid}/remarks",
            json={"class_teacher_comment": "Outstanding"},
            headers=headers,
        )
        resp = client.get(f"{BASE}/enrollments/{eid}/term/{tid}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["class_teacher_comment"] == "Outstanding"

    def test_cannot_edit_published_remarks(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=PUBLISH)
        _sid, eid, tid, _, _ = _setup_full_student(db_session, tenant_id=tenant.id)

        # Create + publish
        client.put(
            f"{BASE}/enrollments/{eid}/term/{tid}/remarks",
            json={"class_teacher_comment": "Good"},
            headers=headers,
        )
        client.post(f"{BASE}/classes/G9A/term/{tid}/publish", headers=headers)

        # Try to edit — should fail
        resp = client.put(
            f"{BASE}/enrollments/{eid}/term/{tid}/remarks",
            json={"class_teacher_comment": "Changed"},
            headers=headers,
        )
        assert resp.status_code == 409


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Publish
# ═══════════════════════════════════════════════════════════════════════════════

class TestPublish:
    def test_publish_marks_remarks_as_published(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=PUBLISH)
        _sid, eid, tid, _, _ = _setup_full_student(db_session, tenant_id=tenant.id)

        client.put(
            f"{BASE}/enrollments/{eid}/term/{tid}/remarks",
            json={"class_teacher_comment": "Great work"},
            headers=headers,
        )

        resp = client.post(f"{BASE}/classes/G9A/term/{tid}/publish", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["published"] == 1

        card_resp = client.get(f"{BASE}/enrollments/{eid}/term/{tid}", headers=headers)
        assert card_resp.json()["status"] == "PUBLISHED"

    def test_publish_requires_publish_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=EDIT)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.post(f"{BASE}/classes/G9A/term/{tid}/publish", headers=headers)
        assert resp.status_code == 403

    def test_publish_zero_if_no_draft_remarks(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=PUBLISH)
        tid = _seed_term(db_session, tenant_id=tenant.id)

        resp = client.post(f"{BASE}/classes/EMPTY/term/{tid}/publish", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["published"] == 0


# ═══════════════════════════════════════════════════════════════════════════════
# 5. PDF endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestPdf:
    def test_pdf_returns_pdf_bytes(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        _sid, eid, tid, _, _ = _setup_full_student(db_session, tenant_id=tenant.id)

        resp = client.get(f"{BASE}/enrollments/{eid}/term/{tid}/pdf", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.content[:4] == b"%PDF"

    def test_pdf_requires_view_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _u, headers = make_actor(db_session, tenant=tenant, permissions=["reports.edit"])
        _sid, eid, tid, _, _ = _setup_full_student(db_session, tenant_id=tenant.id)

        resp = client.get(f"{BASE}/enrollments/{eid}/term/{tid}/pdf", headers=headers)
        assert resp.status_code == 403
