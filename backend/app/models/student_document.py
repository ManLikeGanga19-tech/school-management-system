from sqlalchemy import BigInteger, Column, DateTime, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class StudentDocument(Base):
    __tablename__ = "student_documents"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    student_id = Column(UUID(as_uuid=True), nullable=False)

    document_type = Column(String(80), nullable=False)
    # BIRTH_CERTIFICATE, TRANSFER_LETTER, NEMIS_REPORT, ID_COPY, MEDICAL_CERT, OTHER

    title = Column(String(200))
    file_url = Column(Text, nullable=False)     # CDN / public URL
    storage_key = Column(Text)                  # S3/R2 object key
    content_type = Column(String(100))          # MIME type
    size_bytes = Column(BigInteger)
    notes = Column(String(500))

    uploaded_by_user_id = Column(UUID(as_uuid=True))
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
