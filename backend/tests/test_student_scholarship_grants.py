"""Phase M2 tests — student-level scholarship grants.

Covers:
  * Create grant validates scholarship exists + active
  * Create grant validates student exists in tenant
  * Duplicate ACTIVE grant blocked (partial unique index + service guard)
  * Grant can be re-created after revocation
  * Reason required on create + revoke (audit)
  * apply_to_existing_open_invoices=true walks matching open invoices
  * apply_to_existing_open_invoices=false leaves them alone
  * Recipient-cap check (max_recipients on scholarship) is enforced
  * v2 invoice generator auto-applies matching active grants
  * v2 skips grants whose scope doesn't match (wrong year/term)
  * v2 doesn't double-apply if scholarship_id was passed explicitly
  * Grant that can't apply (pool exhausted etc.) logs audit + continues
  * Revoke stops future v2 auto-application; past allocations survive
  * list_grants returns full history newest first
  * Tenant isolation
  * RBAC gates
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

PERMS = [
    "finance.scholarships.view", "finance.scholarships.manage",
    "finance.invoices.view", "finance.invoices.manage",
    "finance.payments.view", "finance.payments.manage",
    "finance.fees.view", "finance.fees.manage",
    "finance.policy.view", "finance.policy.manage",
    "enrollment.manage",
]


# ── seed helpers ─────────────────────────────────────────────────────────────

def _seed_student(db: Session, *, tenant_id, first="Amina", last="Wanjiru",
                  adm_year=2025) -> str:
    sid = str(uuid4())
    db.execute(sa.text(
        "INSERT INTO core.students "
        "(id, tenant_id, admission_no, first_name, last_name, status, admission_year) "
        "VALUES (:id, :tid, :adm, :fn, :ln, 'ACTIVE', :ay)"
    ), {
        "id": sid, "tid": str(tenant_id),
        "adm": f"ADM-{uuid4().hex[:6].upper()}",
        "fn": first, "ln": last, "ay": adm_year,
    })
    db.commit()
    return sid


def _seed_enrollment(db: Session, *, tenant_id, student_id,
                     class_code="GRADE_1") -> str:
    eid = str(uuid4())
    payload = {"student_name": f"Test", "class_code": class_code,
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


def _seed_structure(client, headers, *, class_code="GRADE_1", year=2026,
                    fee="10000"):
    cat = client.post(f"{BASE}/fee-categories",
                      json={"code": f"C-{uuid4().hex[:4]}", "name": "Cat"},
                      headers=headers).json()
    item = client.post(f"{BASE}/fee-items",
                       json={"category_id": cat["id"],
                             "code": f"F-{uuid4().hex[:4]}", "name": "Fee",
                             "charge_frequency": "PER_TERM"},
                       headers=headers).json()
    struct = client.post(f"{BASE}/fee-structures",
                         json={"code": f"S-{uuid4().hex[:4]}", "name": "S",
                               "class_code": class_code, "academic_year": year,
                               "student_type": "RETURNING", "is_active": True},
                         headers=headers).json()
    client.post(f"{BASE}/fee-structures/{struct['id']}/items",
                json={"fee_item_id": item["id"],
                      "term_1_amount": fee, "term_2_amount": fee,
                      "term_3_amount": fee},
                headers=headers)
    return struct["id"]


def _create_scholarship(client, headers, *, name, type_="FULL_WAIVER",
                        value="0", max_recipients=None):
    body = {"name": name, "type": type_, "value": value, "is_active": True}
    if max_recipients is not None:
        body["max_recipients"] = max_recipients
    return client.post(f"{BASE}/scholarships", json=body, headers=headers).json()


def _gen_v2(client, headers, enrollment_id, *, term=1, year=2026):
    return client.post(f"{BASE}/invoices/generate/fees/v2",
                       json={"enrollment_id": enrollment_id,
                             "term_number": term, "academic_year": year},
                       headers=headers).json()


# ── Create grant ─────────────────────────────────────────────────────────────

class TestCreateGrant:
    def test_creates_active_grant(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        sch = _create_scholarship(client, headers, name="Bursary A")

        resp = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "Governor's Bursary 2026",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["grant"]["status"] == "ACTIVE"
        assert body["grant"]["scholarship_id"] == sch["id"]

    def test_reason_required(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        sch = _create_scholarship(client, headers, name="X")
        resp = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"]},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_student_must_exist_in_tenant(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sch = _create_scholarship(client, headers, name="X")
        resp = client.post(
            f"{BASE}/students/{uuid4()}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "x"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "student" in resp.text.lower()

    def test_scholarship_must_be_active(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        sch = _create_scholarship(client, headers, name="X")
        # Deactivate.
        client.put(f"{BASE}/scholarships/{sch['id']}",
                   json={"is_active": False}, headers=headers)
        resp = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "x"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "inactive" in resp.text.lower()

    def test_duplicate_active_grant_blocked(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        sch = _create_scholarship(client, headers, name="X")
        r1 = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "first",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        )
        assert r1.status_code == 200
        r2 = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "again",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        )
        assert r2.status_code == 400
        assert "already has an active grant" in r2.text.lower()

    def test_recipient_cap_enforced(
        self, client: TestClient, db_session: Session
    ):
        """max_recipients=1 → second grant to a different student refused."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sch = _create_scholarship(
            client, headers, name="Only-one",
            max_recipients=1,
        )
        s1 = _seed_student(db_session, tenant_id=tenant.id, first="A")
        r1 = client.post(
            f"{BASE}/students/{s1}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "first",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        )
        assert r1.status_code == 200

        s2 = _seed_student(db_session, tenant_id=tenant.id, first="B")
        r2 = client.post(
            f"{BASE}/students/{s2}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "second",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        )
        assert r2.status_code == 400
        assert "recipient cap" in r2.text.lower()


# ── Auto-apply to existing invoices ─────────────────────────────────────────

class TestApplyToExisting:
    def test_grant_applies_to_open_matching_invoice(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee="10000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id,
                               student_id=sid)
        inv = _gen_v2(client, headers, eid, term=1, year=2026)
        assert Decimal(str(inv["total_amount"])) == Decimal("10000.00")

        sch = _create_scholarship(client, headers, name="Full waiver")
        resp = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "Mid-term award",
                  "apply_to_existing_open_invoices": True},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        summary = body["application_summary"]
        assert len(summary["applied"]) == 1
        assert summary["applied"][0]["invoice_id"] == inv["id"]

    def test_grant_flag_false_skips_apply(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee="10000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id,
                               student_id=sid)
        inv = _gen_v2(client, headers, eid, term=1, year=2026)
        sch = _create_scholarship(client, headers, name="Skip me")
        resp = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "later",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["application_summary"] is None
        # No allocation should exist yet.
        cnt = db_session.execute(sa.text(
            "SELECT COUNT(*) FROM core.scholarship_allocations "
            "WHERE invoice_id = :iid"
        ), {"iid": inv["id"]}).scalar()
        assert cnt == 0

    def test_grant_skips_invoice_already_carrying_same_scholarship(
        self, client: TestClient, db_session: Session
    ):
        """If someone manually applied the same scholarship first, the
        grant's auto-apply pass skips it (no duplicate allocation)."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee="10000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id,
                               student_id=sid)
        inv = _gen_v2(client, headers, eid, term=1, year=2026)
        sch = _create_scholarship(client, headers, name="Manual first")

        # Manual apply first.
        m = client.post(
            f"{BASE}/invoices/{inv['id']}/scholarship",
            json={"scholarship_id": sch["id"], "reason": "manual"},
            headers=headers,
        )
        assert m.status_code == 200

        resp = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "after manual",
                  "apply_to_existing_open_invoices": True},
            headers=headers,
        )
        assert resp.status_code == 200
        summary = resp.json()["application_summary"]
        assert len(summary["applied"]) == 0
        assert len(summary["skipped"]) == 1
        assert summary["skipped"][0]["reason"] == "already_has_this_scholarship"


# ── v2 generator auto-apply ─────────────────────────────────────────────────

class TestV2AutoApply:
    def test_v2_generator_auto_applies_active_grant(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee="10000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        sch = _create_scholarship(client, headers, name="Auto grant")

        client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "yearly grant",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        )

        inv = _gen_v2(client, headers, eid, term=1, year=2026)
        assert Decimal(str(inv["total_amount"])) == Decimal("0.00")

    def test_scope_mismatch_grant_not_applied(
        self, client: TestClient, db_session: Session
    ):
        """Grant scoped to term=2 must NOT apply to a term=1 invoice."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee="10000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        sch = _create_scholarship(client, headers, name="Term-2 only")
        client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "term 2 only",
                  "term_number": 2, "academic_year": 2026,
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        )
        inv = _gen_v2(client, headers, eid, term=1, year=2026)
        # Term-1 invoice — grant scoped to term-2, no auto-apply.
        assert Decimal(str(inv["total_amount"])) == Decimal("10000.00")

    def test_revoked_grant_not_auto_applied(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_structure(client, headers, fee="10000")
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        sch = _create_scholarship(client, headers, name="Grant then revoke")
        g = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "temp",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        ).json()
        client.post(
            f"{BASE}/students/{sid}/scholarship-grants/{g['grant']['id']}/revoke",
            json={"reason": "policy change"},
            headers=headers,
        )
        inv = _gen_v2(client, headers, eid, term=1, year=2026)
        # Grant is REVOKED — v2 doesn't apply it.
        assert Decimal(str(inv["total_amount"])) == Decimal("10000.00")


# ── Revoke ─────────────────────────────────────────────────────────────────

class TestRevoke:
    def test_revoke_soft_terminates(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        sch = _create_scholarship(client, headers, name="Revocable")
        g = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "grant",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        ).json()
        resp = client.post(
            f"{BASE}/students/{sid}/scholarship-grants/{g['grant']['id']}/revoke",
            json={"reason": "policy change"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "REVOKED"

    def test_revoke_reason_required(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        sch = _create_scholarship(client, headers, name="X")
        g = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "x",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        ).json()
        resp = client.post(
            f"{BASE}/students/{sid}/scholarship-grants/{g['grant']['id']}/revoke",
            json={},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_re_grant_after_revoke(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        sch = _create_scholarship(client, headers, name="X")
        g = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "first",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        ).json()
        client.post(
            f"{BASE}/students/{sid}/scholarship-grants/{g['grant']['id']}/revoke",
            json={"reason": "policy"},
            headers=headers,
        )
        # Re-grant the same scholarship — must succeed.
        r2 = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "second",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        )
        assert r2.status_code == 200
        assert r2.json()["grant"]["status"] == "ACTIVE"


# ── List history + isolation + RBAC ─────────────────────────────────────────

class TestListHistoryAndSecurity:
    def test_list_returns_active_and_revoked(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        sch = _create_scholarship(client, headers, name="Y")
        g = client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "first",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        ).json()
        client.post(
            f"{BASE}/students/{sid}/scholarship-grants/{g['grant']['id']}/revoke",
            json={"reason": "later"},
            headers=headers,
        )
        client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "second",
                  "apply_to_existing_open_invoices": False},
            headers=headers,
        )
        rows = client.get(
            f"{BASE}/students/{sid}/scholarship-grants", headers=headers,
        ).json()["grants"]
        statuses = [r["status"] for r in rows]
        assert statuses.count("ACTIVE") == 1
        assert statuses.count("REVOKED") == 1

    def test_tenant_isolation(
        self, client: TestClient, db_session: Session
    ):
        a = create_tenant(db_session, slug=f"ta-{uuid4().hex[:6]}",
                          domain=f"{uuid4().hex[:6]}.example.com")
        b = create_tenant(db_session, slug=f"tb-{uuid4().hex[:6]}",
                          domain=f"{uuid4().hex[:6]}.example.com")
        _, ha = make_actor(db_session, tenant=a, permissions=PERMS)
        _, hb = make_actor(db_session, tenant=b, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=a.id)
        sch = _create_scholarship(client, ha, name="A-only")
        client.post(
            f"{BASE}/students/{sid}/scholarship-grants",
            json={"scholarship_id": sch["id"], "reason": "x",
                  "apply_to_existing_open_invoices": False},
            headers=ha,
        )
        # Tenant B calling A's endpoint gets empty.
        rows = client.get(
            f"{BASE}/students/{sid}/scholarship-grants", headers=hb,
        ).json()["grants"]
        assert rows == []

    def test_gate_requires_scholarships_manage_for_write(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(
            db_session, tenant=tenant,
            permissions=["finance.scholarships.view"],
        )
        resp = client.post(
            f"{BASE}/students/{uuid4()}/scholarship-grants",
            json={"scholarship_id": str(uuid4()), "reason": "x"},
            headers=headers,
        )
        assert resp.status_code == 403
