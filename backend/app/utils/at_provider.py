"""Africa's Talking SMS provider with mock fallback for CI/dev.

Usage:
    result = send_sms(to="+254712345678", message="Hello parent!", sender_id="ShuleHQ")
    # Returns: {"messageId": "...", "status": "Success", "cost": "KES 1.5000", "number": "+254712345678"}

    In CI (AT_USE_MOCK=true) returns a deterministic mock response without
    any network calls.
"""
from __future__ import annotations

import json
import logging
import time
from decimal import Decimal
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

from app.core.config import settings

logger = logging.getLogger(__name__)

_AT_BASE_LIVE = "https://api.africastalking.com/version1"
_AT_BASE_SANDBOX = "https://api.sandbox.africastalking.com/version1"


def _at_base_url() -> str:
    return _AT_BASE_SANDBOX if bool(settings.AT_SANDBOX) else _AT_BASE_LIVE


def _at_headers() -> dict[str, str]:
    return {
        "apiKey": str(settings.AT_API_KEY or ""),
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
    }


def _mock_send_result(to: str) -> dict[str, Any]:
    """Deterministic mock response — no network calls."""
    return {
        "SMSMessageData": {
            "Message": "Sent to 1/1 Total Cost: KES 1.5000",
            "Recipients": [
                {
                    "statusCode": 101,
                    "number": to,
                    "status": "Success",
                    "cost": "KES 1.5000",
                    "messageId": f"mock-{uuid4().hex[:12]}",
                }
            ],
        }
    }


def _http_form_post(
    url: str,
    data: dict[str, str],
    headers: dict[str, str],
    timeout_sec: int = 15,
    max_retries: int = 1,
) -> dict[str, Any]:
    """POST application/x-www-form-urlencoded, return parsed JSON response."""
    body_bytes = urlencode(data).encode("utf-8")
    attempt = 0
    while True:
        req = Request(url=url, data=body_bytes, method="POST")
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            with urlopen(req, timeout=timeout_sec) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except HTTPError as err:
            detail = err.read().decode("utf-8", errors="ignore") or str(err)
            if err.code >= 500 and attempt < max_retries:
                time.sleep(0.5 * (2 ** attempt))
                attempt += 1
                continue
            raise RuntimeError(f"AT API error {err.code}: {detail}") from err
        except (URLError, TimeoutError) as err:
            if attempt < max_retries:
                time.sleep(0.5 * (2 ** attempt))
                attempt += 1
                continue
            raise RuntimeError(f"AT network error: {err}") from err


def _compute_units(message: str) -> int:
    """Return number of SMS segments a message occupies."""
    seg = int(settings.AT_CHARS_PER_SEGMENT or 160)
    per_seg = int(settings.AT_UNITS_PER_SEGMENT or 1)
    if not message:
        return per_seg
    return max(per_seg, ((len(message) - 1) // seg + 1) * per_seg)


def send_sms(*, to: str, message: str, sender_id: str | None = None) -> dict[str, Any]:
    """Send a single SMS via Africa's Talking.

    Returns the full AT API response dict.
    Raises RuntimeError on provider/network failure.
    """
    if bool(settings.AT_USE_MOCK):
        logger.debug("AT mock: sending to %s", to)
        return _mock_send_result(to)

    api_key = str(settings.AT_USERNAME or "").strip()
    if not api_key:
        # Graceful fallback if AT not configured (dev without mock flag)
        logger.warning("AT_USERNAME not configured — falling back to mock send")
        return _mock_send_result(to)

    sid = str(sender_id or settings.AT_SENDER_ID or "").strip() or None
    payload: dict[str, str] = {
        "username": str(settings.AT_USERNAME or ""),
        "to": to,
        "message": message,
    }
    if sid:
        payload["from"] = sid

    url = f"{_at_base_url()}/messaging"
    timeout = int(settings.AT_TIMEOUT_SEC or 15)
    response = _http_form_post(url, payload, _at_headers(), timeout_sec=timeout)

    # Extract first recipient result
    sms_data = response.get("SMSMessageData", {})
    recipients: list[dict] = sms_data.get("Recipients") or []
    if recipients:
        first = recipients[0]
        status_code = first.get("statusCode", 0)
        if status_code not in {100, 101}:  # 100=Sent, 101=Success on AT sandbox
            error_msg = first.get("status", "Unknown AT error")
            raise RuntimeError(f"AT rejected message: {error_msg}")

    return response


def extract_at_message_id(response: dict[str, Any]) -> str | None:
    """Pull the messageId from an AT send response."""
    recipients = (response.get("SMSMessageData") or {}).get("Recipients") or []
    if recipients:
        return str(recipients[0].get("messageId") or "").strip() or None
    return None


def extract_at_status(response: dict[str, Any]) -> str:
    """Pull the status string from an AT send response."""
    recipients = (response.get("SMSMessageData") or {}).get("Recipients") or []
    if recipients:
        raw = str(recipients[0].get("status") or "").strip()
        if raw in {"Success", "Sent"}:
            return "SENT"
        if raw:
            return "FAILED"
    return "FAILED"


def compute_units_for_message(message: str) -> int:
    return _compute_units(message)
