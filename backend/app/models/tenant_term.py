from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, SmallInteger, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func, text

from app.core.database import Base


class TenantTerm(Base):
    __tablename__ = "tenant_terms"
    __table_args__ = (
        CheckConstraint(
            "term_number IS NULL OR term_number IN (1, 2, 3)",
            name="ck_tenant_terms_term_number",
        ),
        CheckConstraint(
            "academic_year IS NULL OR (academic_year BETWEEN 2000 AND 2199)",
            name="ck_tenant_terms_academic_year",
        ),
        {"schema": "core"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    code = Column(String(80), nullable=False)
    name = Column(String(160), nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    start_date = Column(DateTime(timezone=False))
    end_date = Column(DateTime(timezone=False))

    # Structured term identity. Nullable so existing rows without an inferrable
    # value continue to round-trip; the secretary fills them in under
    # School Setup → Terms. Every consumer (invoice generation, payment
    # summary, bulk-generation) reads these instead of regex-parsing
    # code/name on the fly.
    term_number = Column(SmallInteger(), nullable=True)
    academic_year = Column(SmallInteger(), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
