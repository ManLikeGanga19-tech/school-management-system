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


def verify_code_url(code: str | None) -> str:
    """Short, opaque verification URL embedded in a document QR.

    The QR carries only this URL — verification is a live DB lookup of the
    code, so a tampered or forged code simply has no matching record.
    """
    if not code:
        return ""
    base = os.environ.get("FRONTEND_BASE_URL", "https://shulehq.co.ke").rstrip("/")
    return f"{base}/v/{code}"


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
    # Phase R — zero-allocation payments (CF-only settlement, no-dues
    # credit) resolve via the direct payer link instead.
    payer = doc.get("payer_student")
    if isinstance(payer, dict):
        name = str(payer.get("student_name") or "").strip()
        if name:
            return name
    return "Unknown"


def _primary_parent(doc: dict[str, Any]) -> str:
    """Parent/guardian who made the payment, from the first allocation that has one."""
    for alloc in doc.get("allocations") or []:
        if isinstance(alloc, dict):
            name = str(alloc.get("parent_name") or "").strip()
            if name:
                return name
    return ""


def _primary_invoice_no(doc: dict[str, Any]) -> str:
    for alloc in doc.get("allocations") or []:
        if isinstance(alloc, dict):
            inv = str(alloc.get("invoice_no") or "").strip()
            if inv:
                return inv
    return "—"


def _payment_groups(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """Group a payment's allocations by student for a consolidated receipt.

    One payment transaction = one receipt; when a parent pays for several
    children at once the receipt stays single but is grouped per child.
    Each group: {student, admission_no, class_code, rows: [(invoice_no, amount)]}.
    Row amounts always sum to the payment total (never the invoice total).
    """
    groups: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for alloc in doc.get("allocations") or []:
        if not isinstance(alloc, dict):
            continue
        name = str(alloc.get("student_name") or "").strip()
        if not name or name.lower() == "unknown student":
            name = "Student"
        adm = str(alloc.get("admission_no") or "").strip()
        cls = str(alloc.get("class_code") or "").strip()
        key = f"{name}|{adm}"
        if key not in groups:
            groups[key] = {
                "student": name,
                "admission_no": adm,
                "class_code": cls,
                "rows": [],
            }
            order.append(key)
        inv = str(alloc.get("invoice_no") or "").strip()
        groups[key]["rows"].append((inv, str(alloc.get("amount") or "0")))
    return [groups[k] for k in order]


def _group_caption(group: dict[str, Any]) -> str:
    """One-line student caption: 'Jane Doe  (Adm 2026/001 · Grade 4)'."""
    meta = " · ".join(
        p for p in [
            f"Adm {group['admission_no']}" if group.get("admission_no") else "",
            str(group.get("class_code") or ""),
        ] if p
    )
    return f"{group['student']}  ({meta})" if meta else str(group["student"])


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

    # School name is always shown — it is the identity of the document.
    name_para = Paragraph(school_name, _s("sname", size=15, bold=True, space_after=2))
    addr_text = "<br/>".join(addr_lines)
    left_block: list[Any] = [name_para]
    if addr_text:
        left_block.append(Paragraph(addr_text, _s("addr", size=8, space_after=0)))

    qr_size = 30 * mm
    if verify_url:
        qr_img = RLImage(io.BytesIO(_qr_png(verify_url, box_size=3)), width=qr_size, height=qr_size)
    else:
        qr_img = Spacer(qr_size, qr_size)

    header_table = Table(
        [[left_block, qr_img]],
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
    # The payer is the parent/guardian; the student(s) appear in the table below.
    payer_name = _primary_parent(doc) or _primary_student(doc)
    story.append(Paragraph("<b>Paid By:</b>", _s("pb_label", size=10, space_after=2)))
    story.append(Paragraph(f"<b>{payer_name}</b>", _s("pb_name", size=10, space_after=1)))
    story.append(Spacer(1, 6 * mm))

    # ── Payment Details ────────────────────────────────────────────────────
    story.append(Paragraph("<b>Payment Details</b>", _s("pd_label", size=11, space_after=4)))

    groups = _payment_groups(doc)
    tbl_data: list[list[str]] = [["Description", "Amount"]]
    header_rows: list[int] = []
    for g in groups:
        header_rows.append(len(tbl_data))
        tbl_data.append([_group_caption(g), ""])
        for inv, amt in g["rows"]:
            label = f"    Payment for Invoice {inv}" if inv else "    Payment received"
            tbl_data.append([label, _fmt(amt, currency)])

    # Phase R — Prior balance settled: cash from this payment applied to
    # carry-forward debits. Itemised with the CF's own term label so the
    # parent sees exactly which old balance was cleared.
    cf_settlements = [
        c for c in (doc.get("cf_settlements") or []) if isinstance(c, dict)
    ]
    if cf_settlements:
        hr = len(tbl_data)
        header_rows.append(hr)
        payer = doc.get("payer_student") or {}
        payer_caption = str(payer.get("student_name") or "").strip()
        caption = "Prior balance settled"
        if payer_caption and not groups:
            adm = str(payer.get("admission_no") or "").strip()
            caption = f"{payer_caption}{f' ({adm})' if adm else ''} — prior balance settled"
        tbl_data.append([caption, ""])
        for c in cf_settlements:
            label = str(c.get("term_label") or "Prior balance").strip()
            tbl_data.append([f"    {label}", _fmt(c.get("amount"), currency)])

    if not groups and not cf_settlements:
        tbl_data.append(["—", "—"])

    col_w = [usable_w * 0.72, usable_w * 0.28]
    tbl = Table(tbl_data, colWidths=col_w)
    tbl_style = [
        # Header row
        ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.HexColor("#444444")),
        ("FONTNAME",    (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE",    (0, 0), (-1, -1), 9),
        ("ALIGN",       (0, 0), (-1, 0), "CENTER"),
        ("GRID",        (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("TOPPADDING",  (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ALIGN",       (1, 1), (1, -1), "RIGHT"),
    ]
    # Per-student subheading rows: span both columns, bold, tinted background
    for hr in header_rows:
        tbl_style.append(("SPAN", (0, hr), (-1, hr)))
        tbl_style.append(("BACKGROUND", (0, hr), (-1, hr), colors.HexColor("#eef3f2")))
        tbl_style.append(("FONTNAME", (0, hr), (-1, hr), "Helvetica-Bold"))
    tbl.setStyle(TableStyle(tbl_style))
    story.append(tbl)
    story.append(Spacer(1, 5 * mm))

    # ── Payment method / reference ─────────────────────────────────────────
    provider  = str(doc.get("provider") or "").upper() or "—"
    reference = str(doc.get("reference") or "").strip() or "—"
    meta_tbl = Table(
        [
            ["Payment Method:", provider],
            ["Reference:", reference],
        ],
        colWidths=[usable_w * 0.25, usable_w * 0.75],
    )
    meta_tbl.setStyle(TableStyle([
        ("FONTNAME",      (0, 0), (0, -1),  "Helvetica-Bold"),
        ("FONTNAME",      (1, 0), (1, -1),  "Helvetica"),
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(meta_tbl)
    story.append(Spacer(1, 5 * mm))

    # ── Total ──────────────────────────────────────────────────────────────
    total_str = f"{currency} {_fmt_plain(doc.get('amount'))}"
    story.append(Paragraph(
        f"<b>Total Amount Paid: {total_str}</b>",
        _s("total", size=14, bold=True, space_after=10),
    ))

    # Phase R — honest split notes: available credit applied as funding
    # (not cash) and surplus credited forward to the next invoice.
    credit_consumed = [
        c for c in (doc.get("credit_consumed") or []) if isinstance(c, dict)
    ]
    if credit_consumed:
        consumed_total = sum(
            (float(c.get("amount") or 0) for c in credit_consumed), 0.0
        )
        story.append(Paragraph(
            f"Available credit applied: {_fmt(str(consumed_total), currency)} "
            "(from the student's credit balance, in addition to the amount paid)",
            _s("credit_note", size=8, color=colors.HexColor("#166534"), space_after=4),
        ))
    try:
        surplus_val = float(doc.get("surplus_credit") or 0)
    except (TypeError, ValueError):
        surplus_val = 0.0
    if surplus_val > 0:
        story.append(Paragraph(
            f"Credited forward: {_fmt(str(surplus_val), currency)} — "
            "auto-applies to the student's next invoice.",
            _s("surplus_note", size=8, color=colors.HexColor("#1d4ed8"), space_after=4),
        ))
    story.append(Spacer(1, 4 * mm))

    # ── Footer message (tenant-configured) ─────────────────────────────────
    footer_msg = str(profile.get("receipt_footer") or "Thank you for your payment.")
    story.append(Paragraph(footer_msg, _s("footer_msg", size=9, align=TA_CENTER, space_after=8)))

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

    try:
        _width_mm = int(profile.get("thermal_width_mm") or 80)
    except (TypeError, ValueError):
        _width_mm = 80

    PAGE_W  = _width_mm * mm
    PAGE_H  = 300 * mm  # generous — unused space is cut by viewer
    MARGIN  = 4 * mm
    INNER_W = PAGE_W - 2 * MARGIN

    # Courier-8: chars per mm ≈ 0.50  →  scales with the configured paper width.
    DASH_WIDTH = max(24, round(_width_mm * 0.50))  # characters

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

    # ── Payment items, grouped by student ──────────────────────────────────
    max_desc = DASH_WIDTH - 14
    for g in _payment_groups(doc):
        caption = _group_caption(g).upper()
        story.append(Paragraph(caption[:DASH_WIDTH], _s("stu", bold=True)))
        for inv, amt in g["rows"]:
            label = (f"  INV {inv}" if inv else "  PAYMENT")
            d = (label[:max_desc] + "..") if len(label) > max_desc else label
            story.append(_row(d, _fmt(amt, currency)))
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

    # Phase Q — Revised marker: the reconciliation engine corrected this
    # invoice after publication; older printouts are superseded.
    reconciled_count = int(doc.get("reconciled_count") or 0)
    if reconciled_count > 0:
        rev_date = str(doc.get("last_reconciled_at") or "")[:10]
        rev_text = f"REVISED (rev {reconciled_count})"
        if rev_date:
            rev_text += f" on {rev_date}"
        rev_text += " — amounts updated to the current fee structure"
        story.append(Paragraph(
            f"<b>{rev_text}</b>",
            _s("revised", size=8, color=colors.HexColor("#b45309"), space_after=4),
        ))
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

    # ── Phase N4 — Prior balance block ─────────────────────────────────────
    # The student's outstanding position OUTSIDE this invoice: older CF
    # debits still owed, or available credit on account. Bundled CF is
    # already inside this invoice's total, so this section only surfaces
    # what's still open elsewhere. Parents get a clear picture without
    # confusing them into thinking this invoice is bigger than it is.
    prior = doc.get("prior_balance") or None
    if prior:
        prior_rows: list[list[str]] = []
        try:
            prior_debit_v = float(prior.get("debit") or 0)
            prior_credit_v = float(prior.get("credit") or 0)
            prior_net_v = float(prior.get("net") or 0)
        except (TypeError, ValueError):
            prior_debit_v = prior_credit_v = prior_net_v = 0.0
        if prior_debit_v > 0:
            prior_rows.append(["Previously owed:", _fmt(str(prior_debit_v), currency)])
        if prior_credit_v > 0:
            prior_rows.append([
                "Credit on account:",
                f"({_fmt(str(prior_credit_v), currency)})",
            ])
        if prior_debit_v > 0 and prior_credit_v > 0:
            prior_rows.append([
                "Net prior position:",
                _fmt(str(prior_net_v), currency)
                if prior_net_v >= 0
                else f"({_fmt(str(abs(prior_net_v)), currency)})",
            ])
        if prior_rows:
            story.append(Paragraph(
                "<b>Prior balance</b> (not included in this invoice):",
                _s("prior_hdr", size=8, color=colors.HexColor("#334155"),
                   space_after=2),
            ))
            prior_tbl = Table(prior_rows, colWidths=totals_col)
            prior_tbl.setStyle(TableStyle([
                ("FONTNAME",    (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE",    (0, 0), (-1, -1), 8),
                ("TEXTCOLOR",   (0, 0), (-1, -1), colors.HexColor("#475569")),
                ("ALIGN",       (1, 0), (1, -1),  "RIGHT"),
                ("TOPPADDING",  (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]))
            story.append(prior_tbl)
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
    """Return a <pre>-formatted HTML receipt that mirrors the thermal PDF layout.

    Uses plain monospace text (no tables/CSS layout) so any printer driver,
    including Generic/Text Only, renders it correctly.
    @page size: 80mm auto ensures Chrome prints the full roll without page breaks.
    """
    # Character width scales with the configured paper width
    # (80 mm → 42 cols, 58 mm → 30 cols at Courier 9 pt).
    try:
        _width_mm = int((doc.get("profile") or {}).get("thermal_width_mm") or 80)
    except (TypeError, ValueError):
        _width_mm = 80
    W = max(24, round(_width_mm * 0.525))

    def centre(text: str) -> str:
        return text[:W].center(W)

    def sep() -> str:
        return "-" * W

    def row(label: str, value: str) -> str:
        label = label[:W]
        value = value[: max(0, W - len(label) - 1)]
        return label + " " * max(1, W - len(label) - len(value)) + value

    profile  = doc.get("profile") or {}
    currency = str(doc.get("currency") or profile.get("currency") or "KES")

    school_name = str(profile.get("school_header") or "SCHOOL").upper()
    po_box      = str(profile.get("po_box") or "")
    address     = str(profile.get("physical_address") or "")
    phone       = str(profile.get("phone") or "")
    footer_raw  = str(profile.get("receipt_footer") or "PAYMENT RECEIVED IN FULL. THANK YOU.").upper()

    receipt_no  = str(doc.get("document_no") or "")
    amount_raw  = doc.get("amount") or "0"
    provider    = str(doc.get("provider") or "").upper() or "—"
    reference   = str(doc.get("reference") or "—")
    received_at = doc.get("received_at") or None

    student_name = _primary_student(doc)
    invoice_no   = _primary_invoice_no(doc)

    def _dt(iso: str | None) -> str:
        if not iso:
            return datetime.now(timezone.utc).strftime("%d/%m/%Y  %I:%M %p")
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            return dt.strftime("%d/%m/%Y  %I:%M %p")
        except Exception:
            return iso or ""

    def _ds(iso: str | None) -> str:
        if not iso:
            return datetime.now(timezone.utc).strftime("%d/%m/%Y")
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            return dt.strftime("%d/%m/%Y")
        except Exception:
            return iso or ""

    def _fmt_amt(raw: str) -> str:
        try:
            return f"{currency} {Decimal(raw):,.2f}"
        except InvalidOperation:
            return f"{currency} {raw}"

    # ── Build lines matching PDF layout exactly ──────────────────────────────
    out: list[str] = []

    # Header
    out.append(centre(school_name))
    if po_box:
        out.append(centre(f"P.O. BOX {po_box.upper()}"))
    if address:
        out.append(centre(address.upper()))
    if phone:
        out.append(centre(f"PHONE: {phone}"))
    out.append("")
    out.append(sep())
    out.append("")

    # Date
    out.append(_dt(received_at))
    out.append("")
    out.append(sep())
    out.append("")

    # Student / Receipt info (two rows of two columns each)
    s_name   = student_name[:18]
    rno_short = receipt_no[-8:] if len(receipt_no) > 8 else receipt_no
    inv_short = invoice_no[-10:] if len(invoice_no) > 10 else invoice_no
    out.append(row(f"STUDENT: {s_name}", f"RECEIPT#: {rno_short}"))
    out.append("")
    out.append(row(f"INVOICE: {inv_short}", f"DATE: {_ds(received_at)}"))
    out.append("")
    out.append(sep())
    out.append("")

    # Payment items, grouped by student
    max_desc = W - 14
    for g in _payment_groups(doc):
        out.append(_group_caption(g).upper()[:W])
        for inv, amt in g["rows"]:
            label = (f"  INV {inv}" if inv else "  PAYMENT")
            d = (label[:max_desc] + "..") if len(label) > max_desc else label
            out.append(row(d, _fmt_amt(str(amt))))
    out.append("")

    out.append(sep())
    out.append(sep())
    out.append("")

    # Totals
    total_str = str(doc.get("amount") or "0")
    out.append(row("SUBTOTAL:", _fmt_amt(total_str)))
    out.append(row("TAX:", f"{currency} 0.00"))
    out.append("")
    out.append(row("TOTAL:", _fmt_amt(total_str)))
    out.append("")
    out.append(sep())
    out.append("")

    # Payment info
    ref_short = reference[:16] if len(reference) > 16 else reference
    out.append(row("PAYMENT METHOD:", provider))
    out.append(row("REFERENCE:", ref_short))
    out.append("")
    out.append(sep())
    out.append("")

    # Footer (word-wrap to W chars, centred)
    words = footer_raw.split()
    current = ""
    for word in words:
        if len(current) + len(word) + 1 <= W:
            current = (current + " " + word).strip()
        else:
            if current:
                out.append(centre(current))
            current = word
    if current:
        out.append(centre(current))

    out.append("")
    out.append(sep())

    from html import escape
    pre_body = escape("\n".join(out))
    rno_esc  = escape(receipt_no)

    # ── QR code (base64 embedded PNG) ────────────────────────────────────────
    qr_img_tag = ""
    try:
        verify_url = verify_code_url(doc.get("verify_code"))
        if verify_url:
            import base64
            qr_bytes  = _qr_png(verify_url, box_size=4)
            qr_b64    = base64.b64encode(qr_bytes).decode()
            qr_img_tag = (
                f'<div style="text-align:center;margin:4px 0">'
                f'<img src="data:image/png;base64,{qr_b64}" '
                f'style="width:56mm;height:56mm" alt="QR"/>'
                f'</div>'
            )
    except Exception:
        pass  # QR is optional — receipt still prints without it

    # Receipt number below QR + generous paper feed (≈40 mm) so it tears cleanly
    post_body = escape(f"\n{centre(receipt_no)}\n\n\n\n\n\n\n\n")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Receipt {rno_esc}</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  @page {{ size: {_width_mm}mm auto; margin: 2mm 3mm; }}
  html, body {{ width: 100%; }}
  body {{
    font-family: 'Courier New', Courier, monospace;
    font-size: 9pt;
    line-height: 1.35;
    color: #000;
    text-align: center;          /* centres the receipt block on the roll */
  }}
  .receipt {{
    display: inline-block;
    text-align: left;
    white-space: pre;
  }}
  img {{ display: block; margin: 0 auto; }}
</style>
</head>
<body><div class="receipt">{pre_body}{qr_img_tag}<span>{post_body}</span></div><script>
window.onload = function() {{
  window.print();
  window.onafterprint = function() {{ window.close(); }};
}};
</script>
</body>
</html>"""


# ─── Public entrypoint ────────────────────────────────────────────────────────

def generate_receipt_pdf(doc: dict[str, Any], *, force_a4: bool = False) -> bytes:
    """Generate an enterprise receipt PDF for a RECEIPT document.

    force_a4: when True, always render A4 regardless of the tenant's
    paper_size setting. Used by the "Download PDF" action — a saved file
    is for filing/email, so it is never thermal-sized.
    """
    profile     = doc.get("profile") or {}
    paper_size  = "A4" if force_a4 else str(profile.get("paper_size") or "A4").upper()
    qr_enabled  = bool(profile.get("qr_enabled", True))

    verify_url = verify_code_url(doc.get("verify_code")) if qr_enabled else ""

    if paper_size == "THERMAL_80MM":
        return _generate_thermal_receipt(doc, verify_url)
    return _generate_a4_receipt(doc, verify_url)
