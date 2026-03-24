"""Enterprise receipt PDF generator with QR code verification.

Supports two paper formats:
  - A4 (210×297 mm) — full letterhead with school logo area, header, footer, signatory
  - THERMAL_80MM (80 mm wide, variable height) — compact thermal receipt format

Each receipt embeds a signed JWT QR code that links to the tenant-scoped public
verification URL so that any reader can confirm authenticity without logging in.
"""
from __future__ import annotations

import io
import os
import textwrap
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from jose import jwt

# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

_ALGO = "HS256"
_RECEIPT_TOKEN_TYPE = "receipt_verify"


def _jwt_secret() -> str:
    from app.core.config import settings  # lazy import avoids circular deps

    return settings.JWT_SECRET


def create_receipt_verify_token(
    *,
    payment_id: str,
    tenant_id: str,
    tenant_slug: str,
    receipt_no: str,
    amount: str,
    student_name: str,
) -> str:
    """Return a signed JWT that encodes enough receipt metadata for verification.

    The token has no expiry — receipts must remain verifiable indefinitely.
    Verification simply checks the signature and that `tenant_id` matches the
    requesting tenant's ID (for tenant-scoped public verification) or trusts
    the SUPER_ADMIN role for cross-tenant verification.
    """
    payload: dict[str, Any] = {
        "type": _RECEIPT_TOKEN_TYPE,
        "tenant_id": tenant_id,
        "tenant_slug": tenant_slug,
        "payment_id": payment_id,
        "receipt_no": receipt_no,
        "amount": amount,
        "student_name": student_name,
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=_ALGO)


def decode_receipt_verify_token(token: str) -> dict[str, Any]:
    """Decode and validate a receipt verification token.

    Raises `jose.JWTError` on invalid signature / malformed token.
    Does NOT check tenant scope here — callers must do that themselves.
    """
    data = jwt.decode(token, _jwt_secret(), algorithms=[_ALGO])
    if data.get("type") != _RECEIPT_TOKEN_TYPE:
        raise ValueError("Not a receipt verification token")
    return data


def build_verify_url(*, tenant_slug: str, token: str) -> str:
    """Return the public receipt verification URL for a tenant."""
    base = os.environ.get("FRONTEND_BASE_URL", "https://shulehq.co.ke")
    # Tenant-scoped: {slug}.shulehq.co.ke/verify/receipt?token=...
    # We build the URL from the slug; the frontend handles subdomain routing.
    return f"{base}/verify/receipt?token={token}&slug={tenant_slug}"


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

_KES_SYMBOL = "KES"


def _fmt_currency(amount: str | None, currency: str = "KES") -> str:
    if not amount:
        return f"{currency} 0.00"
    try:
        val = Decimal(str(amount))
        return f"{currency} {val:,.2f}"
    except Exception:
        return f"{currency} {amount}"


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%d %B %Y")


def _ts_str(iso: str | None) -> str:
    if not iso:
        return _today_str()
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%d %B %Y  %H:%M UTC")
    except Exception:
        return iso


# ---------------------------------------------------------------------------
# QR code image helper
# ---------------------------------------------------------------------------

def _make_qr_image(data: str, box_size: int = 4) -> bytes:
    """Return a PNG bytes for the given QR data."""
    import qrcode  # type: ignore
    from qrcode.image.pil import PilImage  # type: ignore

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=2,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img: PilImage = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# A4 receipt (ReportLab)
# ---------------------------------------------------------------------------

def _generate_a4_receipt(doc: dict[str, Any], verify_url: str) -> bytes:
    """Generate a full-page A4 receipt using ReportLab."""
    from reportlab.lib.pagesizes import A4  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors  # type: ignore
    from reportlab.platypus import (  # type: ignore
        SimpleDocTemplate,
        Paragraph,
        Spacer,
        Table,
        TableStyle,
        HRFlowable,
        Image as RLImage,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT  # type: ignore

    profile = doc.get("profile") or {}
    currency = str(doc.get("currency") or profile.get("currency") or "KES")

    # ── Styles ────────────────────────────────────────────────────────────
    styles = getSampleStyleSheet()

    def _style(
        name: str,
        *,
        fontSize: int = 10,
        alignment: int = TA_LEFT,
        leading: int | None = None,
        textColor=colors.black,
        bold: bool = False,
        spaceAfter: int = 2,
    ) -> ParagraphStyle:
        return ParagraphStyle(
            name,
            parent=styles["Normal"],
            fontSize=fontSize,
            alignment=alignment,
            leading=leading or fontSize + 3,
            textColor=textColor,
            fontName="Helvetica-Bold" if bold else "Helvetica",
            spaceAfter=spaceAfter,
        )

    s_title = _style("title", fontSize=16, alignment=TA_CENTER, bold=True, spaceAfter=4)
    s_subtitle = _style("subtitle", fontSize=11, alignment=TA_CENTER, spaceAfter=2)
    s_motto = _style("motto", fontSize=9, alignment=TA_CENTER, textColor=colors.HexColor("#555555"), spaceAfter=6)
    s_section = _style("section", fontSize=9, bold=True, textColor=colors.HexColor("#1a1a1a"), spaceAfter=2)
    s_normal = _style("normal", fontSize=9, spaceAfter=2)
    s_right = _style("right", fontSize=9, alignment=TA_RIGHT, spaceAfter=2)
    s_center = _style("center", fontSize=9, alignment=TA_CENTER, spaceAfter=2)
    s_footer = _style("footer", fontSize=8, alignment=TA_CENTER, textColor=colors.HexColor("#666666"))
    s_receipt_no = _style("receiptno", fontSize=13, alignment=TA_CENTER, bold=True, spaceAfter=4)
    s_amount = _style("amount", fontSize=14, alignment=TA_CENTER, bold=True, spaceAfter=4)

    buf = io.BytesIO()
    doc_pdf = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
    )
    story = []

    page_w = A4[0] - 36 * mm  # usable width

    # ── Header ────────────────────────────────────────────────────────────
    school_name = str(profile.get("school_header") or "School")
    motto = str(profile.get("school_motto") or "")
    po_box = str(profile.get("po_box") or "")
    address = str(profile.get("physical_address") or "")
    phone = str(profile.get("phone") or "")
    email_str = str(profile.get("email") or "")

    # Logo (if available, it's a URL like /api/v1/tenants/settings/badge — skip for PDF)
    story.append(Paragraph(school_name.upper(), s_title))
    if motto:
        story.append(Paragraph(f"<i>{motto}</i>", s_motto))
    # Contact line
    contact_parts = []
    if po_box:
        contact_parts.append(f"P.O. Box {po_box}")
    if address:
        contact_parts.append(address)
    if phone:
        contact_parts.append(f"Tel: {phone}")
    if email_str:
        contact_parts.append(f"Email: {email_str}")
    if contact_parts:
        story.append(Paragraph("  |  ".join(contact_parts), s_center))

    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.black))
    story.append(Spacer(1, 2 * mm))

    # ── Receipt title ─────────────────────────────────────────────────────
    story.append(Paragraph("OFFICIAL PAYMENT RECEIPT", s_receipt_no))
    receipt_no = str(doc.get("document_no") or "")
    story.append(Paragraph(f"Receipt No: <b>{receipt_no}</b>", s_subtitle))
    story.append(Spacer(1, 3 * mm))

    # ── Meta table (Date / Provider / Reference) ─────────────────────────
    received_at = _ts_str(doc.get("received_at"))
    provider = str(doc.get("provider") or "").upper()
    reference = str(doc.get("reference") or "—")

    meta_data = [
        ["Date:", received_at, "Provider:", provider],
        ["Reference:", reference, "", ""],
    ]
    meta_table = Table(meta_data, colWidths=[28 * mm, None, 28 * mm, None])
    meta_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.append(meta_table)
    story.append(Spacer(1, 4 * mm))

    # ── Allocations table ─────────────────────────────────────────────────
    story.append(Paragraph("PAYMENT ALLOCATIONS", s_section))
    story.append(Spacer(1, 1 * mm))

    alloc_header = ["#", "Student", "Invoice No.", "Amount"]
    alloc_rows = []
    for idx, alloc in enumerate(doc.get("allocations") or [], start=1):
        if not isinstance(alloc, dict):
            continue
        alloc_rows.append(
            [
                str(idx),
                str(alloc.get("student_name") or "—"),
                str(alloc.get("invoice_no") or alloc.get("invoice_id") or "—"),
                _fmt_currency(alloc.get("amount"), currency),
            ]
        )
    if not alloc_rows:
        alloc_rows = [["—", "—", "—", "—"]]

    alloc_table_data = [alloc_header] + alloc_rows
    alloc_col_widths = [10 * mm, None, 40 * mm, 35 * mm]
    alloc_table = Table(alloc_table_data, colWidths=alloc_col_widths)
    alloc_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a1a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("ALIGN", (3, 0), (3, -1), "RIGHT"),
            ]
        )
    )
    story.append(alloc_table)
    story.append(Spacer(1, 3 * mm))

    # ── Total amount ──────────────────────────────────────────────────────
    total_str = _fmt_currency(doc.get("amount"), currency)
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.black))
    story.append(Spacer(1, 1 * mm))
    story.append(Paragraph(f"Total Amount Received: <b>{total_str}</b>", s_amount))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.black))
    story.append(Spacer(1, 6 * mm))

    # ── QR Code + Signatory (side by side) ───────────────────────────────
    qr_png = _make_qr_image(verify_url, box_size=3)
    qr_img = RLImage(io.BytesIO(qr_png), width=28 * mm, height=28 * mm)

    sig_name = str(profile.get("authorized_signatory_name") or "")
    sig_title = str(profile.get("authorized_signatory_title") or "Authorized Signatory")

    sig_lines = []
    sig_lines.append(Paragraph("________________________", s_normal))
    if sig_name:
        sig_lines.append(Paragraph(f"<b>{sig_name}</b>", s_normal))
    sig_lines.append(Paragraph(sig_title, s_normal))
    sig_lines.append(Spacer(1, 2 * mm))
    sig_lines.append(Paragraph("<font size=7>Scan QR to verify authenticity</font>", s_footer))

    # Combine into a two-column table
    sig_col = sig_lines
    qr_col = [qr_img]

    bottom_table = Table(
        [[sig_col, qr_col]],
        colWidths=[page_w - 35 * mm, 35 * mm],
    )
    bottom_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ]
        )
    )
    story.append(bottom_table)
    story.append(Spacer(1, 4 * mm))

    # ── Footer ─────────────────────────────────────────────────────────────
    footer_text = str(profile.get("receipt_footer") or "Thank you for your payment.")
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#999999")))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(footer_text, s_footer))
    story.append(Paragraph(f"Generated: {_today_str()} | Verification: {verify_url}", s_footer))

    doc_pdf.build(story)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Thermal 80mm receipt (ReportLab)
# ---------------------------------------------------------------------------

def _generate_thermal_receipt(doc: dict[str, Any], verify_url: str) -> bytes:
    """Generate an 80 mm thermal receipt using ReportLab."""
    from reportlab.lib.pagesizes import portrait  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors  # type: ignore
    from reportlab.platypus import (  # type: ignore
        SimpleDocTemplate,
        Paragraph,
        Spacer,
        HRFlowable,
        Image as RLImage,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.lib.enums import TA_CENTER, TA_LEFT  # type: ignore

    profile = doc.get("profile") or {}
    currency = str(doc.get("currency") or profile.get("currency") or "KES")

    # 80 mm wide, height will be calculated; use generous height for content
    PAGE_W = 80 * mm
    PAGE_H = 250 * mm  # ample — ReportLab clips unused
    MARGIN = 4 * mm

    styles = getSampleStyleSheet()

    def _s(name: str, *, size: int = 8, bold: bool = False, center: bool = False) -> ParagraphStyle:
        return ParagraphStyle(
            name,
            parent=styles["Normal"],
            fontSize=size,
            leading=size + 2,
            alignment=TA_CENTER if center else TA_LEFT,
            fontName="Helvetica-Bold" if bold else "Helvetica",
            spaceAfter=1,
        )

    s_title = _s("title", size=10, bold=True, center=True)
    s_center = _s("center", center=True)
    s_normal = _s("normal")
    s_bold = _s("bold", bold=True)
    s_small = _s("small", size=7)
    s_small_c = _s("smallc", size=7, center=True)
    s_amount = _s("amount", size=11, bold=True, center=True)

    buf = io.BytesIO()
    doc_pdf = SimpleDocTemplate(
        buf,
        pagesize=portrait((PAGE_W, PAGE_H)),
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
    )

    story = []

    school_name = str(profile.get("school_header") or "School")
    motto = str(profile.get("school_motto") or "")
    phone = str(profile.get("phone") or "")
    po_box = str(profile.get("po_box") or "")

    story.append(Paragraph(school_name.upper(), s_title))
    if motto:
        story.append(Paragraph(f"<i>{motto}</i>", s_center))
    if po_box:
        story.append(Paragraph(f"P.O. Box {po_box}", s_center))
    if phone:
        story.append(Paragraph(f"Tel: {phone}", s_center))

    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.black))
    story.append(Paragraph("PAYMENT RECEIPT", _s("rec_title", size=9, bold=True, center=True)))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.black))
    story.append(Spacer(1, 1 * mm))

    receipt_no = str(doc.get("document_no") or "")
    story.append(Paragraph(f"Receipt No: <b>{receipt_no}</b>", s_bold))

    received_at = _ts_str(doc.get("received_at"))
    story.append(Paragraph(f"Date: {received_at}", s_normal))

    provider = str(doc.get("provider") or "").upper()
    reference = str(doc.get("reference") or "—")
    story.append(Paragraph(f"Via: {provider}", s_normal))
    story.append(Paragraph(f"Ref: {reference}", s_normal))
    story.append(Spacer(1, 1 * mm))
    story.append(HRFlowable(width="100%", thickness=0.3, color=colors.black))

    for alloc in doc.get("allocations") or []:
        if not isinstance(alloc, dict):
            continue
        student = str(alloc.get("student_name") or "—")
        inv_no = str(alloc.get("invoice_no") or alloc.get("invoice_id") or "—")
        amt = _fmt_currency(alloc.get("amount"), currency)
        story.append(Paragraph(student, s_bold))
        story.append(Paragraph(f"  Invoice: {inv_no}  Amount: {amt}", s_small))

    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.black))
    story.append(Paragraph(_fmt_currency(doc.get("amount"), currency), s_amount))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.black))
    story.append(Spacer(1, 2 * mm))

    # QR Code centred
    qr_size = 28 * mm
    qr_png = _make_qr_image(verify_url, box_size=3)
    qr_img = RLImage(io.BytesIO(qr_png), width=qr_size, height=qr_size)
    story.append(qr_img)
    story.append(Paragraph("Scan to verify authenticity", s_small_c))
    story.append(Spacer(1, 2 * mm))

    sig_name = str(profile.get("authorized_signatory_name") or "")
    sig_title = str(profile.get("authorized_signatory_title") or "Authorized Signatory")
    story.append(Paragraph("___________________", s_center))
    if sig_name:
        story.append(Paragraph(f"<b>{sig_name}</b>", s_center))
    story.append(Paragraph(sig_title, s_center))
    story.append(Spacer(1, 2 * mm))

    footer_text = str(profile.get("receipt_footer") or "Thank you for your payment.")
    story.append(HRFlowable(width="100%", thickness=0.3, color=colors.black))
    story.append(Paragraph(footer_text, s_small_c))

    doc_pdf.build(story)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

def generate_receipt_pdf(doc: dict[str, Any]) -> bytes:
    """Generate an enterprise receipt PDF for a RECEIPT document.

    Args:
        doc: The document dict returned by ``build_payment_receipt_document()``.
             Must include ``profile``, ``document_no``, ``amount``, ``allocations``,
             ``received_at``, ``provider``, ``reference``, and ``tenant_slug``.

    Returns:
        PDF bytes.
    """
    profile = doc.get("profile") or {}
    paper_size = str(profile.get("paper_size") or "A4").upper()
    qr_enabled = bool(profile.get("qr_enabled", True))

    # Build verify URL
    tenant_slug = str(doc.get("tenant_slug") or "")
    if qr_enabled and tenant_slug:
        token = create_receipt_verify_token(
            payment_id=str(doc.get("document_id") or ""),
            tenant_id=str(doc.get("tenant_id") or ""),
            tenant_slug=tenant_slug,
            receipt_no=str(doc.get("document_no") or ""),
            amount=str(doc.get("amount") or "0"),
            student_name=_primary_student_name(doc),
        )
        verify_url = build_verify_url(tenant_slug=tenant_slug, token=token)
    else:
        verify_url = ""

    if paper_size == "THERMAL_80MM":
        return _generate_thermal_receipt(doc, verify_url)
    return _generate_a4_receipt(doc, verify_url)


def _primary_student_name(doc: dict[str, Any]) -> str:
    """Return the first student name from allocations, or Unknown."""
    for alloc in doc.get("allocations") or []:
        if isinstance(alloc, dict):
            name = str(alloc.get("student_name") or "").strip()
            if name and name.lower() != "unknown student":
                return name
    return "Unknown"
