from sqlalchemy import Boolean, Column, Date, DateTime, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class Student(Base):
    __tablename__ = "students"
    __table_args__ = {"schema": "core"}

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(UUID(as_uuid=True), nullable=False)

    admission_no = Column(String(120), nullable=False)
    first_name = Column(String(120), nullable=False)
    last_name = Column(String(120), nullable=False)
    other_names = Column(String(120))
    gender = Column(String(20))
    date_of_birth = Column(Date)

    # Extended bio-data (Phase 1)
    phone = Column(String(50))
    email = Column(String(200))
    nationality = Column(String(80))
    religion = Column(String(80))
    home_address = Column(Text)
    county = Column(String(80))
    sub_county = Column(String(80))
    upi = Column(String(100))
    birth_certificate_no = Column(String(100))
    previous_school = Column(String(200))
    previous_class = Column(String(80))

    status = Column(String(30), nullable=False, server_default=text("'ACTIVE'"))
    archived_at = Column(DateTime(timezone=True))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
