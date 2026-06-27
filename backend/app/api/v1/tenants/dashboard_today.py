"""Shared helper for the 'Today at School' dashboard card.

Returns the current academic term (by date) + every event happening today —
combining the school-calendar events (HALF_TERM_BREAK / EXAM_WINDOW) with the
general /events module. Used by both the director KPIs endpoint and the
secretary dashboard endpoint so both dashboards render the same card from the
same data.
"""
from __future__ import annotations

from datetime import date as _date
from typing import Any, Optional
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Session


def _parse_iso_date(value: Any) -> Optional[_date]:
    if not value:
        return None
    try:
        return _date.fromisoformat(str(value)[:10])
    except Exception:
        return None


def _table_exists(db: Session, table_name: str) -> bool:
    """Quick check using to_regclass — tolerates the table not being deployed
    yet (the school-calendar/events tables are created on-demand in some
    test envs)."""
    schema, _, table = table_name.partition(".")
    if not table:
        schema, table = "public", schema
    row = db.execute(
        sa.text("SELECT to_regclass(:qualified) AS exists"),
        {"qualified": f"{schema}.{table}"},
    ).first()
    return bool(row and row[0])


def _resolve_current_term_row(
    db: Session, *, tenant_id: UUID, today: _date
) -> Optional[dict[str, Any]]:
    """Pick the term whose [start_date, end_date] contains today; fall back to
    the most recently started term, then to the most recently created. None
    if the tenant has no terms at all."""
    rows = db.execute(
        sa.text(
            """
            SELECT id, code, name,
                   CAST(start_date AS TEXT) AS start_date,
                   CAST(end_date AS TEXT)   AS end_date,
                   COALESCE(is_active, true) AS is_active,
                   created_at
            FROM core.tenant_terms
            WHERE tenant_id = :tid AND COALESCE(is_active, true) = true
            ORDER BY start_date NULLS LAST, created_at DESC
            """
        ),
        {"tid": str(tenant_id)},
    ).mappings().all()
    if not rows:
        return None

    # 1) Term that includes today.
    for r in rows:
        start = _parse_iso_date(r.get("start_date"))
        end = _parse_iso_date(r.get("end_date"))
        if start and end and start <= today <= end:
            return dict(r)

    # 2) Most recently started.
    started = [
        (s, dict(r))
        for r in rows
        if (s := _parse_iso_date(r.get("start_date"))) and s <= today
    ]
    if started:
        return max(started, key=lambda x: x[0])[1]

    # 3) Most recently created (already first in the sorted list above).
    return dict(rows[0])


def _term_progress(
    term: Optional[dict[str, Any]], today: _date
) -> dict[str, Any]:
    """Days elapsed/remaining and progress percent for the term. Returns
    zeroes when dates are missing or today is outside the term window."""
    if not term:
        return {"days_into_term": 0, "days_remaining": 0, "progress_pct": 0, "total_days": 0}
    start = _parse_iso_date(term.get("start_date"))
    end = _parse_iso_date(term.get("end_date"))
    if not (start and end) or end < start:
        return {"days_into_term": 0, "days_remaining": 0, "progress_pct": 0, "total_days": 0}
    total = (end - start).days + 1
    elapsed = max(0, min(total, (today - start).days + 1))
    remaining = max(0, total - elapsed)
    pct = int(round((elapsed / total) * 100)) if total > 0 else 0
    return {
        "days_into_term": elapsed,
        "days_remaining": remaining,
        "progress_pct": pct,
        "total_days": total,
    }


def _today_calendar_events(
    db: Session, *, tenant_id: UUID, today: _date
) -> list[dict[str, Any]]:
    """School-calendar events whose [start_date, end_date] overlaps today."""
    if not _table_exists(db, "core.tenant_school_calendar_events"):
        return []
    today_iso = today.isoformat()
    rows = db.execute(
        sa.text(
            """
            SELECT id, event_type, title, term_code, academic_year,
                   CAST(start_date AS TEXT) AS start_date,
                   CAST(end_date AS TEXT)   AS end_date,
                   notes
            FROM core.tenant_school_calendar_events
            WHERE tenant_id = :tid
              AND COALESCE(is_active, true) = true
              AND start_date <= :today
              AND end_date   >= :today
            ORDER BY start_date ASC, title ASC
            """
        ),
        {"tid": str(tenant_id), "today": today_iso},
    ).mappings().all()

    out: list[dict[str, Any]] = []
    for r in rows:
        start = _parse_iso_date(r.get("start_date"))
        end = _parse_iso_date(r.get("end_date"))
        out.append({
            "source": "CALENDAR",
            "id": str(r.get("id") or ""),
            "type": str(r.get("event_type") or ""),
            "title": str(r.get("title") or ""),
            "term_code": (str(r.get("term_code")) if r.get("term_code") else None),
            "academic_year": int(r.get("academic_year")) if r.get("academic_year") is not None else None,
            "start_date": r.get("start_date"),
            "end_date": r.get("end_date"),
            "notes": (str(r.get("notes")) if r.get("notes") else None),
            "starts_today": bool(start and start == today),
            "ends_today": bool(end and end == today),
            "day_index": (today - start).days + 1 if start else None,
            "day_total": ((end - start).days + 1) if (start and end) else None,
        })
    return out


def _today_general_events(
    db: Session, *, tenant_id: UUID, today: _date
) -> list[dict[str, Any]]:
    """General /events whose date range overlaps today. Tolerant to optional
    columns (start_time, location, target_scope) being absent in older envs."""
    table = "core.tenant_events"
    if not _table_exists(db, table):
        return []
    # Probe for optional columns once so the SELECT can adapt.
    col_row = db.execute(
        sa.text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'tenant_events'
            """
        )
    ).all()
    cols = {str(r[0]) for r in col_row}
    required = {"id", "tenant_id", "name", "start_date", "end_date"}
    if not required.issubset(cols):
        return []
    start_time_expr = "CAST(start_time AS TEXT)" if "start_time" in cols else "NULL::TEXT"
    end_time_expr = "CAST(end_time AS TEXT)" if "end_time" in cols else "NULL::TEXT"
    location_expr = "location" if "location" in cols else "NULL::TEXT"
    target_scope_expr = "target_scope" if "target_scope" in cols else "'ALL'"
    active_clause = (
        " AND COALESCE(is_active, true) = true" if "is_active" in cols else ""
    )
    today_iso = today.isoformat()
    rows = db.execute(
        sa.text(
            f"""
            SELECT id, name,
                   CAST(start_date AS TEXT) AS start_date,
                   CAST(end_date AS TEXT)   AS end_date,
                   {start_time_expr} AS start_time,
                   {end_time_expr}   AS end_time,
                   {location_expr}   AS location,
                   {target_scope_expr} AS target_scope
            FROM core.tenant_events
            WHERE tenant_id = :tid{active_clause}
              AND start_date <= :today
              AND end_date   >= :today
            ORDER BY start_time NULLS LAST, name ASC
            """
        ),
        {"tid": str(tenant_id), "today": today_iso},
    ).mappings().all()

    out: list[dict[str, Any]] = []
    for r in rows:
        start = _parse_iso_date(r.get("start_date"))
        end = _parse_iso_date(r.get("end_date"))
        out.append({
            "source": "EVENT",
            "id": str(r.get("id") or ""),
            "type": "EVENT",
            "title": str(r.get("name") or ""),
            "start_date": r.get("start_date"),
            "end_date": r.get("end_date"),
            "start_time": (str(r.get("start_time")) if r.get("start_time") else None),
            "end_time": (str(r.get("end_time")) if r.get("end_time") else None),
            "location": (str(r.get("location")) if r.get("location") else None),
            "target_scope": (str(r.get("target_scope")) if r.get("target_scope") else "ALL"),
            "starts_today": bool(start and start == today),
            "ends_today": bool(end and end == today),
            "day_index": (today - start).days + 1 if start else None,
            "day_total": ((end - start).days + 1) if (start and end) else None,
        })
    return out


def get_today_at_school(
    db: Session, *, tenant_id: UUID, today: Optional[_date] = None
) -> dict[str, Any]:
    """Combine current_term + today's events into one block. Used by both
    dashboards (director + secretary) so the 'Today at School' card renders
    identically wherever it appears."""
    today_d = today or _date.today()
    term_row = _resolve_current_term_row(
        db, tenant_id=tenant_id, today=today_d
    )
    progress = _term_progress(term_row, today_d)
    current_term: Optional[dict[str, Any]] = None
    if term_row is not None:
        current_term = {
            "id": str(term_row.get("id") or ""),
            "name": str(term_row.get("name") or ""),
            "code": str(term_row.get("code") or ""),
            "start_date": term_row.get("start_date"),
            "end_date": term_row.get("end_date"),
            **progress,
        }
    calendar_events = _today_calendar_events(
        db, tenant_id=tenant_id, today=today_d
    )
    general_events = _today_general_events(
        db, tenant_id=tenant_id, today=today_d
    )
    return {
        "today": today_d.isoformat(),
        "current_term": current_term,
        "today_events": [*calendar_events, *general_events],
    }
