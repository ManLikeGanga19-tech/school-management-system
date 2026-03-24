"""add missing finance and core indexes

Revision ID: j2k3l4m5n6o7
Revises: i1j2k3l4m5n6
Create Date: 2026-03-20

Gap analysis: these tables had no indexes beyond PKs and unique constraints,
causing full table scans on every tenant-scoped query.

Production note
---------------
These are plain (non-CONCURRENT) CREATE INDEX statements, which means Alembic
runs them inside a transaction.  On a live database with millions of rows,
CONCURRENT would be safer; for a new-to-production system with moderate data
volumes the locking window is acceptable.  If you need zero-downtime deploys
on a large dataset, run each CREATE INDEX CONCURRENTLY manually *before*
applying this migration, then Alembic will skip them (the idempotency guards
below check for pre-existence).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "j2k3l4m5n6o7"
down_revision: Union[str, None] = "i1j2k3l4m5n6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _existing_indexes(schema: str, table: str) -> set[str]:
    """Return the set of index names that already exist on schema.table."""
    result = op.get_bind().execute(
        sa.text(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = :schema
              AND tablename  = :table
            """
        ),
        {"schema": schema, "table": table},
    )
    return {row[0] for row in result}


def _create_if_missing(name: str, table: str, columns: list, schema: str, **kwargs) -> None:
    """Create an index only when it does not already exist (idempotent)."""
    if name not in _existing_indexes(schema, table):
        op.create_index(name, table, columns, schema=schema, **kwargs)


def _drop_if_exists(name: str, table: str, schema: str) -> None:
    if name in _existing_indexes(schema, table):
        op.drop_index(name, table_name=table, schema=schema)


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    # ── core.invoices ───────────────────────────────────────────────────────
    # All invoice queries are tenant-scoped; enrollment_id is the second most
    # common filter (fetch invoices for a specific enrollment).
    _create_if_missing(
        "ix_invoices_tenant_id", "invoices", ["tenant_id"], schema="core"
    )
    _create_if_missing(
        "ix_invoices_tenant_enrollment",
        "invoices",
        ["tenant_id", "enrollment_id"],
        schema="core",
    )
    _create_if_missing(
        "ix_invoices_tenant_status",
        "invoices",
        ["tenant_id", "status"],
        schema="core",
    )
    # Sorted listings default to created_at DESC.
    # PostgreSQL can use a (tenant_id, created_at) index for both ASC and DESC
    # scans — no need for a separate DESC index.
    _create_if_missing(
        "ix_invoices_tenant_created_at",
        "invoices",
        ["tenant_id", "created_at"],
        schema="core",
    )

    # ── core.invoice_lines ──────────────────────────────────────────────────
    # Always queried as "get all lines for invoice X" — FK but no index.
    _create_if_missing(
        "ix_invoice_lines_invoice_id", "invoice_lines", ["invoice_id"], schema="core"
    )

    # ── core.payments ───────────────────────────────────────────────────────
    # All payment list queries are tenant-scoped and ordered by received_at.
    _create_if_missing(
        "ix_payments_tenant_id", "payments", ["tenant_id"], schema="core"
    )
    _create_if_missing(
        "ix_payments_tenant_received_at",
        "payments",
        ["tenant_id", "received_at"],
        schema="core",
    )

    # ── core.payment_allocations ────────────────────────────────────────────
    # UniqueConstraint(payment_id, invoice_id) creates an index with payment_id
    # as the lead column — efficient for lookups by payment_id.
    # invoice_id lookups ("which payments cover this invoice?") need their own
    # index because PostgreSQL cannot use the composite index in reverse.
    _create_if_missing(
        "ix_payment_allocations_invoice_id",
        "payment_allocations",
        ["invoice_id"],
        schema="core",
    )

    # ── core.user_tenants ───────────────────────────────────────────────────
    # UniqueConstraint(tenant_id, user_id) has tenant_id as the lead — it
    # cannot efficiently answer "which tenants does user X belong to?".
    _create_if_missing(
        "ix_user_tenants_user_id", "user_tenants", ["user_id"], schema="core"
    )

    # ── core.student_fee_assignments ────────────────────────────────────────
    # Common lookup: "get fee assignments for this enrollment within this tenant".
    _create_if_missing(
        "ix_student_fee_assignments_tenant_enrollment",
        "student_fee_assignments",
        ["tenant_id", "enrollment_id"],
        schema="core",
    )


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------

def downgrade() -> None:
    _drop_if_exists("ix_student_fee_assignments_tenant_enrollment", "student_fee_assignments", schema="core")
    _drop_if_exists("ix_user_tenants_user_id", "user_tenants", schema="core")
    _drop_if_exists("ix_payment_allocations_invoice_id", "payment_allocations", schema="core")
    _drop_if_exists("ix_payments_tenant_received_at", "payments", schema="core")
    _drop_if_exists("ix_payments_tenant_id", "payments", schema="core")
    _drop_if_exists("ix_invoice_lines_invoice_id", "invoice_lines", schema="core")
    _drop_if_exists("ix_invoices_tenant_created_at", "invoices", schema="core")
    _drop_if_exists("ix_invoices_tenant_status", "invoices", schema="core")
    _drop_if_exists("ix_invoices_tenant_enrollment", "invoices", schema="core")
    _drop_if_exists("ix_invoices_tenant_id", "invoices", schema="core")
