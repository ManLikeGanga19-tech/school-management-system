"""Tenant-facing changelog endpoints — the in-app "What's New" banner."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.changelog import ChangelogEntry
from app.models.user import User

router = APIRouter()


@router.get("/unseen")
def list_unseen_changelog(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Published changelog entries this user has not yet acknowledged —
    everything published after their changelog_seen_at, newest first."""
    seen_at = getattr(user, "changelog_seen_at", None)

    q = select(ChangelogEntry).where(
        ChangelogEntry.is_published.is_(True),
        ChangelogEntry.published_at.isnot(None),
    )
    if seen_at is not None:
        q = q.where(ChangelogEntry.published_at > seen_at)

    rows = db.execute(
        q.order_by(ChangelogEntry.published_at.desc())
    ).scalars().all()

    return [
        {
            "id": str(r.id),
            "title": r.title,
            "body": r.body,
            "category": r.category,
            "published_at": r.published_at.isoformat() if r.published_at else None,
        }
        for r in rows
    ]


@router.post("/seen")
def mark_changelog_seen(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Acknowledge all current updates — marks everything up to now as seen."""
    row = db.get(User, user.id)
    if row is not None:
        row.changelog_seen_at = datetime.now(timezone.utc)
        db.commit()
    return {"ok": True}
