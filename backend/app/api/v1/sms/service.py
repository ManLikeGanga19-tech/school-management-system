"""SMS communications service layer (Phase 5).

Business logic for:
  - SaaS admin: pricing management, all-tenant balance view
  - Tenant director/secretary: credit balance, top-up via M-Pesa, send, broadcast, templates
"""
from __future__ import annotations

import base64
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import UUID, uuid4

from sqlalchemy import select, text as sa_text, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import InternalError, OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.core.audit import log_event
from app.core.config import settings
from app.models.sms import SmsCreditAccount, SmsCreditTopup, SmsMessage, SmsPricing, SmsTemplate
from app.utils.at_provider import (
    compute_units_for_message,
    extract_at_message_id,
    extract_at_status,
    send_sms,
)

logger = logging.getLogger(__name__)

TOPUP_FINAL_STATUSES = {"COMPLETED", "FAILED", "CANCELLED"}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_phone(phone_number: str) -> str:
    """Normalise to 254XXXXXXXXX format (Kenyan)."""
    digits = "".join(ch for ch in str(phone_number or "") if ch.isdigit())
    if digits.startswith("254") and len(digits) == 12:
        return digits
    if digits.startswith("0") and len(digits) == 10:
        return "254" + digits[1:]
    raise ValueError(
        "phone_number must be a valid Kenyan number (07XX / 01XX / 254XXXXXXXXX)"
    )


def _to_e164(phone: str) -> str:
    """Convert 254XXXXXXXXX → +254XXXXXXXXX for AT API."""
    normalized = _normalize_phone(phone)
    return f"+{normalized}"


def _get_or_create_credit_account(db: Session, *, tenant_id: UUID) -> SmsCreditAccount:
    """Get existing credit account or create one with 0 balance."""
    acct = db.execute(
        select(SmsCreditAccount).where(SmsCreditAccount.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if acct is None:
        acct = SmsCreditAccount(tenant_id=tenant_id, balance_units=0)
        db.add(acct)
        db.flush()
    return acct


def _get_current_price(db: Session) -> SmsPricing:
    """Return the current pricing row (most recently updated)."""
    row = db.execute(
        select(SmsPricing).order_by(SmsPricing.updated_at.desc())
    ).scalar_one_or_none()
    if row is None:
        # Seed a default if missing (safe fallback)
        row = SmsPricing(price_per_unit_kes=Decimal("1.50"))
        db.add(row)
        db.flush()
    return row


# ── Daraja helpers (reuse pattern from payments service) ──────────────────────

def _normalize_env(value: str | None) -> str:
    raw = str(value or "sandbox").strip().lower()
    return raw if raw in {"sandbox", "production"} else "sandbox"


_DARAJA_BASE = {
    "sandbox": "https://sandbox.safaricom.co.ke",
    "production": "https://api.safaricom.co.ke",
}


def _daraja_base_url() -> str:
    return _DARAJA_BASE[_normalize_env(settings.DARAJA_ENV)]


def _allow_mock() -> bool:
    if bool(settings.DARAJA_USE_MOCK):
        return True
    if _normalize_env(settings.DARAJA_ENV) != "sandbox":
        return False
    if bool(settings.DARAJA_SANDBOX_FALLBACK_TO_MOCK):
        return True
    return str(settings.APP_ENV or "").strip().lower() in {
        "dev", "development", "local", "test", "testing"
    }


def _daraja_timestamp() -> str:
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("Africa/Nairobi"))
    except Exception:
        now = datetime.now(timezone(timedelta(hours=3)))
    return now.strftime("%Y%m%d%H%M%S")


def _daraja_password(shortcode: str, passkey: str, ts: str) -> str:
    raw = f"{shortcode}{passkey}{ts}".encode()
    return base64.b64encode(raw).decode()


def _daraja_access_token() -> str:
    creds = f"{settings.DARAJA_CONSUMER_KEY}:{settings.DARAJA_CONSUMER_SECRET}".encode()
    auth = base64.b64encode(creds).decode()
    body_bytes = None
    url = f"{_daraja_base_url()}/oauth/v1/generate?grant_type=client_credentials"
    req = Request(url=url, method="GET")
    req.add_header("Authorization", f"Basic {auth}")
    timeout = int(settings.DARAJA_TIMEOUT_SEC or 30)
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
    except Exception as exc:
        raise RuntimeError(f"Daraja OAuth failed: {exc}") from exc
    token = str(data.get("access_token") or "").strip()
    if not token:
        raise RuntimeError("Daraja access token response missing access_token")
    return token


def _call_stk_push(*, phone_number: str, amount: Decimal, reference: str, description: str) -> dict[str, Any]:
    token = _daraja_access_token()
    ts = _daraja_timestamp()
    shortcode = str(settings.DARAJA_SHORTCODE).strip()
    passkey = str(settings.DARAJA_PASSKEY).strip()
    callback_base = str(settings.DARAJA_CALLBACK_BASE_URL or "").strip().rstrip("/")
    callback_token = str(settings.DARAJA_CALLBACK_TOKEN or "").strip()
    callback_url = f"{callback_base}/api/v1/payments/daraja/callback"
    if callback_token:
        callback_url += f"?token={callback_token}"

    rounded = int(amount.quantize(Decimal("1")))
    body = {
        "BusinessShortCode": shortcode,
        "Password": _daraja_password(shortcode, passkey, ts),
        "Timestamp": ts,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": rounded,
        "PartyA": phone_number,
        "PartyB": shortcode,
        "PhoneNumber": phone_number,
        "CallBackURL": callback_url,
        "AccountReference": reference[:20],
        "TransactionDesc": description[:182],
    }

    req_bytes = json.dumps(body).encode()
    url = f"{_daraja_base_url()}/mpesa/stkpush/v1/processrequest"
    req = Request(url=url, data=req_bytes, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    timeout = int(settings.DARAJA_TIMEOUT_SEC or 30)
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
    except HTTPError as err:
        detail = err.read().decode(errors="ignore")
        raise RuntimeError(f"Daraja STK push failed ({err.code}): {detail}") from err
    except (URLError, TimeoutError) as err:
        raise RuntimeError(f"Daraja network error: {err}") from err

    if str(data.get("ResponseCode") or "") != "0":
        raise RuntimeError(str(data.get("ResponseDescription") or "Daraja STK push failed"))
    return data


def _mock_stk_result() -> dict[str, Any]:
    return {
        "ResponseCode": "0",
        "ResponseDescription": "Mock STK push accepted",
        "CustomerMessage": "Success. Request accepted for processing",
        "CheckoutRequestID": f"ws_CO_{uuid4().hex}",
        "MerchantRequestID": f"ws_MR_{uuid4().hex}",
    }


# ── Admin: pricing ────────────────────────────────────────────────────────────

def admin_get_pricing(db: Session) -> dict:
    row = _get_current_price(db)
    return {
        "id": str(row.id),
        "price_per_unit_kes": float(row.price_per_unit_kes),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def admin_update_pricing(
    db: Session,
    *,
    actor_user_id: UUID,
    price_per_unit_kes: Decimal,
) -> dict:
    if price_per_unit_kes <= 0:
        raise ValueError("price_per_unit_kes must be greater than 0")
    row = _get_current_price(db)
    row.price_per_unit_kes = price_per_unit_kes
    row.updated_by = actor_user_id
    row.updated_at = _now_utc()
    return {
        "id": str(row.id),
        "price_per_unit_kes": float(row.price_per_unit_kes),
        "updated_at": row.updated_at.isoformat(),
    }


def admin_list_credit_accounts(db: Session) -> list[dict]:
    rows = db.execute(
        select(SmsCreditAccount).order_by(SmsCreditAccount.balance_units.desc())
    ).scalars().all()
    return [
        {
            "tenant_id": str(r.tenant_id),
            "balance_units": r.balance_units,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


def admin_adjust_credits(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    adjustment: int,
    reason: str = "",
) -> dict:
    """Manual credit adjustment (positive = add, negative = deduct)."""
    acct = _get_or_create_credit_account(db, tenant_id=tenant_id)
    new_balance = acct.balance_units + adjustment
    if new_balance < 0:
        raise ValueError(
            f"Adjustment would result in negative balance ({new_balance})"
        )
    acct.balance_units = new_balance
    acct.updated_at = _now_utc()
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="sms.credits.admin_adjust",
        resource="sms_credit_account",
        resource_id=acct.id,
        payload={"adjustment": adjustment, "new_balance": new_balance, "reason": reason},
        meta=None,
    )
    return {"tenant_id": str(tenant_id), "balance_units": new_balance}


# ── Tenant: balance & pricing info ────────────────────────────────────────────

def get_credit_account(db: Session, *, tenant_id: UUID) -> dict:
    acct = _get_or_create_credit_account(db, tenant_id=tenant_id)
    pricing = _get_current_price(db)
    return {
        "balance_units": acct.balance_units,
        "price_per_unit_kes": float(pricing.price_per_unit_kes),
        "updated_at": acct.updated_at.isoformat() if acct.updated_at else None,
    }


# ── Tenant: top-up flow ───────────────────────────────────────────────────────

def initiate_topup(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    phone_number: str,
    units_requested: int,
) -> dict:
    if units_requested < 10:
        raise ValueError("Minimum top-up is 10 units")
    if units_requested > 50_000:
        raise ValueError("Maximum single top-up is 50,000 units")

    normalized_phone = _normalize_phone(phone_number)
    pricing = _get_current_price(db)
    price = Decimal(str(pricing.price_per_unit_kes))
    amount_kes = (price * units_requested).quantize(Decimal("0.01"))

    # Dedup: if a PENDING topup for same tenant/phone/units within 5 min, return it
    dedup_cutoff = _now_utc() - timedelta(seconds=int(settings.DARAJA_DEDUP_WINDOW_SEC or 300))
    existing = db.execute(
        select(SmsCreditTopup).where(
            SmsCreditTopup.tenant_id == tenant_id,
            SmsCreditTopup.phone_number == normalized_phone,
            SmsCreditTopup.units_requested == units_requested,
            SmsCreditTopup.status == "PENDING",
            SmsCreditTopup.created_at >= dedup_cutoff,
        ).order_by(SmsCreditTopup.created_at.desc())
    ).scalar_one_or_none()
    if existing is not None:
        return {
            "topup_id": str(existing.id),
            "checkout_request_id": existing.checkout_request_id,
            "units_requested": existing.units_requested,
            "amount_kes": float(existing.amount_kes),
            "status": "pending",
            "duplicate": True,
        }

    mock_fallback = False
    if _allow_mock() or bool(settings.DARAJA_USE_MOCK):
        daraja_res = _mock_stk_result()
        mock_fallback = True
    else:
        try:
            daraja_res = _call_stk_push(
                phone_number=normalized_phone,
                amount=amount_kes,
                reference=f"SMS-{str(tenant_id)[:8]}",
                description=f"SMS credits: {units_requested} units",
            )
        except RuntimeError as exc:
            if _allow_mock():
                daraja_res = _mock_stk_result()
                mock_fallback = True
            else:
                raise

    checkout_id = str(daraja_res.get("CheckoutRequestID") or "").strip()
    merchant_id = str(daraja_res.get("MerchantRequestID") or "").strip()
    if not checkout_id:
        checkout_id = f"mock-{uuid4().hex}"
    if not merchant_id:
        merchant_id = f"mock-{uuid4().hex}"

    topup = SmsCreditTopup(
        tenant_id=tenant_id,
        units_requested=units_requested,
        amount_kes=amount_kes,
        price_per_unit_snapshot=price,
        phone_number=normalized_phone,
        provider="MPESA_DARAJA",
        checkout_request_id=checkout_id,
        merchant_request_id=merchant_id,
        status="PENDING",
        created_by=actor_user_id,
        request_payload={
            "units_requested": units_requested,
            "amount_kes": str(amount_kes),
            "price_per_unit": str(price),
            "daraja_response": daraja_res,
            "mock_fallback": mock_fallback,
        },
    )
    db.add(topup)
    db.flush()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="sms.topup.initiate",
        resource="sms_credit_topup",
        resource_id=topup.id,
        payload={
            "units_requested": units_requested,
            "amount_kes": str(amount_kes),
            "checkout_request_id": checkout_id,
            "mock_fallback": mock_fallback,
        },
        meta=None,
    )

    return {
        "topup_id": str(topup.id),
        "checkout_request_id": checkout_id,
        "units_requested": units_requested,
        "amount_kes": float(amount_kes),
        "status": "pending",
        "duplicate": False,
    }


def get_topup_status(
    db: Session,
    *,
    tenant_id: UUID,
    checkout_request_id: str,
) -> dict:
    topup = db.execute(
        select(SmsCreditTopup).where(
            SmsCreditTopup.tenant_id == tenant_id,
            SmsCreditTopup.checkout_request_id == checkout_request_id,
        )
    ).scalar_one_or_none()
    if topup is None:
        raise ValueError("Top-up not found")

    # Auto-complete mock topups on first status poll
    req_payload = topup.request_payload or {}
    if req_payload.get("mock_fallback") and topup.status == "PENDING":
        _apply_topup_completed(db, topup=topup, mpesa_receipt=f"MOCK{uuid4().hex[:8].upper()}")

    return _topup_to_dict(topup)


def _apply_topup_completed(
    db: Session,
    *,
    topup: SmsCreditTopup,
    mpesa_receipt: str | None = None,
    result_code: int = 0,
    result_desc: str = "Completed",
    callback_payload: dict | None = None,
    paid_at: datetime | None = None,
) -> None:
    """Credit the tenant's account and mark topup COMPLETED."""
    acct = _get_or_create_credit_account(db, tenant_id=topup.tenant_id)
    # Row-level lock to prevent double-credit
    db.execute(
        sa_text("SELECT id FROM core.sms_credit_accounts WHERE id = :id FOR UPDATE"),
        {"id": str(acct.id)},
    )
    # Re-fetch after lock
    db.refresh(acct)

    acct.balance_units = acct.balance_units + topup.units_requested
    acct.updated_at = _now_utc()

    topup.status = "COMPLETED"
    topup.result_code = result_code
    topup.result_desc = result_desc
    topup.mpesa_receipt = mpesa_receipt
    topup.completed_at = paid_at or _now_utc()
    if callback_payload:
        topup.callback_payload = callback_payload

    log_event(
        db,
        tenant_id=topup.tenant_id,
        actor_user_id=None,
        action="sms.topup.completed",
        resource="sms_credit_topup",
        resource_id=topup.id,
        payload={
            "units_added": topup.units_requested,
            "new_balance": acct.balance_units,
            "mpesa_receipt": mpesa_receipt,
        },
        meta=None,
    )


def _apply_topup_failed(
    db: Session,
    *,
    topup: SmsCreditTopup,
    result_code: int | None = None,
    result_desc: str | None = None,
    callback_payload: dict | None = None,
) -> None:
    topup.status = "FAILED"
    topup.result_code = result_code
    topup.result_desc = result_desc
    topup.completed_at = _now_utc()
    if callback_payload:
        topup.callback_payload = callback_payload
    log_event(
        db,
        tenant_id=topup.tenant_id,
        actor_user_id=None,
        action="sms.topup.failed",
        resource="sms_credit_topup",
        resource_id=topup.id,
        payload={"result_code": result_code, "result_desc": result_desc},
        meta=None,
    )


def handle_topup_daraja_callback(
    db: Session,
    *,
    payload: dict[str, Any],
    callback_token: str | None = None,
) -> dict[str, Any]:
    """Handle Daraja callback for SMS top-up payments.

    Reuses the same callback endpoint as subscription payments — we
    differentiate by checking checkout_request_id against sms_credit_topups.
    """
    import hmac as _hmac

    required_token = str(settings.DARAJA_CALLBACK_TOKEN or "").strip()
    if required_token:
        provided = str(callback_token or "").strip()
        if not _hmac.compare_digest(required_token, provided):
            raise PermissionError("Invalid callback token")

    body = payload.get("Body") if isinstance(payload.get("Body"), dict) else {}
    stk = body.get("stkCallback") if isinstance(body.get("stkCallback"), dict) else {}
    checkout_id = str(stk.get("CheckoutRequestID") or "").strip()
    if not checkout_id:
        return {"ResultCode": 0, "ResultDesc": "Accepted (no CheckoutRequestID)"}

    topup = db.execute(
        select(SmsCreditTopup).where(
            SmsCreditTopup.checkout_request_id == checkout_id
        )
    ).scalar_one_or_none()

    if topup is None:
        return {"ResultCode": 0, "ResultDesc": "Accepted (not a topup)"}

    if topup.status in TOPUP_FINAL_STATUSES:
        return {"ResultCode": 0, "ResultDesc": "Accepted (already terminal)"}

    result_code_raw = stk.get("ResultCode")
    result_desc = str(stk.get("ResultDesc") or "").strip() or None
    try:
        result_code = int(result_code_raw) if result_code_raw is not None else None
    except Exception:
        result_code = None

    # Extract callback items
    meta = stk.get("CallbackMetadata") or {}
    items = meta.get("Item") or []
    item_map: dict[str, Any] = {}
    for item in (items if isinstance(items, list) else []):
        if isinstance(item, dict):
            k = str(item.get("Name") or "")
            if k:
                item_map[k] = item.get("Value")

    mpesa_receipt = str(item_map.get("MpesaReceiptNumber") or "").strip() or None

    paid_at_raw = item_map.get("TransactionDate")
    paid_at: datetime | None = None
    if paid_at_raw:
        try:
            from zoneinfo import ZoneInfo
            dt = datetime.strptime(str(paid_at_raw), "%Y%m%d%H%M%S")
            paid_at = dt.replace(tzinfo=ZoneInfo("Africa/Nairobi")).astimezone(timezone.utc)
        except Exception:
            pass

    if result_code == 0:
        _apply_topup_completed(
            db,
            topup=topup,
            mpesa_receipt=mpesa_receipt,
            result_code=result_code,
            result_desc=result_desc,
            callback_payload=payload,
            paid_at=paid_at,
        )
    else:
        _apply_topup_failed(
            db,
            topup=topup,
            result_code=result_code,
            result_desc=result_desc,
            callback_payload=payload,
        )

    return {"ResultCode": 0, "ResultDesc": "Accepted"}


def list_topup_history(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    rows = db.execute(
        select(SmsCreditTopup)
        .where(SmsCreditTopup.tenant_id == tenant_id)
        .order_by(SmsCreditTopup.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).scalars().all()
    return [_topup_to_dict(r) for r in rows]


def _topup_to_dict(topup: SmsCreditTopup) -> dict:
    return {
        "id": str(topup.id),
        "units_requested": topup.units_requested,
        "amount_kes": float(topup.amount_kes),
        "price_per_unit_kes": float(topup.price_per_unit_snapshot),
        "phone_number": topup.phone_number,
        "status": topup.status.lower(),
        "mpesa_receipt": topup.mpesa_receipt,
        "checkout_request_id": topup.checkout_request_id,
        "created_at": topup.created_at.isoformat() if topup.created_at else None,
        "completed_at": topup.completed_at.isoformat() if topup.completed_at else None,
    }


# ── Tenant: send SMS ──────────────────────────────────────────────────────────

def send_single_sms(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    to_phone: str,
    message_body: str,
    recipient_name: str | None = None,
    template_id: UUID | None = None,
    meta: dict | None = None,
) -> dict:
    """Send a single SMS and deduct credits."""
    if not message_body or not message_body.strip():
        raise ValueError("message_body cannot be empty")

    normalized = _normalize_phone(to_phone)
    units = compute_units_for_message(message_body)

    acct = _get_or_create_credit_account(db, tenant_id=tenant_id)
    # Lock for balance deduction
    db.execute(
        sa_text("SELECT id FROM core.sms_credit_accounts WHERE id = :id FOR UPDATE"),
        {"id": str(acct.id)},
    )
    db.refresh(acct)

    if acct.balance_units < units:
        raise ValueError(
            f"Insufficient SMS credits. Balance: {acct.balance_units}, required: {units}. "
            "Please top up your SMS credits."
        )

    # Deduct
    acct.balance_units -= units
    acct.updated_at = _now_utc()

    msg = SmsMessage(
        tenant_id=tenant_id,
        to_phone=normalized,
        recipient_name=recipient_name,
        message_body=message_body,
        units_deducted=units,
        status="QUEUED",
        template_id=template_id,
        meta=meta,
        created_by=actor_user_id,
    )
    db.add(msg)
    db.flush()

    # Call AT provider
    try:
        e164 = _to_e164(normalized)
        response = send_sms(to=e164, message=message_body)
        provider_id = extract_at_message_id(response)
        at_status = extract_at_status(response)
        msg.provider_message_id = provider_id
        msg.status = at_status
        msg.sent_at = _now_utc()
    except RuntimeError as exc:
        msg.status = "FAILED"
        msg.error_message = str(exc)
        logger.error("SMS send failed to %s: %s", normalized, exc)
        # Refund credits on failure
        acct.balance_units += units
        acct.updated_at = _now_utc()

    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="sms.send",
        resource="sms_message",
        resource_id=msg.id,
        payload={
            "to_phone": normalized,
            "recipient_name": recipient_name,
            "units": units,
            "status": msg.status,
        },
        meta=None,
    )

    return _message_to_dict(msg)


def broadcast_sms(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    recipients: list[dict],  # [{"phone": "...", "name": "..."}]
    message_body: str,
    template_id: UUID | None = None,
    meta: dict | None = None,
) -> dict:
    """Send SMS to multiple recipients.

    Deducts credits atomically upfront, then sends.
    Returns summary with per-recipient results.
    """
    if not message_body or not message_body.strip():
        raise ValueError("message_body cannot be empty")
    if not recipients:
        raise ValueError("recipients list cannot be empty")
    if len(recipients) > 500:
        raise ValueError("Maximum 500 recipients per broadcast")

    units_per_msg = compute_units_for_message(message_body)
    total_units = units_per_msg * len(recipients)

    # Normalise phones, deduplicate
    seen: set[str] = set()
    normalised_recipients: list[dict] = []
    for r in recipients:
        phone_raw = str(r.get("phone") or "").strip()
        name = str(r.get("name") or "").strip() or None
        try:
            norm = _normalize_phone(phone_raw)
        except ValueError:
            continue  # skip invalid phones silently
        if norm in seen:
            continue
        seen.add(norm)
        normalised_recipients.append({"phone": norm, "name": name})

    if not normalised_recipients:
        raise ValueError("No valid phone numbers in recipients list")

    total_units = units_per_msg * len(normalised_recipients)

    acct = _get_or_create_credit_account(db, tenant_id=tenant_id)
    db.execute(
        sa_text("SELECT id FROM core.sms_credit_accounts WHERE id = :id FOR UPDATE"),
        {"id": str(acct.id)},
    )
    db.refresh(acct)
    if acct.balance_units < total_units:
        raise ValueError(
            f"Insufficient credits for broadcast. Need {total_units}, have {acct.balance_units}."
        )

    acct.balance_units -= total_units
    acct.updated_at = _now_utc()

    results: list[dict] = []
    units_refund = 0

    for r in normalised_recipients:
        phone = r["phone"]
        name = r["name"]
        msg = SmsMessage(
            tenant_id=tenant_id,
            to_phone=phone,
            recipient_name=name,
            message_body=message_body,
            units_deducted=units_per_msg,
            status="QUEUED",
            template_id=template_id,
            meta=meta,
            created_by=actor_user_id,
        )
        db.add(msg)
        db.flush()

        try:
            e164 = _to_e164(phone)
            response = send_sms(to=e164, message=message_body)
            provider_id = extract_at_message_id(response)
            at_status = extract_at_status(response)
            msg.provider_message_id = provider_id
            msg.status = at_status
            msg.sent_at = _now_utc()
            results.append({"phone": phone, "name": name, "status": at_status,
                            "message_id": str(msg.id)})
        except RuntimeError as exc:
            msg.status = "FAILED"
            msg.error_message = str(exc)
            units_refund += units_per_msg
            results.append({"phone": phone, "name": name, "status": "FAILED",
                            "error": str(exc), "message_id": str(msg.id)})

    # Refund for failed sends
    if units_refund > 0:
        acct.balance_units += units_refund
        acct.updated_at = _now_utc()

    sent_count = sum(1 for r in results if r["status"] == "SENT")
    log_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        action="sms.broadcast",
        resource="sms_message",
        resource_id=None,
        payload={
            "total": len(normalised_recipients),
            "sent": sent_count,
            "failed": len(normalised_recipients) - sent_count,
            "units_deducted": total_units - units_refund,
        },
        meta=None,
    )

    return {
        "total": len(normalised_recipients),
        "sent": sent_count,
        "failed": len(normalised_recipients) - sent_count,
        "units_deducted": total_units - units_refund,
        "results": results,
    }


def list_messages(
    db: Session,
    *,
    tenant_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    rows = db.execute(
        select(SmsMessage)
        .where(SmsMessage.tenant_id == tenant_id)
        .order_by(SmsMessage.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).scalars().all()
    return [_message_to_dict(r) for r in rows]


def _message_to_dict(msg: SmsMessage) -> dict:
    return {
        "id": str(msg.id),
        "to_phone": msg.to_phone,
        "recipient_name": msg.recipient_name,
        "message_body": msg.message_body,
        "units_deducted": msg.units_deducted,
        "status": msg.status,
        "provider_message_id": msg.provider_message_id,
        "error_message": msg.error_message,
        "template_id": str(msg.template_id) if msg.template_id else None,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
        "sent_at": msg.sent_at.isoformat() if msg.sent_at else None,
        "delivered_at": msg.delivered_at.isoformat() if msg.delivered_at else None,
    }


# ── Tenant: templates ─────────────────────────────────────────────────────────

def list_templates(db: Session, *, tenant_id: UUID) -> list[dict]:
    rows = db.execute(
        select(SmsTemplate)
        .where(SmsTemplate.tenant_id == tenant_id)
        .order_by(SmsTemplate.name)
    ).scalars().all()
    return [_template_to_dict(r) for r in rows]


def create_template(
    db: Session,
    *,
    tenant_id: UUID,
    actor_user_id: UUID,
    name: str,
    body: str,
    variables: list[str] | None = None,
) -> dict:
    name = name.strip()
    body = body.strip()
    if not name:
        raise ValueError("Template name cannot be empty")
    if not body:
        raise ValueError("Template body cannot be empty")

    existing = db.execute(
        select(SmsTemplate).where(
            SmsTemplate.tenant_id == tenant_id,
            SmsTemplate.name == name,
        )
    ).scalar_one_or_none()
    if existing:
        raise ValueError(f"A template named '{name}' already exists")

    tmpl = SmsTemplate(
        tenant_id=tenant_id,
        name=name,
        body=body,
        variables=variables or [],
        created_by=actor_user_id,
    )
    db.add(tmpl)
    db.flush()
    return _template_to_dict(tmpl)


def update_template(
    db: Session,
    *,
    tenant_id: UUID,
    template_id: UUID,
    name: str | None = None,
    body: str | None = None,
    variables: list[str] | None = None,
) -> dict:
    tmpl = db.execute(
        select(SmsTemplate).where(
            SmsTemplate.id == template_id,
            SmsTemplate.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if tmpl is None:
        raise ValueError("Template not found")

    if name is not None:
        name = name.strip()
        if not name:
            raise ValueError("Template name cannot be empty")
        # Check uniqueness (exclude self)
        conflict = db.execute(
            select(SmsTemplate).where(
                SmsTemplate.tenant_id == tenant_id,
                SmsTemplate.name == name,
                SmsTemplate.id != template_id,
            )
        ).scalar_one_or_none()
        if conflict:
            raise ValueError(f"A template named '{name}' already exists")
        tmpl.name = name

    if body is not None:
        body = body.strip()
        if not body:
            raise ValueError("Template body cannot be empty")
        tmpl.body = body

    if variables is not None:
        tmpl.variables = variables

    from datetime import datetime, timezone
    tmpl.updated_at = _now_utc()
    return _template_to_dict(tmpl)


def delete_template(db: Session, *, tenant_id: UUID, template_id: UUID) -> None:
    tmpl = db.execute(
        select(SmsTemplate).where(
            SmsTemplate.id == template_id,
            SmsTemplate.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if tmpl is None:
        raise ValueError("Template not found")
    db.delete(tmpl)


def _template_to_dict(tmpl: SmsTemplate) -> dict:
    return {
        "id": str(tmpl.id),
        "name": tmpl.name,
        "body": tmpl.body,
        "variables": tmpl.variables or [],
        "created_at": tmpl.created_at.isoformat() if tmpl.created_at else None,
        "updated_at": tmpl.updated_at.isoformat() if tmpl.updated_at else None,
    }
