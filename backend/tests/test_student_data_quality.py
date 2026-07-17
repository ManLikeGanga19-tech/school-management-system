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
        # 6. clean row — complete SIS details so the Phase W student-detail
        # checks (ULI / DoB / birth cert / gender) pass too.
        e_clean, s_clean = _seed_enrollment(db_session, tenant_id=tenant.id)
        db_session.execute(text(
            "UPDATE core.students SET uli = 'ULI-CLEAN-1', "
            "birth_certificate_no = 'BC-1', date_of_birth = '2018-01-01', "
            "gender = 'F' WHERE id = :sid"
        ), {"sid": s_clean})
        db_session.commit()

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
        eid, sid = _seed_enrollment(db_session, tenant_id=tenant.id)  # clean
        db_session.execute(text(
            "UPDATE core.students SET uli = 'ULI-CLEAN-2', "
            "birth_certificate_no = 'BC-2', date_of_birth = '2018-01-01', "
            "gender = 'M' WHERE id = :sid"
        ), {"sid": sid})
        db_session.commit()
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


class TestClassResolution:
    """Phase V — canonical class/grade resolution. The intake form writes
    admission_class; documents used to read only class_code and printed a
    blank class. One chain everywhere now."""

    def _seed_admission_class_enrollment(
        self, db: Session, *, tenant_id, with_student: bool = True,
        payload_extra: dict | None = None,
    ) -> tuple[str, str | None]:
        sid = None
        if with_student:
            sid = str(uuid4())
            db.execute(text(
                "INSERT INTO core.students "
                "(id, tenant_id, admission_no, first_name, last_name, status, admission_year) "
                "VALUES (:id, :tid, :adm, 'Class', 'Resolve', 'ACTIVE', 2026)"
            ), {"id": sid, "tid": str(tenant_id), "adm": f"CR-{uuid4().hex[:6].upper()}"})
        eid = str(uuid4())
        payload = {
            "student_name": "Class Resolve",
            "admission_class": "PP2",     # ← intake form key, NO class_code
            "guardian_name": "N/A",       # flag it so the scan returns it
            **(payload_extra or {}),
        }
        db.execute(text(
            "INSERT INTO core.enrollments (id, tenant_id, student_id, status, payload) "
            "VALUES (:id, :tid, :sid, 'ENROLLED', CAST(:pl AS jsonb))"
        ), {"id": eid, "tid": str(tenant_id), "sid": sid, "pl": json.dumps(payload)})
        db.commit()
        return eid, sid

    def test_scan_resolves_admission_class(
        self, client: TestClient, db_session: Session,
    ):
        """The guardian update sheet's Class column must show the intake
        form's admission_class."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, _ = self._seed_admission_class_enrollment(db_session, tenant_id=tenant.id)
        r = client.get("/api/v1/tenants/students/data-quality", headers=headers)
        row = next(s for s in r.json()["students"] if s["enrollment_id"] == eid)
        assert row["class_code"] == "PP2"

    def test_scan_falls_back_to_sis_class_assignment(
        self, client: TestClient, db_session: Session,
    ):
        """No class in the payload at all → the SIS class assignment fills
        the column."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, sid = self._seed_admission_class_enrollment(
            db_session, tenant_id=tenant.id,
        )
        # Strip every class key from the payload, then assign a SIS class.
        db_session.execute(text(
            "UPDATE core.enrollments SET payload = payload - 'admission_class' "
            "WHERE id = :eid"
        ), {"eid": eid})
        class_id, term_id = str(uuid4()), str(uuid4())
        db_session.execute(text(
            "INSERT INTO core.tenant_classes (id, tenant_id, code, name) "
            "VALUES (:id, :tid, 'GRADE_3', 'Grade 3')"
        ), {"id": class_id, "tid": str(tenant.id)})
        db_session.execute(text(
            "INSERT INTO core.tenant_terms (id, tenant_id, code, name, is_active) "
            "VALUES (:id, :tid, 'T1-2026', 'Term 1 2026', TRUE)"
        ), {"id": term_id, "tid": str(tenant.id)})
        db_session.execute(text(
            "INSERT INTO core.student_class_enrollments (tenant_id, student_id, class_id, term_id) "
            "VALUES (:tid, :sid, :cid, :tmid)"
        ), {"tid": str(tenant.id), "sid": sid, "cid": class_id, "tmid": term_id})
        db_session.commit()

        r = client.get("/api/v1/tenants/students/data-quality", headers=headers)
        row = next(s for s in r.json()["students"] if s["enrollment_id"] == eid)
        assert row["class_code"] == "GRADE_3"

    def test_invoice_document_resolves_admission_class(
        self, client: TestClient, db_session: Session,
    ):
        """The invoice PDF's Class line (via _resolve_student_identity) must
        pick up admission_class — the finance-module blank."""
        from app.api.v1.finance import service
        tenant = create_tenant(db_session)
        eid, _ = self._seed_admission_class_enrollment(db_session, tenant_id=tenant.id)
        iid = str(uuid4())
        db_session.execute(text(
            "INSERT INTO core.invoices "
            "(id, tenant_id, invoice_no, invoice_type, status, enrollment_id, "
            " currency, total_amount, paid_amount, balance_amount) "
            "VALUES (:id, :tid, :no, 'SCHOOL_FEES', 'ISSUED', :eid, 'KES', 5000, 0, 5000)"
        ), {"id": iid, "tid": str(tenant.id), "no": f"INV-{uuid4().hex[:6].upper()}",
            "eid": eid})
        db_session.execute(text(
            "INSERT INTO core.invoice_lines (invoice_id, description, amount) "
            "VALUES (:iid, 'Tuition', 5000)"
        ), {"iid": iid})
        db_session.commit()

        doc = service.build_invoice_document(
            db_session, tenant_id=tenant.id, invoice_id=iid,
        )
        assert doc["class_code"] == "PP2"

    def test_enrollment_create_mirrors_class_code(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIO_PERMS)
        r = client.post(
            "/api/v1/enrollments/",
            headers=headers,
            json={"payload": {
                "student_name": "Mirror Test",
                "admission_class": "GRADE_2",
            }},
        )
        assert r.status_code in (200, 201), r.text
        pl = _payload(db_session, r.json()["id"])
        assert pl["class_code"] == "GRADE_2"
        assert pl["admission_class"] == "GRADE_2"

    def test_enrollment_update_remirrors_alias_edit(
        self, client: TestClient, db_session: Session,
    ):
        """Editing admission_class later must move class_code with it — a
        stale mirror can never win over a fresh intake correction."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIO_PERMS)
        r = client.post(
            "/api/v1/enrollments/",
            headers=headers,
            json={"payload": {
                "student_name": "Mirror Test",
                "admission_class": "GRADE_2",
            }},
        )
        eid = r.json()["id"]
        r2 = client.patch(
            f"/api/v1/enrollments/{eid}",
            headers=headers,
            json={"payload": {"admission_class": "GRADE_4"}},
        )
        assert r2.status_code == 200, r2.text
        pl = _payload(db_session, eid)
        assert pl["admission_class"] == "GRADE_4"
        assert pl["class_code"] == "GRADE_4"


class TestKemisUli:
    """Phase W — KEMIS 2026: ULI replaces NEMIS; new capture fields."""

    def test_uli_missing_flagged_and_clears(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIO_PERMS)
        eid, sid = _seed_enrollment(db_session, tenant_id=tenant.id)
        r = client.get("/api/v1/tenants/students/data-quality", headers=headers)
        row = next(s for s in r.json()["students"] if s["enrollment_id"] == eid)
        assert "ULI_MISSING" in row["issues"]

        # Set the ULI via biodata PATCH -> flag clears on re-scan.
        r2 = client.patch(
            f"/api/v1/students/{sid}/biodata",
            headers=headers, json={"uli": "KEMIS-ULI-0001"},
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["uli"] == "KEMIS-ULI-0001"
        r3 = client.get("/api/v1/tenants/students/data-quality", headers=headers)
        row3 = next((s for s in r3.json()["students"] if s["enrollment_id"] == eid), None)
        assert row3 is None or "ULI_MISSING" not in row3["issues"]

    def test_uli_uniqueness_409(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIO_PERMS)
        _, sid_a = _seed_enrollment(db_session, tenant_id=tenant.id)
        _, sid_b = _seed_enrollment(db_session, tenant_id=tenant.id)
        assert client.patch(
            f"/api/v1/students/{sid_a}/biodata",
            headers=headers, json={"uli": "ULI-DUP-1"},
        ).status_code == 200
        r = client.patch(
            f"/api/v1/students/{sid_b}/biodata",
            headers=headers, json={"uli": "ULI-DUP-1"},
        )
        assert r.status_code == 409

    def test_kemis_biodata_fields_roundtrip(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIO_PERMS)
        _, sid = _seed_enrollment(db_session, tenant_id=tenant.id)
        r = client.patch(
            f"/api/v1/students/{sid}/biodata",
            headers=headers,
            json={
                "kcpe_kjsea_year": 2025,
                "location_of_birth": "Kibra",
                "medical_condition": "Asthma",
                "learner_interests": "Music, Science",
                "orphan_status": "No",
                "sne_disability": "None",
                "stream": "North",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["kcpe_kjsea_year"] == 2025
        assert body["location_of_birth"] == "Kibra"
        assert body["learner_interests"] == "Music, Science"
        assert body["stream"] == "North"

    def test_intake_kemis_parent_sections_create_linked_parents(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIO_PERMS)
        r = client.post(
            "/api/v1/enrollments/",
            headers=headers,
            json={"payload": {
                "student_name": "Kemis Child",
                "admission_class": "GRADE_1",
                "mother": {
                    "first_name": "Mary", "middle_name": "Wanjiru",
                    "last_name": "Kamau", "phone": "0711000111",
                    "id_type": "national_id", "national_id": "12345678",
                    "country_of_residence": "Kenya",
                },
                "father": {
                    "first_name": "John", "last_name": "Kamau",
                    "phone": "0722000222", "email": "john@x.co.ke",
                },
                "guardian": {"first_name": "", "last_name": "", "phone": ""},
            }},
        )
        assert r.status_code in (200, 201), r.text
        eid = r.json()["id"]
        links = db_session.execute(text(
            "SELECT p.first_name, p.middle_name, p.country_of_residence, "
            "       pel.relationship, pel.is_primary "
            "FROM core.parent_enrollment_links pel "
            "JOIN core.parents p ON p.id = pel.parent_id "
            "WHERE pel.enrollment_id = :eid ORDER BY pel.relationship"
        ), {"eid": eid}).mappings().all()
        rels = {l["relationship"] for l in links}
        assert rels == {"MOTHER", "FATHER"}   # blank guardian section skipped
        mother = next(l for l in links if l["relationship"] == "MOTHER")
        assert mother["middle_name"] == "Wanjiru"
        assert mother["country_of_residence"] == "Kenya"
        assert mother["is_primary"] is True

    def test_kemis_sheet_pdf_exports(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DQ_PERMS)
        eid, _ = _seed_enrollment(db_session, tenant_id=tenant.id)
        r = client.get(
            f"/api/v1/tenants/students/{eid}/kemis-sheet.pdf",
            headers=headers,
        )
        assert r.status_code == 200, r.text
        assert r.content.startswith(b"%PDF-")
        assert len(r.content) > 2_000
