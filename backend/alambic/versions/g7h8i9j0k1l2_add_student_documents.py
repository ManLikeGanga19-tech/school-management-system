"""add student_documents table

Revision ID: g7h8i9j0k1l2
Revises: f6g7h8i9j0k1
Create Date: 2026-03-27 08:40:00.000000

Stores metadata for student document uploads (birth certificate, transfer
letter, NEMIS report, etc.). Mirrors the student_photos pattern — no blob
storage, just URLs + S3/R2 keys.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "g7h8i9j0k1l2"
down_revision: Union[str, None] = "f6g7h8i9j0k1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_VALID_DOC_TYPES = (
    "BIRTH_CERTIFICATE",
    "TRANSFER_LETTER",
    "NEMIS_REPORT",
    "ID_COPY",
    "MEDICAL_CERT",
    "OTHER",
)


def _table_exists(schema: str, table: str) -> bool:
    bind = op.get_bind()
    return bind.dialect.has_table(bind, table, schema=schema)


def upgrade() -> None:
    if _table_exists("core", "student_documents"):
        return

    op.create_table(
        "student_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id",  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=False),

        sa.Column("document_type", sa.String(80), nullable=False,
                  server_default=sa.text("'OTHER'")),
        sa.Column("title",        sa.String(200)),
        sa.Column("file_url",     sa.Text, nullable=False),
        sa.Column("storage_key",  sa.Text),
        sa.Column("content_type", sa.String(100)),
        sa.Column("size_bytes",   sa.BigInteger),
        sa.Column("notes",        sa.String(500)),

        sa.Column("uploaded_by_user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("uploaded_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),

        sa.ForeignKeyConstraint(
            ["tenant_id"], ["core.tenants.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["student_id"], ["core.students.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by_user_id"], ["core.users.id"], ondelete="SET NULL"
        ),
        sa.CheckConstraint(
            "document_type IN ("
            + ", ".join(f"'{t}'" for t in _VALID_DOC_TYPES)
            + ")",
            name="ck_student_documents_type",
        ),
        schema="core",
    )

    op.create_index(
        "ix_student_documents_student",
        "student_documents",
        ["tenant_id", "student_id"],
        schema="core",
    )
    op.create_index(
        "ix_student_documents_type",
        "student_documents",
        ["tenant_id", "document_type"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index("ix_student_documents_type", table_name="student_documents", schema="core")
    op.drop_index("ix_student_documents_student", table_name="student_documents", schema="core")
    op.drop_table("student_documents", schema="core")
