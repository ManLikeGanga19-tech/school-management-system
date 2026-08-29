"""Dev-only seed for the SaaS/admin console: multiple tenants, subscription
plans, subscriptions (varied statuses) and subscription payments — so the
Super-Admin dashboard, charts, recent-payments and tenant list show realistic
data. Idempotent: safe to re-run. NOT for production."""
from __future__ import annotations

import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.tenant import Tenant
from app.models.subscription import SubscriptionPlan, Subscription, SubscriptionPayment

PLANS = [
    # Module codes MUST be gateable module codes (see app.core.modules.GATEABLE_MODULES).
    # CORE modules (finance, students, etc.) are always on and are NOT listed here.
    {"code": "basic", "name": "Basic", "price": 5000, "cycle": "per_term", "sort": 1,
     "modules": ["exams", "events"]},
    {"code": "standard", "name": "Standard", "price": 12000, "cycle": "per_term", "sort": 2,
     "modules": ["exams", "events", "cbc", "igcse", "discipline", "messaging"]},
    {"code": "premium", "name": "Premium", "price": 120000, "cycle": "full_year", "sort": 3,
     "modules": ["exams", "events", "cbc", "igcse", "discipline", "messaging", "hr", "analytics"]},
]

# (slug, name, curriculum, plan_code, status, active)
TENANTS = [
    ("novel", "Novel School", "CBC", "standard", "active", True),
    ("greenhill", "Greenhill Academy", "CBC", "premium", "active", True),
    ("riverside", "Riverside Junior", "CBC", "standard", "active", True),
    ("mombasa-academy", "Mombasa Academy", "IGCSE", "premium", "active", True),
    ("nakuru-junior", "Nakuru Junior School", "CBC", "basic", "active", True),
    ("eldoret-high", "Eldoret High School", "8-4-4", "standard", "trialing", True),
    ("kisumu-girls", "Kisumu Girls", "CBC", "standard", "past_due", True),
    ("thika-road", "Thika Road School", "CBC", "basic", "cancelled", False),
]


def main() -> None:
    db = SessionLocal()
    try:
        # 1. Plans
        plan_by_code = {}
        for p in PLANS:
            row = db.execute(select(SubscriptionPlan).where(SubscriptionPlan.code == p["code"])).scalar_one_or_none()
            if row is None:
                row = SubscriptionPlan(
                    id=uuid4(), code=p["code"], name=p["name"], modules=p["modules"],
                    price_kes=Decimal(p["price"]), billing_cycle=p["cycle"],
                    is_active=True, sort_order=p["sort"],
                )
                db.add(row); print(f"  [+] plan {p['code']} ({p['price']} KES)")
            plan_by_code[p["code"]] = p
        db.flush()

        today = date.today()
        pay_seq = 0
        active_count = 0

        for slug, name, curriculum, plan_code, status, is_active in TENANTS:
            # 2. Tenant
            t = db.execute(select(Tenant).where(Tenant.slug == slug)).scalar_one_or_none()
            if t is None:
                t = Tenant(id=uuid4(), slug=slug, name=name, is_active=is_active, curriculum_type=curriculum)
                db.add(t); db.flush(); print(f"  [+] tenant {slug}")
            else:
                t.name = t.name or name

            plan = plan_by_code[plan_code]
            billing_plan = "per_year" if plan["cycle"] == "full_year" else "per_term"

            # 3. Subscription (one per tenant) — idempotent by tenant
            sub = db.execute(select(Subscription).where(Subscription.tenant_id == t.id)).scalar_one_or_none()
            period_start = today - timedelta(days=30)
            period_end = today + (timedelta(days=120) if status == "active" else timedelta(days=-5) if status == "past_due" else timedelta(days=60))
            if sub is None:
                sub = Subscription(
                    id=uuid4(), tenant_id=t.id, plan=billing_plan, plan_code=plan_code,
                    billing_cycle=plan["cycle"], status=status, amount_kes=Decimal(plan["price"]),
                    period_start=period_start, period_end=period_end,
                )
                db.add(sub); db.flush(); print(f"  [+] subscription {slug} → {plan_code}/{status}")
            else:
                sub.plan = billing_plan; sub.plan_code = plan_code; sub.status = status
                sub.amount_kes = Decimal(plan["price"]); sub.billing_cycle = plan["cycle"]
                sub.period_start = period_start; sub.period_end = period_end
            if status == "active":
                active_count += 1

            # 4. Payments — a couple per paying tenant
            if status in ("active", "past_due"):
                specs = [("COMPLETED", 45), ("COMPLETED", 5)] if status == "active" else [("COMPLETED", 120), ("FAILED", 2)]
                for pstatus, days_ago in specs:
                    pay_seq += 1
                    crid = f"seed-{slug}-{pay_seq}"
                    exists = db.execute(select(SubscriptionPayment).where(SubscriptionPayment.checkout_request_id == crid)).scalar_one_or_none()
                    if exists:
                        continue
                    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
                    db.add(SubscriptionPayment(
                        id=uuid4(), tenant_id=t.id, subscription_id=sub.id,
                        provider="MPESA_DARAJA", phone_number="254700000000",
                        amount_kes=Decimal(plan["price"]), currency="KES",
                        checkout_request_id=crid,
                        mpesa_receipt=(f"R{pay_seq:06d}KE" if pstatus == "COMPLETED" else None),
                        status=pstatus, result_code=(0 if pstatus == "COMPLETED" else 1032),
                        initiated_at=when, completed_at=(when if pstatus != "PENDING" else None),
                        paid_at=(when if pstatus == "COMPLETED" else None),
                    ))
            print(f"  [ok] {slug}: {plan_code}/{status}")

        db.commit()
        print(f"\n[done] plans={len(PLANS)} tenants={len(TENANTS)} active_subs={active_count}")
    except Exception as e:
        db.rollback(); print("[error]", repr(e)); sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
