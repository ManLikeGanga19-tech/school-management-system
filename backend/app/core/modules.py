"""Canonical module catalog for subscription gating.

A tenant's effective modules = the always-on CORE set ∪ whichever GATEABLE
modules its subscription plan unlocks. Module codes mirror the tenant nav
sections so backend gating and the frontend nav stay in lockstep.
"""
from __future__ import annotations

# ── Core modules ──────────────────────────────────────────────────────────────
# Always available to every tenant regardless of plan or subscription state.
# Core operations, billing, parent comms and administration must never be
# gated — a tenant can never lock itself out of running the school or
# reaching the renewal flow.
CORE_MODULES: frozenset[str] = frozenset({
    "dashboard",
    "students",
    "enrollments",
    "finance",
    "school_setup",
    "parents",
    "notifications",
    "users",
    "rbac",
    "audit",
})

# ── Gateable modules ──────────────────────────────────────────────────────────
# Unlocked per subscription plan. Each maps to a tenant nav section.
GATEABLE_MODULES: frozenset[str] = frozenset({
    "exams",
    "cbc",
    "igcse",
    "discipline",
    "events",
    "messaging",
    "hr",
    "analytics",
})

ALL_MODULES: frozenset[str] = CORE_MODULES | GATEABLE_MODULES

# Human-readable labels for admin UIs / error messages.
MODULE_LABELS: dict[str, str] = {
    "dashboard": "Dashboard",
    "students": "Students",
    "enrollments": "Enrollments",
    "finance": "Finance",
    "school_setup": "School Setup",
    "parents": "Parents",
    "notifications": "Notifications",
    "users": "Users",
    "rbac": "Roles & Permissions",
    "audit": "Audit Logs",
    "exams": "Exams",
    "cbc": "CBC Assessments",
    "igcse": "IGCSE",
    "discipline": "Discipline",
    "events": "Events",
    "messaging": "Messaging (SMS)",
    "hr": "HR & Payroll",
    "analytics": "Analytics",
}


def normalize_module_codes(codes: list[str] | None) -> list[str]:
    """Clean a raw module-code list down to known gateable codes."""
    seen: list[str] = []
    for raw in codes or []:
        code = str(raw).strip().lower()
        if code in GATEABLE_MODULES and code not in seen:
            seen.append(code)
    return seen


def effective_modules(plan_modules: list[str] | None) -> set[str]:
    """Modules a tenant can use = core ∪ the plan's unlocked gateable modules."""
    return set(CORE_MODULES) | set(normalize_module_codes(plan_modules))
