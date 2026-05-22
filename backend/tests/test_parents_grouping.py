"""Verify the Parents module groups one guardian's many children together.

Two existing-registry students enrolled with the SAME guardian phone must
resolve to ONE parent record showing BOTH children — not duplicate parents,
and not a parent with zero children.
"""
from __future__ import annotations

from uuid import UUID, uuid4

from app.api.v1.enrollments import service as enroll_service
from app.api.v1.parents import service as parents_service
from tests.helpers import create_tenant, make_actor


def _existing_payload(name: str, klass: str, phone: str, guardian: str = "Musa Bakari") -> dict:
    return {
        "enrollment_source": "EXISTING_STUDENT",
        "student_name": name,
        "admission_class": klass,
        "admission_term": "Term 1",
        "guardian_name": guardian,
        "guardian_phone": phone,
        "guardian_email": "musa@example.com",
    }


def test_one_parent_groups_many_children(db_session):
    tenant = create_tenant(db_session, slug=f"pgrp-{uuid4().hex[:6]}")
    actor, _ = make_actor(db_session, tenant=tenant, permissions=["enrollment.manage"])
    phone = "0719646948"

    enroll_service.create_enrollment(
        db_session, tenant_id=tenant.id, actor_user_id=actor.id,
        payload=_existing_payload("Amani Bakari", "G7", phone),
    )
    enroll_service.create_enrollment(
        db_session, tenant_id=tenant.id, actor_user_id=actor.id,
        payload=_existing_payload("Zawadi Bakari", "G4", phone),
    )
    db_session.commit()

    parents = parents_service.list_parents(db_session, tenant_id=tenant.id)
    matching = [p for p in parents if p["phone"] == phone]

    # Exactly one parent record for that phone (no duplicates).
    assert len(matching) == 1, f"expected 1 parent, got {parents}"
    # Grouped: that parent shows BOTH children.
    assert matching[0]["child_count"] == 2, matching[0]

    detail = parents_service.get_parent_detail(
        db_session, tenant_id=tenant.id, parent_id=UUID(matching[0]["id"])
    )
    assert len(detail["children"]) == 2, detail["children"]
    classes = {c["class_code"] for c in detail["children"]}
    assert classes == {"G7", "G4"}, classes


def test_second_child_reuses_parent_no_duplicate(db_session):
    """A repeated guardian phone must never create a second parent row."""
    tenant = create_tenant(db_session, slug=f"pdup-{uuid4().hex[:6]}")
    actor, _ = make_actor(db_session, tenant=tenant, permissions=["enrollment.manage"])
    phone = "0700111222"

    enroll_service.create_enrollment(
        db_session, tenant_id=tenant.id, actor_user_id=actor.id,
        payload=_existing_payload("Child One", "G1", phone),
    )
    enroll_service.create_enrollment(
        db_session, tenant_id=tenant.id, actor_user_id=actor.id,
        payload=_existing_payload("Child Two", "G2", phone),
    )
    db_session.commit()

    parents = parents_service.list_parents(db_session, tenant_id=tenant.id)
    assert len([p for p in parents if p["phone"] == phone]) == 1, parents
