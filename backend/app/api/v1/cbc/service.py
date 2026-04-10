"""Business logic for Phase 3B — CBC Assessments."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.cbc import CbcAssessment, CbcLearningArea, CbcStrand, CbcSubStrand

VALID_PERFORMANCE_LEVELS = {"BE", "AE", "ME", "EE"}
VALID_GRADE_BANDS = {"LOWER_PRIMARY", "UPPER_PRIMARY", "JUNIOR_SECONDARY"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_learning_area(db: Session, *, tenant_id: UUID, la_id: UUID) -> CbcLearningArea:
    row = db.execute(
        sa.select(CbcLearningArea).where(
            CbcLearningArea.id == la_id,
            CbcLearningArea.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Learning area not found")
    return row


def _require_strand(db: Session, *, tenant_id: UUID, strand_id: UUID) -> CbcStrand:
    row = db.execute(
        sa.select(CbcStrand).where(
            CbcStrand.id == strand_id,
            CbcStrand.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Strand not found")
    return row


def _require_sub_strand(db: Session, *, tenant_id: UUID, ss_id: UUID) -> CbcSubStrand:
    row = db.execute(
        sa.select(CbcSubStrand).where(
            CbcSubStrand.id == ss_id,
            CbcSubStrand.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Sub-strand not found")
    return row


# ── Learning Areas ────────────────────────────────────────────────────────────

def create_learning_area(db: Session, *, tenant_id: UUID, data: dict[str, Any]) -> CbcLearningArea:
    code = data["code"].strip().upper()
    band = data["grade_band"].upper()
    # uniqueness check
    exists = db.execute(
        sa.select(CbcLearningArea.id).where(
            CbcLearningArea.tenant_id == tenant_id,
            CbcLearningArea.code == code,
            CbcLearningArea.grade_band == band,
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail=f"Learning area code '{code}' already exists for band '{band}'")

    row = CbcLearningArea(
        tenant_id=tenant_id,
        name=data["name"].strip(),
        code=code,
        grade_band=band,
        display_order=data.get("display_order", 0),
    )
    db.add(row)
    db.flush()
    return row


def update_learning_area(db: Session, *, tenant_id: UUID, la_id: UUID, updates: dict[str, Any]) -> CbcLearningArea:
    row = _require_learning_area(db, tenant_id=tenant_id, la_id=la_id)
    if "code" in updates and updates["code"] is not None:
        new_code = updates["code"].strip().upper()
        band = updates.get("grade_band", row.grade_band).upper()
        conflict = db.execute(
            sa.select(CbcLearningArea.id).where(
                CbcLearningArea.tenant_id == tenant_id,
                CbcLearningArea.code == new_code,
                CbcLearningArea.grade_band == band,
                CbcLearningArea.id != la_id,
            )
        ).scalar_one_or_none()
        if conflict:
            raise HTTPException(status_code=409, detail=f"Code '{new_code}' already in use for band '{band}'")
        row.code = new_code
    if "name" in updates and updates["name"] is not None:
        row.name = updates["name"].strip()
    if "grade_band" in updates and updates["grade_band"] is not None:
        row.grade_band = updates["grade_band"].upper()
    if "display_order" in updates and updates["display_order"] is not None:
        row.display_order = updates["display_order"]
    if "is_active" in updates and updates["is_active"] is not None:
        row.is_active = updates["is_active"]
    row.updated_at = _now()
    db.flush()
    return row


# ── Strands ───────────────────────────────────────────────────────────────────

def create_strand(db: Session, *, tenant_id: UUID, data: dict[str, Any]) -> CbcStrand:
    la_id = data["learning_area_id"]
    _require_learning_area(db, tenant_id=tenant_id, la_id=la_id)
    code = data["code"].strip().upper()
    exists = db.execute(
        sa.select(CbcStrand.id).where(
            CbcStrand.tenant_id == tenant_id,
            CbcStrand.learning_area_id == la_id,
            CbcStrand.code == code,
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail=f"Strand code '{code}' already exists in this learning area")

    row = CbcStrand(
        tenant_id=tenant_id,
        learning_area_id=la_id,
        name=data["name"].strip(),
        code=code,
        display_order=data.get("display_order", 0),
    )
    db.add(row)
    db.flush()
    return row


def update_strand(db: Session, *, tenant_id: UUID, strand_id: UUID, updates: dict[str, Any]) -> CbcStrand:
    row = _require_strand(db, tenant_id=tenant_id, strand_id=strand_id)
    if "code" in updates and updates["code"] is not None:
        new_code = updates["code"].strip().upper()
        conflict = db.execute(
            sa.select(CbcStrand.id).where(
                CbcStrand.tenant_id == tenant_id,
                CbcStrand.learning_area_id == row.learning_area_id,
                CbcStrand.code == new_code,
                CbcStrand.id != strand_id,
            )
        ).scalar_one_or_none()
        if conflict:
            raise HTTPException(status_code=409, detail=f"Strand code '{new_code}' already in use")
        row.code = new_code
    if "name" in updates and updates["name"] is not None:
        row.name = updates["name"].strip()
    if "display_order" in updates and updates["display_order"] is not None:
        row.display_order = updates["display_order"]
    if "is_active" in updates and updates["is_active"] is not None:
        row.is_active = updates["is_active"]
    row.updated_at = _now()
    db.flush()
    return row


# ── Sub-strands ───────────────────────────────────────────────────────────────

def create_sub_strand(db: Session, *, tenant_id: UUID, data: dict[str, Any]) -> CbcSubStrand:
    strand_id = data["strand_id"]
    _require_strand(db, tenant_id=tenant_id, strand_id=strand_id)
    code = data["code"].strip().upper()
    exists = db.execute(
        sa.select(CbcSubStrand.id).where(
            CbcSubStrand.tenant_id == tenant_id,
            CbcSubStrand.strand_id == strand_id,
            CbcSubStrand.code == code,
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail=f"Sub-strand code '{code}' already exists in this strand")

    row = CbcSubStrand(
        tenant_id=tenant_id,
        strand_id=strand_id,
        name=data["name"].strip(),
        code=code,
        display_order=data.get("display_order", 0),
    )
    db.add(row)
    db.flush()
    return row


def update_sub_strand(db: Session, *, tenant_id: UUID, ss_id: UUID, updates: dict[str, Any]) -> CbcSubStrand:
    row = _require_sub_strand(db, tenant_id=tenant_id, ss_id=ss_id)
    if "code" in updates and updates["code"] is not None:
        new_code = updates["code"].strip().upper()
        conflict = db.execute(
            sa.select(CbcSubStrand.id).where(
                CbcSubStrand.tenant_id == tenant_id,
                CbcSubStrand.strand_id == row.strand_id,
                CbcSubStrand.code == new_code,
                CbcSubStrand.id != ss_id,
            )
        ).scalar_one_or_none()
        if conflict:
            raise HTTPException(status_code=409, detail=f"Sub-strand code '{new_code}' already in use")
        row.code = new_code
    if "name" in updates and updates["name"] is not None:
        row.name = updates["name"].strip()
    if "display_order" in updates and updates["display_order"] is not None:
        row.display_order = updates["display_order"]
    if "is_active" in updates and updates["is_active"] is not None:
        row.is_active = updates["is_active"]
    row.updated_at = _now()
    db.flush()
    return row


# ── Curriculum tree ───────────────────────────────────────────────────────────

def get_curriculum_tree(
    db: Session,
    *,
    tenant_id: UUID,
    grade_band: str | None = None,
    active_only: bool = True,
) -> dict[str, Any]:
    """Returns full learning_area → strand → sub_strand tree for a tenant."""
    la_q = sa.select(CbcLearningArea).where(CbcLearningArea.tenant_id == tenant_id)
    if grade_band:
        la_q = la_q.where(CbcLearningArea.grade_band == grade_band.upper())
    if active_only:
        la_q = la_q.where(CbcLearningArea.is_active.is_(True))
    la_q = la_q.order_by(CbcLearningArea.display_order, CbcLearningArea.name)
    learning_areas = db.execute(la_q).scalars().all()

    if not learning_areas:
        return {"learning_areas": []}

    la_ids = [la.id for la in learning_areas]

    strand_q = sa.select(CbcStrand).where(CbcStrand.learning_area_id.in_(la_ids))
    if active_only:
        strand_q = strand_q.where(CbcStrand.is_active.is_(True))
    strand_q = strand_q.order_by(CbcStrand.display_order, CbcStrand.name)
    strands = db.execute(strand_q).scalars().all()

    strand_ids = [s.id for s in strands]
    sub_strands: list[CbcSubStrand] = []
    if strand_ids:
        ss_q = sa.select(CbcSubStrand).where(CbcSubStrand.strand_id.in_(strand_ids))
        if active_only:
            ss_q = ss_q.where(CbcSubStrand.is_active.is_(True))
        ss_q = ss_q.order_by(CbcSubStrand.display_order, CbcSubStrand.name)
        sub_strands = db.execute(ss_q).scalars().all()

    # Build the tree
    ss_by_strand: dict[UUID, list[CbcSubStrand]] = {}
    for ss in sub_strands:
        ss_by_strand.setdefault(ss.strand_id, []).append(ss)

    strands_by_la: dict[UUID, list[dict]] = {}
    for s in strands:
        strands_by_la.setdefault(s.learning_area_id, []).append({
            "id": s.id,
            "name": s.name,
            "code": s.code,
            "display_order": s.display_order,
            "is_active": s.is_active,
            "sub_strands": [
                {
                    "id": ss.id,
                    "name": ss.name,
                    "code": ss.code,
                    "display_order": ss.display_order,
                    "is_active": ss.is_active,
                }
                for ss in ss_by_strand.get(s.id, [])
            ],
        })

    return {
        "learning_areas": [
            {
                "id": la.id,
                "name": la.name,
                "code": la.code,
                "grade_band": la.grade_band,
                "display_order": la.display_order,
                "is_active": la.is_active,
                "strands": strands_by_la.get(la.id, []),
            }
            for la in learning_areas
        ]
    }


# ── Assessments ───────────────────────────────────────────────────────────────

def bulk_upsert_assessments(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment_id: UUID,
    term_id: UUID,
    items: list[dict[str, Any]],
) -> list[CbcAssessment]:
    """Upsert a batch of assessment records for a learner in a term."""
    # Verify enrollment belongs to this tenant
    sce = db.execute(
        sa.text(
            "SELECT id, student_id FROM core.student_class_enrollments "
            "WHERE id = :eid AND tenant_id = :tid LIMIT 1"
        ),
        {"eid": str(enrollment_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not sce:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    student_id = sce["student_id"]

    # Verify term
    term = db.execute(
        sa.text("SELECT id FROM core.tenant_terms WHERE id = :tid AND tenant_id = :tnid LIMIT 1"),
        {"tid": str(term_id), "tnid": str(tenant_id)},
    ).mappings().first()
    if not term:
        raise HTTPException(status_code=404, detail="Term not found")

    now = _now()
    results: list[CbcAssessment] = []

    for item in items:
        level = item["performance_level"].upper()
        if level not in VALID_PERFORMANCE_LEVELS:
            raise HTTPException(status_code=400, detail=f"Invalid performance_level '{level}'. Use BE/AE/ME/EE")
        ss_id = item["sub_strand_id"]

        # Verify sub-strand belongs to tenant
        ss = db.execute(
            sa.select(CbcSubStrand).where(
                CbcSubStrand.id == ss_id,
                CbcSubStrand.tenant_id == tenant_id,
            )
        ).scalar_one_or_none()
        if not ss:
            raise HTTPException(status_code=404, detail=f"Sub-strand {ss_id} not found")

        existing = db.execute(
            sa.select(CbcAssessment).where(
                CbcAssessment.tenant_id == tenant_id,
                CbcAssessment.enrollment_id == enrollment_id,
                CbcAssessment.sub_strand_id == ss_id,
                CbcAssessment.term_id == term_id,
            )
        ).scalar_one_or_none()

        if existing:
            existing.performance_level = level
            existing.teacher_observations = item.get("teacher_observations")
            existing.assessed_by_user_id = actor_user_id
            existing.assessed_at = now
            existing.updated_at = now
            results.append(existing)
        else:
            row = CbcAssessment(
                tenant_id=tenant_id,
                enrollment_id=enrollment_id,
                student_id=student_id,
                sub_strand_id=ss_id,
                term_id=term_id,
                performance_level=level,
                teacher_observations=item.get("teacher_observations"),
                assessed_by_user_id=actor_user_id,
                assessed_at=now,
            )
            db.add(row)
            results.append(row)

    db.flush()
    return results


def list_assessments(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID | None = None,
    term_id: UUID | None = None,
    student_id: UUID | None = None,
) -> list[CbcAssessment]:
    q = sa.select(CbcAssessment).where(CbcAssessment.tenant_id == tenant_id)
    if enrollment_id:
        q = q.where(CbcAssessment.enrollment_id == enrollment_id)
    if term_id:
        q = q.where(CbcAssessment.term_id == term_id)
    if student_id:
        q = q.where(CbcAssessment.student_id == student_id)
    q = q.order_by(CbcAssessment.assessed_at.desc())
    return list(db.execute(q).scalars().all())


# ── Report data ───────────────────────────────────────────────────────────────

def get_learner_report(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID,
    term_id: UUID,
) -> dict[str, Any]:
    """Build a structured report dict for the learner PDF/JSON report."""
    # Enrollment + student info + term academic year
    row = db.execute(
        sa.text(
            """
            SELECT
                sce.id          AS enrollment_id,
                sce.student_id,
                s.first_name || ' ' || s.last_name AS student_name,
                s.admission_no,
                s.gender,
                TO_CHAR(s.date_of_birth, 'DD/MM/YYYY') AS date_of_birth,
                tc.name         AS class_name,
                tc.code         AS class_code,
                tt.name         AS term_name,
                tt.start_date   AS term_start_date,
                EXTRACT(YEAR FROM tt.start_date)::text AS academic_year
            FROM core.student_class_enrollments sce
            JOIN core.students s          ON s.id = sce.student_id
            JOIN core.tenant_classes tc   ON tc.id = sce.class_id
            JOIN core.tenant_terms tt     ON tt.id = sce.term_id
            WHERE sce.id = :eid AND sce.tenant_id = :tid
            """
        ),
        {"eid": str(enrollment_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    # Remarks (class teacher comment, principal comment, conduct, next_term_begins)
    remarks_row = db.execute(
        sa.text(
            """
            SELECT class_teacher_comment, principal_comment, conduct,
                   TO_CHAR(next_term_begins, 'DD MMM YYYY') AS next_term_begins
            FROM core.term_report_remarks
            WHERE tenant_id = :tid
              AND student_enrollment_id = :eid
              AND term_id = :trid
            LIMIT 1
            """
        ),
        {"tid": str(tenant_id), "eid": str(enrollment_id), "trid": str(term_id)},
    ).mappings().first()

    # Auto-fill next_term_begins from the next sequential term if not in remarks
    next_term_begins = remarks_row["next_term_begins"] if remarks_row else None
    if not next_term_begins and row["term_start_date"]:
        next_term_row = db.execute(
            sa.text(
                """
                SELECT TO_CHAR(start_date, 'DD MMM YYYY') AS start_date
                FROM core.tenant_terms
                WHERE tenant_id = :tid
                  AND start_date > :cur_start
                ORDER BY start_date ASC
                LIMIT 1
                """
            ),
            {"tid": str(tenant_id), "cur_start": row["term_start_date"]},
        ).mappings().first()
        if next_term_row:
            next_term_begins = next_term_row["start_date"]

    # All assessments for this enrollment + term
    assessments = db.execute(
        sa.text(
            """
            SELECT
                a.sub_strand_id,
                a.performance_level,
                a.teacher_observations,
                ss.name     AS sub_strand_name,
                ss.code     AS sub_strand_code,
                ss.strand_id,
                st.name     AS strand_name,
                st.code     AS strand_code,
                st.learning_area_id,
                la.name     AS learning_area_name,
                la.code     AS learning_area_code,
                la.grade_band
            FROM core.cbc_assessments a
            JOIN core.cbc_sub_strands ss   ON ss.id = a.sub_strand_id
            JOIN core.cbc_strands st       ON st.id = ss.strand_id
            JOIN core.cbc_learning_areas la ON la.id = st.learning_area_id
            WHERE a.enrollment_id = :eid
              AND a.term_id       = :trid
              AND a.tenant_id     = :tnid
            ORDER BY la.display_order, la.name, st.display_order, st.name,
                     ss.display_order, ss.name
            """
        ),
        {"eid": str(enrollment_id), "trid": str(term_id), "tnid": str(tenant_id)},
    ).mappings().all()

    # Assemble tree
    la_map: dict[str, dict] = {}
    for a in assessments:
        la_id = str(a["learning_area_id"])
        if la_id not in la_map:
            la_map[la_id] = {
                "learning_area_id": a["learning_area_id"],
                "learning_area_name": a["learning_area_name"],
                "learning_area_code": a["learning_area_code"],
                "grade_band": a["grade_band"],
                "strands": {},
            }
        strand_id = str(a["strand_id"])
        if strand_id not in la_map[la_id]["strands"]:
            la_map[la_id]["strands"][strand_id] = {
                "strand_id": a["strand_id"],
                "strand_name": a["strand_name"],
                "strand_code": a["strand_code"],
                "sub_strands": [],
            }
        la_map[la_id]["strands"][strand_id]["sub_strands"].append({
            "sub_strand_id": a["sub_strand_id"],
            "sub_strand_name": a["sub_strand_name"],
            "sub_strand_code": a["sub_strand_code"],
            "performance_level": a["performance_level"],
            "teacher_observations": a["teacher_observations"],
        })

    learning_areas = []
    for la in la_map.values():
        la["strands"] = list(la["strands"].values())
        learning_areas.append(la)

    return {
        "enrollment_id": row["enrollment_id"],
        "student_id": row["student_id"],
        "student_name": row["student_name"],
        "admission_no": row["admission_no"],
        "gender": row["gender"] or "",
        "date_of_birth": row["date_of_birth"] or "",
        "class_name": row["class_name"],
        "class_code": row["class_code"],
        "term_name": row["term_name"],
        "academic_year": row["academic_year"] or "",
        "class_teacher_comment": (remarks_row["class_teacher_comment"] if remarks_row else None) or "",
        "principal_comment": (remarks_row["principal_comment"] if remarks_row else None) or "",
        "conduct": (remarks_row["conduct"] if remarks_row else None) or "",
        "next_term_begins": next_term_begins or "",
        "learning_areas": learning_areas,
    }


# ── Seed default CBC curriculum ───────────────────────────────────────────────

_DEFAULT_CURRICULUM = {
    "LOWER_PRIMARY": [
        {"name": "English Activities",         "code": "ENG-LP",  "strands": [
            {"name": "Listening and Speaking", "code": "LS", "sub_strands": [
                {"name": "Listening Skills",    "code": "LS1"},
                {"name": "Speaking Skills",     "code": "LS2"},
            ]},
            {"name": "Reading",                "code": "RD", "sub_strands": [
                {"name": "Phonological Awareness","code": "RD1"},
                {"name": "Reading Fluency",     "code": "RD2"},
                {"name": "Reading Comprehension","code": "RD3"},
            ]},
            {"name": "Writing",                "code": "WR", "sub_strands": [
                {"name": "Pre-Writing Skills",  "code": "WR1"},
                {"name": "Writing Sentences",   "code": "WR2"},
            ]},
        ]},
        {"name": "Kiswahili Activities",        "code": "KSW-LP", "strands": [
            {"name": "Kusikiliza na Kuongea",   "code": "KO", "sub_strands": [
                {"name": "Kusikiliza",          "code": "KO1"},
                {"name": "Kuongea",             "code": "KO2"},
            ]},
            {"name": "Kusoma",                  "code": "KS", "sub_strands": [
                {"name": "Ufafanuzi wa Sauti",  "code": "KS1"},
                {"name": "Usomaji wa Sentensi", "code": "KS2"},
            ]},
        ]},
        {"name": "Mathematical Activities",     "code": "MTH-LP", "strands": [
            {"name": "Numbers",                 "code": "NUM", "sub_strands": [
                {"name": "Counting",            "code": "NUM1"},
                {"name": "Place Value",         "code": "NUM2"},
                {"name": "Addition",            "code": "NUM3"},
                {"name": "Subtraction",         "code": "NUM4"},
            ]},
            {"name": "Measurement",             "code": "MEAS", "sub_strands": [
                {"name": "Length",              "code": "MEAS1"},
                {"name": "Mass",                "code": "MEAS2"},
            ]},
            {"name": "Geometry",                "code": "GEO", "sub_strands": [
                {"name": "2D Shapes",           "code": "GEO1"},
                {"name": "3D Objects",          "code": "GEO2"},
            ]},
        ]},
        {"name": "Environmental Activities",    "code": "ENV-LP", "strands": [
            {"name": "Living Things",           "code": "LT", "sub_strands": [
                {"name": "Plants",              "code": "LT1"},
                {"name": "Animals",             "code": "LT2"},
                {"name": "Human Body",          "code": "LT3"},
            ]},
            {"name": "Our Environment",        "code": "OE", "sub_strands": [
                {"name": "Physical Environment","code": "OE1"},
                {"name": "Weather",             "code": "OE2"},
            ]},
        ]},
        {"name": "Creative Activities",         "code": "CRT-LP", "strands": [
            {"name": "Art and Craft",           "code": "AC", "sub_strands": [
                {"name": "Drawing",             "code": "AC1"},
                {"name": "Modelling",           "code": "AC2"},
            ]},
            {"name": "Music",                   "code": "MUS", "sub_strands": [
                {"name": "Singing",             "code": "MUS1"},
                {"name": "Rhythm",              "code": "MUS2"},
            ]},
            {"name": "Physical Education",      "code": "PE", "sub_strands": [
                {"name": "Motor Skills",        "code": "PE1"},
                {"name": "Games",               "code": "PE2"},
            ]},
        ]},
        {"name": "Religious Education",         "code": "RE-LP",  "strands": [
            {"name": "Religious Practices",    "code": "RP", "sub_strands": [
                {"name": "Prayer and Worship",  "code": "RP1"},
                {"name": "Values and Morals",   "code": "RP2"},
            ]},
        ]},
    ],
    "UPPER_PRIMARY": [
        {"name": "English Language",            "code": "ENG-UP",  "strands": [
            {"name": "Listening and Speaking",  "code": "LS", "sub_strands": [
                {"name": "Listening Comprehension","code": "LS1"},
                {"name": "Oral Communication",  "code": "LS2"},
            ]},
            {"name": "Reading",                 "code": "RD", "sub_strands": [
                {"name": "Reading Comprehension","code": "RD1"},
                {"name": "Critical Reading",    "code": "RD2"},
            ]},
            {"name": "Writing",                 "code": "WR", "sub_strands": [
                {"name": "Creative Writing",    "code": "WR1"},
                {"name": "Functional Writing",  "code": "WR2"},
            ]},
            {"name": "Grammar",                 "code": "GR", "sub_strands": [
                {"name": "Parts of Speech",     "code": "GR1"},
                {"name": "Sentence Structure",  "code": "GR2"},
            ]},
        ]},
        {"name": "Kiswahili Language",          "code": "KSW-UP", "strands": [
            {"name": "Kusikiliza na Kuongea",   "code": "KO", "sub_strands": [
                {"name": "Kusikiliza Makini",   "code": "KO1"},
                {"name": "Mazungumzo",          "code": "KO2"},
            ]},
            {"name": "Kusoma",                  "code": "KS", "sub_strands": [
                {"name": "Ufahamu",             "code": "KS1"},
                {"name": "Matumizi ya Lugha",   "code": "KS2"},
            ]},
            {"name": "Kuandika",                "code": "KA", "sub_strands": [
                {"name": "Insha",               "code": "KA1"},
                {"name": "Barua",               "code": "KA2"},
            ]},
        ]},
        {"name": "Mathematics",                 "code": "MTH-UP", "strands": [
            {"name": "Numbers",                 "code": "NUM", "sub_strands": [
                {"name": "Whole Numbers",       "code": "NUM1"},
                {"name": "Fractions",           "code": "NUM2"},
                {"name": "Decimals",            "code": "NUM3"},
            ]},
            {"name": "Algebra",                 "code": "ALG", "sub_strands": [
                {"name": "Patterns",            "code": "ALG1"},
                {"name": "Simple Equations",    "code": "ALG2"},
            ]},
            {"name": "Measurement",             "code": "MEAS", "sub_strands": [
                {"name": "Length, Mass, Volume","code": "MEAS1"},
                {"name": "Time",                "code": "MEAS2"},
                {"name": "Money",               "code": "MEAS3"},
            ]},
            {"name": "Geometry",                "code": "GEO", "sub_strands": [
                {"name": "Shapes and Angles",   "code": "GEO1"},
                {"name": "Area and Perimeter",  "code": "GEO2"},
            ]},
            {"name": "Statistics",              "code": "STAT", "sub_strands": [
                {"name": "Data Handling",       "code": "STAT1"},
            ]},
        ]},
        {"name": "Integrated Science",          "code": "SCI-UP", "strands": [
            {"name": "Living Things",           "code": "LT", "sub_strands": [
                {"name": "Plants",              "code": "LT1"},
                {"name": "Animals",             "code": "LT2"},
                {"name": "Human Biology",       "code": "LT3"},
            ]},
            {"name": "Physical Sciences",       "code": "PHY", "sub_strands": [
                {"name": "Forces and Motion",   "code": "PHY1"},
                {"name": "Light and Sound",     "code": "PHY2"},
            ]},
            {"name": "Earth Sciences",          "code": "ETH", "sub_strands": [
                {"name": "Soil",                "code": "ETH1"},
                {"name": "Water",               "code": "ETH2"},
            ]},
        ]},
        {"name": "Social Studies",              "code": "SS-UP",  "strands": [
            {"name": "Our Community",           "code": "OC", "sub_strands": [
                {"name": "Family and School",   "code": "OC1"},
                {"name": "Neighbourhood",       "code": "OC2"},
            ]},
            {"name": "Our Country Kenya",       "code": "KE", "sub_strands": [
                {"name": "Counties and Regions","code": "KE1"},
                {"name": "National Values",     "code": "KE2"},
            ]},
        ]},
        {"name": "Agriculture & Nutrition",     "code": "AGR-UP", "strands": [
            {"name": "Crop Production",         "code": "CP", "sub_strands": [
                {"name": "Food Crops",          "code": "CP1"},
                {"name": "Cash Crops",          "code": "CP2"},
            ]},
            {"name": "Nutrition",               "code": "NUT", "sub_strands": [
                {"name": "Food Groups",         "code": "NUT1"},
                {"name": "Balanced Diet",       "code": "NUT2"},
            ]},
        ]},
        {"name": "Creative Arts & Sports",      "code": "CAS-UP", "strands": [
            {"name": "Visual Arts",             "code": "VA", "sub_strands": [
                {"name": "Drawing and Painting","code": "VA1"},
                {"name": "Craft Work",          "code": "VA2"},
            ]},
            {"name": "Music",                   "code": "MUS", "sub_strands": [
                {"name": "Vocal Music",         "code": "MUS1"},
                {"name": "Instrumental Music",  "code": "MUS2"},
            ]},
            {"name": "Physical Education",      "code": "PE", "sub_strands": [
                {"name": "Athletics",           "code": "PE1"},
                {"name": "Games and Sports",    "code": "PE2"},
            ]},
        ]},
        {"name": "Religious Education",         "code": "RE-UP",  "strands": [
            {"name": "Religious Practices",    "code": "RP", "sub_strands": [
                {"name": "Faith and Belief",    "code": "RP1"},
                {"name": "Values",              "code": "RP2"},
            ]},
        ]},
        {"name": "Pre-Technical Studies",       "code": "PTS-UP", "strands": [
            {"name": "Drawing and Design",      "code": "DD", "sub_strands": [
                {"name": "Technical Drawing",   "code": "DD1"},
                {"name": "Design Process",      "code": "DD2"},
            ]},
            {"name": "Workshop Practice",       "code": "WP", "sub_strands": [
                {"name": "Safety",              "code": "WP1"},
                {"name": "Basic Skills",        "code": "WP2"},
            ]},
        ]},
    ],
    "JUNIOR_SECONDARY": [
        {"name": "English",                     "code": "ENG-JS", "strands": [
            {"name": "Listening and Speaking",  "code": "LS", "sub_strands": [
                {"name": "Listening Comprehension","code": "LS1"},
                {"name": "Public Speaking",     "code": "LS2"},
            ]},
            {"name": "Reading",                 "code": "RD", "sub_strands": [
                {"name": "Reading for Meaning", "code": "RD1"},
                {"name": "Literary Appreciation","code": "RD2"},
            ]},
            {"name": "Writing",                 "code": "WR", "sub_strands": [
                {"name": "Essay Writing",       "code": "WR1"},
                {"name": "Report Writing",      "code": "WR2"},
            ]},
        ]},
        {"name": "Kiswahili",                   "code": "KSW-JS", "strands": [
            {"name": "Kusikiliza na Kuongea",   "code": "KO", "sub_strands": [
                {"name": "Hotuba",              "code": "KO1"},
                {"name": "Midahalo",            "code": "KO2"},
            ]},
            {"name": "Kusoma",                  "code": "KS", "sub_strands": [
                {"name": "Ufahamu wa Kina",     "code": "KS1"},
                {"name": "Fasihi",              "code": "KS2"},
            ]},
            {"name": "Kuandika",                "code": "KA", "sub_strands": [
                {"name": "Insha ya Hoja",       "code": "KA1"},
                {"name": "Barua Rasmi",         "code": "KA2"},
            ]},
        ]},
        {"name": "Mathematics",                 "code": "MTH-JS", "strands": [
            {"name": "Numbers",                 "code": "NUM", "sub_strands": [
                {"name": "Integers",            "code": "NUM1"},
                {"name": "Rational Numbers",    "code": "NUM2"},
            ]},
            {"name": "Algebra",                 "code": "ALG", "sub_strands": [
                {"name": "Linear Equations",    "code": "ALG1"},
                {"name": "Simultaneous Equations","code": "ALG2"},
                {"name": "Quadratic Expressions","code": "ALG3"},
            ]},
            {"name": "Geometry",                "code": "GEO", "sub_strands": [
                {"name": "Angles",              "code": "GEO1"},
                {"name": "Triangles",           "code": "GEO2"},
                {"name": "Circles",             "code": "GEO3"},
            ]},
            {"name": "Statistics and Probability","code": "SP", "sub_strands": [
                {"name": "Data Collection",     "code": "SP1"},
                {"name": "Probability",         "code": "SP2"},
            ]},
        ]},
        {"name": "Integrated Science",          "code": "SCI-JS", "strands": [
            {"name": "Biology",                 "code": "BIO", "sub_strands": [
                {"name": "Cell Biology",        "code": "BIO1"},
                {"name": "Ecology",             "code": "BIO2"},
            ]},
            {"name": "Chemistry",               "code": "CHEM", "sub_strands": [
                {"name": "Matter",              "code": "CHEM1"},
                {"name": "Chemical Reactions",  "code": "CHEM2"},
            ]},
            {"name": "Physics",                 "code": "PHY", "sub_strands": [
                {"name": "Motion and Forces",   "code": "PHY1"},
                {"name": "Electricity",         "code": "PHY2"},
            ]},
        ]},
        {"name": "Social Studies",              "code": "SS-JS",  "strands": [
            {"name": "History and Government",  "code": "HG", "sub_strands": [
                {"name": "Pre-Colonial Period", "code": "HG1"},
                {"name": "Colonial Period",     "code": "HG2"},
                {"name": "Post-Independence",   "code": "HG3"},
            ]},
            {"name": "Geography",               "code": "GEO", "sub_strands": [
                {"name": "Physical Geography",  "code": "GEO1"},
                {"name": "Human Geography",     "code": "GEO2"},
            ]},
        ]},
        {"name": "Agriculture",                 "code": "AGR-JS", "strands": [
            {"name": "Crop Production",         "code": "CP", "sub_strands": [
                {"name": "Soil Preparation",    "code": "CP1"},
                {"name": "Crop Management",     "code": "CP2"},
            ]},
            {"name": "Animal Production",       "code": "AP", "sub_strands": [
                {"name": "Livestock Keeping",   "code": "AP1"},
                {"name": "Poultry",             "code": "AP2"},
            ]},
        ]},
        {"name": "Pre-Technical & Pre-Career Education","code": "PTCE-JS","strands": [
            {"name": "Design and Technology",   "code": "DT", "sub_strands": [
                {"name": "Design Process",      "code": "DT1"},
                {"name": "Materials and Tools", "code": "DT2"},
            ]},
            {"name": "Career Guidance",         "code": "CG", "sub_strands": [
                {"name": "Self-Awareness",      "code": "CG1"},
                {"name": "Career Exploration",  "code": "CG2"},
            ]},
        ]},
        {"name": "Creative Arts & Sports",      "code": "CAS-JS", "strands": [
            {"name": "Visual Arts",             "code": "VA", "sub_strands": [
                {"name": "Painting",            "code": "VA1"},
                {"name": "Sculpture",           "code": "VA2"},
            ]},
            {"name": "Performing Arts",         "code": "PA", "sub_strands": [
                {"name": "Drama",               "code": "PA1"},
                {"name": "Music Performance",   "code": "PA2"},
            ]},
            {"name": "Sports",                  "code": "SP", "sub_strands": [
                {"name": "Athletics",           "code": "SP1"},
                {"name": "Team Sports",         "code": "SP2"},
            ]},
        ]},
        {"name": "Religious Education",         "code": "RE-JS",  "strands": [
            {"name": "Faith Traditions",        "code": "FT", "sub_strands": [
                {"name": "Christian Education", "code": "FT1"},
                {"name": "Islamic Education",   "code": "FT2"},
            ]},
            {"name": "Ethics and Morality",     "code": "EM", "sub_strands": [
                {"name": "Personal Ethics",     "code": "EM1"},
                {"name": "Social Ethics",       "code": "EM2"},
            ]},
        ]},
        {"name": "Life Skills Education",       "code": "LS-JS",  "strands": [
            {"name": "Personal Development",    "code": "PD", "sub_strands": [
                {"name": "Self-Esteem",         "code": "PD1"},
                {"name": "Goal Setting",        "code": "PD2"},
            ]},
            {"name": "Social Skills",           "code": "SOC", "sub_strands": [
                {"name": "Communication",       "code": "SOC1"},
                {"name": "Conflict Resolution", "code": "SOC2"},
            ]},
        ]},
    ],
}


def seed_default_curriculum(db: Session, *, tenant_id: UUID) -> None:
    """Seed the default Kenya CBC curriculum for a tenant (idempotent)."""
    for band, areas in _DEFAULT_CURRICULUM.items():
        for i, la_data in enumerate(areas):
            # Check if already seeded
            existing_la = db.execute(
                sa.select(CbcLearningArea).where(
                    CbcLearningArea.tenant_id == tenant_id,
                    CbcLearningArea.code == la_data["code"],
                    CbcLearningArea.grade_band == band,
                )
            ).scalar_one_or_none()

            if not existing_la:
                existing_la = CbcLearningArea(
                    tenant_id=tenant_id,
                    name=la_data["name"],
                    code=la_data["code"],
                    grade_band=band,
                    display_order=i,
                )
                db.add(existing_la)
                db.flush()

            for j, strand_data in enumerate(la_data.get("strands", [])):
                existing_s = db.execute(
                    sa.select(CbcStrand).where(
                        CbcStrand.tenant_id == tenant_id,
                        CbcStrand.learning_area_id == existing_la.id,
                        CbcStrand.code == strand_data["code"],
                    )
                ).scalar_one_or_none()

                if not existing_s:
                    existing_s = CbcStrand(
                        tenant_id=tenant_id,
                        learning_area_id=existing_la.id,
                        name=strand_data["name"],
                        code=strand_data["code"],
                        display_order=j,
                    )
                    db.add(existing_s)
                    db.flush()

                for k, ss_data in enumerate(strand_data.get("sub_strands", [])):
                    existing_ss = db.execute(
                        sa.select(CbcSubStrand).where(
                            CbcSubStrand.tenant_id == tenant_id,
                            CbcSubStrand.strand_id == existing_s.id,
                            CbcSubStrand.code == ss_data["code"],
                        )
                    ).scalar_one_or_none()
                    if not existing_ss:
                        db.add(CbcSubStrand(
                            tenant_id=tenant_id,
                            strand_id=existing_s.id,
                            name=ss_data["name"],
                            code=ss_data["code"],
                            display_order=k,
                        ))

    db.flush()
