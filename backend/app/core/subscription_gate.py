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
    """Router-level dependency enforcing subscription *module* access.

    403 if `module` is a gateable module the tenant's plan does not unlock.
    A locked subscription does NOT block here — lockout is applied
    surgically to specific high-value features via `block_if_locked`,
    so a lapsed tenant is never shut out of the system entirely.
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

    return _dependency


def block_if_locked(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
) -> None:
    """Per-route dependency for high-value features that a lapsed tenant
    loses until they renew (receipt/document printing, adding students).

    The tenant can still log in, view everything, and operate normally —
    only the routes carrying this dependency are blocked while locked.
    Fails open on a resolver error.
    """
    try:
        state = get_cached_subscription_state(db, tenant.id)
    except Exception:
        logger.exception("block_if_locked: state resolution failed; allowing request")
        return
    if state.is_locked:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                "Your subscription has expired. Renew it to use this feature — "
                "your existing data stays fully available to view."
            ),
        )
