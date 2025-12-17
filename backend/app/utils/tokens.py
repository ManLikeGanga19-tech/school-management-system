from datetime import datetime, timedelta, timezone
from jose import jwt
from app.core.config import settings

ALGO = "HS256"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(*, sub: str, tenant_id: str, roles: list[str], permissions: list[str]) -> str:
    exp = _now_utc() + timedelta(minutes=settings.JWT_ACCESS_TTL_MIN)
    payload = {
        "sub": sub,
        "tenant_id": tenant_id,
        "roles": roles,
        "permissions": permissions,
        "type": "access",
        "exp": exp,
        "iat": _now_utc(),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGO)


def create_refresh_token(*, session_id: str, sub: str, tenant_id: str) -> tuple[str, datetime]:
    exp = _now_utc() + timedelta(days=settings.JWT_REFRESH_TTL_DAYS)
    payload = {
        "sid": session_id,   # session id in DB
        "sub": sub,
        "tenant_id": tenant_id,
        "type": "refresh",
        "exp": exp,
        "iat": _now_utc(),
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGO)
    return token, exp


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGO])
