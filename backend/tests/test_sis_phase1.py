"""
Tests for Phase 1 — Student Information System endpoints.

Endpoints exercised:
  GET    /api/v1/students/{id}                           — full profile
  PATCH  /api/v1/students/{id}/biodata                   — update bio-data
  GET    /api/v1/students/{id}/guardian                  — list guardians
  PATCH  /api/v1/students/{id}/guardian/{parent_id}      — update guardian
  GET    /api/v1/students/{id}/emergency-contacts        — list
  POST   /api/v1/students/{id}/emergency-contacts        — create
  PATCH  /api/v1/students/{id}/emergency-contacts/{cid} — update
  DELETE /api/v1/students/{id}/emergency-contacts/{cid} — delete
  GET    /api/v1/students/{id}/documents                 — list
  POST   /api/v1/students/{id}/documents                 — upload
  DELETE /api/v1/students/{id}/documents/{did}           — delete
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/students"

# Permission bundles matching the access matrix
BIODATA_READ   = ["students.biodata.read"]
BIODATA_MANAGE = ["students.biodata.read", "students.biodata.update"]
EC_READ        = ["students.biodata.read", "students.emergency_contacts.read"]
EC_MANAGE      = [
    "students.biodata.read",
    "students.emergency_contacts.read",
    "students.emergency_contacts.manage",
]
DOC_READ   = ["students.biodata.read", "students.documents.read"]
DOC_MANAGE = [
    "students.biodata.read",
    "students.documents.read",
    "students.documents.manage",
]
ALL_PERMS = list(dict.fromkeys(BIODATA_MANAGE + EC_MANAGE + DOC_MANAGE))


# ── Fixtures / helpers ──────────────────────────────────────────────────────

def _seed_student(db: Session, *, tenant_id, admission_no: str = "ADM-001") -> str:
    """Insert a minimal student row directly and return its UUID string."""
    sid = str(uuid4())
    db.execute(
        __import__("sqlalchemy").text(
            "INSERT INTO core.students "
            "(id, tenant_id, admission_no, first_name, last_name, status) "
            "VALUES (:id, :tid, :adm, :fn, :ln, 'ACTIVE')"
        ),
        {"id": sid, "tid": str(tenant_id), "adm": admission_no,
         "fn": "Alice", "ln": "Wanjiru"},
    )
    db.commit()
    return sid


def _seed_parent(db: Session, *, tenant_id, student_id: str,
                 relationship: str = "GUARDIAN") -> str:
    """Insert a parent + parent_students link, return parent UUID."""
    pid = str(uuid4())
    db.execute(
        __import__("sqlalchemy").text(
            "INSERT INTO core.parents (id, tenant_id, first_name, last_name, phone) "
            "VALUES (:id, :tid, 'Jane', 'Wanjiru', '0700000001')"
        ),
        {"id": pid, "tid": str(tenant_id)},
    )
    db.execute(
        __import__("sqlalchemy").text(
            "INSERT INTO core.parent_students (tenant_id, parent_id, student_id, relationship) "
            "VALUES (:tid, :pid, :sid, :rel)"
        ),
        {"tid": str(tenant_id), "pid": pid, "sid": student_id, "rel": relationship},
    )
    db.commit()
    return pid


def _seed_emergency_contact(db: Session, *, tenant_id, student_id: str) -> str:
    """Insert an emergency contact, return its UUID."""
    cid = str(uuid4())
    db.execute(
        __import__("sqlalchemy").text(
            "INSERT INTO core.student_emergency_contacts "
            "(id, tenant_id, student_id, name, phone, is_primary) "
            "VALUES (:id, :tid, :sid, 'Uncle Bob', '0722000001', false)"
        ),
        {"id": cid, "tid": str(tenant_id), "sid": student_id},
    )
    db.commit()
    return cid


def _seed_document(db: Session, *, tenant_id, student_id: str) -> str:
    """Insert a document record, return its UUID."""
    did = str(uuid4())
    db.execute(
        __import__("sqlalchemy").text(
            "INSERT INTO core.student_documents "
            "(id, tenant_id, student_id, document_type, file_url) "
            "VALUES (:id, :tid, :sid, 'BIRTH_CERTIFICATE', 'https://cdn.example.com/bc.pdf')"
        ),
        {"id": did, "tid": str(tenant_id), "sid": student_id},
    )
    db.commit()
    return did


# ── GET /{id} ───────────────────────────────────────────────────────────────

class TestGetStudent:
    def test_returns_full_profile(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_READ)

        resp = client.get(f"{BASE}/{sid}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == sid
        assert data["first_name"] == "Alice"
        assert data["last_name"] == "Wanjiru"
        assert data["admission_no"] == "ADM-001"
        assert data["status"] == "ACTIVE"
        assert data["tenant_id"] == str(tenant.id)

    def test_wrong_tenant_returns_404(self, client: TestClient, db_session: Session):
        tenant_a = create_tenant(db_session, slug="school-a")
        tenant_b = create_tenant(db_session, slug="school-b")
        sid = _seed_student(db_session, tenant_id=tenant_a.id)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=BIODATA_READ)

        resp = client.get(f"{BASE}/{sid}", headers=headers_b)
        assert resp.status_code == 404

    def test_unknown_student_returns_404(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_READ)
        resp = client.get(f"{BASE}/{uuid4()}", headers=headers)
        assert resp.status_code == 404

    def test_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        resp = client.get(f"{BASE}/{sid}", headers={"X-Tenant-ID": str(tenant.id)})
        assert resp.status_code == 401

    def test_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get(f"{BASE}/{sid}", headers=headers)
        assert resp.status_code == 403


# ── PATCH /{id}/biodata ─────────────────────────────────────────────────────

class TestUpdateBiodata:
    def test_update_phone_and_email(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)

        resp = client.patch(
            f"{BASE}/{sid}/biodata",
            json={"phone": "0712345678", "email": "alice@school.ke"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["phone"] == "0712345678"
        assert data["email"] == "alice@school.ke"

    def test_update_all_extended_fields(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)

        payload = {
            "nationality": "Kenyan",
            "religion": "Christian",
            "home_address": "123 Nairobi St",
            "county": "Nairobi",
            "sub_county": "Westlands",
            "uli": "ULI-12345",
            "birth_certificate_no": "BC-99999",
            "previous_school": "Sunshine Primary",
            "previous_class": "Grade 6",
        }
        resp = client.patch(f"{BASE}/{sid}/biodata", json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        for key, val in payload.items():
            assert data[key] == val, f"Field {key} mismatch: {data[key]} != {val}"

    def test_empty_patch_returns_400(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)
        resp = client.patch(f"{BASE}/{sid}/biodata", json={}, headers=headers)
        assert resp.status_code == 400

    def test_wrong_tenant_returns_404(self, client: TestClient, db_session: Session):
        tenant_a = create_tenant(db_session, slug="school-a2")
        tenant_b = create_tenant(db_session, slug="school-b2")
        sid = _seed_student(db_session, tenant_id=tenant_a.id)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=BIODATA_MANAGE)
        resp = client.patch(f"{BASE}/{sid}/biodata", json={"phone": "0700"}, headers=headers_b)
        assert resp.status_code == 404

    def test_requires_update_permission(self, client: TestClient, db_session: Session):
        """students.biodata.read alone is not enough to update."""
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_READ)
        resp = client.patch(f"{BASE}/{sid}/biodata", json={"phone": "0700"}, headers=headers)
        assert resp.status_code == 403


# ── Admission-number rename propagation ─────────────────────────────────────
#
# Renaming admission_no on the SIS student must sync to every enrollment row
# for that student (column + JSONB payload), or the student profile header,
# parents module, and finance views silently render the stale old number.

def _seed_enrollment(
    db: Session,
    *,
    tenant_id,
    student_id: str,
    admission_number: str,
    extra_payload: dict | None = None,
) -> str:
    """Insert an enrollment linked to a student. Returns enrollment UUID."""
    from sqlalchemy import text
    import json as _json
    eid = str(uuid4())
    payload = {"admission_number": admission_number, **(extra_payload or {})}
    db.execute(
        text(
            "INSERT INTO core.enrollments "
            "(id, tenant_id, student_id, admission_number, status, payload) "
            "VALUES (:id, :tid, :sid, :adm, 'ENROLLED', CAST(:payload AS jsonb))"
        ),
        {
            "id": eid,
            "tid": str(tenant_id),
            "sid": student_id,
            "adm": admission_number,
            "payload": _json.dumps(payload),
        },
    )
    db.commit()
    return eid


class TestAdmissionNumberRename:
    def test_rename_propagates_to_single_enrollment(self, client: TestClient, db_session: Session):
        """Renaming admission_no updates both the column AND the payload on the
        student's enrollment row."""
        from sqlalchemy import text
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-001")
        eid = _seed_enrollment(
            db_session, tenant_id=tenant.id, student_id=sid, admission_number="ADM-001"
        )
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)

        resp = client.patch(
            f"{BASE}/{sid}/biodata",
            json={"admission_no": "ADM-002"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["admission_no"] == "ADM-002"

        row = db_session.execute(
            text(
                "SELECT admission_number, payload->>'admission_number' AS pay_adm "
                "FROM core.enrollments WHERE id = :id"
            ),
            {"id": eid},
        ).mappings().first()
        assert row["admission_number"] == "ADM-002"
        assert row["pay_adm"] == "ADM-002"

    def test_rename_propagates_to_matching_enrollments_only(
        self, client: TestClient, db_session: Session
    ):
        """A student with multiple enrollments (e.g. re-admission) has each
        admission_number kept distinct by the partial unique index. Renaming
        the SIS admission_no propagates to enrollments carrying the OLD value
        (or NULL), and leaves re-admission rows with a different number
        untouched — their numbers are historical and stay distinct."""
        from sqlalchemy import text
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-001")
        # Enrollment matching the current SIS number — must be renamed.
        eid_current = _seed_enrollment(
            db_session, tenant_id=tenant.id, student_id=sid, admission_number="ADM-001",
            extra_payload={"academic_year": 2026},
        )
        # Old re-admission enrollment with its own distinct number — must NOT
        # be touched (historical).
        eid_old = _seed_enrollment(
            db_session, tenant_id=tenant.id, student_id=sid, admission_number="ADM-OLD-2024",
            extra_payload={"academic_year": 2024},
        )
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)

        resp = client.patch(
            f"{BASE}/{sid}/biodata",
            json={"admission_no": "ADM-NEW"},
            headers=headers,
        )
        assert resp.status_code == 200

        rows = db_session.execute(
            text(
                "SELECT id, admission_number, payload->>'admission_number' AS pay_adm "
                "FROM core.enrollments WHERE id = ANY(:ids)"
            ),
            {"ids": [eid_current, eid_old]},
        ).mappings().all()
        by_id = {str(r["id"]): r for r in rows}
        assert by_id[eid_current]["admission_number"] == "ADM-NEW"
        assert by_id[eid_current]["pay_adm"] == "ADM-NEW"
        # Historical re-admission row is untouched.
        assert by_id[eid_old]["admission_number"] == "ADM-OLD-2024"
        assert by_id[eid_old]["pay_adm"] == "ADM-OLD-2024"

    def test_rename_fills_in_enrollment_with_missing_admission(
        self, client: TestClient, db_session: Session
    ):
        """An enrollment that was missing admission_number (NULL) gets filled
        in on rename — covers historical rows from before the column existed."""
        from sqlalchemy import text
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-001")
        # Seed an enrollment with admission_number = NULL.
        eid = _seed_enrollment(
            db_session, tenant_id=tenant.id, student_id=sid, admission_number="ADM-001"
        )
        db_session.execute(
            text("UPDATE core.enrollments SET admission_number = NULL WHERE id = :id"),
            {"id": eid},
        )
        db_session.commit()

        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)
        resp = client.patch(
            f"{BASE}/{sid}/biodata",
            json={"admission_no": "ADM-NEW"},
            headers=headers,
        )
        assert resp.status_code == 200

        row = db_session.execute(
            text(
                "SELECT admission_number, payload->>'admission_number' AS pay_adm "
                "FROM core.enrollments WHERE id = :id"
            ),
            {"id": eid},
        ).mappings().first()
        assert row["admission_number"] == "ADM-NEW"
        assert row["pay_adm"] == "ADM-NEW"

    def test_rename_to_other_student_admission_returns_409(
        self, client: TestClient, db_session: Session
    ):
        """Trying to set admission_no to a value another SIS student already
        owns must 409 — and leave both rows untouched."""
        from sqlalchemy import text
        tenant = create_tenant(db_session)
        sid_a = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-001")
        sid_b = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-002")
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)

        resp = client.patch(
            f"{BASE}/{sid_a}/biodata",
            json={"admission_no": "ADM-002"},
            headers=headers,
        )
        assert resp.status_code == 409
        assert "ADM-002" in resp.json()["detail"]

        # Neither student's admission_no should have changed.
        rows = db_session.execute(
            text("SELECT id, admission_no FROM core.students WHERE id = ANY(:ids)"),
            {"ids": [sid_a, sid_b]},
        ).mappings().all()
        by_id = {str(r["id"]): r["admission_no"] for r in rows}
        assert by_id[sid_a] == "ADM-001"
        assert by_id[sid_b] == "ADM-002"

    def test_rename_to_other_enrollment_admission_returns_409(
        self, client: TestClient, db_session: Session
    ):
        """A second student whose enrollment has admission_number=X must block a
        rename TO X even if no other SIS row uses it — keeps the partial unique
        index from throwing a raw DB error."""
        from sqlalchemy import text
        tenant = create_tenant(db_session)
        sid_a = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-100")
        sid_b = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-200")
        # Other student has an enrollment using "ADM-999" (not on their SIS row).
        _seed_enrollment(
            db_session, tenant_id=tenant.id, student_id=sid_b, admission_number="ADM-999"
        )
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)

        resp = client.patch(
            f"{BASE}/{sid_a}/biodata",
            json={"admission_no": "ADM-999"},
            headers=headers,
        )
        assert resp.status_code == 409
        assert "ADM-999" in resp.json()["detail"]

        # Student A unchanged.
        row_a = db_session.execute(
            text("SELECT admission_no FROM core.students WHERE id = :id"),
            {"id": sid_a},
        ).mappings().first()
        assert row_a["admission_no"] == "ADM-100"

    def test_rename_emits_audit_event(self, client: TestClient, db_session: Session):
        """An admission_no rename emits a student.admission_no.update audit
        event capturing before/after and the enrollment ids touched."""
        from sqlalchemy import select, text
        from app.models.audit_log import AuditLog
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-001")
        eid = _seed_enrollment(
            db_session, tenant_id=tenant.id, student_id=sid, admission_number="ADM-001"
        )
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)

        resp = client.patch(
            f"{BASE}/{sid}/biodata",
            json={"admission_no": "ADM-RENAMED"},
            headers=headers,
        )
        assert resp.status_code == 200

        audit_row = db_session.execute(
            select(AuditLog)
            .where(
                AuditLog.tenant_id == tenant.id,
                AuditLog.action == "student.admission_no.update",
            )
            .order_by(AuditLog.created_at.desc())
        ).scalars().first()
        assert audit_row is not None
        payload = audit_row.payload or {}
        assert payload.get("before") == "ADM-001"
        assert payload.get("after") == "ADM-RENAMED"
        assert payload.get("enrollment_count") == 1
        assert eid in (payload.get("enrollment_ids") or [])

    def test_rename_to_same_value_is_noop(self, client: TestClient, db_session: Session):
        """Setting admission_no to its existing value is not treated as a
        rename — no audit event, no needless enrollment write."""
        from sqlalchemy import select
        from app.models.audit_log import AuditLog
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-001")
        _seed_enrollment(
            db_session, tenant_id=tenant.id, student_id=sid, admission_number="ADM-001"
        )
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)

        resp = client.patch(
            f"{BASE}/{sid}/biodata",
            json={"admission_no": "ADM-001"},
            headers=headers,
        )
        assert resp.status_code == 200

        audit_count = db_session.execute(
            select(AuditLog).where(
                AuditLog.tenant_id == tenant.id,
                AuditLog.action == "student.admission_no.update",
            )
        ).all()
        assert len(audit_count) == 0

    def test_non_admission_update_does_not_emit_rename_audit(
        self, client: TestClient, db_session: Session
    ):
        """Updating other biodata fields must not trigger the rename audit
        event or touch enrollment rows."""
        from sqlalchemy import select, text
        from app.models.audit_log import AuditLog
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-001")
        eid = _seed_enrollment(
            db_session, tenant_id=tenant.id, student_id=sid, admission_number="ADM-001"
        )
        # Capture the enrollment's updated_at BEFORE the biodata patch.
        before_ts = db_session.execute(
            text("SELECT updated_at FROM core.enrollments WHERE id = :id"),
            {"id": eid},
        ).scalar_one()

        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)
        resp = client.patch(
            f"{BASE}/{sid}/biodata",
            json={"phone": "0712345678"},
            headers=headers,
        )
        assert resp.status_code == 200

        # No rename audit event.
        rename_events = db_session.execute(
            select(AuditLog).where(
                AuditLog.tenant_id == tenant.id,
                AuditLog.action == "student.admission_no.update",
            )
        ).all()
        assert len(rename_events) == 0

        # Enrollment row was NOT touched.
        after_ts = db_session.execute(
            text("SELECT updated_at FROM core.enrollments WHERE id = :id"),
            {"id": eid},
        ).scalar_one()
        assert after_ts == before_ts

    def test_rename_is_tenant_scoped(self, client: TestClient, db_session: Session):
        """A rename in tenant A must not affect tenant B's enrollments even if
        they share the same admission_no."""
        from sqlalchemy import text
        tenant_a = create_tenant(db_session, slug="adm-rename-a")
        tenant_b = create_tenant(db_session, slug="adm-rename-b")
        sid_a = _seed_student(db_session, tenant_id=tenant_a.id, admission_no="ADM-SAME")
        sid_b = _seed_student(db_session, tenant_id=tenant_b.id, admission_no="ADM-SAME")
        eid_b = _seed_enrollment(
            db_session, tenant_id=tenant_b.id, student_id=sid_b, admission_number="ADM-SAME"
        )
        _, headers_a = make_actor(db_session, tenant=tenant_a, permissions=BIODATA_MANAGE)

        resp = client.patch(
            f"{BASE}/{sid_a}/biodata",
            json={"admission_no": "ADM-A-RENAMED"},
            headers=headers_a,
        )
        assert resp.status_code == 200

        # Tenant B's enrollment is unchanged.
        row_b = db_session.execute(
            text(
                "SELECT admission_number FROM core.enrollments WHERE id = :id"
            ),
            {"id": eid_b},
        ).mappings().first()
        assert row_b["admission_number"] == "ADM-SAME"


# ── GET /{id}/guardian ──────────────────────────────────────────────────────

class TestListGuardians:
    def test_empty_list_when_no_guardians(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_READ)
        resp = client.get(f"{BASE}/{sid}/guardian", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_linked_guardian(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        pid = _seed_parent(db_session, tenant_id=tenant.id, student_id=sid)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_READ)

        resp = client.get(f"{BASE}/{sid}/guardian", headers=headers)
        assert resp.status_code == 200
        guardians = resp.json()
        assert len(guardians) == 1
        assert guardians[0]["id"] == pid
        assert guardians[0]["first_name"] == "Jane"
        assert guardians[0]["relationship"] == "GUARDIAN"

    def test_cross_tenant_isolation(self, client: TestClient, db_session: Session):
        """Guardian from tenant A is not visible to tenant B's actor."""
        tenant_a = create_tenant(db_session, slug="school-a3")
        tenant_b = create_tenant(db_session, slug="school-b3")
        sid = _seed_student(db_session, tenant_id=tenant_a.id)
        _seed_parent(db_session, tenant_id=tenant_a.id, student_id=sid)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=BIODATA_READ)
        # student belongs to tenant_a → 404 for tenant_b actor
        resp = client.get(f"{BASE}/{sid}/guardian", headers=headers_b)
        assert resp.status_code == 404


# ── PATCH /{id}/guardian/{parent_id} ───────────────────────────────────────

class TestUpdateGuardian:
    def test_update_phone(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        pid = _seed_parent(db_session, tenant_id=tenant.id, student_id=sid)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)

        resp = client.patch(
            f"{BASE}/{sid}/guardian/{pid}",
            json={"phone": "0799999999", "occupation": "Farmer"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["phone"] == "0799999999"
        assert data["occupation"] == "Farmer"

    def test_unknown_guardian_returns_404(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)
        resp = client.patch(
            f"{BASE}/{sid}/guardian/{uuid4()}",
            json={"phone": "0700"},
            headers=headers,
        )
        assert resp.status_code == 404

    def test_empty_patch_returns_400(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        pid = _seed_parent(db_session, tenant_id=tenant.id, student_id=sid)
        _, headers = make_actor(db_session, tenant=tenant, permissions=BIODATA_MANAGE)
        resp = client.patch(f"{BASE}/{sid}/guardian/{pid}", json={}, headers=headers)
        assert resp.status_code == 400


# ── Emergency contacts ──────────────────────────────────────────────────────

class TestEmergencyContacts:
    def test_list_empty(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=EC_READ)
        resp = client.get(f"{BASE}/{sid}/emergency-contacts", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_create_contact(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=EC_MANAGE)

        resp = client.post(
            f"{BASE}/{sid}/emergency-contacts",
            json={
                "name": "Aunt Susan",
                "relationship": "AUNT",
                "phone": "0711111111",
                "is_primary": True,
            },
            headers=headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Aunt Susan"
        assert data["relationship"] == "AUNT"
        assert data["phone"] == "0711111111"
        assert data["is_primary"] is True
        assert data["student_id"] == sid
        assert "id" in data

    def test_create_then_list(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=EC_MANAGE)

        client.post(
            f"{BASE}/{sid}/emergency-contacts",
            json={"name": "Grandma Rose", "phone": "0733333333"},
            headers=headers,
        )
        resp = client.get(f"{BASE}/{sid}/emergency-contacts", headers=headers)
        assert resp.status_code == 200
        contacts = resp.json()
        assert len(contacts) == 1
        assert contacts[0]["name"] == "Grandma Rose"

    def test_create_requires_name_and_phone(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=EC_MANAGE)
        resp = client.post(
            f"{BASE}/{sid}/emergency-contacts",
            json={"relationship": "UNCLE"},  # missing name and phone
            headers=headers,
        )
        assert resp.status_code == 422

    def test_update_contact(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_emergency_contact(db_session, tenant_id=tenant.id, student_id=sid)
        _, headers = make_actor(db_session, tenant=tenant, permissions=EC_MANAGE)

        resp = client.patch(
            f"{BASE}/{sid}/emergency-contacts/{cid}",
            json={"phone": "0755555555", "notes": "Available after 5pm"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["phone"] == "0755555555"
        assert data["notes"] == "Available after 5pm"

    def test_update_unknown_contact_returns_404(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=EC_MANAGE)
        resp = client.patch(
            f"{BASE}/{sid}/emergency-contacts/{uuid4()}",
            json={"phone": "0700000000"},
            headers=headers,
        )
        assert resp.status_code == 404

    def test_delete_contact(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        cid = _seed_emergency_contact(db_session, tenant_id=tenant.id, student_id=sid)
        _, headers = make_actor(db_session, tenant=tenant, permissions=EC_MANAGE)

        resp = client.delete(f"{BASE}/{sid}/emergency-contacts/{cid}", headers=headers)
        assert resp.status_code == 204

        # Confirm it's gone
        list_resp = client.get(f"{BASE}/{sid}/emergency-contacts", headers=headers)
        assert list_resp.json() == []

    def test_delete_unknown_contact_returns_404(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=EC_MANAGE)
        resp = client.delete(f"{BASE}/{sid}/emergency-contacts/{uuid4()}", headers=headers)
        assert resp.status_code == 404

    def test_read_only_cannot_create(self, client: TestClient, db_session: Session):
        """emergency_contacts.read alone cannot create."""
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=EC_READ)
        resp = client.post(
            f"{BASE}/{sid}/emergency-contacts",
            json={"name": "X", "phone": "0700000000"},
            headers=headers,
        )
        assert resp.status_code == 403

    def test_cross_tenant_isolation(self, client: TestClient, db_session: Session):
        """tenant B actor cannot read tenant A student's emergency contacts."""
        tenant_a = create_tenant(db_session, slug="school-a4")
        tenant_b = create_tenant(db_session, slug="school-b4")
        sid = _seed_student(db_session, tenant_id=tenant_a.id)
        _seed_emergency_contact(db_session, tenant_id=tenant_a.id, student_id=sid)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=EC_READ)
        resp = client.get(f"{BASE}/{sid}/emergency-contacts", headers=headers_b)
        assert resp.status_code == 404


# ── Documents ───────────────────────────────────────────────────────────────

class TestDocuments:
    def test_list_empty(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DOC_READ)
        resp = client.get(f"{BASE}/{sid}/documents", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_upload_document(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DOC_MANAGE)

        resp = client.post(
            f"{BASE}/{sid}/documents",
            json={
                "document_type": "BIRTH_CERTIFICATE",
                "title": "Alice Birth Certificate",
                "file_url": "https://cdn.example.com/bc123.pdf",
                "content_type": "application/pdf",
                "size_bytes": 204800,
            },
            headers=headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["document_type"] == "BIRTH_CERTIFICATE"
        assert data["title"] == "Alice Birth Certificate"
        assert data["file_url"] == "https://cdn.example.com/bc123.pdf"
        assert data["size_bytes"] == 204800
        assert data["student_id"] == sid
        assert "id" in data

    def test_list_after_upload(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DOC_MANAGE)

        client.post(
            f"{BASE}/{sid}/documents",
            json={"document_type": "TRANSFER_LETTER", "file_url": "https://cdn.example.com/tl.pdf"},
            headers=headers,
        )
        resp = client.get(f"{BASE}/{sid}/documents", headers=headers)
        assert resp.status_code == 200
        docs = resp.json()
        assert len(docs) == 1
        assert docs[0]["document_type"] == "TRANSFER_LETTER"

    def test_invalid_document_type_rejected(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DOC_MANAGE)

        resp = client.post(
            f"{BASE}/{sid}/documents",
            json={"document_type": "INVALID_TYPE", "file_url": "https://cdn.example.com/x.pdf"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "document_type" in resp.json()["detail"].lower() or "invalid" in resp.json()["detail"].lower()

    def test_valid_document_types(self, client: TestClient, db_session: Session):
        """All 6 valid document types should be accepted."""
        valid_types = [
            "BIRTH_CERTIFICATE", "TRANSFER_LETTER", "NEMIS_REPORT",
            "ID_COPY", "MEDICAL_CERT", "OTHER",
        ]
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DOC_MANAGE)

        for doc_type in valid_types:
            resp = client.post(
                f"{BASE}/{sid}/documents",
                json={"document_type": doc_type, "file_url": f"https://cdn.example.com/{doc_type}.pdf"},
                headers=headers,
            )
            assert resp.status_code == 201, f"Expected 201 for type {doc_type}, got {resp.status_code}: {resp.text}"

    def test_delete_document(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        did = _seed_document(db_session, tenant_id=tenant.id, student_id=sid)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DOC_MANAGE)

        resp = client.delete(f"{BASE}/{sid}/documents/{did}", headers=headers)
        assert resp.status_code == 204

        list_resp = client.get(f"{BASE}/{sid}/documents", headers=headers)
        assert list_resp.json() == []

    def test_delete_unknown_document_returns_404(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DOC_MANAGE)
        resp = client.delete(f"{BASE}/{sid}/documents/{uuid4()}", headers=headers)
        assert resp.status_code == 404

    def test_read_only_cannot_upload(self, client: TestClient, db_session: Session):
        """documents.read alone cannot upload."""
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DOC_READ)
        resp = client.post(
            f"{BASE}/{sid}/documents",
            json={"document_type": "OTHER", "file_url": "https://cdn.example.com/x.pdf"},
            headers=headers,
        )
        assert resp.status_code == 403

    def test_document_type_case_normalised(self, client: TestClient, db_session: Session):
        """Lowercase document_type should be normalised to uppercase."""
        tenant = create_tenant(db_session)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DOC_MANAGE)

        resp = client.post(
            f"{BASE}/{sid}/documents",
            json={"document_type": "other", "file_url": "https://cdn.example.com/x.pdf"},
            headers=headers,
        )
        assert resp.status_code == 201
        assert resp.json()["document_type"] == "OTHER"

    def test_cross_tenant_isolation(self, client: TestClient, db_session: Session):
        """Tenant B actor cannot access tenant A student's documents."""
        tenant_a = create_tenant(db_session, slug="school-a5")
        tenant_b = create_tenant(db_session, slug="school-b5")
        sid = _seed_student(db_session, tenant_id=tenant_a.id)
        _seed_document(db_session, tenant_id=tenant_a.id, student_id=sid)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=DOC_READ)
        resp = client.get(f"{BASE}/{sid}/documents", headers=headers_b)
        assert resp.status_code == 404
