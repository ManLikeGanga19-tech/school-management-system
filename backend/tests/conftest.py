"""
Shared pytest configuration and fixtures for the SMS backend test suite.

Tests in test_admin_saas_endpoints.py continue to use their own locally-defined
fixtures (pytest gives local fixtures priority over conftest ones), so the
existing suite is not affected by additions here.
"""

from __future__ import annotations

import importlib
import os
import re
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import Session, sessionmaker

# ── Path bootstrap ────────────────────────────────────────────────────────────
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from app.core.config import settings  # noqa: E402
from app.core.database import Base, get_db  # noqa: E402
from app.core import middleware as tenant_middleware  # noqa: E402
from app.main import app  # noqa: E402


def _import_all_models() -> None:
    """Load every model module so Base.metadata has a complete table graph."""
    models_dir = backend_path / "app" / "models"
    for f in models_dir.glob("*.py"):
        if not f.name.startswith("_"):
            importlib.import_module(f"app.models.{f.stem}")


_import_all_models()


# ── Test database resolution ──────────────────────────────────────────────────

def _resolve_test_database_url() -> str:
    explicit = os.getenv("TEST_DATABASE_URL")
    if explicit:
        return explicit
    if os.getenv("CI", "").lower() == "true":
        return settings.DATABASE_URL
    base = make_url(settings.DATABASE_URL)
    db_name = (base.database or "").strip()
    if not db_name:
        raise RuntimeError(
            "DATABASE_URL has no database name — set TEST_DATABASE_URL explicitly."
        )
    if "test" in db_name.lower():
        return settings.DATABASE_URL
    suffix = "_test_db" if db_name.endswith("_db") else "_test"
    test_name = (db_name[:-3] if db_name.endswith("_db") else db_name) + suffix
    return base.set(database=test_name).render_as_string(hide_password=False)


def _assert_safe_url(url: str) -> None:
    if os.getenv("CI", "").lower() == "true":
        return
    db_name = (make_url(url).database or "").lower()
    if "test" not in db_name:
        raise RuntimeError(
            f"Refusing to use '{db_name}' for tests — name must contain 'test'."
        )


def _ensure_db_exists(url: str) -> None:
    if os.getenv("CI", "").lower() == "true":
        return
    parsed = make_url(url)
    db_name = (parsed.database or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_]+", db_name):
        raise RuntimeError(f"Unsafe test DB name: '{db_name}'")
    if "postgresql" not in parsed.get_backend_name():
        return
    admin_db = os.getenv("TEST_DATABASE_ADMIN_DB", "postgres")
    admin_url = parsed.set(database=admin_db)
    engine = create_engine(
        admin_url.render_as_string(hide_password=False),
        pool_pre_ping=True,
        isolation_level="AUTOCOMMIT",
    )
    try:
        with engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": db_name}
            ).scalar()
            if not exists:
                conn.exec_driver_sql(f'CREATE DATABASE "{db_name}"')
    finally:
        engine.dispose()


TEST_DATABASE_URL = _resolve_test_database_url()
_assert_safe_url(TEST_DATABASE_URL)

TEST_ENGINE = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
TestSessionLocal = sessionmaker(bind=TEST_ENGINE, autocommit=False, autoflush=False)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Reset the rate limiter storage before each test to prevent cross-test pollution."""
    try:
        from app.core.rate_limit import limiter
        if hasattr(limiter, "_storage") and hasattr(limiter._storage, "reset"):
            limiter._storage.reset()
    except Exception:
        pass
    yield


@pytest.fixture(scope="function")
def setup_db():
    """Drop and recreate the core schema for a clean-slate per test."""
    _ensure_db_exists(TEST_DATABASE_URL)
    with TEST_ENGINE.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA IF EXISTS core CASCADE")
        conn.exec_driver_sql("CREATE SCHEMA core")
    Base.metadata.create_all(bind=TEST_ENGINE)
    yield
    with TEST_ENGINE.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA IF EXISTS core CASCADE")


@pytest.fixture
def db_session(setup_db) -> Session:
    """Isolated DB session for each test — rolled back after the test."""
    session = TestSessionLocal()
    yield session
    session.rollback()
    session.close()


@pytest.fixture
def override_get_db(db_session, monkeypatch):
    """
    Wire the test DB session into FastAPI's dependency system and patch
    TenantMiddleware so it also uses the test DB (it opens its own sessions).
    """
    def _override():
        yield db_session

    app.dependency_overrides[get_db] = _override
    monkeypatch.setattr(tenant_middleware, "SessionLocal", TestSessionLocal)
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client(override_get_db) -> TestClient:
    """TestClient with raise_server_exceptions=False so 5xx are inspectable."""
    return TestClient(app, raise_server_exceptions=False)
