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
            "upi": "UPI-12345",
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
