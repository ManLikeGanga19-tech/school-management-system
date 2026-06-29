"""Tests for the bulk fees-invoice flow (Phase D).

  POST /api/v1/finance/invoices/generate/fees/bulk
  POST /api/v1/finance/invoices/publish/bulk

Coverage focus:
  • dry-run is consequence-free (no rows persist).
  • per-student outcomes — created/skipped/failed — surface the right
    reason codes the UI uses to render chips.
  • idempotency: running bulk-generate twice does NOT double-bill — the
    second run reports already_invoiced (skipped) instead of creating new
    rows.
  • per-row failure (no class, no structure) doesn't poison the batch.
  • class_code filter narrows results correctly.
  • tenant isolation — bulk gen in tenant B does not see tenant A's data.
  • bulk publish only flips DRAFTs; non-DRAFT and not-found are skipped
    cleanly; per-row publish failures don't sink the rest.

Plus an audit-trail check and a regression guard that the resolver tag
(student_type_resolved_by) lands on every created row.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.enrollment import Enrollment
from app.models.invoice import Invoice
from app.models.student import Student
from tests.helpers import create_tenant, make_actor

# Re-use the v2 setup helpers so each test mirrors a realistic intake +
# structure topology rather than seeding rows by hand.
from tests.test_finance_v2 import (
    ALL_FINANCE,
    ENROLLMENT_MANAGE,
    _link_student_admission_year,
    _make_enrolled_student,
    _setup_full_structure,
)


BASE = "/api/v1/finance"


def _make_actor_with_perms(db_session: Session, *, slug_prefix: str):
    slug = f"{slug_prefix}-{uuid4().hex[:6]}"
    tenant = create_tenant(db_session, slug=slug, domain=f"{slug}.example.com")
    _, headers = make_actor(
        db_session, tenant=tenant,
        permissions=ALL_FINANCE + ENROLLMENT_MANAGE,
    )
    return tenant, headers


def _truly_enroll(
    client, headers, *, class_code: str = "GRADE_1",
) -> str:
    """Walk the full lifecycle to ENROLLED. The shared _make_enrolled_student
    helper omits the assessment_no / nemis_no fields that mark_enrolled
    requires, so the /enroll step silently 400s and the row stays APPROVED
    — invisible to the bulk iterator. This helper supplies them."""
    enr = client.post(
        "/api/v1/enrollments/",
        json={
            "payload": {
                "student_name": "Bulk Student",
                "class_code": class_code,
                "assessment_no": f"AS-{uuid4().hex[:6].upper()}",
                "nemis_no": f"NM-{uuid4().hex[:6].upper()}",
                "enrollment_source": "NEW_STUDENT_INTAKE",
            }
        },
        headers=headers,
    )
    assert enr.status_code in (200, 201), enr.text
    eid = enr.json()["id"]
    assert client.post(f"/api/v1/enrollments/{eid}/submit", headers=headers).status_code == 200
    assert client.post(f"/api/v1/enrollments/{eid}/approve", headers=headers).status_code == 200
    enroll_resp = client.post(f"/api/v1/enrollments/{eid}/enroll", json={}, headers=headers)
    assert enroll_resp.status_code == 200, enroll_resp.text
    assert enroll_resp.json()["status"] in ("ENROLLED", "ENROLLED_PARTIAL")
    return eid


def _enroll_with_admission_year(
    client, headers, db_session, *, class_code: str, admission_year: int,
) -> str:
    """Enrol a student fully (status=ENROLLED) and seed admission_year on
    the SIS row so the student-type resolver produces deterministic output."""
    eid = _truly_enroll(client, headers, class_code=class_code)
    _link_student_admission_year(
        db_session, tenant_id=headers["X-Tenant-ID"],
        enrollment_id=eid, admission_year=admission_year,
    )
    return eid


def _bulk(client, headers, **body):
    return client.post(
        f"{BASE}/invoices/generate/fees/bulk", json=body, headers=headers,
    )


def _bulk_publish(client, headers, invoice_ids: list[str]):
    return client.post(
        f"{BASE}/invoices/publish/bulk",
        json={"invoice_ids": invoice_ids},
        headers=headers,
    )


# ────────────────────────────────────────────────────────────────────────────
# Bulk generate
# ────────────────────────────────────────────────────────────────────────────

class TestBulkGenerate:
    def test_generates_drafts_for_whole_class(
        self, client: TestClient, db_session: Session
    ):
        """Three enrolled students in GRADE_1 → three DRAFT invoices in one
        call, all bearing the resolver's student_type_resolved_by tag."""
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bulk1")
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        for _ in range(3):
            _enroll_with_admission_year(
                client, headers, db_session,
                class_code="GRADE_1", admission_year=2025,
            )

        resp = _bulk(
            client, headers,
            term_number=1, academic_year=2026, class_code="GRADE_1",
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["summary"]["created"] == 3
        assert body["summary"]["skipped"] == 0
        assert body["summary"]["failed"] == 0
        assert body["summary"]["dry_run"] is False

        # Every created row carries the resolver tag.
        for row in body["created"]:
            assert row["student_type_resolved_by"] in (
                "first_intake", "year_math", "prior_invoice",
                "source_override", "force_override",
            )
            assert Decimal(row["total_amount"]) > 0
            assert row["invoice_id"]

        # Confirmed DB-side: 3 DRAFT invoices persisted.
        rows = db_session.execute(
            text(
                "SELECT status, COUNT(*) AS n FROM core.invoices "
                "WHERE tenant_id = :tid AND invoice_type = 'SCHOOL_FEES' "
                "GROUP BY status"
            ),
            {"tid": str(tenant.id)},
        ).mappings().all()
        by_status = {r["status"]: r["n"] for r in rows}
        assert by_status.get("DRAFT") == 3

    def test_dry_run_is_consequence_free(
        self, client: TestClient, db_session: Session
    ):
        """dry_run=true returns the same outcome list but persists nothing."""
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bulkdry")
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        for _ in range(2):
            _enroll_with_admission_year(
                client, headers, db_session,
                class_code="GRADE_1", admission_year=2025,
            )

        # Snapshot the invoice count before the dry-run.
        n_before = db_session.execute(
            text("SELECT COUNT(*) FROM core.invoices WHERE tenant_id = :tid"),
            {"tid": str(tenant.id)},
        ).scalar_one()

        resp = _bulk(
            client, headers,
            term_number=1, academic_year=2026, class_code="GRADE_1",
            dry_run=True,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["summary"]["dry_run"] is True
        assert body["summary"]["created"] == 2  # outcome list shows them

        # ...but nothing persisted.
        n_after = db_session.execute(
            text("SELECT COUNT(*) FROM core.invoices WHERE tenant_id = :tid"),
            {"tid": str(tenant.id)},
        ).scalar_one()
        assert n_after == n_before

    def test_idempotency_second_run_skips_already_invoiced(
        self, client: TestClient, db_session: Session
    ):
        """Running bulk-generate twice for the same term must NOT double-bill;
        the second run reports already_invoiced for every row."""
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bulkidem")
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        for _ in range(2):
            _enroll_with_admission_year(
                client, headers, db_session,
                class_code="GRADE_1", admission_year=2025,
            )

        r1 = _bulk(client, headers, term_number=1, academic_year=2026, class_code="GRADE_1")
        assert r1.status_code == 200
        assert r1.json()["summary"]["created"] == 2

        # Second run — every student already has Term 1 2026.
        r2 = _bulk(client, headers, term_number=1, academic_year=2026, class_code="GRADE_1")
        assert r2.status_code == 200
        body = r2.json()
        assert body["summary"]["created"] == 0
        assert body["summary"]["skipped"] == 2
        for row in body["skipped"]:
            assert row["reason"] == "already_invoiced"
            assert row["existing_invoice_id"]

        # Still 2 invoices total — no duplicates.
        total = db_session.execute(
            text(
                "SELECT COUNT(*) FROM core.invoices "
                "WHERE tenant_id = :tid AND invoice_type = 'SCHOOL_FEES'"
            ),
            {"tid": str(tenant.id)},
        ).scalar_one()
        assert total == 2

    def test_per_row_failure_does_not_abort_batch(
        self, client: TestClient, db_session: Session
    ):
        """A student whose class has no fee structure must be reported in
        'failed' with reason='no_structure'; the other students in the same
        batch must still be created."""
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bulkfail")
        # Structure for GRADE_1 only.
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        # Two students in GRADE_1 (will succeed) + one in GRADE_2 (will fail).
        for _ in range(2):
            _enroll_with_admission_year(
                client, headers, db_session,
                class_code="GRADE_1", admission_year=2025,
            )
        _enroll_with_admission_year(
            client, headers, db_session,
            class_code="GRADE_2", admission_year=2025,
        )

        # No class filter — sweeps everything.
        resp = _bulk(client, headers, term_number=1, academic_year=2026)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["summary"]["created"] == 2
        assert body["summary"]["failed"] == 1
        failed = body["failed"][0]
        assert failed["reason"] == "no_structure"
        assert failed["class_code"] == "GRADE_2"

    def test_no_class_failure_reason(
        self, client: TestClient, db_session: Session
    ):
        """An enrollment whose payload has no class_code → reason='no_class'."""
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bulknocls")
        # No structures set up at all (the failure is at class resolution
        # before structure lookup).
        # Manually insert an ENROLLED enrollment with no class_code.
        eid = str(uuid4())
        sid = str(uuid4())
        db_session.execute(
            text(
                "INSERT INTO core.students (id, tenant_id, admission_no, "
                "first_name, last_name, status, admission_year) "
                "VALUES (:id, :tid, :adm, 'Anon', 'Student', 'ACTIVE', 2025)"
            ),
            {"id": sid, "tid": str(tenant.id), "adm": f"ADM-{uuid4().hex[:6].upper()}"},
        )
        db_session.execute(
            text(
                "INSERT INTO core.enrollments "
                "(id, tenant_id, student_id, status, payload) "
                "VALUES (:id, :tid, :sid, 'ENROLLED', CAST('{}' AS jsonb))"
            ),
            {"id": eid, "tid": str(tenant.id), "sid": sid},
        )
        db_session.commit()

        resp = _bulk(client, headers, term_number=1, academic_year=2026)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["summary"]["failed"] == 1
        assert body["failed"][0]["reason"] == "no_class"

    def test_class_code_filter_narrows_batch(
        self, client: TestClient, db_session: Session
    ):
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bulkfilt")
        for code in ("GRADE_1", "GRADE_2"):
            _setup_full_structure(
                client, headers, class_code=code,
                academic_year=2026, student_type="RETURNING",
            )
        _enroll_with_admission_year(
            client, headers, db_session, class_code="GRADE_1", admission_year=2025,
        )
        _enroll_with_admission_year(
            client, headers, db_session, class_code="GRADE_1", admission_year=2025,
        )
        _enroll_with_admission_year(
            client, headers, db_session, class_code="GRADE_2", admission_year=2025,
        )

        resp = _bulk(
            client, headers,
            term_number=1, academic_year=2026, class_code="GRADE_2",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"]["total"] == 1
        assert body["summary"]["created"] == 1
        assert body["created"][0]["class_code"] == "GRADE_2"

    def test_unenrolled_statuses_are_excluded(
        self, client: TestClient, db_session: Session
    ):
        """Only ENROLLED / ENROLLED_PARTIAL are eligible. DRAFT / SUBMITTED /
        TRANSFERRED enrollments must be skipped silently — they don't show
        up in any outcome bucket."""
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bulkstat")
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        # One real enrolled student.
        _enroll_with_admission_year(
            client, headers, db_session, class_code="GRADE_1", admission_year=2025,
        )
        # And a stray TRANSFERRED enrollment in the same class — it must NOT
        # appear in any bucket.
        db_session.execute(
            text(
                "INSERT INTO core.enrollments "
                "(id, tenant_id, status, payload) "
                "VALUES (:id, :tid, 'TRANSFERRED', "
                "        CAST('{\"class_code\":\"GRADE_1\"}' AS jsonb))"
            ),
            {"id": str(uuid4()), "tid": str(tenant.id)},
        )
        db_session.commit()

        resp = _bulk(
            client, headers,
            term_number=1, academic_year=2026, class_code="GRADE_1",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"]["total"] == 1
        assert body["summary"]["created"] == 1
        assert body["summary"]["skipped"] == 0
        assert body["summary"]["failed"] == 0

    def test_bulk_generate_emits_audit_event(
        self, client: TestClient, db_session: Session
    ):
        from app.models.audit_log import AuditLog
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bulkaud")
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        _enroll_with_admission_year(
            client, headers, db_session, class_code="GRADE_1", admission_year=2025,
        )

        resp = _bulk(client, headers, term_number=1, academic_year=2026)
        assert resp.status_code == 200

        audit = db_session.execute(
            select(AuditLog)
            .where(AuditLog.tenant_id == tenant.id,
                   AuditLog.action == "invoice.bulk_generate")
            .order_by(AuditLog.created_at.desc())
        ).scalars().first()
        assert audit is not None
        assert audit.payload.get("created") == 1
        assert audit.payload.get("term_number") == 1
        assert audit.payload.get("academic_year") == 2026
        assert audit.payload.get("dry_run") is False

    def test_invalid_term_number_rejected(
        self, client: TestClient, db_session: Session
    ):
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bulkbadterm")
        resp = _bulk(client, headers, term_number=4, academic_year=2026)
        assert resp.status_code == 422  # Pydantic ge/le

    def test_tenant_isolation(self, client: TestClient, db_session: Session):
        """Bulk generate in tenant B must NOT see tenant A's enrollments."""
        tenant_a, headers_a = _make_actor_with_perms(db_session, slug_prefix="biso-a")
        _setup_full_structure(
            client, headers_a, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        _enroll_with_admission_year(
            client, headers_a, db_session, class_code="GRADE_1", admission_year=2025,
        )
        # Tenant B has nothing.
        tenant_b, headers_b = _make_actor_with_perms(db_session, slug_prefix="biso-b")

        resp = _bulk(client, headers_b, term_number=1, academic_year=2026)
        assert resp.status_code == 200
        assert resp.json()["summary"]["total"] == 0


# ────────────────────────────────────────────────────────────────────────────
# Bulk publish
# ────────────────────────────────────────────────────────────────────────────

class TestBulkPublish:
    def test_publishes_only_drafts_skips_others(
        self, client: TestClient, db_session: Session
    ):
        """Mix of DRAFT (→ published) + already-ISSUED (→ skipped reason='not_draft')
        + an invalid uuid from another tenant (→ skipped reason='not_found')."""
        tenant_a, headers_a = _make_actor_with_perms(db_session, slug_prefix="bpub-a")
        _setup_full_structure(
            client, headers_a, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        # Two DRAFTs via bulk-generate.
        for _ in range(2):
            _enroll_with_admission_year(
                client, headers_a, db_session,
                class_code="GRADE_1", admission_year=2025,
            )
        gen = _bulk(client, headers_a, term_number=1, academic_year=2026)
        draft_ids = [row["invoice_id"] for row in gen.json()["created"]]
        assert len(draft_ids) == 2

        # Publish the first one ahead of the bulk-publish call.
        client.post(f"{BASE}/invoices/{draft_ids[0]}/publish", headers=headers_a)

        # Cross-tenant id to verify not_found classification.
        tenant_b, headers_b = _make_actor_with_perms(db_session, slug_prefix="bpub-b")
        _setup_full_structure(
            client, headers_b, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        _enroll_with_admission_year(
            client, headers_b, db_session, class_code="GRADE_1", admission_year=2025,
        )
        gen_b = _bulk(client, headers_b, term_number=1, academic_year=2026)
        foreign_id = gen_b.json()["created"][0]["invoice_id"]

        # Bulk-publish from tenant A: 1 DRAFT + 1 already-ISSUED + 1 foreign.
        resp = _bulk_publish(client, headers_a, draft_ids + [foreign_id])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["summary"]["total"] == 3
        assert body["summary"]["published"] == 1
        assert body["summary"]["skipped"] == 2

        skipped_reasons = sorted(r["reason"] for r in body["skipped"])
        assert skipped_reasons == ["not_draft", "not_found"]

        published = body["published"][0]
        assert published["after_status"] == "ISSUED"
        assert published["invoice_no"]

    def test_empty_invoice_publish_failure_is_isolated(
        self, client: TestClient, db_session: Session
    ):
        """An empty (total_amount=0) DRAFT must surface as 'failed'
        reason='empty_invoice' WITHOUT preventing other DRAFTs in the same
        batch from publishing successfully."""
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bpub-empty")
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        _enroll_with_admission_year(
            client, headers, db_session, class_code="GRADE_1", admission_year=2025,
        )
        gen = _bulk(client, headers, term_number=1, academic_year=2026)
        good_id = gen.json()["created"][0]["invoice_id"]

        # Hand-craft an empty DRAFT — no lines, total_amount=0.
        eid = str(uuid4())
        sid = str(uuid4())
        db_session.execute(
            text(
                "INSERT INTO core.students (id, tenant_id, admission_no, "
                "first_name, last_name, status, admission_year) "
                "VALUES (:id, :tid, :adm, 'E', 'M', 'ACTIVE', 2025)"
            ),
            {"id": sid, "tid": str(tenant.id), "adm": f"ADM-{uuid4().hex[:6].upper()}"},
        )
        db_session.execute(
            text(
                "INSERT INTO core.enrollments "
                "(id, tenant_id, student_id, status, payload) "
                "VALUES (:id, :tid, :sid, 'ENROLLED', "
                "        CAST('{\"class_code\":\"GRADE_1\"}' AS jsonb))"
            ),
            {"id": eid, "tid": str(tenant.id), "sid": sid},
        )
        empty_id = str(uuid4())
        db_session.execute(
            text(
                "INSERT INTO core.invoices "
                "(id, tenant_id, invoice_no, invoice_type, status, enrollment_id, "
                " currency, total_amount, paid_amount, balance_amount) "
                "VALUES (:id, :tid, 'INV-EMPTY-BULK', 'SCHOOL_FEES', 'DRAFT', :eid, "
                "        'KES', 0, 0, 0)"
            ),
            {"id": empty_id, "tid": str(tenant.id), "eid": eid},
        )
        db_session.commit()

        resp = _bulk_publish(client, headers, [good_id, empty_id])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["summary"]["published"] == 1
        assert body["summary"]["failed"] == 1
        assert body["failed"][0]["reason"] == "empty_invoice"

        # Good one really ended up ISSUED.
        row = db_session.execute(
            text("SELECT status FROM core.invoices WHERE id = :id"),
            {"id": good_id},
        ).mappings().first()
        assert row["status"] == "ISSUED"

    def test_bulk_publish_emits_audit_event(
        self, client: TestClient, db_session: Session
    ):
        from app.models.audit_log import AuditLog
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bpub-aud")
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        _enroll_with_admission_year(
            client, headers, db_session, class_code="GRADE_1", admission_year=2025,
        )
        gen = _bulk(client, headers, term_number=1, academic_year=2026)
        draft_id = gen.json()["created"][0]["invoice_id"]

        resp = _bulk_publish(client, headers, [draft_id])
        assert resp.status_code == 200

        audit = db_session.execute(
            select(AuditLog)
            .where(AuditLog.tenant_id == tenant.id,
                   AuditLog.action == "invoice.bulk_publish")
            .order_by(AuditLog.created_at.desc())
        ).scalars().first()
        assert audit is not None
        assert audit.payload.get("published") == 1
        assert audit.payload.get("total") == 1


# ────────────────────────────────────────────────────────────────────────────
# Bulk publish: all_drafts mode
# ────────────────────────────────────────────────────────────────────────────

class TestBulkPublishAllDrafts:
    def test_publishes_every_draft_in_tenant(
        self, client: TestClient, db_session: Session
    ):
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bpub-all")
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        for _ in range(3):
            _enroll_with_admission_year(
                client, headers, db_session,
                class_code="GRADE_1", admission_year=2025,
            )
        gen = _bulk(client, headers, term_number=1, academic_year=2026)
        assert len(gen.json()["created"]) == 3

        resp = client.post(
            f"{BASE}/invoices/publish/bulk",
            json={"all_drafts": True},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["summary"]["total"]     == 3
        assert body["summary"]["published"] == 3
        assert body["summary"]["skipped"]   == 0

        # No DRAFTs left in the tenant after the call.
        leftover = db_session.execute(
            text("SELECT COUNT(*) FROM core.invoices "
                 "WHERE tenant_id = :tid AND status = 'DRAFT'"),
            {"tid": str(tenant.id)},
        ).scalar()
        assert leftover == 0

    def test_term_filter_only_publishes_matching_drafts(
        self, client: TestClient, db_session: Session
    ):
        """Hand-seed two DRAFTs in different terms, publish only term 1 via
        the all_drafts mode with a term filter, confirm term 2 is untouched."""
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bpub-tflt")
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        _enroll_with_admission_year(
            client, headers, db_session,
            class_code="GRADE_1", admission_year=2025,
        )
        gen1 = _bulk(client, headers, term_number=1, academic_year=2026)
        term1_id = gen1.json()["created"][0]["invoice_id"]

        # Hand-craft a term-2 DRAFT for a different enrollment (avoids the
        # one-invoice-per-student-per-term guard).
        sid = str(uuid4())
        eid = str(uuid4())
        db_session.execute(
            text(
                "INSERT INTO core.students (id, tenant_id, admission_no, "
                "first_name, last_name, status, admission_year) "
                "VALUES (:id, :tid, :adm, 'T2', 'Kid', 'ACTIVE', 2025)"
            ),
            {"id": sid, "tid": str(tenant.id),
             "adm": f"ADM-{uuid4().hex[:6].upper()}"},
        )
        db_session.execute(
            text(
                "INSERT INTO core.enrollments "
                "(id, tenant_id, student_id, status, payload) "
                "VALUES (:id, :tid, :sid, 'ENROLLED', "
                "        CAST('{\"class_code\":\"GRADE_1\"}' AS jsonb))"
            ),
            {"id": eid, "tid": str(tenant.id), "sid": sid},
        )
        term2_id = str(uuid4())
        db_session.execute(
            text(
                "INSERT INTO core.invoices "
                "(id, tenant_id, invoice_no, invoice_type, status, enrollment_id, "
                " currency, total_amount, paid_amount, balance_amount, "
                " term_number, academic_year) "
                "VALUES (:id, :tid, 'INV-T2-FILTER', 'SCHOOL_FEES', 'DRAFT', :eid, "
                "        'KES', 5000, 0, 5000, 2, 2026)"
            ),
            {"id": term2_id, "tid": str(tenant.id), "eid": eid},
        )
        # Give it one line so it isn't an empty invoice and can publish.
        db_session.execute(
            text(
                "INSERT INTO core.invoice_lines "
                "(id, invoice_id, description, amount) "
                "VALUES (:id, :inv, 'Term 2 fees', 5000)"
            ),
            {"id": str(uuid4()), "inv": term2_id},
        )
        db_session.commit()

        resp = client.post(
            f"{BASE}/invoices/publish/bulk",
            json={"all_drafts": True, "term_number": 1, "academic_year": 2026},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["summary"]["published"] == 1
        # Term 2 DRAFT untouched.
        status = db_session.execute(
            text("SELECT status FROM core.invoices WHERE id = :id"),
            {"id": term2_id},
        ).scalar()
        assert status == "DRAFT"
        # Term 1 invoice is ISSUED.
        status1 = db_session.execute(
            text("SELECT status FROM core.invoices WHERE id = :id"),
            {"id": term1_id},
        ).scalar()
        assert status1 == "ISSUED"

    def test_all_drafts_is_tenant_scoped(
        self, client: TestClient, db_session: Session
    ):
        tenant_a, headers_a = _make_actor_with_perms(db_session, slug_prefix="bpub-iso-a")
        tenant_b, headers_b = _make_actor_with_perms(db_session, slug_prefix="bpub-iso-b")
        for h in (headers_a, headers_b):
            _setup_full_structure(
                client, h, class_code="GRADE_1",
                academic_year=2026, student_type="RETURNING",
            )
        for h in (headers_a, headers_b):
            _enroll_with_admission_year(
                client, h, db_session, class_code="GRADE_1", admission_year=2025,
            )
            _bulk(client, h, term_number=1, academic_year=2026)

        resp = client.post(
            f"{BASE}/invoices/publish/bulk",
            json={"all_drafts": True},
            headers=headers_a,
        )
        assert resp.status_code == 200
        # Tenant B's DRAFT must remain untouched.
        leftover_b = db_session.execute(
            text("SELECT COUNT(*) FROM core.invoices "
                 "WHERE tenant_id = :tid AND status = 'DRAFT'"),
            {"tid": str(tenant_b.id)},
        ).scalar()
        assert leftover_b == 1

    def test_rejects_both_modes_set(
        self, client: TestClient, db_session: Session
    ):
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bpub-mode")
        resp = client.post(
            f"{BASE}/invoices/publish/bulk",
            json={"all_drafts": True, "invoice_ids": [str(uuid4())]},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_rejects_neither_mode_set(
        self, client: TestClient, db_session: Session
    ):
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bpub-none")
        resp = client.post(
            f"{BASE}/invoices/publish/bulk",
            json={},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_count_drafts_endpoint(
        self, client: TestClient, db_session: Session
    ):
        tenant, headers = _make_actor_with_perms(db_session, slug_prefix="bpub-cnt")
        _setup_full_structure(
            client, headers, class_code="GRADE_1",
            academic_year=2026, student_type="RETURNING",
        )
        for _ in range(2):
            _enroll_with_admission_year(
                client, headers, db_session,
                class_code="GRADE_1", admission_year=2025,
            )
        _bulk(client, headers, term_number=1, academic_year=2026)

        resp = client.get(f"{BASE}/invoices/drafts/count", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["count"] == 2

        # Term filter narrows to zero when academic_year=2027.
        resp2 = client.get(
            f"{BASE}/invoices/drafts/count?term_number=1&academic_year=2027",
            headers=headers,
        )
        assert resp2.status_code == 200
        assert resp2.json()["count"] == 0
