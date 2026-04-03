from __future__ import annotations

import re
from sqlalchemy.orm import Session
from sqlalchemy import select
import sqlalchemy as sa
from uuid import UUID

from app.models.enrollment import Enrollment
from app.core.audit import log_event
from app.api.v1.finance import service as finance_service


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Maximum number of times a secretary may update an ENROLLED student's record
# before the record is locked and requires a director override.
MAX_SECRETARY_EDITS = 3

# Statuses where ALL edits are permanently blocked (no override possible).
# ENROLLED and ENROLLED_PARTIAL are intentionally NOT here — they are editable
# subject to the secretary_edit_count / director-override gate.
_PERMANENTLY_LOCKED_STATUSES = frozenset({"TRANSFERRED"})

# Statuses that are considered "post-enrollment" — edits on these records
# increment the secretary edit counter.
_ENROLLED_STATUSES = frozenset({"ENROLLED", "ENROLLED_PARTIAL"})

_ADM_PREFIX = "ADM-"
_ADM_PATTERN = re.compile(r"^(?:ADM-)?(\d+)$", re.IGNORECASE)


def _get_admission_settings(db: Session, *, tenant_id: UUID) -> tuple[str, int]:
    """Return (prefix, last_number) from tenant_admission_settings. Defaults to ('ADM-', 0)."""
    row = db.execute(
        sa.text(
            "SELECT prefix, last_number FROM core.tenant_admission_settings "
            "WHERE tenant_id = :tid LIMIT 1"
        ),
        {"tid": str(tenant_id)},
    ).mappings().first()
    if row:
        return str(row["prefix"] or "ADM-"), int(row["last_number"] or 0)
    return "ADM-", 0


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _require_payload_fields(enrollment: Enrollment, fields: list[str]) -> None:
    payload = enrollment.payload or {}
    missing = [f for f in fields if not str(payload.get(f, "")).strip()]
    if missing:
        raise ValueError(f"Missing required payload fields: {', '.join(missing)}")


def _next_admission_number(db: Session, *, tenant_id: UUID) -> str:
    """
    Generate the next admission number for a tenant using the configured
    prefix and last_number from tenant_admission_settings.

    Falls back to scanning existing enrollment admission numbers if no
    settings row exists yet, so existing tenants are not disrupted.
    """
    prefix, configured_last = _get_admission_settings(db, tenant_id=tenant_id)

    # Scan existing enrollment numbers to find the actual highest issued.
    # This guards against DB inconsistency (e.g. manual imports).
    rows: list[str] = []
    try:
        rows = [
            str(v or "")
            for v in db.execute(
                sa.text(
                    """
                    SELECT COALESCE(admission_number, payload->>'admission_number', '')
                    FROM core.enrollments
                    WHERE tenant_id = :tenant_id
                    """
                ),
                {"tenant_id": str(tenant_id)},
            ).scalars().all()
        ]
    except Exception as err:
        msg = str(err).lower()
        missing_adm_col = (
            "admission_number" in msg
            and (
                "does not exist" in msg
                or "undefinedcolumn" in msg
                or "no such column" in msg
            )
        )
        if not missing_adm_col:
            raise
        db.rollback()
        rows = [
            str(v or "")
            for v in db.execute(
                sa.text(
                    """
                    SELECT COALESCE(payload->>'admission_number', '')
                    FROM core.enrollments
                    WHERE tenant_id = :tenant_id
                    """
                ),
                {"tenant_id": str(tenant_id)},
            ).scalars().all()
        ]

    # Build a pattern that strips the configured prefix before extracting digits.
    escaped_prefix = re.escape(prefix)
    pattern = re.compile(rf"^(?:{escaped_prefix})?(\d+)$", re.IGNORECASE)

    highest = configured_last
    for raw in rows:
        m = pattern.match(raw or "")
        if m:
            n = int(m.group(1))
            if n > highest:
                highest = n

    next_num = highest + 1
    # Format: plain number if prefix is empty, otherwise prefix + zero-padded 4-digit
    if not prefix:
        return str(next_num)
    return f"{prefix}{next_num:04d}"


def _clean_create_payload(payload: dict) -> dict:
    """Strip internal directive keys that must not be stored in JSONB."""
    private_keys = {"_fee_structure_id", "_fee_structure_code"}
    return {k: v for k, v in payload.items() if k not in private_keys}


def _find_returning_fee_structure(
    db: Session,
    *,
    tenant_id: UUID,
    class_code: str,
):
    """
    Find the most recent active RETURNING fee structure for a class.
    Returns None if no structure exists (enrollment still created; fee can be
    attached manually later by the secretary).
    """
    from app.models.fee_structure import FeeStructure

    return db.execute(
        select(FeeStructure)
        .where(
            FeeStructure.tenant_id == tenant_id,
            FeeStructure.class_code == class_code,
            FeeStructure.student_type == "RETURNING",
            FeeStructure.is_active == True,
        )
        .order_by(FeeStructure.academic_year.desc())
        .limit(1)
    ).scalar_one_or_none()


def _create_student_for_existing_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment: Enrollment,
    admission_no: str,
) -> None:
    """
    Create a core.students record for an EXISTING_STUDENT enrollment and
    link it back to the enrollment.  Skips silently if a student with the
    same admission_no already exists for this tenant.
    """
    # Avoid creating a duplicate if admission_no already exists.
    existing = db.execute(
        sa.text(
            "SELECT id FROM core.students "
            "WHERE tenant_id = :tid AND admission_no = :adm LIMIT 1"
        ),
        {"tid": str(tenant_id), "adm": admission_no},
    ).mappings().first()

    if existing:
        enrollment.student_id = existing["id"]
        db.flush()
        return

    payload = enrollment.payload or {}
    full_name = str(payload.get("student_name") or "").strip()
    parts = full_name.split(None, 1)
    first_name = parts[0] if parts else "Unknown"
    last_name = parts[1] if len(parts) > 1 else ""

    import datetime
    admission_year = datetime.date.today().year

    # Derive admission_year from the free-text admission_term if possible
    term_label = str(payload.get("admission_term") or "")
    for token in term_label.split():
        if token.isdigit() and 1990 <= int(token) <= 2100:
            admission_year = int(token)
            break

    gender = str(payload.get("gender") or "").strip().upper() or None
    dob_raw = str(payload.get("date_of_birth") or "").strip() or None
    previous_school = str(payload.get("previous_school") or "").strip() or None

    student_id = db.execute(
        sa.text(
            """
            INSERT INTO core.students
                (tenant_id, admission_no, first_name, last_name,
                 gender, date_of_birth, previous_school,
                 admission_year, status)
            VALUES
                (:tid, :adm, :fn, :ln, :gender, :dob, :prev_school,
                 :adm_year, 'ACTIVE')
            RETURNING id
            """
        ),
        {
            "tid": str(tenant_id),
            "adm": admission_no,
            "fn": first_name,
            "ln": last_name,
            "gender": gender,
            "dob": dob_raw,
            "prev_school": previous_school,
            "adm_year": admission_year,
        },
    ).scalar_one()

    enrollment.student_id = student_id
    db.flush()

    # Seed guardian from payload (guardian_name / guardian_phone / guardian_email)
    guardian_full = str(payload.get("guardian_name") or "").strip()
    guardian_phone = str(payload.get("guardian_phone") or "").strip() or None
    guardian_email = str(payload.get("guardian_email") or "").strip() or None

    if guardian_full:
        g_parts = guardian_full.split(None, 1)
        g_first = g_parts[0]
        g_last = g_parts[1] if len(g_parts) > 1 else ""

        parent_id = db.execute(
            sa.text(
                """
                INSERT INTO core.parents
                    (tenant_id, first_name, last_name, phone, email, is_active)
                VALUES
                    (:tid, :fn, :ln, :phone, :email, true)
                RETURNING id
                """
            ),
            {
                "tid": str(tenant_id),
                "fn": g_first,
                "ln": g_last,
                "phone": guardian_phone,
                "email": guardian_email,
            },
        ).scalar_one()

        db.execute(
            sa.text(
                """
                INSERT INTO core.parent_students
                    (tenant_id, parent_id, student_id, relationship, is_active)
                VALUES
                    (:tid, :parent_id, :student_id, 'GUARDIAN', true)
                ON CONFLICT DO NOTHING
                """
            ),
            {
                "tid": str(tenant_id),
                "parent_id": str(parent_id),
                "student_id": str(student_id),
            },
        )

        # Also seed as emergency contact so the emergency contact tab has data
        if guardian_phone:
            db.execute(
                sa.text(
                    """
                    INSERT INTO core.student_emergency_contacts
                        (tenant_id, student_id, name, relationship, phone, email, is_primary)
                    VALUES
                        (:tid, :student_id, :name, 'GUARDIAN', :phone, :email, true)
                    """
                ),
                {
                    "tid": str(tenant_id),
                    "student_id": str(student_id),
                    "name": guardian_full,
                    "phone": guardian_phone,
                    "email": guardian_email,
                },
            )

    db.flush()


def _load_admission_number_map(
    db: Session,
    *,
    tenant_id: UUID,
    status: str | None = None,
) -> dict[str, str]:
    where_status = " AND status = :status " if status else ""
    params: dict[str, str] = {"tenant_id": str(tenant_id)}
    if status:
        params["status"] = status.upper()

    try:
        rows = db.execute(
            sa.text(
                f"""
                SELECT id, COALESCE(admission_number, payload->>'admission_number', '') AS admission_number
                FROM core.enrollments
                WHERE tenant_id = :tenant_id
                {where_status}
                """
            ),
            params,
        ).mappings().all()
    except Exception as err:
        msg = str(err).lower()
        missing_adm_col = (
            "admission_number" in msg
            and (
                "does not exist" in msg
                or "undefinedcolumn" in msg
                or "no such column" in msg
            )
        )
        if not missing_adm_col:
            raise

        db.rollback()
        rows = db.execute(
            sa.text(
                f"""
                SELECT id, COALESCE(payload->>'admission_number', '') AS admission_number
                FROM core.enrollments
                WHERE tenant_id = :tenant_id
                {where_status}
                """
            ),
            params,
        ).mappings().all()

    out: dict[str, str] = {}
    for r in rows:
        rid = str(r.get("id") or "").strip()
        adm = str(r.get("admission_number") or "").strip()
        if rid and adm:
            out[rid] = adm
    return out


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def create_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    payload: dict,
) -> Enrollment:
    fee_structure_id: str | None = (
        payload.get("_fee_structure_id") or payload.get("fee_structure_id")
    )
    is_existing_student = (
        str(payload.get("enrollment_source", "")).upper() == "EXISTING_STUDENT"
    )
    clean_payload = _clean_create_payload(payload)

    # Existing students skip the interview/approval pipeline — they are already
    # enrolled; we just need to register them and attach the right fee structure.
    initial_status = "ENROLLED" if is_existing_student else "DRAFT"

    row = Enrollment(
        tenant_id=tenant_id,
        payload=clean_payload,
        status=initial_status,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(row)
    db.flush()

    # For existing students: assign an admission number and create the SIS
    # student record immediately so the profile and carry-forward features work.
    if is_existing_student:
        adm_no = str(clean_payload.get("admission_number") or "").strip()
        if not adm_no:
            adm_no = _next_admission_number(db, tenant_id=tenant_id)
        row.admission_number = adm_no
        row.payload = {**clean_payload, "admission_number": adm_no}
        db.flush()
        _create_student_for_existing_enrollment(
            db, tenant_id=tenant_id, enrollment=row, admission_no=adm_no
        )

    # Attach an explicit fee structure if one was provided.
    if fee_structure_id:
        finance_service.assign_fee_structure_to_enrollment(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            enrollment_id=row.id,
            fee_structure_id=UUID(str(fee_structure_id)),
            generate_invoice=False,
        )
    elif is_existing_student:
        # Auto-find the RETURNING fee structure for this class (most recent
        # active academic year) so the secretary can immediately manage fees.
        class_code = str(clean_payload.get("admission_class") or "").strip().upper()
        if class_code:
            returning_structure = _find_returning_fee_structure(
                db, tenant_id=tenant_id, class_code=class_code
            )
            if returning_structure is not None:
                finance_service.assign_fee_structure_to_enrollment(
                    db,
                    tenant_id=tenant_id,
                    actor_user_id=actor_user_id,
                    enrollment_id=row.id,
                    fee_structure_id=returning_structure.id,
                    generate_invoice=False,
                )

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="enrollment.create",
        resource="enrollment",
        resource_id=row.id,
        payload={"status": row.status},
        meta=None,
    )
    return row


def list_enrollments(
    db: Session,
    *,
    tenant_id: UUID,
    status: str | None = None,
) -> list[Enrollment]:
    q = select(Enrollment).where(Enrollment.tenant_id == tenant_id)
    if status:
        q = q.where(Enrollment.status == status.upper())
    rows = db.execute(q.order_by(Enrollment.created_at.desc())).scalars().all()

    try:
        adm_map = _load_admission_number_map(db, tenant_id=tenant_id, status=status)
    except Exception:
        adm_map = {}

    for row in rows:
        rid = str(getattr(row, "id", "") or "")
        payload = getattr(row, "payload", None)
        payload_adm = (
            str((payload or {}).get("admission_number") or "").strip()
            if isinstance(payload, dict)
            else ""
        )
        admission_number = adm_map.get(rid) or payload_adm or None
        setattr(row, "admission_number", admission_number)

    return rows


def _normalize_status_list(values: list[str] | tuple[str, ...] | None) -> list[str]:
    out: list[str] = []
    for raw in values or []:
        code = str(raw or "").strip().upper()
        if code and code not in out:
            out.append(code)
    return out


def list_enrollments_paged(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int = 100,
    offset: int = 0,
    status: str | None = None,
    status_in: list[str] | tuple[str, ...] | None = None,
    status_not_in: list[str] | tuple[str, ...] | None = None,
    search: str | None = None,
    class_code: str | None = None,
    term_code: str | None = None,
) -> tuple[list[Enrollment], int]:
    """
    Tenant-scoped, server-side paginated enrollment listing.

    Supports deterministic ordering and optional status/search/class/term filters.
    """
    q = select(Enrollment).where(Enrollment.tenant_id == tenant_id)

    if status:
        q = q.where(sa.func.upper(Enrollment.status) == status.strip().upper())

    include_statuses = _normalize_status_list(status_in)
    if include_statuses:
        q = q.where(sa.func.upper(Enrollment.status).in_(include_statuses))

    exclude_statuses = _normalize_status_list(status_not_in)
    if exclude_statuses:
        q = q.where(sa.not_(sa.func.upper(Enrollment.status).in_(exclude_statuses)))

    class_expr = sa.func.lower(
        sa.func.coalesce(
            Enrollment.payload["admission_class"].astext,
            Enrollment.payload["class_code"].astext,
            Enrollment.payload["classCode"].astext,
            Enrollment.payload["grade"].astext,
            "",
        )
    )
    term_expr = sa.func.lower(
        sa.func.coalesce(
            Enrollment.payload["admission_term"].astext,
            Enrollment.payload["term_code"].astext,
            Enrollment.payload["termCode"].astext,
            Enrollment.payload["term"].astext,
            "",
        )
    )

    normalized_class = str(class_code or "").strip().lower()
    if normalized_class:
        q = q.where(class_expr == normalized_class)

    normalized_term = str(term_code or "").strip().lower()
    if normalized_term:
        q = q.where(term_expr == normalized_term)

    normalized_search = str(search or "").strip().lower()
    if normalized_search:
        like = f"%{normalized_search}%"
        name_expr = sa.func.lower(
            sa.func.coalesce(
                Enrollment.payload["student_name"].astext,
                Enrollment.payload["studentName"].astext,
                Enrollment.payload["full_name"].astext,
                Enrollment.payload["fullName"].astext,
                Enrollment.payload["name"].astext,
                "",
            )
        )
        admission_expr = sa.func.lower(
            sa.func.coalesce(
                Enrollment.payload["admission_number"].astext,
                "",
            )
        )
        id_expr = sa.func.lower(sa.cast(Enrollment.id, sa.String))
        q = q.where(
            sa.or_(
                name_expr.like(like),
                class_expr.like(like),
                term_expr.like(like),
                admission_expr.like(like),
                id_expr.like(like),
            )
        )

    count_stmt = select(sa.func.count()).select_from(q.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one() or 0)

    rows = (
        db.execute(
            q.order_by(Enrollment.created_at.desc(), Enrollment.id.desc())
            .offset(offset)
            .limit(limit)
        )
        .scalars()
        .all()
    )

    try:
        adm_map = _load_admission_number_map(db, tenant_id=tenant_id)
    except Exception:
        adm_map = {}

    for row in rows:
        rid = str(getattr(row, "id", "") or "")
        payload = getattr(row, "payload", None)
        payload_adm = (
            str((payload or {}).get("admission_number") or "").strip()
            if isinstance(payload, dict)
            else ""
        )
        admission_number = adm_map.get(rid) or payload_adm or None
        setattr(row, "admission_number", admission_number)

    return rows, total


def get_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    enrollment_id: UUID,
) -> Enrollment | None:
    row = db.execute(
        select(Enrollment).where(
            Enrollment.tenant_id == tenant_id,
            Enrollment.id == enrollment_id,
        )
    ).scalar_one_or_none()
    if not row:
        return None

    admission_number: str | None = None
    payload = getattr(row, "payload", None)
    if isinstance(payload, dict):
        payload_adm = str(payload.get("admission_number") or "").strip()
        if payload_adm:
            admission_number = payload_adm

    if not admission_number:
        try:
            admission_number = _load_admission_number_map(
                db,
                tenant_id=tenant_id,
            ).get(str(enrollment_id))
        except Exception:
            admission_number = None

    setattr(row, "admission_number", admission_number)
    return row


def update_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment: Enrollment,
    payload: dict | None,
    bypass_edit_limit: bool = False,
) -> Enrollment:
    """
    Merge-update an enrollment's payload.

    Rules:
      - TRANSFERRED records are permanently locked for everyone — no edits ever.
      - Directors pass bypass_edit_limit=True which skips all secretary-counter
        logic entirely: their edits are never counted and never blocked.
      - ENROLLED / ENROLLED_PARTIAL records edited by secretaries
        (bypass_edit_limit=False) are subject to MAX_SECRETARY_EDITS.
        Once secretary_edit_locked is True the update is rejected until a
        director calls director_override().
      - Pre-enrollment records (DRAFT → APPROVED) are unrestricted and do
        NOT increment the secretary edit counter.
    """
    status = enrollment.status

    # Permanent lock — blocks everyone including directors
    if status in _PERMANENTLY_LOCKED_STATUSES:
        raise ValueError(
            f"Cannot edit a '{status}' enrollment. "
            "Use the transfer flow or create a new record."
        )

    if not bypass_edit_limit:
        # Secretary path — enforce edit-count gate on enrolled records only.
        # getattr with defaults guards against the migration not yet having run
        # (columns absent from DB → attribute missing on ORM object).
        if status in _ENROLLED_STATUSES:
            edit_locked = getattr(enrollment, "secretary_edit_locked", False) or False
            if edit_locked:
                raise ValueError(
                    f"Edit limit reached ({MAX_SECRETARY_EDITS}/{MAX_SECRETARY_EDITS}). "
                    "A director must unlock this record before further changes can be made."
                )

    if payload is not None:
        current = dict(enrollment.payload or {})
        enrollment.payload = {**current, **payload}

    # Only increment the secretary counter — directors are never counted.
    # getattr guards against the columns not existing in DB yet.
    if not bypass_edit_limit and status in _ENROLLED_STATUSES:
        current_count = getattr(enrollment, "secretary_edit_count", 0) or 0
        new_count = current_count + 1
        if hasattr(enrollment, "secretary_edit_count"):
            enrollment.secretary_edit_count = new_count
        if hasattr(enrollment, "secretary_edit_locked") and new_count >= MAX_SECRETARY_EDITS:
            enrollment.secretary_edit_locked = True

    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="enrollment.update",
        resource="enrollment",
        resource_id=enrollment.id,
        payload={
            "status": enrollment.status,
            "secretary_edit_count": getattr(enrollment, "secretary_edit_count", 0),
            "secretary_edit_locked": getattr(enrollment, "secretary_edit_locked", False),
        },
        meta=None,
    )
    return enrollment


def director_override(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment: Enrollment,
    note: str | None,
) -> Enrollment:
    """
    Director-level action: resets the secretary edit lock on an enrolled
    student's record, allowing one further update cycle.

    The counter is reset to 0 and the lock is cleared.  The director's note
    and identity are recorded in the audit log.

    Restricted to ENROLLED / ENROLLED_PARTIAL records only.
    """
    if enrollment.status not in _ENROLLED_STATUSES:
        raise ValueError(
            "Director override is only applicable to ENROLLED or ENROLLED_PARTIAL records."
        )

    prev_count = getattr(enrollment, "secretary_edit_count", 0) or 0
    if hasattr(enrollment, "secretary_edit_count"):
        enrollment.secretary_edit_count = 0
    if hasattr(enrollment, "secretary_edit_locked"):
        enrollment.secretary_edit_locked = False
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="enrollment.director_override",
        resource="enrollment",
        resource_id=enrollment.id,
        payload={
            "status": enrollment.status,
            "previous_edit_count": prev_count,
            "note": note,
        },
        meta=None,
    )
    return enrollment


# ---------------------------------------------------------------------------
# Workflow transitions
# ---------------------------------------------------------------------------

def submit_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment: Enrollment,
) -> Enrollment:
    if enrollment.status != "DRAFT":
        raise ValueError(
            f"Only DRAFT enrollments can be submitted (current: {enrollment.status})"
        )

    finance = finance_service.get_enrollment_finance_status(
        db, tenant_id=tenant_id, enrollment_id=enrollment.id
    )
    if finance["policy"]["require_interview_fee_before_submit"]:
        if not finance["interview"]["paid_ok"]:
            raise ValueError("Interview fee must be fully paid before submission.")

    enrollment.status = "SUBMITTED"
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="enrollment.submit", resource="enrollment",
        resource_id=enrollment.id,
        payload={"status": enrollment.status}, meta=None,
    )
    return enrollment


def approve_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment: Enrollment,
) -> Enrollment:
    if enrollment.status != "SUBMITTED":
        raise ValueError(
            f"Only SUBMITTED enrollments can be approved (current: {enrollment.status})"
        )

    enrollment.status = "APPROVED"
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="enrollment.approve", resource="enrollment",
        resource_id=enrollment.id,
        payload={"status": enrollment.status}, meta=None,
    )
    return enrollment


def reject_enrollment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment: Enrollment,
    reason: str | None,
) -> Enrollment:
    if enrollment.status not in ("SUBMITTED", "APPROVED"):
        raise ValueError(
            f"Only SUBMITTED or APPROVED enrollments can be rejected "
            f"(current: {enrollment.status})"
        )

    enrollment.status = "REJECTED"
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="enrollment.reject", resource="enrollment",
        resource_id=enrollment.id,
        payload={"status": enrollment.status, "reason": reason}, meta=None,
    )
    return enrollment


def mark_enrolled(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment: Enrollment,
    admission_number: str | None = None,
) -> Enrollment:
    """
    Final enrollment step.  Transitions to:
      - ENROLLED         when school fees invoice is fully paid
      - ENROLLED_PARTIAL when tenant policy allows partial and threshold is met

    Requires assessment_no + nemis_no in payload.
    Auto-generates admission_number if not supplied.
    """
    if enrollment.status not in ("APPROVED", "SUBMITTED"):
        raise ValueError(
            f"Enrollment must be APPROVED or SUBMITTED before enrolling "
            f"(current: {enrollment.status})"
        )

    _require_payload_fields(enrollment, ["assessment_no", "nemis_no"])

    finance = finance_service.get_enrollment_finance_status(
        db, tenant_id=tenant_id, enrollment_id=enrollment.id
    )

    if finance["interview"]["invoice_id"] and not finance["interview"]["paid_ok"]:
        raise ValueError("Interview fee must be fully paid before final enrollment.")

    if finance["fees"]["invoice_id"] is None:
        new_status = "ENROLLED"
    elif finance["fees"]["paid_ok"]:
        new_status = "ENROLLED"
    elif finance["fees"]["partial_ok"]:
        new_status = "ENROLLED_PARTIAL"
    else:
        raise ValueError(
            "School fees are not cleared and partial-enrollment policy is not satisfied."
        )

    if not admission_number or not admission_number.strip():
        admission_number = _next_admission_number(db, tenant_id=tenant_id)

    admission_number = admission_number.strip()
    enrollment.admission_number = admission_number
    payload = dict(enrollment.payload or {})
    payload["admission_number"] = admission_number
    enrollment.payload = payload
    enrollment.status = new_status
    enrollment.updated_by = actor_user_id
    db.flush()

    # Create SIS student record so the profile page and carry-forward work.
    if not getattr(enrollment, "student_id", None):
        _create_student_for_existing_enrollment(
            db, tenant_id=tenant_id, enrollment=enrollment, admission_no=admission_number
        )

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="enrollment.enroll", resource="enrollment",
        resource_id=enrollment.id,
        payload={
            "status": enrollment.status,
            "admission_number": enrollment.admission_number,
        },
        meta=None,
    )
    return enrollment


def request_transfer(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment: Enrollment,
) -> Enrollment:
    if enrollment.status not in ("ENROLLED", "ENROLLED_PARTIAL"):
        raise ValueError(
            f"Only enrolled students can request a transfer (current: {enrollment.status})"
        )

    enrollment.status = "TRANSFER_REQUESTED"
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="enrollment.transfer.request", resource="enrollment",
        resource_id=enrollment.id,
        payload={"status": enrollment.status}, meta=None,
    )
    return enrollment


def approve_transfer(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    enrollment: Enrollment,
) -> Enrollment:
    if enrollment.status != "TRANSFER_REQUESTED":
        raise ValueError(
            "Transfer must be in TRANSFER_REQUESTED status before approval."
        )

    finance = finance_service.get_enrollment_finance_status(
        db, tenant_id=tenant_id, enrollment_id=enrollment.id
    )
    if finance["fees"]["invoice_id"] and not finance["fees"]["paid_ok"]:
        raise ValueError(
            "School fees must be fully cleared before the transfer is approved."
        )

    enrollment.status = "TRANSFERRED"
    enrollment.updated_by = actor_user_id
    db.flush()

    log_event(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        action="enrollment.transfer.approve", resource="enrollment",
        resource_id=enrollment.id,
        payload={"status": enrollment.status}, meta=None,
    )
    return enrollment
