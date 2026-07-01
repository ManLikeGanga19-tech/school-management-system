"""Paginated /director/finance/payments endpoint (Phase I).

Same shape as the invoices endpoint (G1): server-side pagination + filters
+ student enrichment. Shared by director + secretary (finance.payments.view).
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

ROUTE = "/api/v1/director/finance/payments"
PERMS = ["finance.payments.view"]


def _seed_student(db: Session, *, tenant_id, first="Amina", last="Wanjiru",
                  adm=None) -> str:
    sid = str(uuid4())
    adm = adm or f"ADM-{uuid4().hex[:6].upper()}"
    db.execute(sa.text(
        "INSERT INTO core.students "
        "(id, tenant_id, admission_no, first_name, last_name, status) "
        "VALUES (:id, :tid, :adm, :fn, :ln, 'ACTIVE')"
    ), {"id": sid, "tid": str(tenant_id), "adm": adm, "fn": first, "ln": last})
    db.commit()
    return sid


def _seed_enrollment(db: Session, *, tenant_id, student_id) -> str:
    eid = str(uuid4())
    payload = {"student_name": "Test Student"}
    db.execute(sa.text(
        "INSERT INTO core.enrollments "
        "(id, tenant_id, student_id, admission_number, status, payload) "
        "VALUES (:id, :tid, :sid, :adm, 'ENROLLED', CAST(:pl AS jsonb))"
    ), {"id": eid, "tid": str(tenant_id), "sid": student_id,
        "adm": f"ADM-{uuid4().hex[:6].upper()}", "pl": json.dumps(payload)})
    db.commit()
    return eid


def _seed_invoice(db: Session, *, tenant_id, enrollment_id, no,
                  total="1000") -> str:
    iid = str(uuid4())
    db.execute(sa.text(
        "INSERT INTO core.invoices "
        "(id, tenant_id, invoice_no, invoice_type, status, enrollment_id,"
        " currency, total_amount, paid_amount, balance_amount) "
        "VALUES (:id, :tid, :no, 'SCHOOL_FEES', 'ISSUED', :eid,"
        " 'KES', :tot, 0, :tot)"
    ), {"id": iid, "tid": str(tenant_id), "no": no, "eid": enrollment_id,
        "tot": total})
    db.commit()
    return iid


def _seed_payment(db: Session, *, tenant_id, amount="500", provider="MPESA",
                  receipt_no=None, reference=None, invoice_ids=None,
                  received_at=None) -> str:
    pid = str(uuid4())
    if received_at is None:
        db.execute(sa.text(
            "INSERT INTO core.payments "
            "(id, tenant_id, provider, amount, receipt_no, reference) "
            "VALUES (:id, :tid, :prov, :amt, :rcpt, :ref)"
        ), {"id": pid, "tid": str(tenant_id), "prov": provider, "amt": amount,
            "rcpt": receipt_no, "ref": reference})
    else:
        db.execute(sa.text(
            "INSERT INTO core.payments "
            "(id, tenant_id, provider, amount, receipt_no, reference, received_at) "
            "VALUES (:id, :tid, :prov, :amt, :rcpt, :ref, :ra)"
        ), {"id": pid, "tid": str(tenant_id), "prov": provider, "amt": amount,
            "rcpt": receipt_no, "ref": reference, "ra": received_at})
    for inv_id in (invoice_ids or []):
        db.execute(sa.text(
            "INSERT INTO core.payment_allocations "
            "(id, payment_id, invoice_id, amount) "
            "VALUES (:id, :pid, :iid, :amt)"
        ), {"id": str(uuid4()), "pid": pid, "iid": inv_id, "amt": amount})
    db.commit()
    return pid


class TestPagination:
    def test_default_page_size_30(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        for _ in range(45):
            _seed_payment(db_session, tenant_id=tenant.id)
        r = client.get(ROUTE, headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert len(body["items"]) == 30
        assert body["meta"]["total"] == 45
        assert body["meta"]["pages"] == 2

    def test_page_sizes_50_and_100(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        for _ in range(120):
            _seed_payment(db_session, tenant_id=tenant.id)
        for size, expected_pages in ((50, 3), (100, 2)):
            r = client.get(f"{ROUTE}?page_size={size}", headers=headers)
            assert r.status_code == 200
            assert r.json()["meta"]["pages"] == expected_pages


class TestFilters:
    def test_search_by_receipt_no(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_payment(db_session, tenant_id=tenant.id, receipt_no="RCP-AAA")
        _seed_payment(db_session, tenant_id=tenant.id, receipt_no="RCP-BBB")
        r = client.get(f"{ROUTE}?q=aaa", headers=headers)
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["receipt_no"] == "RCP-AAA"

    def test_search_by_reference(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_payment(db_session, tenant_id=tenant.id, reference="MPX-99XYZ")
        _seed_payment(db_session, tenant_id=tenant.id, reference="MPX-11ABC")
        r = client.get(f"{ROUTE}?q=xyz", headers=headers)
        items = r.json()["items"]
        assert len(items) == 1
        assert "99XYZ" in items[0]["reference"]

    def test_search_by_student_name_via_allocation(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        sid = _seed_student(db_session, tenant_id=tenant.id,
                            first="Zawadi", last="Mwangi")
        eid = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid)
        iid = _seed_invoice(db_session, tenant_id=tenant.id,
                            enrollment_id=eid, no="INV-A")
        _seed_payment(db_session, tenant_id=tenant.id, receipt_no="RCP-1",
                      invoice_ids=[iid])
        # Foil: payment for a different student.
        sid2 = _seed_student(db_session, tenant_id=tenant.id,
                             first="John", last="Otieno")
        eid2 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=sid2)
        iid2 = _seed_invoice(db_session, tenant_id=tenant.id,
                             enrollment_id=eid2, no="INV-B")
        _seed_payment(db_session, tenant_id=tenant.id, receipt_no="RCP-2",
                      invoice_ids=[iid2])

        r = client.get(f"{ROUTE}?q=zawadi", headers=headers)
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["receipt_no"] == "RCP-1"
        assert "Zawadi" in items[0]["student_label"]

    def test_filter_by_provider(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        _seed_payment(db_session, tenant_id=tenant.id, provider="MPESA")
        _seed_payment(db_session, tenant_id=tenant.id, provider="CASH")
        r = client.get(f"{ROUTE}?provider=CASH", headers=headers)
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["provider"] == "CASH"

    def test_date_range_filter(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        today = date.today()
        old = (today - timedelta(days=10)).isoformat()
        new = today.isoformat()
        _seed_payment(db_session, tenant_id=tenant.id, receipt_no="OLD",
                      received_at=old)
        _seed_payment(db_session, tenant_id=tenant.id, receipt_no="NEW",
                      received_at=new)
        r = client.get(
            f"{ROUTE}?date_from={(today - timedelta(days=2)).isoformat()}",
            headers=headers,
        )
        rcpts = {i["receipt_no"] for i in r.json()["items"]}
        assert rcpts == {"NEW"}


class TestMultiStudentPayment:
    def test_family_payment_shows_all_students(
        self, client: TestClient, db_session: Session
    ):
        """A family payment covering two children in the same tenant should
        surface both names in student_label AND be findable via either child."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        s1 = _seed_student(db_session, tenant_id=tenant.id,
                           first="Kito", last="Owino")
        e1 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=s1)
        i1 = _seed_invoice(db_session, tenant_id=tenant.id,
                           enrollment_id=e1, no="INV-1")
        s2 = _seed_student(db_session, tenant_id=tenant.id,
                           first="Wema", last="Owino")
        e2 = _seed_enrollment(db_session, tenant_id=tenant.id, student_id=s2)
        i2 = _seed_invoice(db_session, tenant_id=tenant.id,
                           enrollment_id=e2, no="INV-2")
        _seed_payment(db_session, tenant_id=tenant.id, receipt_no="FAM-1",
                      invoice_ids=[i1, i2])

        r = client.get(f"{ROUTE}?q=wema", headers=headers)
        items = r.json()["items"]
        assert len(items) == 1
        assert "Kito" in items[0]["student_label"]
        assert "Wema" in items[0]["student_label"]


class TestSortAndIsolation:
    def test_sort_by_received_at_desc(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        for i in range(3):
            _seed_payment(
                db_session, tenant_id=tenant.id, receipt_no=f"P{i}",
                received_at=(now - timedelta(hours=i)).isoformat(),
            )
        rcpts = [i["receipt_no"] for i in client.get(ROUTE, headers=headers).json()["items"]]
        assert rcpts == ["P0", "P1", "P2"]

    def test_tenant_isolation(self, client: TestClient, db_session: Session):
        a = create_tenant(db_session, slug=f"ta-{uuid4().hex[:6]}",
                          domain=f"{uuid4().hex[:6]}.example.com")
        b = create_tenant(db_session, slug=f"tb-{uuid4().hex[:6]}",
                          domain=f"{uuid4().hex[:6]}.example.com")
        _, ha = make_actor(db_session, tenant=a, permissions=PERMS)
        _, hb = make_actor(db_session, tenant=b, permissions=PERMS)
        _seed_payment(db_session, tenant_id=a.id, receipt_no="A-1")
        rb = client.get(ROUTE, headers=hb)
        assert rb.json()["meta"]["total"] == 0


class TestRBAC:
    def test_requires_finance_payments_view(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        r = client.get(ROUTE, headers=headers)
        assert r.status_code == 403
