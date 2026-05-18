from sqlalchemy import Column, String, Text, Boolean, DateTime, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class ChangelogEntry(Base):
    """An in-app "What's New" entry. Published entries surface to every
    tenant user as a dismissible banner until they mark them seen."""

    __tablename__ = "changelog_entries"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    # 'new' | 'improved' | 'fixed' — drives the banner badge.
    category = Column(String(16), nullable=False, server_default=text("'new'"))
    is_published = Column(Boolean, nullable=False, server_default=text("false"))
    published_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True)
