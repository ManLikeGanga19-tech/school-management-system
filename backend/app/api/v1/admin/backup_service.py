"""Phase 1 — Platform database backup service.

Produces a single, self-describing backup artifact that protects the ONE
production system with live clients: the full PostgreSQL database plus the
on-disk student documents (which are NOT in the database — see
docs/ops/SYSTEM_INVENTORY.md).

Artifact layout (a single `.tar` — the inner dump is already compressed by
`pg_dump -Fc`, so we don't gzip the outer container and double-compress):

    shulehq-backup-<env>-<UTC timestamp>.tar
      ├─ database.dump     PostgreSQL custom-format dump (pg_dump -Fc)
      ├─ media.tar.gz      archive of /app/media/student-docs (may be empty)
      └─ manifest.json     env, timestamps, pg_dump version, alembic head,
                           per-part sha256, table-data count, media count

Every run writes a row to core.backups (the audit trail): who, when,
outcome, size, and the artifact SHA-256 used to verify integrity at
restore time.

Security posture:
  * DB password is passed via PGPASSWORD env, never on the argv (which is
    world-readable in the process list).
  * The endpoint that calls this is SaaS-admin gated; artifacts are streamed
    over TLS and the server-side temp copy is deleted after the response.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse, unquote
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import settings


# Where student-document uploads live (mirrors students/routes.py _MEDIA_ROOT).
MEDIA_ROOT = Path("/app/media/student-docs")

# Candidate locations for the pg_dump binary. The image installs the v18
# client under /usr/lib/postgresql/18/bin; PATH is checked first.
_PG_BIN_DIRS = (
    "/usr/lib/postgresql/18/bin",
    "/usr/lib/postgresql/17/bin",
    "/usr/lib/postgresql/16/bin",
)


def _find_binary(name: str) -> Optional[str]:
    found = shutil.which(name)
    if found:
        return found
    for d in _PG_BIN_DIRS:
        candidate = Path(d) / name
        if candidate.exists():
            return str(candidate)
    return None


def _dsn_parts() -> dict[str, str]:
    """Parse DATABASE_URL into discrete connection params so the password is
    never placed on the command line."""
    raw = str(settings.DATABASE_URL)
    # SQLAlchemy-style prefixes → libpq-style.
    raw = re.sub(r"^postgresql\+\w+://", "postgresql://", raw)
    raw = re.sub(r"^postgres\+\w+://", "postgresql://", raw)
    u = urlparse(raw)
    return {
        "host": u.hostname or "localhost",
        "port": str(u.port or 5432),
        "user": unquote(u.username or ""),
        "password": unquote(u.password or ""),
        "dbname": (u.path or "/").lstrip("/") or "postgres",
    }


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _current_alembic_head(db: Session) -> str:
    try:
        return str(db.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() or "")
    except Exception:
        return ""


class BackupError(RuntimeError):
    """Raised when a backup cannot be produced. Caller records FAILED."""


def create_backup_artifact(
    db: Session,
    *,
    actor_user_id: Optional[UUID],
    kind: str = "MANUAL",
    work_dir: Optional[Path] = None,
) -> dict[str, Any]:
    """Build the backup artifact and record it in core.backups.

    Returns {backup_id, path, filename, sha256, size_bytes, ...}. The caller
    owns the returned file (streams it, then deletes work_dir). Raises
    BackupError on failure (a FAILED ledger row is written first).
    """
    started = time.monotonic()
    parts = _dsn_parts()
    env_label = str(settings.APP_ENV or "dev")
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"shulehq-backup-{env_label}-{ts}.tar"

    # Open a RUNNING ledger row up front so an interrupted run is visible.
    row = db.execute(
        sa.text(
            "INSERT INTO core.backups (created_by, kind, status, filename) "
            "VALUES (:by, :kind, 'RUNNING', :fn) RETURNING id"
        ),
        {"by": str(actor_user_id) if actor_user_id else None,
         "kind": kind if kind in ("MANUAL", "SCHEDULED") else "MANUAL",
         "fn": filename},
    ).scalar_one()
    db.commit()
    backup_id = str(row)

    def _fail(msg: str) -> None:
        db.execute(
            sa.text("UPDATE core.backups SET status='FAILED', error=:e, "
                    "duration_ms=:d WHERE id=:id"),
            {"e": msg[:2000], "d": int((time.monotonic() - started) * 1000),
             "id": backup_id},
        )
        db.commit()

    pg_dump = _find_binary("pg_dump")
    if not pg_dump:
        _fail("pg_dump binary not found in image (expected postgresql-client-18)")
        raise BackupError(
            "Backup tooling unavailable: pg_dump is not installed in this "
            "image. Rebuild the backend image (it installs postgresql-client-18)."
        )

    work = Path(work_dir) if work_dir else Path(tempfile.mkdtemp(prefix="shulehq-backup-"))
    work.mkdir(parents=True, exist_ok=True)
    dump_path = work / "database.dump"
    media_path = work / "media.tar.gz"
    manifest_path = work / "manifest.json"
    artifact_path = work / filename

    try:
        # ── 1. Database — pg_dump custom format (compressed, selective restore)
        pg_env = {**os.environ, "PGPASSWORD": parts["password"]}
        proc = subprocess.run(
            [pg_dump, "-h", parts["host"], "-p", parts["port"],
             "-U", parts["user"], "-d", parts["dbname"],
             "-Fc", "--no-owner", "--no-privileges", "-f", str(dump_path)],
            env=pg_env, capture_output=True, text=True, timeout=1800,
        )
        if proc.returncode != 0:
            raise BackupError(f"pg_dump failed: {proc.stderr.strip()[:1500]}")

        # table-data object count (sanity signal at restore)
        pg_restore = _find_binary("pg_restore")
        table_data_count = 0
        if pg_restore:
            listed = subprocess.run(
                [pg_restore, "-l", str(dump_path)],
                capture_output=True, text=True, timeout=120,
            )
            table_data_count = sum(
                1 for ln in listed.stdout.splitlines() if "TABLE DATA" in ln
            )

        # ── 2. Media — student documents (may be absent on a fresh install)
        media_count = 0
        with tarfile.open(media_path, "w:gz") as tar:
            if MEDIA_ROOT.exists():
                for p in sorted(MEDIA_ROOT.rglob("*")):
                    if p.is_file():
                        media_count += 1
                        tar.add(p, arcname=str(p.relative_to(MEDIA_ROOT)))

        # ── 3. Manifest
        pg_ver = ""
        try:
            v = subprocess.run([pg_dump, "--version"], capture_output=True, text=True, timeout=30)
            pg_ver = v.stdout.strip()
        except Exception:
            pass
        alembic_head = _current_alembic_head(db)
        manifest = {
            "product": "ShuleHQ",
            "artifact_version": 1,
            "environment": env_label,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "pg_dump_version": pg_ver,
            "alembic_head": alembic_head,
            "database": {
                "name": parts["dbname"],
                "table_data_count": table_data_count,
                "dump_sha256": _sha256_file(dump_path),
                "dump_bytes": dump_path.stat().st_size,
            },
            "media": {
                "file_count": media_count,
                "sha256": _sha256_file(media_path),
                "bytes": media_path.stat().st_size,
            },
        }
        manifest_path.write_text(json.dumps(manifest, indent=2))

        # ── 4. Bundle (outer tar, no gzip — dump is already compressed)
        with tarfile.open(artifact_path, "w") as tar:
            tar.add(dump_path, arcname="database.dump")
            tar.add(media_path, arcname="media.tar.gz")
            tar.add(manifest_path, arcname="manifest.json")

        artifact_sha = _sha256_file(artifact_path)
        artifact_size = artifact_path.stat().st_size

        db.execute(
            sa.text(
                "UPDATE core.backups SET status='SUCCESS', size_bytes=:sz, "
                "sha256=:sha, db_table_data_count=:tdc, media_file_count=:mc, "
                "alembic_head=:head, pg_dump_version=:pv, duration_ms=:d "
                "WHERE id=:id"
            ),
            {"sz": artifact_size, "sha": artifact_sha, "tdc": table_data_count,
             "mc": media_count, "head": alembic_head, "pv": pg_ver,
             "d": int((time.monotonic() - started) * 1000), "id": backup_id},
        )
        db.commit()

        return {
            "backup_id": backup_id,
            "path": str(artifact_path),
            "filename": filename,
            "sha256": artifact_sha,
            "size_bytes": artifact_size,
            "db_table_data_count": table_data_count,
            "media_file_count": media_count,
            "alembic_head": alembic_head,
            "work_dir": str(work),
        }
    except BackupError as e:
        _fail(str(e))
        if not work_dir:
            shutil.rmtree(work, ignore_errors=True)
        raise
    except Exception as e:  # noqa: BLE001
        _fail(f"unexpected: {e}")
        if not work_dir:
            shutil.rmtree(work, ignore_errors=True)
        raise BackupError(str(e)) from e


def list_backups(db: Session, *, limit: int = 50) -> list[dict[str, Any]]:
    rows = db.execute(
        sa.text(
            "SELECT id, created_at, created_by, kind, status, filename, "
            "size_bytes, sha256, db_table_data_count, media_file_count, "
            "alembic_head, pg_dump_version, duration_ms, error "
            "FROM core.backups ORDER BY created_at DESC LIMIT :lim"
        ),
        {"lim": max(1, min(int(limit), 200))},
    ).mappings().all()
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append({
            "id": str(r["id"]),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "created_by": str(r["created_by"]) if r["created_by"] else None,
            "kind": r["kind"],
            "status": r["status"],
            "filename": r["filename"],
            "size_bytes": int(r["size_bytes"]) if r["size_bytes"] is not None else None,
            "sha256": r["sha256"],
            "db_table_data_count": r["db_table_data_count"],
            "media_file_count": r["media_file_count"],
            "alembic_head": r["alembic_head"],
            "pg_dump_version": r["pg_dump_version"],
            "duration_ms": r["duration_ms"],
            "error": r["error"],
        })
    return out
