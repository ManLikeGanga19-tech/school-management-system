"""CBC Assessment API — Phase 3B.

Endpoints:
  GET    /cbc/curriculum                          — full curriculum tree
  POST   /cbc/curriculum/learning-areas           — create learning area
  PATCH  /cbc/curriculum/learning-areas/{id}      — update learning area
  POST   /cbc/curriculum/strands                  — create strand
  PATCH  /cbc/curriculum/strands/{id}             — update strand
  POST   /cbc/curriculum/sub-strands              — create sub-strand
  PATCH  /cbc/curriculum/sub-strands/{id}         — update sub-strand
  POST   /cbc/curriculum/seed                     — seed default Kenya CBC structure
  GET    /cbc/assessments                         — list assessments
  PUT    /cbc/assessments                         — bulk upsert assessments
  GET    /cbc/enrollments/{id}/term/{term_id}/report — learner report JSON
  GET    /cbc/enrollments/{id}/term/{term_id}/pdf    — learner progress report PDF
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_tenant, require_permission
from app.utils.cbc_report_pdf import generate_cbc_report_pdf, merge_pdfs

from . import service
from .schemas import (
    BulkAssessmentUpsert,
    AssessmentOut,
    CurriculumTreeOut,
    LearnerReportOut,
    LearningAreaCreate,
    LearningAreaOut,
    LearningAreaUpdate,
    StrandCreate,
    StrandOut,
    StrandUpdate,
    SubStrandCreate,
    SubStrandOut,
    SubStrandUpdate,
)

router = APIRouter()


# ── Curriculum tree ───────────────────────────────────────────────────────────

@router.get(
    "/curriculum",
    response_model=CurriculumTreeOut,
    dependencies=[Depends(require_permission("cbc.curriculum.view"))],
)
def get_curriculum(
    grade_band: str | None = Query(None, description="LOWER_PRIMARY / UPPER_PRIMARY / JUNIOR_SECONDARY"),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    tree = service.get_curriculum_tree(
        db, tenant_id=tenant.id, grade_band=grade_band, active_only=active_only
    )
    return tree


@router.post(
    "/curriculum/learning-areas",
    response_model=LearningAreaOut,
    status_code=201,
    dependencies=[Depends(require_permission("cbc.curriculum.manage"))],
)
def create_learning_area(
    payload: LearningAreaCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.create_learning_area(db, tenant_id=tenant.id, data=payload.model_dump())
    db.commit()
    db.refresh(row)
    return row


@router.patch(
    "/curriculum/learning-areas/{la_id}",
    response_model=LearningAreaOut,
    dependencies=[Depends(require_permission("cbc.curriculum.manage"))],
)
def update_learning_area(
    la_id: UUID,
    payload: LearningAreaUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.update_learning_area(
        db, tenant_id=tenant.id, la_id=la_id,
        updates=payload.model_dump(exclude_none=True),
    )
    db.commit()
    db.refresh(row)
    return row


@router.post(
    "/curriculum/strands",
    response_model=StrandOut,
    status_code=201,
    dependencies=[Depends(require_permission("cbc.curriculum.manage"))],
)
def create_strand(
    payload: StrandCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.create_strand(db, tenant_id=tenant.id, data=payload.model_dump())
    db.commit()
    db.refresh(row)
    return row


@router.patch(
    "/curriculum/strands/{strand_id}",
    response_model=StrandOut,
    dependencies=[Depends(require_permission("cbc.curriculum.manage"))],
)
def update_strand(
    strand_id: UUID,
    payload: StrandUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.update_strand(
        db, tenant_id=tenant.id, strand_id=strand_id,
        updates=payload.model_dump(exclude_none=True),
    )
    db.commit()
    db.refresh(row)
    return row


@router.post(
    "/curriculum/sub-strands",
    response_model=SubStrandOut,
    status_code=201,
    dependencies=[Depends(require_permission("cbc.curriculum.manage"))],
)
def create_sub_strand(
    payload: SubStrandCreate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.create_sub_strand(db, tenant_id=tenant.id, data=payload.model_dump())
    db.commit()
    db.refresh(row)
    return row


@router.patch(
    "/curriculum/sub-strands/{ss_id}",
    response_model=SubStrandOut,
    dependencies=[Depends(require_permission("cbc.curriculum.manage"))],
)
def update_sub_strand(
    ss_id: UUID,
    payload: SubStrandUpdate,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    row = service.update_sub_strand(
        db, tenant_id=tenant.id, ss_id=ss_id,
        updates=payload.model_dump(exclude_none=True),
    )
    db.commit()
    db.refresh(row)
    return row


@router.post(
    "/curriculum/seed",
    status_code=200,
    dependencies=[Depends(require_permission("cbc.curriculum.manage"))],
)
def seed_curriculum(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """Seed the default Kenya CBC curriculum for this tenant (idempotent)."""
    service.seed_default_curriculum(db, tenant_id=tenant.id)
    db.commit()
    return {"ok": True, "message": "Default Kenya CBC curriculum seeded"}


# ── Assessments ───────────────────────────────────────────────────────────────

@router.get(
    "/assessments",
    response_model=list[AssessmentOut],
    dependencies=[Depends(require_permission("cbc.assessments.view"))],
)
def list_assessments(
    enrollment_id: UUID | None = Query(None),
    term_id: UUID | None = Query(None),
    student_id: UUID | None = Query(None),
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    return service.list_assessments(
        db,
        tenant_id=tenant.id,
        enrollment_id=enrollment_id,
        term_id=term_id,
        student_id=student_id,
    )


@router.put(
    "/assessments",
    response_model=list[AssessmentOut],
    dependencies=[Depends(require_permission("cbc.assessments.enter"))],
)
def bulk_upsert_assessments(
    payload: BulkAssessmentUpsert,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    rows = service.bulk_upsert_assessments(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        enrollment_id=payload.enrollment_id,
        term_id=payload.term_id,
        items=[a.model_dump() for a in payload.assessments],
    )
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


# ── Report ────────────────────────────────────────────────────────────────────

@router.get(
    "/enrollments/{enrollment_id}/term/{term_id}/report",
    response_model=LearnerReportOut,
    dependencies=[Depends(require_permission("cbc.assessments.view"))],
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
    dependencies=[Depends(require_permission("cbc.reports.generate"))],
)
def download_learner_pdf(
    enrollment_id: UUID,
    term_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    import sqlalchemy as sa
    branding_row = db.execute(
        sa.text(
            "SELECT name, brand_color, school_address, school_phone, school_email "
            "FROM core.tenants WHERE id = :tid"
        ),
        {"tid": str(tenant.id)},
    ).mappings().first()
    branding = {
        "school_name": (branding_row["name"] if branding_row else None) or "School",
        "brand_color": (branding_row["brand_color"] if branding_row else None) or "#1A4C8B",
        "school_address": (branding_row["school_address"] if branding_row else None) or "",
        "school_phone": (branding_row["school_phone"] if branding_row else None) or "",
        "school_email": (branding_row["school_email"] if branding_row else None) or "",
    }

    report_data = service.get_learner_report(
        db, tenant_id=tenant.id, enrollment_id=enrollment_id, term_id=term_id
    )
    pdf_bytes = generate_cbc_report_pdf(report_data, branding=branding)
    filename = f"cbc_report_{enrollment_id}_{term_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/classes/{class_id}/term/{term_id}/bulk-pdf",
    response_class=Response,
    dependencies=[Depends(require_permission("cbc.reports.generate"))],
)
def download_class_bulk_pdf(
    class_id: UUID,
    term_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _=Depends(get_current_user),
):
    """
    Generate a merged PDF with one report card page per student in the class.
    The class_id must be the tenant_class UUID.
    """
    import sqlalchemy as sa

    branding_row = db.execute(
        sa.text(
            "SELECT name, brand_color, school_address, school_phone, school_email "
            "FROM core.tenants WHERE id = :tid"
        ),
        {"tid": str(tenant.id)},
    ).mappings().first()
    branding = {
        "school_name": (branding_row["name"] if branding_row else None) or "School",
        "brand_color": (branding_row["brand_color"] if branding_row else None) or "#1A4C8B",
        "school_address": (branding_row["school_address"] if branding_row else None) or "",
        "school_phone": (branding_row["school_phone"] if branding_row else None) or "",
        "school_email": (branding_row["school_email"] if branding_row else None) or "",
    }

    # Get all enrollments for this class + term
    enrollments = db.execute(
        sa.text(
            """
            SELECT sce.id AS enrollment_id, s.first_name || ' ' || s.last_name AS student_name
            FROM core.student_class_enrollments sce
            JOIN core.students s ON s.id = sce.student_id
            WHERE sce.class_id = :cid
              AND sce.term_id  = :trid
              AND sce.tenant_id = :tid
            ORDER BY s.last_name, s.first_name
            """
        ),
        {"cid": str(class_id), "trid": str(term_id), "tid": str(tenant.id)},
    ).mappings().all()

    if not enrollments:
        from fastapi import HTTPException
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
            pdf_pages.append(generate_cbc_report_pdf(report_data, branding=branding))
        except Exception:
            # Skip students with no assessments
            continue

    if not pdf_pages:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=404,
            detail="No report data available for students in this class"
        )

    merged = merge_pdfs(pdf_pages)
    class_name = str(class_id)[:8]
    filename = f"cbc_bulk_report_{class_name}_{term_id}.pdf"
    return Response(
        content=merged,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
