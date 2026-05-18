"""Subscription enforcement — FastAPI dependency for module gating + lockout.

Applied at router-include level so it covers every route in a module without
being forgotten per-route. Fails OPEN: a resolver error never hard-breaks the
app — subscription billing must not take the school offline.
"""
from __future__ import annotations

import logging
import time
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_tenant
from app.core.modules import GATEABLE_MODULES, MODULE_LABELS
from app.core.subscription import SubscriptionState, resolve_subscription_state

logger = logging.getLogger(__name__)

_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Short in-process TTL cache — subscription state only changes daily (dates)
# or on an admin action, so a 60 s window avoids resolving on every request.
_CACHE_TTL_SEC = 60.0
_state_cache: dict[str, tuple[SubscriptionState, float]] = {}


def get_cached_subscription_state(db: Session, tenant_id: UUID) -> SubscriptionState:
    key = str(tenant_id)
    now = time.monotonic()
    hit = _state_cache.get(key)
    if hit is not None and hit[1] > now:
        return hit[0]
    state = resolve_subscription_state(db, tenant_id=tenant_id)
    _state_cache[key] = (state, now + _CACHE_TTL_SEC)
    return state


def invalidate_subscription_cache(tenant_id: UUID | str | None = None) -> None:
    """Drop cached state — call after an admin changes a subscription/plan."""
    if tenant_id is None:
        _state_cache.clear()
    else:
        _state_cache.pop(str(tenant_id), None)


def gate(module: Optional[str] = None):
    """Router-level dependency enforcing subscription rules.

    - 403 if `module` is a gateable module the tenant's plan does not unlock.
    - 402 on writes once the subscription is LOCKED (past grace) — the
      system goes read-only. Grace-period writes are still allowed.
    """

    def _dependency(
        request: Request,
        db: Session = Depends(get_db),
        tenant=Depends(get_tenant),
    ) -> None:
        try:
            state = get_cached_subscription_state(db, tenant.id)
        except Exception:
            logger.exception(
                "subscription gate: state resolution failed; allowing request"
            )
            return
        request.state.subscription = state

        if module and module in GATEABLE_MODULES and not state.has_module(module):
            label = MODULE_LABELS.get(module, module)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"The {label} module is not included in your current "
                    f"subscription plan."
                ),
            )

        if state.is_locked and request.method.upper() in _WRITE_METHODS:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    "Your subscription has expired — the system is read-only. "
                    "Renew the subscription to make changes; your data stays "
                    "fully available to view."
                ),
            )

    return _dependency


def block_when_inactive(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
) -> None:
    """Per-route dependency for high-value features cut off from the grace
    period onward — receipt/document printing. Blocked in BOTH grace and
    locked states; only an active subscription may use these routes.
    Fails open on a resolver error.
    """
    try:
        state = get_cached_subscription_state(db, tenant.id)
    except Exception:
        logger.exception("block_when_inactive: state resolution failed; allowing request")
        return
    if state.state != "active":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                "Receipt printing is paused — renew your subscription to print "
                "documents. Your existing records stay available to view."
            ),
        )
