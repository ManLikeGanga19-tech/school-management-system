"""Fee Structure Sheet PDF generator.

Produces an A4 PDF showing:
  +------------------------------------------------------------------+
  |  [School Name]               FEE STRUCTURE - 2026               |
  |  [Address / Phone]           Class: PP1  |  New Student         |
  +------------------------------------------------------------------+
  |  #  Fee Item         Term 1     Term 2     Term 3               |
  |  1  Tuition Fee      20,000     20,000     20,000               |
  |  2  Activity Fee      1,500      1,500      1,500               |
  |  ...                                                            |
  |  ----------------------------------------------------------------|
  |     TOTAL            21,500     21,500     21,500               |
  +------------------------------------------------------------------+
  |  UNIFORM REQUIREMENTS & ASSESSMENT BOOKS                        |
  |  [uniform_details_text]                                          |
  +------------------------------------------------------------------+
  |  PAYMENT DETAILS                                                 |
  |  M-PESA Paybill: 123456  A/C: Adm No.                           |
  |  Bank: Equity  A/C: School Name  No: 01234567890                |
  +------------------------------------------------------------------+
"""
from __future__ import annotations

import zlib
from decimal import Decimal, InvalidOperation
from typing import Any


def _safe(text: str | None) -> str:
    if not text:
        return ""
    # Replace non-latin-1 characters with ASCII equivalents before encoding
    s = str(text)
    s = s.replace("\u2014", "-").replace("\u2013", "-").replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u2022", "*").replace("\u00a0", " ")
    return (
        s.encode("latin-1", errors="replace").decode("latin-1")
        .replace("\\", "\\\\")
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


def _fmt(value: Any) -> str:
    try:
        d = Decimal(str(value or 0))
        return f"{d:,.2f}"
    except (InvalidOperation, TypeError):
        return "0.00"


def generate_fee_structure_pdf(data: dict[str, Any]) -> bytes:
    """
    data keys:
      school_name, school_address, school_phone
      class_code, academic_year, student_type  (NEW|RETURNING)
      structure_no
      items: [{fee_item_name, charge_frequency, term_1_amount, term_2_amount, term_3_amount}]
      payment_settings: {mpesa_*, bank_*, uniform_details_text, assessment_books_amount, ...}
    """
    W, H = 595.0, 842.0
    ML, MR, MT, MB = 20.0, 20.0, 20.0, 20.0
    # Usable width
    UW = W - ML - MR

    stream_lines: list[str] = []

    def txt(x: float, y: float, text: str, size: int = 10, bold: bool = False) -> None:
        font = "F2" if bold else "F1"
        stream_lines.append(f"BT /{font} {size} Tf {x:.1f} {y:.1f} Td ({_safe(str(text))}) Tj ET")

    def rule(x1: float, y1: float, x2: float, y2: float, w: float = 0.4) -> None:
        stream_lines.append(f"{w} w {x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S")

    def colored_rect(x: float, y: float, w: float, h: float, r: float, g: float, b: float) -> None:
        stream_lines.append(
            f"{r:.2f} {g:.2f} {b:.2f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f 0 0 0 rg"
        )

    def section_header_bar(y_top: float, label: str) -> float:
        """Draw a light-blue section header bar. Returns new y after bar."""
        bar_h = 18.0
        colored_rect(ML, y_top - bar_h, UW, bar_h, 0.86, 0.92, 0.98)
        rule(ML, y_top, ML + UW, y_top, w=0.5)
        rule(ML, y_top - bar_h, ML + UW, y_top - bar_h, w=0.5)
        txt(ML + 6, y_top - 13, label, size=10, bold=True)
        return y_top - bar_h - 8

    # ── Extract data ──────────────────────────────────────────────────────────
    school_name = str(data.get("school_name") or "School")
    school_address = str(data.get("school_address") or "")
    school_phone = str(data.get("school_phone") or "")
    class_code = str(data.get("class_code") or "")
    academic_year = str(data.get("academic_year") or "")
    student_type = str(data.get("student_type") or "")
    student_type_label = ("New Student" if student_type == "NEW"
                          else "Returning Student" if student_type == "RETURNING"
                          else "")
    structure_no = str(data.get("structure_no") or "")
    items: list[dict] = data.get("items") or []
    ps: dict = data.get("payment_settings") or {}

    currency = "KES"

    # ── Header banner ─────────────────────────────────────────────────────────
    y = H - MT
    header_h = 66.0
    colored_rect(ML, y - header_h, UW, header_h, 0.09, 0.38, 0.65)
    stream_lines.append("1 1 1 rg")

    # Left: school identity
    txt(ML + 8, y - 18, school_name, size=16, bold=True)
    if school_address:
        txt(ML + 8, y - 32, school_address, size=9)
    if school_phone:
        txt(ML + 8, y - 45, f"Tel: {school_phone}", size=9)

    # Right: document title
    col_right = W - MR - 190
    title_text = f"FEE STRUCTURE - {academic_year}" if academic_year else "FEE STRUCTURE"
    txt(col_right, y - 18, title_text, size=14, bold=True)
    meta_parts = []
    if class_code:
        meta_parts.append(f"Class: {class_code.upper()}")
    if student_type_label:
        meta_parts.append(student_type_label)
    if meta_parts:
        txt(col_right, y - 33, "  |  ".join(meta_parts), size=10)
    if structure_no:
        txt(col_right, y - 47, f"Ref: {structure_no}", size=9)

    stream_lines.append("0 0 0 rg")
    y -= header_h + 10

    # ── Fee table ─────────────────────────────────────────────────────────────
    col_no_w = 26.0
    col_amt_w = 88.0
    col_desc_w = UW - col_no_w - 3 * col_amt_w
    col_t1_x = ML + col_no_w + col_desc_w
    col_t2_x = col_t1_x + col_amt_w
    col_t3_x = col_t2_x + col_amt_w
    row_h = 17.0

    # Table header row
    colored_rect(ML, y - row_h, UW, row_h, 0.15, 0.45, 0.72)
    stream_lines.append("1 1 1 rg")
    txt(ML + 5, y - 12, "#", size=9, bold=True)
    txt(ML + col_no_w + 5, y - 12, "Fee Item", size=9, bold=True)
    txt(col_t1_x + 5, y - 12, f"Term 1 ({currency})", size=9, bold=True)
    txt(col_t2_x + 5, y - 12, f"Term 2 ({currency})", size=9, bold=True)
    txt(col_t3_x + 5, y - 12, f"Term 3 ({currency})", size=9, bold=True)
    stream_lines.append("0 0 0 rg")
    y -= row_h

    totals = [Decimal("0"), Decimal("0"), Decimal("0")]
    row_num = 0
    for it in items:
        freq = str(it.get("charge_frequency") or "PER_TERM")
        name = str(it.get("fee_item_name") or "")
        t1 = Decimal(str(it.get("term_1_amount") or 0))
        t2 = Decimal(str(it.get("term_2_amount") or 0))
        t3 = Decimal(str(it.get("term_3_amount") or 0))

        row_num += 1
        bg = 1.0 if row_num % 2 != 0 else 0.96
        colored_rect(ML, y - row_h, UW, row_h, bg, bg, bg)
        rule(ML, y - row_h, ML + UW, y - row_h, w=0.2)

        if freq == "ONCE_PER_YEAR":
            name_disp = f"{name} (once/yr)"
        elif freq == "ONCE_EVER":
            name_disp = f"{name} (one-time)"
        else:
            name_disp = name

        txt(ML + 5, y - 12, str(row_num), size=10)
        txt(ML + col_no_w + 5, y - 12, name_disp, size=10)
        txt(col_t1_x + 5, y - 12, _fmt(t1) if t1 else "-", size=10)
        txt(col_t2_x + 5, y - 12, _fmt(t2) if t2 else "-", size=10)
        txt(col_t3_x + 5, y - 12, _fmt(t3) if t3 else "-", size=10)

        totals[0] += t1
        totals[1] += t2
        totals[2] += t3
        y -= row_h

    # Totals row
    y -= 3
    rule(ML, y, ML + UW, y, w=0.8)
    y -= 3
    colored_rect(ML, y - row_h, UW, row_h, 0.85, 0.92, 0.98)
    txt(ML + col_no_w + 5, y - 12, "TOTAL", size=11, bold=True)
    txt(col_t1_x + 5, y - 12, _fmt(totals[0]), size=11, bold=True)
    txt(col_t2_x + 5, y - 12, _fmt(totals[1]), size=11, bold=True)
    txt(col_t3_x + 5, y - 12, _fmt(totals[2]), size=11, bold=True)
    y -= row_h + 14

    # ── Uniform / assessment books block ─────────────────────────────────────
    uniform_text = str(ps.get("uniform_details_text") or "")
    assessment_amount = ps.get("assessment_books_amount")
    assessment_note = str(ps.get("assessment_books_note") or "Assessment Books")

    if uniform_text or assessment_amount:
        y = section_header_bar(y, "UNIFORM REQUIREMENTS & ASSESSMENT BOOKS")

        if assessment_amount:
            try:
                amt_str = _fmt(Decimal(str(assessment_amount)))
                txt(ML + 6, y, f"{assessment_note}: {currency} {amt_str}  (charged once per year)", size=9)
            except Exception:
                pass
            y -= 14

        if uniform_text:
            for item in _parse_structured_lines(uniform_text):
                y -= item["space_before"]
                x_item = ML + 6 + item["indent"]
                available = int((UW - 6 - item["indent"]) / 4.8)
                for i, chunk in enumerate(_wrap_text(item["text"], max(40, available))):
                    # continuation lines indent slightly more
                    x_chunk = x_item + (12 if i > 0 else 0)
                    txt(x_chunk, y, chunk, size=9, bold=item["bold"])
                    y -= 13
        y -= 8

    # ── Payment instructions ──────────────────────────────────────────────────
    has_payment = any([
        ps.get("mpesa_paybill"), ps.get("mpesa_business_no"),
        ps.get("bank_name"), ps.get("cash_payment_instructions"),
    ])
    if has_payment:
        y = section_header_bar(y, "PAYMENT DETAILS")

        if ps.get("mpesa_paybill") or ps.get("mpesa_business_no"):
            parts = []
            if ps.get("mpesa_paybill"):
                parts.append(f"M-PESA Paybill: {ps['mpesa_paybill']}")
            if ps.get("mpesa_business_no"):
                parts.append(f"Account No: {ps['mpesa_business_no']}")
            if ps.get("mpesa_account_format"):
                parts.append(f"(Use {ps['mpesa_account_format']})")
            for chunk in _wrap_text("  ".join(parts), int((UW - 6) / 4.8)):
                txt(ML + 6, y, chunk, size=9)
                y -= 13

        if ps.get("bank_name") or ps.get("bank_account_number"):
            bparts = []
            if ps.get("bank_name"):
                bparts.append(f"Bank: {ps['bank_name']}")
            if ps.get("bank_branch"):
                bparts.append(f"Branch: {ps['bank_branch']}")
            if ps.get("bank_account_name"):
                bparts.append(f"A/C Name: {ps['bank_account_name']}")
            if ps.get("bank_account_number"):
                bparts.append(f"A/C No: {ps['bank_account_number']}")
            for chunk in _wrap_text("  |  ".join(bparts), int((UW - 6) / 4.8)):
                txt(ML + 6, y, chunk, size=9)
                y -= 13

        if ps.get("cash_payment_instructions"):
            for item in _parse_structured_lines(str(ps["cash_payment_instructions"])):
                y -= item["space_before"]
                x_item = ML + 6 + item["indent"]
                available = int((UW - 6 - item["indent"]) / 4.8)
                for i, chunk in enumerate(_wrap_text(item["text"], max(40, available))):
                    x_chunk = x_item + (12 if i > 0 else 0)
                    txt(x_chunk, y, chunk, size=9, bold=item["bold"])
                    y -= 13
        y -= 6

    # ── Footer ────────────────────────────────────────────────────────────────
    y -= 6
    rule(ML, y, ML + UW, y, w=0.5)
    y -= 13
    txt(ML, y, "This is an official fee structure document. Fees are subject to annual review.", size=8)

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
    """Naive line wrap at word boundaries."""
    words = text.split()
    lines = []
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
    Parse structured text into renderable line dicts.

    Splits on:
    - ALL-CAPS section headers ending with colon: BOYS:, GIRLS:, P.E KITS:, NOTE:
    - Numbered list items: 1. 2. 3. etc.

    Returns list of: {text, indent, bold, space_before}
    """
    import re

    # Normalise whitespace
    t = " ".join(text.split())

    # Insert a marker before ALL-CAPS section headers in the middle of the string.
    # Pattern: preceded by non-alpha (space, dot, closing paren), then
    # one or more ALL-CAPS words (letters, dots, spaces) ending with colon.
    t = re.sub(
        r"(?<=[.\)\s])([A-Z][A-Z\.]{1,}(?:\s+[A-Z\.]+){0,3}:)\s*",
        r"\n##HDR##\1\n",
        t,
    )
    # Handle header at very start of string
    t = re.sub(r"^([A-Z][A-Z\.]{1,}(?:\s+[A-Z\.]+){0,3}:)\s*", r"##HDR##\1\n", t)

    # Insert newline before numbered items like " 2. " in the middle of text
    t = re.sub(r"\s+(\d+\.\s)", r"\n\1", t)

    result = []
    for raw in t.split("\n"):
        raw = raw.strip()
        if not raw:
            continue
        if raw.startswith("##HDR##"):
            label = raw[7:].strip()
            result.append({"text": label, "indent": 0, "bold": True, "space_before": 10})
        elif re.match(r"^\d+\.\s", raw):
            result.append({"text": raw, "indent": 14, "bold": False, "space_before": 2})
        else:
            result.append({"text": raw, "indent": 6, "bold": False, "space_before": 0})

    return result
