"""Phase Y — public document verification (the receipt scanner backend).

The scanner + /v/{code} page + legacy landing page all call these:
    GET /public/verify/{code}            — current opaque-code flavor
    GET /public/verify/receipt?token&slug — legacy JWT flavor

Production bug fixed alongside: the frontend surfaces were fetching the
frontend host instead of the API host, so every genuine document looked
"forged" without ever being checked. These tests pin the backend
contract those surfaces now correctly reach.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.payment import Payment
from tests.helpers import create_tenant, make_actor


PAY_PERMS = ["finance.payments.manage", "finance.payments.view"]


def _seed_paid_receipt(client: TestClient, db: Session, tenant) -> Payment:
    """Create a real payment through the waterfall so it carries a
    receipt_no; verify_code is lazily assigned by the document builder."""
    _, headers = make_actor(db, tenant=tenant, permissions=PAY_PERMS)
    sid, eid = str(uuid4()), str(uuid4())
    db.execute(text(
        "INSERT INTO core.students (id, tenant_id, admission_no, first_name, last_name, status, admission_year) "
        "VALUES (:id, :tid, :adm, 'Verify', 'Me', 'ACTIVE', 2026)"
    ), {"id": sid, "tid": str(tenant.id), "adm": f"V-{uuid4().hex[:6].upper()}"})
    db.execute(text(
        "INSERT INTO core.enrollments (id, tenant_id, student_id, status, payload) "
        "VALUES (:id, :tid, :sid, 'ENROLLED', CAST(:pl AS jsonb))"
    ), {"id": eid, "tid": str(tenant.id), "sid": sid,
        "pl": '{"student_name": "Verify Me", "class_code": "GRADE_1"}'})
    db.commit()
    r = client.post(
        f"/api/v1/finance/students/{sid}/payments",
        headers=headers,
        json={"amount": "1500", "provider": "CASH"},
    )
    assert r.status_code == 200, r.text
    payment = db.get(Payment, r.json()["payment_id"])
    db.refresh(payment)
    return payment


class TestPublicVerify:
    def test_valid_code_verifies_receipt(
        self, client: TestClient, db_session: Session,
    ):
        tenant = create_tenant(db_session)
        payment = _seed_paid_receipt(client, db_session, tenant)
        # The document builder lazily assigns verify_code — trigger it the
        # same way a print does.
        from app.api.v1.finance import service
        doc = service.build_payment_receipt_document(
            db_session, tenant_id=tenant.id, payment_id=payment.id,
        )
        db_session.commit()
        code = doc["verify_code"]
        assert code

        r = client.get(f"/api/v1/public/verify/{code}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["valid"] is True
        assert body["document_type"] == "RECEIPT"
        assert body["document_no"] == doc["document_no"]
        assert "genuine" in body["message"].lower()

    def test_unknown_code_404(self, client: TestClient, db_session: Session):
        r = client.get("/api/v1/public/verify/definitely-not-real-1")
        assert r.status_code == 404

    def test_overlong_code_400(self, client: TestClient, db_session: Session):
        r = client.get(f"/api/v1/public/verify/{'x' * 40}")
        assert r.status_code == 400

    def test_legacy_token_flavor_rejects_garbage(
        self, client: TestClient, db_session: Session,
    ):
        """The legacy endpoint must reject a tampered token with a clear
        400, not crash — this is what old printed receipts hit."""
        tenant = create_tenant(db_session)
        r = client.get(
            f"/api/v1/public/verify/receipt?token=not-a-jwt&slug={tenant.slug}"
        )
        assert r.status_code == 400
        assert "tampered" in r.json()["detail"].lower() or "invalid" in r.json()["detail"].lower()
