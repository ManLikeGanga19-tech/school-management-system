#!/usr/bin/env python3
"""Seed the ShuleHQ Demo School tenant with realistic data.

Run inside the backend Docker container:
  docker exec sms-backend python scripts/seed_demo.py

Idempotent — safe to run multiple times.
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select, text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import SessionLocal
from app.models.enrollment import Enrollment
from app.models.invoice import Invoice, InvoiceLine
from app.models.membership import UserTenant
from app.models.parent import Parent, ParentEnrollmentLink
from app.models.payment import Payment, PaymentAllocation
from app.models.rbac import Role, UserRole
from app.models.student import Student
from app.models.tenant import Tenant
from app.models.tenant_class import TenantClass
from app.models.tenant_print_profile import TenantPrintProfile
from app.models.tenant_term import TenantTerm
from app.models.user import User
from app.utils.hashing import hash_password

DEMO_SLUG = "demo"
DEMO_NAME = "ShuleHQ Demo School"
DEMO_PASSWORD = "Demo@2026"

# Kenya 2026 national term dates
TERMS = [
    ("2026-T1", "Term 1 — 2026", date(2026, 1, 6),  date(2026, 4, 3)),
    ("2026-T2", "Term 2 — 2026", date(2026, 5, 4),  date(2026, 8, 7)),
    ("2026-T3", "Term 3 — 2026", date(2026, 9, 1),  date(2026, 11, 27)),
]

CLASSES = [
    ("GR4", "Grade 4"),
    ("GR6", "Grade 6"),
    ("GR7", "Grade 7"),
]

# (first, last, class_code, gender, paid_t1, paid_t2)
STUDENTS = [
    # Grade 4
    ("Aisha",    "Omar",      "GR4", "F", Decimal("14500"), Decimal("0")),
    ("Brian",    "Kipchoge",  "GR4", "M", Decimal("14500"), Decimal("14500")),
    ("Charity",  "Wanjiku",   "GR4", "F", Decimal("0"),     Decimal("0")),
    ("Daniel",   "Mutua",     "GR4", "M", Decimal("8000"),  Decimal("0")),
    ("Edith",    "Akinyi",    "GR4", "F", Decimal("14500"), Decimal("6000")),
    ("Francis",  "Kamau",     "GR4", "M", Decimal("14500"), Decimal("0")),
    ("Grace",    "Njeri",     "GR4", "F", Decimal("0"),     Decimal("0")),
    ("Harold",   "Otieno",    "GR4", "M", Decimal("14500"), Decimal("14500")),
    # Grade 6
    ("Irene",    "Muthoni",   "GR6", "F", Decimal("14500"), Decimal("14500")),
    ("James",    "Waweru",    "GR6", "M", Decimal("14500"), Decimal("0")),
    ("Ketty",    "Hassan",    "GR6", "F", Decimal("5000"),  Decimal("0")),
    ("Lilian",   "Odhiambo",  "GR6", "F", Decimal("14500"), Decimal("14500")),
    ("Martin",   "Ngugi",     "GR6", "M", Decimal("0"),     Decimal("0")),
    ("Nancy",    "Chebet",    "GR6", "F", Decimal("14500"), Decimal("9000")),
    ("Oscar",    "Muriuki",   "GR6", "M", Decimal("14500"), Decimal("0")),
    ("Pauline",  "Auma",      "GR6", "F", Decimal("14500"), Decimal("14500")),
    # Grade 7
    ("Quentin",  "Mwenda",    "GR7", "M", Decimal("14500"), Decimal("0")),
    ("Rose",     "Karanja",   "GR7", "F", Decimal("14500"), Decimal("14500")),
    ("Samuel",   "Koech",     "GR7", "M", Decimal("0"),     Decimal("0")),
    ("Tabitha",  "Mburu",     "GR7", "F", Decimal("14500"), Decimal("14500")),
    ("Ugo",      "Oluoch",    "GR7", "M", Decimal("10000"), Decimal("0")),
    ("Vivian",   "Simiyu",    "GR7", "F", Decimal("14500"), Decimal("14500")),
    ("Walter",   "Kimani",    "GR7", "M", Decimal("14500"), Decimal("3000")),
    ("Ximena",   "Githuku",   "GR7", "F", Decimal("0"),     Decimal("0")),
]

# Standard fee lines per student per term (CBC primary school)
FEE_LINES = [
    ("Tuition Fee",  Decimal("12000")),
    ("Activity Fee", Decimal("1500")),
    ("Exam Fee",     Decimal("1000")),
]
TERM_TOTAL = sum(a for _, a in FEE_LINES)  # 14,500


# ── helpers ──────────────────────────────────────────────────────────────────

def _upsert_user(db, *, email, full_name, password) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(id=uuid4(), email=email, full_name=full_name,
                    password_hash=hash_password(password), is_active=True)
        db.add(user)
        db.flush()
        print(f"  [+] user {email}")
    return user


def _ensure_membership(db, *, user, tenant) -> None:
    exists = db.execute(
        select(UserTenant).where(UserTenant.tenant_id == tenant.id,
                                 UserTenant.user_id == user.id)
    ).scalar_one_or_none()
    if not exists:
        db.add(UserTenant(id=uuid4(), tenant_id=tenant.id,
                          user_id=user.id, is_active=True))
        db.flush()


def _assign_role(db, *, user, tenant, role_code) -> None:
    role = db.execute(
        select(Role).where(Role.code == role_code, Role.tenant_id.is_(None))
    ).scalar_one_or_none()
    if role is None:
        print(f"  [!] role {role_code} not found — skipping")
        return
    exists = db.execute(
        select(UserRole).where(UserRole.user_id == user.id,
                               UserRole.tenant_id == tenant.id,
                               UserRole.role_id == role.id)
    ).scalar_one_or_none()
    if not exists:
        db.add(UserRole(id=uuid4(), user_id=user.id,
                        tenant_id=tenant.id, role_id=role.id))
        db.flush()


def _upsert_class(db, *, tenant_id, code, name) -> TenantClass:
    obj = db.execute(
        select(TenantClass).where(TenantClass.tenant_id == tenant_id,
                                  TenantClass.code == code)
    ).scalar_one_or_none()
    if not obj:
        obj = TenantClass(id=uuid4(), tenant_id=tenant_id,
                          code=code, name=name, is_active=True)
        db.add(obj)
        db.flush()
        print(f"  [+] class {name}")
    return obj


def _upsert_term(db, *, tenant_id, code, name, start_date, end_date) -> TenantTerm:
    obj = db.execute(
        select(TenantTerm).where(TenantTerm.tenant_id == tenant_id,
                                 TenantTerm.code == code)
    ).scalar_one_or_none()
    if not obj:
        obj = TenantTerm(id=uuid4(), tenant_id=tenant_id, code=code, name=name,
                         start_date=start_date, end_date=end_date, is_active=True)
        db.add(obj)
        db.flush()
        print(f"  [+] term {name}")
    return obj


def _next_adm(db, *, tenant_id) -> str:
    row = db.execute(
        text("SELECT prefix, last_number FROM core.tenant_admission_settings WHERE tenant_id = :t"),
        {"t": str(tenant_id)},
    ).fetchone()
    prefix = str(row[0] or "DEMO-") if row else "DEMO-"
    last = int(row[1] or 0) if row else 0
    nxt = last + 1
    if row:
        db.execute(
            text("UPDATE core.tenant_admission_settings SET last_number=:n, updated_at=now() WHERE tenant_id=:t"),
            {"n": nxt, "t": str(tenant_id)},
        )
    else:
        db.execute(
            text("INSERT INTO core.tenant_admission_settings (tenant_id, prefix, last_number) VALUES (:t, :p, :n)"),
            {"t": str(tenant_id), "p": prefix, "n": nxt},
        )
    db.flush()
    return f"{prefix}{nxt:04d}"


def _upsert_enrollment(db, *, tenant_id, first_name, last_name, gender,
                       class_code, term_code, created_by) -> Enrollment:
    existing = db.execute(
        select(Enrollment).where(
            Enrollment.tenant_id == tenant_id,
            Enrollment.payload["first_name"].as_string() == first_name,
            Enrollment.payload["last_name"].as_string() == last_name,
        )
    ).scalar_one_or_none()
    if existing:
        return existing

    adm_no = _next_adm(db, tenant_id=tenant_id)
    enr = Enrollment(
        id=uuid4(),
        tenant_id=tenant_id,
        status="APPROVED",
        created_by=created_by,
        payload={
            "student_name": f"{first_name} {last_name}",
            "first_name": first_name,
            "last_name": last_name,
            "admission_number": adm_no,
            "admission_class": class_code,
            "class_code": class_code,
            "admission_term": term_code,
            "term_code": term_code,
            "intake_date": date(2026, 1, 6).isoformat(),
            "gender": gender,
            "date_of_birth": "2015-06-10",
            "guardian_name": f"{last_name} Parent",
            "guardian_phone": "0700000000",
            "guardian_relationship": "Parent",
        },
    )
    db.add(enr)
    db.flush()
    db.execute(
        text("UPDATE core.enrollments SET admission_number=:adm WHERE id=:id"),
        {"adm": adm_no, "id": str(enr.id)},
    )
    db.flush()
    print(f"  [+] student {first_name} {last_name}  [{adm_no}]")
    return enr


def _upsert_student(db, *, tenant_id, enrollment) -> Student:
    payload = enrollment.payload or {}
    adm_no = payload.get("admission_number") or str(enrollment.id)[:8].upper()
    existing = db.execute(
        select(Student).where(Student.tenant_id == tenant_id,
                              Student.admission_no == adm_no)
    ).scalar_one_or_none()
    if not existing:
        existing = Student(
            id=uuid4(), tenant_id=tenant_id, admission_no=adm_no,
            first_name=payload.get("first_name") or "Unknown",
            last_name=payload.get("last_name") or "",
            gender=payload.get("gender") or "M",
            date_of_birth=date(2015, 6, 10),
            admission_year=2026, status="ACTIVE",
        )
        db.add(existing)
        db.flush()
    if not enrollment.student_id:
        enrollment.student_id = existing.id
        db.flush()
    return existing


def _upsert_invoice(db, *, tenant_id, enrollment_id, term_number,
                    academic_year, lines) -> Invoice:
    existing = db.execute(
        select(Invoice).where(
            Invoice.tenant_id == tenant_id,
            Invoice.enrollment_id == enrollment_id,
            Invoice.term_number == term_number,
            Invoice.academic_year == academic_year,
            Invoice.invoice_type == "SCHOOL_FEES",
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    total = sum(a for _, a in lines)
    inv = Invoice(
        id=uuid4(), tenant_id=tenant_id, invoice_type="SCHOOL_FEES",
        status="APPROVED", enrollment_id=enrollment_id,
        term_number=term_number, academic_year=academic_year,
        currency="KES", total_amount=total,
        paid_amount=Decimal("0"), balance_amount=total,
    )
    db.add(inv)
    db.flush()
    for desc, amt in lines:
        db.add(InvoiceLine(id=uuid4(), invoice_id=inv.id, description=desc, amount=amt))
    db.flush()
    return inv


def _add_payment(db, *, tenant_id, invoice, amount, provider, reference, created_by) -> None:
    if invoice.paid_amount >= invoice.total_amount or amount <= 0:
        return
    pay = Payment(
        id=uuid4(), tenant_id=tenant_id, provider=provider,
        reference=reference, amount=amount, currency="KES",
        received_at=datetime.now(timezone.utc), created_by=created_by,
    )
    db.add(pay)
    db.flush()
    alloc_amt = min(amount, invoice.balance_amount)
    db.add(PaymentAllocation(id=uuid4(), payment_id=pay.id,
                             invoice_id=invoice.id, amount=alloc_amt))
    invoice.paid_amount += alloc_amt
    invoice.balance_amount = invoice.total_amount - invoice.paid_amount
    invoice.status = "PAID" if invoice.balance_amount <= 0 else "PARTIAL"
    db.flush()


def _upsert_parent(db, *, tenant_id, first_name, last_name, phone, email=None) -> Parent:
    existing = db.execute(
        select(Parent).where(Parent.tenant_id == tenant_id, Parent.phone == phone)
    ).scalar_one_or_none()
    if existing:
        return existing
    p = Parent(id=uuid4(), tenant_id=tenant_id, first_name=first_name,
               last_name=last_name, phone=phone, email=email, is_active=True)
    db.add(p)
    db.flush()
    print(f"  [+] parent {first_name} {last_name}  [{phone}]")
    return p


def _link_parent(db, *, tenant_id, parent, enrollment, is_primary=True) -> None:
    exists = db.execute(
        select(ParentEnrollmentLink).where(
            ParentEnrollmentLink.parent_id == parent.id,
            ParentEnrollmentLink.enrollment_id == enrollment.id,
        )
    ).scalar_one_or_none()
    if not exists:
        db.add(ParentEnrollmentLink(
            id=uuid4(), tenant_id=tenant_id, parent_id=parent.id,
            enrollment_id=enrollment.id, relationship="GUARDIAN", is_primary=is_primary,
        ))
        db.flush()


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    db = SessionLocal()
    try:
        # ── 1. Tenant ──────────────────────────────────────────────────────────
        print(f"\n[=] Tenant: {DEMO_NAME}")
        tenant = db.execute(
            select(Tenant).where(Tenant.slug == DEMO_SLUG)
        ).scalar_one_or_none()
        if tenant is None:
            tenant = Tenant(id=uuid4(), slug=DEMO_SLUG, name=DEMO_NAME, is_active=True)
            db.add(tenant)
            db.flush()
            print(f"  [+] created tenant slug={DEMO_SLUG}")
        tid = tenant.id

        # ── 2. Print profile ────────────────────────────────────────────────────
        from app.models.tenant_print_profile import TenantPrintProfile
        profile = db.execute(
            select(TenantPrintProfile).where(TenantPrintProfile.tenant_id == tid)
        ).scalar_one_or_none()
        if not profile:
            db.add(TenantPrintProfile(
                id=uuid4(), tenant_id=tid,
                school_header=DEMO_NAME,
                physical_address="Westlands, Nairobi",
                po_box="00100",
                phone="+254 785 640 048",
                email="demo@shulehq.co.ke",
                school_motto="Excellence Through Innovation",
                receipt_footer="PAID IN FULL — Thank you.",
                paper_size="A4", currency="KES", qr_enabled=True,
                authorized_signatory_name="The Director",
                authorized_signatory_title="School Director",
            ))
            db.flush()
            print("  [+] print profile")

        # ── 3. Users ──────────────────────────────────────────────────────────
        print("\n[=] Users")
        director = _upsert_user(
            db, email="director@demo.shulehq.co.ke",
            full_name="Demo Director", password=DEMO_PASSWORD,
        )
        secretary = _upsert_user(
            db, email="secretary@demo.shulehq.co.ke",
            full_name="Demo Secretary", password=DEMO_PASSWORD,
        )
        teacher = _upsert_user(
            db, email="teacher@demo.shulehq.co.ke",
            full_name="Demo Teacher", password=DEMO_PASSWORD,
        )

        for user, role_code in [
            (director, "DIRECTOR"),
            (secretary, "SECRETARY"),
            (teacher, "TEACHER"),
        ]:
            _ensure_membership(db, user=user, tenant=tenant)
            _assign_role(db, user=user, tenant=tenant, role_code=role_code)

        # ── 4. Classes ────────────────────────────────────────────────────────
        print("\n[=] Classes")
        classes = {}
        for code, name in CLASSES:
            classes[code] = _upsert_class(db, tenant_id=tid, code=code, name=name)

        # ── 5. Terms ──────────────────────────────────────────────────────────
        print("\n[=] Terms")
        terms = {}
        for code, name, start, end in TERMS:
            terms[code] = _upsert_term(db, tenant_id=tid, code=code, name=name,
                                       start_date=start, end_date=end)
        term1 = terms["2026-T1"]
        term2 = terms["2026-T2"]

        # ── 6. Students, invoices & payments ──────────────────────────────────
        print("\n[=] Students, invoices & payments")
        mpesa_refs = iter([f"DEMO{i:06d}" for i in range(1, 500)])
        enrollments: dict[tuple, Enrollment] = {}

        for first, last, cls_code, gender, paid_t1, paid_t2 in STUDENTS:
            enr = _upsert_enrollment(
                db, tenant_id=tid, first_name=first, last_name=last,
                gender=gender, class_code=cls_code,
                term_code=term1.code, created_by=secretary.id,
            )
            _upsert_student(db, tenant_id=tid, enrollment=enr)
            enrollments[(first, last)] = enr

            inv1 = _upsert_invoice(db, tenant_id=tid, enrollment_id=enr.id,
                                   term_number=1, academic_year=2026, lines=FEE_LINES)
            if paid_t1 > 0:
                _add_payment(db, tenant_id=tid, invoice=inv1, amount=paid_t1,
                             provider="MPESA", reference=next(mpesa_refs),
                             created_by=secretary.id)

            inv2 = _upsert_invoice(db, tenant_id=tid, enrollment_id=enr.id,
                                   term_number=2, academic_year=2026, lines=FEE_LINES)
            if paid_t2 > 0:
                _add_payment(db, tenant_id=tid, invoice=inv2, amount=paid_t2,
                             provider="MPESA", reference=next(mpesa_refs),
                             created_by=secretary.id)

        db.flush()

        # ── 7. Parent families ─────────────────────────────────────────────────
        print("\n[=] Parents")

        # Demo parent 1 — Wanjiku Family (3 children across GR4, GR6, GR7)
        wanjiku = _upsert_parent(db, tenant_id=tid, first_name="Mary",
                                 last_name="Wanjiku", phone="0722400001",
                                 email="mary.wanjiku@gmail.com")
        for key in [("Charity", "Wanjiku"), ("Irene", "Muthoni"), ("Rose", "Karanja")]:
            if key in enrollments:
                _link_parent(db, tenant_id=tid, parent=wanjiku, enrollment=enrollments[key])

        # Demo parent 2 — Kamau Family (GR4 + GR7)
        kamau = _upsert_parent(db, tenant_id=tid, first_name="John",
                               last_name="Kamau", phone="0722400002",
                               email="john.kamau@gmail.com")
        for key in [("Francis", "Kamau"), ("Walter", "Kimani")]:
            if key in enrollments:
                _link_parent(db, tenant_id=tid, parent=kamau, enrollment=enrollments[key])

        # Demo parent 3 — single child (for simple portal demo)
        otieno = _upsert_parent(db, tenant_id=tid, first_name="Peter",
                                last_name="Otieno", phone="0722400003",
                                email="peter.otieno@gmail.com")
        for key in [("Harold", "Otieno")]:
            if key in enrollments:
                _link_parent(db, tenant_id=tid, parent=otieno, enrollment=enrollments[key])

        db.flush()

        # ── commit ────────────────────────────────────────────────────────────
        db.commit()
        print("\n[✓] Demo seed complete.\n")
        print("Login credentials (password: Demo@2026):")
        print(f"  Director   →  director@demo.shulehq.co.ke")
        print(f"  Secretary  →  secretary@demo.shulehq.co.ke")
        print(f"  Teacher    →  teacher@demo.shulehq.co.ke")
        print(f"\nTenant slug: {DEMO_SLUG}")
        print(f"Students: {len(STUDENTS)} across Grade 4, 6, 7")
        print(f"Parents:  3 families seeded (portal-ready)")

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
