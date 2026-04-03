from __future__ import annotations

from typing import Any, Optional
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.exc import InternalError, OperationalError, ProgrammingError
from sqlalchemy.orm import Session

THREAD_STATUS_VALUES = {
    "OPEN",
    "WAITING_ADMIN",
    "WAITING_TENANT",
    "RESOLVED",
    "CLOSED",
}
THREAD_PRIORITY_VALUES = {"LOW", "NORMAL", "HIGH", "URGENT"}
SENDER_MODE_VALUES = {"TENANT", "SAAS_ADMIN", "SYSTEM"}


def _safe_missing_table(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "does not exist" in msg
        or "undefined column" in msg
        or "undefined table" in msg
        or "relation" in msg and "not found" in msg
    ) and (
        "support_threads" in msg
        or "support_messages" in msg
        or "reply_to_message_id" in msg
    )


def _run_mappings(db: Session, stmt: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        rows = db.execute(sa.text(stmt), params).mappings().all()
        return [dict(row) for row in rows]
    except (ProgrammingError, OperationalError, InternalError) as err:
        db.rollback()
        if _safe_missing_table(err):
            raise RuntimeError("Support storage is not configured. Run database migrations.")
        raise


def _run_first_mapping(db: Session, stmt: str, params: dict[str, Any]) -> dict[str, Any] | None:
    try:
        row = db.execute(sa.text(stmt), params).mappings().first()
        return dict(row) if row else None
    except (ProgrammingError, OperationalError, InternalError) as err:
        db.rollback()
        if _safe_missing_table(err):
            raise RuntimeError("Support storage is not configured. Run database migrations.")
        raise


def _run_scalar_int(db: Session, stmt: str, params: dict[str, Any]) -> int:
    try:
        value = db.execute(sa.text(stmt), params).scalar()
    except (ProgrammingError, OperationalError, InternalError) as err:
        db.rollback()
        if _safe_missing_table(err):
            raise RuntimeError("Support storage is not configured. Run database migrations.")
        raise
    parsed = int(value or 0)
    return parsed if parsed > 0 else 0


def _normalize_status(value: Optional[str], *, default: str = "OPEN") -> str:
    cleaned = str(value or default).strip().upper().replace(" ", "_")
    if cleaned not in THREAD_STATUS_VALUES:
        raise ValueError(f"status must be one of: {', '.join(sorted(THREAD_STATUS_VALUES))}")
    return cleaned


def _normalize_priority(value: Optional[str], *, default: str = "NORMAL") -> str:
    cleaned = str(value or default).strip().upper().replace(" ", "_")
    if cleaned not in THREAD_PRIORITY_VALUES:
        raise ValueError(f"priority must be one of: {', '.join(sorted(THREAD_PRIORITY_VALUES))}")
    return cleaned


def _clean_text(value: Optional[str], *, max_len: int) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        return ""
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len]
    return cleaned


def _message_preview(value: str) -> str:
    clean = _clean_text(value, max_len=500)
    return clean


def _serialize_thread(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row.get("id") or ""),
        "tenant_id": str(row.get("tenant_id") or ""),
        "tenant_name": (str(row.get("tenant_name")) if row.get("tenant_name") else None),
        "tenant_slug": (str(row.get("tenant_slug")) if row.get("tenant_slug") else None),
        "subject": str(row.get("subject") or "General Support"),
        "status": str(row.get("status") or "OPEN"),
        "priority": str(row.get("priority") or "NORMAL"),
        "last_message_preview": (
            str(row.get("last_message_preview")) if row.get("last_message_preview") else None
        ),
        "unread_for_tenant": int(row.get("unread_for_tenant") or 0),
        "unread_for_admin": int(row.get("unread_for_admin") or 0),
        "created_at": (str(row.get("created_at")) if row.get("created_at") else None),
        "updated_at": (str(row.get("updated_at")) if row.get("updated_at") else None),
        "last_message_at": (str(row.get("last_message_at")) if row.get("last_message_at") else None),
    }


def _serialize_message(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row.get("id") or ""),
        "thread_id": str(row.get("thread_id") or ""),
        "tenant_id": str(row.get("tenant_id") or ""),
        "sender_user_id": (str(row.get("sender_user_id")) if row.get("sender_user_id") else None),
        "sender_mode": str(row.get("sender_mode") or "TENANT"),
        "sender_name": (str(row.get("sender_name")) if row.get("sender_name") else None),
        "sender_email": (str(row.get("sender_email")) if row.get("sender_email") else None),
        "reply_to_message_id": (
            str(row.get("reply_to_message_id")) if row.get("reply_to_message_id") else None
        ),
        "reply_to_body": (str(row.get("reply_to_body")) if row.get("reply_to_body") else None),
        "reply_to_sender_mode": (
            str(row.get("reply_to_sender_mode")) if row.get("reply_to_sender_mode") else None
        ),
        "reply_to_sender_name": (
            str(row.get("reply_to_sender_name")) if row.get("reply_to_sender_name") else None
        ),
        "body": str(row.get("body") or ""),
        "created_at": (str(row.get("created_at")) if row.get("created_at") else None),
    }


def list_tenant_threads(
    db: Session,
    *,
    tenant_id: UUID,
    status: Optional[str],
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    normalized_status = None
    if status:
        raw = str(status).strip().upper()
        if raw != "ALL":
            normalized_status = _normalize_status(raw)

    where = "WHERE t.tenant_id = :tenant_id"
    params: dict[str, Any] = {
        "tenant_id": str(tenant_id),
        "limit": int(limit),
        "offset": int(offset),
    }
    if normalized_status:
        where += " AND t.status = :status"
        params["status"] = normalized_status

    rows = _run_mappings(
        db,
        f"""
        SELECT t.id, t.tenant_id, t.subject, t.status, t.priority,
               t.last_message_preview, t.unread_for_tenant, t.unread_for_admin,
               CAST(t.created_at AS TEXT) AS created_at,
               CAST(t.updated_at AS TEXT) AS updated_at,
               CAST(t.last_message_at AS TEXT) AS last_message_at
        FROM core.support_threads t
        {where}
        ORDER BY t.last_message_at DESC, t.created_at DESC, t.id DESC
        LIMIT :limit OFFSET :offset
        """,
        params,
    )
    return [_serialize_thread(row) for row in rows]


def create_tenant_thread(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    subject: Optional[str],
    priority: Optional[str],
    message: str,
) -> dict[str, Any]:
    subject_value = _clean_text(subject, max_len=200) or "General Support"
    priority_value = _normalize_priority(priority)
    message_value = _clean_text(message, max_len=4000)
    if not message_value:
        raise ValueError("message is required")

    thread_id = str(uuid4())

    created = _run_first_mapping(
        db,
        """
        INSERT INTO core.support_threads (
            id, tenant_id, created_by_user_id, subject, status, priority,
            last_message_preview, unread_for_tenant, unread_for_admin,
            last_message_at, created_at, updated_at
        )
        VALUES (
            :id, :tenant_id, :created_by_user_id, :subject, :status, :priority,
            :last_message_preview, 0, 1,
            now(), now(), now()
        )
        RETURNING id, tenant_id, subject, status, priority,
                  last_message_preview, unread_for_tenant, unread_for_admin,
                  CAST(created_at AS TEXT) AS created_at,
                  CAST(updated_at AS TEXT) AS updated_at,
                  CAST(last_message_at AS TEXT) AS last_message_at
        """,
        {
            "id": thread_id,
            "tenant_id": str(tenant_id),
            "created_by_user_id": str(actor_user_id),
            "subject": subject_value,
            "status": "WAITING_ADMIN",
            "priority": priority_value,
            "last_message_preview": _message_preview(message_value),
        },
    )
    if not created:
        raise RuntimeError("Failed to create support thread")

    _run_first_mapping(
        db,
        """
        INSERT INTO core.support_messages (
            id, thread_id, tenant_id, sender_user_id, sender_mode, body, created_at
        )
        VALUES (
            :id, :thread_id, :tenant_id, :sender_user_id, :sender_mode, :body, now()
        )
        RETURNING id
        """,
        {
            "id": str(uuid4()),
            "thread_id": thread_id,
            "tenant_id": str(tenant_id),
            "sender_user_id": str(actor_user_id),
            "sender_mode": "TENANT",
            "body": message_value,
        },
    )

    return _serialize_thread(created)


def _thread_for_tenant(db: Session, *, tenant_id: UUID, thread_id: UUID) -> dict[str, Any] | None:
    return _run_first_mapping(
        db,
        """
        SELECT id, tenant_id, subject, status, priority,
               last_message_preview, unread_for_tenant, unread_for_admin,
               CAST(created_at AS TEXT) AS created_at,
               CAST(updated_at AS TEXT) AS updated_at,
               CAST(last_message_at AS TEXT) AS last_message_at
        FROM core.support_threads
        WHERE id = :thread_id
          AND tenant_id = :tenant_id
        LIMIT 1
        """,
        {"thread_id": str(thread_id), "tenant_id": str(tenant_id)},
    )


def _thread_for_admin(db: Session, *, thread_id: UUID) -> dict[str, Any] | None:
    return _run_first_mapping(
        db,
        """
        SELECT t.id, t.tenant_id, ten.name AS tenant_name, ten.slug AS tenant_slug,
               t.subject, t.status, t.priority,
               t.last_message_preview, t.unread_for_tenant, t.unread_for_admin,
               CAST(t.created_at AS TEXT) AS created_at,
               CAST(t.updated_at AS TEXT) AS updated_at,
               CAST(t.last_message_at AS TEXT) AS last_message_at
        FROM core.support_threads t
        JOIN core.tenants ten ON ten.id = t.tenant_id
        WHERE t.id = :thread_id
        LIMIT 1
        """,
        {"thread_id": str(thread_id)},
    )


def _validated_reply_target(
    db: Session,
    *,
    tenant_id: UUID,
    thread_id: UUID,
    reply_to_message_id: UUID | None,
) -> str | None:
    if reply_to_message_id is None:
        return None

    row = _run_first_mapping(
        db,
        """
        SELECT id
        FROM core.support_messages
        WHERE id = :reply_to_message_id
          AND thread_id = :thread_id
          AND tenant_id = :tenant_id
        LIMIT 1
        """,
        {
            "reply_to_message_id": str(reply_to_message_id),
            "thread_id": str(thread_id),
            "tenant_id": str(tenant_id),
        },
    )
    if not row:
        raise ValueError("Reply target message was not found in this thread")
    return str(reply_to_message_id)


def list_thread_messages(
    db: Session,
    *,
    tenant_id: UUID,
    thread_id: UUID,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    rows = _run_mappings(
        db,
        """
        SELECT m.id, m.thread_id, m.tenant_id,
               m.sender_user_id, m.sender_mode, m.body,
               u.full_name AS sender_name,
               u.email AS sender_email,
               CAST(m.reply_to_message_id AS TEXT) AS reply_to_message_id,
               rm.body AS reply_to_body,
               rm.sender_mode AS reply_to_sender_mode,
               ru.full_name AS reply_to_sender_name,
               CAST(m.created_at AS TEXT) AS created_at
        FROM core.support_messages m
        LEFT JOIN core.users u ON u.id = m.sender_user_id
        LEFT JOIN core.support_messages rm ON rm.id = m.reply_to_message_id AND rm.thread_id = m.thread_id
        LEFT JOIN core.users ru ON ru.id = rm.sender_user_id
        WHERE m.tenant_id = :tenant_id
          AND m.thread_id = :thread_id
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT :limit OFFSET :offset
        """,
        {
            "tenant_id": str(tenant_id),
            "thread_id": str(thread_id),
            "limit": int(limit),
            "offset": int(offset),
        },
    )
    return [_serialize_message(row) for row in rows]


def tenant_send_message(
    db: Session,
    *,
    tenant_id: UUID,
    thread_id: UUID,
    actor_user_id: UUID,
    message: str,
    reply_to_message_id: UUID | None,
) -> dict[str, Any]:
    message_value = _clean_text(message, max_len=4000)
    if not message_value:
        raise ValueError("message is required")

    thread = _thread_for_tenant(db, tenant_id=tenant_id, thread_id=thread_id)
    if not thread:
        raise LookupError("Support thread not found")

    reply_target_id = _validated_reply_target(
        db,
        tenant_id=tenant_id,
        thread_id=thread_id,
        reply_to_message_id=reply_to_message_id,
    )

    created = _run_first_mapping(
        db,
        """
        INSERT INTO core.support_messages (
            id, thread_id, tenant_id, sender_user_id, sender_mode, reply_to_message_id, body, created_at
        )
        VALUES (
            :id, :thread_id, :tenant_id, :sender_user_id, :sender_mode, :reply_to_message_id, :body, now()
        )
        RETURNING id, thread_id, tenant_id, sender_user_id, sender_mode,
                  CAST(reply_to_message_id AS TEXT) AS reply_to_message_id,
                  body,
                  CAST(created_at AS TEXT) AS created_at
        """,
        {
            "id": str(uuid4()),
            "thread_id": str(thread_id),
            "tenant_id": str(tenant_id),
            "sender_user_id": str(actor_user_id),
            "sender_mode": "TENANT",
            "reply_to_message_id": reply_target_id,
            "body": message_value,
        },
    )
    if not created:
        raise RuntimeError("Failed to send message")

    _run_first_mapping(
        db,
        """
        UPDATE core.support_threads
        SET status = 'WAITING_ADMIN',
            unread_for_admin = unread_for_admin + 1,
            last_message_preview = :last_message_preview,
            last_message_at = now(),
            updated_at = now()
        WHERE id = :thread_id
          AND tenant_id = :tenant_id
        RETURNING id
        """,
        {
            "thread_id": str(thread_id),
            "tenant_id": str(tenant_id),
            "last_message_preview": _message_preview(message_value),
        },
    )

    created["sender_name"] = None
    created["sender_email"] = None
    return _serialize_message(created)


def tenant_mark_thread_read(db: Session, *, tenant_id: UUID, thread_id: UUID) -> None:
    updated = _run_first_mapping(
        db,
        """
        UPDATE core.support_threads
        SET unread_for_tenant = 0,
            updated_at = now()
        WHERE id = :thread_id
          AND tenant_id = :tenant_id
        RETURNING id
        """,
        {"thread_id": str(thread_id), "tenant_id": str(tenant_id)},
    )
    if not updated:
        raise LookupError("Support thread not found")


def tenant_unread_count(db: Session, *, tenant_id: UUID) -> int:
    return _run_scalar_int(
        db,
        """
        SELECT COALESCE(SUM(unread_for_tenant), 0)
        FROM core.support_threads
        WHERE tenant_id = :tenant_id
        """,
        {"tenant_id": str(tenant_id)},
    )


def list_admin_threads(
    db: Session,
    *,
    status: Optional[str],
    tenant_id: Optional[UUID],
    q: Optional[str],
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    normalized_status = None
    if status:
        raw = str(status).strip().upper()
        if raw != "ALL":
            normalized_status = _normalize_status(raw)

    where_parts = ["1 = 1"]
    params: dict[str, Any] = {
        "limit": int(limit),
        "offset": int(offset),
    }
    if normalized_status:
        where_parts.append("t.status = :status")
        params["status"] = normalized_status
    if tenant_id:
        where_parts.append("t.tenant_id = :tenant_id")
        params["tenant_id"] = str(tenant_id)
    if q and str(q).strip():
        where_parts.append(
            "(ten.name ILIKE :q OR ten.slug ILIKE :q OR t.subject ILIKE :q OR COALESCE(t.last_message_preview, '') ILIKE :q)"
        )
        params["q"] = f"%{str(q).strip()}%"

    rows = _run_mappings(
        db,
        f"""
        SELECT t.id, t.tenant_id, ten.name AS tenant_name, ten.slug AS tenant_slug,
               t.subject, t.status, t.priority,
               t.last_message_preview, t.unread_for_tenant, t.unread_for_admin,
               CAST(t.created_at AS TEXT) AS created_at,
               CAST(t.updated_at AS TEXT) AS updated_at,
               CAST(t.last_message_at AS TEXT) AS last_message_at
        FROM core.support_threads t
        JOIN core.tenants ten ON ten.id = t.tenant_id
        WHERE {' AND '.join(where_parts)}
        ORDER BY t.unread_for_admin DESC, t.last_message_at DESC, t.id DESC
        LIMIT :limit OFFSET :offset
        """,
        params,
    )
    return [_serialize_thread(row) for row in rows]


def admin_list_thread_messages(
    db: Session,
    *,
    thread_id: UUID,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    thread = _thread_for_admin(db, thread_id=thread_id)
    if not thread:
        raise LookupError("Support thread not found")

    rows = _run_mappings(
        db,
        """
        SELECT m.id, m.thread_id, m.tenant_id,
               m.sender_user_id, m.sender_mode, m.body,
               u.full_name AS sender_name,
               u.email AS sender_email,
               CAST(m.reply_to_message_id AS TEXT) AS reply_to_message_id,
               rm.body AS reply_to_body,
               rm.sender_mode AS reply_to_sender_mode,
               ru.full_name AS reply_to_sender_name,
               CAST(m.created_at AS TEXT) AS created_at
        FROM core.support_messages m
        LEFT JOIN core.users u ON u.id = m.sender_user_id
        LEFT JOIN core.support_messages rm ON rm.id = m.reply_to_message_id AND rm.thread_id = m.thread_id
        LEFT JOIN core.users ru ON ru.id = rm.sender_user_id
        WHERE m.thread_id = :thread_id
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT :limit OFFSET :offset
        """,
        {"thread_id": str(thread_id), "limit": int(limit), "offset": int(offset)},
    )
    return [_serialize_message(row) for row in rows]


def admin_send_message(
    db: Session,
    *,
    thread_id: UUID,
    actor_user_id: UUID,
    message: str,
    reply_to_message_id: UUID | None,
) -> dict[str, Any]:
    message_value = _clean_text(message, max_len=4000)
    if not message_value:
        raise ValueError("message is required")

    thread = _thread_for_admin(db, thread_id=thread_id)
    if not thread:
        raise LookupError("Support thread not found")

    tenant_id = UUID(str(thread.get("tenant_id")))
    reply_target_id = _validated_reply_target(
        db,
        tenant_id=tenant_id,
        thread_id=thread_id,
        reply_to_message_id=reply_to_message_id,
    )

    created = _run_first_mapping(
        db,
        """
        INSERT INTO core.support_messages (
            id, thread_id, tenant_id, sender_user_id, sender_mode, reply_to_message_id, body, created_at
        )
        VALUES (
            :id, :thread_id, :tenant_id, :sender_user_id, :sender_mode, :reply_to_message_id, :body, now()
        )
        RETURNING id, thread_id, tenant_id, sender_user_id, sender_mode,
                  CAST(reply_to_message_id AS TEXT) AS reply_to_message_id,
                  body,
                  CAST(created_at AS TEXT) AS created_at
        """,
        {
            "id": str(uuid4()),
            "thread_id": str(thread_id),
            "tenant_id": str(tenant_id),
            "sender_user_id": str(actor_user_id),
            "sender_mode": "SAAS_ADMIN",
            "reply_to_message_id": reply_target_id,
            "body": message_value,
        },
    )
    if not created:
        raise RuntimeError("Failed to send message")

    _run_first_mapping(
        db,
        """
        UPDATE core.support_threads
        SET status = 'WAITING_TENANT',
            unread_for_tenant = unread_for_tenant + 1,
            last_message_preview = :last_message_preview,
            last_message_at = now(),
            updated_at = now()
        WHERE id = :thread_id
        RETURNING id
        """,
        {
            "thread_id": str(thread_id),
            "last_message_preview": _message_preview(message_value),
        },
    )

    created["sender_name"] = None
    created["sender_email"] = None
    return _serialize_message(created)


def admin_mark_thread_read(db: Session, *, thread_id: UUID) -> None:
    updated = _run_first_mapping(
        db,
        """
        UPDATE core.support_threads
        SET unread_for_admin = 0,
            updated_at = now()
        WHERE id = :thread_id
        RETURNING id
        """,
        {"thread_id": str(thread_id)},
    )
    if not updated:
        raise LookupError("Support thread not found")


def admin_set_thread_status(db: Session, *, thread_id: UUID, status: str) -> dict[str, Any]:
    normalized_status = _normalize_status(status)
    updated = _run_first_mapping(
        db,
        """
        UPDATE core.support_threads t
        SET status = :status,
            updated_at = now()
        WHERE t.id = :thread_id
        RETURNING t.id, t.tenant_id, t.subject, t.status, t.priority,
                  t.last_message_preview, t.unread_for_tenant, t.unread_for_admin,
                  CAST(t.created_at AS TEXT) AS created_at,
                  CAST(t.updated_at AS TEXT) AS updated_at,
                  CAST(t.last_message_at AS TEXT) AS last_message_at
        """,
        {"thread_id": str(thread_id), "status": normalized_status},
    )
    if not updated:
        raise LookupError("Support thread not found")
    return _serialize_thread(updated)


def admin_unread_count(db: Session) -> int:
    return _run_scalar_int(
        db,
        """
        SELECT COALESCE(SUM(unread_for_admin), 0)
        FROM core.support_threads
        """,
        {},
    )


def tenant_thread_for_notifications(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    rows = _run_mappings(
        db,
        """
        SELECT m.id, m.thread_id, m.tenant_id, m.sender_user_id, m.sender_mode,
               m.body,
               t.subject,
               CAST(m.created_at AS TEXT) AS created_at
        FROM core.support_messages m
        JOIN core.support_threads t
          ON t.id = m.thread_id
        WHERE m.tenant_id = :tenant_id
          AND m.sender_mode = 'SAAS_ADMIN'
          AND m.sender_user_id IS DISTINCT FROM :user_id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT :limit OFFSET :offset
        """,
        {
            "tenant_id": str(tenant_id),
            "user_id": str(user_id),
            "limit": int(limit),
            "offset": int(offset),
        },
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "id": f"support-msg-{row.get('id')}",
                "thread_id": str(row.get("thread_id") or ""),
                "tenant_id": str(row.get("tenant_id") or ""),
                "title": f"Admin replied: {str(row.get('subject') or 'Support')}",
                "message": str(row.get("body") or "").strip()[:180],
                "created_at": str(row.get("created_at") or ""),
            }
        )
    return out
