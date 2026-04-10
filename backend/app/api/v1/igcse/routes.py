"""IGCSE Assessment API.

Endpoints:
  GET    /igcse/subjects                              — list subjects
  POST   /igcse/subjects                              — create subject
  PATCH  /igcse/subjects/{id}                         — update subject
  GET    /igcse/scores                                — list scores
  PUT    /igcse/scores                                — bulk upsert scores
  GET    /igcse/enrollments/{id}/term/{tid}/report    — learner report JSON
  GET    /igcse/enrollments/{id}/term/{tid}/pdf       — learner report PDF
  GET    /igcse/classes/{class_id}/term/{tid}/bulk-pdf — bulk class PDF
"""
from __future__ import annotations

from uuid import UUID

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_tenant, require_permission
from app.utils.igcse_report_pdf import generate_igcse_report_pdf

from . import service
from .schemas import (
    BulkScoreUpsert,
    LearnerReportOut,
    ScoreOut,
    SubjectCreate,
    SubjectOut,
    SubjectUpdate,
)

router = APIRouter()


# ── Helper ────────────────────────────────────────────────────────────────────

def _get_branding(db: Session, tenant_id) -> dict:
    row = db.execute(
        sa.text(
            "SELECT name, brand_color, school_address, school_phone, school_email "
            "FROM core.tenants WHERE id = :tid"
        ),
        {"tid": str(tenant_id)},
    ).mappings().first()
    return {
        "school_name": (row["name"] if row else None) or "School",
        "brand_color": (row["brand_color"] if row else None) or "#1A4C8B",
        "school_address": (row["school_address"] if row else None) or "",
        "school_phone": (row["school_phone"] if row else None) or "",
        "school_email": (row["school_email"] if row else None) or "",
    }


# ── Subjects ──────────────────────────────────────────────────────────────────

@router.get(
    "/subjects",
    response_model=list[SubjectOut],
    dependencies=[Depends(require_permission("igcse.subjects.view"))],
)
def list_subjects(
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_subjects(db, tenant_id=tenant.id, active_only=active_only)


@router.post(
    "/subjects",
    response_model=SubjectOut,
    status_code=201,
    dependencies=[Depends(require_permission("igcse.subjects.manage"))],
)
def create_subject(
    payload: SubjectCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.create_subject(db, tenant_id=tenant.id, data=payload.model_dump())
    db.commit()
    db.refresh(row)
    return row


@router.patch(
    "/subjects/{subject_id}",
    response_model=SubjectOut,
    dependencies=[Depends(require_permission("igcse.subjects.manage"))],
)
def update_subject(
    subject_id: UUID,
    payload: SubjectUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.update_subject(
        db,
        tenant_id=tenant.id,
        subject_id=subject_id,
        updates=payload.model_dump(exclude_none=True),
    )
    db.commit()
    db.refresh(row)
    return row


# ── Scores ────────────────────────────────────────────────────────────────────

@router.get(
    "/scores",
    response_model=list[ScoreOut],
    dependencies=[Depends(require_permission("igcse.assessments.view"))],
)
def list_scores(
    enrollment_id: UUID | None = Query(None),
    term_id: UUID | None = Query(None),
    student_id: UUID | None = Query(None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_scores(
        db,
        tenant_id=tenant.id,
        enrollment_id=enrollment_id,
        term_id=term_id,
        student_id=student_id,
    )


@router.put(
    "/scores",
    response_model=list[ScoreOut],
    dependencies=[Depends(require_permission("igcse.assessments.enter"))],
)
def bulk_upsert_scores(
    payload: BulkScoreUpsert,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    rows = service.bulk_upsert_scores(
        db,
        tenant_id=tenant.id,
        enrollment_id=payload.enrollment_id,
        term_id=payload.term_id,
        actor_user_id=user.id,
        items=[s.model_dump() for s in payload.scores],
    )
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


# ── Report ────────────────────────────────────────────────────────────────────

@router.get(
    "/enrollments/{enrollment_id}/term/{term_id}/report",
    response_model=LearnerReportOut,
    dependencies=[Depends(require_permission("igcse.assessments.view"))],
)
def get_learner_report(
    enrollment_id: UUID,
    term_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.get_learner_report(
        db, tenant_id=tenant.id, enrollment_id=enrollment_id, term_id=term_id
    )


@router.get(
    "/enrollments/{enrollment_id}/term/{term_id}/pdf",
    response_class=Response,
    dependencies=[Depends(require_permission("igcse.reports.generate"))],
)
def download_learner_pdf(
    enrollment_id: UUID,
    term_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    branding = _get_branding(db, tenant.id)
    report_data = service.get_learner_report(
        db, tenant_id=tenant.id, enrollment_id=enrollment_id, term_id=term_id
    )
    pdf_bytes = generate_igcse_report_pdf(report_data, branding=branding)
    filename = f"igcse_report_{enrollment_id}_{term_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/classes/{class_id}/term/{term_id}/bulk-pdf",
    response_class=Response,
    dependencies=[Depends(require_permission("igcse.reports.generate"))],
)
def download_class_bulk_pdf(
    class_id: UUID,
    term_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Merged PDF — one report card page per student in the class."""
    from fastapi import HTTPException
    from app.utils.cbc_report_pdf import merge_pdfs

    branding = _get_branding(db, tenant.id)

    enrollments = db.execute(
        sa.text(
            """
            SELECT sce.id AS enrollment_id, s.first_name || ' ' || s.last_name AS student_name
            FROM core.student_class_enrollments sce
            JOIN core.students s ON s.id = sce.student_id
            WHERE sce.class_id  = :cid
              AND sce.term_id   = :trid
              AND sce.tenant_id = :tid
            ORDER BY s.last_name, s.first_name
            """
        ),
        {"cid": str(class_id), "trid": str(term_id), "tid": str(tenant.id)},
    ).mappings().all()

    if not enrollments:
        raise HTTPException(status_code=404, detail="No students found for this class and term")

    pdf_pages: list[bytes] = []
    for row in enrollments:
        try:
            report_data = service.get_learner_report(
                db,
                tenant_id=tenant.id,
                enrollment_id=row["enrollment_id"],
                term_id=term_id,
            )
            pdf_pages.append(generate_igcse_report_pdf(report_data, branding=branding))
        except Exception:
            continue

    if not pdf_pages:
        raise HTTPException(
            status_code=404,
            detail="No report data available for students in this class",
        )

    merged = merge_pdfs(pdf_pages)
    filename = f"igcse_bulk_report_{str(class_id)[:8]}_{term_id}.pdf"
    return Response(
        content=merged,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
