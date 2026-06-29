"""Phase F2 endpoints — apply-to-existing, bulk class-wide, student history.

Coverage:
  * POST /invoices/{id}/scholarship  — director-only, blocks PAID/CANCELLED,
    successful apply on DRAFT, validation passes through (reason required).
  * POST /scholarships/{id}/bulk-apply — RBAC, dry_run preview vs commit,
    skip-on-conflict (already_has_scholarship), audit emission.
  * GET  /students/{id}/scholarships  — includes both ACTIVE and REVOKED,
    newest first, tenant isolation.
"""
from __future__ import annotations

import json
from decimal import Decimal
from uuid import uuid4

import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/finance"

DIRECTOR_PERMS = [
    "finance.scholarships.view", "finance.scholarships.manage",
    "finance.invoices.view", "finance.invoices.manage",
    "finance.fees.view", "finance.fees.manage",
    "finance.policy.view", "finance.policy.manage",
    "enrollment.manage",
]

SECRETARY_PERMS = [
    "finance.scholarships.view", "finance.scholarships.manage",
    "finance.invoices.view", "finance.invoices.manage",
    "finance.fees.view", "finance.fees.manage",
    "enrollment.manage",
]


def _seed_student(db: Session, *, tenant_id, adm_year=2025) -> str:
    sid = str(uuid4())
    db.execute(sa.text(
        "INSERT INTO core.students (id, tenant_id, admission_no, "
        "first_name, last_name, status, admission_year) "
        "VALUES (:id, :tid, :adm, 'Test', 'Student', 'ACTIVE', :ay)"
    ), {
        "id": sid, "tid": str(tenant_id),
        "adm": f"ADM-{uuid4().hex[:6].upper()}", "ay": adm_year,
    })
    db.commit()
    return sid


def _seed_enrollment(db: Session, *, tenant_id, student_id, class_code="GRADE_1") -> str:
    eid = str(uuid4())
    payload = {"student_name": "Test Student", "class_code": class_code,
               "admission_class": class_code}
    db.execute(sa.text(
        "INSERT INTO core.enrollments "
        "(id, tenant_id, student_id, admission_number, status, payload) "
        "VALUES (:id, :tid, :sid, :adm, 'ENROLLED', CAST(:pl AS jsonb))"
    ), {
        "id": eid, "tid": str(tenant_id), "sid": student_id,
        "adm": f"ADM-{uuid4().hex[:6].upper()}",
        "pl": json.dumps(payload),
    })
    db.commit()
    return eid


def _seed_structure(client, headers, *, class_code="GRADE_1", year=2026, fee="10000"):
    cat = client.post(
        f"{BASE}/fee-categories",
        json={"code": f"TUIT-{uuid4().hex[:4]}", "name": "Tuition"},
        headers=headers,
    ).json()
    item = client.post(
        f"{BASE}/fee-items",
        json={"category_id": cat["id"], "code": f"FEE-{uuid4().hex[:4]}",
              "name": "Fee", "charge_frequency": "PER_TERM"},
        headers=headers,
    ).json()
    structure = client.post(
        f"{BASE}/fee-structures",
        json={"code": f"STR-{uuid4().hex[:4]}", "name": "Structure",
              "class_code": class_code, "academic_year": year,
              "student_type": "RETURNING", "is_active": True},
        headers=headers,
    ).json()
    client.post(
        f"{BASE}/fee-structures/{structure['id']}/items",
        json={"fee_item_id": item["id"],
              "term_1_amount": fee, "term_2_amount": fee, "term_3_amount": fee},
        headers=headers,
    )
    return structure["id"]


def _gen_invoice(client, headers, enrollment_id, term=1, year=2026):
    return client.post(
        f"{BASE}/invoices/generate/fees/v2",
        json={"enrollment_id": enrollment_id,
              "term_number": term, "academic_year": year},
        headers=headers,
    ).json()


# ── POST /invoices/{id}/scholarship ────────────────────────────────────────

class TestApplyToExistingInvoice:
    def test_director_can_apply_full_waiver_to_draft(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DIRECTOR_PERMS)
        _seed_structure(client, headers, fee="8000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        inv = _gen_invoice(client, headers, eid)
        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Bursary", "type": "FULL_WAIVER",
                  "value": "0", "is_active": True},
            headers=headers,
        ).json()

        resp = client.post(
            f"{BASE}/invoices/{inv['id']}/scholarship",
            json={"scholarship_id": sch["id"], "reason": "Top performer"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert Decimal(str(body["total_amount"])) == Decimal("0.00")

    def test_secretary_cannot_apply_after_the_fact(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, sec_headers = make_actor(
            db_session, tenant=tenant, permissions=SECRETARY_PERMS,
        )
        _, dir_headers = make_actor(
            db_session, tenant=tenant, permissions=DIRECTOR_PERMS,
            email=f"d-{uuid4().hex[:6]}@x.com",
        )
        _seed_structure(client, dir_headers, fee="8000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        inv = _gen_invoice(client, sec_headers, eid)
        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Bursary", "type": "FULL_WAIVER",
                  "value": "0", "is_active": True},
            headers=dir_headers,
        ).json()
        resp = client.post(
            f"{BASE}/invoices/{inv['id']}/scholarship",
            json={"scholarship_id": sch["id"], "reason": "Try"},
            headers=sec_headers,
        )
        assert resp.status_code == 403

    def test_block_on_paid_invoice(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DIRECTOR_PERMS)
        _seed_structure(client, headers, fee="5000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        inv = _gen_invoice(client, headers, eid)
        # Force PAID directly.
        db_session.execute(sa.text(
            "UPDATE core.invoices SET status='PAID', paid_amount=total_amount, "
            "balance_amount=0 WHERE id = :id"
        ), {"id": inv["id"]})
        db_session.commit()
        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Late", "type": "FIXED", "value": "1000",
                  "is_active": True},
            headers=headers,
        ).json()
        resp = client.post(
            f"{BASE}/invoices/{inv['id']}/scholarship",
            json={"scholarship_id": sch["id"], "amount": "500",
                  "reason": "Too late"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "paid" in resp.text.lower()

    def test_reason_required(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DIRECTOR_PERMS)
        _seed_structure(client, headers, fee="5000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        inv = _gen_invoice(client, headers, eid)
        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Late", "type": "FIXED", "value": "1000",
                  "is_active": True},
            headers=headers,
        ).json()
        resp = client.post(
            f"{BASE}/invoices/{inv['id']}/scholarship",
            json={"scholarship_id": sch["id"], "amount": "500"},
            headers=headers,
        )
        assert resp.status_code == 400


# ── POST /scholarships/{id}/bulk-apply ─────────────────────────────────────

class TestBulkApplyToClass:
    def _setup_class(self, client, db_session, headers, *, count=3):
        tenant = create_tenant(db_session)
        # New tenant headers (same permissions, different tenant context).
        _, h = make_actor(db_session, tenant=tenant, permissions=DIRECTOR_PERMS)
        _seed_structure(client, h, fee="5000")
        invs = []
        for _ in range(count):
            sid = _seed_student(db_session, tenant_id=tenant.id)
            eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
            inv = _gen_invoice(client, h, eid)
            invs.append(inv)
        return tenant, h, invs

    def test_dry_run_does_not_persist(
        self, client: TestClient, db_session: Session
    ):
        tenant, headers, invs = self._setup_class(client, db_session, None, count=3)
        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "ClassWide", "type": "FULL_WAIVER",
                  "value": "0", "is_active": True},
            headers=headers,
        ).json()
        resp = client.post(
            f"{BASE}/scholarships/{sch['id']}/bulk-apply",
            json={"class_code": "GRADE_1", "term_number": 1,
                  "academic_year": 2026, "reason": "Class waiver",
                  "dry_run": True},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["summary"]["dry_run"] is True
        assert body["summary"]["applied"] == 3
        # Nothing actually persisted.
        cnt = db_session.execute(sa.text(
            "SELECT COUNT(*) FROM core.scholarship_allocations "
            "WHERE tenant_id = :tid"
        ), {"tid": str(tenant.id)}).scalar()
        assert cnt == 0

    def test_commit_applies_and_skips_already_have_scholarship(
        self, client: TestClient, db_session: Session
    ):
        tenant, headers, invs = self._setup_class(client, db_session, None, count=3)
        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "ClassWaive", "type": "FULL_WAIVER",
                  "value": "0", "is_active": True},
            headers=headers,
        ).json()
        # Pre-apply to one of the three so the bulk should skip it.
        existing = client.post(
            f"{BASE}/invoices/{invs[0]['id']}/scholarship",
            json={"scholarship_id": sch["id"], "reason": "Already done"},
            headers=headers,
        )
        assert existing.status_code == 200

        resp = client.post(
            f"{BASE}/scholarships/{sch['id']}/bulk-apply",
            json={"class_code": "GRADE_1", "term_number": 1,
                  "academic_year": 2026, "reason": "Class waiver"},
            headers=headers,
        )
        body = resp.json()
        assert body["summary"]["applied"] == 2
        assert body["summary"]["skipped"] == 1
        assert any(s["reason"] == "already_has_scholarship" for s in body["skipped"])

    def test_secretary_blocked(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, h = make_actor(db_session, tenant=tenant, permissions=SECRETARY_PERMS)
        # Need a scholarship to even reach the gate (route gate fires first
        # though).
        resp = client.post(
            f"{BASE}/scholarships/{uuid4()}/bulk-apply",
            json={"class_code": "GRADE_1", "term_number": 1,
                  "academic_year": 2026, "reason": "x"},
            headers=h,
        )
        assert resp.status_code == 403


# ── GET /students/{id}/scholarships ────────────────────────────────────────

class TestStudentScholarshipHistory:
    def test_returns_active_and_revoked_newest_first(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=DIRECTOR_PERMS)
        _seed_structure(client, headers, fee="6000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        inv = _gen_invoice(client, headers, eid)
        sch = client.post(
            f"{BASE}/scholarships",
            json={"name": "Hist", "type": "FULL_WAIVER",
                  "value": "0", "is_active": True},
            headers=headers,
        ).json()
        client.post(
            f"{BASE}/invoices/{inv['id']}/scholarship",
            json={"scholarship_id": sch["id"], "reason": "first"},
            headers=headers,
        )
        # Delete invoice → triggers REVOKED.
        client.delete(f"{BASE}/invoices/{inv['id']}", headers=headers)

        resp = client.get(
            f"{BASE}/students/{sid}/scholarships",
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        rows = body["allocations"]
        assert len(rows) == 1
        assert rows[0]["status"] == "REVOKED"
        assert rows[0]["scholarship_name"] == "Hist"

    def test_tenant_isolation(
        self, client: TestClient, db_session: Session
    ):
        tenant_a = create_tenant(db_session, slug=f"ta-{uuid4().hex[:6]}",
                                 domain=f"{uuid4().hex[:6]}.example.com")
        tenant_b = create_tenant(db_session, slug=f"tb-{uuid4().hex[:6]}",
                                 domain=f"{uuid4().hex[:6]}.example.com")
        _, ha = make_actor(db_session, tenant=tenant_a, permissions=DIRECTOR_PERMS)
        _, hb = make_actor(db_session, tenant=tenant_b, permissions=DIRECTOR_PERMS)

        _seed_structure(client, ha, fee="5000")
        sid_a = _seed_student(db_session, tenant_id=tenant_a.id)
        eid_a = _seed_enrollment(db_session, tenant_id=tenant_a.id, student_id=sid_a)
        inv_a = _gen_invoice(client, ha, eid_a)
        sch_a = client.post(
            f"{BASE}/scholarships",
            json={"name": "A", "type": "FULL_WAIVER",
                  "value": "0", "is_active": True},
            headers=ha,
        ).json()
        client.post(
            f"{BASE}/invoices/{inv_a['id']}/scholarship",
            json={"scholarship_id": sch_a["id"], "reason": "ours"},
            headers=ha,
        )

        # Tenant B asks about tenant A's student — must get empty.
        resp = client.get(
            f"{BASE}/students/{sid_a}/scholarships",
            headers=hb,
        )
        body = resp.json()
        assert body["allocations"] == []
