# backend/gunicorn.conf.py
#
# Gunicorn configuration for the SMS backend.
# Read automatically when gunicorn is invoked with --config gunicorn.conf.py
# (or named gunicorn.conf.py in the working directory).
#
# Worker count:
#   Rule of thumb: (2 * CPU cores) + 1, capped conservatively per container.
#   The prod compose service has cpus="1.50", so 2 workers is the safe default.
#   Override at deploy time via the GUNICORN_WORKERS environment variable.

import os

# ── Bind ──────────────────────────────────────────────────────────────────────
bind = "0.0.0.0:8000"

# ── Workers ───────────────────────────────────────────────────────────────────
workers = int(os.environ.get("GUNICORN_WORKERS", "1"))
worker_class = "uvicorn.workers.UvicornWorker"

# ── Timeouts ──────────────────────────────────────────────────────────────────
# Daraja STK push has a 30 s timeout; give the worker enough headroom.
timeout = 120           # hard kill after this many seconds of silence
graceful_timeout = 30   # SIGTERM → SIGKILL grace period
keepalive = 5

# ── Logging ───────────────────────────────────────────────────────────────────
accesslog = "-"         # stdout
errorlog = "-"          # stderr
loglevel = os.environ.get("GUNICORN_LOG_LEVEL", "info")
access_log_format = (
    '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'
)

# ── Process ───────────────────────────────────────────────────────────────────
proc_name = "sms-backend"

# ── Preload ───────────────────────────────────────────────────────────────────
# Loads Python bytecode once in the master process; workers fork and share
# read-only pages (copy-on-write).  Saves ~100 MB when running 2+ workers.
# ASGI lifespan events (Redis init, audit queue) still run per-worker.
preload_app = True


def post_fork(server, worker):
    """Dispose DB connections inherited from the master so each worker reconnects."""
    try:
        from app.core.database import engine
        engine.dispose()
    except Exception:
        pass
