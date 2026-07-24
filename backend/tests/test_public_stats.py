"""Public marketing stats endpoint — aggregate counts only, no auth, no PII.

The marketing site reads these live so its numbers can never drift from reality
(it previously hardcoded fabricated '40+ schools / 12k+ students').
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import create_tenant

STATS = "/api/v1/public/stats"


class TestPublicStats:
    def test_reachable_without_auth_or_tenant(self, client: TestClient):
        # No Authorization header, no X-Tenant-ID — must still succeed.
        r = client.get(STATS)
        assert r.status_code == 200

    def test_shape_and_types(self, client: TestClient):
        body = client.get(STATS).json()
        assert set(body.keys()) == {"schools_active", "students_total"}
        assert isinstance(body["schools_active"], int)
        assert isinstance(body["students_total"], int)

    def test_no_pii_leaks(self, client: TestClient, db_session: Session):
        # Counts only — never names, emails, or tenant identifiers.
        create_tenant(db_session, slug="stats-probe", name="Stats Probe School")
        body = client.get(STATS).json()
        blob = str(body).lower()
        assert "stats probe" not in blob
        assert "@" not in blob
