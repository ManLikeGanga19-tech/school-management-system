from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from uuid import UUID
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


SENSITIVE_KEYS = {"password", "password_hash", "refresh_token", "access_token", "token"}


def _sanitize(obj: Any) -> Any:
    if isinstance(obj, dict):
        clean = {}
        for k, v in obj.items():
            if k.lower() in SENSITIVE_KEYS:
                clean[k] = "***"
            else:
                clean[k] = _sanitize(v)
        return clean
    if isinstance(obj, list):
        return [_sanitize(x) for x in obj]
    return obj


def prune_audit_logs(db: Session, *, retention_days: int) -> int:
    """
    Delete audit_log rows older than retention_days.

    Called once at application startup so the table stays bounded without a
    separate cron job.  The delete uses the indexed created_at column so it
    runs in milliseconds even on a moderately large table.

    Returns the number of rows deleted (0 if retention_days <= 0).
    """
    if retention_days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    result = db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
    db.commit()
    return result.rowcount


def log_event(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    action: str,
    resource: str,
    resource_id: Optional[UUID] = None,
    payload: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    audit = AuditLog(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action=action,
        resource=resource,
        resource_id=resource_id,
        payload=_sanitize(payload or {}),
        meta=_sanitize(meta or {}),
    )
    db.add(audit)
    # do NOT commit here; caller controls transactions
