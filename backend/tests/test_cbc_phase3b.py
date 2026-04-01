"""
Tests for Phase 3B — CBC Assessments backend.

Endpoints exercised:
  GET    /api/v1/cbc/curriculum                          — curriculum tree
  POST   /api/v1/cbc/curriculum/learning-areas           — create LA
  PATCH  /api/v1/cbc/curriculum/learning-areas/{id}      — update LA
  POST   /api/v1/cbc/curriculum/strands                  — create strand
  PATCH  /api/v1/cbc/curriculum/strands/{id}             — update strand
  POST   /api/v1/cbc/curriculum/sub-strands              — create sub-strand
  PATCH  /api/v1/cbc/curriculum/sub-strands/{id}         — update sub-strand
  POST   /api/v1/cbc/curriculum/seed                     — seed default curriculum
  GET    /api/v1/cbc/assessments                         — list assessments
  PUT    /api/v1/cbc/assessments                         — bulk upsert
  GET    /api/v1/cbc/enrollments/{id}/term/{id}/report   — learner report
  GET    /api/v1/cbc/enrollments/{id}/term/{id}/pdf      — PDF download
"""
from __future__ import annotations

import sqlalchemy as sa
import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/cbc"

# Permission bundles
VIEW_CURRICULUM = ["cbc.curriculum.view"]
MANAGE_CURRICULUM = ["cbc.curriculum.manage", "cbc.curriculum.view"]
ENTER = ["cbc.assessments.enter", "cbc.assessments.view"]
VIEW_ONLY = ["cbc.assessments.view"]
REPORTS = ["cbc.reports.generate", "cbc.assessments.view"]
ALL_CBC = [
    "cbc.curriculum.manage", "cbc.curriculum.view",
    "cbc.assessments.enter", "cbc.assessments.view", "cbc.reports.generate",
]


# ── Seed helpers ──────────────────────────────────────────────────────────────

def _seed_student(db_session: Session, *, tenant_id, admission_no: str = "ADM-CBC-001") -> str:
    sid = str(uuid4())
    db_session.execute(
        sa.text(
            "INSERT INTO core.students "
            "(id, tenant_id, admission_no, first_name, last_name, status) "
            "VALUES (:id, :tid, :adm, 'Amara', 'Wanjiku', 'ACTIVE')"
        ),
        {"id": sid, "tid": str(tenant_id), "adm": admission_no},
    )
    db_session.commit()
    return sid


def _seed_class(db_session: Session, *, tenant_id, code: str = "G3A") -> str:
    cid = str(uuid4())
    db_session.execute(
        sa.text(
            "INSERT INTO core.tenant_classes (id, tenant_id, code, name, is_active) "
            "VALUES (:id, :tid, :code, :name, true)"
        ),
        {"id": cid, "tid": str(tenant_id), "code": code, "name": f"Class {code}"},
    )
    db_session.commit()
    return cid


def _seed_term(db_session: Session, *, tenant_id, code: str = "2026-T1") -> str:
    tid = str(uuid4())
    db_session.execute(
        sa.text(
            "INSERT INTO core.tenant_terms (id, tenant_id, code, name, is_active) "
            "VALUES (:id, :tid, :code, :name, true)"
        ),
        {"id": tid, "tid": str(tenant_id), "code": code, "name": f"Term {code}"},
    )
    db_session.commit()
    return tid


def _seed_enrollment(db_session: Session, *, tenant_id, student_id, class_id, term_id) -> str:
    eid = str(uuid4())
    db_session.execute(
        sa.text(
            "INSERT INTO core.student_class_enrollments "
            "(id, tenant_id, student_id, class_id, term_id, status) "
            "VALUES (:id, :tid, :sid, :cid, :termid, 'ACTIVE')"
        ),
        {
            "id": eid, "tid": str(tenant_id),
            "sid": str(student_id), "cid": str(class_id), "termid": str(term_id),
        },
    )
    db_session.commit()
    return eid


def _create_la(client: TestClient, headers: dict, tenant_id) -> dict:
    r = client.post(
        f"{BASE}/curriculum/learning-areas",
        json={"name": "English Activities", "code": "ENG-LP", "grade_band": "LOWER_PRIMARY"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _create_strand(client: TestClient, headers: dict, tenant_id, la_id: str) -> dict:
    r = client.post(
        f"{BASE}/curriculum/strands",
        json={"name": "Reading", "code": "RD", "learning_area_id": la_id},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _create_sub_strand(client: TestClient, headers: dict, strand_id: str) -> dict:
    r = client.post(
        f"{BASE}/curriculum/sub-strands",
        json={"name": "Reading Comprehension", "code": "RD1", "strand_id": strand_id},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


# ══════════════════════════════════════════════════════════════════════════════
# 1. Curriculum — GET tree
# ══════════════════════════════════════════════════════════════════════════════

def test_get_curriculum_empty(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-t1-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=VIEW_CURRICULUM)
    r = client.get(f"{BASE}/curriculum", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert "learning_areas" in body
    assert isinstance(body["learning_areas"], list)


def test_get_curriculum_with_band_filter(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-t2-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    _create_la(client, headers, tenant.id)
    r = client.get(f"{BASE}/curriculum?grade_band=LOWER_PRIMARY", headers=headers)
    assert r.status_code == 200
    las = r.json()["learning_areas"]
    assert all(la["grade_band"] == "LOWER_PRIMARY" for la in las)


def test_curriculum_view_requires_permission(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-t3-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=[])
    r = client.get(f"{BASE}/curriculum", headers=headers)
    assert r.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# 2. Learning Areas — CRUD
# ══════════════════════════════════════════════════════════════════════════════

def test_create_learning_area(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-la1-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    la = _create_la(client, headers, tenant.id)
    assert la["name"] == "English Activities"
    assert la["code"] == "ENG-LP"
    assert la["grade_band"] == "LOWER_PRIMARY"
    assert la["is_active"] is True


def test_create_learning_area_duplicate_code_rejected(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-la2-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    _create_la(client, headers, tenant.id)
    r = client.post(
        f"{BASE}/curriculum/learning-areas",
        json={"name": "Another", "code": "ENG-LP", "grade_band": "LOWER_PRIMARY"},
        headers=headers,
    )
    assert r.status_code == 409


def test_create_learning_area_requires_manage(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-la3-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=VIEW_CURRICULUM)
    r = client.post(
        f"{BASE}/curriculum/learning-areas",
        json={"name": "Test", "code": "TST", "grade_band": "UPPER_PRIMARY"},
        headers=headers,
    )
    assert r.status_code == 403


def test_create_learning_area_invalid_band(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-la4-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    r = client.post(
        f"{BASE}/curriculum/learning-areas",
        json={"name": "Test", "code": "TST", "grade_band": "INVALID_BAND"},
        headers=headers,
    )
    assert r.status_code == 422


def test_update_learning_area(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-la5-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    la = _create_la(client, headers, tenant.id)
    r = client.patch(
        f"{BASE}/curriculum/learning-areas/{la['id']}",
        json={"name": "English Language Activities", "is_active": False},
        headers=headers,
    )
    assert r.status_code == 200
    updated = r.json()
    assert updated["name"] == "English Language Activities"
    assert updated["is_active"] is False


# ══════════════════════════════════════════════════════════════════════════════
# 3. Strands — CRUD
# ══════════════════════════════════════════════════════════════════════════════

def test_create_strand(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-s1-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    la = _create_la(client, headers, tenant.id)
    strand = _create_strand(client, headers, tenant.id, la["id"])
    assert strand["name"] == "Reading"
    assert strand["code"] == "RD"
    assert strand["learning_area_id"] == la["id"]


def test_create_strand_duplicate_code_in_la_rejected(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-s2-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    la = _create_la(client, headers, tenant.id)
    _create_strand(client, headers, tenant.id, la["id"])
    r = client.post(
        f"{BASE}/curriculum/strands",
        json={"name": "Reading Again", "code": "RD", "learning_area_id": la["id"]},
        headers=headers,
    )
    assert r.status_code == 409


def test_update_strand(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-s3-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    la = _create_la(client, headers, tenant.id)
    strand = _create_strand(client, headers, tenant.id, la["id"])
    r = client.patch(
        f"{BASE}/curriculum/strands/{strand['id']}",
        json={"name": "Reading Skills", "is_active": True},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Reading Skills"


# ══════════════════════════════════════════════════════════════════════════════
# 4. Sub-strands — CRUD
# ══════════════════════════════════════════════════════════════════════════════

def test_create_sub_strand(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-ss1-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    la = _create_la(client, headers, tenant.id)
    strand = _create_strand(client, headers, tenant.id, la["id"])
    ss = _create_sub_strand(client, headers, strand["id"])
    assert ss["name"] == "Reading Comprehension"
    assert ss["code"] == "RD1"
    assert ss["strand_id"] == strand["id"]


def test_update_sub_strand(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-ss2-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    la = _create_la(client, headers, tenant.id)
    strand = _create_strand(client, headers, tenant.id, la["id"])
    ss = _create_sub_strand(client, headers, strand["id"])
    r = client.patch(
        f"{BASE}/curriculum/sub-strands/{ss['id']}",
        json={"name": "Reading for Meaning", "is_active": False},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Reading for Meaning"
    assert r.json()["is_active"] is False


# ══════════════════════════════════════════════════════════════════════════════
# 5. Curriculum tree — full structure visible
# ══════════════════════════════════════════════════════════════════════════════

def test_curriculum_tree_contains_strands_and_sub_strands(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-tree-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    la = _create_la(client, headers, tenant.id)
    strand = _create_strand(client, headers, tenant.id, la["id"])
    _create_sub_strand(client, headers, strand["id"])

    r = client.get(f"{BASE}/curriculum", headers=headers)
    assert r.status_code == 200
    las = r.json()["learning_areas"]
    assert len(las) >= 1
    found_la = next((l for l in las if l["id"] == la["id"]), None)
    assert found_la is not None
    assert len(found_la["strands"]) == 1
    assert len(found_la["strands"][0]["sub_strands"]) == 1


# ══════════════════════════════════════════════════════════════════════════════
# 6. Seed default curriculum
# ══════════════════════════════════════════════════════════════════════════════

def test_seed_curriculum(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-seed-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    r = client.post(f"{BASE}/curriculum/seed", json={}, headers=headers)
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Curriculum should now have learning areas
    r2 = client.get(f"{BASE}/curriculum?active_only=false", headers=headers)
    assert r2.status_code == 200
    las = r2.json()["learning_areas"]
    assert len(las) > 0


def test_seed_curriculum_idempotent(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-seed2-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE_CURRICULUM)
    # Seed twice — should not create duplicates
    client.post(f"{BASE}/curriculum/seed", json={}, headers=headers)
    r = client.post(f"{BASE}/curriculum/seed", json={}, headers=headers)
    assert r.status_code == 200

    r2 = client.get(f"{BASE}/curriculum?active_only=false", headers=headers)
    las = r2.json()["learning_areas"]
    # Each (code, grade_band) pair should appear exactly once — no duplicates
    keys = [(la["code"], la["grade_band"]) for la in las]
    assert len(keys) == len(set(keys)), "Duplicate (code, grade_band) found after double seed"


def test_seed_requires_manage(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-seed3-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=VIEW_CURRICULUM)
    r = client.post(f"{BASE}/curriculum/seed", json={}, headers=headers)
    assert r.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# 7. Assessments — bulk upsert
# ══════════════════════════════════════════════════════════════════════════════

def _setup_full(client, db_session, *, slug_suffix=""):
    """Create a tenant, student, class, term, enrollment, and one sub-strand."""
    tenant = create_tenant(db_session, slug=f"cbc-full-{uuid4().hex[:6]}{slug_suffix}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=ALL_CBC)

    la = _create_la(client, headers, tenant.id)
    strand = _create_strand(client, headers, tenant.id, la["id"])
    ss = _create_sub_strand(client, headers, strand["id"])

    student_id = _seed_student(db_session, tenant_id=tenant.id)
    class_id = _seed_class(db_session, tenant_id=tenant.id)
    term_id = _seed_term(db_session, tenant_id=tenant.id)
    enrollment_id = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=student_id, class_id=class_id, term_id=term_id)

    return tenant, headers, ss, enrollment_id, term_id


def test_bulk_upsert_assessments_create(client: TestClient, db_session: Session):
    tenant, headers, ss, enrollment_id, term_id = _setup_full(client, db_session)
    r = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [
                {"sub_strand_id": ss["id"], "performance_level": "ME", "teacher_observations": "Good progress"}
            ],
        },
        headers=headers,
    )
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["performance_level"] == "ME"
    assert rows[0]["teacher_observations"] == "Good progress"


def test_bulk_upsert_assessments_update(client: TestClient, db_session: Session):
    tenant, headers, ss, enrollment_id, term_id = _setup_full(client, db_session)
    # Create
    client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [{"sub_strand_id": ss["id"], "performance_level": "AE"}],
        },
        headers=headers,
    )
    # Update same sub-strand
    r = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [{"sub_strand_id": ss["id"], "performance_level": "EE", "teacher_observations": "Excellent!"}],
        },
        headers=headers,
    )
    assert r.status_code == 200
    rows = r.json()
    assert rows[0]["performance_level"] == "EE"


def test_bulk_upsert_invalid_performance_level(client: TestClient, db_session: Session):
    tenant, headers, ss, enrollment_id, term_id = _setup_full(client, db_session)
    r = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [{"sub_strand_id": ss["id"], "performance_level": "INVALID"}],
        },
        headers=headers,
    )
    assert r.status_code == 422


def test_bulk_upsert_requires_enter_permission(client: TestClient, db_session: Session):
    tenant, _, ss, enrollment_id, term_id = _setup_full(client, db_session)
    _, view_headers = make_actor(db_session, tenant=tenant, permissions=VIEW_ONLY)
    r = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [{"sub_strand_id": ss["id"], "performance_level": "BE"}],
        },
        headers=view_headers,
    )
    assert r.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# 8. Assessments — GET list
# ══════════════════════════════════════════════════════════════════════════════

def test_list_assessments_filtered(client: TestClient, db_session: Session):
    tenant, headers, ss, enrollment_id, term_id = _setup_full(client, db_session)
    client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [{"sub_strand_id": ss["id"], "performance_level": "ME"}],
        },
        headers=headers,
    )
    r = client.get(
        f"{BASE}/assessments?enrollment_id={enrollment_id}&term_id={term_id}",
        headers=headers,
    )
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["performance_level"] == "ME"


def test_list_assessments_wrong_tenant_returns_empty(client: TestClient, db_session: Session):
    tenant, headers, ss, enrollment_id, term_id = _setup_full(client, db_session)
    client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [{"sub_strand_id": ss["id"], "performance_level": "ME"}],
        },
        headers=headers,
    )
    # Different tenant cannot see these assessments
    other_tenant = create_tenant(db_session, slug=f"cbc-other-{uuid4().hex[:6]}")
    _, other_headers = make_actor(db_session, tenant=other_tenant, permissions=VIEW_ONLY)
    r = client.get(
        f"{BASE}/assessments?enrollment_id={enrollment_id}",
        headers=other_headers,
    )
    assert r.status_code == 200
    assert len(r.json()) == 0


# ══════════════════════════════════════════════════════════════════════════════
# 9. Report — JSON
# ══════════════════════════════════════════════════════════════════════════════

def test_learner_report_json(client: TestClient, db_session: Session):
    tenant, headers, ss, enrollment_id, term_id = _setup_full(client, db_session)
    client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [{"sub_strand_id": ss["id"], "performance_level": "EE", "teacher_observations": "Exceptional"}],
        },
        headers=headers,
    )
    r = client.get(
        f"{BASE}/enrollments/{enrollment_id}/term/{term_id}/report",
        headers=headers,
    )
    assert r.status_code == 200
    report = r.json()
    assert "student_name" in report
    assert "learning_areas" in report
    las = report["learning_areas"]
    assert len(las) == 1
    strand = las[0]["strands"][0]
    ss_row = strand["sub_strands"][0]
    assert ss_row["performance_level"] == "EE"
    assert ss_row["teacher_observations"] == "Exceptional"


def test_learner_report_not_found(client: TestClient, db_session: Session):
    tenant = create_tenant(db_session, slug=f"cbc-rpt-{uuid4().hex[:6]}")
    _, headers = make_actor(db_session, tenant=tenant, permissions=VIEW_ONLY)
    fake_id = str(uuid4())
    r = client.get(f"{BASE}/enrollments/{fake_id}/term/{fake_id}/report", headers=headers)
    assert r.status_code == 404


# ══════════════════════════════════════════════════════════════════════════════
# 10. Report — PDF
# ══════════════════════════════════════════════════════════════════════════════

def test_learner_pdf_download(client: TestClient, db_session: Session):
    tenant, headers, ss, enrollment_id, term_id = _setup_full(client, db_session)
    client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [{"sub_strand_id": ss["id"], "performance_level": "ME"}],
        },
        headers=headers,
    )
    r = client.get(
        f"{BASE}/enrollments/{enrollment_id}/term/{term_id}/pdf",
        headers=headers,
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert len(r.content) > 100  # has actual PDF bytes


def test_learner_pdf_requires_generate_permission(client: TestClient, db_session: Session):
    tenant, _, ss, enrollment_id, term_id = _setup_full(client, db_session)
    _, view_headers = make_actor(db_session, tenant=tenant, permissions=VIEW_ONLY)
    r = client.get(
        f"{BASE}/enrollments/{enrollment_id}/term/{term_id}/pdf",
        headers=view_headers,
    )
    assert r.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# 11. All BE/AE/ME/EE values accepted
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("level", ["BE", "AE", "ME", "EE"])
def test_all_performance_levels_accepted(client: TestClient, db_session: Session, level: str):
    tenant, headers, ss, enrollment_id, term_id = _setup_full(client, db_session, slug_suffix=level)
    r = client.put(
        f"{BASE}/assessments",
        json={
            "enrollment_id": enrollment_id,
            "term_id": term_id,
            "assessments": [{"sub_strand_id": ss["id"], "performance_level": level}],
        },
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()[0]["performance_level"] == level
