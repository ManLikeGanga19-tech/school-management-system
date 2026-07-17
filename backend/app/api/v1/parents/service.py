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

import hashlib
import secrets as _secrets
from datetime import timedelta

from app.core.audit import log_event
from app.models.parent import Parent, ParentEnrollmentLink, ParentPortalToken


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

def _parent_has_class(db: Session, tenant_id: UUID, parent_id, class_code: str) -> bool:
    """Return True if the parent has at least one child enrolled in the given class."""
    row = db.execute(
        sa.text("""
            SELECT 1
            FROM core.parent_enrollment_links pel
            JOIN core.enrollments e ON e.id = pel.enrollment_id
            WHERE pel.parent_id = :pid
              AND pel.tenant_id = :tid
              AND (
                  UPPER(e.payload->>'class_code') = :cc
               OR UPPER(e.payload->>'admission_class') = :cc
              )
            LIMIT 1
        """),
        {"pid": str(parent_id), "tid": str(tenant_id), "cc": class_code},
    ).first()
    return row is not None


def list_parents(db: Session, *, tenant_id: UUID, q: str = "", class_code: str = "") -> List[Dict]:
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
    class_filter = class_code.strip().upper()
    result = []
    for r in rows:
        name = f"{r['first_name'] or ''} {r['last_name'] or ''}".strip()
        if q and q not in name.lower() and q not in (r["phone"] or "").lower():
            continue
        # class_code filter: only include if parent has at least one child in that class
        if class_filter and not _parent_has_class(db, tenant_id, r["id"], class_filter):
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
                   e.payload, e.student_id
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
        # Net open balance adjustment for this child (signed; positive = owed
        # more, negative = credit on file). Powers the per-child Adjust Balance
        # widget on the parent profile.
        student_uuid = lnk["student_id"]
        balance_net = Decimal("0")
        if student_uuid is not None:
            cf_rows = db.execute(
                sa.text("""
                    SELECT COALESCE(SUM(amount), 0) AS net
                    FROM core.student_carry_forward_balances
                    WHERE tenant_id = :tid AND student_id = :sid AND status = 'OPEN'
                """),
                {"tid": str(tenant_id), "sid": str(student_uuid)},
            ).mappings().first()
            if cf_rows:
                balance_net = Decimal(str(cf_rows["net"] or 0))
        children.append({
            "link_id": str(lnk["link_id"]),
            "enrollment_id": str(lnk["enrollment_id"]),
            "student_id": str(student_uuid) if student_uuid is not None else None,
            "student_name": _student_name(payload),
            "class_code": payload.get("class_code") or payload.get("admission_class") or "",
            "admission_number": payload.get("admission_number"),
            "relationship": lnk["relationship"],
            "is_primary": bool(lnk["is_primary"]),
            "outstanding": outstanding,
            "balance_adjustment_net": str(balance_net),
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

    # Deduplication — one parent can have many children, so a repeated phone
    # reuses the existing parent record instead of erroring or duplicating.
    existing = (
        db.query(Parent)
        .filter(Parent.tenant_id == tenant_id, Parent.phone == phone, Parent.is_active.is_(True))
        .first()
    )
    if existing:
        return get_parent_detail(db, tenant_id=tenant_id, parent_id=existing.id)

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


def _merge_parents(
    db: Session, *, tenant_id: UUID, actor_user_id: UUID,
    source_id: UUID, target_id: UUID, data: Dict,
) -> Dict:
    """Merge `source` parent into `target` — move all children to target, then
    deactivate the source so the duplicate disappears. One parent, all kids."""
    tid = str(tenant_id)
    src, tgt = str(source_id), str(target_id)

    # Move enrollment links (the Parents module groups children via these).
    db.execute(sa.text("""
        INSERT INTO core.parent_enrollment_links (tenant_id, parent_id, enrollment_id, relationship, is_primary)
        SELECT tenant_id, :tgt, enrollment_id, relationship, is_primary
        FROM core.parent_enrollment_links
        WHERE tenant_id = :tid AND parent_id = :src
        ON CONFLICT (parent_id, enrollment_id) DO NOTHING
    """), {"tid": tid, "src": src, "tgt": tgt})
    db.execute(sa.text(
        "DELETE FROM core.parent_enrollment_links WHERE tenant_id = :tid AND parent_id = :src"
    ), {"tid": tid, "src": src})

    # Move SIS parent↔student links too.
    db.execute(sa.text("""
        INSERT INTO core.parent_students (tenant_id, parent_id, student_id, relationship, is_active)
        SELECT tenant_id, :tgt, student_id, relationship, is_active
        FROM core.parent_students
        WHERE tenant_id = :tid AND parent_id = :src
        ON CONFLICT DO NOTHING
    """), {"tid": tid, "src": src, "tgt": tgt})
    db.execute(sa.text(
        "DELETE FROM core.parent_students WHERE tenant_id = :tid AND parent_id = :src"
    ), {"tid": tid, "src": src})

    # Apply the edited name/contact details (except phone) to the surviving parent.
    tgt_parent = _get_parent_or_404(db, tenant_id, target_id)
    for field in ("first_name", "last_name", "email", "phone_alt",
                  "national_id", "occupation", "address"):
        val = data.get(field)
        if val is not None and str(val).strip():
            setattr(tgt_parent, field, val.strip() if isinstance(val, str) else val)

    # Retire the duplicate (kept for audit; hidden from the active list).
    src_parent = _get_parent_or_404(db, tenant_id, source_id)
    src_parent.is_active = False
    db.flush()

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="parent.merge", resource="parent", resource_id=target_id,
        payload={"merged_from": src, "into": tgt}, meta=None,
    )
    return get_parent_detail(db, tenant_id=tenant_id, parent_id=target_id)


def update_parent(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    parent_id: UUID,
    data: Dict,
) -> Dict:
    p = _get_parent_or_404(db, tenant_id, parent_id)

    # If the new phone already belongs to another parent, this is the same
    # guardian — merge into that parent instead of colliding on the unique index.
    new_phone = data.get("phone")
    new_phone = str(new_phone).strip() if new_phone is not None else None
    if new_phone and new_phone != (p.phone or ""):
        target = db.execute(
            sa.text(
                "SELECT id FROM core.parents "
                "WHERE tenant_id = :tid AND phone = :phone AND id <> :id "
                "  AND is_active = true LIMIT 1"
            ),
            {"tid": str(tenant_id), "phone": new_phone, "id": str(parent_id)},
        ).scalar_one_or_none()
        if target is not None:
            return _merge_parents(
                db, tenant_id=tenant_id, actor_user_id=actor_user_id,
                source_id=parent_id, target_id=UUID(str(target)), data=data,
            )

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

    payment = fin.create_payment(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        provider=provider,
        reference=reference,
        amount=amount,
        allocations=[{"invoice_id": str(a["invoice_id"]), "amount": Decimal(str(a["amount"]))} for a in allocations],
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
# Guardian portal tokens
# ─────────────────────────────────────────────────────────────────────────────

def _token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_portal_token(
    db: Session,
    *,
    tenant_id: UUID,
    parent_id: UUID,
    actor_user_id: UUID,
    label: Optional[str] = None,
) -> Dict:
    from datetime import datetime, timezone
    _get_parent_or_404(db, tenant_id, parent_id)

    raw = _secrets.token_urlsafe(48)   # 384 bits — cryptographically irreversible
    now = datetime.now(timezone.utc)
    token = ParentPortalToken(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        parent_id=parent_id,
        token_hash=_token_hash(raw),
        label=(label or "").strip() or None,
        is_active=True,
        expires_at=None,           # permanent — security enforced by token entropy + revoke
        created_by=actor_user_id,
        created_at=now,
    )
    db.add(token)
    db.flush()

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="parent.portal_token.create", resource="parent", resource_id=parent_id,
        payload={"token_id": str(token.id), "label": label},
        meta=None,
    )

    return {
        "id": str(token.id),
        "label": token.label,
        "is_active": True,
        "expires_at": None,
        "last_used_at": None,
        "created_at": now.isoformat(),
        "raw_token": raw,
    }


def list_portal_tokens(
    db: Session,
    *,
    tenant_id: UUID,
    parent_id: UUID,
) -> List[Dict]:
    _get_parent_or_404(db, tenant_id, parent_id)

    rows = db.execute(
        sa.select(ParentPortalToken)
        .where(
            ParentPortalToken.tenant_id == tenant_id,
            ParentPortalToken.parent_id == parent_id,
            ParentPortalToken.is_active == True,
        )
        .order_by(ParentPortalToken.created_at.desc())
    ).scalars().all()

    return [
        {
            "id": str(r.id),
            "label": r.label,
            "is_active": bool(r.is_active),
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else "",
        }
        for r in rows
    ]


def revoke_portal_token(
    db: Session,
    *,
    tenant_id: UUID,
    parent_id: UUID,
    token_id: UUID,
    actor_user_id: UUID,
) -> None:
    row = db.execute(
        sa.select(ParentPortalToken)
        .where(
            ParentPortalToken.id == token_id,
            ParentPortalToken.tenant_id == tenant_id,
            ParentPortalToken.parent_id == parent_id,
        )
    ).scalar_one_or_none()

    if row is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Token not found")

    row.is_active = False
    db.flush()

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="parent.portal_token.revoke", resource="parent", resource_id=parent_id,
        payload={"token_id": str(token_id)},
        meta=None,
    )


def resolve_portal_token(
    db: Session,
    *,
    raw_token: str,
    tenant_id: UUID,
) -> Dict:
    """Validate raw token for a tenant, bump last_used_at, return parent + children."""
    from datetime import datetime, timezone

    h = _token_hash(raw_token)
    token_row = db.execute(
        sa.select(ParentPortalToken)
        .where(
            ParentPortalToken.token_hash == h,
            ParentPortalToken.tenant_id == tenant_id,
            ParentPortalToken.is_active == True,
        )
    ).scalar_one_or_none()

    if token_row is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Invalid or expired portal link.")

    if token_row.expires_at and token_row.expires_at < datetime.now(timezone.utc):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Portal link has expired.")

    token_row.last_used_at = datetime.now(timezone.utc)
    db.flush()

    parent = db.get(Parent, token_row.parent_id)
    if parent is None or not parent.is_active:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Parent record not found.")

    children_rows = db.execute(
        sa.text("""
            SELECT
                pel.id           AS link_id,
                pel.enrollment_id,
                pel.relationship,
                e.payload,
                e.student_id
            FROM core.parent_enrollment_links pel
            JOIN core.enrollments e ON e.id = pel.enrollment_id
            WHERE pel.parent_id = :pid AND pel.tenant_id = :tid
        """),
        {"pid": str(parent.id), "tid": str(tenant_id)},
    ).mappings().all()

    # Resolve current term once for this tenant
    current_term = db.execute(
        sa.text("""
            SELECT id FROM core.tenant_terms
            WHERE tenant_id = :tid AND is_active = true
            ORDER BY start_date DESC LIMIT 1
        """),
        {"tid": str(tenant_id)},
    ).mappings().first()
    current_term_id = current_term["id"] if current_term else None

    children = []
    for row in children_rows:
        payload = dict(row["payload"] or {})
        outstanding = _outstanding_for_enrollment(db, tenant_id, row["enrollment_id"])
        class_code = payload.get("class_code") or payload.get("admission_class") or ""

        grades: list = []
        if current_term_id and row["student_id"]:
            # Find the student_class_enrollment for this student in the current term
            sce = db.execute(
                sa.text("""
                    SELECT id FROM core.student_class_enrollments
                    WHERE student_id = :sid AND term_id = :trid AND tenant_id = :tid
                    LIMIT 1
                """),
                {"sid": str(row["student_id"]), "trid": str(current_term_id), "tid": str(tenant_id)},
            ).mappings().first()

            if sce:
                grades_rows = db.execute(
                    sa.text("""
                        SELECT
                            la.name  AS learning_area,
                            st.name  AS strand,
                            ss.name  AS sub_strand,
                            a.performance_level,
                            a.teacher_observations
                        FROM core.cbc_assessments a
                        JOIN core.cbc_sub_strands ss    ON ss.id = a.sub_strand_id
                        JOIN core.cbc_strands st        ON st.id = ss.strand_id
                        JOIN core.cbc_learning_areas la ON la.id = st.learning_area_id
                        WHERE a.enrollment_id = :eid
                          AND a.term_id       = :trid
                          AND a.tenant_id     = :tid
                        ORDER BY la.display_order, la.name, st.display_order, st.name,
                                 ss.display_order, ss.name
                    """),
                    {"eid": str(sce["id"]), "trid": str(current_term_id), "tid": str(tenant_id)},
                ).mappings().all()

                grades = [
                    {
                        "subject": g["learning_area"],
                        "strand": g["strand"],
                        "sub_strand": g["sub_strand"],
                        "grade": g["performance_level"],
                        "comments": g["teacher_observations"],
                    }
                    for g in grades_rows
                ]

        # ── Invoices ──────────────────────────────────────────────
        invoice_rows = db.execute(
            sa.text("""
                SELECT id, invoice_type, term_number, academic_year, status,
                       total_amount, paid_amount, balance_amount
                FROM core.invoices
                WHERE enrollment_id = :eid AND tenant_id = :tid
                  AND status != 'DRAFT'
                ORDER BY created_at DESC
            """),
            {"eid": str(row["enrollment_id"]), "tid": str(tenant_id)},
        ).mappings().all()

        invoices = []
        for inv in invoice_rows:
            term_label = None
            if inv["term_number"] and inv["academic_year"]:
                term_label = f"Term {inv['term_number']} {inv['academic_year']}"
            invoices.append({
                "id": str(inv["id"]),
                "invoice_type": inv["invoice_type"],
                "term_label": term_label,
                "status": inv["status"],
                "billed": inv["total_amount"],
                "paid": inv["paid_amount"],
                "balance": inv["balance_amount"],
            })

        # ── Payments ──────────────────────────────────────────────
        payment_rows = db.execute(
            sa.text("""
                SELECT DISTINCT ON (p.id)
                    p.id, p.received_at, p.provider, p.reference, p.amount
                FROM core.payments p
                JOIN core.payment_allocations pa ON pa.payment_id = p.id
                JOIN core.invoices inv ON inv.id = pa.invoice_id
                WHERE inv.enrollment_id = :eid AND p.tenant_id = :tid
                ORDER BY p.id, p.received_at DESC
            """),
            {"eid": str(row["enrollment_id"]), "tid": str(tenant_id)},
        ).mappings().all()

        payments = [
            {
                "id": str(p["id"]),
                "date": p["received_at"].date().isoformat() if p["received_at"] else "",
                "provider": p["provider"],
                "reference": p["reference"],
                "amount": p["amount"],
            }
            for p in sorted(payment_rows, key=lambda x: x["received_at"] or "", reverse=True)
        ]

        # ── Attendance ────────────────────────────────────────────
        attendance_rows = db.execute(
            sa.text("""
                SELECT
                    s.session_date::date AS date,
                    ar.status
                FROM core.attendance_records ar
                JOIN core.attendance_sessions s ON s.id = ar.session_id
                WHERE ar.student_id = :sid
                  AND ar.tenant_id = :tid
                  AND s.session_type = 'MORNING'
                ORDER BY s.session_date DESC
                LIMIT 120
            """),
            {"sid": str(row["student_id"]), "tid": str(tenant_id)},
        ).mappings().all() if row["student_id"] else []

        attendance = [
            {"date": str(a["date"]), "status": a["status"]}
            for a in attendance_rows
        ]

        # ── Discipline Incidents ──────────────────────────────────
        incident_rows = db.execute(
            sa.text("""
                SELECT
                    di.id, di.incident_date, di.incident_type,
                    di.title, di.description, di.status
                FROM core.discipline_incidents di
                JOIN core.discipline_students ds ON ds.incident_id = di.id
                WHERE ds.student_id = :sid AND di.tenant_id = :tid
                ORDER BY di.incident_date DESC
                LIMIT 20
            """),
            {"sid": str(row["student_id"]), "tid": str(tenant_id)},
        ).mappings().all() if row["student_id"] else []

        incidents = [
            {
                "id": str(inc["id"]),
                "date": inc["incident_date"].isoformat() if inc["incident_date"] else "",
                "incident_type": inc["incident_type"],
                "title": inc["title"],
                "description": inc["description"],
                "status": inc["status"],
            }
            for inc in incident_rows
        ]

        children.append({
            "enrollment_id": str(row["enrollment_id"]),
            "student_name": _student_name(payload),
            "admission_number": payload.get("admission_number"),
            "class_code": class_code,
            "class_name": None,
            "relationship": row["relationship"],
            "outstanding": outstanding,
            "grades": grades,
            "invoices": invoices,
            "payments": payments,
            "attendance": attendance,
            "incidents": incidents,
        })

    return {
        "parent_id": str(parent.id),
        "parent_name": f"{parent.first_name} {parent.last_name}".strip(),
        "children": children,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Director-level analytics & enriched data
# ─────────────────────────────────────────────────────────────────────────────

def get_parent_analytics(db: Session, *, tenant_id: UUID) -> Dict:
    """Summary stats across all parents for the director analytics bar."""
    row = db.execute(
        sa.text("""
            SELECT
                COUNT(DISTINCT p.id)                                  AS total_parents,
                COALESCE(SUM(inv_agg.balance), 0)                     AS total_outstanding,
                COALESCE(SUM(inv_agg.billed), 0)                      AS total_billed
            FROM core.parents p
            LEFT JOIN (
                SELECT pel.parent_id,
                       SUM(i.balance_amount) AS balance,
                       SUM(i.total_amount)   AS billed
                FROM core.parent_enrollment_links pel
                JOIN core.invoices i
                     ON i.enrollment_id = pel.enrollment_id
                    AND i.tenant_id = :tid
                WHERE pel.tenant_id = :tid
                GROUP BY pel.parent_id
            ) inv_agg ON inv_agg.parent_id = p.id
            WHERE p.tenant_id = :tid AND p.is_active = true
        """),
        {"tid": str(tenant_id)},
    ).mappings().first()

    total_billed = Decimal(str(row["total_billed"] or 0))
    total_outstanding = Decimal(str(row["total_outstanding"] or 0))
    total_paid = total_billed - total_outstanding
    collection_rate = (
        round(float(total_paid / total_billed * 100), 1) if total_billed > 0 else 0.0
    )

    # Portal access count — graceful if table doesn't exist yet
    try:
        portal_row = db.execute(
            sa.text("""
                SELECT COUNT(DISTINCT parent_id) AS cnt
                FROM core.parent_portal_tokens
                WHERE tenant_id = :tid AND is_active = true
            """),
            {"tid": str(tenant_id)},
        ).mappings().first()
        with_portal_access = int(portal_row["cnt"] or 0) if portal_row else 0
    except Exception:
        with_portal_access = 0

    return {
        "total_parents": int(row["total_parents"] or 0),
        "total_outstanding": total_outstanding,
        "total_billed": total_billed,
        "collection_rate_pct": collection_rate,
        "with_portal_access": with_portal_access,
    }


def get_all_parent_invoices(db: Session, *, tenant_id: UUID, parent_id: UUID) -> List[Dict]:
    """All invoices (every status) across all children linked to a parent."""
    _get_parent_or_404(db, tenant_id, parent_id)

    rows = db.execute(
        sa.text("""
            SELECT
                inv.id            AS invoice_id,
                inv.enrollment_id,
                inv.invoice_type,
                inv.invoice_no,
                inv.status,
                inv.total_amount,
                inv.paid_amount,
                inv.balance_amount,
                inv.created_at,
                e.payload
            FROM core.parent_enrollment_links pel
            JOIN core.invoices inv
                 ON inv.enrollment_id = pel.enrollment_id
                AND inv.tenant_id = :tid
            JOIN core.enrollments e ON e.id = pel.enrollment_id
            WHERE pel.parent_id = :pid AND pel.tenant_id = :tid
            ORDER BY inv.created_at DESC
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
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        })
    return result


def get_parent_payment_history(db: Session, *, tenant_id: UUID, parent_id: UUID) -> List[Dict]:
    """All payments ever recorded against invoices for this parent's children."""
    _get_parent_or_404(db, tenant_id, parent_id)

    rows = db.execute(
        sa.text("""
            SELECT DISTINCT ON (pay.id)
                pay.id          AS payment_id,
                pay.receipt_no,
                pay.provider,
                pay.reference,
                pay.amount,
                pay.received_at,
                e.payload
            FROM core.parent_enrollment_links pel
            JOIN core.invoices inv
                 ON inv.enrollment_id = pel.enrollment_id
                AND inv.tenant_id = :tid
            JOIN core.payment_allocations pa ON pa.invoice_id = inv.id
            JOIN core.payments pay
                 ON pay.id = pa.payment_id
                AND pay.tenant_id = :tid
            JOIN core.enrollments e ON e.id = pel.enrollment_id
            WHERE pel.parent_id = :pid AND pel.tenant_id = :tid
            ORDER BY pay.id, pay.received_at DESC NULLS LAST
        """),
        {"pid": str(parent_id), "tid": str(tenant_id)},
    ).mappings().all()

    result = []
    for r in rows:
        payload = dict(r["payload"] or {})
        result.append({
            "payment_id": str(r["payment_id"]),
            "receipt_no": r["receipt_no"],
            "provider": r["provider"],
            "reference": r["reference"],
            "amount": Decimal(str(r["amount"] or 0)),
            "received_at": r["received_at"].isoformat() if r["received_at"] else None,
            "student_name": _student_name(payload),
        })
    result.sort(key=lambda x: x["received_at"] or "", reverse=True)
    return result


def get_parent_sms_history(db: Session, *, tenant_id: UUID, parent_id: UUID) -> List[Dict]:
    """Last 50 SMS messages sent to this parent's phone number."""
    p = _get_parent_or_404(db, tenant_id, parent_id)
    if not p.phone:
        return []

    rows = db.execute(
        sa.text("""
            SELECT id, to_phone, recipient_name, message_body,
                   status, created_at, sent_at, delivered_at
            FROM core.sms_messages
            WHERE tenant_id = :tid AND to_phone = :phone
            ORDER BY created_at DESC
            LIMIT 50
        """),
        {"tid": str(tenant_id), "phone": p.phone},
    ).mappings().all()

    return [
        {
            "id": str(r["id"]),
            "message_body": r["message_body"],
            "status": r["status"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "sent_at": r["sent_at"].isoformat() if r["sent_at"] else None,
            "delivered_at": r["delivered_at"].isoformat() if r["delivered_at"] else None,
        }
        for r in rows
    ]


def send_portal_link_sms(
    db: Session,
    *,
    tenant_id: UUID,
    parent_id: UUID,
    actor_user_id: UUID,
    school_slug: str,
    portal_base_url: str,
    label: Optional[str] = None,
) -> Dict:
    """Generate a portal token and immediately send the link to the parent via SMS."""
    from app.api.v1.sms import service as sms_svc

    p = _get_parent_or_404(db, tenant_id, parent_id)
    if not p.phone:
        raise ValueError("Parent has no phone number on record.")

    token_data = generate_portal_token(
        db,
        tenant_id=tenant_id,
        parent_id=parent_id,
        actor_user_id=actor_user_id,
        label=label or "WhatsApp / SMS",
    )

    raw_token = token_data["raw_token"]
    portal_url = f"{portal_base_url}/portal?token={raw_token}&slug={school_slug}"

    parent_name = f"{p.first_name or ''} {p.last_name or ''}".strip() or "Guardian"
    message = (
        f"Dear {parent_name}, your school portal link is ready. "
        f"View your child's fees and progress here: {portal_url}"
    )

    try:
        sms_svc.send_single_sms(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            to_phone=p.phone,
            recipient_name=parent_name,
            message_body=message,
            meta={"portal_token_id": token_data["id"]},
        )
        sms_sent = True
    except ValueError as exc:
        sms_sent = False
        token_data["sms_warning"] = str(exc)

    token_data["sms_sent"] = sms_sent
    token_data["portal_url"] = portal_url
    return token_data


def export_parents_csv(db: Session, *, tenant_id: UUID) -> str:
    """Return CSV string of all active parents with outstanding totals."""
    import csv, io

    rows = db.execute(
        sa.text("""
            SELECT
                p.first_name,
                p.last_name,
                p.phone,
                p.email,
                p.phone_alt,
                p.national_id,
                p.occupation,
                COUNT(DISTINCT pel.enrollment_id)  AS child_count,
                COALESCE(SUM(inv.balance_amount), 0) AS outstanding_total
            FROM core.parents p
            LEFT JOIN core.parent_enrollment_links pel
                ON pel.parent_id = p.id AND pel.tenant_id = :tid
            LEFT JOIN core.invoices inv
                ON inv.enrollment_id = pel.enrollment_id
               AND inv.tenant_id = :tid
               AND inv.balance_amount > 0
            WHERE p.tenant_id = :tid AND p.is_active = true
            GROUP BY p.id, p.first_name, p.last_name, p.phone, p.email,
                     p.phone_alt, p.national_id, p.occupation
            ORDER BY p.first_name, p.last_name
        """),
        {"tid": str(tenant_id)},
    ).mappings().all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "First Name", "Last Name", "Phone", "Email",
        "Alt Phone", "National ID", "Occupation",
        "Children", "Outstanding (KES)",
    ])
    for r in rows:
        writer.writerow([
            r["first_name"] or "",
            r["last_name"] or "",
            r["phone"] or "",
            r["email"] or "",
            r["phone_alt"] or "",
            r["national_id"] or "",
            r["occupation"] or "",
            int(r["child_count"] or 0),
            str(Decimal(str(r["outstanding_total"] or 0))),
        ])
    return buf.getvalue()


# ─────────────────────────────────────────────────────────────────────────────
# Auto-link on enrollment (called from enrollment service)
# ─────────────────────────────────────────────────────────────────────────────

def sync_kemis_parents_from_payload(
    db: Session, *, tenant_id: UUID, enrollment_id: UUID, payload: Dict,
) -> int:
    """Phase W (KEMIS 2026) — create/link structured Mother / Father /
    Guardian records from the intake payload's KEMIS sections.

    Expects payload keys ``mother`` / ``father`` / ``guardian``, each an
    object with (any of): first_name, middle_name, last_name, id_type,
    national_id, country_of_residence, phone, email, relationship.

    Behaviour:
      * A section with no name AND no phone is skipped (blank form section).
      * Parents are de-duplicated by (tenant, phone) — an existing record
        is updated with any newly-supplied fields, never blanked.
      * Each synced parent is linked to the enrollment with the KEMIS
        relationship (MOTHER / FATHER / GUARDIAN). The first present
        section becomes the primary link (mother, else father, else
        guardian).
      * Returns how many parent records were created/updated. No commit —
        the caller owns the transaction.
    """
    guardian_section = payload.get("guardian")
    guardian_rel = "GUARDIAN"
    if isinstance(guardian_section, dict):
        rel_raw = str(guardian_section.get("relationship") or "").strip().upper()
        if rel_raw:
            guardian_rel = rel_raw[:80]
    sections = (
        ("mother", "MOTHER"),
        ("father", "FATHER"),
        ("guardian", guardian_rel),
    )
    synced = 0
    primary_assigned = False
    for key, relationship in sections:
        section = payload.get(key)
        if not isinstance(section, dict):
            continue
        first = str(section.get("first_name") or "").strip()
        last = str(section.get("last_name") or "").strip()
        phone = str(section.get("phone") or section.get("mobile") or "").strip()
        if not (first or last) and not phone:
            continue  # blank form section

        fields = {
            "first_name": first or None,
            "middle_name": str(section.get("middle_name") or "").strip() or None,
            "last_name": last or None,
            "email": str(section.get("email") or "").strip() or None,
            "id_type": str(section.get("id_type") or "").strip().upper() or None,
            "national_id": str(section.get("national_id") or "").strip() or None,
            "country_of_residence": str(section.get("country_of_residence") or "").strip() or None,
        }

        parent_id: Optional[str] = None
        if phone:
            existing = db.execute(
                sa.text(
                    "SELECT id FROM core.parents "
                    "WHERE tenant_id = :tid AND phone = :phone LIMIT 1"
                ),
                {"tid": str(tenant_id), "phone": phone},
            ).scalar_one_or_none()
            if existing is not None:
                parent_id = str(existing)
                sets = {k: v for k, v in fields.items() if v is not None}
                if sets:
                    db.execute(
                        sa.text(
                            "UPDATE core.parents SET "
                            + ", ".join(f"{k} = :{k}" for k in sets)
                            + " WHERE id = :pid"
                        ),
                        {**sets, "pid": parent_id},
                    )
        if parent_id is None:
            row = db.execute(
                sa.text(
                    "INSERT INTO core.parents "
                    "(tenant_id, first_name, middle_name, last_name, phone, email, "
                    " id_type, national_id, country_of_residence) "
                    "VALUES (:tid, :first_name, :middle_name, :last_name, :phone, "
                    "        :email, :id_type, :national_id, :country_of_residence) "
                    "RETURNING id"
                ),
                {"tid": str(tenant_id), "phone": phone or None, **fields},
            ).scalar_one()
            parent_id = str(row)

        db.execute(
            sa.text(
                "INSERT INTO core.parent_enrollment_links "
                "(tenant_id, parent_id, enrollment_id, relationship, is_primary) "
                "VALUES (:tid, :pid, :eid, :rel, :prim) "
                "ON CONFLICT (parent_id, enrollment_id) "
                "DO UPDATE SET relationship = EXCLUDED.relationship"
            ),
            {"tid": str(tenant_id), "pid": parent_id, "eid": str(enrollment_id),
             "rel": relationship, "prim": not primary_assigned},
        )
        primary_assigned = True
        synced += 1
    return synced


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
