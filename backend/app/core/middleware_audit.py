import time
import uuid
import logging
import asyncio
import os
import threading
from uuid import UUID
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from sqlalchemy.exc import TimeoutError as SATimeoutError

from app.core.database import SessionLocal, engine
from app.core.audit import log_event

logger = logging.getLogger(__name__)

def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        raw = int(os.getenv(name, str(default)))
    except Exception:
        return default
    return max(minimum, min(maximum, raw))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


_AUDIT_QUEUE_MAXSIZE = _env_int("AUDIT_QUEUE_MAXSIZE", 2000, 100, 20000)
_AUDIT_WORKERS = _env_int("AUDIT_WORKERS", 1, 1, 4)
_AUDIT_POOL_RESERVE = _env_int("AUDIT_POOL_RESERVE", 4, 1, 20)
_AUDIT_CAPTURE_HTTP_REQUESTS = _env_bool("AUDIT_CAPTURE_HTTP_REQUESTS", False)
_AUDIT_DROPPED_LOG_EVERY = 100
_AUDIT_PRESSURE_LOG_EVERY = 50

_audit_queue: asyncio.Queue[dict] | None = None
_audit_tasks: list[asyncio.Task] = []          # tracked so shutdown can cancel them
_audit_init_lock = threading.Lock()
_audit_dropped_count = 0
_audit_pressure_skipped_count = 0


def _as_uuid(value) -> UUID | None:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except Exception:
        return None


def _pool_snapshot() -> tuple[int, int] | None:
    pool = getattr(engine, "pool", None)
    if pool is None:
        return None
    try:
        checked_out = int(pool.checkedout())  # QueuePool API
        pool_size = int(pool.size())  # QueuePool API
        max_overflow = int(getattr(pool, "_max_overflow", 0))
        max_total = max(1, pool_size + max_overflow)
        return checked_out, max_total
    except Exception:
        return None


def _audit_pool_is_saturated(*, reserve_connections: int = 1) -> bool:
    snap = _pool_snapshot()
    if snap is None:
        return False
    checked_out, max_total = snap
    threshold = max(1, max_total - max(0, reserve_connections))
    return checked_out >= threshold


def _log_audit_pressure_skip(reason: str) -> None:
    global _audit_pressure_skipped_count
    _audit_pressure_skipped_count += 1
    if (
        _audit_pressure_skipped_count == 1
        or _audit_pressure_skipped_count % _AUDIT_PRESSURE_LOG_EVERY == 0
    ):
        snap = _pool_snapshot()
        if snap is None:
            logger.warning(
                "Audit write skipped (%s). skipped_count=%s",
                reason,
                _audit_pressure_skipped_count,
            )
        else:
            checked_out, max_total = snap
            logger.warning(
                "Audit write skipped (%s). skipped_count=%s pool=%s/%s",
                reason,
                _audit_pressure_skipped_count,
                checked_out,
                max_total,
            )


def _write_audit_event(event: dict) -> bool:
    tenant_id = _as_uuid(event.get("tenant_id"))
    if tenant_id is None:
        return False

    # Keep request flow resilient: do not compete for last DB connections.
    if _audit_pool_is_saturated(reserve_connections=_AUDIT_POOL_RESERVE):
        _log_audit_pressure_skip("pool_saturated")
        return False

    actor_user_id = _as_uuid(event.get("actor_user_id"))
    meta = event.get("meta")
    if not isinstance(meta, dict):
        meta = {}

    db = SessionLocal()
    try:
        log_event(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            action="http.request",
            resource="http",
            resource_id=None,
            payload=None,
            meta=meta,
        )
        db.commit()
        return True
    except SATimeoutError:
        db.rollback()
        _log_audit_pressure_skip("pool_timeout")
        return False
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def _audit_worker(worker_id: int) -> None:
    del worker_id
    global _audit_queue

    while True:
        if _audit_queue is None:
            await asyncio.sleep(0.1)
            continue

        event = await _audit_queue.get()
        try:
            await asyncio.to_thread(_write_audit_event, event)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Background audit log failed")
        finally:
            _audit_queue.task_done()


def _ensure_audit_workers_started() -> None:
    global _audit_queue, _audit_tasks

    if _audit_queue is not None:
        return

    with _audit_init_lock:
        if _audit_queue is not None:
            return

        _audit_queue = asyncio.Queue(maxsize=_AUDIT_QUEUE_MAXSIZE)
        loop = asyncio.get_running_loop()
        for idx in range(_AUDIT_WORKERS):
            task = loop.create_task(_audit_worker(idx))
            _audit_tasks.append(task)

        logger.info(
            "Audit queue initialized (workers=%s, maxsize=%s)",
            _AUDIT_WORKERS,
            _AUDIT_QUEUE_MAXSIZE,
        )


async def shutdown_audit_queue(*, drain_timeout: float = 8.0) -> None:
    """
    Gracefully drain and shut down the audit background queue.

    Call this from the application lifespan shutdown *before* closing Redis
    or the DB pool — workers need both to flush remaining events.

    Sequence:
      1. Wait up to ``drain_timeout`` seconds for in-flight events to be written.
         (Gunicorn graceful_timeout is 30 s; 8 s leaves ample headroom for the
         rest of teardown.)
      2. Cancel worker tasks — they will be blocked on queue.get() at this point
         because the queue is either empty or timed out.
      3. Await cancellation so the event loop is clean before the process exits.

    On timeout a WARNING is emitted with the count of dropped events so ops
    teams know there was data loss and can investigate queue pressure settings.
    """
    global _audit_queue, _audit_tasks

    if _audit_queue is None:
        return  # audit was never initialised (e.g. no requests came in)

    pending = _audit_queue.qsize()
    if pending > 0:
        logger.info(
            "Audit shutdown: draining %s pending event(s) (timeout=%.1fs)",
            pending,
            drain_timeout,
        )
        try:
            await asyncio.wait_for(_audit_queue.join(), timeout=drain_timeout)
            logger.info("Audit queue drained successfully.")
        except asyncio.TimeoutError:
            remaining = _audit_queue.qsize()
            logger.warning(
                "Audit shutdown timed out after %.1fs — dropping %s unprocessed event(s). "
                "Consider raising AUDIT_QUEUE_MAXSIZE or AUDIT_WORKERS if this recurs.",
                drain_timeout,
                remaining,
            )

    # Workers are now blocked on queue.get() (queue empty or timed out).
    # Cancel them cleanly so the event loop has no dangling tasks at exit.
    for task in _audit_tasks:
        task.cancel()
    if _audit_tasks:
        await asyncio.gather(*_audit_tasks, return_exceptions=True)
        _audit_tasks.clear()

    _audit_queue = None
    logger.info("Audit queue shut down.")


def _try_enqueue_audit_event(event: dict) -> bool:
    global _audit_dropped_count

    if _audit_queue is None:
        return False

    try:
        _audit_queue.put_nowait(event)
        return True
    except asyncio.QueueFull:
        _audit_dropped_count += 1
        if _audit_dropped_count == 1 or _audit_dropped_count % _AUDIT_DROPPED_LOG_EVERY == 0:
            logger.warning(
                "Audit queue full. Dropped events=%s (latest path=%s)",
                _audit_dropped_count,
                (event.get("meta") or {}).get("path"),
            )
        return False


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()

        # Prefer the ID already set by RequestIDMiddleware (runs before us).
        request_id = (
            getattr(request.state, "request_id", None)
            or request.headers.get("X-Request-ID")
            or str(uuid.uuid4())
        )
        request.state.request_id = request_id

        response: Response | None = None
        err: Exception | None = None
        try:
            response = await call_next(request)
        except Exception as exc:
            err = exc
            response = Response(status_code=500)

        duration_ms = int((time.time() - start) * 1000)

        tenant_id = getattr(request.state, "tenant_id", None)
        actor_user_id = getattr(request.state, "user_id", None)

        if tenant_id and _AUDIT_CAPTURE_HTTP_REQUESTS:
            meta = {
                "request_id": request_id,
                "method": request.method,
                "path": str(request.url.path),
                "status_code": response.status_code if response else 500,
                "duration_ms": duration_ms,
                "ip": request.client.host if request.client else None,
                "user_agent": request.headers.get("user-agent"),
            }
            if err:
                meta["error"] = err.__class__.__name__
                meta["error_message"] = str(err)[:500]

            event = {
                "tenant_id": str(tenant_id),
                "actor_user_id": (str(actor_user_id) if actor_user_id else None),
                "meta": meta,
            }

            try:
                _ensure_audit_workers_started()
                _try_enqueue_audit_event(event)
            except Exception:
                logger.exception("Failed to enqueue background audit log")

        if response is not None:
            response.headers["X-Request-ID"] = request_id

        if err:
            logger.exception("Unhandled request error (%s)", request_id, exc_info=err)
            raise err

        return response
