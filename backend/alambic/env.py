import os
import sys
from logging.config import fileConfig
from pathlib import Path


def _maybe_reexec_into_local_venv() -> None:
    """
    If this env.py is loaded by a system Alembic executable, re-exec into the
    project's local venv Python to keep Alembic/SQLAlchemy/DB driver versions aligned.
    """
    if os.getenv("ALEMBIC_LOCAL_VENV_BOOTSTRAPPED") == "1":
        return

    backend_dir = Path(__file__).resolve().parents[1]
    candidates = (
        backend_dir / "venv" / "bin" / "python",
        backend_dir / "venv" / "Scripts" / "python.exe",
    )
    target_python = next((p for p in candidates if p.exists()), None)
    if target_python is None:
        return

    target_venv_root = target_python.parent.parent
    try:
        if Path(sys.prefix).resolve() == target_venv_root.resolve():
            return
    except Exception:
        if str(target_venv_root) in str(sys.prefix):
            return

    os.environ["ALEMBIC_LOCAL_VENV_BOOTSTRAPPED"] = "1"
    os.execv(str(target_python), [str(target_python), "-m", "alembic", *sys.argv[1:]])


_maybe_reexec_into_local_venv()


def _prepend_local_venv_site_packages() -> None:
    """
    Ensure Alembic uses this project's venv packages even when the
    `/usr/bin/alembic` entrypoint is invoked from system Python.
    """
    backend_dir = Path(__file__).resolve().parents[1]
    venv_dir = backend_dir / "venv"
    if not venv_dir.exists():
        return

    site_packages: list[Path] = []
    # Linux/WSL virtualenv layout
    lib_dir = venv_dir / "lib"
    if lib_dir.exists():
        site_packages.extend(sorted(lib_dir.glob("python*/site-packages")))
    # Windows virtualenv layout
    win_site = venv_dir / "Lib" / "site-packages"
    if win_site.exists():
        site_packages.append(win_site)

    # Insert in reverse so the first discovered path ends up first in sys.path
    for sp in reversed(site_packages):
        sp_str = str(sp)
        if sp.exists() and sp_str not in sys.path:
            sys.path.insert(0, sp_str)


_prepend_local_venv_site_packages()

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from sqlalchemy.exc import NoSuchModuleError

from alembic import context

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = None


def _load_database_url() -> str:
    # Priority: process env, then alembic.ini, then backend/.env
    url = os.getenv("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
    if url:
        return url

    env_path = Path(__file__).resolve().parents[1] / ".env"
    if env_path.exists():
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() == "DATABASE_URL":
                return value.strip().strip("\"").strip("'")
    return ""


_database_url = _load_database_url()
if _database_url:
    config.set_main_option("sqlalchemy.url", _database_url)

# Optional metadata import for autogenerate. Upgrade/downgrade should still run
# even when app runtime deps are unavailable in this shell.
try:
    from app.core.database import Base
    from app.models import (
        tenant,
        user,
        membership,
        auth,
        audit_log,
        subscription,
        invoice,
        payment,
        fee_structure,
        tenant_print_profile,
        document_sequence,
    )  # noqa: F401

    target_metadata = Base.metadata
except Exception:
    target_metadata = None

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    section = config.get_section(config.config_ini_section, {})
    url = section.get("sqlalchemy.url", "")
    tried_urls: list[str] = []

    candidate_urls: list[str] = []
    if isinstance(url, str) and url:
        candidate_urls.append(url)
        if "+psycopg://" in url:
            candidate_urls.append(url.replace("+psycopg://", "+psycopg2://", 1))
            candidate_urls.append(url.replace("+psycopg://", "://", 1))
        elif "+psycopg2://" in url:
            candidate_urls.append(url.replace("+psycopg2://", "+psycopg://", 1))
            candidate_urls.append(url.replace("+psycopg2://", "://", 1))
    else:
        candidate_urls.append(url)

    connectable = None
    last_error: Exception | None = None
    for candidate in candidate_urls:
        if candidate in tried_urls:
            continue
        tried_urls.append(candidate)
        section_try = dict(section)
        section_try["sqlalchemy.url"] = candidate
        try:
            connectable = engine_from_config(
                section_try,
                prefix="sqlalchemy.",
                poolclass=pool.NullPool,
            )
            break
        except (NoSuchModuleError, ModuleNotFoundError) as exc:
            last_error = exc

    if connectable is None:
        if last_error is not None:
            raise last_error
        raise RuntimeError("Unable to create Alembic engine from configured URL")

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
