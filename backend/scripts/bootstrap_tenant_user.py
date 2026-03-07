#!/usr/bin/env python3
"""
Bootstrap a tenant login account safely.

Use cases:
  - Fresh staging database after migrations.
  - Local recovery after accidental schema reset.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import and_, select

# Ensure `app.*` imports work when executed as `python scripts/...`.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import SessionLocal
from app.models.membership import UserTenant
from app.models.rbac import Role, UserRole
from app.models.tenant import Tenant
from app.models.user import User
from app.utils.hashing import hash_password


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bootstrap tenant + login user")
    parser.add_argument("--tenant-slug", required=True, help="Tenant slug, e.g. novel-school")
    parser.add_argument("--tenant-name", required=True, help="Tenant display name")
    parser.add_argument("--email", required=True, help="Login email")
    parser.add_argument("--password", required=True, help="Login password")
    parser.add_argument("--role", default="DIRECTOR", help="Global role code to assign (default: DIRECTOR)")
    parser.add_argument("--primary-domain", default=None, help="Optional primary domain for host-based resolution")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Reset user password if the user already exists",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    tenant_slug = args.tenant_slug.strip().lower()
    tenant_name = args.tenant_name.strip()
    email = args.email.strip().lower()
    role_code = args.role.strip().upper()
    primary_domain = args.primary_domain.strip().lower() if isinstance(args.primary_domain, str) and args.primary_domain.strip() else None

    db = SessionLocal()
    try:
        tenant = db.execute(select(Tenant).where(Tenant.slug == tenant_slug)).scalar_one_or_none()
        if tenant is None:
            tenant = Tenant(
                id=uuid4(),
                slug=tenant_slug,
                name=tenant_name,
                primary_domain=primary_domain,
                is_active=True,
            )
            db.add(tenant)
            db.flush()
            print(f"[created] tenant slug={tenant.slug} id={tenant.id}")
        else:
            updates = []
            if tenant.name != tenant_name:
                tenant.name = tenant_name
                updates.append("name")
            if primary_domain and tenant.primary_domain != primary_domain:
                tenant.primary_domain = primary_domain
                updates.append("primary_domain")
            if not tenant.is_active:
                tenant.is_active = True
                updates.append("is_active")
            if updates:
                print(f"[updated] tenant slug={tenant.slug} fields={','.join(updates)}")
            else:
                print(f"[exists] tenant slug={tenant.slug} id={tenant.id}")

        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            user = User(
                id=uuid4(),
                email=email,
                password_hash=hash_password(args.password),
                is_active=True,
            )
            db.add(user)
            db.flush()
            print(f"[created] user email={user.email} id={user.id}")
        else:
            changed = []
            if args.reset_password:
                user.password_hash = hash_password(args.password)
                changed.append("password")
            if not user.is_active:
                user.is_active = True
                changed.append("is_active")
            if changed:
                print(f"[updated] user email={user.email} fields={','.join(changed)}")
            else:
                print(f"[exists] user email={user.email} id={user.id}")

        membership = db.execute(
            select(UserTenant).where(
                and_(UserTenant.tenant_id == tenant.id, UserTenant.user_id == user.id)
            )
        ).scalar_one_or_none()
        if membership is None:
            membership = UserTenant(id=uuid4(), tenant_id=tenant.id, user_id=user.id, is_active=True)
            db.add(membership)
            print(f"[created] membership tenant={tenant.slug} user={user.email}")
        elif not membership.is_active:
            membership.is_active = True
            print(f"[updated] membership re-activated tenant={tenant.slug} user={user.email}")
        else:
            print(f"[exists] membership tenant={tenant.slug} user={user.email}")

        role = db.execute(
            select(Role).where(Role.code == role_code, Role.tenant_id.is_(None))
        ).scalar_one_or_none()
        if role is None:
            raise RuntimeError(
                f"Global role '{role_code}' not found. Run migrations/seed data first."
            )

        user_role = db.execute(
            select(UserRole).where(
                and_(
                    UserRole.tenant_id == tenant.id,
                    UserRole.user_id == user.id,
                    UserRole.role_id == role.id,
                )
            )
        ).scalar_one_or_none()
        if user_role is None:
            user_role = UserRole(
                id=uuid4(),
                tenant_id=tenant.id,
                user_id=user.id,
                role_id=role.id,
            )
            db.add(user_role)
            print(f"[created] user-role role={role_code} tenant={tenant.slug} user={user.email}")
        else:
            print(f"[exists] user-role role={role_code} tenant={tenant.slug} user={user.email}")

        db.commit()
        print("[ok] bootstrap completed")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
