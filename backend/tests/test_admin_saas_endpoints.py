"""
Tests for SaaS admin endpoints
"""

import os
import re
import pytest
from uuid import uuid4
from datetime import date
from decimal import Decimal
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import Session, sessionmaker
from app.api.v1.admin import routes as admin_routes

from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.core.database import get_db, Base
from app.models.tenant import Tenant
from app.models.user import User
from app.models.membership import UserTenant
from app.models.subscription import Subscription
from app.models.rbac import Permission, Role, RolePermission, UserPermissionOverride, UserRole
from app.utils.tokens import create_access_token
from app.utils.hashing import verify_password
from app.core.dependencies import SAAS_TENANT_MARKER


# ========================================================================
# Test database wiring (isolated from developer/staging databases)
# ========================================================================

def _resolve_test_database_url() -> str:
    explicit_url = os.getenv("TEST_DATABASE_URL")
    if explicit_url:
        return explicit_url
    if os.getenv("CI", "").lower() == "true":
        return settings.DATABASE_URL
    # Local fallback: derive a dedicated test DB URL from app DATABASE_URL.
    base_url = make_url(settings.DATABASE_URL)
    base_db_name = (base_url.database or "").strip()
    if not base_db_name:
        raise RuntimeError(
            "DATABASE_URL has no database name. Set TEST_DATABASE_URL explicitly."
        )

    if "test" in base_db_name.lower():
        return settings.DATABASE_URL

    if base_db_name.endswith("_db"):
        test_db_name = f"{base_db_name[:-3]}_test_db"
    else:
        test_db_name = f"{base_db_name}_test"

    return base_url.set(database=test_db_name).render_as_string(hide_password=False)


def _assert_safe_test_database_url(url: str) -> None:
    if os.getenv("CI", "").lower() == "true":
        return
    database_name = (make_url(url).database or "").lower()
    if "test" not in database_name:
        raise RuntimeError(
            f"Unsafe TEST_DATABASE_URL database '{database_name}'. Use a dedicated test database name containing 'test'."
        )


def _ensure_test_database_exists(url: str) -> None:
    """
    Best-effort local bootstrap for PostgreSQL test database.
    CI environments already provide an isolated DB and skip this path.
    """
    if os.getenv("CI", "").lower() == "true":
        return

    parsed = make_url(url)
    db_name = (parsed.database or "").strip()
    if not db_name:
        raise RuntimeError("TEST_DATABASE_URL must include a database name.")
    if not re.fullmatch(r"[A-Za-z0-9_]+", db_name):
        raise RuntimeError(
            f"Unsafe test database name '{db_name}'. Use only letters, numbers, underscore."
        )

    backend = parsed.get_backend_name()
    if backend not in {"postgresql", "postgresql+psycopg", "postgresql+psycopg2"}:
        return

    admin_db = os.getenv("TEST_DATABASE_ADMIN_DB", "postgres")
    admin_url = parsed.set(database=admin_db)
    admin_engine = create_engine(
        admin_url.render_as_string(hide_password=False),
        pool_pre_ping=True,
        isolation_level="AUTOCOMMIT",
    )
    try:
        with admin_engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": db_name},
            ).scalar()
            if not exists:
                conn.exec_driver_sql(f'CREATE DATABASE "{db_name}"')
    finally:
        admin_engine.dispose()


TEST_DATABASE_URL = _resolve_test_database_url()
_assert_safe_test_database_url(TEST_DATABASE_URL)
TEST_ENGINE = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
TestSessionLocal = sessionmaker(bind=TEST_ENGINE, autocommit=False, autoflush=False)


# ========================================================================
# Fixtures
# ========================================================================

def _reset_core_schema() -> None:
    with TEST_ENGINE.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA IF EXISTS core CASCADE")
        conn.exec_driver_sql("CREATE SCHEMA core")


def _invalidate_admin_caches() -> None:
    for cache_name in ("_metrics_cache", "_recent_cache", "_daraja_connectivity_cache"):
        cache_obj = getattr(admin_routes, cache_name, None)
        if cache_obj is not None and hasattr(cache_obj, "invalidate"):
            cache_obj.invalidate()


@pytest.fixture(scope="function")
def setup_db():
    """Create fresh core schema for each test."""
    _ensure_test_database_exists(TEST_DATABASE_URL)
    _reset_core_schema()
    Base.metadata.create_all(bind=TEST_ENGINE)
    _invalidate_admin_caches()
    yield
    _invalidate_admin_caches()
    _reset_core_schema()


@pytest.fixture
def db_session(setup_db):
    """Get isolated DB session for each test."""
    session = TestSessionLocal()

    yield session

    session.rollback()
    session.close()


@pytest.fixture
def override_get_db(db_session):
    """Override FastAPI dependency"""
    def _override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client(override_get_db):
    """Test client"""
    return TestClient(app)


def create_super_admin_user(db: Session) -> User:
    """Create a super admin user"""
    user = User(
        id=uuid4(),
        email="admin@example.com",
        password_hash="fake_hash",
        is_active=True,
    )
    db.add(user)
    db.flush()
    
    # Create superadmin role
    role = Role(
        id=uuid4(),
        code="SUPER_ADMIN",
        name="Super Admin",
        tenant_id=None,
        is_system=True,
    )
    db.add(role)
    db.flush()
    
    # Assign role
    user_role = UserRole(
        id=uuid4(),
        user_id=user.id,
        role_id=role.id,
        tenant_id=None,  # Global role assignment
    )
    db.add(user_role)
    db.commit()
    
    return user


def create_system_role(db: Session, code: str, name: str | None = None) -> Role:
    role = Role(
        id=uuid4(),
        code=code,
        name=name or code.replace("_", " ").title(),
        tenant_id=None,
        is_system=True,
    )
    db.add(role)
    db.flush()
    return role


def create_permission(db: Session, code: str, name: str | None = None) -> Permission:
    permission = Permission(
        id=uuid4(),
        code=code,
        name=name or code.replace(".", " ").replace("_", " ").title(),
    )
    db.add(permission)
    db.flush()
    return permission


def assign_permission_to_role(db: Session, role: Role, permission: Permission) -> None:
    db.add(RolePermission(role_id=role.id, permission_id=permission.id))
    db.flush()


def create_saas_actor_user(db: Session, *, email: str = "ops@example.com", role_code: str = "OPS_AGENT") -> tuple[User, Role]:
    user = User(
        id=uuid4(),
        email=email,
        password_hash="fake_hash",
        is_active=True,
    )
    db.add(user)
    db.flush()

    role = create_system_role(db, role_code)
    db.add(
        UserRole(
            id=uuid4(),
            user_id=user.id,
            role_id=role.id,
            tenant_id=None,
        )
    )
    db.flush()
    db.commit()
    return user, role


def get_saas_token(user: User) -> str:
    """Create a SaaS token for super admin"""
    return create_access_token(
        subject=str(user.id),
        token_type="access",
        tenant_id=SAAS_TENANT_MARKER,
        roles=["SUPER_ADMIN"],
        permissions=["tenants.read_all", "tenants.create", "subscriptions.read", 
                     "subscriptions.manage", "admin.dashboard.view_all", 
                     "rbac.permissions.manage"],
    )


def get_saas_token_with_claims(
    user: User,
    *,
    roles: list[str] | None = None,
    permissions: list[str] | None = None,
) -> str:
    return create_access_token(
        subject=str(user.id),
        token_type="access",
        tenant_id=SAAS_TENANT_MARKER,
        roles=roles or [],
        permissions=permissions or [],
    )


# ========================================================================
# Tests: GET /api/v1/admin/tenants
# ========================================================================

class TestListTenants:
    def test_list_tenants_empty(self, client, db_session):
        """Test listing tenants when none exist"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        response = client.get(
            "/api/v1/admin/tenants",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        assert response.json() == []
    
    def test_list_tenants_with_data(self, client, db_session):
        """Test listing tenants with data"""
        # Create admin user
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        # Create a tenant
        tenant = Tenant(
            id=uuid4(),
            name="Test School",
            slug="test-school",
            is_active=True,
        )
        db_session.add(tenant)
        db_session.commit()
        
        response = client.get(
            "/api/v1/admin/tenants",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "Test School"
        assert data[0]["slug"] == "test-school"
        assert data[0]["is_active"] is True
        assert "user_count" in data[0]
        assert "plan" in data[0]
    
    def test_list_tenants_filter_by_name(self, client, db_session):
        """Test filtering tenants by name"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        # Create tenants
        for name in ["Alpha School", "Beta Academy", "Gamma Institute"]:
            tenant = Tenant(
                id=uuid4(),
                name=name,
                slug=name.lower().replace(" ", "-"),
                is_active=True,
            )
            db_session.add(tenant)
        db_session.commit()
        
        response = client.get(
            "/api/v1/admin/tenants?q=beta",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "Beta Academy"
    
    def test_list_tenants_filter_by_active(self, client, db_session):
        """Test filtering tenants by active status"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        # Create active and inactive tenants
        for i, is_active in enumerate([True, True, False]):
            tenant = Tenant(
                id=uuid4(),
                name=f"School {i}",
                slug=f"school-{i}",
                is_active=is_active,
            )
            db_session.add(tenant)
        db_session.commit()
        
        response = client.get(
            "/api/v1/admin/tenants?is_active=true",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert all(t["is_active"] is True for t in data)


# ========================================================================
# Tests: POST /api/v1/admin/tenants
# ========================================================================

class TestCreateTenant:
    def test_create_tenant_minimal(self, client, db_session):
        """Test creating a tenant with minimal data"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        response = client.post(
            "/api/v1/admin/tenants",
            json={
                "name": "New School",
                "slug": "new-school",
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "New School"
        assert data["slug"] == "new-school"
        assert data["is_active"] is True
        assert data["plan"] is None
        assert data["user_count"] == 0
    
    def test_create_tenant_with_plan(self, client, db_session):
        """Test creating a tenant with a plan"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        response = client.post(
            "/api/v1/admin/tenants",
            json={
                "name": "Premium School",
                "slug": "premium-school",
                "plan": "per_term",
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["plan"] == "per_term"
    
    def test_create_tenant_invalid_slug(self, client, db_session):
        """Test creating a tenant with invalid slug"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        response = client.post(
            "/api/v1/admin/tenants",
            json={
                "name": "Test School",
                "slug": "Test_School_123!",  # Invalid
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 422
    
    def test_create_tenant_duplicate_slug(self, client, db_session):
        """Test creating tenant with duplicate slug"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        # Create first tenant
        tenant = Tenant(
            id=uuid4(),
            name="First School",
            slug="school-one",
            is_active=True,
        )
        db_session.add(tenant)
        db_session.commit()
        
        # Try to create another with same slug
        response = client.post(
            "/api/v1/admin/tenants",
            json={
                "name": "Second School",
                "slug": "school-one",
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 409

    def test_create_tenant_with_admin_survives_invitation_failure(self, client, db_session, monkeypatch):
        user = create_super_admin_user(db_session)
        create_system_role(db_session, "DIRECTOR", "Director")
        db_session.commit()
        token = get_saas_token(user)

        def _explode(*args, **kwargs):
            raise RuntimeError("smtp offline")

        monkeypatch.setattr("app.api.v1.admin.service._send_invitation_email", _explode)

        response = client.post(
            "/api/v1/admin/tenants",
            json={
                "name": "Invite School",
                "slug": "invite-school",
                "admin_email": "director@invite-school.test",
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 201
        data = response.json()
        assert data["slug"] == "invite-school"
        assert data["user_count"] == 1

        tenant = db_session.execute(
            select(Tenant).where(Tenant.slug == "invite-school")
        ).scalar_one()
        invited_user = db_session.execute(
            select(User).where(User.email == "director@invite-school.test")
        ).scalar_one()
        membership = db_session.execute(
            select(UserTenant).where(
                UserTenant.tenant_id == tenant.id,
                UserTenant.user_id == invited_user.id,
            )
        ).scalar_one_or_none()
        director_role = db_session.execute(
            select(Role).where(Role.code == "DIRECTOR", Role.tenant_id.is_(None))
        ).scalar_one()
        assignment = db_session.execute(
            select(UserRole).where(
                UserRole.tenant_id == tenant.id,
                UserRole.user_id == invited_user.id,
                UserRole.role_id == director_role.id,
            )
        ).scalar_one_or_none()

        assert membership is not None
        assert assignment is not None

    def test_create_tenant_with_explicit_admin_credentials(self, client, db_session):
        user = create_super_admin_user(db_session)
        create_system_role(db_session, "DIRECTOR", "Director")
        db_session.commit()
        token = get_saas_token(user)

        response = client.post(
            "/api/v1/admin/tenants",
            json={
                "name": "Novel School",
                "slug": "novel-school",
                "primary_domain": "novel-school.shulehq.co.ke",
                "admin_email": "director@novel-school.test",
                "admin_full_name": "Novel School Director",
                "admin_password": "Pass12345!",
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 201
        data = response.json()
        assert data["primary_domain"] == "novel-school.shulehq.co.ke"
        assert data["admin_email"] == "director@novel-school.test"
        assert data["admin_full_name"] == "Novel School Director"
        assert data["user_count"] == 1

        created_user = db_session.execute(
            select(User).where(User.email == "director@novel-school.test")
        ).scalar_one()
        assert verify_password("Pass12345!", created_user.password_hash)

    def test_update_tenant_profile_and_admin_credentials(self, client, db_session):
        user = create_super_admin_user(db_session)
        create_system_role(db_session, "DIRECTOR", "Director")
        tenant = Tenant(
            id=uuid4(),
            name="Original School",
            slug="original-school",
            primary_domain="original-school.shulehq.co.ke",
            is_active=True,
        )
        db_session.add(tenant)
        db_session.commit()
        token = get_saas_token(user)

        response = client.patch(
            f"/api/v1/admin/tenants/{tenant.id}",
            json={
                "name": "Updated School",
                "slug": "updated-school",
                "primary_domain": "updated-school.shulehq.co.ke",
                "admin_email": "director@updated-school.test",
                "admin_full_name": "Updated School Director",
                "admin_password": "Daniel.45_",
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated School"
        assert data["slug"] == "updated-school"
        assert data["primary_domain"] == "updated-school.shulehq.co.ke"
        assert data["admin_email"] == "director@updated-school.test"
        assert data["admin_full_name"] == "Updated School Director"
        assert data["user_count"] == 1

        db_session.expire_all()
        updated_tenant = db_session.get(Tenant, tenant.id)
        assert updated_tenant is not None
        assert updated_tenant.slug == "updated-school"
        assert updated_tenant.primary_domain == "updated-school.shulehq.co.ke"

        director_user = db_session.execute(
            select(User).where(User.email == "director@updated-school.test")
        ).scalar_one()
        assert verify_password("Daniel.45_", director_user.password_hash)

        membership = db_session.execute(
            select(UserTenant).where(
                UserTenant.tenant_id == tenant.id,
                UserTenant.user_id == director_user.id,
            )
        ).scalar_one_or_none()
        assert membership is not None

        director_role = db_session.execute(
            select(Role).where(Role.code == "DIRECTOR", Role.tenant_id.is_(None))
        ).scalar_one()
        assignment = db_session.execute(
            select(UserRole).where(
                UserRole.tenant_id == tenant.id,
                UserRole.user_id == director_user.id,
                UserRole.role_id == director_role.id,
            )
        ).scalar_one_or_none()
        assert assignment is not None


class TestSaaSRbacRuntime:
    def test_saas_permissions_recompute_from_db_even_when_token_is_stale(self, client, db_session):
        user, role = create_saas_actor_user(db_session, role_code="TENANT_VIEWER")
        permission = create_permission(db_session, "tenants.read_all", "Tenants Read All")
        assign_permission_to_role(db_session, role, permission)
        db_session.commit()

        stale_token = get_saas_token_with_claims(user, roles=[], permissions=[])

        response = client.get(
            "/api/v1/admin/tenants",
            headers={"Authorization": f"Bearer {stale_token}"},
        )

        assert response.status_code == 200

    def test_saas_permission_deny_override_is_applied_immediately(self, client, db_session):
        user, role = create_saas_actor_user(db_session, role_code="TENANT_VIEWER")
        permission = create_permission(db_session, "tenants.read_all", "Tenants Read All")
        assign_permission_to_role(db_session, role, permission)
        db_session.flush()
        db_session.add(
            UserPermissionOverride(
                id=uuid4(),
                tenant_id=None,
                user_id=user.id,
                permission_id=permission.id,
                effect="DENY",
                reason="Regression test",
            )
        )
        db_session.commit()

        stale_token = get_saas_token_with_claims(
            user,
            roles=[role.code],
            permissions=["tenants.read_all"],
        )

        response = client.get(
            "/api/v1/admin/tenants",
            headers={"Authorization": f"Bearer {stale_token}"},
        )

        assert response.status_code == 403

    def test_super_admin_role_gets_full_permission_surface_without_token_claims(self, client, db_session):
        user = create_super_admin_user(db_session)
        create_permission(db_session, "admin.dashboard.view_all", "Admin Dashboard View All")
        create_permission(db_session, "tenants.read_all", "Tenants Read All")
        db_session.commit()

        stale_token = get_saas_token_with_claims(user, roles=[], permissions=[])

        response = client.get(
            "/api/v1/admin/saas/metrics",
            headers={"Authorization": f"Bearer {stale_token}"},
        )

        assert response.status_code == 200


# ========================================================================
# Tests: GET /api/v1/admin/saas/metrics
# ========================================================================

class TestSaaSMetrics:
    def test_get_metrics_empty(self, client, db_session):
        """Test getting metrics when no data exists"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        response = client.get(
            "/api/v1/admin/saas/metrics",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "revenue" in data
        assert "subscriptions" in data
        assert "tenants" in data
        assert "system" in data
        assert data["revenue"]["mrr"] == 0.0
        assert data["revenue"]["arr"] == 0.0
    
    def test_metrics_caching(self, client, db_session):
        """Test that metrics are cached"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        # First call
        response1 = client.get(
            "/api/v1/admin/saas/metrics",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        # Second call (should be cached)
        response2 = client.get(
            "/api/v1/admin/saas/metrics",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        assert response1.json() == response2.json()


# ========================================================================
# Tests: GET /api/v1/admin/saas/tenants/recent
# ========================================================================

class TestRecentTenants:
    def test_get_recent_tenants_empty(self, client, db_session):
        """Test getting recent tenants when none exist"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        response = client.get(
            "/api/v1/admin/saas/tenants/recent",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["tenants"] == []
    
    def test_get_recent_tenants_limited(self, client, db_session):
        """Test that recent tenants are limited to 6"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        # Create 10 tenants
        for i in range(10):
            tenant = Tenant(
                id=uuid4(),
                name=f"School {i}",
                slug=f"school-{i}",
                is_active=True,
            )
            db_session.add(tenant)
        db_session.commit()
        
        response = client.get(
            "/api/v1/admin/saas/tenants/recent",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["tenants"]) == 6


# ========================================================================
# Tests: Subscriptions
# ========================================================================

class TestSubscriptions:
    def test_list_subscriptions_empty(self, client, db_session):
        """Test listing subscriptions when none exist"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        response = client.get(
            "/api/v1/admin/subscriptions",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        assert response.json() == []
    
    def test_create_subscription(self, client, db_session):
        """Test creating a subscription"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        # Create a tenant first
        tenant = Tenant(
            id=uuid4(),
            name="Test School",
            slug="test-school",
            is_active=True,
        )
        db_session.add(tenant)
        db_session.commit()
        
        response = client.post(
            "/api/v1/admin/subscriptions",
            json={
                "tenant_id": str(tenant.id),
                "billing_plan": "per_term",
                "amount_kes": 5000,
                "discount_percent": 0.0,
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["billing_plan"] == "per_term"
        assert data["plan"] == "per_term"
        assert data["billing_cycle"] == "per_term"
        assert data["status"] == "trialing"  # First subscription is trialing
        assert data["amount_kes"] == 5000.0
    
    def test_create_subscription_with_discount(self, client, db_session):
        """Test creating subscription with discount"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        tenant = Tenant(
            id=uuid4(),
            name="Test School",
            slug="test-school",
            is_active=True,
        )
        db_session.add(tenant)
        db_session.commit()
        
        response = client.post(
            "/api/v1/admin/subscriptions",
            json={
                "tenant_id": str(tenant.id),
                "billing_plan": "per_term",
                "amount_kes": 12000,
                "discount_percent": 10.0,
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["amount_kes"] == 12000.0
        assert data["discount_percent"] == 10.0
    
    def test_update_subscription(self, client, db_session):
        """Test updating a subscription"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        # Create tenant and subscription
        tenant = Tenant(
            id=uuid4(),
            name="Test School",
            slug="test-school",
            is_active=True,
        )
        db_session.add(tenant)
        db_session.flush()
        
        sub = Subscription(
            id=uuid4(),
            tenant_id=tenant.id,
            plan="Starter",
            billing_cycle="per_term",
            status="trialing",
            amount_kes=Decimal("5000.00"),
            discount_percent=Decimal("0.0"),
            period_start=date.today(),
            period_end=date.today(),
        )
        db_session.add(sub)
        db_session.commit()
        
        response = client.patch(
            f"/api/v1/admin/subscriptions/{sub.id}",
            json={
                "status": "active",
                "billing_plan": "per_year",
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "active"
        assert data["billing_plan"] == "per_year"
        assert data["plan"] == "per_year"
        assert data["billing_cycle"] == "full_year"
    
    def test_delete_subscription(self, client, db_session):
        """Test deleting (canceling) a subscription"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        # Create tenant and subscription
        tenant = Tenant(
            id=uuid4(),
            name="Test School",
            slug="test-school",
            is_active=True,
        )
        db_session.add(tenant)
        db_session.flush()
        
        sub = Subscription(
            id=uuid4(),
            tenant_id=tenant.id,
            plan="Starter",
            billing_cycle="per_term",
            status="active",
            amount_kes=Decimal("5000.00"),
            discount_percent=Decimal("0.0"),
            period_start=date.today(),
            period_end=date.today(),
        )
        db_session.add(sub)
        db_session.commit()
        
        response = client.delete(
            f"/api/v1/admin/subscriptions/{sub.id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        assert response.json()["ok"] is True
        
        # Verify it's cancelled
        db_session.refresh(sub)
        assert sub.status == "cancelled"


# ========================================================================
# Tests: Permissions
# ========================================================================

class TestPermissions:
    def test_list_permissions_with_category(self, client, db_session):
        """Test that permissions include category field"""
        user = create_super_admin_user(db_session)
        token = get_saas_token(user)
        
        # Create a permission with category
        perm = Permission(
            id=uuid4(),
            code="test.read",
            name="Test Read",
            description="Can read tests",
            category="Testing",
        )
        db_session.add(perm)
        db_session.commit()
        
        response = client.get(
            "/api/v1/admin/rbac/permissions",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) > 0
        test_perm = next((p for p in data if p["code"] == "test.read"), None)
        assert test_perm is not None
        assert "category" in test_perm
        assert test_perm["category"] == "Testing"
