"""add print profiles, document sequences, and immutable document numbers

Revision ID: m9n0p1q2r3s4
Revises: l8m9n0p1q2r3
Create Date: 2026-02-27 23:55:00.000000

"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "m9n0p1q2r3s4"
down_revision: Union[str, None] = "l8m9n0p1q2r3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DOC_NO_PATTERN = re.compile(r"^(INV|RCT|FS)-(\d{4})-(\d+)$")


def _year_from_dt(value: object | None) -> int:
    if value is None:
        return datetime.now(timezone.utc).year
    dt = value if isinstance(value, datetime) else None
    if dt is None:
        try:
            dt = datetime.fromisoformat(str(value))
        except Exception:
            return datetime.now(timezone.utc).year
    return int(dt.year)


def _collect_and_fill_numbers(
    conn,
    *,
    table_name: str,
    id_col: str,
    ts_col: str,
    value_col: str,
    prefix: str,
    sequence_state: dict[tuple[str, str, int], int],
) -> None:
    rows = conn.execute(
        sa.text(
            f"""
            SELECT {id_col} AS id, tenant_id, {ts_col} AS ts_value, {value_col} AS doc_no
            FROM core.{table_name}
            ORDER BY tenant_id ASC, {ts_col} ASC NULLS LAST, {id_col} ASC
            """
        )
    ).mappings().all()

    missing: list[tuple[str, str, int]] = []
    for row in rows:
        tenant_id = str(row.get("tenant_id") or "")
        if not tenant_id:
            continue

        existing = str(row.get("doc_no") or "").strip().upper()
        if existing:
            match = _DOC_NO_PATTERN.match(existing)
            if match and match.group(1) == prefix:
                year = int(match.group(2))
                seq = int(match.group(3))
                key = (tenant_id, prefix, year)
                current = sequence_state.get(key, 0)
                if seq > current:
                    sequence_state[key] = seq
            continue

        year = _year_from_dt(row.get("ts_value"))
        missing.append((str(row.get("id")), tenant_id, year))

    for row_id, tenant_id, year in missing:
        key = (tenant_id, prefix, year)
        next_seq = sequence_state.get(key, 0) + 1
        sequence_state[key] = next_seq
        doc_no = f"{prefix}-{year:04d}-{next_seq:06d}"
        conn.execute(
            sa.text(
                f"""
                UPDATE core.{table_name}
                SET {value_col} = :doc_no
                WHERE {id_col} = :row_id
                """
            ),
            {"doc_no": doc_no, "row_id": row_id},
        )


def upgrade() -> None:
    op.create_table(
        "tenant_print_profiles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("logo_url", sa.String(length=500), nullable=True),
        sa.Column("school_header", sa.String(length=500), nullable=True),
        sa.Column("receipt_footer", sa.String(length=500), nullable=True),
        sa.Column("paper_size", sa.String(length=32), nullable=False, server_default=sa.text("'A4'")),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default=sa.text("'KES'")),
        sa.Column("thermal_width_mm", sa.Integer(), nullable=False, server_default=sa.text("80")),
        sa.Column("qr_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("thermal_width_mm BETWEEN 58 AND 120", name="ck_tenant_print_profiles_thermal_width"),
        schema="core",
    )

    op.create_table(
        "document_sequences",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core.tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("doc_type", sa.String(length=16), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("next_seq", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "doc_type", "year", name="uq_doc_sequences_tenant_type_year"),
        schema="core",
    )

    conn = op.get_bind()
    insp = sa.inspect(conn)
    payment_cols = {col["name"] for col in insp.get_columns("payments", schema="core")}
    fee_structure_cols = {
        col["name"] for col in insp.get_columns("fee_structures", schema="core")
    }

    if "receipt_no" not in payment_cols:
        op.add_column("payments", sa.Column("receipt_no", sa.String(length=50), nullable=True), schema="core")
    if "structure_no" not in fee_structure_cols:
        op.add_column("fee_structures", sa.Column("structure_no", sa.String(length=50), nullable=True), schema="core")

    op.execute(
        """
        INSERT INTO core.tenant_print_profiles
            (id, tenant_id, logo_url, school_header, receipt_footer, paper_size, currency, thermal_width_mm, qr_enabled, updated_by, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            t.id,
            NULL,
            t.name,
            'Thank you for partnering with us.',
            'A4',
            'KES',
            80,
            true,
            NULL,
            now(),
            now()
        FROM core.tenants t
        WHERE NOT EXISTS (
            SELECT 1 FROM core.tenant_print_profiles p WHERE p.tenant_id = t.id
        )
        """
    )

    sequence_state: dict[tuple[str, str, int], int] = {}

    _collect_and_fill_numbers(
        conn,
        table_name="invoices",
        id_col="id",
        ts_col="created_at",
        value_col="invoice_no",
        prefix="INV",
        sequence_state=sequence_state,
    )
    _collect_and_fill_numbers(
        conn,
        table_name="payments",
        id_col="id",
        ts_col="received_at",
        value_col="receipt_no",
        prefix="RCT",
        sequence_state=sequence_state,
    )
    _collect_and_fill_numbers(
        conn,
        table_name="fee_structures",
        id_col="id",
        ts_col="created_at",
        value_col="structure_no",
        prefix="FS",
        sequence_state=sequence_state,
    )

    for (tenant_id, doc_type, year), seq in sequence_state.items():
        conn.execute(
            sa.text(
                """
                INSERT INTO core.document_sequences
                    (id, tenant_id, doc_type, year, next_seq, created_at, updated_at)
                VALUES
                    (gen_random_uuid(), :tenant_id, :doc_type, :year, :next_seq, now(), now())
                ON CONFLICT (tenant_id, doc_type, year)
                DO UPDATE SET next_seq = GREATEST(core.document_sequences.next_seq, EXCLUDED.next_seq),
                              updated_at = now()
                """
            ),
            {
                "tenant_id": tenant_id,
                "doc_type": doc_type,
                "year": int(year),
                "next_seq": int(seq) + 1,
            },
        )

    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_tenant_receipt_no ON core.payments (tenant_id, receipt_no) WHERE receipt_no IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_structures_tenant_structure_no ON core.fee_structures (tenant_id, structure_no) WHERE structure_no IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_invoices_tenant_invoice_no ON core.invoices (tenant_id, invoice_no)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.ix_invoices_tenant_invoice_no")
    op.execute("DROP INDEX IF EXISTS core.uq_fee_structures_tenant_structure_no")
    op.execute("DROP INDEX IF EXISTS core.uq_payments_tenant_receipt_no")

    conn = op.get_bind()
    insp = sa.inspect(conn)
    payment_cols = {col["name"] for col in insp.get_columns("payments", schema="core")}
    fee_structure_cols = {
        col["name"] for col in insp.get_columns("fee_structures", schema="core")
    }

    if "structure_no" in fee_structure_cols:
        op.drop_column("fee_structures", "structure_no", schema="core")
    if "receipt_no" in payment_cols:
        op.drop_column("payments", "receipt_no", schema="core")

    op.drop_table("document_sequences", schema="core")
    op.drop_table("tenant_print_profiles", schema="core")
