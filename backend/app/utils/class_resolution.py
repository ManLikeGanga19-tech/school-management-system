"""Phase V — Canonical student class/grade resolution.

The intake form stores the class under ``admission_class``; other flows
write ``class_code``; older/imported data may carry ``classCode``,
``class``, or ``grade``. Before this module, every consumer hand-rolled
its own subset of those keys — so the class showed on some screens and
came out blank on printed documents (invoices, receipts, the guardian
update sheet).

ONE chain, used everywhere:

    payload: class_code → classCode → class → admission_class → grade
    fallback: the student's SIS class assignment
              (student_class_enrollments → tenant_classes.code, newest)

``class_code`` deliberately outranks ``admission_class``: when both
exist, class_code is the maintained/current value while admission_class
is the intake snapshot. The SIS assignment is last-resort only so no
currently-correct screen changes its output.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Session


PAYLOAD_CLASS_KEYS = ("class_code", "classCode", "class", "admission_class", "grade")


def class_from_payload(payload: dict[str, Any] | None) -> str:
    """First non-empty class value from the canonical payload key chain."""
    if not isinstance(payload, dict):
        return ""
    for key in PAYLOAD_CLASS_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def sis_class_for_student(
    db: Session, *, tenant_id: UUID, student_id: UUID | str,
) -> str:
    """The student's newest SIS class assignment code, or ''."""
    row = db.execute(
        sa.text(
            """
            SELECT tc.code
            FROM core.student_class_enrollments sce
            JOIN core.tenant_classes tc ON tc.id = sce.class_id
            WHERE sce.student_id = :sid AND sce.tenant_id = :tid
            ORDER BY sce.created_at DESC
            LIMIT 1
            """
        ),
        {"sid": str(student_id), "tid": str(tenant_id)},
    ).mappings().first()
    return str(row["code"]).strip() if row and row.get("code") else ""


def sis_class_map(
    db: Session, *, tenant_id: UUID, student_ids: Iterable[str],
) -> dict[str, str]:
    """Batch variant for scans/exports: {student_id: class_code} using each
    student's newest assignment. One query regardless of roster size."""
    ids = [str(s) for s in student_ids if s]
    if not ids:
        return {}
    rows = db.execute(
        sa.text(
            """
            SELECT DISTINCT ON (sce.student_id)
                   sce.student_id, tc.code
            FROM core.student_class_enrollments sce
            JOIN core.tenant_classes tc ON tc.id = sce.class_id
            WHERE sce.tenant_id = :tid AND sce.student_id = ANY(:ids)
            ORDER BY sce.student_id, sce.created_at DESC
            """
        ),
        {"tid": str(tenant_id), "ids": ids},
    ).mappings().all()
    return {
        str(r["student_id"]): str(r["code"]).strip()
        for r in rows if r.get("code")
    }


def resolve_student_class(
    db: Session,
    *,
    tenant_id: UUID,
    payload: dict[str, Any] | None = None,
    student_id: UUID | str | None = None,
) -> str:
    """Full-chain resolution: payload keys first, SIS assignment fallback."""
    from_payload = class_from_payload(payload)
    if from_payload:
        return from_payload
    if student_id is not None:
        return sis_class_for_student(db, tenant_id=tenant_id, student_id=student_id)
    return ""


def mirror_class_code(payload: dict[str, Any] | None) -> Optional[dict[str, Any]]:
    """Write-side drift stopper: when a payload carries a class under an
    alias key (admission_class etc.) but has no ``class_code``, return a
    copy with class_code mirrored in. Returns None when nothing to do —
    callers only write when there's an actual change."""
    if not isinstance(payload, dict):
        return None
    existing = payload.get("class_code")
    if isinstance(existing, str) and existing.strip():
        return None
    value = class_from_payload(payload)
    if not value:
        return None
    return {**payload, "class_code": value}
