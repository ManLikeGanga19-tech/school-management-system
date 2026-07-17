"""KEMIS 2026: ULI replaces NEMIS + full learner/parent capture fields (Phase W)

Kenya's KEMIS (Kenya Education Management Information System) replaces
NEMIS in 2026; every learner gets a Unique Learner Identifier (ULI).
This migration aligns the schema with the official KEMIS Students' Data
Capture Sheet.

1. students.uli — the new government identifier. Partial unique index
   per tenant (NULLs allowed: ULIs are issued by KEMIS after
   registration, so new admissions legitimately lack one for a while).

2. NEMIS is retired from the product but NOT destroyed (Decision D1A):
   * students.upi            → renamed to legacy_nemis_upi (data kept,
                                dropped from all UI/schemas)
   * payload.nemis_no        → key renamed to legacy_nemis_no in every
                                enrollment payload

3. New learner columns straight off the KEMIS capture sheet:
   kcpe_kjsea_year, location_of_birth, medical_condition,
   learner_interests, orphan_status, sne_disability, disability_type,
   stream.

4. parents.middle_name + parents.country_of_residence — sections B/C/D
   of the sheet capture full three-part names and country of residence
   for mother / father / guardian.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "kem1u2l3i4x5"
down_revision: Union[str, None] = "pcf1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. ULI ────────────────────────────────────────────────────────────
    op.add_column(
        "students",
        sa.Column("uli", sa.String(length=50), nullable=True),
        schema="core",
    )
    op.create_index(
        "uq_students_tenant_uli",
        "students",
        ["tenant_id", "uli"],
        unique=True,
        schema="core",
        postgresql_where=sa.text("uli IS NOT NULL"),
    )

    # ── 2. Retire NEMIS (keep the data, drop it from the product) ────────
    op.alter_column(
        "students", "upi", new_column_name="legacy_nemis_upi", schema="core",
    )
    op.execute(
        """
        UPDATE core.enrollments
        SET payload = (payload - 'nemis_no')
                      || jsonb_build_object('legacy_nemis_no', payload->'nemis_no')
        WHERE payload ? 'nemis_no'
        """
    )

    # ── 3. KEMIS learner fields ───────────────────────────────────────────
    for name, type_ in (
        ("kcpe_kjsea_year", sa.SmallInteger()),
        ("location_of_birth", sa.String(length=160)),
        ("medical_condition", sa.String(length=300)),
        ("learner_interests", sa.String(length=300)),
        ("orphan_status", sa.String(length=40)),
        ("sne_disability", sa.String(length=160)),
        ("disability_type", sa.String(length=160)),
        ("stream", sa.String(length=80)),
    ):
        op.add_column("students", sa.Column(name, type_, nullable=True), schema="core")

    # ── 4. Parent capture fields (KEMIS sections B/C/D) ──────────────────
    op.add_column(
        "parents",
        sa.Column("middle_name", sa.String(length=120), nullable=True),
        schema="core",
    )
    op.add_column(
        "parents",
        sa.Column("country_of_residence", sa.String(length=120), nullable=True),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("parents", "country_of_residence", schema="core")
    op.drop_column("parents", "middle_name", schema="core")
    for name in (
        "stream", "disability_type", "sne_disability", "orphan_status",
        "learner_interests", "medical_condition", "location_of_birth",
        "kcpe_kjsea_year",
    ):
        op.drop_column("students", name, schema="core")
    op.execute(
        """
        UPDATE core.enrollments
        SET payload = (payload - 'legacy_nemis_no')
                      || jsonb_build_object('nemis_no', payload->'legacy_nemis_no')
        WHERE payload ? 'legacy_nemis_no'
        """
    )
    op.alter_column(
        "students", "legacy_nemis_upi", new_column_name="upi", schema="core",
    )
    op.drop_index("uq_students_tenant_uli", table_name="students", schema="core")
    op.drop_column("students", "uli", schema="core")
