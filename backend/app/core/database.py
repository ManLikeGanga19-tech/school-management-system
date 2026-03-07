# app/core/database.py
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import settings

try:
    # SQLAlchemy 2.x
    from sqlalchemy.orm import DeclarativeBase  # type: ignore
except ImportError:
    DeclarativeBase = None  # type: ignore


if DeclarativeBase is not None:
    class Base(DeclarativeBase):
        """SQLAlchemy Declarative Base for all models."""

        pass
else:
    # SQLAlchemy 1.4 fallback
    from sqlalchemy.orm import declarative_base

    Base = declarative_base()


# Database engine configuration.
# Pool values are environment-driven to avoid exhausting DB connections.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=settings.DB_POOL_PRE_PING,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT_SEC,
    pool_recycle=settings.DB_POOL_RECYCLE_SEC,
    pool_use_lifo=True,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def database_status() -> tuple[bool, str]:
    """
    Lightweight DB bootstrap status check.

    Returns:
      (True, "ready") when DB is reachable and core.tenants exists.
      (False, "...") with a machine-readable reason otherwise.
    """
    try:
        with engine.connect() as conn:
            tenants_table = conn.execute(text("SELECT to_regclass('core.tenants')")).scalar()
        if tenants_table:
            return True, "ready"
        return False, "schema_missing"
    except SQLAlchemyError:
        return False, "database_unavailable"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
