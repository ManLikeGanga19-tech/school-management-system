#!/usr/bin/env python3
"""Extend the ShuleHQ Demo School with CBC curriculum, class enrollments,
CBC assessments, attendance sessions, and staff directory.

Run AFTER seed_demo.py:
  docker exec sms-backend python scripts/seed_demo_extended.py

Idempotent — safe to run multiple times.
"""
from __future__ import annotations

import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select, text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import SessionLocal
from app.models.attendance import AttendanceSession, StudentClassEnrollment
from app.models.cbc import CbcAssessment, CbcLearningArea, CbcStrand, CbcSubStrand
from app.models.student import Student
from app.models.tenant import Tenant
from app.models.tenant_class import TenantClass
from app.models.tenant_term import TenantTerm
from app.models.user import User

DEMO_SLUG = "demo"

# ── Kenya CBC Upper Primary curriculum (Grade 4–8) ───────────────────────────
# Structure: (learning_area_code, learning_area_name, display_order, [
#               (strand_code, strand_name, display_order, [
#                   (sub_strand_code, sub_strand_name, display_order),
#               ])
#            ])
UPPER_PRIMARY_CURRICULUM = [
    ("ENG", "English", 1, [
        ("LIST", "Listening and Speaking", 1, [
            ("LIST-1", "Listening Skills", 1),
            ("LIST-2", "Speaking Skills", 2),
        ]),
        ("READ", "Reading", 2, [
            ("READ-1", "Phonics and Word Recognition", 1),
            ("READ-2", "Reading Fluency", 2),
            ("READ-3", "Reading Comprehension", 3),
        ]),
        ("WRIT", "Writing", 3, [
            ("WRIT-1", "Handwriting and Neatness", 1),
            ("WRIT-2", "Creative Writing", 2),
            ("WRIT-3", "Grammar and Punctuation", 3),
        ]),
    ]),
    ("KIS", "Kiswahili", 2, [
        ("KUSK", "Kusikiliza na Kuzungumza", 1, [
            ("KUSK-1", "Kusikiliza", 1),
            ("KUSK-2", "Kuzungumza", 2),
        ]),
        ("KUSO", "Kusoma", 2, [
            ("KUSO-1", "Usomaji wa Haraka", 1),
            ("KUSO-2", "Ufahamu wa Kusoma", 2),
        ]),
        ("KUAD", "Kuandika", 3, [
            ("KUAD-1", "Uandishi wa Insha", 1),
            ("KUAD-2", "Sarufi na Uakifishaji", 2),
        ]),
    ]),
    ("MTH", "Mathematics", 3, [
        ("NUMB", "Numbers", 1, [
            ("NUMB-1", "Whole Numbers", 1),
            ("NUMB-2", "Fractions", 2),
            ("NUMB-3", "Decimals", 3),
        ]),
        ("MEAS", "Measurement", 2, [
            ("MEAS-1", "Length, Mass and Volume", 1),
            ("MEAS-2", "Time and Money", 2),
        ]),
        ("GEOM", "Geometry", 3, [
            ("GEOM-1", "2D and 3D Shapes", 1),
            ("GEOM-2", "Angles", 2),
        ]),
        ("STAT", "Data Handling", 4, [
            ("STAT-1", "Data Collection and Representation", 1),
            ("STAT-2", "Interpretation of Data", 2),
        ]),
    ]),
    ("SCI", "Integrated Science", 4, [
        ("LIVI", "Living Things", 1, [
            ("LIVI-1", "Plants", 1),
            ("LIVI-2", "Animals", 2),
            ("LIVI-3", "Human Body", 3),
        ]),
        ("PHYS", "Physical Environment", 2, [
            ("PHYS-1", "Matter and Its Properties", 1),
            ("PHYS-2", "Energy", 2),
        ]),
        ("HEAL", "Health and Nutrition", 3, [
            ("HEAL-1", "Nutrition and Diet", 1),
            ("HEAL-2", "Diseases and Prevention", 2),
        ]),
    ]),
    ("SST", "Social Studies", 5, [
        ("GEO", "Geography", 1, [
            ("GEO-1", "Physical Features of Kenya", 1),
            ("GEO-2", "Climate and Weather", 2),
        ]),
        ("HIS", "History", 2, [
            ("HIS-1", "Pre-Colonial Kenya", 1),
            ("HIS-2", "Colonial Kenya", 2),
        ]),
        ("CIV", "Civics", 3, [
            ("CIV-1", "Government and Leadership", 1),
            ("CIV-2", "Rights and Responsibilities", 2),
        ]),
    ]),
    ("CRE", "Christian Religious Education", 6, [
        ("BIBL", "Biblical Stories", 1, [
            ("BIBL-1", "Old Testament Stories", 1),
            ("BIBL-2", "New Testament Stories", 2),
        ]),
        ("MVAL", "Moral Values", 2, [
            ("MVAL-1", "Honesty and Integrity", 1),
            ("MVAL-2", "Respect and Responsibility", 2),
        ]),
    ]),
    ("CAS", "Creative Arts and Sports", 7, [
        ("VART", "Visual Arts", 1, [
            ("VART-1", "Drawing and Painting", 1),
            ("VART-2", "Craft Work", 2),
        ]),
        ("MUSC", "Music", 2, [
            ("MUSC-1", "Singing and Rhythm", 1),
            ("MUSC-2", "Musical Instruments", 2),
        ]),
        ("SPRT", "Sports and Physical Education", 3, [
            ("SPRT-1", "Athletics", 1),
            ("SPRT-2", "Team Games", 2),
        ]),
    ]),
    ("AGR", "Agriculture and Nutrition", 8, [
        ("CROP", "Crop Production", 1, [
            ("CROP-1", "Planting and Weeding", 1),
            ("CROP-2", "Harvesting and Storage", 2),
        ]),
        ("NUTR", "Nutrition", 2, [
            ("NUTR-1", "Food Groups", 1),
            ("NUTR-2", "Balanced Diet", 2),
        ]),
    ]),
]

# Performance levels with weighted distribution (realistic demo data)
# More ME and AE than EE and BE
LEVELS = ["EE", "ME", "ME", "ME", "AE", "AE", "BE"]

STAFF_DATA = [
    ("STF-D01", "Demo", "Director",   "ADMINISTRATION", "director@demo.shulehq.co.ke",   "+254700000001", 85000),
    ("STF-S01", "Demo", "Secretary",  "ADMINISTRATION", "secretary@demo.shulehq.co.ke",  "+254700000002", 45000),
    ("STF-T01", "Demo", "Teacher",    "TEACHING",       "teacher@demo.shulehq.co.ke",    "+254700000003", 55000),
    ("STF-T02", "Amina",   "Odhiambo","TEACHING",       "amina.odhiambo@demo.shulehq.co.ke", "+254700000004", 52000),
    ("STF-T03", "Patrick", "Kamau",   "TEACHING",       "patrick.kamau@demo.shulehq.co.ke",  "+254700000005", 52000),
]


# ── helpers ──────────────────────────────────────────────────────────────────

def _seed_curriculum(db, *, tenant_id) -> dict[str, CbcSubStrand]:
    """Seed CBC learning areas → strands → sub-strands for demo tenant.
    Returns mapping {sub_strand_code: CbcSubStrand} for use when seeding assessments.
    """
    ss_map: dict[str, CbcSubStrand] = {}

    for la_code, la_name, la_order, strands in UPPER_PRIMARY_CURRICULUM:
        la = db.execute(
            select(CbcLearningArea).where(
                CbcLearningArea.tenant_id == tenant_id,
                CbcLearningArea.code == la_code,
                CbcLearningArea.grade_band == "UPPER_PRIMARY",
            )
        ).scalar_one_or_none()
        if not la:
            la = CbcLearningArea(
                id=uuid4(), tenant_id=tenant_id, name=la_name,
                code=la_code, grade_band="UPPER_PRIMARY",
                display_order=la_order, is_active=True,
            )
            db.add(la)
            db.flush()
            print(f"  [+] learning area: {la_name}")

        for st_code, st_name, st_order, sub_strands in strands:
            strand = db.execute(
                select(CbcStrand).where(
                    CbcStrand.tenant_id == tenant_id,
                    CbcStrand.learning_area_id == la.id,
                    CbcStrand.code == st_code,
                )
            ).scalar_one_or_none()
            if not strand:
                strand = CbcStrand(
                    id=uuid4(), tenant_id=tenant_id, learning_area_id=la.id,
                    name=st_name, code=st_code, display_order=st_order, is_active=True,
                )
                db.add(strand)
                db.flush()

            for ss_code, ss_name, ss_order in sub_strands:
                ss = db.execute(
                    select(CbcSubStrand).where(
                        CbcSubStrand.tenant_id == tenant_id,
                        CbcSubStrand.strand_id == strand.id,
                        CbcSubStrand.code == ss_code,
                    )
                ).scalar_one_or_none()
                if not ss:
                    ss = CbcSubStrand(
                        id=uuid4(), tenant_id=tenant_id, strand_id=strand.id,
                        name=ss_name, code=ss_code, display_order=ss_order, is_active=True,
                    )
                    db.add(ss)
                    db.flush()
                ss_map[ss_code] = ss

    return ss_map


def _seed_student_class_enrollments(db, *, tenant_id, teacher_id) -> dict[str, StudentClassEnrollment]:
    """Link every student to their class + T1 term in student_class_enrollments.
    Returns {student_id_str: sce}.
    """
    sce_map: dict[str, StudentClassEnrollment] = {}

    students = db.execute(
        select(Student).where(Student.tenant_id == tenant_id, Student.status == "ACTIVE")
    ).scalars().all()

    # Build class code → TenantClass map
    classes = {
        c.code: c for c in db.execute(
            select(TenantClass).where(TenantClass.tenant_id == tenant_id)
        ).scalars().all()
    }

    # Get enrollment payload to know each student's class_code
    enr_map = {}
    rows = db.execute(
        text("SELECT student_id, payload FROM core.enrollments WHERE tenant_id = :t AND student_id IS NOT NULL"),
        {"t": str(tenant_id)},
    ).mappings().all()
    for row in rows:
        enr_map[str(row["student_id"])] = dict(row["payload"] or {})

    term1 = db.execute(
        select(TenantTerm).where(TenantTerm.tenant_id == tenant_id, TenantTerm.code == "2026-T1")
    ).scalar_one_or_none()
    term2 = db.execute(
        select(TenantTerm).where(TenantTerm.tenant_id == tenant_id, TenantTerm.code == "2026-T2")
    ).scalar_one_or_none()

    created = 0
    for student in students:
        payload = enr_map.get(str(student.id), {})
        cls_code = payload.get("class_code") or payload.get("admission_class")
        cls = classes.get(cls_code)
        if not cls:
            continue

        for term in [t for t in [term1, term2] if t]:
            existing = db.execute(
                select(StudentClassEnrollment).where(
                    StudentClassEnrollment.tenant_id == tenant_id,
                    StudentClassEnrollment.student_id == student.id,
                    StudentClassEnrollment.class_id == cls.id,
                    StudentClassEnrollment.term_id == term.id,
                )
            ).scalar_one_or_none()

            if not existing:
                existing = StudentClassEnrollment(
                    id=uuid4(), tenant_id=tenant_id,
                    student_id=student.id, class_id=cls.id,
                    term_id=term.id, status="ACTIVE",
                    created_by_user_id=teacher_id,
                )
                db.add(existing)
                db.flush()
                created += 1

            if term.code == "2026-T1":
                sce_map[str(student.id)] = existing

    print(f"  [+] created {created} student_class_enrollment records")
    return sce_map


def _seed_cbc_assessments(db, *, tenant_id, teacher_id, sce_map, ss_map, term_id) -> None:
    """Seed CBC summative assessments for T1 for all students."""
    rng = random.Random(42)  # fixed seed for reproducible data

    existing_count = db.execute(
        text("SELECT count(*) FROM core.cbc_assessments WHERE tenant_id = :t"),
        {"t": str(tenant_id)},
    ).scalar()
    if existing_count > 0:
        print(f"  [skip] {existing_count} CBC assessments already exist")
        return

    ss_list = list(ss_map.values())
    created = 0
    now = datetime.now(timezone.utc)

    for student_id_str, sce in sce_map.items():
        for ss in ss_list:
            level = rng.choice(LEVELS)
            obs = None
            if level == "EE":
                obs = "Excellent performance. Demonstrates deep understanding."
            elif level == "BE":
                obs = "Needs additional support. Will monitor progress closely."

            db.add(CbcAssessment(
                id=uuid4(),
                tenant_id=tenant_id,
                enrollment_id=sce.id,
                student_id=sce.student_id,
                sub_strand_id=ss.id,
                term_id=term_id,
                assessment_type="SUMMATIVE",
                checkpoint_no=1,
                performance_level=level,
                teacher_observations=obs,
                assessed_by_user_id=teacher_id,
                assessed_at=now,
            ))
        created += 1
        if created % 5 == 0:
            db.flush()

    db.flush()
    total = created * len(ss_list)
    print(f"  [+] {total} CBC assessment records across {created} students")


def _seed_attendance(db, *, tenant_id, teacher_id, sce_map, class_id_map, term1, enr_map) -> None:
    """Seed 10 attendance sessions per class for T1."""
    existing = db.execute(
        text("SELECT count(*) FROM core.attendance_sessions WHERE tenant_id = :t"),
        {"t": str(tenant_id)},
    ).scalar()
    if existing > 0:
        print(f"  [skip] {existing} attendance sessions already exist")
        return

    rng = random.Random(99)
    start = term1.start_date
    sessions_created = 0
    records_created = 0

    # Group SCE by class
    class_students: dict[str, list] = {}
    students = db.execute(
        select(Student).where(Student.tenant_id == tenant_id, Student.status == "ACTIVE")
    ).scalars().all()

    enr_map = {}
    rows = db.execute(
        text("SELECT student_id, payload FROM core.enrollments WHERE tenant_id = :t AND student_id IS NOT NULL"),
        {"t": str(tenant_id)},
    ).mappings().all()
    for row in rows:
        enr_map[str(row["student_id"])] = dict(row["payload"] or {})

    for student in students:
        sid = str(student.id)
        payload = enr_map.get(sid, {})
        cls_code = payload.get("class_code") or payload.get("admission_class")
        if cls_code:
            class_students.setdefault(cls_code, []).append(student)

    for cls_code, cls_id in class_id_map.items():
        s_list = class_students.get(cls_code, [])
        if not s_list:
            continue

        for week in range(10):
            session_date = start + timedelta(days=week * 7)
            if session_date.weekday() >= 5:  # skip weekends
                session_date += timedelta(days=2)

            session = AttendanceSession(
                id=uuid4(), tenant_id=tenant_id,
                class_id=cls_id, term_id=term1.id,
                session_date=session_date,
                session_type="MORNING",
                period_number=1,
                status="FINALIZED",
                marked_by_user_id=teacher_id,
            )
            db.add(session)
            db.flush()
            sessions_created += 1

            for student in s_list:
                sid_str = str(student.id)
                sce = sce_map.get(sid_str)
                # 90% present, 5% absent, 5% late
                roll = rng.random()
                att_status = "PRESENT" if roll < 0.90 else ("ABSENT" if roll < 0.95 else "LATE")
                db.execute(text("""
                    INSERT INTO core.attendance_records
                        (id, tenant_id, session_id, student_id, enrollment_id, status, created_at)
                    VALUES (:id, :tid, :sid, :stid, :enrid, :status, now())
                    ON CONFLICT DO NOTHING
                """), {
                    "id": str(uuid4()), "tid": str(tenant_id),
                    "sid": str(session.id), "stid": str(student.id),
                    "enrid": str(sce.id) if sce else None,
                    "status": att_status,
                })
                records_created += 1

    db.flush()
    print(f"  [+] {sessions_created} attendance sessions, {records_created} records")


def _seed_staff(db, *, tenant_id) -> None:
    """Seed staff directory entries."""
    for sno, fn, ln, stype, email, phone, salary in STAFF_DATA:
        existing = db.execute(
            text("SELECT id FROM core.staff_directory WHERE tenant_id=:t AND staff_no=:n"),
            {"t": str(tenant_id), "n": sno},
        ).fetchone()
        if existing:
            continue

        db.execute(text("""
            INSERT INTO core.staff_directory
              (id, tenant_id, staff_no, staff_type, first_name, last_name,
               email, phone, date_hired, is_active)
            VALUES
              (:id, :t, :sno, :stype, :fn, :ln, :email, :phone, :dh, true)
        """), {
            "id": str(uuid4()), "t": str(tenant_id),
            "sno": sno, "stype": stype, "fn": fn, "ln": ln,
            "email": email, "phone": phone, "dh": date(2025, 1, 15),
        })
        print(f"  [+] staff {fn} {ln} ({stype})")

    db.flush()


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    db = SessionLocal()
    try:
        tenant = db.execute(
            select(Tenant).where(Tenant.slug == DEMO_SLUG)
        ).scalar_one_or_none()
        if tenant is None:
            print(f"[error] Demo tenant not found. Run seed_demo.py first.")
            sys.exit(1)

        tid = tenant.id
        print(f"\n[tenant] {tenant.name}  (id={tid})\n")

        teacher_user = db.execute(
            select(User).where(User.email == "teacher@demo.shulehq.co.ke")
        ).scalar_one_or_none()
        if not teacher_user:
            print("[error] teacher@demo.shulehq.co.ke not found. Run seed_demo.py first.")
            sys.exit(1)

        term1 = db.execute(
            select(TenantTerm).where(TenantTerm.tenant_id == tid, TenantTerm.code == "2026-T1")
        ).scalar_one_or_none()

        classes = {
            c.code: c.id for c in db.execute(
                select(TenantClass).where(TenantClass.tenant_id == tid)
            ).scalars().all()
        }

        # ── 1. CBC Curriculum ─────────────────────────────────────────────────
        print("[=] CBC Curriculum")
        ss_map = _seed_curriculum(db, tenant_id=tid)
        db.flush()
        print(f"  total sub-strands: {len(ss_map)}")

        # ── 2. Student class enrollments ───────────────────────────────────────
        print("\n[=] Student Class Enrollments")
        sce_map = _seed_student_class_enrollments(db, tenant_id=tid, teacher_id=teacher_user.id)

        # ── 3. CBC Assessments (T1) ────────────────────────────────────────────
        if term1:
            print("\n[=] CBC Assessments (Term 1 2026)")
            _seed_cbc_assessments(
                db, tenant_id=tid, teacher_id=teacher_user.id,
                sce_map=sce_map, ss_map=ss_map, term_id=term1.id,
            )

        # ── 4. Attendance ──────────────────────────────────────────────────────
        if term1:
            print("\n[=] Attendance Sessions")
            _seed_attendance(
                db, tenant_id=tid, teacher_id=teacher_user.id,
                sce_map=sce_map, class_id_map=classes, term1=term1, enr_map={},
            )

        # ── 5. Staff Directory ─────────────────────────────────────────────────
        print("\n[=] Staff Directory")
        _seed_staff(db, tenant_id=tid)

        db.commit()
        print("\n[✓] Extended demo seed complete.")
        print(f"  CBC learning areas: 8 (full Upper Primary curriculum)")
        print(f"  Student class enrollments: {len(sce_map)} students × 2 terms")
        print(f"  CBC assessments: {len(sce_map) * len(ss_map)} records")
        print(f"  Attendance: 10 sessions × 3 classes")

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
