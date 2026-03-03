from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import (
    get_current_user,
    get_current_user_saas,
    get_tenant,
    require_permission_saas,
)
from app.api.v1.support import service
from app.api.v1.support.schemas import (
    SupportMessageCreateIn,
    SupportMessageOut,
    SupportThreadOut,
    SupportThreadStatusUpdateIn,
    SupportUnreadCountOut,
    TenantSupportThreadCreateIn,
)

router = APIRouter()


def _request_roles(request: Request) -> set[str]:
    raw = getattr(request.state, "roles", []) or []
    return {
        str(role).strip().upper()
        for role in raw
        if isinstance(role, str) and str(role).strip()
    }


def require_tenant_support_actor(
    request: Request,
    _user=Depends(get_current_user),
):
    roles = _request_roles(request)
    if roles & {"DIRECTOR", "SECRETARY", "SUPER_ADMIN"}:
        return
    raise HTTPException(
        status_code=403,
        detail="Only director or secretary accounts can access Contact Admin",
    )


@router.get(
    "/tenant/unread-count",
    response_model=SupportUnreadCountOut,
    dependencies=[Depends(require_tenant_support_actor)],
)
def tenant_support_unread_count(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    try:
        count = service.tenant_unread_count(db, tenant_id=tenant.id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return SupportUnreadCountOut(unread_count=count)


@router.get(
    "/tenant/threads",
    response_model=list[SupportThreadOut],
    dependencies=[Depends(require_tenant_support_actor)],
)
def list_tenant_threads(
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=30, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    try:
        return service.list_tenant_threads(
            db,
            tenant_id=tenant.id,
            status=status,
            limit=limit,
            offset=offset,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post(
    "/tenant/threads",
    response_model=SupportThreadOut,
    dependencies=[Depends(require_tenant_support_actor)],
)
def create_tenant_thread(
    payload: TenantSupportThreadCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.create_tenant_thread(
            db,
            tenant_id=tenant.id,
            actor_user_id=user.id,
            subject=payload.subject,
            priority=payload.priority,
            message=payload.message,
        )
        db.commit()
        return row
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.get(
    "/tenant/threads/{thread_id}/messages",
    response_model=list[SupportMessageOut],
    dependencies=[Depends(require_tenant_support_actor)],
)
def list_tenant_thread_messages(
    thread_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
):
    try:
        return service.list_thread_messages(
            db,
            tenant_id=tenant.id,
            thread_id=thread_id,
            limit=limit,
            offset=offset,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post(
    "/tenant/threads/{thread_id}/messages",
    response_model=SupportMessageOut,
    dependencies=[Depends(require_tenant_support_actor)],
)
def tenant_send_message(
    thread_id: UUID,
    payload: SupportMessageCreateIn,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    user=Depends(get_current_user),
):
    try:
        row = service.tenant_send_message(
            db,
            tenant_id=tenant.id,
            thread_id=thread_id,
            actor_user_id=user.id,
            message=payload.message,
            reply_to_message_id=payload.reply_to_message_id,
        )
        db.commit()
        return row
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.post(
    "/tenant/threads/{thread_id}/read",
    dependencies=[Depends(require_tenant_support_actor)],
)
def tenant_mark_thread_read(
    thread_id: UUID,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
    _user=Depends(get_current_user),
):
    try:
        service.tenant_mark_thread_read(db, tenant_id=tenant.id, thread_id=thread_id)
        db.commit()
        return {"ok": True, "thread_id": str(thread_id)}
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))


@router.get(
    "/admin/unread-count",
    response_model=SupportUnreadCountOut,
    dependencies=[Depends(require_permission_saas("admin.dashboard.view_all"))],
)
def admin_support_unread_count(
    db: Session = Depends(get_db),
    _user=Depends(get_current_user_saas),
):
    try:
        count = service.admin_unread_count(db)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return SupportUnreadCountOut(unread_count=count)


@router.get(
    "/admin/threads",
    response_model=list[SupportThreadOut],
    dependencies=[Depends(require_permission_saas("admin.dashboard.view_all"))],
)
def list_admin_threads(
    db: Session = Depends(get_db),
    _user=Depends(get_current_user_saas),
    status: Optional[str] = Query(default=None),
    tenant_id: Optional[UUID] = Query(default=None),
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=60, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
):
    try:
        return service.list_admin_threads(
            db,
            status=status,
            tenant_id=tenant_id,
            q=q,
            limit=limit,
            offset=offset,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get(
    "/admin/threads/{thread_id}/messages",
    response_model=list[SupportMessageOut],
    dependencies=[Depends(require_permission_saas("admin.dashboard.view_all"))],
)
def list_admin_thread_messages(
    thread_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user_saas),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
):
    try:
        return service.admin_list_thread_messages(
            db,
            thread_id=thread_id,
            limit=limit,
            offset=offset,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post(
    "/admin/threads/{thread_id}/messages",
    response_model=SupportMessageOut,
    dependencies=[Depends(require_permission_saas("admin.dashboard.view_all"))],
)
def admin_send_message(
    thread_id: UUID,
    payload: SupportMessageCreateIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_saas),
):
    try:
        row = service.admin_send_message(
            db,
            thread_id=thread_id,
            actor_user_id=user.id,
            message=payload.message,
            reply_to_message_id=payload.reply_to_message_id,
        )
        db.commit()
        return row
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.post(
    "/admin/threads/{thread_id}/read",
    dependencies=[Depends(require_permission_saas("admin.dashboard.view_all"))],
)
def admin_mark_thread_read(
    thread_id: UUID,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user_saas),
):
    try:
        service.admin_mark_thread_read(db, thread_id=thread_id)
        db.commit()
        return {"ok": True, "thread_id": str(thread_id)}
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))


@router.patch(
    "/admin/threads/{thread_id}",
    response_model=SupportThreadOut,
    dependencies=[Depends(require_permission_saas("admin.dashboard.view_all"))],
)
def admin_update_thread_status(
    thread_id: UUID,
    payload: SupportThreadStatusUpdateIn,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user_saas),
):
    try:
        row = service.admin_set_thread_status(
            db,
            thread_id=thread_id,
            status=payload.status,
        )
        db.commit()
        return row
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
