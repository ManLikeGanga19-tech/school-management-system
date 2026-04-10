"""SIS Students API — Phase 1 + Phase 4 (hard-delete).

Endpoints:
  GET    /students/{student_id}                                — full profile
  PATCH  /students/{student_id}/biodata                        — update bio-data
  GET    /students/{student_id}/guardian                       — guardian list
  PATCH  /students/{student_id}/guardian/{parent_id}           — update guardian contacts
  GET    /students/{student_id}/emergency-contacts             — list emergency contacts
  POST   /students/{student_id}/emergency-contacts             — add contact
  PATCH  /students/{student_id}/emergency-contacts/{id}        — update contact
  DELETE /students/{student_id}/emergency-contacts/{id}        — delete contact
  GET    /students/{student_id}/documents                      — list documents
  POST   /students/{student_id}/documents                      — register document (URL)
  POST   /students/{student_id}/documents/upload               — upload document file
  GET    /students/{student_id}/documents/{doc_id}/download    — download uploaded file
  DELETE /students/{student_id}/documents/{id}                 — delete document
  DELETE /students/{student_id}                                — permanently delete student (director only)
"""
from __future__ import annotations

import mimetypes
import os
import shutil
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_tenant, require_permission

# Directory inside the container where uploaded files are persisted.
# Matches the host mount: ./backend/media/student-docs/
_MEDIA_ROOT = Path("/app/media/student-docs")

from .schemas import (
    EmergencyContactCreate,
    EmergencyContactOut,
    EmergencyContactUpdate,
    GuardianContactUpdate,
    GuardianOut,
    StudentBiodataUpdate,
    StudentDocumentCreate,
    StudentDocumentOut,
    StudentOut,
    _VALID_DOC_TYPES,
)

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _str(v: object) -> str | None:
    return str(v) if v is not None else None


def _require_student(db: Session, *, student_id: UUID, tenant_id: UUID) -> dict:
    row = db.execute(
        sa.text(
            """
            SELECT id, tenant_id, admission_no, first_name, last_name, other_names,
                   gender, CAST(date_of_birth AS TEXT) AS date_of_birth, status,
                   phone, email, nationality, religion, home_address,
                   county, sub_county, upi, birth_certificate_no,
                   previous_school, previous_class,
                   CAST(created_at AS TEXT) AS created_at,
                   CAST(updated_at AS TEXT) AS updated_at
            FROM core.students
            WHERE id = :id AND tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"id": str(student_id), "tenant_id": str(tenant_id)},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Student not found")
    return dict(row)


def _student_out(row: dict) -> StudentOut:
    return StudentOut(
        id=_str(row["id"]) or "",
        tenant_id=_str(row["tenant_id"]) or "",
        admission_no=str(row.get("admission_no") or ""),
        first_name=str(row.get("first_name") or ""),
        last_name=str(row.get("last_name") or ""),
        other_names=_str(row.get("other_names")),
        gender=_str(row.get("gender")),
        date_of_birth=_str(row.get("date_of_birth")),
        status=str(row.get("status") or "ACTIVE"),
        phone=_str(row.get("phone")),
        email=_str(row.get("email")),
        nationality=_str(row.get("nationality")),
        religion=_str(row.get("religion")),
        home_address=_str(row.get("home_address")),
        county=_str(row.get("county")),
        sub_county=_str(row.get("sub_county")),
        upi=_str(row.get("upi")),
        birth_certificate_no=_str(row.get("birth_certificate_no")),
        previous_school=_str(row.get("previous_school")),
        previous_class=_str(row.get("previous_class")),
        created_at=_str(row.get("created_at")),
        updated_at=_str(row.get("updated_at")),
    )


# ── Student profile ───────────────────────────────────────────────────────────

@router.get(
    "/{student_id}",
    response_model=StudentOut,
    dependencies=[Depends(require_permission("students.biodata.read"))],
)
def get_student(
    student_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    return _student_out(_require_student(db, student_id=student_id, tenant_id=tenant.id))


@router.patch(
    "/{student_id}/biodata",
    response_model=StudentOut,
    dependencies=[Depends(require_permission("students.biodata.update"))],
)
def update_student_biodata(
    student_id: UUID,
    payload: StudentBiodataUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    updates: list[str] = []
    params: dict = {"id": str(student_id), "tenant_id": str(tenant.id)}

    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            updates.append(f"{field} = :{field}")
            params[field] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No fields supplied")

    updates.append("updated_at = :updated_at")
    params["updated_at"] = _now_utc()

    db.execute(
        sa.text(
            f"UPDATE core.students SET {', '.join(updates)} "
            "WHERE id = :id AND tenant_id = :tenant_id"
        ),
        params,
    )
    db.commit()

    return _student_out(_require_student(db, student_id=student_id, tenant_id=tenant.id))


# ── Guardian (parent) contacts ────────────────────────────────────────────────

@router.get(
    "/{student_id}/guardian",
    response_model=list[GuardianOut],
    dependencies=[Depends(require_permission("students.biodata.read"))],
)
def list_guardians(
    student_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    rows = db.execute(
        sa.text(
            """
            SELECT p.id, ps.relationship,
                   p.first_name, p.last_name, p.phone, p.phone_alt,
                   p.email, p.id_type, p.national_id, p.occupation,
                   p.address, p.is_active
            FROM core.parent_students ps
            JOIN core.parents p ON p.id = ps.parent_id
            WHERE ps.student_id = :student_id
              AND ps.tenant_id  = :tenant_id
            ORDER BY ps.is_active DESC, p.last_name ASC
            """
        ),
        {"student_id": str(student_id), "tenant_id": str(tenant.id)},
    ).mappings().all()

    return [
        GuardianOut(
            id=_str(r["id"]) or "",
            relationship=str(r.get("relationship") or "GUARDIAN"),
            first_name=_str(r.get("first_name")),
            last_name=_str(r.get("last_name")),
            phone=_str(r.get("phone")),
            phone_alt=_str(r.get("phone_alt")),
            email=_str(r.get("email")),
            id_type=_str(r.get("id_type")),
            national_id=_str(r.get("national_id")),
            occupation=_str(r.get("occupation")),
            address=_str(r.get("address")),
            is_active=bool(r.get("is_active", True)),
        )
        for r in rows
    ]


@router.patch(
    "/{student_id}/guardian/{parent_id}",
    response_model=GuardianOut,
    dependencies=[Depends(require_permission("students.biodata.update"))],
)
def update_guardian_contacts(
    student_id: UUID,
    parent_id: UUID,
    payload: GuardianContactUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    # Verify parent-student link belongs to this tenant
    link = db.execute(
        sa.text(
            "SELECT 1 FROM core.parent_students "
            "WHERE parent_id = :parent_id AND student_id = :student_id "
            "  AND tenant_id = :tenant_id LIMIT 1"
        ),
        {"parent_id": str(parent_id), "student_id": str(student_id),
         "tenant_id": str(tenant.id)},
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Guardian not found for this student")

    updates: list[str] = []
    params: dict = {"id": str(parent_id)}

    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            updates.append(f"{field} = :{field}")
            params[field] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No fields supplied")

    db.execute(
        sa.text(f"UPDATE core.parents SET {', '.join(updates)} WHERE id = :id"),
        params,
    )
    db.commit()

    row = db.execute(
        sa.text(
            """
            SELECT p.id, ps.relationship,
                   p.first_name, p.last_name, p.phone, p.phone_alt,
                   p.email, p.id_type, p.national_id, p.occupation,
                   p.address, p.is_active
            FROM core.parent_students ps
            JOIN core.parents p ON p.id = ps.parent_id
            WHERE ps.parent_id = :parent_id AND ps.student_id = :student_id
              AND ps.tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"parent_id": str(parent_id), "student_id": str(student_id),
         "tenant_id": str(tenant.id)},
    ).mappings().first()

    return GuardianOut(
        id=_str(row["id"]) or "",
        relationship=str(row.get("relationship") or "GUARDIAN"),
        first_name=_str(row.get("first_name")),
        last_name=_str(row.get("last_name")),
        phone=_str(row.get("phone")),
        phone_alt=_str(row.get("phone_alt")),
        email=_str(row.get("email")),
        id_type=_str(row.get("id_type")),
        national_id=_str(row.get("national_id")),
        occupation=_str(row.get("occupation")),
        address=_str(row.get("address")),
        is_active=bool(row.get("is_active", True)),
    )


# ── Emergency contacts ────────────────────────────────────────────────────────

@router.get(
    "/{student_id}/emergency-contacts",
    response_model=list[EmergencyContactOut],
    dependencies=[Depends(require_permission("students.emergency_contacts.read"))],
)
def list_emergency_contacts(
    student_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    rows = db.execute(
        sa.text(
            """
            SELECT id, student_id, name, relationship, phone, phone_alt,
                   email, is_primary, notes,
                   CAST(created_at AS TEXT) AS created_at,
                   CAST(updated_at AS TEXT) AS updated_at
            FROM core.student_emergency_contacts
            WHERE student_id = :student_id AND tenant_id = :tenant_id
            ORDER BY is_primary DESC, name ASC
            """
        ),
        {"student_id": str(student_id), "tenant_id": str(tenant.id)},
    ).mappings().all()

    return [
        EmergencyContactOut(
            id=_str(r["id"]) or "",
            student_id=_str(r["student_id"]) or "",
            name=str(r["name"]),
            relationship=_str(r.get("relationship")),
            phone=str(r["phone"]),
            phone_alt=_str(r.get("phone_alt")),
            email=_str(r.get("email")),
            is_primary=bool(r.get("is_primary", False)),
            notes=_str(r.get("notes")),
            created_at=_str(r.get("created_at")),
            updated_at=_str(r.get("updated_at")),
        )
        for r in rows
    ]


@router.post(
    "/{student_id}/emergency-contacts",
    response_model=EmergencyContactOut,
    status_code=201,
    dependencies=[Depends(require_permission("students.emergency_contacts.manage"))],
)
def create_emergency_contact(
    student_id: UUID,
    payload: EmergencyContactCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    new_id = str(uuid4())
    db.execute(
        sa.text(
            """
            INSERT INTO core.student_emergency_contacts
                (id, tenant_id, student_id, name, relationship, phone, phone_alt,
                 email, is_primary, notes)
            VALUES
                (:id, :tenant_id, :student_id, :name, :relationship, :phone,
                 :phone_alt, :email, :is_primary, :notes)
            """
        ),
        {
            "id": new_id,
            "tenant_id": str(tenant.id),
            "student_id": str(student_id),
            "name": payload.name.strip(),
            "relationship": (payload.relationship or "").strip() or None,
            "phone": payload.phone.strip(),
            "phone_alt": (payload.phone_alt or "").strip() or None,
            "email": (payload.email or "").strip() or None,
            "is_primary": bool(payload.is_primary),
            "notes": (payload.notes or "").strip() or None,
        },
    )
    db.commit()

    row = db.execute(
        sa.text(
            "SELECT id, student_id, name, relationship, phone, phone_alt, "
            "email, is_primary, notes, "
            "CAST(created_at AS TEXT) AS created_at, "
            "CAST(updated_at AS TEXT) AS updated_at "
            "FROM core.student_emergency_contacts WHERE id = :id"
        ),
        {"id": new_id},
    ).mappings().first()

    return EmergencyContactOut(
        id=_str(row["id"]) or "",
        student_id=_str(row["student_id"]) or "",
        name=str(row["name"]),
        relationship=_str(row.get("relationship")),
        phone=str(row["phone"]),
        phone_alt=_str(row.get("phone_alt")),
        email=_str(row.get("email")),
        is_primary=bool(row.get("is_primary", False)),
        notes=_str(row.get("notes")),
        created_at=_str(row.get("created_at")),
        updated_at=_str(row.get("updated_at")),
    )


@router.patch(
    "/{student_id}/emergency-contacts/{contact_id}",
    response_model=EmergencyContactOut,
    dependencies=[Depends(require_permission("students.emergency_contacts.manage"))],
)
def update_emergency_contact(
    student_id: UUID,
    contact_id: UUID,
    payload: EmergencyContactUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    existing = db.execute(
        sa.text(
            "SELECT id FROM core.student_emergency_contacts "
            "WHERE id = :id AND student_id = :student_id AND tenant_id = :tenant_id"
        ),
        {"id": str(contact_id), "student_id": str(student_id),
         "tenant_id": str(tenant.id)},
    ).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Emergency contact not found")

    updates: list[str] = []
    params: dict = {
        "id": str(contact_id),
        "student_id": str(student_id),
        "tenant_id": str(tenant.id),
    }

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        updates.append(f"{field} = :{field}")
        params[field] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No fields supplied")

    updates.append("updated_at = :updated_at")
    params["updated_at"] = _now_utc()

    db.execute(
        sa.text(
            f"UPDATE core.student_emergency_contacts SET {', '.join(updates)} "
            "WHERE id = :id AND student_id = :student_id AND tenant_id = :tenant_id"
        ),
        params,
    )
    db.commit()

    row = db.execute(
        sa.text(
            "SELECT id, student_id, name, relationship, phone, phone_alt, "
            "email, is_primary, notes, "
            "CAST(created_at AS TEXT) AS created_at, "
            "CAST(updated_at AS TEXT) AS updated_at "
            "FROM core.student_emergency_contacts WHERE id = :id"
        ),
        {"id": str(contact_id)},
    ).mappings().first()

    return EmergencyContactOut(
        id=_str(row["id"]) or "",
        student_id=_str(row["student_id"]) or "",
        name=str(row["name"]),
        relationship=_str(row.get("relationship")),
        phone=str(row["phone"]),
        phone_alt=_str(row.get("phone_alt")),
        email=_str(row.get("email")),
        is_primary=bool(row.get("is_primary", False)),
        notes=_str(row.get("notes")),
        created_at=_str(row.get("created_at")),
        updated_at=_str(row.get("updated_at")),
    )


@router.delete(
    "/{student_id}/emergency-contacts/{contact_id}",
    status_code=204,
    dependencies=[Depends(require_permission("students.emergency_contacts.manage"))],
)
def delete_emergency_contact(
    student_id: UUID,
    contact_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    deleted = db.execute(
        sa.text(
            "DELETE FROM core.student_emergency_contacts "
            "WHERE id = :id AND student_id = :student_id AND tenant_id = :tenant_id"
        ),
        {"id": str(contact_id), "student_id": str(student_id),
         "tenant_id": str(tenant.id)},
    )
    db.commit()
    if not (deleted.rowcount or 0):
        raise HTTPException(status_code=404, detail="Emergency contact not found")


# ── Student documents ─────────────────────────────────────────────────────────

@router.get(
    "/{student_id}/documents",
    response_model=list[StudentDocumentOut],
    dependencies=[Depends(require_permission("students.documents.read"))],
)
def list_documents(
    student_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    rows = db.execute(
        sa.text(
            """
            SELECT id, student_id, document_type, title, file_url, storage_key,
                   content_type, size_bytes, notes,
                   CAST(uploaded_by_user_id AS TEXT) AS uploaded_by,
                   CAST(uploaded_at AS TEXT) AS uploaded_at
            FROM core.student_documents
            WHERE student_id = :student_id AND tenant_id = :tenant_id
            ORDER BY uploaded_at DESC
            """
        ),
        {"student_id": str(student_id), "tenant_id": str(tenant.id)},
    ).mappings().all()

    return [
        StudentDocumentOut(
            id=_str(r["id"]) or "",
            student_id=_str(r["student_id"]) or "",
            document_type=str(r["document_type"]),
            title=_str(r.get("title")),
            file_url=str(r["file_url"]),
            storage_key=_str(r.get("storage_key")),
            content_type=_str(r.get("content_type")),
            size_bytes=r.get("size_bytes"),
            notes=_str(r.get("notes")),
            uploaded_by=_str(r.get("uploaded_by")),
            uploaded_at=_str(r.get("uploaded_at")),
        )
        for r in rows
    ]


@router.post(
    "/{student_id}/documents",
    response_model=StudentDocumentOut,
    status_code=201,
    dependencies=[Depends(require_permission("students.documents.manage"))],
)
def create_document(
    student_id: UUID,
    payload: StudentDocumentCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    doc_type = payload.document_type.strip().upper()
    if doc_type not in _VALID_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid document_type. Must be one of: {', '.join(sorted(_VALID_DOC_TYPES))}",
        )

    new_id = str(uuid4())
    db.execute(
        sa.text(
            """
            INSERT INTO core.student_documents
                (id, tenant_id, student_id, document_type, title, file_url,
                 storage_key, content_type, size_bytes, notes, uploaded_by_user_id)
            VALUES
                (:id, :tenant_id, :student_id, :document_type, :title, :file_url,
                 :storage_key, :content_type, :size_bytes, :notes, :uploaded_by)
            """
        ),
        {
            "id": new_id,
            "tenant_id": str(tenant.id),
            "student_id": str(student_id),
            "document_type": doc_type,
            "title": (payload.title or "").strip() or None,
            "file_url": payload.file_url.strip(),
            "storage_key": (payload.storage_key or "").strip() or None,
            "content_type": (payload.content_type or "").strip() or None,
            "size_bytes": payload.size_bytes,
            "notes": (payload.notes or "").strip() or None,
            "uploaded_by": str(user.id) if user else None,
        },
    )
    db.commit()

    row = db.execute(
        sa.text(
            "SELECT id, student_id, document_type, title, file_url, storage_key, "
            "content_type, size_bytes, notes, "
            "CAST(uploaded_by_user_id AS TEXT) AS uploaded_by, "
            "CAST(uploaded_at AS TEXT) AS uploaded_at "
            "FROM core.student_documents WHERE id = :id"
        ),
        {"id": new_id},
    ).mappings().first()

    return StudentDocumentOut(
        id=_str(row["id"]) or "",
        student_id=_str(row["student_id"]) or "",
        document_type=str(row["document_type"]),
        title=_str(row.get("title")),
        file_url=str(row["file_url"]),
        storage_key=_str(row.get("storage_key")),
        content_type=_str(row.get("content_type")),
        size_bytes=row.get("size_bytes"),
        notes=_str(row.get("notes")),
        uploaded_by=_str(row.get("uploaded_by")),
        uploaded_at=_str(row.get("uploaded_at")),
    )


@router.delete(
    "/{student_id}/documents/{doc_id}",
    status_code=204,
    dependencies=[Depends(require_permission("students.documents.manage"))],
)
def delete_document(
    student_id: UUID,
    doc_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    # Read storage_key before deleting so we can remove the file afterward
    storage_row = db.execute(
        sa.text(
            "SELECT storage_key FROM core.student_documents "
            "WHERE id = :id AND student_id = :student_id AND tenant_id = :tenant_id"
        ),
        {"id": str(doc_id), "student_id": str(student_id), "tenant_id": str(tenant.id)},
    ).mappings().first()

    deleted = db.execute(
        sa.text(
            "DELETE FROM core.student_documents "
            "WHERE id = :id AND student_id = :student_id AND tenant_id = :tenant_id"
        ),
        {"id": str(doc_id), "student_id": str(student_id),
         "tenant_id": str(tenant.id)},
    )
    db.commit()
    if not (deleted.rowcount or 0):
        raise HTTPException(status_code=404, detail="Document not found")

    # Remove the physical file if it was an uploaded file
    if storage_row and storage_row.get("storage_key"):
        try:
            Path(storage_row["storage_key"]).unlink(missing_ok=True)
        except Exception:
            pass


# ── File upload + download ─────────────────────────────────────────────────────

_ALLOWED_MIME_PREFIXES = ("image/", "application/pdf", "text/plain")
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB per file


@router.post(
    "/{student_id}/documents/upload",
    response_model=StudentDocumentOut,
    status_code=201,
    dependencies=[Depends(require_permission("students.documents.manage"))],
)
async def upload_document(
    student_id: UUID,
    file: UploadFile,
    document_type: str = Form(default="OTHER"),
    title: str = Form(default=""),
    notes: str = Form(default=""),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    doc_type = document_type.strip().upper() or "OTHER"
    if doc_type not in _VALID_DOC_TYPES:
        doc_type = "OTHER"

    content_type = file.content_type or "application/octet-stream"
    # Allow common document and image types
    if not any(content_type.startswith(pfx) for pfx in _ALLOWED_MIME_PREFIXES):
        raise HTTPException(
            status_code=400,
            detail="Only PDF, image, and plain-text files are allowed.",
        )

    # Read and size-check
    file_bytes = await file.read()
    if len(file_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB).")

    # Determine extension
    ext = Path(file.filename or "").suffix.lower() or (
        mimetypes.guess_extension(content_type) or ".bin"
    )

    doc_id = str(uuid4())
    dest_dir = _MEDIA_ROOT / str(tenant.id) / str(student_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{doc_id}{ext}"
    dest_path.write_bytes(file_bytes)

    # download URL that the frontend can call with a Bearer token
    file_url = f"/api/v1/students/{student_id}/documents/{doc_id}/download"
    storage_key = str(dest_path)

    doc_title = title.strip() or (Path(file.filename or "").stem.replace("_", " ") or "Document")

    db.execute(
        sa.text(
            """
            INSERT INTO core.student_documents
                (id, tenant_id, student_id, document_type, title, file_url,
                 storage_key, content_type, size_bytes, notes, uploaded_by_user_id)
            VALUES
                (:id, :tenant_id, :student_id, :document_type, :title, :file_url,
                 :storage_key, :content_type, :size_bytes, :notes, :uploaded_by)
            """
        ),
        {
            "id": doc_id,
            "tenant_id": str(tenant.id),
            "student_id": str(student_id),
            "document_type": doc_type,
            "title": doc_title,
            "file_url": file_url,
            "storage_key": storage_key,
            "content_type": content_type,
            "size_bytes": len(file_bytes),
            "notes": notes.strip() or None,
            "uploaded_by": str(user.id) if user else None,
        },
    )
    db.commit()

    row = db.execute(
        sa.text(
            "SELECT id, student_id, document_type, title, file_url, storage_key, "
            "content_type, size_bytes, notes, "
            "CAST(uploaded_by_user_id AS TEXT) AS uploaded_by, "
            "CAST(uploaded_at AS TEXT) AS uploaded_at "
            "FROM core.student_documents WHERE id = :id"
        ),
        {"id": doc_id},
    ).mappings().first()

    return StudentDocumentOut(
        id=_str(row["id"]) or "",
        student_id=_str(row["student_id"]) or "",
        document_type=str(row["document_type"]),
        title=_str(row.get("title")),
        file_url=str(row["file_url"]),
        storage_key=_str(row.get("storage_key")),
        content_type=_str(row.get("content_type")),
        size_bytes=row.get("size_bytes"),
        notes=_str(row.get("notes")),
        uploaded_by=_str(row.get("uploaded_by")),
        uploaded_at=_str(row.get("uploaded_at")),
    )


@router.get(
    "/{student_id}/documents/{doc_id}/download",
    dependencies=[Depends(require_permission("students.documents.read"))],
)
def download_document(
    student_id: UUID,
    doc_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    _require_student(db, student_id=student_id, tenant_id=tenant.id)

    row = db.execute(
        sa.text(
            "SELECT title, file_url, storage_key, content_type "
            "FROM core.student_documents "
            "WHERE id = :id AND student_id = :student_id AND tenant_id = :tenant_id"
        ),
        {"id": str(doc_id), "student_id": str(student_id), "tenant_id": str(tenant.id)},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    storage_key = row.get("storage_key")
    if not storage_key:
        raise HTTPException(status_code=404, detail="No file stored for this document")

    file_path = Path(storage_key)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on server")

    content_type = row.get("content_type") or "application/octet-stream"
    filename = (row.get("title") or "document") + file_path.suffix

    return FileResponse(
        path=str(file_path),
        media_type=content_type,
        filename=filename,
    )


# ── Hard delete (Phase 4) ─────────────────────────────────────────────────────

from app.api.v1.discipline.service import hard_delete_student
from app.api.v1.discipline.schemas import StudentHardDeleteRequest, StudentHardDeleteResult


@router.delete(
    "/{student_id}",
    response_model=StudentHardDeleteResult,
    dependencies=[Depends(require_permission("students.hard_delete"))],
)
def delete_student(
    student_id: UUID,
    payload: StudentHardDeleteRequest,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """
    Permanently delete a student and ALL their records.
    Requires body: { "confirm": "DELETE {admission_no}" }
    This action is IRREVERSIBLE.
    """
    result = hard_delete_student(
        db,
        tenant_id=tenant.id,
        student_id=student_id,
        confirm=payload.confirm,
    )
    db.commit()
    return result
