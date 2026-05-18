"""Tests for subscription module gating, grace/lockout, and multi-campus.

Covers all phases:
  - module catalog + effective modules
  - subscription state resolver (active / grace / locked, grandfathering)
  - group inheritance (a campus inherits its group's tier)
  - campus listing + seamless switch (switch_campus)
"""
from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest

from app.core.modules import CORE_MODULES, ALL_MODULES, effective_modules
from app.core.subscription import resolve_subscription_state
from app.api.v1.auth.service import list_user_campuses, switch_campus
from app.models.tenant import Tenant
from app.models.tenant_group import TenantGroup
from app.models.subscription import Subscription, SubscriptionPlan
from app.models.user import User
from app.models.membership import UserTenant


# ── helpers ───────────────────────────────────────────────────────────────────

def _tenant(db, slug: str, **kw) -> Tenant:
    t = Tenant(slug=slug, name=kw.pop("name", slug.title()), **kw)
    db.add(t)
    db.flush()
    return t


def _plan(db, code: str, modules: list[str], grace_days: int = 14) -> SubscriptionPlan:
    p = SubscriptionPlan(
        code=code, name=code.title(), modules=modules,
        price_kes=1000, billing_cycle="per_term", grace_days=grace_days,
    )
    db.add(p)
    db.flush()
    return p


def _subscription(db, tenant_id, *, plan_code=None, period_end=None, status="active") -> Subscription:
    s = Subscription(
        tenant_id=tenant_id, plan="per_term", billing_cycle="per_term",
        status=status, amount_kes=1000, plan_code=plan_code, period_end=period_end,
    )
    db.add(s)
    db.flush()
    return s


def _user(db, email: str) -> User:
    u = User(email=email, password_hash="x", full_name="Test User", is_active=True)
    db.add(u)
    db.flush()
    return u


# ── module catalog ────────────────────────────────────────────────────────────

def test_effective_modules_core_only_when_no_plan_modules():
    mods = effective_modules([])
    assert mods == set(CORE_MODULES)
    assert "exams" not in mods


def test_effective_modules_adds_gateable():
    mods = effective_modules(["hr", "exams"])
    assert "hr" in mods and "exams" in mods
    assert CORE_MODULES.issubset(mods)


def test_effective_modules_ignores_unknown_codes():
    mods = effective_modules(["hr", "not_a_module"])
    assert "hr" in mods
    assert "not_a_module" not in mods


# ── resolver: standalone tenant ───────────────────────────────────────────────

def test_no_subscription_is_grandfathered(db_session):
    t = _tenant(db_session, "ndep-no-sub")
    st = resolve_subscription_state(db_session, tenant_id=t.id)
    assert st.state == "active"
    assert st.plan_code is None
    assert st.modules == frozenset(ALL_MODULES)


def test_subscription_without_tier_is_grandfathered(db_session):
    t = _tenant(db_session, "ndep-untiered")
    _subscription(db_session, t.id, plan_code=None)
    st = resolve_subscription_state(db_session, tenant_id=t.id)
    assert st.state == "active"
    assert st.modules == frozenset(ALL_MODULES)


def test_tiered_subscription_gates_modules(db_session):
    t = _tenant(db_session, "ndep-tiered")
    _plan(db_session, "starter", ["cbc", "exams"])
    _subscription(db_session, t.id, plan_code="starter",
                  period_end=date.today() + timedelta(days=30))
    st = resolve_subscription_state(db_session, tenant_id=t.id)
    assert st.state == "active"
    assert st.plan_code == "starter"
    assert "cbc" in st.modules and "exams" in st.modules
    assert "hr" not in st.modules           # not in the starter plan
    assert "finance" in st.modules          # core is always on


def test_grace_window(db_session):
    t = _tenant(db_session, "ndep-grace")
    _plan(db_session, "growth", ["hr"], grace_days=14)
    _subscription(db_session, t.id, plan_code="growth",
                  period_end=date.today() - timedelta(days=3))
    st = resolve_subscription_state(db_session, tenant_id=t.id)
    assert st.state == "grace"


def test_locked_after_grace(db_session):
    t = _tenant(db_session, "ndep-locked")
    _plan(db_session, "growth2", ["hr"], grace_days=14)
    _subscription(db_session, t.id, plan_code="growth2",
                  period_end=date.today() - timedelta(days=30))
    st = resolve_subscription_state(db_session, tenant_id=t.id)
    assert st.state == "locked"
    assert st.is_locked is True


def test_cancelled_status_is_locked(db_session):
    t = _tenant(db_session, "ndep-cancelled")
    _plan(db_session, "growth3", ["hr"])
    _subscription(db_session, t.id, plan_code="growth3",
                  period_end=date.today() + timedelta(days=30), status="cancelled")
    st = resolve_subscription_state(db_session, tenant_id=t.id)
    assert st.state == "locked"


# ── resolver: group inheritance ───────────────────────────────────────────────

def test_campus_inherits_group_tier(db_session):
    grp = TenantGroup(name="Riverside", slug="riverside-grp", plan_code="growthx",
                      period_end=date.today() + timedelta(days=30))
    db_session.add(grp)
    db_session.flush()
    _plan(db_session, "growthx", ["hr", "exams"])
    campus = _tenant(db_session, "riverside-a", group_id=grp.id)
    st = resolve_subscription_state(db_session, tenant_id=campus.id)
    assert st.plan_code == "growthx"
    assert "hr" in st.modules


def test_group_without_tier_is_grandfathered(db_session):
    grp = TenantGroup(name="NoTier", slug="notier-grp")
    db_session.add(grp)
    db_session.flush()
    campus = _tenant(db_session, "notier-a", group_id=grp.id)
    st = resolve_subscription_state(db_session, tenant_id=campus.id)
    assert st.state == "active"
    assert st.modules == frozenset(ALL_MODULES)


# ── multi-campus: listing + switching ─────────────────────────────────────────

def test_list_user_campuses_returns_siblings(db_session):
    grp = TenantGroup(name="Group", slug="grp-list")
    db_session.add(grp)
    db_session.flush()
    a = _tenant(db_session, "list-a", group_id=grp.id)
    b = _tenant(db_session, "list-b", group_id=grp.id)
    u = _user(db_session, "campususer@test.com")
    db_session.add(UserTenant(tenant_id=a.id, user_id=u.id, is_active=True))
    db_session.add(UserTenant(tenant_id=b.id, user_id=u.id, is_active=True))
    db_session.flush()

    campuses = list_user_campuses(db_session, user_id=u.id, tenant_id=a.id)
    slugs = {c["slug"] for c in campuses}
    assert slugs == {"list-a", "list-b"}
    assert any(c["is_current"] for c in campuses if c["slug"] == "list-a")


def test_list_user_campuses_empty_when_standalone(db_session):
    t = _tenant(db_session, "solo")
    u = _user(db_session, "solo@test.com")
    db_session.add(UserTenant(tenant_id=t.id, user_id=u.id, is_active=True))
    db_session.flush()
    assert list_user_campuses(db_session, user_id=u.id, tenant_id=t.id) == []


def test_switch_campus_happy_path(db_session):
    grp = TenantGroup(name="SwGroup", slug="sw-grp")
    db_session.add(grp)
    db_session.flush()
    a = _tenant(db_session, "sw-a", group_id=grp.id)
    b = _tenant(db_session, "sw-b", group_id=grp.id)
    u = _user(db_session, "switcher@test.com")
    db_session.add(UserTenant(tenant_id=a.id, user_id=u.id, is_active=True))
    db_session.add(UserTenant(tenant_id=b.id, user_id=u.id, is_active=True))
    db_session.flush()

    access, refresh = switch_campus(
        db_session, user_id=u.id, current_tenant_id=a.id, target_tenant_id=b.id
    )
    assert access and refresh


def test_switch_campus_rejects_non_member(db_session):
    grp = TenantGroup(name="SwGroup2", slug="sw-grp2")
    db_session.add(grp)
    db_session.flush()
    a = _tenant(db_session, "sw2-a", group_id=grp.id)
    b = _tenant(db_session, "sw2-b", group_id=grp.id)
    u = _user(db_session, "nonmember@test.com")
    db_session.add(UserTenant(tenant_id=a.id, user_id=u.id, is_active=True))
    db_session.flush()  # NOT a member of b

    with pytest.raises(ValueError):
        switch_campus(db_session, user_id=u.id, current_tenant_id=a.id, target_tenant_id=b.id)


def test_switch_campus_rejects_cross_group(db_session):
    g1 = TenantGroup(name="G1", slug="g1")
    g2 = TenantGroup(name="G2", slug="g2")
    db_session.add_all([g1, g2])
    db_session.flush()
    a = _tenant(db_session, "x-a", group_id=g1.id)
    b = _tenant(db_session, "x-b", group_id=g2.id)
    u = _user(db_session, "crossgroup@test.com")
    db_session.add(UserTenant(tenant_id=a.id, user_id=u.id, is_active=True))
    db_session.add(UserTenant(tenant_id=b.id, user_id=u.id, is_active=True))
    db_session.flush()

    with pytest.raises(ValueError):
        switch_campus(db_session, user_id=u.id, current_tenant_id=a.id, target_tenant_id=b.id)
