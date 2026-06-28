"""Tests for the tenant terms endpoints, focused on the structured
identity columns (term_number + academic_year) added in migration
t1y2n3r4y5z6.

Locks down:
  - Create accepts the two fields and persists them.
  - Create without them persists as NULL (backwards-compat).
  - Update can fill in NULL values on a legacy row.
  - GET round-trips both fields.
  - Pydantic validation rejects out-of-range values.
  - is_current resolution is unaffected by the new columns.
"""
from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from tests.helpers import create_tenant, make_actor


BASE = "/api/v1/tenants/terms"
PERMS = ["admin.dashboard.view_tenant"]


def _post(client, headers, body):
    return client.post(BASE, json=body, headers=headers)


def _put(client, headers, term_id, body):
    return client.put(f"{BASE}/{term_id}", json=body, headers=headers)


def _get(client, headers, *, include_inactive: bool = False):
    qs = "?include_inactive=true" if include_inactive else ""
    return client.get(f"{BASE}{qs}", headers=headers)


# ────────────────────────────────────────────────────────────────────────────
# Create
# ────────────────────────────────────────────────────────────────────────────

class TestCreateWithStructuredIdentity:
    def test_create_persists_term_number_and_academic_year(
        self, client: TestClient, db_session: Session
    ):
        slug = f"trm-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        resp = _post(client, headers, {
            "code": "T1-2026",
            "name": "Term 1 (2026)",
            "term_number": 1,
            "academic_year": 2026,
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["term_number"] == 1
        assert body["academic_year"] == 2026

        # DB row matches.
        row = db_session.execute(
            text(
                "SELECT term_number, academic_year FROM core.tenant_terms "
                "WHERE id = :id"
            ),
            {"id": body["id"]},
        ).mappings().first()
        assert row["term_number"] == 1
        assert row["academic_year"] == 2026

    def test_create_without_structured_fields_persists_null(
        self, client: TestClient, db_session: Session
    ):
        slug = f"trm2-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        resp = _post(client, headers, {"code": "LEGACY-1", "name": "Legacy term"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["term_number"] is None
        assert body["academic_year"] is None

    def test_term_number_out_of_range_rejected(
        self, client: TestClient, db_session: Session
    ):
        """term_number must be 1, 2, or 3 (Pydantic ge=1 le=3)."""
        slug = f"trm3-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        resp_zero = _post(client, headers, {
            "code": "T0-2026", "name": "Term 0",
            "term_number": 0, "academic_year": 2026,
        })
        assert resp_zero.status_code == 422

        resp_four = _post(client, headers, {
            "code": "T4-2026", "name": "Term 4",
            "term_number": 4, "academic_year": 2026,
        })
        assert resp_four.status_code == 422

    def test_academic_year_out_of_range_rejected(
        self, client: TestClient, db_session: Session
    ):
        """academic_year must be 2000..2199."""
        slug = f"trm4-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        resp_old = _post(client, headers, {
            "code": "T1-1999", "name": "Term 1",
            "term_number": 1, "academic_year": 1999,
        })
        assert resp_old.status_code == 422

        resp_future = _post(client, headers, {
            "code": "T1-2300", "name": "Term 1",
            "term_number": 1, "academic_year": 2300,
        })
        assert resp_future.status_code == 422


# ────────────────────────────────────────────────────────────────────────────
# Update (filling in legacy NULL rows)
# ────────────────────────────────────────────────────────────────────────────

class TestUpdateStructuredIdentity:
    def test_update_can_fill_null_values(
        self, client: TestClient, db_session: Session
    ):
        """The 'fix un-inferred term' path: a row created (or backfilled) with
        NULL term_number/academic_year can be filled in via PUT."""
        slug = f"trm5-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        created = _post(client, headers, {"code": "LEGACY-2", "name": "Legacy"}).json()
        assert created["term_number"] is None

        resp = _put(client, headers, created["id"], {
            "term_number": 2, "academic_year": 2027,
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["term_number"] == 2
        assert body["academic_year"] == 2027

    def test_update_term_number_out_of_range_rejected(
        self, client: TestClient, db_session: Session
    ):
        slug = f"trm6-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        created = _post(client, headers, {"code": "T1-2026", "name": "Term 1"}).json()
        resp = _put(client, headers, created["id"], {"term_number": 9})
        assert resp.status_code == 422

    def test_update_academic_year_out_of_range_rejected(
        self, client: TestClient, db_session: Session
    ):
        slug = f"trm7-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        created = _post(client, headers, {"code": "T1-2026", "name": "Term 1"}).json()
        resp = _put(client, headers, created["id"], {"academic_year": 1500})
        assert resp.status_code == 422


# ────────────────────────────────────────────────────────────────────────────
# GET round-trip + is_current resolution
# ────────────────────────────────────────────────────────────────────────────

class TestListEndpointShape:
    def test_get_echoes_structured_fields(
        self, client: TestClient, db_session: Session
    ):
        slug = f"trm8-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        _post(client, headers, {
            "code": "T1-2026", "name": "Term 1 2026",
            "term_number": 1, "academic_year": 2026,
        })
        _post(client, headers, {
            "code": "T2-2026", "name": "Term 2 2026",
            "term_number": 2, "academic_year": 2026,
        })

        listing = _get(client, headers).json()
        assert len(listing) == 2
        by_code = {t["code"]: t for t in listing}
        assert by_code["T1-2026"]["term_number"] == 1
        assert by_code["T1-2026"]["academic_year"] == 2026
        assert by_code["T2-2026"]["term_number"] == 2

    def test_get_is_current_unaffected_by_new_columns(
        self, client: TestClient, db_session: Session
    ):
        """is_current is computed from start_date/end_date vs today and must
        not change behaviour when term_number/academic_year are set."""
        slug = f"trm9-{uuid4().hex[:6]}"
        tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
        _, headers = make_actor(db_session, tenant=tenant, permissions=PERMS)

        today = date.today()
        # Past, current, future windows.
        _post(client, headers, {
            "code": "PAST", "name": "Past",
            "start_date": (today - timedelta(days=60)).isoformat(),
            "end_date": (today - timedelta(days=30)).isoformat(),
            "term_number": 1, "academic_year": today.year - 1,
        })
        current_id = _post(client, headers, {
            "code": "NOW", "name": "Now",
            "start_date": (today - timedelta(days=5)).isoformat(),
            "end_date": (today + timedelta(days=25)).isoformat(),
            "term_number": 2, "academic_year": today.year,
        }).json()["id"]
        _post(client, headers, {
            "code": "FUTURE", "name": "Future",
            "start_date": (today + timedelta(days=60)).isoformat(),
            "end_date": (today + timedelta(days=90)).isoformat(),
            "term_number": 3, "academic_year": today.year,
        })

        listing = _get(client, headers).json()
        currents = [t for t in listing if t["is_current"]]
        assert len(currents) == 1
        assert currents[0]["id"] == current_id


# ────────────────────────────────────────────────────────────────────────────
# Migration backfill — sanity-check the regex worked on the seed test rows
# ────────────────────────────────────────────────────────────────────────────

class TestMigrationBackfillSanity:
    def test_backfill_inferred_seed_rows(self, db_session: Session):
        """Whatever the seed dataset has, every row whose name carries a
        recognizable 'Term N <YYYY>' shape should have the structured fields
        populated by the migration's regex backfill. This guards against the
        migration regression — if someone later changes the regex without
        running the backfill, the seed rows will start to show NULLs."""
        rows = db_session.execute(
            text(
                "SELECT code, name, term_number, academic_year "
                "FROM core.tenant_terms "
                "WHERE name ~* '\\yterm[ _-]*[1-3]\\y' "
                "  AND name ~ '\\y(2[01]\\d{2})\\y'"
            )
        ).mappings().all()
        # Any row whose human name visibly carries 'Term N' + a 4-digit
        # 20XX-21XX year must have both fields backfilled. NULL here means
        # the migration silently skipped it.
        for r in rows:
            assert r["term_number"] is not None, f"unparsed term_number for {r['name']!r}"
            assert r["academic_year"] is not None, f"unparsed academic_year for {r['name']!r}"
