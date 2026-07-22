"""Phase 1 — platform backup ledger ORM model.

Mirrors migration bkp1a2b3c4d5. Platform-level (no tenant_id): a backup is
the whole database. The service layer writes via raw SQL for streaming
control; this model exists so the schema is declared in code and included
in test-database creation.
"""
from sqlalchemy import (
    BigInteger, CheckConstraint, Column, DateTime, Integer, String, Text, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class Backup(Base):
    __tablename__ = "backups"
    __table_args__ = (
        CheckConstraint("status IN ('RUNNING', 'SUCCESS', 'FAILED')", name="ck_backups_status"),
        CheckConstraint("kind IN ('MANUAL', 'SCHEDULED')", name="ck_backups_kind"),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    kind = Column(String(20), nullable=False, server_default=text("'MANUAL'"))
    status = Column(String(20), nullable=False, server_default=text("'RUNNING'"))
    filename = Column(String(255), nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    sha256 = Column(String(64), nullable=True)
    db_table_data_count = Column(Integer, nullable=True)
    media_file_count = Column(Integer, nullable=True)
    alembic_head = Column(String(64), nullable=True)
    pg_dump_version = Column(String(40), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)
