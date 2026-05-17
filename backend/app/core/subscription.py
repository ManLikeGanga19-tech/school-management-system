"""Subscription state resolution for module gating.

The lifecycle state (active / grace / locked) is *computed* per request from
the subscription's period_end and the plan's grace_days — no cron job, no
stored state to drift.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.modules import ALL_MODULES, effective_modules
from app.models.subscription import Subscription, SubscriptionPlan

# ── Lifecycle states ──────────────────────────────────────────────────────────
STATE_ACTIVE = "active"   # within the paid period
STATE_GRACE = "grace"     # expired but inside the grace window — usable, warned
STATE_LOCKED = "locked"   # past grace — read-only until renewal

_DEFAULT_GRACE_DAYS = 14


@dataclass(frozen=True)
class SubscriptionState:
    state: str                          # active | grace | locked
    plan_code: Optional[str]
    plan_name: Optional[str]
    modules: frozenset[str]             # effective modules (core ∪ plan-unlocked)
    status: Optional[str]               # raw subscription.status
    period_end: Optional[date]
    grace_until: Optional[date]
    grace_days: int

    @property
    def is_locked(self) -> bool:
        return self.state == STATE_LOCKED

    def has_module(self, code: str) -> bool:
        return str(code).strip().lower() in self.modules

    def to_dict(self) -> dict:
        return {
            "state": self.state,
            "plan_code": self.plan_code,
            "plan_name": self.plan_name,
            "modules": sorted(self.modules),
            "status": self.status,
            "period_end": self.period_end.isoformat() if self.period_end else None,
            "grace_until": self.grace_until.isoformat() if self.grace_until else None,
            "grace_days": self.grace_days,
        }


def resolve_subscription_state(
    db: Session,
    *,
    tenant_id: UUID,
    today: Optional[date] = None,
) -> SubscriptionState:
    """Resolve a tenant's current subscription state and effective modules."""
    today = today or date.today()

    # The effective subscription is the one running latest — a renewal adds a
    # new row with a later period_end.
    sub = db.execute(
        select(Subscription)
        .where(Subscription.tenant_id == tenant_id)
        .order_by(
            Subscription.period_end.desc().nullslast(),
            Subscription.created_at.desc(),
        )
    ).scalars().first()

    if sub is None:
        # No subscription on file — grandfather the tenant to full access.
        # Gating only takes effect once a super-admin assigns a plan, so
        # existing tenants and tenants mid-onboarding are never disrupted.
        return SubscriptionState(
            state=STATE_ACTIVE,
            plan_code=None,
            plan_name=None,
            modules=frozenset(ALL_MODULES),
            status=None,
            period_end=None,
            grace_until=None,
            grace_days=_DEFAULT_GRACE_DAYS,
        )

    plan = db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.code == sub.plan)
    ).scalar_one_or_none()

    plan_modules = list(plan.modules) if plan and isinstance(plan.modules, list) else []
    modules = frozenset(effective_modules(plan_modules))
    grace_days = (
        int(plan.grace_days)
        if plan and plan.grace_days is not None
        else _DEFAULT_GRACE_DAYS
    )

    status = str(getattr(sub, "status", "") or "").lower()
    period_end: Optional[date] = getattr(sub, "period_end", None)
    grace_until = period_end + timedelta(days=grace_days) if period_end else None

    # Explicit admin states override the date logic.
    if status in ("cancelled", "paused"):
        state = STATE_LOCKED
    elif period_end is None:
        # Open-ended subscription (no expiry set) — treated as active.
        state = STATE_ACTIVE
    elif today <= period_end:
        state = STATE_ACTIVE
    elif grace_until is not None and today <= grace_until:
        state = STATE_GRACE
    else:
        state = STATE_LOCKED

    return SubscriptionState(
        state=state,
        plan_code=(plan.code if plan else sub.plan),
        plan_name=(plan.name if plan else sub.plan),
        modules=modules,
        status=status or None,
        period_end=period_end,
        grace_until=grace_until,
        grace_days=grace_days,
    )
