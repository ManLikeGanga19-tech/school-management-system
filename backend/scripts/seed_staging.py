#!/usr/bin/env python3
"""Seed comprehensive test data into the staging database.

Run inside the backend Docker container:
  docker exec sms-backend python scripts/seed_staging.py --tenant-slug novel-school

The script is idempotent — safe to run multiple times.
"""
from __future__ import annotations

import argparse
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
from app.models.fee_catalog import FeeCategory, FeeItem
from app.models.hr import StaffLeaveRequest, StaffSalaryStructure
from app.models.invoice import Invoice, InvoiceLine
from app.models.membership import UserTenant
from app.models.payment import Payment, PaymentAllocation
from app.models.rbac import Role, UserRole
from app.models.tenant import Tenant
from app.models.tenant_class import TenantClass
from app.models.tenant_print_profile import TenantPrintProfile
from app.models.tenant_term import TenantTerm
from app.models.user import User
from app.utils.hashing import hash_password


# ── helpers ──────────────────────────────────────────────────────────────────

def _upsert_user(db, *, email: str, full_name: str, password: str) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(id=uuid4(), email=email, full_name=full_name,
                    password_hash=hash_password(password), is_active=True)
        db.add(user)
        db.flush()
        print(f"  [+] user {email}")
    return user


def _ensure_membership(db, *, user: User, tenant: Tenant) -> None:
    exists = db.execute(
        select(UserTenant).where(UserTenant.tenant_id == tenant.id,
                                 UserTenant.user_id == user.id)
    ).scalar_one_or_none()
    if not exists:
        db.add(UserTenant(id=uuid4(), tenant_id=tenant.id,
                          user_id=user.id, is_active=True))
        db.flush()


def _assign_role(db, *, user: User, tenant: Tenant, role_code: str) -> None:
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


def _upsert_class(db, *, tenant_id, code: str, name: str) -> TenantClass:
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


def _upsert_term(db, *, tenant_id, code: str, name: str,
                 start_date: date, end_date: date) -> TenantTerm:
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


def _upsert_fee_category(db, *, tenant_id, code: str, name: str) -> FeeCategory:
    obj = db.execute(
        select(FeeCategory).where(FeeCategory.tenant_id == tenant_id,
                                  FeeCategory.code == code)
    ).scalar_one_or_none()
    if not obj:
        obj = FeeCategory(id=uuid4(), tenant_id=tenant_id,
                          code=code, name=name, is_active=True)
        db.add(obj)
        db.flush()
    return obj


def _upsert_fee_item(db, *, tenant_id, category_id, code: str,
                     name: str, frequency: str = "PER_TERM") -> FeeItem:
    obj = db.execute(
        select(FeeItem).where(FeeItem.tenant_id == tenant_id,
                              FeeItem.code == code)
    ).scalar_one_or_none()
    if not obj:
        obj = FeeItem(id=uuid4(), tenant_id=tenant_id, category_id=category_id,
                      code=code, name=name, charge_frequency=frequency, is_active=True)
        db.add(obj)
        db.flush()
    return obj


def _upsert_enrollment(db, *, tenant_id, first_name: str, last_name: str,
                       class_id, created_by) -> Enrollment:
    existing = db.execute(
        select(Enrollment).where(
            Enrollment.tenant_id == tenant_id,
            Enrollment.payload["first_name"].as_string() == first_name,
            Enrollment.payload["last_name"].as_string() == last_name,
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    enr = Enrollment(
        id=uuid4(),
        tenant_id=tenant_id,
        status="APPROVED",
        created_by=created_by,
        payload={
            "first_name": first_name,
            "last_name": last_name,
            "class_id": str(class_id),
            "gender": "M",
            "date_of_birth": "2015-03-15",
            "guardian_name": f"{last_name} Parent",
            "guardian_phone": "0712000000",
            "guardian_relationship": "Parent",
        },
    )
    db.add(enr)
    db.flush()
    print(f"  [+] student {first_name} {last_name}")
    return enr


def _upsert_invoice(db, *, tenant_id, enrollment_id, term_number: int,
                    academic_year: int, lines: list[tuple[str, Decimal]]) -> Invoice:
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
        currency="KES", total_amount=total, paid_amount=Decimal("0"),
        balance_amount=total,
    )
    db.add(inv)
    db.flush()
    for desc, amt in lines:
        db.add(InvoiceLine(id=uuid4(), invoice_id=inv.id,
                           description=desc, amount=amt))
    db.flush()
    return inv


def _add_payment(db, *, tenant_id, invoice: Invoice, amount: Decimal,
                 provider: str, reference: str, created_by) -> None:
    if invoice.paid_amount >= invoice.total_amount:
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
    invoice.paid_amount = invoice.paid_amount + alloc_amt
    invoice.balance_amount = invoice.total_amount - invoice.paid_amount
    if invoice.balance_amount <= 0:
        invoice.status = "PAID"
    else:
        invoice.status = "PARTIAL"
    db.flush()


def _upsert_staff(db, *, tenant_id, staff_no: str, first_name: str,
                  last_name: str, staff_type: str, email: str,
                  phone: str, basic_salary: Decimal) -> object:
    existing = db.execute(
        text("SELECT id FROM core.staff_directory WHERE tenant_id=:t AND staff_no=:n"),
        {"t": str(tenant_id), "n": staff_no},
    ).fetchone()
    if existing:
        return existing[0]
    staff_id = uuid4()
    db.execute(text("""
        INSERT INTO core.staff_directory
          (id, tenant_id, staff_no, staff_type, first_name, last_name,
           email, phone, date_hired, is_active)
        VALUES
          (:id, :t, :sno, :stype, :fn, :ln, :email, :phone, :dh, true)
    """), {
        "id": str(staff_id), "t": str(tenant_id), "sno": staff_no,
        "stype": staff_type, "fn": first_name, "ln": last_name,
        "email": email, "phone": phone, "dh": date(2024, 1, 15),
    })
    db.flush()
    print(f"  [+] staff {first_name} {last_name} ({staff_type})")

    # salary structure
    db.add(StaffSalaryStructure(
        id=uuid4(), tenant_id=tenant_id, staff_id=staff_id,
        basic_salary=basic_salary,
        house_allowance=Decimal("5000"),
        transport_allowance=Decimal("3000"),
        other_allowances=Decimal("0"),
        helb_deduction=Decimal("0"),
        loan_deduction=Decimal("0"),
        effective_from=date(2024, 1, 15),
    ))
    db.flush()
    return staff_id


def _upsert_leave(db, *, tenant_id, staff_id, leave_type: str,
                  start_date: date, end_date: date,
                  days: int, status: str, reason: str,
                  reviewed_by=None) -> None:
    existing = db.execute(
        select(StaffLeaveRequest).where(
            StaffLeaveRequest.tenant_id == tenant_id,
            StaffLeaveRequest.staff_id == staff_id,
            StaffLeaveRequest.start_date == start_date,
        )
    ).scalar_one_or_none()
    if existing:
        return
    db.add(StaffLeaveRequest(
        id=uuid4(), tenant_id=tenant_id, staff_id=staff_id,
        leave_type=leave_type, start_date=start_date, end_date=end_date,
        days_requested=days, reason=reason, status=status,
        reviewed_by=reviewed_by,
        reviewed_at=datetime.now(timezone.utc) if status != "PENDING" else None,
        review_note="Approved — leave confirmed." if status == "APPROVED"
                    else ("Insufficient cover staff." if status == "REJECTED" else None),
    ))
    db.flush()


def _upsert_sms_template(db, *, tenant_id, name: str, body: str,
                         variables: list, created_by) -> None:
    existing = db.execute(
        text("SELECT id FROM core.sms_templates WHERE tenant_id=:t AND name=:n"),
        {"t": str(tenant_id), "n": name},
    ).fetchone()
    if existing:
        return
    db.execute(text("""
        INSERT INTO core.sms_templates (id, tenant_id, name, body, variables, created_by)
        VALUES (:id, :t, :name, :body, :vars::jsonb, :cb)
    """), {
        "id": str(uuid4()), "t": str(tenant_id), "name": name,
        "body": body, "vars": str(variables).replace("'", '"'), "cb": str(created_by),
    })
    db.flush()
    print(f"  [+] sms template '{name}'")


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Seed staging test data")
    parser.add_argument("--tenant-slug", default="novel-school",
                        help="Slug of the tenant to seed (default: novel-school)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        # ── 1. Find tenant ────────────────────────────────────────────────────
        tenant = db.execute(
            select(Tenant).where(Tenant.slug == args.tenant_slug)
        ).scalar_one_or_none()
        if tenant is None:
            print(f"[error] Tenant '{args.tenant_slug}' not found. "
                  "Run bootstrap_tenant_user.py first.")
            sys.exit(1)
        tid = tenant.id
        print(f"\n[tenant] {tenant.name}  ({tenant.slug})\n")

        # ── 2. Print profile ──────────────────────────────────────────────────
        print("[=] Print profile")
        profile = db.execute(
            select(TenantPrintProfile).where(TenantPrintProfile.tenant_id == tid)
        ).scalar_one_or_none()
        if not profile:
            profile = TenantPrintProfile(
                id=uuid4(), tenant_id=tid,
                school_header=tenant.name,
                physical_address="Miritini, Sgr Road",
                po_box="95154",
                phone="0722991368",
                email="info@novelschool.ac.ke",
                school_motto="Nurturing Excellence",
                receipt_footer="PAYMENT RECEIVED IN FULL. THANK YOU.",
                paper_size="A4", currency="KES", qr_enabled=True,
                authorized_signatory_name="The Principal",
                authorized_signatory_title="Principal",
            )
            db.add(profile)
            db.flush()
            print("  [+] print profile")

        # ── 3. Users ──────────────────────────────────────────────────────────
        print("\n[=] Users")
        director = _upsert_user(db, email="director@novelschool.ac.ke",
                                full_name="James Mwangi", password="Test1234!")
        secretary = _upsert_user(db, email="secretary@novelschool.ac.ke",
                                 full_name="Grace Achieng", password="Test1234!")
        teacher1 = _upsert_user(db, email="teacher1@novelschool.ac.ke",
                                 full_name="Peter Otieno", password="Test1234!")
        teacher2 = _upsert_user(db, email="teacher2@novelschool.ac.ke",
                                 full_name="Mary Wanjiku", password="Test1234!")
        accountant = _upsert_user(db, email="accountant@novelschool.ac.ke",
                                  full_name="David Kamau", password="Test1234!")

        for user, role_code in [
            (director, "DIRECTOR"),
            (secretary, "SECRETARY"),
            (teacher1, "TEACHER"),
            (teacher2, "TEACHER"),
            (accountant, "SECRETARY"),
        ]:
            _ensure_membership(db, user=user, tenant=tenant)
            _assign_role(db, user=user, tenant=tenant, role_code=role_code)

        # ── 4. Classes ────────────────────────────────────────────────────────
        print("\n[=] Classes")
        classes = {}
        for code, name in [
            ("GR1", "Grade 1"), ("GR2", "Grade 2"), ("GR3", "Grade 3"),
            ("GR4", "Grade 4"), ("GR5", "Grade 5"), ("GR6", "Grade 6"),
            ("GR7", "Grade 7"), ("GR8", "Grade 8"),
        ]:
            classes[code] = _upsert_class(db, tenant_id=tid, code=code, name=name)

        # ── 5. Terms ──────────────────────────────────────────────────────────
        print("\n[=] Terms")
        term1 = _upsert_term(db, tenant_id=tid, code="2026-T1", name="Term 1 2026",
                             start_date=date(2026, 1, 6), end_date=date(2026, 4, 4))
        term2 = _upsert_term(db, tenant_id=tid, code="2026-T2", name="Term 2 2026",
                             start_date=date(2026, 5, 5), end_date=date(2026, 8, 14))
        _upsert_term(db, tenant_id=tid, code="2026-T3", name="Term 3 2026",
                     start_date=date(2026, 9, 7), end_date=date(2026, 11, 28))

        # ── 6. Fee catalog ────────────────────────────────────────────────────
        print("\n[=] Fee catalog")
        cat_fees = _upsert_fee_category(db, tenant_id=tid,
                                        code="SCHOOL_FEES", name="School Fees")
        cat_other = _upsert_fee_category(db, tenant_id=tid,
                                         code="OTHER", name="Other Charges")
        tuition  = _upsert_fee_item(db, tenant_id=tid, category_id=cat_fees.id,
                                    code="TUITION", name="Tuition Fee")
        activity = _upsert_fee_item(db, tenant_id=tid, category_id=cat_fees.id,
                                    code="ACTIVITY", name="Activity Fee")
        exam     = _upsert_fee_item(db, tenant_id=tid, category_id=cat_fees.id,
                                    code="EXAM", name="Exam Fee")
        _upsert_fee_item(db, tenant_id=tid, category_id=cat_other.id,
                         code="INTERVIEW", name="Interview Fee",
                         frequency="ONCE_EVER")
        print("  [+] fee items: Tuition, Activity, Exam, Interview")

        # Standard fee lines per student per term
        FEE_LINES = [
            ("Tuition Fee",  Decimal("15000")),
            ("Activity Fee", Decimal("2000")),
            ("Exam Fee",     Decimal("1500")),
        ]

        # ── 7. Students + Invoices + Payments ─────────────────────────────────
        print("\n[=] Students, invoices & payments")
        STUDENTS = [
            # (first, last, class_code, paid_term1, paid_term2)
            ("Naum",    "Kioko",    "GR3", Decimal("18500"), Decimal("0")),     # fully paid T1
            ("Amina",   "Hassan",   "GR3", Decimal("18500"), Decimal("18500")), # paid both terms
            ("Brian",   "Odhiambo", "GR4", Decimal("10000"), Decimal("0")),    # partial T1
            ("Cynthia", "Wangari",  "GR4", Decimal("0"),     Decimal("0")),    # unpaid
            ("Dennis",  "Mutua",    "GR5", Decimal("18500"), Decimal("5000")), # paid T1, partial T2
            ("Eunice",  "Akinyi",   "GR5", Decimal("18500"), Decimal("0")),    # fully paid T1
            ("Faith",   "Njeri",    "GR6", Decimal("18500"), Decimal("18500")),# paid both
            ("George",  "Otieno",   "GR1", Decimal("8000"),  Decimal("0")),    # partial T1
            ("Hilda",   "Muthoni",  "GR2", Decimal("0"),     Decimal("0")),    # unpaid
            ("Ivan",    "Kamau",    "GR7", Decimal("18500"), Decimal("0")),    # fully paid T1
        ]
        mpesa_refs = iter([f"QGH{i:07d}" for i in range(1, 100)])
        for first, last, cls_code, paid_t1, paid_t2 in STUDENTS:
            enr = _upsert_enrollment(db, tenant_id=tid, first_name=first,
                                     last_name=last, class_id=classes[cls_code].id,
                                     created_by=secretary.id)
            # Term 1 invoice
            inv1 = _upsert_invoice(db, tenant_id=tid, enrollment_id=enr.id,
                                   term_number=1, academic_year=2026, lines=FEE_LINES)
            if paid_t1 > 0:
                _add_payment(db, tenant_id=tid, invoice=inv1, amount=paid_t1,
                             provider="MPESA", reference=next(mpesa_refs),
                             created_by=secretary.id)
            # Term 2 invoice
            inv2 = _upsert_invoice(db, tenant_id=tid, enrollment_id=enr.id,
                                   term_number=2, academic_year=2026, lines=FEE_LINES)
            if paid_t2 > 0:
                _add_payment(db, tenant_id=tid, invoice=inv2, amount=paid_t2,
                             provider="MPESA", reference=next(mpesa_refs),
                             created_by=secretary.id)
        db.flush()

        # ── 8. Staff directory ────────────────────────────────────────────────
        print("\n[=] Staff")
        staff_ids = {}
        staff_data = [
            ("STF001", "James",  "Mwangi",  "ADMINISTRATION", "director@novelschool.ac.ke",
             "0722100001", Decimal("85000")),
            ("STF002", "Grace",  "Achieng", "ADMINISTRATION", "secretary@novelschool.ac.ke",
             "0722100002", Decimal("45000")),
            ("STF003", "Peter",  "Otieno",  "TEACHING",       "teacher1@novelschool.ac.ke",
             "0722100003", Decimal("55000")),
            ("STF004", "Mary",   "Wanjiku", "TEACHING",       "teacher2@novelschool.ac.ke",
             "0722100004", Decimal("55000")),
            ("STF005", "David",  "Kamau",   "ADMINISTRATION", "accountant@novelschool.ac.ke",
             "0722100005", Decimal("50000")),
            ("STF006", "Alice",  "Mutindi", "TEACHING",       "alice@novelschool.ac.ke",
             "0722100006", Decimal("52000")),
        ]
        for sno, fn, ln, stype, email, phone, salary in staff_data:
            sid = _upsert_staff(db, tenant_id=tid, staff_no=sno, first_name=fn,
                                last_name=ln, staff_type=stype, email=email,
                                phone=phone, basic_salary=salary)
            staff_ids[sno] = sid

        # ── 9. Leave requests ─────────────────────────────────────────────────
        print("\n[=] Leave requests")
        leave_data = [
            # (staff_no, type, start, end, days, status)
            ("STF003", "ANNUAL",    date(2026, 4, 20), date(2026, 4, 25), 5, "PENDING"),
            ("STF004", "SICK",      date(2026, 3, 10), date(2026, 3, 12), 3, "APPROVED"),
            ("STF006", "MATERNITY", date(2026, 5,  1), date(2026, 7, 31), 65, "APPROVED"),
            ("STF002", "ANNUAL",    date(2026, 4, 14), date(2026, 4, 18), 5, "REJECTED"),
            ("STF005", "ANNUAL",    date(2026, 5, 18), date(2026, 5, 22), 5, "PENDING"),
        ]
        for sno, ltype, sd, ed, days, status in leave_data:
            sid = staff_ids.get(sno)
            if sid:
                _upsert_leave(db, tenant_id=tid, staff_id=sid,
                              leave_type=ltype, start_date=sd, end_date=ed,
                              days=days, status=status,
                              reason=f"{ltype.title()} leave request.",
                              reviewed_by=director.id if status != "PENDING" else None)
                print(f"  [+] leave {sno} {ltype} {status}")

        # ── 10. SMS templates ─────────────────────────────────────────────────
        print("\n[=] SMS templates")
        templates = [
            ("Fee Reminder",
             "Dear parent, this is a reminder that {student_name}'s school fees "
             "balance of KES {balance} for Term {term} is outstanding. "
             "Please pay at the school office. Thank you.",
             ["student_name", "balance", "term"]),
            ("Payment Received",
             "Dear parent, we have received a payment of KES {amount} for "
             "{student_name}. Receipt No: {receipt_no}. Thank you.",
             ["amount", "student_name", "receipt_no"]),
            ("Exam Results",
             "Dear parent, {student_name}'s exam results are ready. "
             "Please visit the school to collect the report card. Thank you.",
             ["student_name"]),
            ("School Closure",
             "Dear parent, please note that school will be closed on {date} "
             "due to {reason}. Normal classes resume on {resume_date}. Thank you.",
             ["date", "reason", "resume_date"]),
            ("General Broadcast",
             "Dear parent, {message}. For enquiries call {phone}. Thank you.",
             ["message", "phone"]),
        ]
        for name, body, variables in templates:
            _upsert_sms_template(db, tenant_id=tid, name=name, body=body,
                                 variables=variables, created_by=director.id)

        # ── commit ────────────────────────────────────────────────────────────
        db.commit()
        print("\n[✓] Seed complete.\n")
        print("Login credentials (all passwords: Test1234!):")
        print("  director    →  director@novelschool.ac.ke")
        print("  secretary   →  secretary@novelschool.ac.ke")
        print("  teacher     →  teacher1@novelschool.ac.ke / teacher2@novelschool.ac.ke")
        print("  accountant  →  accountant@novelschool.ac.ke")

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
