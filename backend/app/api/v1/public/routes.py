from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from jose import JWTError
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.prospect import ProspectAccount, ProspectAuthSession, ProspectRequest
from app.utils.hashing import hash_password, verify_password
from app.utils.tokens import create_access_token, create_refresh_token, decode_token

router = APIRouter()

PUBLIC_ACCESS_ROLE = "PUBLIC_PROSPECT"
PUBLIC_PERMISSIONS = ["prospect.requests.read", "prospect.requests.create"]
PUBLIC_TENANT_MARKER = "__public__"
PUBLIC_REFRESH_COOKIE = "sms_public_refresh"
REQUEST_TYPES = {"DEMO", "ENQUIRY", "SCHOOL_VISIT"}
REQUEST_STATUSES = {"NEW", "CONTACTING", "SCHEDULED", "CLOSED"}
CONTACT_METHODS = {"EMAIL", "PHONE", "WHATSAPP", "MEETING"}


class ProspectAccountOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    organization_name: str
    phone: Optional[str] = None
    job_title: Optional[str] = None
    is_active: bool


class ProspectAuthResponse(BaseModel):
    access_token: str
    account: ProspectAccountOut


class ProspectRegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    organization_name: str = Field(min_length=2, max_length=160)
    email: EmailStr
    phone: Optional[str] = Field(default=None, max_length=40)
    job_title: Optional[str] = Field(default=None, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class ProspectLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class ProspectGoogleOAuthRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    organization_name: Optional[str] = Field(default=None, max_length=160)
    provider_subject: str = Field(min_length=1, max_length=255)


class ProspectRequestCreate(BaseModel):
    request_type: Literal["DEMO", "ENQUIRY", "SCHOOL_VISIT"]
    organization_name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    contact_phone: Optional[str] = Field(default=None, max_length=40)
    student_count: Optional[int] = Field(default=None, ge=0, le=500_000)
    preferred_contact_method: Optional[Literal["EMAIL", "PHONE", "WHATSAPP", "MEETING"]] = None
    preferred_contact_window: Optional[str] = Field(default=None, max_length=160)
    requested_domain: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = Field(default=None, max_length=4_000)


class ProspectRequestOut(BaseModel):
    id: str
    request_type: str
    status: str
    organization_name: str
    contact_name: str
    contact_email: EmailStr
    contact_phone: Optional[str] = None
    student_count: Optional[int] = None
    preferred_contact_method: Optional[str] = None
    preferred_contact_window: Optional[str] = None
    requested_domain: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ProspectMeResponse(BaseModel):
    account: ProspectAccountOut


def _refresh_cookie_options() -> dict[str, object]:
    options: dict[str, object] = {
        "key": PUBLIC_REFRESH_COOKIE,
        "httponly": True,
        "secure": settings.COOKIE_SECURE,
        "samesite": settings.COOKIE_SAMESITE,
        "path": "/api/v1/public/auth",
    }
    if settings.COOKIE_DOMAIN:
        options["domain"] = settings.COOKIE_DOMAIN
    return options


def _set_refresh_cookie(response: Response, value: str) -> None:
    response.set_cookie(value=value, **_refresh_cookie_options())


def _clear_refresh_cookie(response: Response) -> None:
    options = {
        "key": PUBLIC_REFRESH_COOKIE,
        "path": "/api/v1/public/auth",
    }
    if settings.COOKIE_DOMAIN:
        options["domain"] = settings.COOKIE_DOMAIN
    response.delete_cookie(**options)


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_optional_string(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _account_out(account: ProspectAccount) -> ProspectAccountOut:
    return ProspectAccountOut(
        id=str(account.id),
        email=account.email,
        full_name=account.full_name,
        organization_name=account.organization_name,
        phone=account.phone,
        job_title=account.job_title,
        is_active=bool(account.is_active),
    )


def _expected_public_oauth_secret() -> str:
    configured = (settings.PUBLIC_OAUTH_SHARED_SECRET or "").strip()
    if configured:
        return configured

    if settings.APP_ENV.strip().lower() in {"dev", "local", "development", "test"}:
        return "dev-public-oauth-bridge-secret"

    return ""


def _normalize_requested_domain(value: Optional[str]) -> Optional[str]:
    normalized = _normalize_optional_string(value)
    if normalized is None:
        return None

    cleaned = normalized.lower()
    if cleaned.startswith("https://"):
        cleaned = cleaned[len("https://") :]
    elif cleaned.startswith("http://"):
        cleaned = cleaned[len("http://") :]
    cleaned = cleaned.strip().strip("/")
    if not cleaned:
        return None
    if " " in cleaned or "/" in cleaned:
        raise HTTPException(status_code=422, detail="Invalid requested_domain")
    return cleaned


def _request_out(row: ProspectRequest) -> ProspectRequestOut:
    return ProspectRequestOut(
        id=str(row.id),
        request_type=row.request_type,
        status=row.status,
        organization_name=row.organization_name,
        contact_name=row.contact_name,
        contact_email=row.contact_email,
        contact_phone=row.contact_phone,
        student_count=row.student_count,
        preferred_contact_method=row.preferred_contact_method,
        preferred_contact_window=row.preferred_contact_window,
        requested_domain=row.requested_domain,
        notes=row.notes,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _issue_tokens(db: Session, *, account: ProspectAccount) -> tuple[str, str]:
    access = create_access_token(
        sub=str(account.id),
        tenant_id=PUBLIC_TENANT_MARKER,
        roles=[PUBLIC_ACCESS_ROLE],
        permissions=PUBLIC_PERMISSIONS,
    )

    session_id = uuid4()
    refresh_token, refresh_exp = create_refresh_token(
        session_id=str(session_id),
        sub=str(account.id),
        tenant_id=PUBLIC_TENANT_MARKER,
    )

    db.add(
        ProspectAuthSession(
            id=session_id,
            account_id=account.id,
            refresh_token_hash=hash_password(refresh_token),
            expires_at=refresh_exp,
            revoked_at=None,
            last_used_at=None,
        )
    )
    db.commit()
    return access, refresh_token


def _read_bearer_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing access token")
    return auth.split(" ", 1)[1].strip()


def get_current_prospect(
    request: Request,
    db: Session = Depends(get_db),
) -> ProspectAccount:
    token = _read_bearer_token(request)
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    if payload.get("tenant_id") != PUBLIC_TENANT_MARKER:
        raise HTTPException(status_code=401, detail="Not a public prospect token")

    account_id = payload.get("sub")
    if not account_id:
        raise HTTPException(status_code=401, detail="Invalid account")

    account = db.get(ProspectAccount, account_id)
    if not account or not account.is_active:
        raise HTTPException(status_code=401, detail="Invalid account")

    return account


@router.post("/auth/register", response_model=ProspectAuthResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def register(
    request: Request,
    payload: ProspectRegisterRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    email = _normalize_email(str(payload.email))
    existing = db.execute(select(ProspectAccount).where(ProspectAccount.email == email)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    account = ProspectAccount(
        id=uuid4(),
        email=email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        organization_name=payload.organization_name.strip(),
        phone=_normalize_optional_string(payload.phone),
        job_title=_normalize_optional_string(payload.job_title),
        is_active=True,
    )
    db.add(account)
    db.flush()

    access, refresh = _issue_tokens(db, account=account)
    _set_refresh_cookie(response, refresh)

    return ProspectAuthResponse(access_token=access, account=_account_out(account))


@router.post("/auth/login", response_model=ProspectAuthResponse)
@limiter.limit("10/minute")
def login(
    request: Request,
    payload: ProspectLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    email = _normalize_email(str(payload.email))
    account = db.execute(select(ProspectAccount).where(ProspectAccount.email == email)).scalar_one_or_none()
    if account is None or not account.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(payload.password, account.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access, refresh = _issue_tokens(db, account=account)
    _set_refresh_cookie(response, refresh)

    return ProspectAuthResponse(access_token=access, account=_account_out(account))


@router.post("/auth/oauth/google", response_model=ProspectAuthResponse)
@limiter.limit("10/minute")
def google_oauth_login(
    request: Request,
    payload: ProspectGoogleOAuthRequest,
    response: Response,
    db: Session = Depends(get_db),
    x_public_oauth_secret: Optional[str] = Header(default=None),
):
    expected_secret = _expected_public_oauth_secret()
    if not expected_secret:
        raise HTTPException(status_code=503, detail="Public OAuth bridge is not configured")
    if (x_public_oauth_secret or "").strip() != expected_secret:
        raise HTTPException(status_code=403, detail="Invalid OAuth bridge secret")

    email = _normalize_email(str(payload.email))
    full_name = payload.full_name.strip()
    organization_name = (
        _normalize_optional_string(payload.organization_name)
        or "Organization pending confirmation"
    )

    account = db.execute(
        select(ProspectAccount).where(ProspectAccount.email == email)
    ).scalar_one_or_none()
    if account is None:
        account = ProspectAccount(
            id=uuid4(),
            email=email,
            password_hash=hash_password(
                f"google-oauth::{payload.provider_subject.strip()}::{uuid4()}"
            ),
            full_name=full_name,
            organization_name=organization_name,
            phone=None,
            job_title=None,
            is_active=True,
        )
        db.add(account)
        db.flush()
    elif not account.is_active:
        raise HTTPException(status_code=403, detail="Prospect account is inactive")
    else:
        changed = False
        if not (account.full_name or "").strip():
            account.full_name = full_name
            changed = True
        if not (account.organization_name or "").strip():
            account.organization_name = organization_name
            changed = True
        if changed:
            db.flush()

    access, refresh = _issue_tokens(db, account=account)
    _set_refresh_cookie(response, refresh)

    return ProspectAuthResponse(access_token=access, account=_account_out(account))


@router.post("/auth/refresh", response_model=ProspectAuthResponse)
def refresh(
    response: Response,
    db: Session = Depends(get_db),
    sms_public_refresh: Optional[str] = Cookie(default=None),
):
    if not sms_public_refresh:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    try:
        payload = decode_token(sms_public_refresh)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    if payload.get("tenant_id") != PUBLIC_TENANT_MARKER:
        raise HTTPException(status_code=401, detail="Invalid public refresh token")

    session_id_raw = payload.get("sid")
    account_id_raw = payload.get("sub")
    if not session_id_raw or not account_id_raw:
        raise HTTPException(status_code=401, detail="Invalid refresh token payload")

    try:
        session_id = UUID(str(session_id_raw))
        account_id = UUID(str(account_id_raw))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token identifiers")

    session = db.execute(
        select(ProspectAuthSession).where(
            and_(
                ProspectAuthSession.id == session_id,
                ProspectAuthSession.account_id == account_id,
            )
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=401, detail="Session not found")
    if session.revoked_at is not None:
        raise HTTPException(status_code=401, detail="Session revoked")
    if session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    if not verify_password(sms_public_refresh, session.refresh_token_hash):
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    account = db.get(ProspectAccount, account_id)
    if account is None or not account.is_active:
        raise HTTPException(status_code=401, detail="Invalid account")

    access = create_access_token(
        sub=str(account.id),
        tenant_id=PUBLIC_TENANT_MARKER,
        roles=[PUBLIC_ACCESS_ROLE],
        permissions=PUBLIC_PERMISSIONS,
    )
    new_refresh, new_exp = create_refresh_token(
        session_id=str(session.id),
        sub=str(account.id),
        tenant_id=PUBLIC_TENANT_MARKER,
    )
    session.refresh_token_hash = hash_password(new_refresh)
    session.expires_at = new_exp
    session.last_used_at = datetime.now(timezone.utc)
    db.commit()

    _set_refresh_cookie(response, new_refresh)
    return ProspectAuthResponse(access_token=access, account=_account_out(account))


@router.post("/auth/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    sms_public_refresh: Optional[str] = Cookie(default=None),
):
    if sms_public_refresh:
        try:
            payload = decode_token(sms_public_refresh)
            session_id_raw = payload.get("sid")
            if payload.get("type") == "refresh" and payload.get("tenant_id") == PUBLIC_TENANT_MARKER and session_id_raw:
                session = db.get(ProspectAuthSession, UUID(str(session_id_raw)))
                if session and session.revoked_at is None:
                    session.revoked_at = datetime.now(timezone.utc)
                    db.commit()
        except Exception:
            pass

    _clear_refresh_cookie(response)
    return {"ok": True}


@router.get("/auth/me", response_model=ProspectMeResponse)
def me(account: ProspectAccount = Depends(get_current_prospect)):
    return ProspectMeResponse(account=_account_out(account))


@router.get("/requests", response_model=list[ProspectRequestOut])
def list_requests(
    account: ProspectAccount = Depends(get_current_prospect),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(ProspectRequest)
        .where(ProspectRequest.account_id == account.id)
        .order_by(ProspectRequest.created_at.desc())
    ).scalars().all()
    return [_request_out(row) for row in rows]


@router.post("/requests", response_model=ProspectRequestOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def create_request(
    request: Request,
    payload: ProspectRequestCreate,
    account: ProspectAccount = Depends(get_current_prospect),
    db: Session = Depends(get_db),
):
    organization_name = _normalize_optional_string(payload.organization_name) or account.organization_name
    contact_phone = _normalize_optional_string(payload.contact_phone) or account.phone
    preferred_contact_method = _normalize_optional_string(payload.preferred_contact_method)
    preferred_contact_window = _normalize_optional_string(payload.preferred_contact_window)
    requested_domain = _normalize_requested_domain(payload.requested_domain)
    notes = _normalize_optional_string(payload.notes)

    if preferred_contact_method and preferred_contact_method not in CONTACT_METHODS:
        raise HTTPException(status_code=422, detail="Invalid preferred_contact_method")
    if payload.request_type not in REQUEST_TYPES:
        raise HTTPException(status_code=422, detail="Invalid request_type")

    row = ProspectRequest(
        id=uuid4(),
        account_id=account.id,
        request_type=payload.request_type,
        status="NEW",
        organization_name=organization_name,
        contact_name=account.full_name,
        contact_email=account.email,
        contact_phone=contact_phone,
        student_count=payload.student_count,
        preferred_contact_method=preferred_contact_method,
        preferred_contact_window=preferred_contact_window,
        requested_domain=requested_domain,
        notes=notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return _request_out(row)
