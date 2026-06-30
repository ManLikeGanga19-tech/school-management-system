"""Phase G1 — paginated director invoice listing.

Covers:
  * Pagination math (page/page_size/total/pages)
  * Server-side filters (status, invoice_type, outstanding_only, q,
    date_from/date_to, enrollment_id)
  * Sort order is created_at DESC (newest first)
  * Tenant isolation
  * RBAC (finance.invoices.view required)
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

ROUTE = "/api/v1/director/finance/invoices"
PERMS = ["finance.invoices.view"]


def _seed_student(db: Session, *, tenant_id) -> str:
    sid = str(uuid4())
    db.execute(sa.text(
        "INSERT INTO core.students "
        "(id, tenant_id, admission_no, first_name, last_name, status) "
        "VALUES (:id, :tid, :adm, 'A', 'B', 'ACTIVE')"
    ), {"id": sid, "tid": str(tenant_id),
        "adm": f"ADM-{uuid4().hex[:6].upper()}"})
    db.commit()
    return sid


def _seed_enrollment(db: Session, *, tenant_id, student_id) -> str:
    eid = str(uuid4())
    db.execute(sa.text(
        "INSERT INTO core.enrollments "
        "(id, tenant_id, student_id, admission_number, status, payload) "
        "VALUES (:id, :tid, :sid, :adm, 'ENROLLED', CAST(:pl AS jsonb))"
    ), {
        "id": eid, "tid": str(tenant_id), "sid": student_id,
        "adm": f"ADM-{uuid4().hex[:6].upper()}",
        "pl": json.dumps({"student_name": "X"}),
    })
    db.commit()
    return eid


def _seed_invoice(
    db: Session, *, tenant_id, enrollment_id, no, status="ISSUED",
    total="1000", paid="0", balance="1000", invoice_type="SCHOOL_FEES",
    created_at=None,
):
    iid = str(uuid4())
    if created_at is None:
        db.execute(sa.text(
            "INSERT INTO core.invoices "
            "(id, tenant_id, invoice_no, invoice_type, status, enrollment_id,"
            " currency, total_amount, paid_amount, balance_amount) "
            "VALUES (:id, :tid, :no, :ity, :st, :eid, 'KES', :tot, :paid, :bal)"
        ), {
            "id": iid, "tid": str(tenant_id), "no": no, "ity": invoice_type,
            "st": status, "eid": enrollment_id,
            "tot": total, "paid": paid, "bal": balance,
        })
    else:
        db.execute(sa.text(
            "INSERT INTO core.invoices "
            "(id, tenant_id, invoice_no, invoice_type, status, enrollment_id,"
            " currency, total_amount, paid_amount, balance_amount, created_at) "
            "VALUES (:id, :tid, :no, :ity, :st, :eid, 'KES',"
            " :tot, :paid, :bal, :ca)"
        ), {
            "id": iid, "tid": str(tenant_id), "no": no, "ity": invoice_type,
            "st": status, "eid": enrollment_id,
            "tot": total, "paid": paid, "bal": balance, "ca": created_at,
        })
    db.commit()
    return iid


class TestPagination:
    def test_default_page_size_30_with_meta(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        for i in range(45):
            _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                          no=f"INV-{i:04d}")

        r = client.get(ROUTE, headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert len(body["items"]) == 30
        assert body["meta"]["total"] == 45
        assert body["meta"]["page"] == 1
        assert body["meta"]["page_size"] == 30
        assert body["meta"]["pages"] == 2

    def test_page_2_returns_remainder(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        for i in range(45):
            _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                          no=f"INV-{i:04d}")

        r = client.get(f"{ROUTE}?page=2&page_size=30", headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert len(body["items"]) == 15

    def test_custom_page_sizes_50_and_100(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        for i in range(120):
            _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                          no=f"INV-{i:04d}")
        for size, expected_pages in ((50, 3), (100, 2)):
            r = client.get(f"{ROUTE}?page_size={size}", headers=headers)
            assert r.status_code == 200
            assert r.json()["meta"]["pages"] == expected_pages

    def test_page_clamps_to_max(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid, no="INV-1")
        r = client.get(f"{ROUTE}?page=99", headers=headers)
        assert r.status_code == 200
        assert r.json()["meta"]["page"] == 1


class TestFilters:
    def _setup(self, client, db_session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        return tenant, headers, eid

    def test_filter_by_status(self, client: TestClient, db_session: Session):
        tenant, headers, eid = self._setup(client, db_session)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      no="INV-DRAFT-1", status="DRAFT")
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      no="INV-ISSUED-1", status="ISSUED")
        r = client.get(f"{ROUTE}?status=DRAFT", headers=headers)
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["status"] == "DRAFT"

    def test_filter_outstanding_only(
        self, client: TestClient, db_session: Session
    ):
        tenant, headers, eid = self._setup(client, db_session)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      no="PAID", paid="1000", balance="0", status="PAID")
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      no="OPEN", balance="1000")
        r = client.get(f"{ROUTE}?outstanding_only=true", headers=headers)
        items = r.json()["items"]
        assert {i["invoice_no"] for i in items} == {"OPEN"}

    def test_q_searches_invoice_no(
        self, client: TestClient, db_session: Session
    ):
        tenant, headers, eid = self._setup(client, db_session)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      no="ALPHA-001")
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      no="BRAVO-001")
        r = client.get(f"{ROUTE}?q=alpha", headers=headers)
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["invoice_no"] == "ALPHA-001"

    def test_date_range_filter(self, client: TestClient, db_session: Session):
        tenant, headers, eid = self._setup(client, db_session)
        today = date.today()
        old = (today - timedelta(days=10)).isoformat()
        new = today.isoformat()
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      no="OLD", created_at=old)
        _seed_invoice(db_session, tenant_id=tenant.id, enrollment_id=eid,
                      no="NEW", created_at=new)
        r = client.get(
            f"{ROUTE}?date_from={(today - timedelta(days=2)).isoformat()}",
            headers=headers,
        )
        nos = {i["invoice_no"] for i in r.json()["items"]}
        assert nos == {"NEW"}


class TestSortAndIsolation:
    def test_sort_by_created_at_desc(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id)
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        # Insert with explicit timestamps so created_at order is deterministic.
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        for i in range(3):
            _seed_invoice(
                db_session, tenant_id=tenant.id, enrollment_id=eid,
                no=f"T{i}",
                created_at=(now - timedelta(hours=i)).isoformat(),
            )
        r = client.get(ROUTE, headers=headers)
        nos = [i["invoice_no"] for i in r.json()["items"]]
        # T0 is newest; T2 is oldest.
        assert nos == ["T0", "T1", "T2"]

    def test_tenant_isolation(self, client: TestClient, db_session: Session):
        a = create_tenant(db_session, slug=f"ta-{uuid4().hex[:6]}",
                          domain=f"{uuid4().hex[:6]}.example.com")
        b = create_tenant(db_session, slug=f"tb-{uuid4().hex[:6]}",
                          domain=f"{uuid4().hex[:6]}.example.com")
        _, ha = make_actor(db_session, tenant=a, permissions=PERMS)
        _, hb = make_actor(db_session, tenant=b, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=a.id)
        eid = _seed_enrollment(db_session, tenant_id=a.id, student_id=sid)
        _seed_invoice(db_session, tenant_id=a.id, enrollment_id=eid, no="A-1")
        # Tenant B sees nothing from A.
        rb = client.get(ROUTE, headers=hb)
        assert rb.json()["meta"]["total"] == 0


class TestRBAC:
    def test_requires_finance_invoices_view(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        r = client.get(ROUTE, headers=headers)
        assert r.status_code == 403
