"""Phase T3 — Guardian data-quality checker.

Scans enrollment payloads for inaccurate guardian information and offers
safe one-click fixes. The dirty patterns handled (as specified by the
school's operations):

    NAME_MISSING     guardian_name empty / "N/A" / "-" / "none"
    NAME_IS_PHONE    guardian_name is actually a phone number
    PHONE_MULTI      guardian_phone holds two numbers ("0712.../0723...")
    PHONE_INVALID    normalized phone isn't a valid 10-digit 07/01 number
    PARENT_UNLINKED  a Parents-module record with this phone exists but the
                     enrollment isn't linked to it

Phone normalization (Kenya): "+254712345678", "254712345678", and
"712345678" all normalize to "0712345678". Valid = exactly 10 digits
starting "07" or "01".

Fixes (each audited as students.data_quality.fix):
    SPLIT_MULTI_PHONE  "0712.../0723..." → guardian_phone + guardian_phone_alt
    NORMALIZE_PHONE    "+2547..." → "07..." on the payload
    LINK_PARENT        create the missing parent_enrollment_link (+
                       parent_students when the SIS student exists)
"""
from __future__ import annotations

import re
from typing import Any, Optional
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.audit import log_event


_MISSING_NAME_TOKENS = {"", "n/a", "na", "none", "null", "-", "--", "—", "unknown", "nil"}

# Statuses whose guardian data still matters operationally.
_ACTIVE_STATUSES = (
    "DRAFT", "SUBMITTED", "APPROVED", "ENROLLED", "ENROLLED_PARTIAL",
)


def normalize_phone(raw: str | None) -> str:
    """Best-effort Kenyan phone normalization: returns '07…'/'01…' 10-digit
    form when derivable, else the cleaned digit string as-is."""
    if not raw:
        return ""
    cleaned = re.sub(r"[^\d+]", "", str(raw).strip())
    if cleaned.startswith("+254"):
        cleaned = "0" + cleaned[4:]
    elif cleaned.startswith("254") and len(cleaned) >= 12:
        cleaned = "0" + cleaned[3:]
    elif len(cleaned) == 9 and cleaned[0] in ("7", "1"):
        cleaned = "0" + cleaned
    return cleaned.replace("+", "")


def is_valid_phone(phone: str) -> bool:
    return bool(re.fullmatch(r"0[71]\d{8}", phone))


def looks_like_phone(name: str) -> bool:
    """A guardian NAME that is actually a phone number: ≥7 digits once
    separators are stripped, and almost nothing alphabetic."""
    stripped = re.sub(r"[\s\-+/.()]", "", str(name or ""))
    if not stripped:
        return False
    digits = sum(ch.isdigit() for ch in stripped)
    alpha = sum(ch.isalpha() for ch in stripped)
    return digits >= 7 and alpha <= 2


def _split_multi_phone(raw: str) -> list[str]:
    return [p.strip() for p in re.split(r"[/,;|]| and ", str(raw or "")) if p.strip()]


def scan_guardian_data_quality(
    db: Session, *, tenant_id: UUID,
) -> dict[str, Any]:
    """Scan every active-pipeline enrollment for guardian data issues."""
    rows = db.execute(
        sa.text(
            """
            SELECT e.id, e.status, e.student_id, e.admission_number, e.payload,
                   (SELECT COUNT(*) FROM core.parent_enrollment_links pel
                     WHERE pel.enrollment_id = e.id AND pel.tenant_id = e.tenant_id
                   ) AS link_count
            FROM core.enrollments e
            WHERE e.tenant_id = :tid
              AND e.status = ANY(:statuses)
            ORDER BY e.created_at DESC
            """
        ),
        {"tid": str(tenant_id), "statuses": list(_ACTIVE_STATUSES)},
    ).mappings().all()

    # Pre-load the tenant's parent phone directory once (normalized), so the
    # PARENT_UNLINKED check is O(1) per enrollment even on large tenants.
    parent_rows = db.execute(
        sa.text(
            "SELECT id, first_name, last_name, phone FROM core.parents "
            "WHERE tenant_id = :tid AND phone IS NOT NULL"
        ),
        {"tid": str(tenant_id)},
    ).mappings().all()
    parents_by_phone: dict[str, dict] = {}
    for p in parent_rows:
        key = normalize_phone(p["phone"])
        if key and key not in parents_by_phone:
            parents_by_phone[key] = {
                "parent_id": str(p["id"]),
                "parent_name": " ".join(
                    s for s in (str(p["first_name"] or "").strip(),
                                str(p["last_name"] or "").strip()) if s
                ) or "Guardian",
            }

    flagged: list[dict] = []
    for row in rows:
        payload = row["payload"] if isinstance(row["payload"], dict) else {}
        g_name = str(payload.get("guardian_name") or "").strip()
        g_phone_raw = str(payload.get("guardian_phone") or "").strip()

        issues: list[str] = []
        suggested: dict[str, Any] = {}

        # ── Name checks ────────────────────────────────────────────────
        if g_name.lower() in _MISSING_NAME_TOKENS:
            issues.append("NAME_MISSING")
        elif looks_like_phone(g_name):
            issues.append("NAME_IS_PHONE")

        # ── Phone checks ───────────────────────────────────────────────
        phone_parts = _split_multi_phone(g_phone_raw)
        if len(phone_parts) > 1:
            issues.append("PHONE_MULTI")
            normalized_parts = [normalize_phone(p) for p in phone_parts[:2]]
            suggested["split_phones"] = normalized_parts
        elif g_phone_raw:
            normalized = normalize_phone(g_phone_raw)
            if not is_valid_phone(normalized):
                issues.append("PHONE_INVALID")
            elif normalized != g_phone_raw:
                # Valid after normalization but stored denormalized (+254…).
                issues.append("PHONE_INVALID")
                suggested["normalized_phone"] = normalized
        else:
            issues.append("PHONE_INVALID")  # no phone at all

        # ── Parent-link check ─────────────────────────────────────────
        primary_phone = normalize_phone(phone_parts[0]) if phone_parts else ""
        if (
            primary_phone
            and is_valid_phone(primary_phone)
            and int(row["link_count"] or 0) == 0
            and primary_phone in parents_by_phone
        ):
            issues.append("PARENT_UNLINKED")
            suggested["matched_parent"] = parents_by_phone[primary_phone]

        if not issues:
            continue

        flagged.append({
            "enrollment_id": str(row["id"]),
            "enrollment_status": str(row["status"] or ""),
            "student_id": str(row["student_id"]) if row["student_id"] else None,
            "student_name": str(
                payload.get("student_name") or payload.get("full_name") or "Unknown student"
            ),
            "admission_number": (
                str(row["admission_number"] or "")
                or str(payload.get("admission_number") or "")
            ) or None,
            "class_code": str(payload.get("class_code") or "") or None,
            "guardian_name": g_name or None,
            "guardian_phone": g_phone_raw or None,
            "issues": issues,
            "suggested": suggested or None,
        })

    issue_counts: dict[str, int] = {}
    for f in flagged:
        for code in f["issues"]:
            issue_counts[code] = issue_counts.get(code, 0) + 1

    return {
        "checked": len(rows),
        "flagged": len(flagged),
        "issue_counts": issue_counts,
        "students": flagged,
    }


def apply_data_quality_fix(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    enrollment_id: UUID,
    action: str,
) -> dict[str, Any]:
    """Apply one safe fix to one enrollment. Audited. Raises ValueError with
    an operator-readable message when the fix does not apply."""
    row = db.execute(
        sa.text(
            "SELECT id, student_id, payload FROM core.enrollments "
            "WHERE id = :eid AND tenant_id = :tid"
        ),
        {"eid": str(enrollment_id), "tid": str(tenant_id)},
    ).mappings().first()
    if row is None:
        raise ValueError("Enrollment not found")
    payload = row["payload"] if isinstance(row["payload"], dict) else {}
    g_phone_raw = str(payload.get("guardian_phone") or "").strip()

    import json as _json
    patch: dict[str, Any] = {}
    detail: dict[str, Any] = {}

    if action == "SPLIT_MULTI_PHONE":
        parts = _split_multi_phone(g_phone_raw)
        if len(parts) < 2:
            raise ValueError("Guardian phone does not contain multiple numbers")
        first, second = normalize_phone(parts[0]), normalize_phone(parts[1])
        patch = {"guardian_phone": first, "guardian_phone_alt": second}
        detail = {"before": g_phone_raw, "phone": first, "phone_alt": second}

    elif action == "NORMALIZE_PHONE":
        normalized = normalize_phone(g_phone_raw)
        if not is_valid_phone(normalized):
            raise ValueError(
                "Phone cannot be auto-normalized to a valid 10-digit number — "
                "edit it manually on the student profile."
            )
        if normalized == g_phone_raw:
            raise ValueError("Phone is already normalized")
        patch = {"guardian_phone": normalized}
        detail = {"before": g_phone_raw, "after": normalized}

    elif action == "LINK_PARENT":
        primary_phone = normalize_phone(_split_multi_phone(g_phone_raw)[0] if g_phone_raw else "")
        if not is_valid_phone(primary_phone):
            raise ValueError("Guardian phone is not valid — fix the phone first")
        parent = db.execute(
            sa.text(
                "SELECT id, first_name, last_name FROM core.parents "
                "WHERE tenant_id = :tid AND phone = :phone LIMIT 1"
            ),
            {"tid": str(tenant_id), "phone": primary_phone},
        ).mappings().first()
        if parent is None:
            raise ValueError("No parent record matches this phone number")
        db.execute(
            sa.text(
                "INSERT INTO core.parent_enrollment_links "
                "(tenant_id, parent_id, enrollment_id, relationship) "
                "VALUES (:tid, :pid, :eid, 'GUARDIAN') "
                "ON CONFLICT (parent_id, enrollment_id) DO NOTHING"
            ),
            {"tid": str(tenant_id), "pid": str(parent["id"]), "eid": str(enrollment_id)},
        )
        if row["student_id"]:
            db.execute(
                sa.text(
                    "INSERT INTO core.parent_students "
                    "(tenant_id, parent_id, student_id, relationship, is_active) "
                    "VALUES (:tid, :pid, :sid, 'GUARDIAN', TRUE) "
                    "ON CONFLICT DO NOTHING"
                ),
                {"tid": str(tenant_id), "pid": str(parent["id"]),
                 "sid": str(row["student_id"])},
            )
        detail = {
            "parent_id": str(parent["id"]),
            "parent_name": " ".join(
                s for s in (str(parent["first_name"] or "").strip(),
                            str(parent["last_name"] or "").strip()) if s
            ),
        }

    else:
        raise ValueError(
            "Unknown fix action. Use SPLIT_MULTI_PHONE | NORMALIZE_PHONE | LINK_PARENT"
        )

    if patch:
        db.execute(
            sa.text(
                "UPDATE core.enrollments "
                "SET payload = COALESCE(payload, CAST('{}' AS jsonb)) "
                "              || CAST(:patch AS jsonb) "
                "WHERE id = :eid AND tenant_id = :tid"
            ),
            {"patch": _json.dumps(patch), "eid": str(enrollment_id),
             "tid": str(tenant_id)},
        )

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="students.data_quality.fix",
        resource="enrollment",
        resource_id=enrollment_id,
        payload={"fix_action": action, **detail},
        meta=None,
    )
    return {"ok": True, "action": action, **detail}
