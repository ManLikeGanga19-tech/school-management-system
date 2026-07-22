"""Phase 1 — platform backup feature tests.

Covers the parts that protect the live production system:
  * RBAC — only SaaS admins reach the endpoints
  * ledger list contract
  * graceful failure when pg_dump is absent (records a FAILED row, 503)
  * full create+download end-to-end — RUNS only where pg_dump is installed
    (CI/prod via postgresql-client-18 in the image); skipped in the
    egress-limited dev container.

The dump COMMAND itself is verified out-of-band against the postgres
container; here we test the service's orchestration, ledger, and RBAC.
"""
from __future__ import annotations

import shutil

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from tests.helpers import create_super_admin_user, saas_headers


def _pg_dump_available() -> bool:
    from app.api.v1.admin.backup_service import _find_binary
    return _find_binary("pg_dump") is not None


class TestBackupRbac:
    def test_list_requires_saas_admin(self, client: TestClient, db_session: Session):
        # No auth at all → 401/403.
        r = client.get("/api/v1/admin/backups")
        assert r.status_code in (401, 403)

    def test_create_requires_saas_admin(self, client: TestClient, db_session: Session):
        r = client.post("/api/v1/admin/backups")
        assert r.status_code in (401, 403)

    def test_super_admin_can_list(self, client: TestClient, db_session: Session):
        admin = create_super_admin_user(db_session, email="bk-admin@example.com")
        r = client.get("/api/v1/admin/backups", headers=saas_headers(admin))
        assert r.status_code == 200, r.text
        assert "items" in r.json()


class TestBackupLedger:
    def test_failed_backup_records_ledger_row(
        self, client: TestClient, db_session: Session, monkeypatch,
    ):
        """When pg_dump can't be found, the run must fail LOUDLY: a FAILED
        ledger row + a 503 — never a silent success."""
        import app.api.v1.admin.backup_service as bs
        monkeypatch.setattr(bs, "_find_binary", lambda name: None)

        admin = create_super_admin_user(db_session, email="bk-fail@example.com")
        r = client.post("/api/v1/admin/backups", headers=saas_headers(admin))
        assert r.status_code == 503, r.text

        row = db_session.execute(text(
            "SELECT status, error FROM core.backups ORDER BY created_at DESC LIMIT 1"
        )).mappings().first()
        assert row is not None
        assert row["status"] == "FAILED"
        assert "pg_dump" in (row["error"] or "").lower()

        # And it shows up in the ledger listing.
        lst = client.get("/api/v1/admin/backups", headers=saas_headers(admin)).json()
        assert any(i["status"] == "FAILED" for i in lst["items"])


class TestBackupEndToEnd:
    def test_create_and_download_real_artifact(
        self, client: TestClient, db_session: Session,
    ):
        if not _pg_dump_available():
            import pytest
            pytest.skip("pg_dump not installed in this environment (runs in CI/prod)")

        admin = create_super_admin_user(db_session, email="bk-e2e@example.com")
        r = client.post("/api/v1/admin/backups", headers=saas_headers(admin))
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("application/x-tar")
        assert r.headers.get("X-Backup-Sha256")
        # A real bundle is non-trivial and is a valid tar.
        body = r.content
        assert len(body) > 1000
        import io, tarfile
        with tarfile.open(fileobj=io.BytesIO(body)) as tar:
            names = tar.getnames()
        assert "database.dump" in names
        assert "media.tar.gz" in names
        assert "manifest.json" in names

        row = db_session.execute(text(
            "SELECT status, sha256, db_table_data_count FROM core.backups "
            "ORDER BY created_at DESC LIMIT 1"
        )).mappings().first()
        assert row["status"] == "SUCCESS"
        assert row["sha256"]
        assert (row["db_table_data_count"] or 0) > 0
