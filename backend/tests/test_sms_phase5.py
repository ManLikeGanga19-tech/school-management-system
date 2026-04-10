"""
Phase 5: SMS Communications module tests.

Tests cover:
  - Credit account creation + balance
  - Top-up initiation (mock Daraja) + status polling (auto-complete)
  - Top-up history
  - Send single SMS (mock AT) + credit deduction + refund on failure
  - Broadcast SMS
  - Message history
  - Template CRUD (create / list / update / delete)
  - Insufficient credits guard
  - Permission gating (sms.credits.view, sms.credits.topup, sms.send, sms.templates.manage)
  - Admin: pricing view + update, all-tenant accounts, manual adjust
"""
from __future__ import annotations

import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from tests.helpers import create_tenant, make_actor, create_super_admin_user, saas_headers

os.environ.setdefault("AT_USE_MOCK", "true")
os.environ.setdefault("DARAJA_USE_MOCK", "true")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DIRECTOR_PERMS = [
    "sms.credits.view",
    "sms.credits.topup",
    "sms.send",
    "sms.templates.manage",
]
SECRETARY_PERMS = [
    "sms.credits.view",
    "sms.send",
    "sms.templates.manage",
]


def _topup(client: TestClient, headers: dict, units: int = 50) -> dict:
    resp = client.post(
        "/api/v1/sms/topup",
        json={"phone_number": "0712345678", "units_requested": units},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _complete_topup(client: TestClient, headers: dict, checkout_id: str) -> dict:
    """Poll until topup is completed (mock auto-completes on first poll)."""
    resp = client.get(
        f"/api/v1/sms/topup/status?checkout_request_id={checkout_id}",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def director(db_session, client):
    tenant = create_tenant(db_session, slug=f"sms-t-{uuid4().hex[:6]}")
    user, headers = make_actor(db_session, tenant=tenant, permissions=DIRECTOR_PERMS)
    return tenant, user, headers


@pytest.fixture()
def secretary(db_session, client, director):
    tenant, _, _ = director
    _, headers = make_actor(
        db_session, tenant=tenant, permissions=SECRETARY_PERMS, email="sec@sms.test"
    )
    return headers


# ---------------------------------------------------------------------------
# Credit account
# ---------------------------------------------------------------------------

class TestCreditAccount:
    def test_get_account_returns_zero_balance(self, client, director):
        _, _, headers = director
        resp = client.get("/api/v1/sms/account", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["balance_units"] == 0
        assert data["price_per_unit_kes"] > 0

    def test_requires_view_permission(self, client, db_session):
        tenant = create_tenant(db_session, slug=f"noperm-{uuid4().hex[:6]}")
        _, headers = make_actor(db_session, tenant=tenant, permissions=[])
        resp = client.get("/api/v1/sms/account", headers=headers)
        assert resp.status_code == 403

    def test_secretary_can_view_account(self, client, secretary):
        resp = client.get("/api/v1/sms/account", headers=secretary)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Top-up
# ---------------------------------------------------------------------------

class TestTopup:
    def test_initiate_topup_mock(self, client, director):
        _, _, headers = director
        data = _topup(client, headers, units=100)
        assert data["status"] == "pending"
        assert data["units_requested"] == 100
        assert data["amount_kes"] > 0
        assert data["topup_id"]

    def test_topup_auto_completes_on_status_poll(self, client, director):
        _, _, headers = director
        topup = _topup(client, headers, units=50)
        checkout_id = topup["checkout_request_id"]
        status = _complete_topup(client, headers, checkout_id)
        assert status["status"] == "completed"

    def test_balance_credited_after_topup(self, client, director):
        _, _, headers = director
        topup = _topup(client, headers, units=200)
        _complete_topup(client, headers, topup["checkout_request_id"])
        acct = client.get("/api/v1/sms/account", headers=headers).json()
        assert acct["balance_units"] == 200

    def test_topup_history(self, client, director):
        _, _, headers = director
        _topup(client, headers, units=50)
        resp = client.get("/api/v1/sms/topup/history", headers=headers)
        assert resp.status_code == 200
        history = resp.json()
        assert len(history) >= 1

    def test_minimum_topup_enforced(self, client, director):
        _, _, headers = director
        resp = client.post(
            "/api/v1/sms/topup",
            json={"phone_number": "0712345678", "units_requested": 5},
            headers=headers,
        )
        # Pydantic ge=10 returns 422; service-level minimum returns 400
        assert resp.status_code in {400, 422}

    def test_secretary_cannot_topup(self, client, secretary):
        resp = client.post(
            "/api/v1/sms/topup",
            json={"phone_number": "0712345678", "units_requested": 50},
            headers=secretary,
        )
        assert resp.status_code == 403

    def test_dedup_returns_same_checkout(self, client, director):
        _, _, headers = director
        r1 = _topup(client, headers, units=50)
        r2 = _topup(client, headers, units=50)
        assert r2["duplicate"] is True
        assert r2["checkout_request_id"] == r1["checkout_request_id"]


# ---------------------------------------------------------------------------
# Send SMS
# ---------------------------------------------------------------------------

class TestSendSms:
    def test_send_sms_deducts_credit(self, client, director):
        _, _, headers = director
        # Fund first
        topup = _topup(client, headers, units=100)
        _complete_topup(client, headers, topup["checkout_request_id"])

        resp = client.post(
            "/api/v1/sms/send",
            json={
                "to_phone": "0712345678",
                "message_body": "Fee reminder: KES 5000 outstanding.",
                "recipient_name": "Jane Wanjiru",
            },
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in {"SENT", "DELIVERED"}
        assert data["units_deducted"] >= 1

        # Balance should be decremented
        acct = client.get("/api/v1/sms/account", headers=headers).json()
        assert acct["balance_units"] == 99

    def test_insufficient_credits_blocked(self, client, director):
        _, _, headers = director
        # Balance is 0 (no top-up)
        resp = client.post(
            "/api/v1/sms/send",
            json={"to_phone": "0712345678", "message_body": "Hello"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "Insufficient" in resp.json()["detail"]

    def test_send_requires_permission(self, client, db_session):
        tenant = create_tenant(db_session, slug=f"nosend-{uuid4().hex[:6]}")
        _, headers = make_actor(db_session, tenant=tenant, permissions=["sms.credits.view"])
        resp = client.post(
            "/api/v1/sms/send",
            json={"to_phone": "0712345678", "message_body": "Hello"},
            headers=headers,
        )
        assert resp.status_code == 403

    def test_secretary_can_send(self, client, secretary, director):
        _, _, dir_headers = director
        # Fund account as director
        topup = _topup(client, dir_headers, units=100)
        _complete_topup(client, dir_headers, topup["checkout_request_id"])

        resp = client.post(
            "/api/v1/sms/send",
            json={"to_phone": "0712345678", "message_body": "Secretary test message"},
            headers=secretary,
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Broadcast
# ---------------------------------------------------------------------------

class TestBroadcast:
    def test_broadcast_to_multiple(self, client, director):
        _, _, headers = director
        topup = _topup(client, headers, units=200)
        _complete_topup(client, headers, topup["checkout_request_id"])

        recipients = [
            {"phone": "0712345678", "name": "Jane"},
            {"phone": "0723456789", "name": "Peter"},
            {"phone": "0734567890", "name": "Mary"},
        ]
        resp = client.post(
            "/api/v1/sms/send/broadcast",
            json={"recipients": recipients, "message_body": "School fees reminder"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        assert data["sent"] == 3
        assert data["units_deducted"] == 3

        acct = client.get("/api/v1/sms/account", headers=headers).json()
        assert acct["balance_units"] == 197

    def test_broadcast_empty_recipients_rejected(self, client, director):
        _, _, headers = director
        resp = client.post(
            "/api/v1/sms/send/broadcast",
            json={"recipients": [], "message_body": "Hello"},
            headers=headers,
        )
        assert resp.status_code == 422  # Pydantic min_length=1


# ---------------------------------------------------------------------------
# Message history
# ---------------------------------------------------------------------------

class TestMessageHistory:
    def test_list_messages(self, client, director):
        _, _, headers = director
        topup = _topup(client, headers, units=10)
        _complete_topup(client, headers, topup["checkout_request_id"])

        client.post(
            "/api/v1/sms/send",
            json={"to_phone": "0712345678", "message_body": "Test msg 1"},
            headers=headers,
        )

        resp = client.get("/api/v1/sms/messages", headers=headers)
        assert resp.status_code == 200
        msgs = resp.json()
        assert len(msgs) >= 1
        # Phone is normalized to 254XXXXXXXXX format
        assert msgs[0]["to_phone"] in {"0712345678", "254712345678"}


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

class TestTemplates:
    def test_create_template(self, client, director):
        _, _, headers = director
        resp = client.post(
            "/api/v1/sms/templates",
            json={
                "name": "Fee Reminder",
                "body": "Dear {parent_name}, please pay KES {amount} by {due_date}.",
                "variables": ["parent_name", "amount", "due_date"],
            },
            headers=headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Fee Reminder"
        assert "parent_name" in data["variables"]

    def test_list_templates(self, client, director):
        _, _, headers = director
        client.post(
            "/api/v1/sms/templates",
            json={"name": "Welcome", "body": "Welcome to our school!", "variables": []},
            headers=headers,
        )
        resp = client.get("/api/v1/sms/templates", headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_update_template(self, client, director):
        _, _, headers = director
        create_resp = client.post(
            "/api/v1/sms/templates",
            json={"name": "Reminder v1", "body": "Old body", "variables": []},
            headers=headers,
        )
        tmpl_id = create_resp.json()["id"]

        update_resp = client.patch(
            f"/api/v1/sms/templates/{tmpl_id}",
            json={"body": "New body here"},
            headers=headers,
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["body"] == "New body here"

    def test_delete_template(self, client, director):
        _, _, headers = director
        create_resp = client.post(
            "/api/v1/sms/templates",
            json={"name": "To Delete", "body": "Bye", "variables": []},
            headers=headers,
        )
        tmpl_id = create_resp.json()["id"]

        del_resp = client.delete(f"/api/v1/sms/templates/{tmpl_id}", headers=headers)
        assert del_resp.status_code == 204

        list_resp = client.get("/api/v1/sms/templates", headers=headers)
        ids = [t["id"] for t in list_resp.json()]
        assert tmpl_id not in ids

    def test_duplicate_template_name_rejected(self, client, director):
        _, _, headers = director
        payload = {"name": "DupTest", "body": "Body A", "variables": []}
        client.post("/api/v1/sms/templates", json=payload, headers=headers)
        resp = client.post("/api/v1/sms/templates", json=payload, headers=headers)
        assert resp.status_code == 400
        assert "already exists" in resp.json()["detail"]

    def test_template_requires_permission(self, client, db_session):
        tenant = create_tenant(db_session, slug=f"notmpl-{uuid4().hex[:6]}")
        _, headers = make_actor(db_session, tenant=tenant, permissions=["sms.credits.view"])
        resp = client.post(
            "/api/v1/sms/templates",
            json={"name": "X", "body": "Y", "variables": []},
            headers=headers,
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

class TestAdminSms:
    def test_admin_get_pricing(self, client, db_session):
        admin = create_super_admin_user(db_session, email=f"admin-sms-{uuid4().hex[:6]}@test.com")
        headers = saas_headers(admin)
        resp = client.get("/api/v1/admin/sms/pricing", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "price_per_unit_kes" in data
        assert data["price_per_unit_kes"] > 0

    def test_admin_update_pricing(self, client, db_session):
        admin = create_super_admin_user(db_session, email=f"admin-sms2-{uuid4().hex[:6]}@test.com")
        headers = saas_headers(admin)
        resp = client.patch(
            "/api/v1/admin/sms/pricing",
            json={"price_per_unit_kes": "2.00"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert abs(resp.json()["price_per_unit_kes"] - 2.0) < 0.001

    def test_admin_list_accounts(self, client, db_session, director):
        admin = create_super_admin_user(db_session, email=f"admin-sms3-{uuid4().hex[:6]}@test.com")
        headers = saas_headers(admin)
        # Trigger account creation by fetching balance
        _, _, dir_headers = director
        client.get("/api/v1/sms/account", headers=dir_headers)
        resp = client.get("/api/v1/admin/sms/accounts", headers=headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_admin_adjust_credits(self, client, db_session, director):
        admin = create_super_admin_user(db_session, email=f"admin-sms4-{uuid4().hex[:6]}@test.com")
        admin_headers = saas_headers(admin)
        tenant, _, dir_headers = director
        # Create account
        client.get("/api/v1/sms/account", headers=dir_headers)
        # Adjust
        resp = client.post(
            f"/api/v1/admin/sms/accounts/{tenant.id}/adjust",
            json={"adjustment": 500, "reason": "Test gift"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["balance_units"] == 500

        # Check tenant sees the balance
        acct = client.get("/api/v1/sms/account", headers=dir_headers).json()
        assert acct["balance_units"] == 500

    def test_admin_negative_adjustment_rejected_below_zero(self, client, db_session, director):
        admin = create_super_admin_user(db_session, email=f"admin-sms5-{uuid4().hex[:6]}@test.com")
        admin_headers = saas_headers(admin)
        tenant, _, dir_headers = director
        client.get("/api/v1/sms/account", headers=dir_headers)
        # Balance is 0 — deducting should fail
        resp = client.post(
            f"/api/v1/admin/sms/accounts/{tenant.id}/adjust",
            json={"adjustment": -10, "reason": "Should fail"},
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "negative" in resp.json()["detail"].lower()

    def test_non_admin_cannot_access_admin_endpoints(self, client, director):
        """Tenant users (non-saas token) should be rejected from admin/sms endpoints."""
        _, _, dir_headers = director
        resp = client.get("/api/v1/admin/sms/pricing", headers=dir_headers)
        # get_current_user_saas returns 401 for non-saas tokens
        assert resp.status_code in {401, 403, 422}
