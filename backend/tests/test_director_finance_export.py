"""Tests for the director finance report export endpoints (Phase E4).

Coverage:
  * CSV export returns a multi-section UTF-8 file with the expected headers.
  * PDF export returns binary starting with %PDF and is non-trivial in size.
  * Both endpoints write an audit log entry with action=finance.report.export.
  * Both endpoints require finance.invoices.view (RBAC).
  * Unsupported scope returns 400.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/director"
PERMS = ["finance.invoices.view"]


def _seed_min_data(db: Session, tenant_id):
    """A minimal slice so the bundle isn't empty across the board: 1 student,
    1 enrollment, 1 invoice, 1 payment."""
    sid = str(uuid4())
    db.execute(sa.text(
        "INSERT INTO core.students (id, tenant_id, admission_no, first_name, last_name, gender, status) "
        "VALUES (:id, :tid, :adm, 'Jane', 'Doe', 'F', 'ACTIVE')"
    ), {"id": sid, "tid": str(tenant_id), "adm": f"A-{uuid4().hex[:6]}"})

    eid = str(uuid4())
    import json as _json
    db.execute(sa.text(
        "INSERT INTO core.enrollments (id, tenant_id, admission_number, status, payload, student_id) "
        "VALUES (:id, :tid, :adm, 'ENROLLED', CAST(:pl AS jsonb), :sid)"
    ), {
        "id": eid, "tid": str(tenant_id), "adm": f"A-{uuid4().hex[:6]}",
        "pl": _json.dumps({"student_name": "Jane Doe", "class_code": "G4A"}),
        "sid": sid,
    })

    iid = str(uuid4())
    db.execute(sa.text(
        "INSERT INTO core.invoices (id, tenant_id, enrollment_id, invoice_no, invoice_type, "
        "status, total_amount, paid_amount, balance_amount, term_number, academic_year, meta) "
        "VALUES (:id, :tid, :eid, :no, 'SCHOOL_FEES', 'ISSUED', :tot, :paid, :bal, 2, 2026, "
        "CAST(:m AS jsonb))"
    ), {
        "id": iid, "tid": str(tenant_id), "eid": eid,
        "no": f"INV-{uuid4().hex[:6]}",
        "tot": "10000", "paid": "3000", "bal": "7000",
        "m": _json.dumps({"class_code": "G4A"}),
    })

    pid = str(uuid4())
    db.execute(sa.text(
        "INSERT INTO core.payments (id, tenant_id, provider, amount, received_at) "
        "VALUES (:id, :tid, 'MPESA', 3000, NOW())"
    ), {"id": pid, "tid": str(tenant_id)})
    db.commit()


class TestFinanceExportCsv:
    def test_csv_round_trip(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _seed_min_data(db_session, tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        resp = client.get(f"{BASE}/finance/export.csv?scope=all-time", headers=headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        body = resp.content.decode("utf-8")

        # Section dividers present
        assert "# All-time finance" in body
        assert "# Student demographics" in body
        assert "# Finance by class" in body
        assert "# Payments by provider" in body
        # KES values formatted as plain decimals (no thousands separator)
        assert "10000.00" in body  # billed
        assert "MPESA" in body

    def test_csv_unsupported_scope_400(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        resp = client.get(f"{BASE}/finance/export.csv?scope=last-year", headers=headers)
        assert resp.status_code == 400

    def test_csv_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get(f"{BASE}/finance/export.csv", headers=headers)
        assert resp.status_code == 403

    def test_csv_writes_audit(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _seed_min_data(db_session, tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        resp = client.get(f"{BASE}/finance/export.csv?scope=all-time", headers=headers)
        assert resp.status_code == 200
        cnt = db_session.execute(sa.text(
            "SELECT COUNT(*) FROM core.audit_logs "
            "WHERE tenant_id = :tid AND action = 'finance.report.export'"
        ), {"tid": str(tenant.id)}).scalar()
        assert cnt == 1


class TestFinanceExportPdf:
    def test_pdf_round_trip(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _seed_min_data(db_session, tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        resp = client.get(f"{BASE}/finance/export.pdf?scope=all-time", headers=headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/pdf")
        # Magic bytes + non-trivial size
        assert resp.content.startswith(b"%PDF-")
        assert len(resp.content) > 2_000

    def test_pdf_writes_audit(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _seed_min_data(db_session, tenant.id)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        resp = client.get(f"{BASE}/finance/export.pdf", headers=headers)
        assert resp.status_code == 200
        meta = db_session.execute(sa.text(
            "SELECT meta FROM core.audit_logs "
            "WHERE tenant_id = :tid AND action = 'finance.report.export' "
            "ORDER BY created_at DESC LIMIT 1"
        ), {"tid": str(tenant.id)}).scalar()
        assert meta and meta.get("format") == "pdf"
        assert meta.get("scope") == "all-time"

    def test_pdf_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get(f"{BASE}/finance/export.pdf", headers=headers)
        assert resp.status_code == 403
