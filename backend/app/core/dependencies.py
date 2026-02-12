from fastapi import Request, HTTPException, Depends
from sqlalchemy.orm import Session
from jose import JWTError

from app.core.database import get_db
from app.utils.tokens import decode_token
from app.models.user import User


def get_tenant(request: Request):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context missing")
    return tenant


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    tenant=Depends(get_tenant),
):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token")

    token = auth.split(" ", 1)[1].strip()

    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    if payload.get("tenant_id") != str(tenant.id):
        raise HTTPException(status_code=401, detail="Tenant mismatch")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid user")

    # Attach to request.state for AuditMiddleware
    request.state.user_id = user.id
    request.state.roles = payload.get("roles", []) or []
    request.state.permissions = payload.get("permissions", []) or []

    return user


def require_permission(code: str):
    #  Force auth to run first
    def _checker(
        request: Request,
        _user=Depends(get_current_user),
    ):
        perms = getattr(request.state, "permissions", []) or []
        if code not in perms:
            raise HTTPException(status_code=403, detail=f"Missing permission: {code}")

    return _checker
