"""School Fees Invoice PDF generator — A4 teal-accent layout.

┌──────────────────────────────────────────────────────────────────┐
│  [SCHOOL NAME — large]                    ┌──────────────────┐  │
│  P.O. Box / Physical Address              │  INVOICE         │  │
│  Tel: …   Email: …                        │  No: INV-2026-…  │  │
│  Motto: …                                 │  Date: 01 Jan 26 │  │
│                                           └──────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  BILL TO                                                         │
│  Student: JANE DOE            Adm No: 2026/001                   │
│  Class:   PP1                 Term:   1 · 2026                   │
│  Parent:  MR JOHN DOE         Status: UNPAID                     │
├──────────────────────────────────────────────────────────────────┤
│  #   Description                          Amount (KES)           │
│  1   Tuition Fee (PP1)                    20,000.00              │
│  2   Activity Fee                          1,500.00              │
│      ──────────────────────────────────────────────             │
│      Sub-total                            21,500.00              │
│      TOTAL (KES)                          21,500.00              │
│      BALANCE DUE                          21,500.00              │
├──────────────────────────────────────────────────────────────────┤
│  HOW TO PAY                                                      │
│  M-PESA Paybill: 123456  A/C: Adm No.                           │
│  Bank: Equity  A/C: SCHOOL NAME  No: 01234567890                │
├──────────────────────────────────────────────────────────────────┤
│  _______________________                                         │
│  [Signatory Name]                                                │
│  [Title]                                                         │
│  Computer-generated — no signature required.                     │
└──────────────────────────────────────────────────────────────────┘
"""
from __future__ import annotations

import os
import zlib
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any


def _verify_url(code: str | None) -> str:
    """Short opaque verification URL embedded in the invoice QR."""
    if not code:
        return ""
    base = os.environ.get("FRONTEND_BASE_URL", "https://shulehq.co.ke").rstrip("/")
    return f"{base}/v/{code}"


# ── PDF primitives ────────────────────────────────────────────────────────────

def _safe(text: str | None) -> str:
    if not text:
        return ""
    s = str(text)
    s = s.replace("—", "-").replace("–", "-").replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"').replace("•", "*").replace(" ", " ")
    s = s.encode("latin-1", errors="replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


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


def _qr_matrix(data: str) -> list[list[bool]]:
    """QR module matrix for `data`; [] if the qrcode lib is unavailable."""
    try:
        import qrcode  # type: ignore
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=1,
            border=2,
        )
        qr.add_data(data)
        qr.make(fit=True)
        return qr.get_matrix()
    except Exception:
        return []


def _wrap_text(text: str, max_chars: int) -> list[str]:
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
    import re
    t = " ".join(text.split())
    t = re.sub(r"(?<=[.\)\s])([A-Z][A-Z\.]{1,}(?:\s+[A-Z\.]+){0,3}:)\s*", r"\n##HDR##\1\n", t)
    t = re.sub(r"^([A-Z][A-Z\.]{1,}(?:\s+[A-Z\.]+){0,3}:)\s*", r"##HDR##\1\n", t)
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


# ── Teal accent colour (distinct from fee-structure blue) ─────────────────────
_TR, _TG, _TB = 0.04, 0.44, 0.40        # header banner — dark teal
_LR, _LG, _LB = 0.88, 0.96, 0.95        # light teal tint for "Bill To" block
_AR, _AG, _AB = 0.10, 0.50, 0.46        # table header — medium teal


def generate_invoice_pdf(data: dict[str, Any]) -> bytes:
    """
    data: result from service.build_invoice_document()
    Returns raw PDF bytes.
    """
    W, H = 595.0, 842.0
    ML, MR, MT, MB = 20.0, 20.0, 20.0, 20.0
    UW = W - ML - MR

    stream_lines: list[str] = []

    def txt(x: float, y: float, text: str, size: int = 9, bold: bool = False) -> None:
        font = "F2" if bold else "F1"
        stream_lines.append(f"BT /{font} {size} Tf {x:.1f} {y:.1f} Td ({_safe(str(text))}) Tj ET")

    def rule(x1: float, y1: float, x2: float, y2: float, w: float = 0.4) -> None:
        stream_lines.append(f"{w} w {x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S")

    def crect(x: float, y: float, w: float, h: float, r: float, g: float, b: float) -> None:
        stream_lines.append(f"{r:.3f} {g:.3f} {b:.3f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f 0 0 0 rg")

    def stroke_rect(x: float, y: float, w: float, h: float, lw: float = 0.5) -> None:
        stream_lines.append(f"{lw} w {x:.1f} {y:.1f} {w:.1f} {h:.1f} re S")

    # ── Extract profile / school info ─────────────────────────────────────────
    profile = data.get("profile") or {}
    school_name     = str(profile.get("school_header") or profile.get("school_name") or "School")
    school_motto    = str(profile.get("school_motto") or "")
    po_box          = str(profile.get("po_box") or "")
    school_address  = str(profile.get("physical_address") or "")
    school_phone    = str(profile.get("phone") or "")
    school_email    = str(profile.get("email") or "")
    sig_name        = str(profile.get("authorized_signatory_name") or "")
    sig_title       = str(profile.get("authorized_signatory_title") or "Authorized Signatory")

    # ── Extract invoice data ──────────────────────────────────────────────────
    student_name  = str(data.get("student_name") or "—")
    admission_no  = str(data.get("admission_no") or "—")
    class_code    = str(data.get("class_code") or "—")
    parent_name   = str(data.get("parent_name") or "")
    invoice_no    = str(data.get("document_no") or data.get("invoice_no") or "—")
    currency      = str(data.get("currency") or profile.get("currency") or "KES")
    status        = str(data.get("status") or "DRAFT")

    term_number   = data.get("term_number")
    academic_year = data.get("academic_year")
    student_type  = str(data.get("student_type_snapshot") or "")

    raw_date = data.get("created_at") or ""
    try:
        dt = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
        date_str = dt.strftime("%d %b %Y")
    except Exception:
        date_str = str(raw_date)[:10] if raw_date else datetime.now(timezone.utc).strftime("%d %b %Y")

    term_label = f"Term {term_number}" if term_number else ""
    year_label = str(academic_year) if academic_year else ""
    term_year  = f"{term_label} · {year_label}" if term_label and year_label else (term_label or year_label)

    student_type_label = (
        "New Student"       if student_type == "NEW"
        else "Returning"    if student_type == "RETURNING"
        else ""
    )

    lines: list[dict] = data.get("lines") or []
    ps: dict = data.get("payment_settings") or {}

    # ── HEADER BANNER ─────────────────────────────────────────────────────────
    # Full-width teal banner
    banner_h = 76.0
    y = H - MT
    crect(ML, y - banner_h, UW, banner_h, _TR, _TG, _TB)

    stream_lines.append("1 1 1 rg")

    # Left block: school identity
    stream_lines.append(f"BT /F2 15 Tf {ML + 8:.1f} {y - 20:.1f} Td ({_safe(school_name)}) Tj ET")

    info_y = y - 34
    if po_box and school_address:
        txt(ML + 8, info_y, f"P.O. Box {po_box}  |  {school_address}", size=8)
        info_y -= 12
    elif po_box:
        txt(ML + 8, info_y, f"P.O. Box {po_box}", size=8)
        info_y -= 12
    elif school_address:
        txt(ML + 8, info_y, school_address, size=8)
        info_y -= 12

    contact_parts = []
    if school_phone:
        contact_parts.append(f"Tel: {school_phone}")
    if school_email:
        contact_parts.append(school_email)
    if contact_parts:
        txt(ML + 8, info_y, "  |  ".join(contact_parts), size=8)
        info_y -= 12

    if school_motto:
        stream_lines.append(f"0.85 0.97 0.96 rg")
        txt(ML + 8, info_y, school_motto, size=7, bold=False)
        stream_lines.append("1 1 1 rg")

    # Right block: "INVOICE" stamp + invoice details
    box_w = 168.0
    box_x = W - MR - box_w
    box_y = y - 4
    box_h = banner_h - 8

    # White background box
    stream_lines.append("1 1 1 rg")
    stream_lines.append(f"{box_x:.1f} {box_y - box_h:.1f} {box_w:.1f} {box_h:.1f} re f")
    stream_lines.append("0 0 0 rg")

    # "INVOICE" in large teal text inside the box
    stream_lines.append(f"{_TR:.3f} {_TG:.3f} {_TB:.3f} rg")
    stream_lines.append(f"BT /F2 20 Tf {box_x + 8:.1f} {box_y - 26:.1f} Td (INVOICE) Tj ET")
    stream_lines.append("0 0 0 rg")

    txt(box_x + 8, box_y - 40, f"No: {invoice_no}", size=8, bold=True)
    txt(box_x + 8, box_y - 52, f"Date: {date_str}", size=8)
    if term_year:
        txt(box_x + 8, box_y - 63, term_year, size=8)

    stream_lines.append("0 0 0 rg")
    y -= banner_h + 8

    # ── BILL TO BLOCK ─────────────────────────────────────────────────────────
    row_count = 3 if parent_name else 2
    block_h = 14.0 * row_count + 22

    crect(ML, y - block_h, UW, block_h, _LR, _LG, _LB)
    stroke_rect(ML, y - block_h, UW, block_h, lw=0.3)

    # Section label
    stream_lines.append(f"{_TR:.3f} {_TG:.3f} {_TB:.3f} rg")
    stream_lines.append(f"BT /F2 7 Tf {ML + 6:.1f} {y - 11:.1f} Td (BILL TO) Tj ET")
    stream_lines.append("0 0 0 rg")

    col2 = ML + UW * 0.52
    row_y = y - 22

    txt(ML + 6, row_y, "Student:", size=8, bold=True)
    txt(ML + 52, row_y, student_name.upper(), size=8)
    txt(col2, row_y, "Adm No:", size=8, bold=True)
    txt(col2 + 46, row_y, admission_no, size=8)
    row_y -= 14

    txt(ML + 6, row_y, "Class:", size=8, bold=True)
    txt(ML + 52, row_y, class_code.upper(), size=8)
    if student_type_label:
        txt(col2, row_y, "Type:", size=8, bold=True)
        txt(col2 + 46, row_y, student_type_label, size=8)
    txt(col2 + 120, row_y, f"Status: {status}", size=8, bold=True)
    row_y -= 14

    if parent_name:
        txt(ML + 6, row_y, "Parent/Guardian:", size=8, bold=True)
        txt(ML + 86, row_y, parent_name, size=8)

    y -= block_h + 10

    # ── FEE LINES TABLE ───────────────────────────────────────────────────────
    col_no_w   = 24.0
    col_amt_w  = 85.0
    col_desc_w = UW - col_no_w - col_amt_w
    col_amt_x  = ML + col_no_w + col_desc_w
    row_h      = 14.0

    # Table header
    crect(ML, y - row_h + 2, UW, row_h, _AR, _AG, _AB)
    stream_lines.append("1 1 1 rg")
    txt(ML + 4, y - 10, "#", size=8, bold=True)
    txt(ML + col_no_w + 4, y - 10, "Description", size=8, bold=True)
    txt(col_amt_x + 4, y - 10, f"Amount ({currency})", size=8, bold=True)
    stream_lines.append("0 0 0 rg")
    y -= row_h

    # Split sums so the totals block can show "Fees subtotal /
    # Scholarship discount / Net" instead of a confusing single line.
    items_subtotal = Decimal("0")
    scholarship_discount = Decimal("0")
    other_credits = Decimal("0")

    for i, ln in enumerate(lines):
        if y < MB + 80:
            break
        bg = 1.0 if i % 2 == 0 else 0.975
        crect(ML, y - row_h + 2, UW, row_h, bg, bg, bg)
        rule(ML, y - row_h + 2, ML + UW, y - row_h + 2, w=0.1)

        amt = Decimal(str(ln.get("amount") or 0))
        meta = ln.get("meta") if isinstance(ln.get("meta"), dict) else {}
        if amt < 0 and meta.get("scholarship_id"):
            scholarship_discount += -amt  # accumulate as positive
        elif amt < 0:
            other_credits += -amt
        else:
            items_subtotal += amt

        txt(ML + 4, y - 10, str(i + 1), size=8)
        txt(ML + col_no_w + 4, y - 10, str(ln.get("description") or ""), size=8)

        if amt < 0:
            stream_lines.append("0.75 0.10 0.10 rg")
            txt(col_amt_x + 4, y - 10, f"-{_fmt_amount(abs(amt))}", size=8)
            stream_lines.append("0 0 0 rg")
        else:
            txt(col_amt_x + 4, y - 10, _fmt_amount(amt), size=8)

        y -= row_h

    # ── Totals ────────────────────────────────────────────────────────────────
    y -= 4
    rule(ML, y, ML + UW, y, w=0.5)
    y -= 14

    def total_row(label: str, value: str, bold: bool = False, color_teal: bool = False) -> None:
        nonlocal y
        if color_teal:
            stream_lines.append(f"{_TR:.3f} {_TG:.3f} {_TB:.3f} rg")
        txt(col_amt_x - 90, y, label, size=9, bold=bold)
        txt(col_amt_x + 4, y, value, size=9, bold=bold)
        if color_teal:
            stream_lines.append("0 0 0 rg")
        y -= 14

    # Always show items subtotal so the math is auditable.
    total_row("Fees Subtotal:", _fmt_amount(items_subtotal))
    if scholarship_discount > 0:
        # Render as a clearly-marked negative line so parents see exactly
        # what was waived. Tinted teal for emphasis (matches header banner).
        total_row(
            "Scholarship Discount:",
            f"-{_fmt_amount(scholarship_discount)}",
            color_teal=True,
        )
    if other_credits > 0:
        total_row("Other Credits:", f"-{_fmt_amount(other_credits)}")
    total_row(f"Total ({currency}):", _fmt_amount(data.get("total_amount")), bold=True)

    # ── Phase N4 — Prior balance block ────────────────────────────────────
    # Everything the student owes OUTSIDE of this invoice — outstanding
    # carry-forward debits (older adjustments) and available credit on
    # account. Bundled CF is already reflected in the invoice's Total, so
    # this section only shows what's still open elsewhere.
    prior = data.get("prior_balance") or None
    if prior:
        try:
            prior_debit = Decimal(str(prior.get("debit") or 0))
            prior_credit = Decimal(str(prior.get("credit") or 0))
            prior_net = Decimal(str(prior.get("net") or 0))
        except (InvalidOperation, TypeError):
            prior_debit = prior_credit = prior_net = Decimal("0")
        if prior_debit > 0 or prior_credit > 0:
            # Small heading + divider so the parent knows this is a separate
            # note, not a component of THIS invoice's total.
            stream_lines.append(f"{_TR:.3f} {_TG:.3f} {_TB:.3f} rg")
            txt(col_amt_x - 90, y, "PRIOR BALANCE (not in this invoice):", size=8, bold=True)
            stream_lines.append("0 0 0 rg")
            y -= 12
            if prior_debit > 0:
                total_row("Previously owed:", _fmt_amount(prior_debit))
            if prior_credit > 0:
                # Parenthesised per accounting convention for credit balances.
                total_row("Credit on account:", f"({_fmt_amount(prior_credit)})")
            if prior_debit > 0 and prior_credit > 0:
                # Only bother with the net line when both sides exist —
                # otherwise it's just repeating the single line above.
                total_row(
                    "Net prior position:",
                    _fmt_amount(prior_net) if prior_net >= 0 else f"({_fmt_amount(abs(prior_net))})",
                    bold=True,
                )

    try:
        paid = Decimal(str(data.get("paid_amount") or 0))
    except InvalidOperation:
        paid = Decimal("0")
    if paid > 0:
        total_row("Amount Paid:", _fmt_amount(paid))

    total_row("Balance Due:", _fmt_amount(data.get("balance_amount")), bold=True, color_teal=True)

    # ── HOW TO PAY ────────────────────────────────────────────────────────────
    if any(ps.values()):
        y -= 8
        rule(ML, y, ML + UW, y, w=0.4)
        y -= 14

        stream_lines.append(f"{_TR:.3f} {_TG:.3f} {_TB:.3f} rg")
        txt(ML, y, "HOW TO PAY", size=10, bold=True)
        stream_lines.append("0 0 0 rg")
        y -= 14

        if ps.get("mpesa_paybill") or ps.get("mpesa_business_no"):
            parts = []
            if ps.get("mpesa_paybill"):
                parts.append(f"M-PESA Paybill: {ps['mpesa_paybill']}")
            if ps.get("mpesa_business_no"):
                parts.append(f"Account No: {ps['mpesa_business_no']}")
            if ps.get("mpesa_account_format"):
                parts.append(f"(Use {ps['mpesa_account_format']})")
            for chunk in _wrap_text("  ".join(parts), int(UW / 5.5)):
                txt(ML, y, chunk, size=9)
                y -= 13

        if ps.get("bank_name") or ps.get("bank_account_number"):
            parts = []
            if ps.get("bank_name"):
                parts.append(f"Bank: {ps['bank_name']}")
            if ps.get("bank_branch"):
                parts.append(f"Branch: {ps['bank_branch']}")
            if ps.get("bank_account_name"):
                parts.append(f"A/C Name: {ps['bank_account_name']}")
            if ps.get("bank_account_number"):
                parts.append(f"A/C No: {ps['bank_account_number']}")
            for chunk in _wrap_text("  |  ".join(parts), int(UW / 5.5)):
                txt(ML, y, chunk, size=9)
                y -= 13

        if ps.get("cash_payment_instructions"):
            for item in _parse_structured_lines(str(ps["cash_payment_instructions"])):
                y -= item["space_before"]
                x_item = ML + item["indent"]
                available = int((UW - item["indent"]) / 5.5)
                for i, chunk in enumerate(_wrap_text(item["text"], max(40, available))):
                    txt(x_item + (12 if i > 0 else 0), y, chunk, size=8, bold=item["bold"])
                    y -= 12

    # ── FOOTER / SIGNATORY ────────────────────────────────────────────────────
    y -= 10
    rule(ML, y, ML + UW, y, w=0.3)
    y -= 16
    qr_anchor_y = y + 6

    if sig_name or sig_title:
        txt(ML, y, "________________________", size=8)
        y -= 12
        if sig_name:
            txt(ML, y, sig_name, size=8, bold=True)
            y -= 11
        txt(ML, y, sig_title, size=8)
        y -= 14

    # ── VERIFICATION QR (bottom-right) ────────────────────────────────────────
    qr_enabled = bool(profile.get("qr_enabled", True))
    verify_url = _verify_url(data.get("verify_code")) if qr_enabled else ""
    matrix = _qr_matrix(verify_url) if verify_url else []
    if matrix:
        n = len(matrix)
        qr_size = 58.0
        module = qr_size / n
        qr_x = ML + UW - qr_size
        stream_lines.append("0 0 0 rg")
        for r, row in enumerate(matrix):
            for c, on in enumerate(row):
                if on:
                    mx = qr_x + c * module
                    my = qr_anchor_y - (r + 1) * module
                    stream_lines.append(f"{mx:.2f} {my:.2f} {module:.2f} {module:.2f} re f")
        txt(qr_x, qr_anchor_y - qr_size - 8, "Scan to verify", size=6)

    # ── BUILD PDF ─────────────────────────────────────────────────────────────
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
