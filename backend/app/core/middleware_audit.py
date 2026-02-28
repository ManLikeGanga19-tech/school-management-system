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

from app.core.database import SessionLocal
from app.core.audit import log_event

logger = logging.getLogger(__name__)

def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        raw = int(os.getenv(name, str(default)))
    except Exception:
        return default
    return max(minimum, min(maximum, raw))


_AUDIT_QUEUE_MAXSIZE = _env_int("AUDIT_QUEUE_MAXSIZE", 2000, 100, 20000)
_AUDIT_WORKERS = _env_int("AUDIT_WORKERS", 1, 1, 4)
_AUDIT_DROPPED_LOG_EVERY = 100

_audit_queue: asyncio.Queue[dict] | None = None
_audit_init_lock = threading.Lock()
_audit_dropped_count = 0


def _as_uuid(value) -> UUID | None:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except Exception:
        return None


def _write_audit_event(event: dict) -> None:
    tenant_id = _as_uuid(event.get("tenant_id"))
    if tenant_id is None:
        return

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
    global _audit_queue

    if _audit_queue is not None:
        return

    with _audit_init_lock:
        if _audit_queue is not None:
            return

        _audit_queue = asyncio.Queue(maxsize=_AUDIT_QUEUE_MAXSIZE)
        loop = asyncio.get_running_loop()
        for idx in range(_AUDIT_WORKERS):
            loop.create_task(_audit_worker(idx))

        logger.info(
            "Audit queue initialized (workers=%s, maxsize=%s)",
            _AUDIT_WORKERS,
            _AUDIT_QUEUE_MAXSIZE,
        )


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

        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
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

        if tenant_id:
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
