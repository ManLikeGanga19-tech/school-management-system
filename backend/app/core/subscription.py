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
from app.models.tenant import Tenant
from app.models.tenant_group import TenantGroup

# ── Lifecycle states ──────────────────────────────────────────────────────────
STATE_ACTIVE = "active"   # within the paid period
STATE_GRACE = "grace"     # expired but inside the grace window — usable, warned
STATE_LOCKED = "locked"   # past grace — read-only until renewal

_DEFAULT_GRACE_DAYS = 14


@dataclass(frozen=True)
class SubscriptionState:
    state: str                          # active | grace | locked (effective)
    plan_code: Optional[str]
    plan_name: Optional[str]
    modules: frozenset[str]             # effective modules (core ∪ plan-unlocked)
    status: Optional[str]               # raw subscription.status
    period_end: Optional[date]
    grace_until: Optional[date]
    grace_days: int
    state_override: Optional[str] = None  # raw manual override; null = auto

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
            "state_override": self.state_override,
        }


def _grandfathered(
    *, period_end: Optional[date] = None, status: Optional[str] = None
) -> SubscriptionState:
    """Full access — no tier assigned. Gating only applies once a tier is set."""
    return SubscriptionState(
        state=STATE_ACTIVE,
        plan_code=None,
        plan_name=None,
        modules=frozenset(ALL_MODULES),
        status=status,
        period_end=period_end,
        grace_until=None,
        grace_days=_DEFAULT_GRACE_DAYS,
    )


def _state_from_tier(
    db: Session,
    *,
    plan_code: Optional[str],
    period_end: Optional[date],
    status: Optional[str],
    today: date,
    state_override: Optional[str] = None,
) -> SubscriptionState:
    """Resolve state from a tier code + expiry. An unknown/blank tier code
    means no gating — the subject is grandfathered to full access.

    state_override, when a valid lifecycle value, forces the state and
    wins over the date-computed result.
    """
    code = str(plan_code or "").strip()
    plan = (
        db.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.code == code)
        ).scalar_one_or_none()
        if code
        else None
    )
    if plan is None:
        return _grandfathered(period_end=period_end, status=str(status or "").lower() or None)

    plan_modules = list(plan.modules) if isinstance(plan.modules, list) else []
    modules = frozenset(effective_modules(plan_modules))
    grace_days = int(plan.grace_days) if plan.grace_days is not None else _DEFAULT_GRACE_DAYS
    grace_until = period_end + timedelta(days=grace_days) if period_end else None

    st = str(status or "").lower()
    if st in ("cancelled", "paused"):
        state = STATE_LOCKED
    elif period_end is None:
        state = STATE_ACTIVE  # open-ended — no expiry set
    elif today <= period_end:
        state = STATE_ACTIVE
    elif grace_until is not None and today <= grace_until:
        state = STATE_GRACE
    else:
        state = STATE_LOCKED

    # A manual override wins over the date-computed state.
    override = str(state_override or "").strip().lower()
    if override not in (STATE_ACTIVE, STATE_GRACE, STATE_LOCKED):
        override = ""
    if override:
        state = override

    return SubscriptionState(
        state=state,
        plan_code=plan.code,
        plan_name=plan.name,
        modules=modules,
        status=st or None,
        period_end=period_end,
        grace_until=grace_until,
        grace_days=grace_days,
        state_override=override or None,
    )


def resolve_subscription_state(
    db: Session,
    *,
    tenant_id: UUID,
    today: Optional[date] = None,
) -> SubscriptionState:
    """Resolve a tenant's current subscription state and effective modules.

    A campus (tenant in a group) inherits the group's shared tier; a
    standalone tenant uses its own subscription.
    """
    today = today or date.today()

    tenant = db.get(Tenant, tenant_id)
    group_id = getattr(tenant, "group_id", None) if tenant is not None else None

    # ── Campus of a group — inherits the group's shared tier ──────────────────
    if group_id is not None:
        group = db.get(TenantGroup, group_id)
        if group is not None and str(getattr(group, "plan_code", "") or "").strip():
            return _state_from_tier(
                db,
                plan_code=group.plan_code,
                period_end=group.period_end,
                status=None,
                today=today,
                state_override=getattr(group, "state_override", None),
            )
        return _grandfathered()  # group has no tier yet

    # ── Standalone tenant — its own latest subscription ──────────────────────
    sub = db.execute(
        select(Subscription)
        .where(Subscription.tenant_id == tenant_id)
        .order_by(
            Subscription.period_end.desc().nullslast(),
            Subscription.created_at.desc(),
        )
    ).scalars().first()
    if sub is None:
        return _grandfathered()

    return _state_from_tier(
        db,
        plan_code=getattr(sub, "plan_code", None),
        period_end=getattr(sub, "period_end", None),
        status=getattr(sub, "status", None),
        today=today,
        state_override=getattr(sub, "state_override", None),
    )
