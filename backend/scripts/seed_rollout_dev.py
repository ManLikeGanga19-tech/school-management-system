"""Dev-only seed for the Rollout Desk: one prospect account + a spread of
prospect requests (varied types/statuses/details) so the two-pane rollout
inbox shows realistic intake. Idempotent by (organization_name, request_type)."""

import sys
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.prospect import ProspectAccount, ProspectRequest

ACCOUNT = {
    "email": "prospects@shulehq.dev",
    "full_name": "Prospect Intake (dev)",
    "organization_name": "ShuleHQ Prospects",
    "phone": "254700111222",
}

# org, contact, email, phone, type, status, students, method, window, domain, notes, days_ago
REQUESTS = [
    ("Nairobi Bright Academy", "Grace Wanjiru", "grace@nbacademy.ac.ke", "254712345678",
     "DEMO", "NEW", 820, "PHONE", "Weekday mornings", "nairobi-bright",
     "Director wants a full walkthrough of fees, CBC assessments and the parent portal before Term 2.", 0),
    ("Coast Hill School", "Ali Mwakà", "ali@coasthill.sc.ke", "254733220110",
     "ENQUIRY", "NEW", 340, "EMAIL", "Any time", "coast-hill",
     "Asked about SMS billing costs and whether M-Pesa Daraja is supported for term fees.", 1),
    ("Rift Valley Junior", "Peter Kiprop", "p.kiprop@rvjunior.ac.ke", "254701998877",
     "SCHOOL_VISIT", "CONTACTING", 1250, "WHATSAPP", "Friday afternoon", "rift-valley-jnr",
     "Requested an on-site visit; large school migrating from paper records. High priority.", 2),
    ("Lakeview Girls High", "Mercy Achieng", "principal@lakeviewgirls.ac.ke", "254720445566",
     "DEMO", "CONTACTING", 610, "PHONE", "Weekday 2–4pm", "lakeview-girls",
     "Second demo scheduled after a strong first call; wants exam analytics detail.", 3),
    ("Mount Kenya Academy", "Joseph Njoroge", "admin@mtkenya.ac.ke", "254711334455",
     "ENQUIRY", "SCHEDULED", 480, "EMAIL", "Morning", "mount-kenya",
     "Onboarding call booked for next week; ready to activate a per-term plan.", 5),
    ("Sunrise Junior School", "Faith Muthoni", "faith@sunrisejnr.ac.ke", "254799112233",
     "DEMO", "SCHEDULED", 220, "WHATSAPP", "Weekends", "sunrise-jnr",
     "Small school, IGCSE. Demo confirmed; interested in the mobile PWA for parents.", 6),
    ("Eldoret Model School", "Brian Kemboi", "b.kemboi@eldoretmodel.ac.ke", "254700556677",
     "SCHOOL_VISIT", "CLOSED", 900, "PHONE", "Weekday mornings", "eldoret-model",
     "Visit completed and school onboarded as an active tenant. Closed as won.", 12),
    ("Garden Estate Prep", "Lucy Waithera", "lucy@gardenprep.ac.ke", "254733889900",
     "ENQUIRY", "CLOSED", 150, "EMAIL", "Afternoon", None,
     "Budget too small this year; revisit next admission cycle. Closed as not-now.", 20),
    ("Kisumu Star Academy", "Daniel Otieno", "d.otieno@kisumustar.ac.ke", "254712009988",
     "DEMO", "NEW", 540, "WHATSAPP", "Lunch hour", "kisumu-star",
     "Came through the marketing site; wants to compare per-year vs per-term pricing.", 0),
    ("Thika Road Academy", "Esther Njeri", "esther@thikaroad.ac.ke", "254701223344",
     "ENQUIRY", "CONTACTING", 700, "PHONE", "Weekday mornings", "thika-road",
     "Following up on SMS credits and bulk parent notifications.", 4),
]


def main() -> None:
    db = SessionLocal()
    try:
        acc = db.execute(
            select(ProspectAccount).where(ProspectAccount.email == ACCOUNT["email"])
        ).scalar_one_or_none()
        if acc is None:
            acc = ProspectAccount(
                id=uuid4(), email=ACCOUNT["email"],
                # dev-only placeholder hash; this account never authenticates.
                password_hash="!seed-no-login",
                full_name=ACCOUNT["full_name"],
                organization_name=ACCOUNT["organization_name"],
                phone=ACCOUNT["phone"],
            )
            db.add(acc); db.flush()
            print(f"  [+] prospect account {ACCOUNT['email']}")

        added = 0
        for (org, name, email, phone, rtype, status, students,
             method, window, domain, notes, days_ago) in REQUESTS:
            exists = db.execute(
                select(ProspectRequest).where(
                    ProspectRequest.organization_name == org,
                    ProspectRequest.request_type == rtype,
                )
            ).scalar_one_or_none()
            if exists:
                continue
            when = datetime.now(timezone.utc) - timedelta(days=days_ago)
            db.add(ProspectRequest(
                id=uuid4(), account_id=acc.id,
                request_type=rtype, status=status,
                organization_name=org, contact_name=name,
                contact_email=email, contact_phone=phone,
                student_count=students,
                preferred_contact_method=method, preferred_contact_window=window,
                requested_domain=domain, notes=notes,
                created_at=when, updated_at=when,
            ))
            added += 1
            print(f"  [+] {org} ({rtype}/{status})")

        db.commit()
        print(f"\n[done] rollout requests added={added} total={len(REQUESTS)}")
    except Exception as e:
        db.rollback(); print("[error]", repr(e)); sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
