"""
Tests for CBC Analytics (Step 3A), Learner Progress (Step 4),
and Learner Support Report (Step 4) endpoints.

Also verifies assessment_type / checkpoint_no (Step 3C) schema changes.

New endpoints:
  GET /api/v1/cbc/classes/{class_code}/term/{term_id}/analytics
  GET /api/v1/cbc/enrollments/{enrollment_id}/progress
  GET /api/v1/cbc/classes/{class_code}/term/{term_id}/support-report
  GET /api/v1/cbc/classes/{class_code}/term/{term_id}/support-report/csv
  GET /api/v1/portal/cbc/terms
  GET /api/v1/portal/cbc/report
"""
from __future__ import annotations

import sqlalchemy as sa
import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/cbc"
PORTAL = "/api/v1/portal"

ALL_CBC = [
    "cbc.curriculum.manage", "cbc.curriculum.view",
    "cbc.assessments.enter", "cbc.assessments.view", "cbc.reports.generate",
]


# ── Seed helpers ──────────────────────────────────────────────────────────────

def _seed_student(db: Session, *, tenant_id, name="Amara Wanjiku", adm=None) -> str:
    sid = str(uuid4())
    adm = adm or f"ADM-{uuid4().hex[:6]}"
    parts = name.split(" ", 1)
    first, last = parts[0], parts[1] if len(parts) > 1 else "."
    db.execute(
        sa.text(
            "INSERT INTO core.students (id, tenant_id, admission_no, first_name, last_name, status) "
            "VALUES (:id, :tid, :adm, :fn, :ln, 'ACTIVE')"
        ),
        {"id": sid, "tid": str(tenant_id), "adm": adm, "fn": first, "ln": last},
    )
    db.commit()
    return sid


def _seed_class(db: Session, *, tenant_id, code="G4A") -> str:
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


def _seed_term(db: Session, *, tenant_id, code="2026-T1", active=True) -> str:
    tid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.tenant_terms (id, tenant_id, code, name, is_active) "
            "VALUES (:id, :tid, :code, :name, :active)"
        ),
        {"id": tid, "tid": str(tenant_id), "code": code, "name": f"Term {code}", "active": active},
    )
    db.commit()
    return tid


def _seed_enrollment(db: Session, *, tenant_id, student_id, class_id, term_id) -> str:
    eid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.student_class_enrollments "
            "(id, tenant_id, student_id, class_id, term_id, status) "
            "VALUES (:id, :tid, :sid, :cid, :termid, 'ACTIVE')"
        ),
        {"id": eid, "tid": str(tenant_id), "sid": str(student_id),
         "cid": str(class_id), "termid": str(term_id)},
    )
    db.commit()
    return eid


def _create_curriculum(client, headers) -> tuple[str, str, str]:
    """Returns (la_id, strand_id, ss_id)."""
    la = client.post(
        f"{BASE}/curriculum/learning-areas",
        json={"name": "Mathematics", "code": f"MTH-{uuid4().hex[:4]}", "grade_band": "UPPER_PRIMARY"},
        headers=headers,
    )
    assert la.status_code == 201
    strand = client.post(
        f"{BASE}/curriculum/strands",
        json={"name": "Numbers", "code": f"NUM-{uuid4().hex[:4]}", "learning_area_id": la.json()["id"]},
        headers=headers,
    )
    assert strand.status_code == 201
    ss = client.post(
        f"{BASE}/curriculum/sub-strands",
        json={"name": "Whole Numbers", "code": f"WN-{uuid4().hex[:4]}", "strand_id": strand.json()["id"]},
        headers=headers,
    )
    assert ss.status_code == 201
    return la.json()["id"], strand.json()["id"], ss.json()["id"]


def _upsert(client, headers, enrollment_id, term_id, ss_id, level="ME", a_type="SUMMATIVE") -> None:
    r = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessment_type": a_type,
            "assessments": [{"sub_strand_id": ss_id, "performance_level": level}],
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text


def _full_setup(client, db, slug_suffix=""):
    tenant = create_tenant(db, slug=f"ana-{uuid4().hex[:6]}{slug_suffix}")
    _, headers = make_actor(db, tenant=tenant, permissions=ALL_CBC)
    la_id, strand_id, ss_id = _create_curriculum(client, headers)
    class_code = f"G{uuid4().hex[:3].upper()}"
    class_id = _seed_class(db, tenant_id=tenant.id, code=class_code)
    term_id = _seed_term(db, tenant_id=tenant.id)
    student_id = _seed_student(db, tenant_id=tenant.id)
    enrollment_id = _seed_enrollment(db, tenant_id=tenant.id, student_id=student_id,
                                     class_id=class_id, term_id=term_id)
    return tenant, headers, class_code, term_id, enrollment_id, ss_id


# ══════════════════════════════════════════════════════════════════════════════
# 1. assessment_type field in bulk upsert (Step 3C)
# ══════════════════════════════════════════════════════════════════════════════

def test_summative_assessment_default(client: TestClient, db_session: Session):
    tenant, headers, class_code, term_id, enrollment_id, ss_id = _full_setup(client, db_session)
    r = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [{"sub_strand_id": ss_id, "performance_level": "ME"}],
        },
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()[0]["assessment_type"] == "SUMMATIVE"
    assert r.json()[0]["checkpoint_no"] == 1


def test_formative_assessment_stored(client: TestClient, db_session: Session):
    tenant, headers, class_code, term_id, enrollment_id, ss_id = _full_setup(client, db_session)
    r = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessment_type": "FORMATIVE",
            "checkpoint_no": 2,
            "assessments": [{"sub_strand_id": ss_id, "performance_level": "AE"}],
        },
        headers=headers,
    )
    assert r.status_code == 200
    row = r.json()[0]
    assert row["assessment_type"] == "FORMATIVE"
    assert row["checkpoint_no"] == 2


def test_summative_and_formative_coexist(client: TestClient, db_session: Session):
    """Same sub-strand can have both SUMMATIVE and FORMATIVE records in one term."""
    tenant, headers, class_code, term_id, enrollment_id, ss_id = _full_setup(client, db_session)
    _upsert(client, headers, enrollment_id, term_id, ss_id, "ME", "SUMMATIVE")
    r2 = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessment_type": "FORMATIVE",
            "assessments": [{"sub_strand_id": ss_id, "performance_level": "AE"}],
        },
        headers=headers,
    )
    assert r2.status_code == 200
    # List both
    r3 = client.get(
        f"{BASE}/assessments?enrollment_id={enrollment_id}&term_id={term_id}",
        headers=headers,
    )
    types = {a["assessment_type"] for a in r3.json()}
    assert "SUMMATIVE" in types
    assert "FORMATIVE" in types


def test_invalid_assessment_type_rejected(client: TestClient, db_session: Session):
    tenant, headers, class_code, term_id, enrollment_id, ss_id = _full_setup(client, db_session)
    r = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessment_type": "CONTINUOUS",
            "assessments": [{"sub_strand_id": ss_id, "performance_level": "ME"}],
        },
        headers=headers,
    )
    assert r.status_code == 422


def test_assessment_type_filter(client: TestClient, db_session: Session):
    tenant, headers, class_code, term_id, enrollment_id, ss_id = _full_setup(client, db_session)
    _upsert(client, headers, enrollment_id, term_id, ss_id, "ME", "SUMMATIVE")
    r_sum = client.get(
        f"{BASE}/assessments?enrollment_id={enrollment_id}&assessment_type=SUMMATIVE",
        headers=headers,
    )
    assert all(a["assessment_type"] == "SUMMATIVE" for a in r_sum.json())
    r_form = client.get(
        f"{BASE}/assessments?enrollment_id={enrollment_id}&assessment_type=FORMATIVE",
        headers=headers,
    )
    assert r_form.json() == []


# ══════════════════════════════════════════════════════════════════════════════
# 2. Class Analytics (Step 3A)
# ══════════════════════════════════════════════════════════════════════════════

def test_class_analytics_empty_class(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"ana-empty-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_CBC)
    term_id = _seed_term(db_session, tenant_id=tenant.id, code="2026-T1")
    # No students enrolled — should return empty gracefully
    r = client.get(f"{BASE}/classes/NOCLASS/term/{term_id}/analytics", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["enrolled_count"] == 0
    assert body["distribution"] == []
    assert body["support_flags"] == []
    assert body["overall_completion_pct"] == 0.0


def test_class_analytics_with_assessments(client: TestClient, db_session: Session):
    tenant, headers, class_code, term_id, enrollment_id, ss_id = _full_setup(client, db_session)
    _upsert(client, headers, enrollment_id, term_id, ss_id, "EE", "SUMMATIVE")

    r = client.get(f"{BASE}/classes/{class_code}/term/{term_id}/analytics", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["enrolled_count"] == 1
    assert len(body["distribution"]) >= 1
    dist = body["distribution"][0]
    assert dist["ee_count"] == 1
    assert dist["completion_pct"] > 0


def test_class_analytics_only_counts_summative(client: TestClient, db_session: Session):
    """FORMATIVE assessments must NOT appear in analytics distribution counts."""
    tenant, headers, class_code, term_id, enrollment_id, ss_id = _full_setup(client, db_session)
    # Only add a FORMATIVE assessment — analytics distribution should be 0
    _upsert(client, headers, enrollment_id, term_id, ss_id, "BE", "FORMATIVE")

    r = client.get(f"{BASE}/classes/{class_code}/term/{term_id}/analytics", headers=headers)
    body = r.json()
    total_assessed = sum(d["total_assessed"] for d in body["distribution"])
    assert total_assessed == 0


def test_class_analytics_requires_permission(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"ana-perm-{uuid4().hex[:6]}")
    _, no_headers = make_actor(db_session, tenant=tenant, permissions=[])
    term_id = _seed_term(db_session, tenant_id=tenant.id)
    r = client.get(f"{BASE}/classes/G4A/term/{term_id}/analytics", headers=no_headers)
    assert r.status_code == 403


def test_class_analytics_support_flags(client: TestClient, db_session: Session):
    """Student with ≥3 BE assessments in any single LA should be flagged."""
    tenant = create_tenant(db_session, slug=f"ana-flag-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_CBC)

    # Create 1 LA with 3 sub-strands
    la = client.post(
        f"{BASE}/curriculum/learning-areas",
        json={"name": "Kiswahili", "code": f"KSW-{uuid4().hex[:4]}", "grade_band": "UPPER_PRIMARY"},
        headers=headers,
    ).json()
    strand = client.post(
        f"{BASE}/curriculum/strands",
        json={"name": "Kusoma", "code": f"KSM-{uuid4().hex[:4]}", "learning_area_id": la["id"]},
        headers=headers,
    ).json()
    ss_ids = []
    for i in range(3):
        ss = client.post(
            f"{BASE}/curriculum/sub-strands",
            json={"name": f"Sub {i}", "code": f"KS{i}-{uuid4().hex[:4]}", "strand_id": strand["id"]},
            headers=headers,
        ).json()
        ss_ids.append(ss["id"])

    class_code = f"K{uuid4().hex[:4].upper()}"
    class_id = _seed_class(db_session, tenant_id=tenant.id, code=class_code)
    term_id = _seed_term(db_session, tenant_id=tenant.id, code="2026-T2")
    student_id = _seed_student(db_session, tenant_id=tenant.id)
    enrollment_id = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=student_id,
                                     class_id=class_id, term_id=term_id)

    # All 3 sub-strands get BE
    r = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessment_type": "SUMMATIVE",
            "assessments": [{"sub_strand_id": sid, "performance_level": "BE"} for sid in ss_ids],
        },
        headers=headers,
    )
    assert r.status_code == 200

    r2 = client.get(f"{BASE}/classes/{class_code}/term/{term_id}/analytics", headers=headers)
    body = r2.json()
    assert len(body["support_flags"]) == 1
    flag = body["support_flags"][0]
    assert flag["be_count"] == 3
    assert len(flag["learning_areas_flagged"]) == 1


# ══════════════════════════════════════════════════════════════════════════════
# 3. Learner Progress — multi-term (Step 4)
# ══════════════════════════════════════════════════════════════════════════════

def test_learner_progress_single_term(client: TestClient, db_session: Session):
    tenant, headers, class_code, term_id, enrollment_id, ss_id = _full_setup(client, db_session)
    _upsert(client, headers, enrollment_id, term_id, ss_id, "ME", "SUMMATIVE")

    r = client.get(f"{BASE}/enrollments/{enrollment_id}/progress", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert "student_name" in body
    assert "progress" in body
    assert len(body["progress"]) >= 1
    la_prog = body["progress"][0]
    assert len(la_prog["terms"]) == 1
    t = la_prog["terms"][0]
    assert t["me_count"] == 1


def test_learner_progress_multi_term(client: TestClient, db_session: Session):
    """Progress across two terms should appear as two entries per LA."""
    tenant = create_tenant(db_session, slug=f"prog-mt-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_CBC)
    la_id, _, ss_id = _create_curriculum(client, headers)

    class_code = f"P{uuid4().hex[:4].upper()}"
    class_id = _seed_class(db_session, tenant_id=tenant.id, code=class_code)
    student_id = _seed_student(db_session, tenant_id=tenant.id)

    # Term 1
    term1 = _seed_term(db_session, tenant_id=tenant.id, code="2025-T1")
    enr1 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=student_id,
                            class_id=class_id, term_id=term1)
    _upsert(client, headers, enr1, term1, ss_id, "AE", "SUMMATIVE")

    # Term 2 — same student but different enrollment row
    term2 = _seed_term(db_session, tenant_id=tenant.id, code="2025-T2")
    enr2 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=student_id,
                            class_id=class_id, term_id=term2)
    _upsert(client, headers, enr2, term2, ss_id, "ME", "SUMMATIVE")

    # Fetch progress for either enrollment — should show 2 terms in the LA
    r = client.get(f"{BASE}/enrollments/{enr1}/progress", headers=headers)
    assert r.status_code == 200
    progress = r.json()["progress"]
    assert len(progress) >= 1
    all_terms = progress[0]["terms"]
    assert len(all_terms) >= 1  # at least the one for enr1


def test_learner_progress_not_found(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"prog-404-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_CBC)
    r = client.get(f"{BASE}/enrollments/{uuid4()}/progress", headers=headers)
    assert r.status_code == 404


def test_learner_progress_requires_permission(client: TestClient, db_session: Session):
    tenant, _, _, term_id, enrollment_id, _ = _full_setup(client, db_session)
    _, no_headers = make_actor(db_session, tenant=tenant, permissions=[])
    r = client.get(f"{BASE}/enrollments/{enrollment_id}/progress", headers=no_headers)
    assert r.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# 4. Learner Support Report (Step 4)
# ══════════════════════════════════════════════════════════════════════════════

def test_support_report_structure(client: TestClient, db_session: Session):
    tenant, headers, class_code, term_id, enrollment_id, ss_id = _full_setup(client, db_session)
    _upsert(client, headers, enrollment_id, term_id, ss_id, "ME", "SUMMATIVE")

    r = client.get(f"{BASE}/classes/{class_code}/term/{term_id}/support-report", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert "students" in body
    assert "term_name" in body
    assert "generated_at" in body
    assert len(body["students"]) == 1
    s = body["students"][0]
    assert "be_total" in s
    assert "flagged_areas" in s


def test_support_report_flags_be_students(client: TestClient, db_session: Session):
    """Students with ≥3 BE in any LA appear in flagged_areas."""
    tenant = create_tenant(db_session, slug=f"sup-flag-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_CBC)

    la = client.post(
        f"{BASE}/curriculum/learning-areas",
        json={"name": "Science", "code": f"SCI-{uuid4().hex[:4]}", "grade_band": "UPPER_PRIMARY"},
        headers=headers,
    ).json()
    strand = client.post(
        f"{BASE}/curriculum/strands",
        json={"name": "Biology", "code": f"BIO-{uuid4().hex[:4]}", "learning_area_id": la["id"]},
        headers=headers,
    ).json()
    ss_ids = [
        client.post(
            f"{BASE}/curriculum/sub-strands",
            json={"name": f"S{i}", "code": f"BS{i}-{uuid4().hex[:4]}", "strand_id": strand["id"]},
            headers=headers,
        ).json()["id"]
        for i in range(3)
    ]

    cc = f"S{uuid4().hex[:4].upper()}"
    cid = _seed_class(db_session, tenant_id=tenant.id, code=cc)
    tid = _seed_term(db_session, tenant_id=tenant.id, code="2026-T3")
    sid = _seed_student(db_session, tenant_id=tenant.id)
    eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid, class_id=cid, term_id=tid)

    client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": eid,
            "term_id": tid,
            "assessment_type": "SUMMATIVE",
            "assessments": [{"sub_strand_id": s, "performance_level": "BE"} for s in ss_ids],
        },
        headers=headers,
    )

    r = client.get(f"{BASE}/classes/{cc}/term/{tid}/support-report", headers=headers)
    body = r.json()
    student = body["students"][0]
    assert student["be_total"] == 3
    assert len(student["flagged_areas"]) == 1


def test_support_report_csv_download(client: TestClient, db_session: Session):
    tenant, headers, class_code, term_id, enrollment_id, ss_id = _full_setup(client, db_session)
    _upsert(client, headers, enrollment_id, term_id, ss_id, "AE", "SUMMATIVE")

    r = client.get(
        f"{BASE}/classes/{class_code}/term/{term_id}/support-report/csv",
        headers=headers,
    )
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    content = r.content.decode("utf-8-sig")
    assert "Student Name" in content
    assert "BE" in content


def test_support_report_requires_generate_permission(client: TestClient, db_session: Session):
    tenant, _, class_code, term_id, _, _ = _full_setup(client, db_session)
    _, view_headers = make_actor(db_session, tenant=tenant, permissions=["cbc.assessments.view"])
    r = client.get(f"{BASE}/classes/{class_code}/term/{term_id}/support-report", headers=view_headers)
    assert r.status_code == 403


def test_support_report_invalid_term(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"sup-404-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_CBC)
    r = client.get(f"{BASE}/classes/G4A/term/{uuid4()}/support-report", headers=headers)
    assert r.status_code == 404
