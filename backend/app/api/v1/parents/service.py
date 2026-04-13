"""Parent portal service — Phase 1 (secretary workflow).

Responsibilities:
- CRUD for core.parents (guardian records extracted from enrollment payloads)
- Link/unlink parents to enrollments via core.parent_enrollment_links
- Sync parents from existing enrollment guardian_phone/guardian_name data
- Aggregate outstanding invoices across all linked children
- Auto-distribute a payment amount across invoices (oldest-first or proportional)
- Record a bulk payment via the finance service
- Auto-link a parent when a new student is enrolled (called from enrollment service)
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.audit import log_event
from app.models.parent import Parent, ParentEnrollmentLink


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _enrollment_payload(db: Session, enrollment_id: UUID) -> Dict[str, Any]:
    row = db.execute(
        sa.text("SELECT payload FROM core.enrollments WHERE id = :id"),
        {"id": str(enrollment_id)},
    ).mappings().first()
    return dict(row["payload"] or {}) if row else {}


def _student_name(payload: Dict[str, Any]) -> str:
    return (
        payload.get("student_name")
        or payload.get("studentName")
        or payload.get("full_name")
        or payload.get("fullName")
        or payload.get("name")
        or "Unknown"
    )


def _outstanding_for_enrollment(db: Session, tenant_id: UUID, enrollment_id: UUID) -> Decimal:
    row = db.execute(
        sa.text("""
            SELECT COALESCE(SUM(balance_amount), 0) AS bal
            FROM core.invoices
            WHERE tenant_id = :tid
              AND enrollment_id = :eid
              AND balance_amount > 0
        """),
        {"tid": str(tenant_id), "eid": str(enrollment_id)},
    ).mappings().first()
    return Decimal(str(row["bal"] or 0)) if row else Decimal("0")


def _get_parent_or_404(db: Session, tenant_id: UUID, parent_id: UUID) -> Parent:
    p = (
        db.query(Parent)
        .filter(
            Parent.tenant_id == tenant_id,
            Parent.id == parent_id,
            Parent.is_active.is_(True),
        )
        .first()
    )
    if not p:
        raise ValueError("Parent not found")
    return p


# ─────────────────────────────────────────────────────────────────────────────
# List parents
# ─────────────────────────────────────────────────────────────────────────────

def list_parents(db: Session, *, tenant_id: UUID, q: str = "") -> List[Dict]:
    rows = db.execute(
        sa.text("""
            SELECT
                p.id,
                p.first_name,
                p.last_name,
                p.phone,
                p.email,
                p.user_id,
                COUNT(DISTINCT pel.enrollment_id) AS child_count,
                COALESCE(SUM(inv.balance_amount), 0) AS outstanding_total
            FROM core.parents p
            LEFT JOIN core.parent_enrollment_links pel
                ON pel.parent_id = p.id AND pel.tenant_id = :tid
            LEFT JOIN core.invoices inv
                ON inv.enrollment_id = pel.enrollment_id
               AND inv.tenant_id = :tid
               AND inv.balance_amount > 0
            WHERE p.tenant_id = :tid
              AND p.is_active = true
            GROUP BY p.id, p.first_name, p.last_name, p.phone, p.email, p.user_id
            ORDER BY p.first_name, p.last_name
        """),
        {"tid": str(tenant_id)},
    ).mappings().all()

    q = q.strip().lower()
    result = []
    for r in rows:
        name = f"{r['first_name'] or ''} {r['last_name'] or ''}".strip()
        if q and q not in name.lower() and q not in (r["phone"] or "").lower():
            continue
        result.append({
            "id": str(r["id"]),
            "name": name,
            "phone": r["phone"] or "",
            "email": r["email"],
            "child_count": int(r["child_count"] or 0),
            "outstanding_total": Decimal(str(r["outstanding_total"] or 0)),
            "has_portal_access": r["user_id"] is not None,
        })
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Get parent detail (children + outstanding)
# ─────────────────────────────────────────────────────────────────────────────

def get_parent_detail(db: Session, *, tenant_id: UUID, parent_id: UUID) -> Dict:
    p = _get_parent_or_404(db, tenant_id, parent_id)

    links = db.execute(
        sa.text("""
            SELECT pel.id AS link_id, pel.enrollment_id, pel.relationship, pel.is_primary,
                   e.payload
            FROM core.parent_enrollment_links pel
            JOIN core.enrollments e ON e.id = pel.enrollment_id
            WHERE pel.parent_id = :pid AND pel.tenant_id = :tid
            ORDER BY pel.is_primary DESC, pel.created_at
        """),
        {"pid": str(parent_id), "tid": str(tenant_id)},
    ).mappings().all()

    children = []
    total_outstanding = Decimal("0")
    for lnk in links:
        payload = dict(lnk["payload"] or {})
        outstanding = _outstanding_for_enrollment(db, tenant_id, UUID(str(lnk["enrollment_id"])))
        total_outstanding += outstanding
        children.append({
            "link_id": str(lnk["link_id"]),
            "enrollment_id": str(lnk["enrollment_id"]),
            "student_name": _student_name(payload),
            "class_code": payload.get("class_code") or payload.get("admission_class") or "",
            "admission_number": payload.get("admission_number"),
            "relationship": lnk["relationship"],
            "is_primary": bool(lnk["is_primary"]),
            "outstanding": outstanding,
        })

    name = f"{p.first_name or ''} {p.last_name or ''}".strip()
    return {
        "id": str(p.id),
        "first_name": p.first_name or "",
        "last_name": p.last_name or "",
        "name": name,
        "phone": p.phone or "",
        "email": p.email,
        "phone_alt": p.phone_alt,
        "national_id": p.national_id,
        "occupation": p.occupation,
        "address": p.address,
        "has_portal_access": p.user_id is not None,
        "children": children,
        "outstanding_total": total_outstanding,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Create / Update parent
# ─────────────────────────────────────────────────────────────────────────────

def create_parent(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    data: Dict,
) -> Dict:
    phone = (data.get("phone") or "").strip()
    if not phone:
        raise ValueError("Phone number is required")

    # Deduplication — same phone → return existing
    existing = (
        db.query(Parent)
        .filter(Parent.tenant_id == tenant_id, Parent.phone == phone, Parent.is_active.is_(True))
        .first()
    )
    if existing:
        raise ValueError(f"A parent with phone {phone} already exists")

    p = Parent(
        tenant_id=tenant_id,
        first_name=(data.get("first_name") or "").strip(),
        last_name=(data.get("last_name") or "").strip(),
        phone=phone,
        email=(data.get("email") or "").strip() or None,
        phone_alt=(data.get("phone_alt") or "").strip() or None,
        national_id=(data.get("national_id") or "").strip() or None,
        occupation=(data.get("occupation") or "").strip() or None,
        address=(data.get("address") or "").strip() or None,
    )
    db.add(p)
    db.flush()

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="parent.create", resource="parent", resource_id=p.id,
        payload={"phone": phone, "name": f"{p.first_name} {p.last_name}"},
        meta=None,
    )
    return get_parent_detail(db, tenant_id=tenant_id, parent_id=p.id)


def update_parent(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    parent_id: UUID,
    data: Dict,
) -> Dict:
    p = _get_parent_or_404(db, tenant_id, parent_id)

    for field in ("first_name", "last_name", "phone", "email", "phone_alt",
                  "national_id", "occupation", "address"):
        val = data.get(field)
        if val is not None:
            setattr(p, field, val.strip() if isinstance(val, str) else val)

    db.flush()
    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="parent.update", resource="parent", resource_id=p.id,
        payload={k: v for k, v in data.items() if v is not None},
        meta=None,
    )
    return get_parent_detail(db, tenant_id=tenant_id, parent_id=p.id)


# ─────────────────────────────────────────────────────────────────────────────
# Link / Unlink enrollments
# ─────────────────────────────────────────────────────────────────────────────

def link_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    parent_id: UUID,
    enrollment_id: UUID,
    relationship: str = "GUARDIAN",
    is_primary: bool = False,
) -> Dict:
    _get_parent_or_404(db, tenant_id, parent_id)

    # Verify enrollment belongs to this tenant
    enr = db.execute(
        sa.text("SELECT id FROM core.enrollments WHERE id = :eid AND tenant_id = :tid"),
        {"eid": str(enrollment_id), "tid": str(tenant_id)},
    ).mappings().first()
    if not enr:
        raise ValueError("Enrollment not found")

    # Idempotent — ignore if already linked
    existing = db.execute(
        sa.text("""
            SELECT id FROM core.parent_enrollment_links
            WHERE parent_id = :pid AND enrollment_id = :eid
        """),
        {"pid": str(parent_id), "eid": str(enrollment_id)},
    ).mappings().first()

    if not existing:
        db.execute(
            sa.text("""
                INSERT INTO core.parent_enrollment_links
                    (tenant_id, parent_id, enrollment_id, relationship, is_primary)
                VALUES (:tid, :pid, :eid, :rel, :prim)
            """),
            {
                "tid": str(tenant_id),
                "pid": str(parent_id),
                "eid": str(enrollment_id),
                "rel": relationship,
                "prim": is_primary,
            },
        )
        db.flush()
        log_event(
            db, tenant_id=tenant_id, actor_user_id=actor_user_id,
            action="parent.link_enrollment", resource="parent", resource_id=parent_id,
            payload={"enrollment_id": str(enrollment_id), "relationship": relationship},
            meta=None,
        )

    return get_parent_detail(db, tenant_id=tenant_id, parent_id=parent_id)


def unlink_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    parent_id: UUID,
    link_id: UUID,
) -> Dict:
    _get_parent_or_404(db, tenant_id, parent_id)
    db.execute(
        sa.text("""
            DELETE FROM core.parent_enrollment_links
            WHERE id = :lid AND parent_id = :pid AND tenant_id = :tid
        """),
        {"lid": str(link_id), "pid": str(parent_id), "tid": str(tenant_id)},
    )
    db.flush()
    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="parent.unlink_enrollment", resource="parent", resource_id=parent_id,
        payload={"link_id": str(link_id)},
        meta=None,
    )
    return get_parent_detail(db, tenant_id=tenant_id, parent_id=parent_id)


# ─────────────────────────────────────────────────────────────────────────────
# Aggregate invoices across all children
# ─────────────────────────────────────────────────────────────────────────────

def get_parent_invoices(db: Session, *, tenant_id: UUID, parent_id: UUID) -> List[Dict]:
    """Return all outstanding invoices for every enrollment linked to this parent."""
    _get_parent_or_404(db, tenant_id, parent_id)

    rows = db.execute(
        sa.text("""
            SELECT
                inv.id          AS invoice_id,
                inv.enrollment_id,
                inv.invoice_type,
                inv.invoice_no,
                inv.status,
                inv.total_amount,
                inv.paid_amount,
                inv.balance_amount,
                e.payload
            FROM core.parent_enrollment_links pel
            JOIN core.invoices inv
                ON inv.enrollment_id = pel.enrollment_id
               AND inv.tenant_id = :tid
            JOIN core.enrollments e
                ON e.id = pel.enrollment_id
            WHERE pel.parent_id = :pid
              AND pel.tenant_id = :tid
              AND inv.balance_amount > 0
            ORDER BY inv.created_at ASC
        """),
        {"pid": str(parent_id), "tid": str(tenant_id)},
    ).mappings().all()

    result = []
    for r in rows:
        payload = dict(r["payload"] or {})
        result.append({
            "invoice_id": str(r["invoice_id"]),
            "enrollment_id": str(r["enrollment_id"]),
            "student_name": _student_name(payload),
            "invoice_type": r["invoice_type"],
            "invoice_no": r["invoice_no"],
            "status": r["status"],
            "total_amount": Decimal(str(r["total_amount"] or 0)),
            "paid_amount": Decimal(str(r["paid_amount"] or 0)),
            "balance_amount": Decimal(str(r["balance_amount"] or 0)),
        })
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Auto-distribute payment
# ─────────────────────────────────────────────────────────────────────────────

def preview_distribution(
    db: Session,
    *,
    tenant_id: UUID,
    parent_id: UUID,
    total_amount: Decimal,
    strategy: str = "oldest_first",  # oldest_first | proportional
) -> Dict:
    """Calculate how `total_amount` distributes across outstanding invoices.
    No DB write — for UI preview only.
    """
    invoices = get_parent_invoices(db, tenant_id=tenant_id, parent_id=parent_id)
    lines = _distribute(invoices, total_amount, strategy)
    allocated = sum(l["amount"] for l in lines)
    return {
        "total": total_amount,
        "lines": lines,
        "unallocated": max(Decimal("0"), total_amount - allocated),
    }


def _distribute(
    invoices: List[Dict],
    total: Decimal,
    strategy: str,
) -> List[Dict]:
    if strategy == "proportional":
        return _distribute_proportional(invoices, total)
    return _distribute_oldest_first(invoices, total)


def _distribute_oldest_first(invoices: List[Dict], total: Decimal) -> List[Dict]:
    remaining = total
    lines = []
    for inv in invoices:
        if remaining <= 0:
            break
        alloc = min(remaining, inv["balance_amount"])
        if alloc > 0:
            lines.append({
                "invoice_id": inv["invoice_id"],
                "enrollment_id": inv["enrollment_id"],
                "student_name": inv["student_name"],
                "invoice_type": inv["invoice_type"],
                "amount": alloc,
            })
            remaining -= alloc
    return lines


def _distribute_proportional(invoices: List[Dict], total: Decimal) -> List[Dict]:
    grand_balance = sum(inv["balance_amount"] for inv in invoices)
    if grand_balance <= 0:
        return []

    lines = []
    allocated = Decimal("0")
    for i, inv in enumerate(invoices):
        if i == len(invoices) - 1:
            # Last invoice gets the remainder to avoid rounding drift
            alloc = total - allocated
        else:
            alloc = (inv["balance_amount"] / grand_balance * total).quantize(Decimal("0.01"))
        alloc = min(alloc, inv["balance_amount"])
        if alloc > 0:
            lines.append({
                "invoice_id": inv["invoice_id"],
                "enrollment_id": inv["enrollment_id"],
                "student_name": inv["student_name"],
                "invoice_type": inv["invoice_type"],
                "amount": alloc,
            })
            allocated += alloc
    return lines


# ─────────────────────────────────────────────────────────────────────────────
# Record a bulk payment
# ─────────────────────────────────────────────────────────────────────────────

def record_bulk_payment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    parent_id: UUID,
    provider: str,
    reference: Optional[str],
    amount: Decimal,
    allocations: List[Dict],  # [{invoice_id, amount}]
) -> Dict:
    """Delegate to finance service — creates a payment + allocation rows."""
    from app.api.v1.finance import service as fin

    _get_parent_or_404(db, tenant_id, parent_id)

    alloc_objs = [
        type("A", (), {"invoice_id": UUID(str(a["invoice_id"])), "amount": Decimal(str(a["amount"]))})()
        for a in allocations
    ]

    payment_data = type("P", (), {
        "provider": provider,
        "reference": reference,
        "amount": amount,
        "allocations": alloc_objs,
    })()

    payment = fin.create_payment(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        data=payment_data,
    )

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="parent.bulk_payment", resource="parent", resource_id=parent_id,
        payload={
            "payment_id": str(payment.id),
            "amount": str(amount),
            "provider": provider,
            "allocations": len(allocations),
        },
        meta=None,
    )
    return {"payment_id": str(payment.id), "receipt_no": payment.receipt_no}


# ─────────────────────────────────────────────────────────────────────────────
# Sync parents from enrollment payloads
# ─────────────────────────────────────────────────────────────────────────────

def sync_from_enrollments(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
) -> Dict:
    """Scan all ENROLLED/ENROLLED_PARTIAL enrollments and auto-create parent
    records from guardian_phone + guardian_name in their payload.
    """
    enrollments = db.execute(
        sa.text("""
            SELECT id, payload
            FROM core.enrollments
            WHERE tenant_id = :tid
              AND status IN ('ENROLLED', 'ENROLLED_PARTIAL', 'APPROVED', 'SUBMITTED')
        """),
        {"tid": str(tenant_id)},
    ).mappings().all()

    created = 0
    linked = 0
    already_existed = 0
    skipped_no_phone = 0

    for enr in enrollments:
        payload = dict(enr["payload"] or {})
        phone = (payload.get("guardian_phone") or "").strip()
        if not phone:
            skipped_no_phone += 1
            continue

        raw_name = (payload.get("guardian_name") or "").strip()
        parts = raw_name.split(" ", 1)
        first_name = parts[0] if parts else raw_name
        last_name = parts[1] if len(parts) > 1 else ""

        # Get-or-create parent by phone
        parent = db.execute(
            sa.text("""
                SELECT id FROM core.parents
                WHERE tenant_id = :tid AND phone = :phone AND is_active = true
                LIMIT 1
            """),
            {"tid": str(tenant_id), "phone": phone},
        ).mappings().first()

        if parent:
            parent_id = parent["id"]
            already_existed += 1
        else:
            result = db.execute(
                sa.text("""
                    INSERT INTO core.parents
                        (tenant_id, first_name, last_name, phone, email)
                    VALUES (:tid, :fn, :ln, :phone, :email)
                    ON CONFLICT DO NOTHING
                    RETURNING id
                """),
                {
                    "tid": str(tenant_id),
                    "fn": first_name,
                    "ln": last_name,
                    "phone": phone,
                    "email": (payload.get("guardian_email") or "").strip() or None,
                },
            ).mappings().first()

            if not result:
                # Race: row was inserted by concurrent request
                row = db.execute(
                    sa.text("SELECT id FROM core.parents WHERE tenant_id=:tid AND phone=:p LIMIT 1"),
                    {"tid": str(tenant_id), "p": phone},
                ).mappings().first()
                parent_id = row["id"] if row else None
                already_existed += 1
            else:
                parent_id = result["id"]
                created += 1

        if not parent_id:
            continue

        # Link enrollment (idempotent)
        link_result = db.execute(
            sa.text("""
                INSERT INTO core.parent_enrollment_links
                    (tenant_id, parent_id, enrollment_id, relationship)
                VALUES (:tid, :pid, :eid, 'GUARDIAN')
                ON CONFLICT (parent_id, enrollment_id) DO NOTHING
            """),
            {"tid": str(tenant_id), "pid": str(parent_id), "eid": str(enr["id"])},
        )
        if link_result.rowcount > 0:
            linked += 1

    db.flush()
    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="parent.sync_from_enrollments", resource="parent", resource_id=None,
        payload={"created": created, "linked": linked, "already_existed": already_existed},
        meta=None,
    )
    return {
        "created": created,
        "linked": linked,
        "already_existed": already_existed,
        "skipped_no_phone": skipped_no_phone,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Auto-link on enrollment (called from enrollment service)
# ─────────────────────────────────────────────────────────────────────────────

def auto_link_on_enroll(db: Session, *, tenant_id: UUID, enrollment_id: UUID, payload: Dict) -> None:
    """If a parent record already exists with the guardian's phone, link them.
    Called inside mark_enrolled() — no commit, no log (enrollment service handles that).
    """
    phone = (payload.get("guardian_phone") or "").strip()
    if not phone:
        return

    parent = db.execute(
        sa.text("""
            SELECT id FROM core.parents
            WHERE tenant_id = :tid AND phone = :phone AND is_active = true
            LIMIT 1
        """),
        {"tid": str(tenant_id), "phone": phone},
    ).mappings().first()

    if not parent:
        return

    db.execute(
        sa.text("""
            INSERT INTO core.parent_enrollment_links
                (tenant_id, parent_id, enrollment_id, relationship)
            VALUES (:tid, :pid, :eid, 'GUARDIAN')
            ON CONFLICT (parent_id, enrollment_id) DO NOTHING
        """),
        {"tid": str(tenant_id), "pid": str(parent["id"]), "eid": str(enrollment_id)},
    )
