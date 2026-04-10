"""Enterprise receipt PDF generator — A4 and Thermal 80mm.

A4 layout
---------
  Top-left: school address block   |  Top-right: QR code (replaces logo)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  (solid black rule)
                School Payment Receipt
  Receipt No / Date
  Paid By: student name
  Payment Details table  (fee description | amount | date paid)
  Total Payment
  Acknowledgment paragraph
  Thank you + signatory

Thermal 80mm layout  (Courier monospace, B&W)
---------------------------------------------
         SCHOOL NAME
       address / phone
  ----------------------------------------
  date / time
  ----------------------------------------
  STUDENT: [name]   RECEIPT#: [no]
  INVOICE: [inv_no] DATE: [date]
  ----------------------------------------
  Fee Description          KES 3,000.00
  ...
  ----------------------------------------
  SUBTOTAL:            KES 3,000.00
  TOTAL:               KES 3,000.00
  ----------------------------------------
  PAYMENT METHOD:  MPESA
  REFERENCE:       QF12345
  ----------------------------------------
   Footer message. Thank you.
  ----------------------------------------
          [  QR CODE  ]
         RCT-2025-000001
"""
from __future__ import annotations

import io
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from jose import jwt

# ─── Token helpers ────────────────────────────────────────────────────────────

_ALGO = "HS256"
_RECEIPT_TOKEN_TYPE = "receipt_verify"


def _jwt_secret() -> str:
    from app.core.config import settings  # lazy import — avoids circular deps
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
    data = jwt.decode(token, _jwt_secret(), algorithms=[_ALGO])
    if data.get("type") != _RECEIPT_TOKEN_TYPE:
        raise ValueError("Not a receipt verification token")
    return data


def build_verify_url(*, tenant_slug: str, token: str) -> str:
    base = os.environ.get("FRONTEND_BASE_URL", "https://shulehq.co.ke")
    return f"{base}/verify/receipt?token={token}&slug={tenant_slug}"


# ─── Formatting helpers ───────────────────────────────────────────────────────

def _fmt(amount: str | None, currency: str = "KES") -> str:
    if not amount:
        return f"{currency} 0.00"
    try:
        return f"{currency} {Decimal(str(amount)):,.2f}"
    except (InvalidOperation, Exception):
        return f"{currency} {amount}"


def _fmt_plain(amount: str | None) -> str:
    """Amount without currency prefix, for totals line."""
    if not amount:
        return "0.00"
    try:
        return f"{Decimal(str(amount)):,.2f}"
    except (InvalidOperation, Exception):
        return str(amount)


def _date_short(iso: str | None) -> str:
    if not iso:
        return datetime.now(timezone.utc).strftime("%d/%m/%Y")
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return iso


def _date_long(iso: str | None) -> str:
    if not iso:
        return datetime.now(timezone.utc).strftime("%d %B %Y")
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%d %B %Y")
    except Exception:
        return iso


def _datetime_str(iso: str | None) -> str:
    if not iso:
        return datetime.now(timezone.utc).strftime("%d/%m/%Y  %I:%M %p")
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y  %I:%M %p")
    except Exception:
        return iso


def _primary_student(doc: dict[str, Any]) -> str:
    for alloc in doc.get("allocations") or []:
        if isinstance(alloc, dict):
            name = str(alloc.get("student_name") or "").strip()
            if name and name.lower() != "unknown student":
                return name
    return "Unknown"


def _primary_invoice_no(doc: dict[str, Any]) -> str:
    for alloc in doc.get("allocations") or []:
        if isinstance(alloc, dict):
            inv = str(alloc.get("invoice_no") or "").strip()
            if inv:
                return inv
    return "—"


def _all_fee_lines(doc: dict[str, Any]) -> list[tuple[str, str]]:
    """Return [(description, amount), ...] from invoice lines across all allocations."""
    rows: list[tuple[str, str]] = []
    for alloc in doc.get("allocations") or []:
        if not isinstance(alloc, dict):
            continue
        lines = alloc.get("lines") or []
        if lines:
            for line in lines:
                if isinstance(line, dict):
                    rows.append((
                        str(line.get("description") or ""),
                        str(line.get("amount") or "0"),
                    ))
        else:
            # fallback: use the allocation itself labelled by student
            rows.append((
                f"Payment — {alloc.get('student_name') or 'Student'}",
                str(alloc.get("amount") or "0"),
            ))
    return rows


# ─── QR image ─────────────────────────────────────────────────────────────────

def _qr_png(data: str, box_size: int = 4) -> bytes:
    import qrcode  # type: ignore
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=2,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ─── A4 receipt ───────────────────────────────────────────────────────────────

def _generate_a4_receipt(doc: dict[str, Any], verify_url: str) -> bytes:
    from reportlab.lib.pagesizes import A4  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors  # type: ignore
    from reportlab.platypus import (  # type: ignore
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        HRFlowable, Image as RLImage,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT, TA_JUSTIFY  # type: ignore

    profile = doc.get("profile") or {}
    currency = str(doc.get("currency") or profile.get("currency") or "KES")

    styles = getSampleStyleSheet()

    def _s(
        name: str,
        size: int = 10,
        bold: bool = False,
        align: int = TA_LEFT,
        color=colors.black,
        space_after: int = 2,
        leading: int | None = None,
    ) -> ParagraphStyle:
        return ParagraphStyle(
            name,
            parent=styles["Normal"],
            fontSize=size,
            fontName="Helvetica-Bold" if bold else "Helvetica",
            alignment=align,
            textColor=color,
            spaceAfter=space_after,
            leading=leading or size + 3,
        )

    buf = io.BytesIO()
    page_w, page_h = A4
    lm = rm = 10 * mm
    usable_w = page_w - lm - rm

    doc_pdf = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=8 * mm, bottomMargin=10 * mm,
        leftMargin=lm, rightMargin=rm,
    )

    story = []

    # ── Header: address block (left) + QR (right) ──────────────────────────
    school_name = str(profile.get("school_header") or "School")
    po_box      = str(profile.get("po_box") or "")
    address     = str(profile.get("physical_address") or "")
    phone       = str(profile.get("phone") or "")
    email_str   = str(profile.get("email") or "")
    motto       = str(profile.get("school_motto") or "")

    addr_lines = []
    if po_box:
        addr_lines.append(f"P.O. Box {po_box}")
    if address:
        addr_lines.append(address)
    if email_str:
        addr_lines.append(email_str)
    if phone:
        addr_lines.append(phone)

    addr_text = "<br/>".join(addr_lines) if addr_lines else school_name
    addr_para = Paragraph(addr_text, _s("addr", size=8, space_after=0))

    qr_size = 30 * mm
    if verify_url:
        qr_img = RLImage(io.BytesIO(_qr_png(verify_url, box_size=3)), width=qr_size, height=qr_size)
    else:
        qr_img = Spacer(qr_size, qr_size)

    header_table = Table(
        [[addr_para, qr_img]],
        colWidths=[usable_w - qr_size - 4 * mm, qr_size + 4 * mm],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN",  (1, 0), (1, 0),  "RIGHT"),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 3 * mm))

    # ── Solid black rule ───────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=2, color=colors.black))
    story.append(Spacer(1, 6 * mm))

    # ── Title ──────────────────────────────────────────────────────────────
    story.append(Paragraph("School Payment Receipt", _s("title", size=18, bold=True, align=TA_CENTER, space_after=10)))

    # ── Receipt No / Date ──────────────────────────────────────────────────
    receipt_no   = str(doc.get("document_no") or "")
    received_at  = _date_long(doc.get("received_at"))
    story.append(Paragraph(f"<b>Receipt No:</b> {receipt_no}", _s("rno", size=10, space_after=3)))
    story.append(Paragraph(f"<b>Date:</b> {received_at}", _s("rdate", size=10, space_after=8)))
    story.append(Spacer(1, 2 * mm))

    # ── Paid By ────────────────────────────────────────────────────────────
    student_name = _primary_student(doc)
    story.append(Paragraph("<b>Paid By:</b>", _s("pb_label", size=10, space_after=2)))
    story.append(Paragraph(f"<b>{student_name}</b>", _s("pb_name", size=10, space_after=1)))
    story.append(Spacer(1, 6 * mm))

    # ── Payment Details ────────────────────────────────────────────────────
    story.append(Paragraph("<b>Payment Details</b>", _s("pd_label", size=11, space_after=4)))

    fee_lines = _all_fee_lines(doc)
    tbl_data = [["Description", "Amount", "Date Paid"]]
    for desc, amt in fee_lines:
        tbl_data.append([desc, _fmt(amt, currency), _date_long(doc.get("received_at"))])
    if not fee_lines:
        tbl_data.append(["—", "—", "—"])

    col_w = [usable_w * 0.5, usable_w * 0.25, usable_w * 0.25]
    tbl = Table(tbl_data, colWidths=col_w)
    tbl.setStyle(TableStyle([
        # Header row
        ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.HexColor("#444444")),
        ("FONTNAME",    (0, 0), (-1, 0), "Helvetica"),
        ("FONTSIZE",    (0, 0), (-1, -1), 9),
        ("ALIGN",       (0, 0), (-1, 0), "CENTER"),
        # Data rows
        ("FONTNAME",    (0, 1), (-1, -1), "Helvetica"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
        ("GRID",        (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("TOPPADDING",  (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ALIGN",       (1, 1), (1, -1), "RIGHT"),
        ("ALIGN",       (2, 1), (2, -1), "CENTER"),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 6 * mm))

    # ── Total ──────────────────────────────────────────────────────────────
    total_str = f"{currency} {_fmt_plain(doc.get('amount'))}"
    story.append(Paragraph(
        f"<b>Total Payment: {total_str}</b>",
        _s("total", size=14, bold=True, space_after=10),
    ))
    story.append(Spacer(1, 4 * mm))

    # ── Acknowledgment paragraph ───────────────────────────────────────────
    contact_parts = []
    if email_str:
        contact_parts.append(f"email at <b>{email_str}</b>")
    if phone:
        contact_parts.append(f"call us at <b>{phone}</b>")
    contact_str = " or ".join(contact_parts) if contact_parts else "contact the school office"

    ack_text = (
        f"This receipt acknowledges the payment made on {received_at} for the listed services. "
        f"If you have any inquiries regarding this receipt, please {contact_str}."
    )
    story.append(Paragraph(ack_text, _s("ack", size=9, align=TA_JUSTIFY, space_after=6)))
    story.append(Spacer(1, 2 * mm))

    footer_msg = str(profile.get("receipt_footer") or "Thank you for your timely payment!")
    story.append(Paragraph(footer_msg, _s("footer_msg", size=9, space_after=8)))

    # ── Signatory ──────────────────────────────────────────────────────────
    sig_name  = str(profile.get("authorized_signatory_name") or "")
    sig_title = str(profile.get("authorized_signatory_title") or "Authorized Signatory")
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("________________________", _s("sig_line", size=9, space_after=1)))
    if sig_name:
        story.append(Paragraph(f"<b>{sig_name}</b>", _s("sig_name", size=9, space_after=1)))
    story.append(Paragraph(sig_title, _s("sig_title", size=9, space_after=0)))
    if motto:
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(f"<i>{motto}</i>", _s("motto", size=8, align=TA_CENTER, color=colors.HexColor("#666666"))))

    doc_pdf.build(story)
    return buf.getvalue()


# ─── Thermal 80mm receipt ─────────────────────────────────────────────────────

def _generate_thermal_receipt(doc: dict[str, Any], verify_url: str) -> bytes:
    from reportlab.lib.pagesizes import portrait  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors  # type: ignore
    from reportlab.platypus import (  # type: ignore
        SimpleDocTemplate, Paragraph, Spacer, Image as RLImage,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.lib.enums import TA_CENTER, TA_LEFT  # type: ignore

    profile  = doc.get("profile") or {}
    currency = str(doc.get("currency") or profile.get("currency") or "KES")

    PAGE_W  = 80 * mm
    PAGE_H  = 300 * mm  # generous — unused space is cut by viewer
    MARGIN  = 4 * mm
    INNER_W = PAGE_W - 2 * MARGIN

    # Width in Courier-8: chars per mm ≈ 0.48  →  inner_w/mm * 0.48 ≈ 34 chars
    DASH_WIDTH = 40  # characters

    styles = getSampleStyleSheet()

    def _s(name: str, size: int = 8, bold: bool = False, center: bool = False) -> ParagraphStyle:
        return ParagraphStyle(
            name,
            parent=styles["Normal"],
            fontSize=size,
            leading=size + 3,
            fontName="Courier-Bold" if bold else "Courier",
            alignment=TA_CENTER if center else TA_LEFT,
            spaceAfter=0,
        )

    def _sep() -> Paragraph:
        return Paragraph("-" * DASH_WIDTH, _s("sep", center=True))

    def _row(left: str, right: str, size: int = 8, bold: bool = False) -> Paragraph:
        """Fixed-width two-column row using spaces to push right value to edge."""
        total_chars = DASH_WIDTH
        left  = str(left)
        right = str(right)
        gap   = max(1, total_chars - len(left) - len(right))
        line  = left + " " * gap + right
        return Paragraph(line, _s(f"row_{left[:6]}", size=size, bold=bold))

    buf = io.BytesIO()
    doc_pdf = SimpleDocTemplate(
        buf,
        pagesize=portrait((PAGE_W, PAGE_H)),
        topMargin=MARGIN, bottomMargin=MARGIN,
        leftMargin=MARGIN, rightMargin=MARGIN,
    )

    story = []

    # ── School header ──────────────────────────────────────────────────────
    school_name = str(profile.get("school_header") or "SCHOOL").upper()
    story.append(Paragraph(school_name, _s("sname", size=10, bold=True, center=True)))

    po_box  = str(profile.get("po_box") or "")
    address = str(profile.get("physical_address") or "")
    phone   = str(profile.get("phone") or "")

    if po_box:
        story.append(Paragraph(f"P.O. BOX {po_box.upper()}", _s("po", center=True)))
    if address:
        story.append(Paragraph(address.upper(), _s("addr", center=True)))
    if phone:
        story.append(Paragraph(f"PHONE: {phone}", _s("phone", center=True)))

    story.append(Spacer(1, 1 * mm))
    story.append(_sep())
    story.append(Spacer(1, 1 * mm))

    # ── Date / time ────────────────────────────────────────────────────────
    story.append(Paragraph(_datetime_str(doc.get("received_at")), _s("dt")))
    story.append(Spacer(1, 1 * mm))
    story.append(_sep())
    story.append(Spacer(1, 1 * mm))

    # ── Student / Receipt info ─────────────────────────────────────────────
    student_name = _primary_student(doc)
    receipt_no   = str(doc.get("document_no") or "")
    invoice_no   = _primary_invoice_no(doc)

    # Truncate for fixed-width layout
    max_name = 18
    s_name = student_name[:max_name] if len(student_name) > max_name else student_name

    story.append(_row(f"STUDENT: {s_name}", f"RECEIPT#: {receipt_no[-8:] if len(receipt_no) > 8 else receipt_no}"))
    story.append(Spacer(1, 1 * mm))
    story.append(_row(f"INVOICE: {invoice_no[-10:] if len(invoice_no) > 10 else invoice_no}", f"DATE: {_date_short(doc.get('received_at'))}"))
    story.append(Spacer(1, 1 * mm))
    story.append(_sep())
    story.append(Spacer(1, 1 * mm))

    # ── Fee line items ─────────────────────────────────────────────────────
    fee_lines = _all_fee_lines(doc)
    total_from_lines = Decimal("0")
    for desc, amt in fee_lines:
        try:
            total_from_lines += Decimal(str(amt))
        except Exception:
            pass
        # Truncate description to fit
        max_desc = DASH_WIDTH - 14
        d = (desc[:max_desc] + "..") if len(desc) > max_desc else desc
        story.append(_row(d.upper(), _fmt(amt, currency)))
        story.append(Spacer(1, 0.5 * mm))

    story.append(Spacer(1, 1 * mm))
    story.append(_sep())
    story.append(_sep())
    story.append(Spacer(1, 1 * mm))

    # ── Subtotal / Total ───────────────────────────────────────────────────
    total_doc = str(doc.get("amount") or "0")
    story.append(_row("SUBTOTAL:", _fmt(total_doc, currency)))
    story.append(Spacer(1, 0.5 * mm))
    story.append(_row("TAX:", f"{currency} 0.00"))
    story.append(Spacer(1, 1 * mm))
    story.append(_row("TOTAL:", _fmt(total_doc, currency), bold=True))
    story.append(Spacer(1, 1 * mm))
    story.append(_sep())
    story.append(Spacer(1, 1 * mm))

    # ── Payment method / reference ─────────────────────────────────────────
    provider  = str(doc.get("provider") or "").upper() or "—"
    reference = str(doc.get("reference") or "—")
    story.append(_row("PAYMENT METHOD:", provider))
    story.append(Spacer(1, 0.5 * mm))
    story.append(_row("REFERENCE:", reference[:16] if len(reference) > 16 else reference))
    story.append(Spacer(1, 1 * mm))
    story.append(_sep())
    story.append(Spacer(1, 1 * mm))

    # ── Footer message ─────────────────────────────────────────────────────
    footer_msg = str(profile.get("receipt_footer") or "PAYMENT RECEIVED IN FULL. THANK YOU.").upper()
    # Wrap manually to 40 chars
    words = footer_msg.split()
    lines_out: list[str] = []
    current = ""
    for word in words:
        if len(current) + len(word) + 1 <= DASH_WIDTH:
            current = (current + " " + word).strip()
        else:
            if current:
                lines_out.append(current)
            current = word
    if current:
        lines_out.append(current)
    for ln in lines_out:
        story.append(Paragraph(ln, _s("footer_ln", center=True)))

    story.append(Spacer(1, 1 * mm))
    story.append(_sep())
    story.append(Spacer(1, 3 * mm))

    # ── QR code ────────────────────────────────────────────────────────────
    if verify_url:
        qr_size = 32 * mm
        qr_img  = RLImage(io.BytesIO(_qr_png(verify_url, box_size=4)), width=qr_size, height=qr_size)
        # Centre: wrap in a 1-cell table
        from reportlab.platypus import Table as _Table, TableStyle as _TS  # type: ignore
        qr_table = _Table([[qr_img]], colWidths=[INNER_W])
        qr_table.setStyle(_TS([("ALIGN", (0, 0), (0, 0), "CENTER")]))
        story.append(qr_table)
        story.append(Spacer(1, 1 * mm))

    # Receipt number below QR
    story.append(Paragraph(receipt_no, _s("rno_bot", center=True)))
    story.append(Spacer(1, 3 * mm))

    doc_pdf.build(story)
    return buf.getvalue()


# ─── Invoice A4 ───────────────────────────────────────────────────────────────

def generate_invoice_pdf(doc: dict[str, Any]) -> bytes:
    """Generate an enterprise A4 invoice PDF."""
    from reportlab.lib.pagesizes import A4  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors  # type: ignore
    from reportlab.platypus import (  # type: ignore
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        HRFlowable, Image as RLImage,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT, TA_JUSTIFY  # type: ignore

    profile  = doc.get("profile") or {}
    currency = str(doc.get("currency") or profile.get("currency") or "KES")

    styles = getSampleStyleSheet()

    def _s(
        name: str,
        size: int = 10,
        bold: bool = False,
        align: int = TA_LEFT,
        color=colors.black,
        space_after: int = 2,
        leading: int | None = None,
    ) -> ParagraphStyle:
        return ParagraphStyle(
            name,
            parent=styles["Normal"],
            fontSize=size,
            fontName="Helvetica-Bold" if bold else "Helvetica",
            alignment=align,
            textColor=color,
            spaceAfter=space_after,
            leading=leading or size + 3,
        )

    buf = io.BytesIO()
    page_w, page_h = A4
    lm = rm = 10 * mm
    usable_w = page_w - lm - rm

    doc_pdf = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=8 * mm, bottomMargin=10 * mm,
        leftMargin=lm, rightMargin=rm,
    )

    story = []

    # ── Header: address block (left) + QR (right) ──────────────────────────
    school_name = str(profile.get("school_header") or "School")
    po_box      = str(profile.get("po_box") or "")
    address     = str(profile.get("physical_address") or "")
    phone       = str(profile.get("phone") or "")
    email_str   = str(profile.get("email") or "")
    motto       = str(profile.get("school_motto") or "")

    addr_lines = []
    if po_box:
        addr_lines.append(f"P.O. Box {po_box}")
    if address:
        addr_lines.append(address)
    if email_str:
        addr_lines.append(email_str)
    if phone:
        addr_lines.append(phone)

    addr_text = "<br/>".join(addr_lines) if addr_lines else school_name
    addr_para = Paragraph(addr_text, _s("addr", size=8, space_after=0))

    # QR — use the qr_payload JSON string (checksum-based, not JWT)
    qr_size = 30 * mm
    qr_payload = str(doc.get("qr_payload") or "")
    qr_enabled = bool(profile.get("qr_enabled", True))
    if qr_enabled and qr_payload:
        qr_img: Any = RLImage(io.BytesIO(_qr_png(qr_payload, box_size=3)), width=qr_size, height=qr_size)
    else:
        qr_img = Spacer(qr_size, qr_size)

    header_table = Table(
        [[addr_para, qr_img]],
        colWidths=[usable_w - qr_size - 4 * mm, qr_size + 4 * mm],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN",  (1, 0), (1, 0),  "RIGHT"),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 3 * mm))

    # ── Solid black rule ───────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=2, color=colors.black))
    story.append(Spacer(1, 6 * mm))

    # ── Title ──────────────────────────────────────────────────────────────
    story.append(Paragraph("Invoice", _s("title", size=18, bold=True, align=TA_CENTER, space_after=6)))

    # ── Invoice No / Date ──────────────────────────────────────────────────
    invoice_no = str(doc.get("document_no") or "")
    created_at = _date_long(doc.get("created_at"))
    story.append(Paragraph(f"<b>Invoice No:</b> {invoice_no}", _s("ino", size=10, space_after=3)))
    story.append(Paragraph(f"<b>Date:</b> {created_at}", _s("idate", size=10, space_after=8)))
    story.append(Spacer(1, 2 * mm))

    # ── Bill To ────────────────────────────────────────────────────────────
    student_name = str(doc.get("student_name") or "Unknown Student")
    invoice_type = str(doc.get("invoice_type") or "").replace("_", " ").title()
    story.append(Paragraph("<b>Bill To:</b>", _s("bt_label", size=10, space_after=2)))
    story.append(Paragraph(f"<b>{student_name}</b>", _s("bt_name", size=10, space_after=1)))
    if invoice_type:
        story.append(Paragraph(f"Type: {invoice_type}", _s("bt_type", size=9, space_after=1,
                                                             color=colors.HexColor("#555555"))))
    story.append(Spacer(1, 6 * mm))

    # ── Fee items table ────────────────────────────────────────────────────
    story.append(Paragraph("<b>Invoice Items</b>", _s("items_label", size=11, space_after=4)))
    lines = doc.get("lines") or []
    tbl_data = [["#", "Description", "Amount"]]
    for idx, line in enumerate(lines, 1):
        if isinstance(line, dict):
            tbl_data.append([
                str(idx),
                str(line.get("description") or ""),
                _fmt(str(line.get("amount") or "0"), currency),
            ])
    if not lines:
        tbl_data.append(["—", "—", "—"])

    col_w = [usable_w * 0.07, usable_w * 0.63, usable_w * 0.30]
    tbl = Table(tbl_data, colWidths=col_w)
    tbl.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.HexColor("#444444")),
        ("FONTNAME",    (0, 0), (-1, 0), "Helvetica"),
        ("FONTSIZE",    (0, 0), (-1, -1), 9),
        ("ALIGN",       (0, 0), (-1, 0),  "CENTER"),
        ("ALIGN",       (0, 1), (0, -1),  "CENTER"),
        ("ALIGN",       (2, 1), (2, -1),  "RIGHT"),
        ("FONTNAME",    (0, 1), (-1, -1), "Helvetica"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
        ("GRID",        (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("TOPPADDING",  (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 5 * mm))

    # ── Totals block ───────────────────────────────────────────────────────
    total   = str(doc.get("total_amount") or "0")
    paid    = str(doc.get("paid_amount") or "0")
    balance = str(doc.get("balance_amount") or "0")
    status  = str(doc.get("status") or "").upper()

    totals_data = [
        ["Subtotal:",  _fmt(total, currency)],
        ["Paid:",      _fmt(paid, currency)],
        ["Balance:",   _fmt(balance, currency)],
    ]
    totals_col = [usable_w * 0.7, usable_w * 0.3]
    totals_tbl = Table(totals_data, colWidths=totals_col)
    totals_tbl.setStyle(TableStyle([
        ("FONTNAME",    (0, 0), (-1, -1), "Helvetica"),
        ("FONTNAME",    (0, 2), (-1, 2),  "Helvetica-Bold"),
        ("FONTSIZE",    (0, 0), (-1, -1), 9),
        ("ALIGN",       (1, 0), (1, -1),  "RIGHT"),
        ("LINEABOVE",   (0, 2), (-1, 2),  0.5, colors.HexColor("#cccccc")),
        ("TOPPADDING",  (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(totals_tbl)
    story.append(Spacer(1, 4 * mm))

    # ── Status badge ───────────────────────────────────────────────────────
    if status == "PAID":
        badge_color = colors.HexColor("#166534")
        badge_bg    = colors.HexColor("#dcfce7")
    elif status in ("PARTIALLY_PAID", "PARTIAL"):
        badge_color = colors.HexColor("#92400e")
        badge_bg    = colors.HexColor("#fef3c7")
    else:
        badge_color = colors.HexColor("#991b1b")
        badge_bg    = colors.HexColor("#fee2e2")

    badge_label = status.replace("_", " ")
    badge_tbl = Table([[badge_label]], colWidths=[30 * mm])
    badge_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, 0), badge_bg),
        ("TEXTCOLOR",     (0, 0), (0, 0), badge_color),
        ("FONTNAME",      (0, 0), (0, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (0, 0), 8),
        ("ALIGN",         (0, 0), (0, 0), "CENTER"),
        ("TOPPADDING",    (0, 0), (0, 0), 3),
        ("BOTTOMPADDING", (0, 0), (0, 0), 3),
        ("ROUNDEDCORNERS", [3]),
    ]))
    story.append(badge_tbl)
    story.append(Spacer(1, 6 * mm))

    # ── Footer + signatory ─────────────────────────────────────────────────
    footer_msg = str(profile.get("receipt_footer") or "Thank you for partnering with us.")
    story.append(Paragraph(footer_msg, _s("footer_msg", size=9, align=TA_JUSTIFY, space_after=8)))

    sig_name  = str(profile.get("authorized_signatory_name") or "")
    sig_title = str(profile.get("authorized_signatory_title") or "Authorized Signatory")
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("________________________", _s("sig_line", size=9, space_after=1)))
    if sig_name:
        story.append(Paragraph(f"<b>{sig_name}</b>", _s("sig_name", size=9, space_after=1)))
    story.append(Paragraph(sig_title, _s("sig_title", size=9, space_after=0)))

    if motto:
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(f"<i>{motto}</i>",
                                _s("motto", size=8, align=TA_CENTER, color=colors.HexColor("#666666"))))

    doc_pdf.build(story)
    return buf.getvalue()


# ─── Thermal HTML receipt (auto-print) ───────────────────────────────────────

def generate_thermal_html(doc: dict[str, Any]) -> str:
    """Return a <pre>-formatted HTML receipt for 80 mm thermal paper.

    Uses plain monospace text so any printer driver (including Generic/Text Only)
    renders it correctly.  @page sets the paper to 80 mm wide × auto height so
    Chrome prints the full receipt as a single continuous job.
    """
    W = 42  # character width that fits inside 80 mm at Courier 9 pt

    def centre(text: str) -> str:
        return text.center(W)

    def sep() -> str:
        return "-" * W

    def row(label: str, value: str) -> str:
        """Left-aligned label, right-aligned value, total W chars."""
        label = label[:W]
        value = value[:(W - len(label) - 1)]
        gap = W - len(label) - len(value)
        return label + " " * gap + value

    profile  = doc.get("profile") or {}
    currency = str(doc.get("currency") or profile.get("currency") or "KES")

    school_name = str(profile.get("school_header") or "SCHOOL").upper()
    address     = str(profile.get("physical_address") or "")
    phone       = str(profile.get("phone") or "")
    footer_msg  = str(profile.get("footer_message") or "Thank you for your payment.")

    receipt_no = str(doc.get("document_no") or "")
    amount_raw = doc.get("amount") or "0"
    try:
        amount_fmt = f"{currency} {Decimal(str(amount_raw)):,.2f}"
    except InvalidOperation:
        amount_fmt = f"{currency} {amount_raw}"

    received_at = doc.get("received_at") or ""
    if received_at:
        try:
            dt = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
            date_str = dt.strftime("%d %b %Y %H:%M")
        except Exception:
            date_str = received_at
    else:
        date_str = ""

    provider  = str(doc.get("provider") or "").upper()
    reference = str(doc.get("reference") or "")

    allocations = doc.get("allocations") or []
    primary_student = ""
    fee_lines: list[str] = []
    for alloc in allocations:
        if not primary_student:
            primary_student = str(alloc.get("student_name") or "")
        lines = alloc.get("lines") or []
        if lines:
            for line in lines:
                desc = str(line.get("description") or "Fee")
                try:
                    line_amt = f"{currency} {Decimal(str(line.get('amount') or 0)):,.2f}"
                except InvalidOperation:
                    line_amt = str(line.get("amount") or "")
                fee_lines.append(row(desc, line_amt))
        else:
            inv_no = str(alloc.get("invoice_no") or "")
            try:
                alloc_amt = f"{currency} {Decimal(str(alloc.get('amount') or 0)):,.2f}"
            except InvalidOperation:
                alloc_amt = str(alloc.get("amount") or "")
            label = f"INV {inv_no}" if inv_no else "Payment"
            fee_lines.append(row(label, alloc_amt))

    lines: list[str] = []
    lines.append(centre(school_name))
    if address:
        lines.append(centre(address))
    if phone:
        lines.append(centre(f"Tel: {phone}"))
    lines.append(sep())
    lines.append(centre("PAYMENT RECEIPT"))
    lines.append(sep())
    lines.append(row("Receipt#", receipt_no))
    lines.append(row("Date", date_str))
    if primary_student:
        lines.append(row("Student", primary_student))
    lines.append(sep())
    lines.extend(fee_lines)
    lines.append(sep())
    lines.append(row("TOTAL", amount_fmt))
    lines.append(sep())
    if provider:
        lines.append(row("Method", provider))
    if reference:
        lines.append(row("Ref", reference))
    lines.append(sep())
    lines.append(centre(footer_msg))
    lines.append("")  # trailing newline so printer feeds past text

    from html import escape
    body = escape("\n".join(lines))
    rno  = escape(receipt_no)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Receipt {rno}</title>
<style>
  * {{ margin: 0; padding: 0; }}
  @page {{ size: 80mm auto; margin: 2mm 3mm; }}
  body {{
    font-family: 'Courier New', Courier, monospace;
    font-size: 9pt;
    line-height: 1.3;
    color: #000;
    white-space: pre;
  }}
</style>
</head>
<body>{body}<script>
window.onload = function() {{
  window.print();
  window.onafterprint = function() {{ window.close(); }};
}};
</script>
</body>
</html>"""


# ─── Public entrypoint ────────────────────────────────────────────────────────

def generate_receipt_pdf(doc: dict[str, Any]) -> bytes:
    """Generate an enterprise receipt PDF for a RECEIPT document."""
    profile     = doc.get("profile") or {}
    paper_size  = str(profile.get("paper_size") or "A4").upper()
    qr_enabled  = bool(profile.get("qr_enabled", True))
    tenant_slug = str(doc.get("tenant_slug") or "")

    if qr_enabled and tenant_slug:
        token = create_receipt_verify_token(
            payment_id=str(doc.get("document_id") or ""),
            tenant_id=str(doc.get("tenant_id") or ""),
            tenant_slug=tenant_slug,
            receipt_no=str(doc.get("document_no") or ""),
            amount=str(doc.get("amount") or "0"),
            student_name=_primary_student(doc),
        )
        verify_url = build_verify_url(tenant_slug=tenant_slug, token=token)
    else:
        verify_url = ""

    if paper_size == "THERMAL_80MM":
        return _generate_thermal_receipt(doc, verify_url)
    return _generate_a4_receipt(doc, verify_url)
