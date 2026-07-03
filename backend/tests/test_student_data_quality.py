"""Phase T — student-profile data integrity.

Covers:
  T1 sync gaps
    * biodata rename propagates to enrollment payload.student_name
    * guardian PATCH (Parents module) writes through to payload guardian_*
    * enrollment PATCH guardian edits write through to the linked parent
  T3 guardian data-quality checker
    * scan flags NAME_MISSING / NAME_IS_PHONE / PHONE_MULTI / PHONE_INVALID
      / PARENT_UNLINKED and skips clean rows
    * one-click fixes: SPLIT_MULTI_PHONE, NORMALIZE_PHONE, LINK_PARENT
    * fixes are audited; RBAC enforced
"""
from __future__ import annotations

import json
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor


DQ_PERMS = ["enrollment.manage"]
BIO_PERMS = ["students.biodata.read", "students.biodata.update", "enrollment.manage"]


def _seed_enrollment(
    db: Session, *, tenant_id,
    guardian_name: str | None = "Jane Doe",
    guardian_phone: str | None = "0712345678",
    status: str = "ENROLLED",
    with_student: bool = True,
) -> tuple[str, str | None]:
    sid = None
    if with_student:
        sid = str(uuid4())
        db.execute(text(
            "INSERT INTO core.students "
            "(id, tenant_id, admission_no, first_name, last_name, status, admission_year) "
            "VALUES (:id, :tid, :adm, 'Data', 'Quality', 'ACTIVE', 2026)"
        ), {"id": sid, "tid": str(tenant_id), "adm": f"DQ-{uuid4().hex[:6].upper()}"})
    eid = str(uuid4())
    payload = {"student_name": "Data Quality", "class_code": "GRADE_1"}
    if guardian_name is not None:
        payload["guardian_name"] = guardian_name
    if guardian_phone is not None:
        payload["guardian_phone"] = guardian_phone
    db.execute(text(
        "INSERT INTO core.enrollments (id, tenant_id, student_id, status, payload) "
        "VALUES (:id, :tid, :sid, :status, CAST(:pl AS jsonb))"
    ), {"id": eid, "tid": str(tenant_id), "sid": sid, "status": status,
        "pl": json.dumps(payload)})
    db.commit()
    return eid, sid


def _seed_parent(
    db: Session, *, tenant_id, phone: str,
    first_name: str = "Mary", last_name: str = "Guardian",
) -> str:
    pid = str(uuid4())
    db.execute(text(
        "INSERT INTO core.parents (id, tenant_id, first_name, last_name, phone) "
        "VALUES (:id, :tid, :fn, :ln, :phone)"
    ), {"id": pid, "tid": str(tenant_id), "fn": first_name, "ln": last_name,
        "phone": phone})
    db.commit()
    return pid


def _payload(db: Session, enrollment_id: str) -> dict:
    raw = db.execute(text(
        "SELECT payload FROM core.enrollments WHERE id = :id"
    ), {"id": enrollment_id}).scalar()
    return raw if isinstance(raw, dict) else {}


class TestSyncGaps:
    def test_biodata_rename_propagates_to_enrollment_payload(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIO_PERMS)
        eid, sid = _seed_enrollment(db_session, tenant_id=tenant.id)

        r = client.patch(
            f"/api/v1/students/{sid}/biodata",
            headers=headers,
            json={"first_name": "Renamed", "last_name": "Person"},
        )
        assert r.status_code == 200, r.text
        assert _payload(db_session, eid)["student_name"] == "Renamed Person"
        cnt = db_session.execute(text(
            "SELECT COUNT(*) FROM core.audit_logs "
            "WHERE tenant_id = :tid AND action = 'student.name.sync'"
        ), {"tid": str(tenant.id)}).scalar()
        assert cnt == 1

    def test_guardian_patch_writes_through_to_payload(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIO_PERMS)
        eid, sid = _seed_enrollment(db_session, tenant_id=tenant.id)
        pid = _seed_parent(db_session, tenant_id=tenant.id, phone="0712345678")
        db_session.execute(text(
            "INSERT INTO core.parent_students (tenant_id, parent_id, student_id, relationship, is_active) "
            "VALUES (:tid, :pid, :sid, 'GUARDIAN', TRUE)"
        ), {"tid": str(tenant.id), "pid": pid, "sid": sid})
        db_session.commit()

        r = client.patch(
            f"/api/v1/students/{sid}/guardian/{pid}",
            headers=headers,
            json={"first_name": "Updated", "last_name": "Mum", "phone": "0798765432"},
        )
        assert r.status_code == 200, r.text
        pl = _payload(db_session, eid)
        assert pl["guardian_name"] == "Updated Mum"
        assert pl["guardian_phone"] == "0798765432"

    def test_enrollment_guardian_edit_writes_through_to_parent(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIO_PERMS)
        eid, _ = _seed_enrollment(db_session, tenant_id=tenant.id, status="DRAFT")
        pid = _seed_parent(db_session, tenant_id=tenant.id, phone="0712345678")
        db_session.execute(text(
            "INSERT INTO core.parent_enrollment_links (tenant_id, parent_id, enrollment_id, relationship) "
            "VALUES (:tid, :pid, :eid, 'GUARDIAN')"
        ), {"tid": str(tenant.id), "pid": pid, "eid": eid})
        db_session.commit()

        r = client.patch(
            f"/api/v1/enrollments/{eid}",
            headers=headers,
            json={"payload": {
                "guardian_name": "Grace Wanjiku",
                "guardian_phone": "0700111222",
            }},
        )
        assert r.status_code == 200, r.text
        parent = db_session.execute(text(
            "SELECT first_name, last_name, phone FROM core.parents WHERE id = :id"
        ), {"id": pid}).mappings().one()
        assert parent["first_name"] == "Grace"
        assert parent["last_name"] == "Wanjiku"
        assert parent["phone"] == "0700111222"

    def test_enrollment_guardian_phone_conflict_skips_phone(
        self, client: TestClient, db_session: Session,
    ):
        """Phone owned by ANOTHER parent → phone write-through is skipped
        (no silent merge), name still syncs, enrollment save succeeds."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIO_PERMS)
        eid, _ = _seed_enrollment(db_session, tenant_id=tenant.id, status="DRAFT")
        pid = _seed_parent(db_session, tenant_id=tenant.id, phone="0712345678")
        _seed_parent(db_session, tenant_id=tenant.id, phone="0700111222",
                     first_name="Other", last_name="Parent")
        db_session.execute(text(
            "INSERT INTO core.parent_enrollment_links (tenant_id, parent_id, enrollment_id, relationship) "
            "VALUES (:tid, :pid, :eid, 'GUARDIAN')"
        ), {"tid": str(tenant.id), "pid": pid, "eid": eid})
        db_session.commit()

        r = client.patch(
            f"/api/v1/enrollments/{eid}",
            headers=headers,
            json={"payload": {
                "guardian_name": "Grace Wanjiku",
                "guardian_phone": "0700111222",  # belongs to Other Parent
            }},
        )
        assert r.status_code == 200, r.text
        parent = db_session.execute(text(
            "SELECT first_name, phone FROM core.parents WHERE id = :id"
        ), {"id": pid}).mappings().one()
        assert parent["first_name"] == "Grace"       # name synced
        assert parent["phone"] == "0712345678"        # phone untouched


class TestDataQualityScan:
    def test_scan_flags_all_issue_types(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        # 1. name missing
        e_missing, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id, guardian_name="N/A",
        )
        # 2. name is a phone
        e_phone_name, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id, guardian_name="0733999888",
        )
        # 3. two phones
        e_multi, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id,
            guardian_phone="0712345678/0723456789",
        )
        # 4. invalid phone
        e_invalid, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id, guardian_phone="12345",
        )
        # 5. parent exists but not linked
        _seed_parent(db_session, tenant_id=tenant.id, phone="0745000111")
        e_unlinked, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id, guardian_phone="0745000111",
        )
        # 6. clean row
        e_clean, _ = _seed_enrollment(db_session, tenant_id=tenant.id)

        r = client.get("/api/v1/tenants/students/data-quality", headers=headers)
        assert r.status_code == 200, r.text
        report = r.json()
        by_id = {s["enrollment_id"]: s for s in report["students"]}

        assert "NAME_MISSING" in by_id[e_missing]["issues"]
        assert "NAME_IS_PHONE" in by_id[e_phone_name]["issues"]
        assert "PHONE_MULTI" in by_id[e_multi]["issues"]
        assert by_id[e_multi]["suggested"]["split_phones"] == ["0712345678", "0723456789"]
        assert "PHONE_INVALID" in by_id[e_invalid]["issues"]
        assert "PARENT_UNLINKED" in by_id[e_unlinked]["issues"]
        assert by_id[e_unlinked]["suggested"]["matched_parent"]["parent_name"] == "Mary Guardian"
        # Clean student with a linked... e_clean has phone 0712345678 but no
        # parent with that phone → not flagged for anything.
        assert e_clean not in by_id

    def test_scan_flags_denormalized_phone_with_suggestion(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id, guardian_phone="+254712345678",
        )
        r = client.get("/api/v1/tenants/students/data-quality", headers=headers)
        row = next(s for s in r.json()["students"] if s["enrollment_id"] == eid)
        assert "PHONE_INVALID" in row["issues"]
        assert row["suggested"]["normalized_phone"] == "0712345678"

    def test_scan_requires_permission(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        r = client.get("/api/v1/tenants/students/data-quality", headers=headers)
        assert r.status_code == 403


class TestDataQualityFixes:
    def test_split_multi_phone(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id,
            guardian_phone="+254712345678 / 0723456789",
        )
        r = client.post(
            "/api/v1/tenants/students/data-quality/fix",
            headers=headers,
            json={"enrollment_id": eid, "action": "SPLIT_MULTI_PHONE"},
        )
        assert r.status_code == 200, r.text
        pl = _payload(db_session, eid)
        assert pl["guardian_phone"] == "0712345678"
        assert pl["guardian_phone_alt"] == "0723456789"

    def test_normalize_phone(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id, guardian_phone="+254798765432",
        )
        r = client.post(
            "/api/v1/tenants/students/data-quality/fix",
            headers=headers,
            json={"enrollment_id": eid, "action": "NORMALIZE_PHONE"},
        )
        assert r.status_code == 200, r.text
        assert _payload(db_session, eid)["guardian_phone"] == "0798765432"

    def test_normalize_rejects_hopeless_phone(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id, guardian_phone="12345",
        )
        r = client.post(
            "/api/v1/tenants/students/data-quality/fix",
            headers=headers,
            json={"enrollment_id": eid, "action": "NORMALIZE_PHONE"},
        )
        assert r.status_code == 400

    def test_link_parent(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        pid = _seed_parent(db_session, tenant_id=tenant.id, phone="0745000111")
        eid, sid = _seed_enrollment(
            db_session, tenant_id=tenant.id, guardian_phone="0745000111",
        )
        r = client.post(
            "/api/v1/tenants/students/data-quality/fix",
            headers=headers,
            json={"enrollment_id": eid, "action": "LINK_PARENT"},
        )
        assert r.status_code == 200, r.text
        link = db_session.execute(text(
            "SELECT 1 FROM core.parent_enrollment_links "
            "WHERE tenant_id = :tid AND parent_id = :pid AND enrollment_id = :eid"
        ), {"tid": str(tenant.id), "pid": pid, "eid": eid}).first()
        assert link is not None
        ps = db_session.execute(text(
            "SELECT 1 FROM core.parent_students "
            "WHERE tenant_id = :tid AND parent_id = :pid AND student_id = :sid"
        ), {"tid": str(tenant.id), "pid": pid, "sid": sid}).first()
        assert ps is not None
        # The issue disappears on re-scan (idempotent loop closes).
        rescan = client.get("/api/v1/tenants/students/data-quality", headers=headers)
        row = next(
            (s for s in rescan.json()["students"] if s["enrollment_id"] == eid), None,
        )
        assert row is None or "PARENT_UNLINKED" not in row["issues"]

    def test_fix_writes_audit(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id, guardian_phone="0712345678/0723456789",
        )
        client.post(
            "/api/v1/tenants/students/data-quality/fix",
            headers=headers,
            json={"enrollment_id": eid, "action": "SPLIT_MULTI_PHONE"},
        )
        cnt = db_session.execute(text(
            "SELECT COUNT(*) FROM core.audit_logs "
            "WHERE tenant_id = :tid AND action = 'students.data_quality.fix'"
        ), {"tid": str(tenant.id)}).scalar()
        assert cnt == 1

    def test_unknown_action_400(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, _ = _seed_enrollment(db_session, tenant_id=tenant.id)
        r = client.post(
            "/api/v1/tenants/students/data-quality/fix",
            headers=headers,
            json={"enrollment_id": eid, "action": "MAKE_IT_BETTER"},
        )
        assert r.status_code == 400


class TestGuardianFormExport:
    """Phase U — printable Guardian Information Update Forms."""

    def test_export_pdf_batch(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        _seed_enrollment(db_session, tenant_id=tenant.id, guardian_name="N/A")
        _seed_enrollment(
            db_session, tenant_id=tenant.id,
            guardian_phone="0712345678/0723456789",
        )
        r = client.get(
            "/api/v1/tenants/students/data-quality/export.pdf",
            headers=headers,
        )
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content.startswith(b"%PDF-")
        assert len(r.content) > 2_000  # two branded pages, not a stub

        cnt = db_session.execute(text(
            "SELECT COUNT(*) FROM core.audit_logs "
            "WHERE tenant_id = :tid AND action = 'students.data_quality.export'"
        ), {"tid": str(tenant.id)}).scalar()
        assert cnt == 1

    def test_export_pdf_single_student(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, _ = _seed_enrollment(
            db_session, tenant_id=tenant.id, guardian_name="N/A",
        )
        _seed_enrollment(db_session, tenant_id=tenant.id, guardian_name="0733999888")
        r = client.get(
            f"/api/v1/tenants/students/data-quality/export.pdf?enrollment_id={eid}",
            headers=headers,
        )
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF-")

    def test_export_404_for_clean_student(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, _ = _seed_enrollment(db_session, tenant_id=tenant.id)  # clean
        r = client.get(
            f"/api/v1/tenants/students/data-quality/export.pdf?enrollment_id={eid}",
            headers=headers,
        )
        assert r.status_code == 404

    def test_export_requires_permission(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        r = client.get(
            "/api/v1/tenants/students/data-quality/export.pdf",
            headers=headers,
        )
        assert r.status_code == 403
