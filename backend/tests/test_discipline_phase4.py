"""
Tests for Phase 4 — Discipline module and student hard-delete.

Endpoints exercised:
  POST   /api/v1/discipline/incidents              — create incident
  GET    /api/v1/discipline/incidents              — list incidents
  GET    /api/v1/discipline/incidents/{id}         — incident detail
  PATCH  /api/v1/discipline/incidents/{id}         — update incident
  POST   /api/v1/discipline/incidents/{id}/students       — add student
  PATCH  /api/v1/discipline/incidents/{id}/students/{lid} — update student link
  DELETE /api/v1/discipline/incidents/{id}/students/{lid} — remove student
  POST   /api/v1/discipline/incidents/{id}/followups      — add follow-up
  GET    /api/v1/students/{id}/discipline                 — student history
  DELETE /api/v1/students/{id}                            — hard delete
"""
from __future__ import annotations

import sqlalchemy as sa
import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/discipline"
STUDENTS_BASE = "/api/v1/students"

VIEW   = ["discipline.incidents.view"]
MANAGE = ["discipline.incidents.manage", "discipline.incidents.view"]
RESOLVE = [
    "discipline.incidents.resolve",
    "discipline.incidents.manage",
    "discipline.incidents.view",
]
HARD_DELETE = ["students.hard_delete"]


# ── Seed helpers ──────────────────────────────────────────────────────────────

def _seed_student(db: Session, *, tenant_id, admission_no: str = "ADM-D001") -> str:
    sid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.students "
            "(id, tenant_id, admission_no, first_name, last_name, status) "
            "VALUES (:id, :tid, :adm, 'Brenda', 'Otieno', 'ACTIVE')"
        ),
        {"id": sid, "tid": str(tenant_id), "adm": admission_no},
    )
    db.commit()
    return sid


def _seed_class(db: Session, *, tenant_id) -> str:
    cid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.tenant_classes (id, tenant_id, code, name, is_active) "
            "VALUES (:id, :tid, 'F4A', 'Form 4A', true)"
        ),
        {"id": cid, "tid": str(tenant_id)},
    )
    db.commit()
    return cid


def _seed_term(db: Session, *, tenant_id) -> str:
    tid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.tenant_terms (id, tenant_id, code, name, is_active) "
            "VALUES (:id, :tid, '2026-T1', 'Term 1 2026', true)"
        ),
        {"id": tid, "tid": str(tenant_id)},
    )
    db.commit()
    return tid


def _seed_enrollment(db: Session, *, tenant_id, student_id, class_id, term_id) -> str:
    eid = str(uuid4())
    db.execute(
        sa.text(
            "INSERT INTO core.student_class_enrollments "
            "(id, tenant_id, student_id, class_id, term_id) "
            "VALUES (:id, :tid, :sid, :cid, :termid)"
        ),
        {"id": eid, "tid": str(tenant_id), "sid": student_id, "cid": class_id, "termid": term_id},
    )
    db.commit()
    return eid


# ── Tests: RBAC guards ────────────────────────────────────────────────────────

class TestDisciplineRbac:
    def test_unauthenticated_list_rejected(self, client: TestClient):
        resp = client.get(f"{BASE}/incidents")
        assert resp.status_code in (400, 401, 403)

    def test_no_permission_rejected(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get(f"{BASE}/incidents", headers=headers)
        assert resp.status_code == 403

    def test_view_only_cannot_create(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        resp = client.post(
            f"{BASE}/incidents",
            json={
                "incident_date": "2026-04-01",
                "incident_type": "BULLYING",
                "title": "Playground fight",
            },
            headers=headers,
        )
        assert resp.status_code == 403


# ── Tests: Incident CRUD ──────────────────────────────────────────────────────

class TestIncidentCrud:
    def test_create_and_list(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)

        # Create
        resp = client.post(
            f"{BASE}/incidents",
            json={
                "incident_date": "2026-04-01",
                "incident_type": "BULLYING",
                "severity": "MEDIUM",
                "title": "Playground bullying",
                "description": "Student bullied peer behind the library.",
                "location": "Playground",
            },
            headers=headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["ok"] is True
        incident = data["incident"]
        assert incident["status"] == "OPEN"
        assert incident["incident_type"] == "BULLYING"
        assert incident["severity"] == "MEDIUM"
        inc_id = incident["id"]

        # List
        resp = client.get(f"{BASE}/incidents", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["title"] == "Playground bullying"
        assert body["items"][0]["student_count"] == 0

    def test_get_detail(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)

        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-02", "incident_type": "TRUANCY", "title": "Absent 3 days"},
            headers=headers,
        )
        assert resp.status_code == 201
        inc_id = resp.json()["incident"]["id"]

        resp = client.get(f"{BASE}/incidents/{inc_id}", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["incident"]["id"] == inc_id
        assert body["incident"]["students"] == []
        assert body["incident"]["followups"] == []

    def test_update_incident(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)

        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-03", "incident_type": "MISCONDUCT", "title": "Talking in class"},
            headers=headers,
        )
        inc_id = resp.json()["incident"]["id"]

        resp = client.patch(
            f"{BASE}/incidents/{inc_id}",
            json={"severity": "HIGH", "location": "Classroom 5B"},
            headers=headers,
        )
        assert resp.status_code == 200
        incident = resp.json()["incident"]
        assert incident["severity"] == "HIGH"
        assert incident["location"] == "Classroom 5B"

    def test_invalid_incident_type_rejected(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-01", "incident_type": "INVALID_TYPE", "title": "Test"},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_invalid_severity_rejected(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-01", "incident_type": "FIGHTING", "severity": "EXTREME", "title": "Test"},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_resolve_incident(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=RESOLVE)

        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-04", "incident_type": "THEFT", "title": "Missing bag"},
            headers=headers,
        )
        inc_id = resp.json()["incident"]["id"]

        resp = client.patch(
            f"{BASE}/incidents/{inc_id}",
            json={"status": "RESOLVED", "resolution_notes": "Bag found in lost property."},
            headers=headers,
        )
        assert resp.status_code == 200
        incident = resp.json()["incident"]
        assert incident["status"] == "RESOLVED"
        assert incident["resolution_notes"] == "Bag found in lost property."
        assert incident["resolved_at"] is not None

    def test_list_filter_by_status(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=RESOLVE)

        for title, status in [("Open one", None), ("Resolved one", "RESOLVED")]:
            resp = client.post(
                f"{BASE}/incidents",
                json={"incident_date": "2026-04-05", "incident_type": "OTHER", "title": title},
                headers=headers,
            )
            inc_id = resp.json()["incident"]["id"]
            if status:
                client.patch(f"{BASE}/incidents/{inc_id}", json={"status": status}, headers=headers)

        resp = client.get(f"{BASE}/incidents?status=OPEN", headers=headers)
        assert resp.json()["total"] == 1
        assert resp.json()["items"][0]["title"] == "Open one"

        resp = client.get(f"{BASE}/incidents?status=RESOLVED", headers=headers)
        assert resp.json()["total"] == 1


# ── Tests: Student links ──────────────────────────────────────────────────────

class TestIncidentStudents:
    def test_add_and_update_student(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        sid = _seed_student(db_session, tenant_id=tenant.id)

        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-06", "incident_type": "FIGHTING", "title": "Fight"},
            headers=headers,
        )
        inc_id = resp.json()["incident"]["id"]

        # Add student
        resp = client.post(
            f"{BASE}/incidents/{inc_id}/students",
            json={"student_id": sid, "role": "PERPETRATOR", "action_taken": "WARNING"},
            headers=headers,
        )
        assert resp.status_code == 201
        incident = resp.json()["incident"]
        assert len(incident["students"]) == 1
        link_id = incident["students"][0]["id"]
        assert incident["students"][0]["action_taken"] == "WARNING"
        assert incident["students"][0]["student_name"] == "Brenda Otieno"

        # Update link
        resp = client.patch(
            f"{BASE}/incidents/{inc_id}/students/{link_id}",
            json={"action_taken": "SUSPENSION", "parent_notified": True},
            headers=headers,
        )
        assert resp.status_code == 200
        student_link = resp.json()["incident"]["students"][0]
        assert student_link["action_taken"] == "SUSPENSION"
        assert student_link["parent_notified"] is True
        assert student_link["parent_notified_at"] is not None

    def test_duplicate_student_rejected(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        sid = _seed_student(db_session, tenant_id=tenant.id)

        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-07", "incident_type": "MISCONDUCT", "title": "Dup test"},
            headers=headers,
        )
        inc_id = resp.json()["incident"]["id"]

        client.post(f"{BASE}/incidents/{inc_id}/students", json={"student_id": sid}, headers=headers)
        resp = client.post(f"{BASE}/incidents/{inc_id}/students", json={"student_id": sid}, headers=headers)
        assert resp.status_code == 409

    def test_remove_student(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        sid = _seed_student(db_session, tenant_id=tenant.id)

        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-08", "incident_type": "TRUANCY", "title": "Remove test"},
            headers=headers,
        )
        inc_id = resp.json()["incident"]["id"]
        resp = client.post(f"{BASE}/incidents/{inc_id}/students", json={"student_id": sid}, headers=headers)
        link_id = resp.json()["incident"]["students"][0]["id"]

        resp = client.delete(f"{BASE}/incidents/{inc_id}/students/{link_id}", headers=headers)
        assert resp.status_code == 204

        resp = client.get(f"{BASE}/incidents/{inc_id}", headers=headers)
        assert resp.json()["incident"]["students"] == []

    def test_invalid_action_rejected(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        sid = _seed_student(db_session, tenant_id=tenant.id)

        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-09", "incident_type": "OTHER", "title": "Action test"},
            headers=headers,
        )
        inc_id = resp.json()["incident"]["id"]

        resp = client.post(
            f"{BASE}/incidents/{inc_id}/students",
            json={"student_id": sid, "action_taken": "BEHEADING"},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_create_incident_with_students_inline(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        sid1 = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-D002")
        sid2 = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-D003")

        resp = client.post(
            f"{BASE}/incidents",
            json={
                "incident_date": "2026-04-10",
                "incident_type": "BULLYING",
                "title": "Library incident",
                "students": [
                    {"student_id": sid1, "role": "PERPETRATOR", "action_taken": "DETENTION"},
                    {"student_id": sid2, "role": "VICTIM"},
                ],
            },
            headers=headers,
        )
        assert resp.status_code == 201
        students = resp.json()["incident"]["students"]
        assert len(students) == 2
        roles = {s["student_id"]: s["role"] for s in students}
        assert roles[sid1] == "PERPETRATOR"
        assert roles[sid2] == "VICTIM"


# ── Tests: Follow-ups ─────────────────────────────────────────────────────────

class TestFollowups:
    def test_add_followup(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)

        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-11", "incident_type": "MISCONDUCT", "title": "Followup test"},
            headers=headers,
        )
        inc_id = resp.json()["incident"]["id"]

        resp = client.post(
            f"{BASE}/incidents/{inc_id}/followups",
            json={"followup_date": "2026-04-13", "notes": "Called parents. Meeting scheduled."},
            headers=headers,
        )
        assert resp.status_code == 201
        incident = resp.json()["incident"]
        assert len(incident["followups"]) == 1
        assert incident["followups"][0]["notes"] == "Called parents. Meeting scheduled."

    def test_empty_notes_rejected(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)

        resp = client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-11", "incident_type": "OTHER", "title": "Empty notes test"},
            headers=headers,
        )
        inc_id = resp.json()["incident"]["id"]

        resp = client.post(
            f"{BASE}/incidents/{inc_id}/followups",
            json={"followup_date": "2026-04-12", "notes": "   "},
            headers=headers,
        )
        assert resp.status_code == 422


# ── Tests: Student discipline history ─────────────────────────────────────────

class TestStudentHistory:
    def test_student_history(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)
        sid = _seed_student(db_session, tenant_id=tenant.id)

        # Create 2 incidents linking this student
        for title in ["Incident Alpha", "Incident Beta"]:
            resp = client.post(
                f"{BASE}/incidents",
                json={
                    "incident_date": "2026-04-12",
                    "incident_type": "MISCONDUCT",
                    "title": title,
                    "students": [{"student_id": sid, "role": "PERPETRATOR"}],
                },
                headers=headers,
            )
            assert resp.status_code == 201

        resp = client.get(f"{STUDENTS_BASE}/{sid}/discipline", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert len(body["incidents"]) == 2

    def test_student_history_empty(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=VIEW)
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-D010")

        resp = client.get(f"{STUDENTS_BASE}/{sid}/discipline", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["incidents"] == []

    def test_cross_tenant_isolation(self, client: TestClient, db_session: Session):
        tenant_a = create_tenant(db_session, slug="school-a")
        tenant_b = create_tenant(db_session, slug="school-b")
        _, headers_a = make_actor(db_session, tenant=tenant_a, permissions=MANAGE)
        _, headers_b = make_actor(db_session, tenant=tenant_b, permissions=VIEW)

        sid = _seed_student(db_session, tenant_id=tenant_a.id, admission_no="ADM-ISOL-01")

        # Create incident in tenant_a
        client.post(
            f"{BASE}/incidents",
            json={"incident_date": "2026-04-13", "incident_type": "OTHER", "title": "Tenant A",
                  "students": [{"student_id": sid}]},
            headers=headers_a,
        )

        # Tenant B cannot see tenant A's incidents
        resp = client.get(f"{BASE}/incidents", headers=headers_b)
        assert resp.json()["total"] == 0


# ── Tests: Student hard-delete ────────────────────────────────────────────────

class TestStudentHardDelete:
    def test_hard_delete_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=MANAGE)  # no hard_delete
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-DEL-01")

        resp = client.request(
            "DELETE",
            f"{STUDENTS_BASE}/{sid}",
            json={"confirm": "DELETE ADM-DEL-01"},
            headers=headers,
        )
        assert resp.status_code == 403

    def test_hard_delete_wrong_confirmation(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=HARD_DELETE)
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-DEL-02")

        resp = client.request(
            "DELETE",
            f"{STUDENTS_BASE}/{sid}",
            json={"confirm": "delete adm-del-02"},  # wrong case
            headers=headers,
        )
        assert resp.status_code == 422

    def test_hard_delete_nonexistent_student(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=HARD_DELETE)

        resp = client.request(
            "DELETE",
            f"{STUDENTS_BASE}/{uuid4()}",
            json={"confirm": "DELETE NONE"},
            headers=headers,
        )
        assert resp.status_code == 404

    def test_hard_delete_success(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=HARD_DELETE + MANAGE)
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-DEL-03")

        # Link to a discipline incident to verify cascade cleanup
        client.post(
            f"{BASE}/incidents",
            json={
                "incident_date": "2026-04-14",
                "incident_type": "MISCONDUCT",
                "title": "Pre-delete incident",
                "students": [{"student_id": sid}],
            },
            headers=headers,
        )

        resp = client.request(
            "DELETE",
            f"{STUDENTS_BASE}/{sid}",
            json={"confirm": "DELETE ADM-DEL-03"},
            headers=headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert body["admission_no"] == "ADM-DEL-03"
        assert body["deleted_student_name"] == "Brenda Otieno"
        assert body["records_removed"]["student"] == 1
        assert body["records_removed"]["discipline_links"] == 1

        # Student gone from DB
        row = db_session.execute(
            sa.text("SELECT id FROM core.students WHERE id = :sid"),
            {"sid": sid},
        ).fetchone()
        assert row is None

    def test_hard_delete_with_enrollment_and_finance(self, client: TestClient, db_session: Session):
        """Delete removes class enrollments, admission enrollments, invoices, payments chain."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=HARD_DELETE)
        sid = _seed_student(db_session, tenant_id=tenant.id, admission_no="ADM-DEL-04")
        cid = _seed_class(db_session, tenant_id=tenant.id)
        term_id = _seed_term(db_session, tenant_id=tenant.id)
        class_eid = _seed_enrollment(db_session, tenant_id=tenant.id,
                                     student_id=sid, class_id=cid, term_id=term_id)

        # Seed admission enrollment (core.enrollments — what invoices reference)
        adm_eid = str(uuid4())
        db_session.execute(
            sa.text(
                "INSERT INTO core.enrollments (id, tenant_id, student_id, status, payload) "
                "VALUES (:id, :tid, :sid, 'ENROLLED', '{}'::jsonb)"
            ),
            {"id": adm_eid, "tid": str(tenant.id), "sid": sid},
        )
        db_session.commit()

        # Seed invoice (references admission enrollment) + payment + allocation
        inv_id = str(uuid4())
        pay_id = str(uuid4())
        db_session.execute(
            sa.text(
                "INSERT INTO core.invoices (id, tenant_id, enrollment_id, invoice_no, "
                "invoice_type, status, currency, total_amount, paid_amount, balance_amount) "
                "VALUES (:id, :tid, :eid, 'INV-001', 'SCHOOL_FEES', 'UNPAID', 'KES', 10000, 0, 10000)"
            ),
            {"id": inv_id, "tid": str(tenant.id), "eid": adm_eid},
        )
        db_session.execute(
            sa.text(
                "INSERT INTO core.payments (id, tenant_id, amount, currency, provider, reference) "
                "VALUES (:id, :tid, 5000, 'KES', 'MPESA', 'TEST-REF-001')"
            ),
            {"id": pay_id, "tid": str(tenant.id)},
        )
        db_session.execute(
            sa.text(
                "INSERT INTO core.payment_allocations (id, payment_id, invoice_id, amount) "
                "VALUES (:id, :pid, :iid, 5000)"
            ),
            {"id": str(uuid4()), "pid": pay_id, "iid": inv_id},
        )
        db_session.commit()

        resp = client.request(
            "DELETE",
            f"{STUDENTS_BASE}/{sid}",
            json={"confirm": "DELETE ADM-DEL-04"},
            headers=headers,
        )
        assert resp.status_code == 200
        removed = resp.json()["records_removed"]
        assert removed["invoices"] == 1
        assert removed["payments"] == 1
        assert removed["payment_allocations"] == 1
        assert removed["class_enrollments"] == 1

        # All gone
        for table, col, val in [
            ("core.students", "id", sid),
            ("core.student_class_enrollments", "id", class_eid),
            ("core.invoices", "id", inv_id),
            ("core.payments", "id", pay_id),
        ]:
            row = db_session.execute(
                sa.text(f"SELECT id FROM {table} WHERE {col} = :v"), {"v": val}
            ).fetchone()
            assert row is None, f"{table} row still exists after hard delete"
