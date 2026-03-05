"""
Tests for SaaS admin endpoints
"""

import pytest
from uuid import uuid4
from datetime import date
from decimal import Decimal
from sqlalchemy.orm import Session
from app.api.v1.admin import routes as admin_routes

from fastapi.testclient import TestClient
from app.main import app
from app.core.database import get_db, Base, engine
from app.models.tenant import Tenant
from app.models.user import User
from app.models.membership import UserTenant
from app.models.subscription import Subscription
from app.models.rbac import Role, UserRole, Permission
from app.utils.tokens import create_access_token
from app.core.dependencies import SAAS_TENANT_MARKER


# ========================================================================
# Fixtures
# ========================================================================

def _reset_core_schema() -> None:
    with engine.begin() as conn:
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
    _reset_core_schema()
    Base.metadata.create_all(bind=engine)
    _invalidate_admin_caches()
    yield
    _invalidate_admin_caches()
    _reset_core_schema()


@pytest.fixture
def db_session(setup_db):
    """Get isolated DB session for each test."""
    session = Session(bind=engine)

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
