# app/core/logging_config.py
"""
Structured JSON logging for the SMS backend.

In production (APP_ENV != "dev") every log record is emitted as a single JSON
object on stdout/stderr so log aggregators (Datadog, CloudWatch, Loki, etc.)
can parse, index, and alert on individual fields without regex hacks.

In dev the standard human-readable format is kept — JSON in a terminal is
painful to read during local development.

Usage
-----
Call ``configure_logging()`` once at process startup, before any loggers are
used.  In FastAPI this means calling it at module import time in ``main.py``
(before the ``FastAPI()`` constructor, which itself logs on startup).

Fields emitted on every record
-------------------------------
timestamp   ISO-8601 UTC, millisecond precision   2024-03-20T14:32:01.123Z
level       Python level name, uppercased          INFO / WARNING / ERROR
logger      Dotted logger name                     app.core.middleware_audit
message     Formatted log message string
request_id  X-Request-ID from context var, or null
tenant_id   Tenant UUID from context var, or null
exc         Exception type + message, only on ERROR+

Extra keyword arguments passed to logger.info(..., extra={...}) are merged
into the top-level JSON object so callers can attach structured domain fields
without polluting the message string.
"""

from __future__ import annotations

import json
import logging
import sys
import traceback
from contextvars import ContextVar
from datetime import datetime, timezone

# ── Context variables ──────────────────────────────────────────────────────────
# Set these in middleware so every log record emitted during a request
# automatically carries the correlation ID and tenant without the caller
# having to pass them explicitly.
log_request_id: ContextVar[str | None] = ContextVar("log_request_id", default=None)
log_tenant_id: ContextVar[str | None] = ContextVar("log_tenant_id", default=None)


class _JsonFormatter(logging.Formatter):
    """Emit each log record as a single-line JSON object."""

    # Standard LogRecord attributes that we promote to top-level fields.
    # All others are kept in the record but NOT forwarded (to avoid noise from
    # internal Python logging machinery attributes).
    _PROMOTED = frozenset(
        {
            "timestamp",
            "level",
            "logger",
            "message",
            "request_id",
            "tenant_id",
            "exc",
        }
    )

    # LogRecord built-in attributes — skip these when forwarding extra fields.
    _SKIP = frozenset(
        {
            "args",
            "created",
            "exc_info",
            "exc_text",
            "filename",
            "funcName",
            "levelname",
            "levelno",
            "lineno",
            "message",
            "module",
            "msecs",
            "msg",
            "name",
            "pathname",
            "process",
            "processName",
            "relativeCreated",
            "stack_info",
            "taskName",
            "thread",
            "threadName",
        }
    )

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003
        # Core fields — always present.
        ts = datetime.fromtimestamp(record.created, tz=timezone.utc)
        payload: dict = {
            "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts.microsecond // 1000:03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": log_request_id.get(),
            "tenant_id": log_tenant_id.get(),
        }

        # Exception details on WARNING+.
        if record.exc_info and record.exc_info[0] is not None:
            exc_type, exc_value, exc_tb = record.exc_info
            payload["exc"] = {
                "type": exc_type.__name__,
                "message": str(exc_value),
                "traceback": traceback.format_exception(exc_type, exc_value, exc_tb),
            }
        elif record.exc_text:
            payload["exc"] = {"text": record.exc_text}

        # Forward caller-supplied extra={} fields (skip internal LogRecord attrs).
        for key, value in record.__dict__.items():
            if key not in self._SKIP and not key.startswith("_"):
                payload.setdefault(key, value)

        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(app_env: str = "dev") -> None:
    """
    Configure the root logger for the application.

    Parameters
    ----------
    app_env:
        Value of ``APP_ENV``.  JSON formatter is used for any value other
        than ``"dev"``; human-readable format is used in dev.
    """
    use_json = app_env != "dev"

    handler = logging.StreamHandler(sys.stdout)
    if use_json:
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )

    root = logging.getLogger()
    # Remove any handlers added before configure_logging() was called
    # (e.g. by Uvicorn's default basicConfig).
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)

    # Suppress overly chatty third-party loggers that add noise without value.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
