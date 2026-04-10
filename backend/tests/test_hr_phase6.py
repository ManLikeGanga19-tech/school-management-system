"""
Phase 6: HR module tests (leave management, payroll, salary structures, SMS recipients).

Tests cover:
  - Leave CRUD: submit, list, review (approve/reject), cancel
  - Salary structure: upsert + retrieve
  - Payroll generation: compute + skip duplicates
  - Payslip listing
  - SMS recipients endpoint
  - Permission gating (hr.leave.view, hr.leave.approve, hr.payroll.view, hr.payroll.manage)
"""
from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from sqlalchemy import text

from tests.helpers import create_tenant, make_actor

# ---------------------------------------------------------------------------
# Module-level fixture: create tables not managed by ORM
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def ensure_extra_tables(db_session):
    """
    Create tables that exist in production migrations but have no ORM model
    (staff_directory, plus any tables used by the HR service).
    Base.metadata.create_all handles the ORM models; this fixture handles the rest.
    """
    db_session.execute(text("""
        CREATE TABLE IF NOT EXISTS core.staff_directory (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL,
            staff_no TEXT NOT NULL,
            staff_type TEXT NOT NULL DEFAULT 'TEACHING',
            employment_type TEXT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            id_number TEXT,
            tsc_number TEXT,
            kra_pin TEXT,
            nssf_number TEXT,
            nhif_number TEXT,
            gender TEXT,
            date_of_birth DATE,
            date_hired DATE,
            next_of_kin_name TEXT,
            next_of_kin_relation TEXT,
            next_of_kin_phone TEXT,
            next_of_kin_email TEXT,
            address TEXT,
            notes TEXT,
            is_active BOOLEAN NOT NULL DEFAULT true,
            role_code TEXT,
            primary_subject_id UUID,
            separation_status TEXT,
            separation_reason TEXT,
            separation_date DATE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    db_session.commit()


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

DIRECTOR_PERMS = [
    "hr.staff.view",
    "hr.staff.manage",
    "hr.leave.view",
    "hr.leave.approve",
    "hr.payroll.view",
    "hr.payroll.manage",
]

LEAVE_VIEWER_PERMS = ["hr.leave.view"]


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _create_staff(db_session, *, tenant_id, first_name="Jane", last_name="Doe") -> str:
    """Insert a staff_directory row and return the staff UUID string."""
    staff_id = str(uuid4())
    staff_no = f"T{uuid4().hex[:6].upper()}"
    db_session.execute(text("""
        INSERT INTO core.staff_directory (
            id, tenant_id, staff_no, staff_type, first_name, last_name
        ) VALUES (
            :id, :tenant_id, :staff_no, 'TEACHING', :first_name, :last_name
        )
    """), {
        "id": staff_id,
        "tenant_id": str(tenant_id),
        "staff_no": staff_no,
        "first_name": first_name,
        "last_name": last_name,
    })
    db_session.commit()
    return staff_id


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def director(db_session, client):
    tenant = create_tenant(db_session, slug=f"hr-t-{uuid4().hex[:6]}")
    user, headers = make_actor(db_session, tenant=tenant, permissions=DIRECTOR_PERMS)
    return tenant, user, headers


@pytest.fixture()
def leave_viewer(db_session, client, director):
    tenant, _, _ = director
    _, headers = make_actor(
        db_session, tenant=tenant, permissions=LEAVE_VIEWER_PERMS,
        email=f"viewer-{uuid4().hex[:6]}@test.com",
    )
    return tenant, headers


# ---------------------------------------------------------------------------
# Leave management tests
# ---------------------------------------------------------------------------

class TestLeaveManagement:

    def test_submit_leave_request(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id)

        resp = client.post("/api/v1/tenants/hr/leave", json={
            "staff_id": staff_id,
            "leave_type": "ANNUAL",
            "start_date": "2026-05-01",
            "end_date": "2026-05-05",
            "reason": "Holiday",
        }, headers=headers)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["status"] == "PENDING"
        assert data["leave_type"] == "ANNUAL"
        assert data["days_requested"] == 3  # May 1 (Fri), May 4 (Mon), May 5 (Tue); May 2-3 are weekend

    def test_list_leave_requests(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="John", last_name="Smith")

        # Submit one
        client.post("/api/v1/tenants/hr/leave", json={
            "staff_id": staff_id,
            "leave_type": "SICK",
            "start_date": "2026-06-01",
            "end_date": "2026-06-03",
        }, headers=headers)

        resp = client.get("/api/v1/tenants/hr/leave", headers=headers)
        assert resp.status_code == 200
        items = resp.json()
        assert isinstance(items, list)
        assert len(items) >= 1

    def test_list_leave_filter_by_status(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Alice", last_name="K")

        client.post("/api/v1/tenants/hr/leave", json={
            "staff_id": staff_id,
            "leave_type": "ANNUAL",
            "start_date": "2026-07-01",
            "end_date": "2026-07-02",
        }, headers=headers)

        resp = client.get("/api/v1/tenants/hr/leave?status=PENDING", headers=headers)
        assert resp.status_code == 200
        for item in resp.json():
            assert item["status"] == "PENDING"

    def test_approve_leave_request(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Bob", last_name="M")

        create_resp = client.post("/api/v1/tenants/hr/leave", json={
            "staff_id": staff_id,
            "leave_type": "MATERNITY",
            "start_date": "2026-08-01",
            "end_date": "2026-08-14",
        }, headers=headers)
        assert create_resp.status_code == 201, create_resp.text
        request_id = create_resp.json()["id"]

        review_resp = client.patch(f"/api/v1/tenants/hr/leave/{request_id}/review", json={
            "status": "APPROVED",
            "review_note": "Approved by Director",
        }, headers=headers)
        assert review_resp.status_code == 200, review_resp.text
        assert review_resp.json()["status"] == "APPROVED"
        assert review_resp.json()["review_note"] == "Approved by Director"

    def test_reject_leave_request(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Carol", last_name="N")

        create_resp = client.post("/api/v1/tenants/hr/leave", json={
            "staff_id": staff_id,
            "leave_type": "UNPAID",
            "start_date": "2026-09-01",
            "end_date": "2026-09-03",
        }, headers=headers)
        assert create_resp.status_code == 201, create_resp.text
        request_id = create_resp.json()["id"]

        review_resp = client.patch(f"/api/v1/tenants/hr/leave/{request_id}/review", json={
            "status": "REJECTED",
            "review_note": "Not enough leave balance",
        }, headers=headers)
        assert review_resp.status_code == 200, review_resp.text
        assert review_resp.json()["status"] == "REJECTED"

    def test_cancel_leave_request(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Dan", last_name="O")

        create_resp = client.post("/api/v1/tenants/hr/leave", json={
            "staff_id": staff_id,
            "leave_type": "OTHER",
            "start_date": "2026-10-01",
            "end_date": "2026-10-02",
        }, headers=headers)
        assert create_resp.status_code == 201, create_resp.text
        request_id = create_resp.json()["id"]

        cancel_resp = client.patch(f"/api/v1/tenants/hr/leave/{request_id}/cancel",
                                   headers=headers)
        assert cancel_resp.status_code == 200, cancel_resp.text
        assert cancel_resp.json()["status"] == "CANCELLED"

    def test_cannot_cancel_approved_leave(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Eve", last_name="P")

        create_resp = client.post("/api/v1/tenants/hr/leave", json={
            "staff_id": staff_id,
            "leave_type": "SICK",
            "start_date": "2026-11-01",
            "end_date": "2026-11-01",
        }, headers=headers)
        request_id = create_resp.json()["id"]

        client.patch(f"/api/v1/tenants/hr/leave/{request_id}/review",
                     json={"status": "APPROVED"}, headers=headers)

        cancel_resp = client.patch(f"/api/v1/tenants/hr/leave/{request_id}/cancel",
                                   headers=headers)
        assert cancel_resp.status_code == 400

    def test_review_requires_approve_permission(self, client: TestClient, leave_viewer, db_session):
        tenant, headers = leave_viewer
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Frank", last_name="Q")

        # viewer can submit (they have hr.leave.view)
        create_resp = client.post("/api/v1/tenants/hr/leave", json={
            "staff_id": staff_id,
            "leave_type": "ANNUAL",
            "start_date": "2026-12-01",
            "end_date": "2026-12-03",
        }, headers=headers)
        assert create_resp.status_code == 201
        request_id = create_resp.json()["id"]

        # but cannot review (needs hr.leave.approve)
        review_resp = client.patch(f"/api/v1/tenants/hr/leave/{request_id}/review",
                                   json={"status": "APPROVED"}, headers=headers)
        assert review_resp.status_code == 403

    def test_invalid_leave_date_range(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Grace", last_name="R")

        resp = client.post("/api/v1/tenants/hr/leave", json={
            "staff_id": staff_id,
            "leave_type": "ANNUAL",
            "start_date": "2026-05-10",
            "end_date": "2026-05-05",  # end before start → 422
        }, headers=headers)
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Salary structure tests
# ---------------------------------------------------------------------------

class TestSalaryStructure:

    def test_upsert_and_get_salary_structure(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Henry", last_name="S")

        put_resp = client.put(f"/api/v1/tenants/hr/salary-structures/{staff_id}", json={
            "basic_salary": 50000,
            "house_allowance": 10000,
            "transport_allowance": 5000,
            "other_allowances": 2000,
            "helb_deduction": 1500,
            "loan_deduction": 0,
            "effective_from": "2026-01-01",
        }, headers=headers)
        assert put_resp.status_code == 200, put_resp.text
        data = put_resp.json()
        assert float(data["basic_salary"]) == 50000
        assert float(data["house_allowance"]) == 10000

        get_resp = client.get(f"/api/v1/tenants/hr/salary-structures/{staff_id}",
                              headers=headers)
        assert get_resp.status_code == 200
        assert float(get_resp.json()["basic_salary"]) == 50000

    def test_update_salary_structure(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Ivy", last_name="T")

        client.put(f"/api/v1/tenants/hr/salary-structures/{staff_id}", json={
            "basic_salary": 40000,
            "house_allowance": 8000,
            "transport_allowance": 4000,
            "other_allowances": 0,
            "helb_deduction": 0,
            "loan_deduction": 0,
            "effective_from": "2026-01-01",
        }, headers=headers)

        # Update with higher salary
        put_resp = client.put(f"/api/v1/tenants/hr/salary-structures/{staff_id}", json={
            "basic_salary": 45000,
            "house_allowance": 8000,
            "transport_allowance": 4000,
            "other_allowances": 0,
            "helb_deduction": 0,
            "loan_deduction": 0,
            "effective_from": "2026-04-01",
            "notes": "Salary increment",
        }, headers=headers)
        assert put_resp.status_code == 200
        assert float(put_resp.json()["basic_salary"]) == 45000

    def test_list_salary_structures(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Jack", last_name="U")

        client.put(f"/api/v1/tenants/hr/salary-structures/{staff_id}", json={
            "basic_salary": 35000,
            "house_allowance": 0,
            "transport_allowance": 0,
            "other_allowances": 0,
            "helb_deduction": 0,
            "loan_deduction": 0,
            "effective_from": "2026-01-01",
        }, headers=headers)

        list_resp = client.get("/api/v1/tenants/hr/salary-structures", headers=headers)
        assert list_resp.status_code == 200
        items = list_resp.json()
        assert isinstance(items, list)
        staff_ids = [item["staff_id"] for item in items]
        assert staff_id in staff_ids

    def test_get_nonexistent_salary_structure_returns_404(
        self, client: TestClient, director, db_session
    ):
        _, _, headers = director
        fake_id = str(uuid4())
        resp = client.get(f"/api/v1/tenants/hr/salary-structures/{fake_id}", headers=headers)
        assert resp.status_code == 404

    def test_payroll_manage_required_for_upsert(self, client: TestClient, leave_viewer, db_session):
        tenant, headers = leave_viewer
        staff_id = _create_staff(db_session, tenant_id=tenant.id, first_name="Karen", last_name="V")

        resp = client.put(f"/api/v1/tenants/hr/salary-structures/{staff_id}", json={
            "basic_salary": 30000,
            "house_allowance": 0,
            "transport_allowance": 0,
            "other_allowances": 0,
            "helb_deduction": 0,
            "loan_deduction": 0,
            "effective_from": "2026-01-01",
        }, headers=headers)
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Payroll generation tests
# ---------------------------------------------------------------------------

class TestPayrollGeneration:

    def _setup_staff_with_salary(self, client, director, db_session, *,
                                  first_name="Liam", last_name="W",
                                  basic=60000, house=12000, transport=6000):
        tenant, user, headers = director
        staff_id = _create_staff(db_session, tenant_id=tenant.id,
                                  first_name=first_name, last_name=last_name)
        client.put(f"/api/v1/tenants/hr/salary-structures/{staff_id}", json={
            "basic_salary": basic,
            "house_allowance": house,
            "transport_allowance": transport,
            "other_allowances": 0,
            "helb_deduction": 0,
            "loan_deduction": 0,
            "effective_from": "2026-01-01",
        }, headers=headers)
        return staff_id

    def test_generate_payslips(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = self._setup_staff_with_salary(client, director, db_session)

        gen_resp = client.post("/api/v1/tenants/hr/payroll/generate", json={
            "pay_month": 3,
            "pay_year": 2026,
        }, headers=headers)
        assert gen_resp.status_code == 200, gen_resp.text
        payslips = gen_resp.json()
        assert isinstance(payslips, list)
        assert len(payslips) >= 1

        slip = next((p for p in payslips if p["staff_id"] == staff_id), None)
        assert slip is not None
        assert slip["pay_month"] == 3
        assert slip["pay_year"] == 2026
        assert float(slip["gross_pay"]) == pytest.approx(78000, abs=1)  # 60k+12k+6k
        assert float(slip["net_pay"]) > 0
        assert float(slip["paye"]) > 0
        assert float(slip["nhif"]) > 0

    def test_generates_correct_kenya_paye(self, client: TestClient, director, db_session):
        """PAYE on gross 78,000: first 24k*10% + 8,333*25% + 45,667*30% - 2,400 relief."""
        tenant, user, headers = director
        self._setup_staff_with_salary(client, director, db_session,
                                       first_name="Mia", last_name="X",
                                       basic=60000, house=12000, transport=6000)

        gen_resp = client.post("/api/v1/tenants/hr/payroll/generate", json={
            "pay_month": 4,
            "pay_year": 2026,
        }, headers=headers)
        assert gen_resp.status_code == 200
        slips = gen_resp.json()
        slip = next(
            (s for s in slips if s["staff_id"] in [s["staff_id"] for s in slips]), None
        )
        assert slip is not None
        # PAYE = (24000*0.10) + (8333*0.25) + (78000-24000-8333)*0.30 - 2400
        # = 2400 + 2083.25 + 13700.1 - 2400 = 15783.35
        assert float(slip["paye"]) == pytest.approx(15783.35, abs=1)

    def test_skip_duplicate_payslips(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        self._setup_staff_with_salary(client, director, db_session,
                                       first_name="Noah", last_name="Y")

        # Generate for month 5
        first = client.post("/api/v1/tenants/hr/payroll/generate", json={
            "pay_month": 5,
            "pay_year": 2026,
        }, headers=headers)
        assert first.status_code == 200
        count_first = len(first.json())

        # Generate again — same month, should return empty (all skipped)
        second = client.post("/api/v1/tenants/hr/payroll/generate", json={
            "pay_month": 5,
            "pay_year": 2026,
        }, headers=headers)
        assert second.status_code == 200
        assert len(second.json()) == 0  # all already generated

    def test_list_payslips(self, client: TestClient, director, db_session):
        tenant, user, headers = director
        staff_id = self._setup_staff_with_salary(client, director, db_session,
                                                   first_name="Olivia", last_name="Z")

        client.post("/api/v1/tenants/hr/payroll/generate", json={
            "pay_month": 6,
            "pay_year": 2026,
        }, headers=headers)

        list_resp = client.get("/api/v1/tenants/hr/payroll/payslips?pay_year=2026&pay_month=6",
                               headers=headers)
        assert list_resp.status_code == 200
        slips = list_resp.json()
        assert isinstance(slips, list)
        assert any(s["staff_id"] == staff_id for s in slips)

    def test_payroll_manage_required_for_generate(self, client: TestClient, leave_viewer):
        tenant, headers = leave_viewer
        resp = client.post("/api/v1/tenants/hr/payroll/generate", json={
            "pay_month": 1,
            "pay_year": 2026,
        }, headers=headers)
        assert resp.status_code == 403

    def test_invalid_pay_month_returns_422(self, client: TestClient, director):
        _, _, headers = director
        resp = client.post("/api/v1/tenants/hr/payroll/generate", json={
            "pay_month": 13,  # invalid
            "pay_year": 2026,
        }, headers=headers)
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# SMS recipients endpoint tests
# ---------------------------------------------------------------------------

class TestSmsRecipients:

    def test_get_sms_recipients_empty(self, client: TestClient, director):
        """Returns empty list when no parents are linked to enrollments."""
        _, _, headers = director
        resp = client.get("/api/v1/tenants/sms/recipients", headers=headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_sms_recipients_requires_auth(self, client: TestClient, director):
        tenant, _, _ = director
        # No auth header → 401; but without tenant header the middleware returns 400 first.
        # With tenant header but no auth → 401
        resp = client.get("/api/v1/tenants/sms/recipients",
                          headers={"X-Tenant-ID": str(tenant.id)})
        assert resp.status_code == 401
