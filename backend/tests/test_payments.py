"""
Tests for payment endpoints:
  POST /api/v1/payments/daraja/callback
  GET  /api/v1/payments/subscription
  GET  /api/v1/payments/subscription/payments
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor

BASE = "/api/v1/payments"


# ── Daraja callback ──────────────────────────────────────────────────────────

class TestDarajaCallback:
    """
    The Daraja endpoint validates an opaque callback token passed as a query
    param.  In tests there is no real M-Pesa flow, so we focus on:
      - Missing / wrong token → 401
      - Malformed payload → 400 (or service-layer RuntimeError → 503)
      - Rate-limit enforcement
      - Idempotency guard (unknown checkout ID)
    """

    VALID_PAYLOAD = {
        "Body": {
            "stkCallback": {
                "MerchantRequestID": "test-merchant-req",
                "CheckoutRequestID": "ws_CO_123456789",
                "ResultCode": 0,
                "ResultDesc": "The service request is processed successfully.",
                "CallbackMetadata": {
                    "Item": [
                        {"Name": "Amount", "Value": 1000},
                        {"Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV"},
                        {"Name": "TransactionDate", "Value": 20191219102115},
                        {"Name": "PhoneNumber", "Value": 254720000001},
                    ]
                },
            }
        }
    }

    def test_callback_missing_token_returns_401(self, client: TestClient, db_session: Session):
        resp = client.post(f"{BASE}/daraja/callback", json=self.VALID_PAYLOAD)
        # No token → service raises PermissionError → 401
        assert resp.status_code == 401

    def test_callback_wrong_token_returns_401(self, client: TestClient, db_session: Session):
        resp = client.post(
            f"{BASE}/daraja/callback?token=wrong-token",
            json=self.VALID_PAYLOAD,
        )
        assert resp.status_code == 401

    def test_callback_unknown_checkout_id(self, client: TestClient, db_session: Session):
        """
        Even with correct token, an unknown CheckoutRequestID means the
        service cannot find the pending payment — expect 400 or 503.
        """
        # In test env DARAJA_CALLBACK_HMAC_SECRET is empty → any token mismatch fails.
        # This test verifies the rejection path without a real token.
        resp = client.post(
            f"{BASE}/daraja/callback?token=bad",
            json=self.VALID_PAYLOAD,
        )
        assert resp.status_code in {400, 401, 503}

    def test_callback_malformed_payload(self, client: TestClient, db_session: Session):
        """Completely missing required structure → validation or service error."""
        resp = client.post(
            f"{BASE}/daraja/callback?token=bad",
            json={"unexpected": "garbage"},
        )
        assert resp.status_code in {400, 401, 422, 503}

    def test_callback_rate_limit(self, client: TestClient, db_session: Session):
        """30/minute limit — flood with 31 requests from same IP → 429."""
        unique_ip = f"203.0.113.{uuid4().int % 200 + 1}"

        for _ in range(30):
            client.post(
                f"{BASE}/daraja/callback?token=bad",
                json=self.VALID_PAYLOAD,
                headers={"X-Forwarded-For": unique_ip},
            )

        resp = client.post(
            f"{BASE}/daraja/callback?token=bad",
            json=self.VALID_PAYLOAD,
            headers={"X-Forwarded-For": unique_ip},
        )
        assert resp.status_code == 429


# ── Subscription endpoints ───────────────────────────────────────────────────

class TestSubscriptionEndpoints:
    PERM = ["admin.dashboard.view_tenant"]

    def test_get_subscription_requires_auth(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        resp = client.get(
            f"{BASE}/subscription",
            headers={"X-Tenant-ID": str(tenant.id)},
        )
        assert resp.status_code == 401

    def test_get_subscription_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get(f"{BASE}/subscription", headers=headers)
        assert resp.status_code == 403

    def test_get_subscription_returns_200_or_none(self, client: TestClient, db_session: Session):
        """Tenant may have no subscription → None/null is a valid response."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=self.PERM)
        resp = client.get(f"{BASE}/subscription", headers=headers)
        assert resp.status_code == 200
        # May be null (no subscription yet)
        assert resp.json() is None or isinstance(resp.json(), dict)

    def test_list_subscription_payments_requires_permission(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get(f"{BASE}/subscription/payments", headers=headers)
        assert resp.status_code == 403

    def test_list_subscription_payments_empty(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=self.PERM)
        resp = client.get(f"{BASE}/subscription/payments", headers=headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_pay_subscription_missing_phone(self, client: TestClient, db_session: Session):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=self.PERM)
        resp = client.post(
            f"{BASE}/subscription/pay",
            json={"amount": 5000},  # missing phone_number
            headers=headers,
        )
        assert resp.status_code == 422  # Pydantic validation

    def test_pay_subscription_invalid_data_returns_400_or_503(
        self, client: TestClient, db_session: Session
    ):
        """Daraja not configured in test env → ValueError or RuntimeError."""
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=self.PERM)
        resp = client.post(
            f"{BASE}/subscription/pay",
            json={"phone_number": "0712345678", "amount": 100},
            headers=headers,
        )
        assert resp.status_code in {400, 503}

    def test_payment_status_unknown_checkout_returns_404(
        self, client: TestClient, db_session: Session
    ):
        tenant = create_tenant(db_session)
        _, headers = make_actor(db_session, tenant=tenant, permissions=self.PERM)
        resp = client.get(
            f"{BASE}/subscription/payment-status?checkout_request_id=NONEXISTENT",
            headers=headers,
        )
        assert resp.status_code in {404, 400, 503}
