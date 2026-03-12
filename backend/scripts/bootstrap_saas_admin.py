#!/usr/bin/env python3
"""
Bootstrap a SaaS super-admin account (global role assignment).
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
from app.models.rbac import Permission, Role, RolePermission, UserRole
from app.models.user import User
from app.utils.hashing import hash_password


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bootstrap SaaS SUPER_ADMIN user")
    parser.add_argument("--email", required=True, help="Super admin email")
    parser.add_argument("--password", required=True, help="Super admin password")
    parser.add_argument("--full-name", default="SaaS Admin", help="Display full name")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Reset password if user already exists",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    email = args.email.strip().lower()

    db = SessionLocal()
    try:
        role = db.execute(
            select(Role).where(Role.code == "SUPER_ADMIN", Role.tenant_id.is_(None))
        ).scalar_one_or_none()
        if role is None:
            raise RuntimeError(
                "Global SUPER_ADMIN role not found. Ensure migrations/seeders are applied."
            )

        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            user = User(
                id=uuid4(),
                email=email,
                password_hash=hash_password(args.password),
                full_name=args.full_name.strip() or "SaaS Admin",
                is_active=True,
            )
            db.add(user)
            db.flush()
            print(f"[created] saas user email={user.email} id={user.id}")
        else:
            changed = []
            if args.reset_password:
                user.password_hash = hash_password(args.password)
                changed.append("password")
            if not user.is_active:
                user.is_active = True
                changed.append("is_active")
            if args.full_name and user.full_name != args.full_name:
                user.full_name = args.full_name
                changed.append("full_name")
            if changed:
                print(f"[updated] saas user email={user.email} fields={','.join(changed)}")
            else:
                print(f"[exists] saas user email={user.email} id={user.id}")

        user_role = db.execute(
            select(UserRole).where(
                and_(
                    UserRole.tenant_id.is_(None),
                    UserRole.user_id == user.id,
                    UserRole.role_id == role.id,
                )
            )
        ).scalar_one_or_none()
        if user_role is None:
            db.add(
                UserRole(
                    id=uuid4(),
                    tenant_id=None,
                    user_id=user.id,
                    role_id=role.id,
                )
            )
            print(f"[created] global role assignment SUPER_ADMIN for {user.email}")
        else:
            print(f"[exists] global role assignment SUPER_ADMIN for {user.email}")

        permission_ids = db.execute(select(Permission.id)).scalars().all()
        existing_permission_ids = set(
            db.execute(
                select(RolePermission.permission_id).where(RolePermission.role_id == role.id)
            ).scalars().all()
        )
        missing_permission_ids = [permission_id for permission_id in permission_ids if permission_id not in existing_permission_ids]
        for permission_id in missing_permission_ids:
            db.add(RolePermission(role_id=role.id, permission_id=permission_id))
        if missing_permission_ids:
            print(
                f"[updated] synced {len(missing_permission_ids)} permissions to global SUPER_ADMIN role"
            )
        else:
            print("[exists] global SUPER_ADMIN role already has all permissions")

        db.commit()
        print("[ok] saas admin bootstrap completed")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
