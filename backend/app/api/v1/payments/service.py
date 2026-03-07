from __future__ import annotations

import base64
import json
import socket
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import InternalError, OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.core.audit import log_event
from app.core.config import settings
from app.models.subscription import Subscription, SubscriptionPayment
from app.models.tenant import Tenant

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore


PAYMENT_STATUS_VALUES = {"PENDING", "COMPLETED", "FAILED", "CANCELLED"}
FINAL_PAYMENT_STATUSES = {"COMPLETED", "FAILED", "CANCELLED"}

_DARAJA_BASE_BY_ENV = {
    "sandbox": "https://sandbox.safaricom.co.ke",
    "production": "https://api.safaricom.co.ke",
}

_ALLOWED_BILLING_PLANS = {"per_term", "per_year"}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _safe_storage_missing(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "does not exist" in msg
        or "undefined table" in msg
        or "relation" in msg and "not found" in msg
    ) and ("subscription_payments" in msg or "subscriptions" in msg)


def _raise_if_storage_missing(exc: Exception) -> None:
    if _safe_storage_missing(exc):
        raise RuntimeError(
            "Subscription payment storage is not configured. Run database migrations."
        )


def _safe_execute_scalar(db: Session, stmt):
    try:
        return db.execute(stmt).scalar_one_or_none()
    except (ProgrammingError, OperationalError, InternalError) as err:
        db.rollback()
        _raise_if_storage_missing(err)
        raise


def _normalize_phone(phone_number: str) -> str:
    digits = "".join(ch for ch in str(phone_number or "") if ch.isdigit())
    if digits.startswith("254") and len(digits) == 12:
        return digits
    if digits.startswith("0") and len(digits) == 10:
        return "254" + digits[1:]
    raise ValueError("phone_number must be a valid Kenyan number (07XX/01XX/254XXXXXXXXX)")


def _to_amount_decimal(value: Any) -> Decimal:
    try:
        amount = Decimal(str(value))
    except Exception as exc:  # pragma: no cover
        raise ValueError("Invalid amount") from exc
    if amount <= 0:
        raise ValueError("amount must be greater than 0")
    return amount.quantize(Decimal("0.01"))


def _to_stk_amount_int(amount: Decimal) -> int:
    rounded = amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(rounded)


def _status_upper_to_api(status: str | None) -> str:
    normalized = str(status or "PENDING").strip().upper()
    if normalized not in PAYMENT_STATUS_VALUES:
        normalized = "PENDING"
    return normalized.lower()


def _status_from_result_code(result_code: Optional[int]) -> str:
    if result_code is None:
        return "pending"
    if result_code == 0:
        return "completed"
    if result_code in {1, 1032, 1037, 2001, 2002}:
        return "failed"
    return "pending"


def _subscription_billing_plan(sub: Subscription) -> str:
    plan_raw = str(getattr(sub, "plan", "") or "").strip().lower()
    if plan_raw in _ALLOWED_BILLING_PLANS:
        return plan_raw
    cycle_raw = str(getattr(sub, "billing_cycle", "") or "").strip().lower()
    if cycle_raw == "full_year":
        return "per_year"
    return "per_term"


def _subscription_billing_cycle(sub: Subscription) -> str:
    return "full_year" if _subscription_billing_plan(sub) == "per_year" else "per_term"


def _normalize_env(value: str | None) -> str:
    raw = str(value or "sandbox").strip().lower()
    if raw not in _DARAJA_BASE_BY_ENV:
        return "sandbox"
    return raw


def _daraja_base_url() -> str:
    return _DARAJA_BASE_BY_ENV[_normalize_env(settings.DARAJA_ENV)]


def _allow_sandbox_mock_fallback() -> bool:
    """
    Enable mock fallback for sandbox in safe non-production app environments,
    while keeping production strict by default.
    """
    if bool(settings.DARAJA_USE_MOCK):
        return True
    if _normalize_env(settings.DARAJA_ENV) != "sandbox":
        return False
    if bool(settings.DARAJA_SANDBOX_FALLBACK_TO_MOCK):
        return True
    app_env = str(settings.APP_ENV or "").strip().lower()
    return app_env in {"dev", "development", "local", "test", "testing"}


def _daraja_timestamp() -> str:
    if ZoneInfo is not None:
        now = datetime.now(ZoneInfo("Africa/Nairobi"))
    else:  # pragma: no cover
        now = datetime.now(timezone(timedelta(hours=3)))
    return now.strftime("%Y%m%d%H%M%S")


def _daraja_password(shortcode: str, passkey: str, timestamp: str) -> str:
    raw = f"{shortcode}{passkey}{timestamp}".encode("utf-8")
    return base64.b64encode(raw).decode("utf-8")


def _required_daraja_config_missing() -> list[str]:
    required = {
        "DARAJA_CONSUMER_KEY": settings.DARAJA_CONSUMER_KEY,
        "DARAJA_CONSUMER_SECRET": settings.DARAJA_CONSUMER_SECRET,
        "DARAJA_SHORTCODE": settings.DARAJA_SHORTCODE,
        "DARAJA_PASSKEY": settings.DARAJA_PASSKEY,
        "DARAJA_CALLBACK_BASE_URL": settings.DARAJA_CALLBACK_BASE_URL,
    }
    return [name for name, value in required.items() if not str(value or "").strip()]


def get_daraja_health() -> dict[str, Any]:
    mode = _normalize_env(settings.DARAJA_ENV)
    missing_required = sorted(_required_daraja_config_missing())
    timeout_sec = int(settings.DARAJA_TIMEOUT_SEC or 30)

    callback_url: str | None = None
    callback_error: str | None = None
    try:
        callback_url = _build_callback_url()
    except Exception as exc:
        callback_error = str(exc)

    ready = len(missing_required) == 0 and callback_error is None
    status = "ready" if ready else "degraded"

    if callback_error and "DARAJA_CALLBACK_BASE_URL" not in missing_required:
        missing_required.append("DARAJA_CALLBACK_BASE_URL")

    return {
        "status": status,
        "ready": ready,
        "mode": mode,
        "use_mock": bool(settings.DARAJA_USE_MOCK),
        "sandbox_fallback_to_mock": _allow_sandbox_mock_fallback(),
        "timeout_sec": timeout_sec,
        "callback_url": callback_url,
        "callback_token_protected": bool(str(settings.DARAJA_CALLBACK_TOKEN or "").strip()),
        "missing_required": missing_required,
        "checked_at": _now_utc(),
    }


def _hosts_for_mode(mode: str) -> list[str]:
    # Keep checks focused to active mode host, with sandbox additionally
    # checking production DNS for operator visibility during go-live prep.
    if mode == "sandbox":
        return ["sandbox.safaricom.co.ke", "api.safaricom.co.ke"]
    return ["api.safaricom.co.ke"]


def _dns_check(host: str) -> dict[str, Any]:
    started = time.monotonic()
    try:
        resolved = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
        addresses = sorted({row[4][0] for row in resolved if row and row[4]})
        latency_ms = int((time.monotonic() - started) * 1000)
        return {
            "host": host,
            "ok": len(addresses) > 0,
            "addresses": addresses[:10],
            "latency_ms": latency_ms,
            "error": None,
        }
    except Exception as exc:
        latency_ms = int((time.monotonic() - started) * 1000)
        return {
            "host": host,
            "ok": False,
            "addresses": [],
            "latency_ms": latency_ms,
            "error": str(exc),
        }


def get_daraja_connectivity_check() -> dict[str, Any]:
    mode = _normalize_env(settings.DARAJA_ENV)
    base_url = _daraja_base_url()
    missing_required = sorted(_required_daraja_config_missing())
    use_mock = bool(settings.DARAJA_USE_MOCK)
    sandbox_fallback = _allow_sandbox_mock_fallback()

    dns_checks = [_dns_check(host) for host in _hosts_for_mode(mode)]
    any_dns_ok = any(bool(row.get("ok")) for row in dns_checks)

    oauth_attempted = False
    oauth_ok = False
    oauth_latency_ms: int | None = None
    oauth_error_type: str | None = None
    oauth_error: str | None = None

    if missing_required:
        oauth_error_type = "configuration"
        oauth_error = "Required Daraja variables are missing."
    else:
        oauth_attempted = True
        started = time.monotonic()
        try:
            _daraja_access_token()
            oauth_ok = True
            oauth_latency_ms = int((time.monotonic() - started) * 1000)
        except ValueError as exc:
            oauth_ok = False
            oauth_latency_ms = int((time.monotonic() - started) * 1000)
            oauth_error_type = "configuration"
            oauth_error = str(exc)
        except RuntimeError as exc:
            oauth_ok = False
            oauth_latency_ms = int((time.monotonic() - started) * 1000)
            oauth_error_type = "upstream"
            oauth_error = str(exc)
        except Exception as exc:
            oauth_ok = False
            oauth_latency_ms = int((time.monotonic() - started) * 1000)
            oauth_error_type = "unknown"
            oauth_error = str(exc)

    if missing_required:
        status = "misconfigured"
        recommendation = (
            "Configure all required Daraja variables before running live STK checks."
        )
    elif oauth_ok and any_dns_ok:
        status = "healthy"
        recommendation = "Daraja connectivity is healthy."
    else:
        status = "degraded"
        if mode == "sandbox" and sandbox_fallback:
            recommendation = (
                "Daraja sandbox is currently unreachable; mock fallback is enabled for continuity."
            )
        elif mode == "sandbox":
            recommendation = (
                "Daraja sandbox is unreachable. Verify DNS/firewall/proxy path or enable "
                "DARAJA_SANDBOX_FALLBACK_TO_MOCK for development continuity."
            )
        else:
            recommendation = (
                "Daraja production connectivity is degraded. Verify outbound network and provider status."
            )

    return {
        "status": status,
        "mode": mode,
        "base_url": base_url,
        "use_mock": use_mock,
        "sandbox_fallback_to_mock": sandbox_fallback,
        "missing_required": missing_required,
        "dns_checks": dns_checks,
        "oauth_check": {
            "attempted": oauth_attempted,
            "ok": oauth_ok,
            "latency_ms": oauth_latency_ms,
            "error_type": oauth_error_type,
            "error": oauth_error,
        },
        "recommendation": recommendation,
        "checked_at": _now_utc(),
    }


def _build_callback_url() -> str:
    base = str(settings.DARAJA_CALLBACK_BASE_URL or "").strip().rstrip("/")
    if not base:
        raise ValueError("DARAJA_CALLBACK_BASE_URL is required")

    token = str(settings.DARAJA_CALLBACK_TOKEN or "").strip()
    path = "/api/v1/payments/daraja/callback"
    if token:
        return f"{base}{path}?{urlencode({'token': token})}"
    return f"{base}{path}"


def _http_json(
    *,
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout_sec: int = 30,
    max_retries: int = 0,
    retry_backoff_sec: float = 0.6,
) -> dict[str, Any]:
    attempt = 0
    while True:
        body_bytes = None
        req_headers = dict(headers or {})
        if payload is not None:
            body_bytes = json.dumps(payload).encode("utf-8")
            req_headers.setdefault("Content-Type", "application/json")

        req = Request(url=url, data=body_bytes, method=method.upper())
        for key, value in req_headers.items():
            req.add_header(key, value)

        try:
            with urlopen(req, timeout=timeout_sec) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except HTTPError as err:
            detail_raw = err.read().decode("utf-8", errors="ignore")
            detail = detail_raw or str(err)
            try:
                parsed = json.loads(detail_raw) if detail_raw else {}
                if isinstance(parsed, dict):
                    detail = (
                        str(parsed.get("errorMessage") or "")
                        or str(parsed.get("error_description") or "")
                        or str(parsed.get("ResponseDescription") or "")
                        or detail
                    )
            except Exception:
                pass

            # Upstream/server-side failures: retry a few times, then return 503 upstream signal.
            if err.code >= 500:
                if attempt < max_retries:
                    time.sleep(retry_backoff_sec * (2**attempt))
                    attempt += 1
                    continue
                raise RuntimeError(f"Daraja upstream unavailable ({err.code}): {detail}")
            raise ValueError(f"Daraja request failed ({err.code}): {detail}")
        except (URLError, TimeoutError) as err:
            if attempt < max_retries:
                time.sleep(retry_backoff_sec * (2**attempt))
                attempt += 1
                continue
            raise RuntimeError(f"Daraja network error: {err}")


def _daraja_access_token() -> str:
    missing = _required_daraja_config_missing()
    if missing:
        raise ValueError(
            "Daraja configuration missing: " + ", ".join(sorted(missing))
        )

    creds = f"{settings.DARAJA_CONSUMER_KEY}:{settings.DARAJA_CONSUMER_SECRET}".encode(
        "utf-8"
    )
    auth = base64.b64encode(creds).decode("utf-8")
    data = _http_json(
        method="GET",
        url=f"{_daraja_base_url()}/oauth/v1/generate?grant_type=client_credentials",
        headers={"Authorization": f"Basic {auth}"},
        timeout_sec=int(settings.DARAJA_TIMEOUT_SEC or 30),
        max_retries=2,
    )
    token = str(data.get("access_token") or "").strip()
    if not token:
        raise ValueError("Daraja access token response missing access_token")
    return token


def _call_daraja_stk_push(*, phone_number: str, amount: Decimal, account_reference: str, description: str) -> dict[str, Any]:
    token = _daraja_access_token()
    timestamp = _daraja_timestamp()
    shortcode = str(settings.DARAJA_SHORTCODE).strip()
    passkey = str(settings.DARAJA_PASSKEY).strip()

    body = {
        "BusinessShortCode": shortcode,
        "Password": _daraja_password(shortcode, passkey, timestamp),
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": _to_stk_amount_int(amount),
        "PartyA": phone_number,
        "PartyB": shortcode,
        "PhoneNumber": phone_number,
        "CallBackURL": _build_callback_url(),
        "AccountReference": account_reference[:20] if account_reference else "SUBSCRIPTION",
        "TransactionDesc": description[:182] if description else "Subscription Payment",
    }

    data = _http_json(
        method="POST",
        url=f"{_daraja_base_url()}/mpesa/stkpush/v1/processrequest",
        headers={"Authorization": f"Bearer {token}"},
        payload=body,
        timeout_sec=int(settings.DARAJA_TIMEOUT_SEC or 30),
        max_retries=2,
    )

    response_code = str(data.get("ResponseCode") or "").strip()
    if response_code != "0":
        raise ValueError(
            str(data.get("ResponseDescription") or "Daraja STK push request failed")
        )
    return data


def _call_daraja_stk_query(*, checkout_request_id: str) -> dict[str, Any]:
    token = _daraja_access_token()
    timestamp = _daraja_timestamp()
    shortcode = str(settings.DARAJA_SHORTCODE).strip()
    passkey = str(settings.DARAJA_PASSKEY).strip()

    body = {
        "BusinessShortCode": shortcode,
        "Password": _daraja_password(shortcode, passkey, timestamp),
        "Timestamp": timestamp,
        "CheckoutRequestID": checkout_request_id,
    }

    data = _http_json(
        method="POST",
        url=f"{_daraja_base_url()}/mpesa/stkpushquery/v1/query",
        headers={"Authorization": f"Bearer {token}"},
        payload=body,
        timeout_sec=int(settings.DARAJA_TIMEOUT_SEC or 30),
        max_retries=2,
    )
    return data


def _get_tenant_subscription_row(
    db: Session,
    *,
    tenant_id: UUID,
    subscription_id: Optional[UUID] = None,
) -> Subscription:
    try:
        query = select(Subscription).where(Subscription.tenant_id == tenant_id)
        if subscription_id is not None:
            query = query.where(Subscription.id == subscription_id)
        row = db.execute(
            query.order_by(Subscription.created_at.desc(), Subscription.id.desc())
        ).scalars().first()
    except (ProgrammingError, OperationalError, InternalError) as err:
        db.rollback()
        _raise_if_storage_missing(err)
        raise

    if row is None:
        raise ValueError("Subscription not found for this tenant")
    return row


def get_tenant_subscription(db: Session, *, tenant_id: UUID) -> dict | None:
    try:
        sub = db.execute(
            select(Subscription)
            .where(Subscription.tenant_id == tenant_id)
            .order_by(Subscription.created_at.desc(), Subscription.id.desc())
        ).scalars().first()
        if sub is None:
            return None
        tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    except (ProgrammingError, OperationalError, InternalError) as err:
        db.rollback()
        _raise_if_storage_missing(err)
        raise

    amount_kes = float(sub.amount_kes or 0)
    billing_plan = _subscription_billing_plan(sub)
    billing_cycle = _subscription_billing_cycle(sub)
    return {
        "id": str(sub.id),
        "billing_plan": billing_plan,
        # Backward-compatible mirrors.
        "plan": billing_plan,
        "billing_cycle": billing_cycle,
        "status": str(sub.status or "trialing"),
        "amount_kes": amount_kes,
        "discount_percent": (
            float(sub.discount_percent) if sub.discount_percent is not None else None
        ),
        "period_start": sub.period_start.isoformat() if sub.period_start else None,
        "period_end": sub.period_end.isoformat() if sub.period_end else None,
        "next_payment_date": sub.period_end.isoformat() if sub.period_end else None,
        "next_payment_amount": amount_kes,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
        "notes": sub.notes,
        "tenant_name": tenant.name if tenant else None,
        "tenant_slug": tenant.slug if tenant else None,
    }


def list_tenant_subscription_payments(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int = 200,
    offset: int = 0,
) -> list[dict]:
    try:
        rows = db.execute(
            select(SubscriptionPayment)
            .where(SubscriptionPayment.tenant_id == tenant_id)
            .order_by(
                SubscriptionPayment.initiated_at.desc(),
                SubscriptionPayment.id.desc(),
            )
            .offset(offset)
            .limit(limit)
        ).scalars().all()
    except (ProgrammingError, OperationalError, InternalError) as err:
        db.rollback()
        _raise_if_storage_missing(err)
        raise

    out: list[dict] = []
    for row in rows:
        paid_at = row.paid_at or row.completed_at or row.initiated_at
        out.append(
            {
                "id": str(row.id),
                "amount_kes": float(row.amount_kes or 0),
                "paid_at": paid_at.isoformat() if paid_at else None,
                "mpesa_receipt": row.mpesa_receipt,
                "phone": row.phone_number,
                "period_label": (
                    paid_at.strftime("%b %Y") if paid_at is not None else None
                ),
                "status": _status_upper_to_api(row.status),
            }
        )
    return out


def _mock_stk_push_result() -> dict[str, Any]:
    return {
        "ResponseCode": "0",
        "ResponseDescription": "Mock STK push accepted",
        "CustomerMessage": "Success. Request accepted for processing",
        "CheckoutRequestID": f"ws_CO_{uuid4().hex}",
        "MerchantRequestID": f"ws_MR_{uuid4().hex}",
    }


def _touch_subscription_after_success(sub: Subscription, when_utc: datetime) -> None:
    today = when_utc.date()
    current_end = sub.period_end
    if current_end and current_end > today:
        next_start = current_end
    else:
        next_start = today

    duration_days = 90 if _subscription_billing_plan(sub) == "per_term" else 365
    sub.period_start = next_start
    sub.period_end = next_start + timedelta(days=duration_days)
    sub.status = "active"
    sub.updated_at = _now_utc()


def initiate_tenant_subscription_payment(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: Optional[UUID],
    phone_number: str,
    amount: Any,
    subscription_id: Optional[UUID] = None,
) -> dict:
    sub = _get_tenant_subscription_row(
        db, tenant_id=tenant_id, subscription_id=subscription_id
    )

    normalized_phone = _normalize_phone(phone_number)
    payment_amount = _to_amount_decimal(amount if amount is not None else sub.amount_kes)

    mock_fallback = False
    mock_fallback_reason: str | None = None

    if settings.DARAJA_USE_MOCK:
        daraja_res = _mock_stk_push_result()
    else:
        try:
            daraja_res = _call_daraja_stk_push(
                phone_number=normalized_phone,
                amount=payment_amount,
                account_reference=f"SUB-{str(sub.id)[:8]}",
                description=f"{_subscription_billing_plan(sub)} subscription payment",
            )
        except RuntimeError as exc:
            # Sandbox-only resilience: allow local workflow progression when upstream
            # sandbox is down/unreachable, while keeping production strict by default.
            if _allow_sandbox_mock_fallback():
                daraja_res = _mock_stk_push_result()
                mock_fallback = True
                mock_fallback_reason = str(exc)
            else:
                if _normalize_env(settings.DARAJA_ENV) == "sandbox":
                    raise RuntimeError(
                        f"{exc}. For sandbox dev continuity, set "
                        "DARAJA_SANDBOX_FALLBACK_TO_MOCK=true (or DARAJA_USE_MOCK=true)."
                    )
                raise

    checkout_request_id = str(daraja_res.get("CheckoutRequestID") or "").strip()
    merchant_request_id = str(daraja_res.get("MerchantRequestID") or "").strip()
    response_description = str(
        daraja_res.get("ResponseDescription") or "STK push sent"
    ).strip()
    customer_message = str(daraja_res.get("CustomerMessage") or "").strip() or None

    if not checkout_request_id:
        raise ValueError("Daraja response missing CheckoutRequestID")
    if not merchant_request_id:
        merchant_request_id = f"local-{uuid4().hex}"

    pay = SubscriptionPayment(
        tenant_id=tenant_id,
        subscription_id=sub.id,
        initiated_by_user_id=actor_user_id,
        provider="MPESA_DARAJA",
        phone_number=normalized_phone,
        amount_kes=payment_amount,
        currency="KES",
        checkout_request_id=checkout_request_id,
        merchant_request_id=merchant_request_id,
        status="PENDING",
        request_payload={
            "subscription_id": str(sub.id),
            "phone_number": normalized_phone,
            "amount_kes": str(payment_amount),
            "daraja_response": daraja_res,
            "mock_fallback": mock_fallback,
            "mock_fallback_reason": mock_fallback_reason,
        },
    )
    db.add(pay)
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="subscription.payment.initiate",
        resource="subscription_payment",
        resource_id=pay.id,
        payload={
            "subscription_id": str(sub.id),
            "checkout_request_id": checkout_request_id,
            "merchant_request_id": merchant_request_id,
            "amount_kes": str(payment_amount),
            "phone_number": normalized_phone,
            "mock_fallback": mock_fallback,
        },
        meta={"mock_fallback": mock_fallback},
    )

    return {
        "checkout_request_id": checkout_request_id,
        "merchant_request_id": merchant_request_id,
        "response_description": response_description,
        "customer_message": customer_message,
        "status": "pending",
    }


def _extract_callback_item_map(payload: dict[str, Any]) -> dict[str, Any]:
    body = payload.get("Body") if isinstance(payload.get("Body"), dict) else {}
    stk = body.get("stkCallback") if isinstance(body.get("stkCallback"), dict) else {}
    meta = (
        stk.get("CallbackMetadata")
        if isinstance(stk.get("CallbackMetadata"), dict)
        else {}
    )
    items = meta.get("Item") if isinstance(meta.get("Item"), list) else []
    out: dict[str, Any] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        key = str(item.get("Name") or "").strip()
        if not key:
            continue
        out[key] = item.get("Value")
    return out


def _parse_transaction_datetime(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.strptime(text, "%Y%m%d%H%M%S")
        if ZoneInfo is not None:
            return parsed.replace(tzinfo=ZoneInfo("Africa/Nairobi")).astimezone(timezone.utc)
        return parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _apply_payment_status_update(
    db: Session,
    *,
    pay: SubscriptionPayment,
    status_api: str,
    result_code: int | None,
    result_desc: str | None,
    callback_payload: dict[str, Any] | None,
    mpesa_receipt: str | None = None,
    paid_at: datetime | None = None,
    phone_number: str | None = None,
    amount_kes: Decimal | None = None,
) -> None:
    status_upper = str(status_api or "pending").strip().upper()
    if status_upper not in PAYMENT_STATUS_VALUES:
        status_upper = "PENDING"

    pay.status = status_upper
    pay.result_code = result_code
    pay.result_desc = result_desc
    if callback_payload is not None:
        pay.callback_payload = callback_payload
    if mpesa_receipt:
        pay.mpesa_receipt = mpesa_receipt
    if phone_number:
        pay.phone_number = phone_number
    if amount_kes is not None and amount_kes > 0:
        pay.amount_kes = amount_kes
    pay.updated_at = _now_utc()

    if status_upper == "COMPLETED":
        done_at = paid_at or _now_utc()
        pay.paid_at = done_at
        pay.completed_at = done_at
        if pay.subscription_id:
            sub = db.get(Subscription, pay.subscription_id)
            if sub and sub.tenant_id == pay.tenant_id:
                _touch_subscription_after_success(sub, done_at)
    elif status_upper in {"FAILED", "CANCELLED"}:
        pay.completed_at = _now_utc()


def handle_daraja_callback(
    db: Session,
    *,
    payload: dict[str, Any],
    callback_token: str | None = None,
) -> dict[str, Any]:
    required_token = str(settings.DARAJA_CALLBACK_TOKEN or "").strip()
    if required_token and required_token != str(callback_token or "").strip():
        raise PermissionError("Invalid callback token")

    body = payload.get("Body") if isinstance(payload.get("Body"), dict) else {}
    stk = body.get("stkCallback") if isinstance(body.get("stkCallback"), dict) else {}

    checkout_request_id = str(stk.get("CheckoutRequestID") or "").strip()
    if not checkout_request_id:
        raise ValueError("Callback payload missing CheckoutRequestID")

    merchant_request_id = str(stk.get("MerchantRequestID") or "").strip() or None
    result_code_raw = stk.get("ResultCode")
    result_desc = str(stk.get("ResultDesc") or "").strip() or None
    try:
        result_code = int(result_code_raw) if result_code_raw is not None else None
    except Exception:
        result_code = None

    try:
        pay = db.execute(
            select(SubscriptionPayment).where(
                SubscriptionPayment.checkout_request_id == checkout_request_id
            )
        ).scalar_one_or_none()
    except (ProgrammingError, OperationalError, InternalError) as err:
        db.rollback()
        _raise_if_storage_missing(err)
        raise

    if pay is None:
        # Keep callback endpoint idempotent and safely acknowledge unknown callbacks.
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

    if merchant_request_id and not pay.merchant_request_id:
        pay.merchant_request_id = merchant_request_id

    status_api = _status_from_result_code(result_code)
    callback_items = _extract_callback_item_map(payload)
    amount_raw = callback_items.get("Amount")
    amount_kes: Decimal | None = None
    if amount_raw is not None:
        try:
            amount_kes = _to_amount_decimal(amount_raw)
        except Exception:
            amount_kes = None

    phone_number = str(callback_items.get("PhoneNumber") or "").strip() or None
    if phone_number:
        try:
            phone_number = _normalize_phone(phone_number)
        except Exception:
            phone_number = None

    paid_at = _parse_transaction_datetime(callback_items.get("TransactionDate"))
    mpesa_receipt = str(callback_items.get("MpesaReceiptNumber") or "").strip() or None

    _apply_payment_status_update(
        db,
        pay=pay,
        status_api=status_api,
        result_code=result_code,
        result_desc=result_desc,
        callback_payload=payload,
        mpesa_receipt=mpesa_receipt,
        paid_at=paid_at,
        phone_number=phone_number,
        amount_kes=amount_kes,
    )

    log_event(
        db,
        tenant_id=pay.tenant_id,
        actor_user_id=None,
        action=(
            "subscription.payment.completed"
            if status_api == "completed"
            else "subscription.payment.failed"
        ),
        resource="subscription_payment",
        resource_id=pay.id,
        payload={
            "checkout_request_id": checkout_request_id,
            "merchant_request_id": merchant_request_id,
            "result_code": result_code,
            "result_desc": result_desc,
            "mpesa_receipt": mpesa_receipt,
        },
        meta=None,
    )

    return {"ResultCode": 0, "ResultDesc": "Accepted"}


def get_tenant_subscription_payment_status(
    db: Session,
    *,
    tenant_id: UUID,
    checkout_request_id: str,
) -> dict:
    checkout_id = str(checkout_request_id or "").strip()
    if not checkout_id:
        raise ValueError("checkout_request_id is required")

    try:
        pay = db.execute(
            select(SubscriptionPayment).where(
                SubscriptionPayment.tenant_id == tenant_id,
                SubscriptionPayment.checkout_request_id == checkout_id,
            )
        ).scalar_one_or_none()
    except (ProgrammingError, OperationalError, InternalError) as err:
        db.rollback()
        _raise_if_storage_missing(err)
        raise

    if pay is None:
        raise ValueError("Payment checkout request not found for this tenant")

    req_payload = pay.request_payload or {}
    is_mock_fallback = bool(req_payload.get("mock_fallback"))
    if is_mock_fallback:
        _apply_payment_status_update(
            db,
            pay=pay,
            status_api="completed",
            result_code=0,
            result_desc=(
                "Sandbox mock fallback completed due to Daraja upstream unavailability"
            ),
            callback_payload={"mock_fallback": True, "checkout_request_id": checkout_id},
            mpesa_receipt=f"MOCK{uuid4().hex[:8].upper()}",
            paid_at=_now_utc(),
        )
        log_event(
            db,
            tenant_id=pay.tenant_id,
            actor_user_id=None,
            action="subscription.payment.completed",
            resource="subscription_payment",
            resource_id=pay.id,
            payload={"checkout_request_id": checkout_id, "result_code": 0},
            meta={"mock_fallback": True},
        )
        return {
            "checkout_request_id": checkout_id,
            "status": "completed",
            "mpesa_receipt": pay.mpesa_receipt,
            "result_code": pay.result_code,
            "result_desc": pay.result_desc,
        }

    if str(pay.status or "").upper() in FINAL_PAYMENT_STATUSES:
        return {
            "checkout_request_id": checkout_id,
            "status": _status_upper_to_api(pay.status),
            "mpesa_receipt": pay.mpesa_receipt,
            "result_code": pay.result_code,
            "result_desc": pay.result_desc,
        }

    if settings.DARAJA_USE_MOCK:
        _apply_payment_status_update(
            db,
            pay=pay,
            status_api="completed",
            result_code=0,
            result_desc="Mock payment completed",
            callback_payload={"mock": True, "checkout_request_id": checkout_id},
            mpesa_receipt=f"MOCK{uuid4().hex[:8].upper()}",
            paid_at=_now_utc(),
        )
        log_event(
            db,
            tenant_id=pay.tenant_id,
            actor_user_id=None,
            action="subscription.payment.completed",
            resource="subscription_payment",
            resource_id=pay.id,
            payload={"checkout_request_id": checkout_id, "result_code": 0},
            meta={"mock": True},
        )
        return {
            "checkout_request_id": checkout_id,
            "status": "completed",
            "mpesa_receipt": pay.mpesa_receipt,
            "result_code": pay.result_code,
            "result_desc": pay.result_desc,
        }

    query_res = _call_daraja_stk_query(checkout_request_id=checkout_id)
    response_code = str(query_res.get("ResponseCode") or "").strip()

    result_code: int | None = None
    result_desc: str | None = None
    status_api = "pending"

    if response_code == "0":
        raw_result_code = query_res.get("ResultCode")
        try:
            result_code = int(raw_result_code) if raw_result_code is not None else None
        except Exception:
            result_code = None
        result_desc = str(query_res.get("ResultDesc") or "").strip() or None
        status_api = _status_from_result_code(result_code)
    else:
        result_desc = (
            str(query_res.get("errorMessage") or "").strip()
            or str(query_res.get("ResponseDescription") or "").strip()
            or "STK query failed"
        )

    _apply_payment_status_update(
        db,
        pay=pay,
        status_api=status_api,
        result_code=result_code,
        result_desc=result_desc,
        callback_payload=query_res,
    )

    if status_api in {"completed", "failed"}:
        log_event(
            db,
            tenant_id=pay.tenant_id,
            actor_user_id=None,
            action=f"subscription.payment.{status_api}",
            resource="subscription_payment",
            resource_id=pay.id,
            payload={
                "checkout_request_id": checkout_id,
                "result_code": result_code,
                "result_desc": result_desc,
            },
            meta={"source": "stk_query"},
        )

    return {
        "checkout_request_id": checkout_id,
        "status": _status_upper_to_api(pay.status),
        "mpesa_receipt": pay.mpesa_receipt,
        "result_code": pay.result_code,
        "result_desc": pay.result_desc,
    }
