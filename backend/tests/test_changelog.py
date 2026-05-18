"""Tests for the in-app changelog ("What's New")."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.api.v1.changelog.routes import unseen_entries
from app.models.changelog import ChangelogEntry


def _entry(db, title, *, published, published_at=None, category="new") -> ChangelogEntry:
    e = ChangelogEntry(
        title=title,
        body=f"Body of {title}",
        category=category,
        is_published=published,
        published_at=published_at,
    )
    db.add(e)
    db.flush()
    return e


def test_unseen_excludes_drafts(db_session):
    now = datetime.now(timezone.utc)
    _entry(db_session, "Draft", published=False, published_at=None)
    _entry(db_session, "Live", published=True, published_at=now)

    rows = unseen_entries(db_session, None)
    titles = {r.title for r in rows}
    assert "Live" in titles
    assert "Draft" not in titles


def test_unseen_respects_seen_marker(db_session):
    now = datetime.now(timezone.utc)
    _entry(db_session, "Old", published=True, published_at=now - timedelta(days=5))
    _entry(db_session, "Fresh", published=True, published_at=now + timedelta(minutes=1))

    # User last caught up "now" — only the entry published after that is unseen.
    rows = unseen_entries(db_session, now)
    titles = {r.title for r in rows}
    assert titles == {"Fresh"}


def test_unseen_newest_first(db_session):
    now = datetime.now(timezone.utc)
    _entry(db_session, "First", published=True, published_at=now - timedelta(days=2))
    _entry(db_session, "Second", published=True, published_at=now - timedelta(days=1))

    rows = unseen_entries(db_session, None)
    assert [r.title for r in rows] == ["Second", "First"]


def test_unseen_all_when_never_seen(db_session):
    now = datetime.now(timezone.utc)
    _entry(db_session, "A", published=True, published_at=now - timedelta(days=1))
    _entry(db_session, "B", published=True, published_at=now)

    # seen_at None → every published entry is unseen.
    rows = unseen_entries(db_session, None)
    assert {r.title for r in rows} == {"A", "B"}


def test_published_without_date_excluded(db_session):
    # Defensive: a published row with no published_at must not surface.
    _entry(db_session, "NoDate", published=True, published_at=None)
    rows = unseen_entries(db_session, None)
    assert rows == []
