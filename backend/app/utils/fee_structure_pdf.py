"""Fee Structure Sheet PDF generator.

Produces an A4 PDF showing:
  ┌──────────────────────────────────────────────────────────────────┐
  │  [School Name]               FEE STRUCTURE — 2026               │
  │  [Address / Phone]           Class: PP1  |  New Student         │
  ├──────────────────────────────────────────────────────────────────┤
  │  #  Fee Item         Term 1     Term 2     Term 3               │
  │  1  Tuition Fee      20,000     20,000     20,000               │
  │  2  Activity Fee      1,500      1,500      1,500               │
  │  …                                                              │
  │  ─────────────────────────────────────────────────────          │
  │     TOTAL            21,500     21,500     21,500               │
  ├──────────────────────────────────────────────────────────────────┤
  │  UNIFORM REQUIREMENTS                                            │
  │  [uniform_details_text]                                          │
  ├──────────────────────────────────────────────────────────────────┤
  │  PAYMENT DETAILS                                                 │
  │  M-PESA Paybill: 123456  A/C: Adm No.                           │
  │  Bank: Equity  A/C: School Name  No: 01234567890                │
  └──────────────────────────────────────────────────────────────────┘
"""
from __future__ import annotations

import zlib
from decimal import Decimal, InvalidOperation
from typing import Any


def _safe(text: str | None) -> str:
    if not text:
        return ""
    return (
        str(text)
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

    # ── Header ────────────────────────────────────────────────────────────────
    y = H - MT
    colored_rect(ML, y - 50, W - ML - MR, 54, 0.09, 0.38, 0.65)
    stream_lines.append("1 1 1 rg")
    txt(ML + 6, y - 13, school_name, size=13, bold=True)
    if school_address:
        txt(ML + 6, y - 25, school_address, size=8)
    if school_phone:
        txt(ML + 6, y - 36, f"Tel: {school_phone}", size=8)

    col_right = W - MR - 160
    title_parts = [f"FEE STRUCTURE"]
    if academic_year:
        title_parts.append(f"— {academic_year}")
    txt(col_right, y - 13, " ".join(title_parts), size=11, bold=True)
    meta_parts = []
    if class_code:
        meta_parts.append(f"Class: {class_code.upper()}")
    if student_type_label:
        meta_parts.append(student_type_label)
    if meta_parts:
        txt(col_right, y - 26, "  |  ".join(meta_parts), size=8)
    if structure_no:
        txt(col_right, y - 38, f"Ref: {structure_no}", size=8)
    stream_lines.append("0 0 0 rg")
    y -= 60

    # ── Fee table ─────────────────────────────────────────────────────────────
    col_no_w = 22.0
    col_desc_w = W - ML - MR - col_no_w - 3 * 72.0
    col_t1_x = ML + col_no_w + col_desc_w
    col_t2_x = col_t1_x + 72.0
    col_t3_x = col_t2_x + 72.0
    row_h = 14.0

    # Header row
    colored_rect(ML, y - row_h + 2, W - ML - MR, row_h, 0.15, 0.45, 0.72)
    stream_lines.append("1 1 1 rg")
    txt(ML + 4, y - 10, "#", size=8, bold=True)
    txt(ML + col_no_w + 4, y - 10, "Fee Item", size=8, bold=True)
    txt(col_t1_x + 4, y - 10, f"Term 1 ({currency})", size=8, bold=True)
    txt(col_t2_x + 4, y - 10, f"Term 2 ({currency})", size=8, bold=True)
    txt(col_t3_x + 4, y - 10, f"Term 3 ({currency})", size=8, bold=True)
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
        bg = 1.0 if row_num % 2 == 0 else 0.97
        colored_rect(ML, y - row_h + 2, W - ML - MR, row_h, bg, bg, bg)
        rule(ML, y - row_h + 2, W - ML - MR + ML, y - row_h + 2, w=0.15)

        # Append frequency hint for non-PER_TERM items
        if freq == "ONCE_PER_YEAR":
            name_disp = f"{name} (once/yr)"
        elif freq == "ONCE_EVER":
            name_disp = f"{name} (one-time)"
        else:
            name_disp = name

        txt(ML + 4, y - 10, str(row_num), size=8)
        txt(ML + col_no_w + 4, y - 10, name_disp, size=8)
        txt(col_t1_x + 4, y - 10, _fmt(t1) if t1 else "—", size=8)
        txt(col_t2_x + 4, y - 10, _fmt(t2) if t2 else "—", size=8)
        txt(col_t3_x + 4, y - 10, _fmt(t3) if t3 else "—", size=8)

        totals[0] += t1
        totals[1] += t2
        totals[2] += t3
        y -= row_h

    # Totals row
    y -= 2
    rule(ML, y, W - MR, y)
    y -= row_h
    colored_rect(ML, y - row_h + 2, W - ML - MR, row_h, 0.88, 0.94, 0.99)
    txt(ML + col_no_w + 4, y - 10, "TOTAL", size=9, bold=True)
    txt(col_t1_x + 4, y - 10, _fmt(totals[0]), size=9, bold=True)
    txt(col_t2_x + 4, y - 10, _fmt(totals[1]), size=9, bold=True)
    txt(col_t3_x + 4, y - 10, _fmt(totals[2]), size=9, bold=True)
    y -= row_h + 8

    # ── Uniform / assessment books block ─────────────────────────────────────
    uniform_text = str(ps.get("uniform_details_text") or "")
    assessment_amount = ps.get("assessment_books_amount")
    assessment_note = str(ps.get("assessment_books_note") or "Assessment books")

    if uniform_text or assessment_amount:
        rule(ML, y, W - MR, y)
        y -= 14
        txt(ML, y, "UNIFORM REQUIREMENTS & ASSESSMENT BOOKS", size=9, bold=True)
        y -= 13
        if assessment_amount:
            try:
                amt_str = _fmt(Decimal(str(assessment_amount)))
                txt(ML, y, f"{assessment_note}: {currency} {amt_str} (once per year)", size=8)
            except Exception:
                pass
            y -= 13
        if uniform_text:
            # Wrap long text into multiple lines (simple split at ~90 chars)
            for chunk in _wrap_text(uniform_text, 90):
                txt(ML, y, chunk, size=8)
                y -= 12
        y -= 4

    # ── Payment instructions ──────────────────────────────────────────────────
    has_payment = any([
        ps.get("mpesa_paybill"), ps.get("bank_name"), ps.get("cash_payment_instructions")
    ])
    if has_payment:
        rule(ML, y, W - MR, y)
        y -= 14
        txt(ML, y, "PAYMENT DETAILS", size=9, bold=True)
        y -= 13

        if ps.get("mpesa_paybill") or ps.get("mpesa_business_no"):
            parts = []
            if ps.get("mpesa_paybill"):
                parts.append(f"M-PESA Paybill: {ps['mpesa_paybill']}")
            if ps.get("mpesa_business_no"):
                parts.append(f"Account No: {ps['mpesa_business_no']}")
            if ps.get("mpesa_account_format"):
                parts.append(f"(Use {ps['mpesa_account_format']})")
            txt(ML, y, "  ".join(parts), size=8)
            y -= 12

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
            txt(ML, y, "  |  ".join(bparts), size=8)
            y -= 12

        if ps.get("cash_payment_instructions"):
            txt(ML, y, str(ps["cash_payment_instructions"]), size=8)
            y -= 12

    # ── Footer ────────────────────────────────────────────────────────────────
    y -= 8
    rule(ML, y, W - MR, y)
    y -= 12
    txt(ML, y, "This is an official fee structure document. Fees are subject to annual review.", size=7)

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
