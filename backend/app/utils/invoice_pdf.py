"""School Fees Invoice PDF generator.

Produces an A4 PDF matching the "School Fees Bill Format" layout:
  ┌──────────────────────────────────────────────────────────────────┐
  │  [School Name / Address block]          SCHOOL FEES INVOICE      │
  │  Phone / Email                          Invoice No: INV-2026-… │
  │                                         Date: 01 Jan 2026       │
  │                                         Term: 1 / 2026          │
  ├──────────────────────────────────────────────────────────────────┤
  │  Student:  JANE DOE              Adm No:  2026/001              │
  │  Class:    PP1                   Type:    New Student           │
  │  Parent:   MR. JOHN DOE                                         │
  ├──────────────────────────────────────────────────────────────────┤
  │  #  Description                         Amount (KES)            │
  │  1  Tuition Fee (PP1)                   20,000.00               │
  │  2  Activity Fee                         1,500.00               │
  │  …                                                              │
  │  ─────────────────────────────────────────────────────          │
  │                                 TOTAL:  21,500.00               │
  │                             BALANCE:    21,500.00               │
  ├──────────────────────────────────────────────────────────────────┤
  │  HOW TO PAY                                                      │
  │  M-PESA Paybill: 123456  Business No: 001  Account: Adm No.     │
  │  Bank: Equity Bank  Account: SCHOOL NAME  No: 01234567890       │
  └──────────────────────────────────────────────────────────────────┘
"""
from __future__ import annotations

import zlib
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any


# ── PDF primitives (same approach as cbc_report_pdf.py) ──────────────────────

def _safe(text: str | None) -> str:
    if not text:
        return ""
    s = str(text)
    # Replace non-latin-1 unicode chars with safe ASCII equivalents
    s = s.replace("\u2014", "-").replace("\u2013", "-").replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u2022", "*").replace("\u00a0", " ")
    s = s.encode("latin-1", errors="replace").decode("latin-1")
    return (
        s.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )


def _build_pdf(objects: dict[int, bytes], root_id: int) -> bytes:
    parts: list[bytes] = [b"%PDF-1.4\n"]
    xref: dict[int, int] = {}
    for oid in sorted(objects):
        xref[oid] = len(b"".join(parts))
        body = objects[oid]
        parts.append(f"{oid} 0 obj\n".encode())
        parts.append(body)
        parts.append(b"\nendobj\n")
    xref_offset = len(b"".join(parts))
    max_id = max(objects) + 1
    xref_table = [f"xref\n0 {max_id}\n0000000000 65535 f \n".encode()]
    for i in range(1, max_id):
        if i in xref:
            xref_table.append(f"{xref[i]:010d} 00000 n \n".encode())
        else:
            xref_table.append(b"0000000000 65535 f \n")
    parts.extend(xref_table)
    parts.append(
        f"trailer\n<< /Size {max_id} /Root {root_id} 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n".encode()
    )
    return b"".join(parts)


def _fmt_amount(value: Any) -> str:
    try:
        d = Decimal(str(value or 0))
        return f"{d:,.2f}"
    except (InvalidOperation, TypeError):
        return "0.00"


def generate_invoice_pdf(data: dict[str, Any]) -> bytes:
    """
    data: result from service.build_invoice_document()
    Returns raw PDF bytes.
    """
    W, H = 595.0, 842.0
    ML, MR, MT, MB = 20.0, 20.0, 20.0, 20.0

    stream_lines: list[str] = []

    def txt(x: float, y: float, text: str, size: int = 9, bold: bool = False) -> None:
        font = "F2" if bold else "F1"
        stream_lines.append(f"BT /{font} {size} Tf {x:.1f} {y:.1f} Td ({_safe(str(text))}) Tj ET")

    def rule(x1: float, y1: float, x2: float, y2: float, w: float = 0.4) -> None:
        stream_lines.append(f"{w} w {x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S")

    def colored_rect(x: float, y: float, w: float, h: float, r: float, g: float, b: float) -> None:
        stream_lines.append(
            f"{r:.2f} {g:.2f} {b:.2f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f 0 0 0 rg"
        )

    def rect_stroke(x: float, y: float, w: float, h: float) -> None:
        stream_lines.append(f"0.3 w {x:.1f} {y:.1f} {w:.1f} {h:.1f} re S")

    # ── Extract data ──────────────────────────────────────────────────────────
    profile = data.get("profile") or {}
    school_name = str(
        profile.get("school_header") or profile.get("school_name") or profile.get("name") or "School"
    )
    school_address = str(profile.get("physical_address") or profile.get("po_box") or profile.get("address") or "")
    school_phone = str(profile.get("phone") or "")
    school_email = str(profile.get("email") or "")

    student_name = str(data.get("student_name") or "—")
    admission_no = str(data.get("admission_no") or "—")
    class_code = str(data.get("class_code") or "—")
    parent_name = str(data.get("parent_name") or "")
    invoice_no = str(data.get("document_no") or data.get("invoice_no") or "—")
    currency = str(data.get("currency") or "KES")
    total_amount = _fmt_amount(data.get("total_amount"))
    paid_amount = _fmt_amount(data.get("paid_amount"))
    balance_amount = _fmt_amount(data.get("balance_amount"))
    status = str(data.get("status") or "DRAFT")

    term_number = data.get("term_number")
    academic_year = data.get("academic_year")
    student_type = str(data.get("student_type_snapshot") or "")

    # Format date
    raw_date = data.get("created_at") or ""
    try:
        dt = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
        date_str = dt.strftime("%d %b %Y")
    except Exception:
        date_str = str(raw_date)[:10] if raw_date else datetime.now(timezone.utc).strftime("%d %b %Y")

    term_label = f"Term {term_number}" if term_number else ""
    year_label = str(academic_year) if academic_year else ""
    term_year = f"{term_label} - {year_label}" if term_label and year_label else (term_label or year_label)

    student_type_label = ("New Student" if student_type == "NEW"
                          else "Returning Student" if student_type == "RETURNING"
                          else "")

    lines: list[dict] = data.get("lines") or []
    ps = data.get("payment_settings") or {}

    # ── Header banner ────────────────────────────────────────────────────────
    y = H - MT
    colored_rect(ML, y - 52, W - ML - MR, 56, 0.09, 0.38, 0.65)
    stream_lines.append("1 1 1 rg")
    txt(ML + 6, y - 14, school_name, size=13, bold=True)
    if school_address:
        txt(ML + 6, y - 26, school_address, size=8)
    contact_parts = []
    if school_phone:
        contact_parts.append(f"Tel: {school_phone}")
    if school_email:
        contact_parts.append(school_email)
    if contact_parts:
        txt(ML + 6, y - 37, " | ".join(contact_parts), size=8)
    # Right side: Invoice header
    col_right = W - MR - 155
    txt(col_right, y - 14, "SCHOOL FEES INVOICE", size=11, bold=True)
    txt(col_right, y - 27, f"Invoice No: {invoice_no}", size=8)
    txt(col_right, y - 37, f"Date: {date_str}", size=8)
    if term_year:
        txt(col_right, y - 47, term_year, size=8)
    stream_lines.append("0 0 0 rg")
    y -= 62

    # ── Student / Billing block ───────────────────────────────────────────────
    block_h = 52 if parent_name else 40
    colored_rect(ML, y - block_h, W - ML - MR, block_h + 4, 0.94, 0.96, 0.99)
    rect_stroke(ML, y - block_h, W - ML - MR, block_h + 4)
    y2 = y - 2
    txt(ML + 6, y2 - 12, "Student:", size=8, bold=True)
    txt(ML + 55, y2 - 12, student_name.upper(), size=8)
    txt(ML + 6, y2 - 24, "Class:", size=8, bold=True)
    txt(ML + 55, y2 - 24, class_code.upper(), size=8)
    if parent_name:
        txt(ML + 6, y2 - 36, "Parent/Guardian:", size=8, bold=True)
        txt(ML + 90, y2 - 36, parent_name, size=8)

    right_col = ML + 265
    txt(right_col, y2 - 12, "Adm. No:", size=8, bold=True)
    txt(right_col + 50, y2 - 12, admission_no, size=8)
    if student_type_label:
        txt(right_col, y2 - 24, "Type:", size=8, bold=True)
        txt(right_col + 50, y2 - 24, student_type_label, size=8)
    txt(right_col, y2 - 36, "Status:", size=8, bold=True)
    txt(right_col + 50, y2 - 36, status, size=8)

    y -= block_h + 10

    # ── Fee lines table ───────────────────────────────────────────────────────
    col_no_w = 25.0
    col_desc_w = W - ML - MR - col_no_w - 80
    col_amt_x = ML + col_no_w + col_desc_w
    col_amt_w = 80.0
    row_h = 14.0

    # Table header
    colored_rect(ML, y - row_h + 2, W - ML - MR, row_h, 0.15, 0.45, 0.72)
    stream_lines.append("1 1 1 rg")
    txt(ML + 4, y - 10, "#", size=8, bold=True)
    txt(ML + col_no_w + 4, y - 10, "Description", size=8, bold=True)
    txt(col_amt_x + 4, y - 10, f"Amount ({currency})", size=8, bold=True)
    stream_lines.append("0 0 0 rg")
    y -= row_h

    # Data rows
    subtotal = Decimal("0")
    for i, ln in enumerate(lines):
        if y < MB + 60:
            break  # simple overflow guard
        bg = 1.0 if i % 2 == 0 else 0.97
        colored_rect(ML, y - row_h + 2, W - ML - MR, row_h, bg, bg, bg)
        rule(ML, y - row_h + 2, W - ML - MR + ML, y - row_h + 2, w=0.15)

        amt = Decimal(str(ln.get("amount") or 0))
        subtotal += amt

        txt(ML + 4, y - 10, str(i + 1), size=8)
        desc = str(ln.get("description") or "")
        txt(ML + col_no_w + 4, y - 10, desc, size=8)

        # Negative amounts (discounts) in red
        if amt < 0:
            stream_lines.append("0.8 0.1 0.1 rg")
            txt(col_amt_x + 4, y - 10, f"-{_fmt_amount(abs(amt))}", size=8)
            stream_lines.append("0 0 0 rg")
        else:
            txt(col_amt_x + 4, y - 10, _fmt_amount(amt), size=8)

        y -= row_h

    # Totals block
    y -= 4
    rule(ML, y, W - MR, y)
    y -= 14

    def total_row(label: str, value: str, bold: bool = False) -> None:
        nonlocal y
        txt(col_amt_x - 80, y, label, size=9, bold=bold)
        txt(col_amt_x + 4, y, value, size=9, bold=bold)
        y -= 14

    total_row("Sub-total:", _fmt_amount(subtotal))
    total_row(f"Total ({currency}):", _fmt_amount(data.get("total_amount")), bold=True)

    try:
        paid = Decimal(str(data.get("paid_amount") or 0))
    except InvalidOperation:
        paid = Decimal("0")
    if paid > 0:
        total_row("Amount Paid:", _fmt_amount(paid))

    total_row("Balance Due:", balance_amount, bold=True)

    # ── Payment instructions ──────────────────────────────────────────────────
    if any(ps.values()):
        y -= 8
        rule(ML, y, W - MR, y)
        y -= 14
        txt(ML, y, "HOW TO PAY", size=10, bold=True)
        y -= 15

        if ps.get("mpesa_paybill") or ps.get("mpesa_business_no"):
            mpesa_parts = []
            if ps.get("mpesa_paybill"):
                mpesa_parts.append(f"M-PESA Paybill: {ps['mpesa_paybill']}")
            if ps.get("mpesa_business_no"):
                mpesa_parts.append(f"Account No: {ps['mpesa_business_no']}")
            if ps.get("mpesa_account_format"):
                mpesa_parts.append(f"(Use {ps['mpesa_account_format']})")
            UW = W - ML - MR
            for chunk in _wrap_text("  ".join(mpesa_parts), int(UW / 4.8)):
                txt(ML, y, chunk, size=9)
                y -= 13

        if ps.get("bank_name") or ps.get("bank_account_number"):
            bank_parts = []
            if ps.get("bank_name"):
                bank_parts.append(f"Bank: {ps['bank_name']}")
            if ps.get("bank_branch"):
                bank_parts.append(f"Branch: {ps['bank_branch']}")
            if ps.get("bank_account_name"):
                bank_parts.append(f"A/C Name: {ps['bank_account_name']}")
            if ps.get("bank_account_number"):
                bank_parts.append(f"A/C No: {ps['bank_account_number']}")
            UW = W - ML - MR
            for chunk in _wrap_text("  |  ".join(bank_parts), int(UW / 4.8)):
                txt(ML, y, chunk, size=9)
                y -= 13

        if ps.get("cash_payment_instructions"):
            UW = W - ML - MR
            for item in _parse_structured_lines(str(ps["cash_payment_instructions"])):
                y -= item["space_before"]
                x_item = ML + item["indent"]
                available = int((UW - item["indent"]) / 4.8)
                for i, chunk in enumerate(_wrap_text(item["text"], max(40, available))):
                    txt(x_item + (12 if i > 0 else 0), y, chunk, size=8, bold=item["bold"])
                    y -= 12

    # ── Footer / signature ────────────────────────────────────────────────────
    y -= 10
    rule(ML, y, W - MR, y)
    y -= 12
    txt(ML, y, "This is a computer-generated document. No signature required.", size=7)

    # ── Build PDF ─────────────────────────────────────────────────────────────
    stream_content = "\n".join(stream_lines).encode("latin-1", errors="replace")
    compressed = zlib.compress(stream_content)

    objects: dict[int, bytes] = {}
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>"
    objects[2] = b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"
    objects[3] = (
        f"<< /Type /Page /Parent 2 0 R "
        f"/MediaBox [0 0 {W:.0f} {H:.0f}] "
        f"/Contents 4 0 R "
        f"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>"
    ).encode()
    objects[4] = (
        f"<< /Length {len(compressed)} /Filter /FlateDecode >>\nstream\n".encode()
        + compressed
        + b"\nendstream"
    )
    objects[5] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    objects[6] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"

    return _build_pdf(objects, root_id=1)


def _wrap_text(text: str, max_chars: int) -> list[str]:
    """Naive word-boundary line wrap."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for w in words:
        if current and len(current) + 1 + len(w) > max_chars:
            lines.append(current)
            current = w
        else:
            current = f"{current} {w}".strip() if current else w
    if current:
        lines.append(current)
    return lines or [""]


def _parse_structured_lines(text: str) -> list[dict]:
    """
    Split structured text at ALL-CAPS section headers (BOYS:, NOTE:, etc.)
    and numbered items (1. 2. 3.) into renderable line dicts.
    """
    import re

    t = " ".join(text.split())

    # Insert marker before ALL-CAPS section headers in the middle of text
    t = re.sub(
        r"(?<=[.\)\s])([A-Z][A-Z\.]{1,}(?:\s+[A-Z\.]+){0,3}:)\s*",
        r"\n##HDR##\1\n",
        t,
    )
    # Handle header at very start
    t = re.sub(r"^([A-Z][A-Z\.]{1,}(?:\s+[A-Z\.]+){0,3}:)\s*", r"##HDR##\1\n", t)
    # Insert newline before numbered items like " 2. "
    t = re.sub(r"\s+(\d+\.\s)", r"\n\1", t)

    result: list[dict] = []
    for raw in t.split("\n"):
        raw = raw.strip()
        if not raw:
            continue
        if raw.startswith("##HDR##"):
            result.append({"text": raw[7:].strip(), "indent": 0, "bold": True, "space_before": 8})
        elif re.match(r"^\d+\.\s", raw):
            result.append({"text": raw, "indent": 14, "bold": False, "space_before": 2})
        else:
            result.append({"text": raw, "indent": 4, "bold": False, "space_before": 0})

    return result
