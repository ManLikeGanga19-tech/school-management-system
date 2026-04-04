"""CBC Learner Progress Report PDF generator.

Produces a full-A4 branded PDF using the shared pdf_base primitives.
Layout:
  • Branded school header (banner with school name + title box)
  • Learner information block (two-column bio)
  • Per learning area: performance level table (sub-strand rows with EE/ME/AE/BE badges)
  • Performance key legend
  • Class teacher remarks block
  • Principal remarks block
  • Branded footer

Performance levels:
  BE — Below Expectation   (red)
  AE — Approaching Expectation (amber)
  ME — Meeting Expectation (green)
  EE — Exceeding Expectation  (dark green)
"""
from __future__ import annotations

import zlib
from typing import Any

from .pdf_base import (
    A4_H, A4_W, MARGIN_B, MARGIN_L, MARGIN_R, MARGIN_T, USABLE_W,
    PageCanvas, _build_pdf, _hex_to_rgb, _lighten, _darken, _safe,
    draw_footer, draw_remarks_block, draw_school_header, draw_section_label,
    draw_student_bio,
)

# ── Performance level constants ───────────────────────────────────────────────

_LEVEL_COLORS: dict[str, tuple[float, float, float]] = {
    "EE": (0.10, 0.55, 0.20),   # dark green
    "ME": (0.30, 0.75, 0.30),   # green
    "AE": (0.92, 0.65, 0.10),   # amber
    "BE": (0.85, 0.20, 0.20),   # red
}
_LEVEL_LABELS: dict[str, str] = {
    "EE": "Exceeding Expectation",
    "ME": "Meeting Expectation",
    "AE": "Approaching Expectation",
    "BE": "Below Expectation",
}


# ── Layout helpers ────────────────────────────────────────────────────────────

def _draw_la_table(
    c: PageCanvas,
    *,
    brand_rgb: tuple[float, float, float],
    la: dict[str, Any],
    y: float,
) -> float:
    """
    Draw one learning area block (header + strands + sub-strand rows).
    Returns y coordinate below the block.
    """
    row_h = 14.0
    light = _lighten(brand_rgb, 0.92)
    dark = _darken(brand_rgb, 0.72)

    # Sub-strand name column width + level badge column + observations column
    col_ss_w = USABLE_W * 0.50
    col_lv_w = 46.0
    col_ob_w = USABLE_W - col_ss_w - col_lv_w

    # ── Learning area header bar ──
    la_label = la["learning_area_name"]
    band = la.get("grade_band", "").replace("_", " ")
    if band:
        la_label += f"  [{band}]"
    c.rect_fill(MARGIN_L, y - row_h, USABLE_W, row_h, dark)
    c.text(MARGIN_L + 5, y - row_h + 4, la_label, size=9, bold=True, color=(1.0, 1.0, 1.0))
    y -= row_h

    for strand in la.get("strands", []):
        if not strand.get("sub_strands"):
            continue

        # Strand sub-header
        c.rect_fill(MARGIN_L, y - row_h, USABLE_W, row_h, light)
        c.line(MARGIN_L, y - row_h, MARGIN_L + USABLE_W, y - row_h, rgb=(0.80, 0.80, 0.80))
        c.text(MARGIN_L + 8, y - row_h + 4, strand["strand_name"], size=8, bold=True, color=brand_rgb)
        y -= row_h

        # Column headers
        c.text(MARGIN_L + 10, y - row_h + 4, "Sub-strand", size=7, bold=True, color=(0.4, 0.4, 0.4))
        c.text(MARGIN_L + col_ss_w + 4, y - row_h + 4, "Level", size=7, bold=True, color=(0.4, 0.4, 0.4))
        c.text(MARGIN_L + col_ss_w + col_lv_w + 4, y - row_h + 4, "Teacher Observations", size=7, bold=True, color=(0.4, 0.4, 0.4))
        c.line(MARGIN_L, y - row_h, MARGIN_L + USABLE_W, y - row_h, rgb=(0.85, 0.85, 0.85))
        y -= row_h

        for i, ss in enumerate(strand.get("sub_strands", [])):
            level = (ss.get("performance_level") or "").upper()
            obs = ss.get("teacher_observations") or ""

            # Alternating row tint
            if i % 2 == 0:
                c.rect_fill(MARGIN_L, y - row_h, USABLE_W, row_h, (0.97, 0.97, 0.97))

            # Sub-strand name (truncate to fit)
            ss_name = ss.get("sub_strand_name", "")
            c.text(MARGIN_L + 10, y - row_h + 4, ss_name, size=8)

            # Level badge
            badge_rgb = _LEVEL_COLORS.get(level, (0.75, 0.75, 0.75))
            badge_x = MARGIN_L + col_ss_w + 3
            c.rect_fill(badge_x, y - row_h + 2, col_lv_w - 6, row_h - 4, badge_rgb)
            c.text(badge_x + 4, y - row_h + 4, level if level else "—", size=8, bold=True, color=(1.0, 1.0, 1.0))

            # Observations (truncated)
            if obs:
                obs_disp = obs[:62] + ("..." if len(obs) > 62 else "")
                c.text(MARGIN_L + col_ss_w + col_lv_w + 4, y - row_h + 4, obs_disp, size=7)

            c.line(MARGIN_L, y - row_h, MARGIN_L + USABLE_W, y - row_h, rgb=(0.90, 0.90, 0.90), lw=0.3)
            y -= row_h

    y -= 4  # gap between learning areas
    return y


def _draw_legend(
    c: PageCanvas,
    *,
    brand_rgb: tuple[float, float, float],
    y: float,
) -> float:
    """Draw the performance level legend strip. Returns y below."""
    bar_h = 14.0
    light = _lighten(brand_rgb, 0.92)
    c.rect_fill(MARGIN_L, y - bar_h, USABLE_W, bar_h, light)
    c.line(MARGIN_L, y, MARGIN_L + USABLE_W, y, rgb=brand_rgb, lw=1.0)
    c.text(MARGIN_L + 5, y - bar_h + 4, "PERFORMANCE KEY:", size=7, bold=True, color=brand_rgb)

    legend_x = MARGIN_L + 105
    for code in ("EE", "ME", "AE", "BE"):
        badge_rgb = _LEVEL_COLORS[code]
        c.rect_fill(legend_x, y - bar_h + 2, 22, bar_h - 4, badge_rgb)
        c.text(legend_x + 4, y - bar_h + 4, code, size=7, bold=True, color=(1.0, 1.0, 1.0))
        c.text(legend_x + 26, y - bar_h + 4, _LEVEL_LABELS[code], size=7)
        legend_x += 120

    return y - bar_h - 4


# ── Main PDF generator ────────────────────────────────────────────────────────

def generate_cbc_report_pdf(data: dict[str, Any], branding: dict[str, Any] | None = None) -> bytes:
    """
    Generate a full-A4 branded CBC Learner Progress Report PDF.

    data      — from service.get_learner_report()
    branding  — {school_name, school_address, school_phone, school_email, brand_color}
                Falls back to plain values if None.
    Returns raw PDF bytes.
    """
    b = branding or {}
    school_name = b.get("school_name") or "School"
    school_address = b.get("school_address") or ""
    school_phone = b.get("school_phone") or ""
    school_email = b.get("school_email") or ""
    brand_hex = b.get("brand_color") or "#1A4C8B"
    brand_rgb = _hex_to_rgb(brand_hex)

    term_name = data.get("term_name", "")
    academic_year = data.get("academic_year", "")
    doc_subtitle = f"{term_name}  ·  {academic_year}" if academic_year else term_name

    c = PageCanvas()

    # ── Header ────────────────────────────────────────────────────────────────
    y = draw_school_header(
        c,
        school_name=school_name,
        school_address=school_address,
        school_phone=school_phone,
        school_email=school_email,
        brand_rgb=brand_rgb,
        doc_title="CBC LEARNER PROGRESS REPORT",
        doc_subtitle=doc_subtitle,
        y_top=A4_H - MARGIN_T,
    )

    # ── Learner bio ───────────────────────────────────────────────────────────
    bio_fields = [
        ("Learner Name", data.get("student_name", "—")),
        ("Gender", (data.get("gender") or "—").title()),
        ("Admission No.", data.get("admission_no", "—")),
        ("Date of Birth", data.get("date_of_birth") or "—"),
        ("Class", data.get("class_name", "—")),
        ("Academic Year", data.get("academic_year") or "—"),
        ("Term", term_name),
        ("Grade Band", (data.get("learning_areas") or [{}])[0].get("grade_band", "").replace("_", " ") if data.get("learning_areas") else "—"),
    ]
    y = draw_student_bio(c, brand_rgb=brand_rgb, fields=bio_fields, y_top=y)

    # ── Learning areas ────────────────────────────────────────────────────────
    y = draw_section_label(c, brand_rgb=brand_rgb, label="LEARNING AREA ASSESSMENT", y_top=y)

    for la in data.get("learning_areas", []):
        # Simple overflow guard — stop drawing if too close to footer
        if y < MARGIN_B + 80:
            break
        y = _draw_la_table(c, brand_rgb=brand_rgb, la=la, y=y)

    # ── Performance key legend ────────────────────────────────────────────────
    if y > MARGIN_B + 30:
        y = _draw_legend(c, brand_rgb=brand_rgb, y=y)

    # ── Remarks ───────────────────────────────────────────────────────────────
    if y > MARGIN_B + 70:
        y = draw_remarks_block(
            c,
            brand_rgb=brand_rgb,
            label="CLASS TEACHER REMARKS",
            comment=data.get("class_teacher_comment") or "",
            conduct=data.get("conduct") or None,
            y_top=y,
            box_h=44.0,
        )

    if y > MARGIN_B + 60:
        y = draw_remarks_block(
            c,
            brand_rgb=brand_rgb,
            label="PRINCIPAL / HEAD TEACHER REMARKS",
            comment=data.get("principal_comment") or "",
            conduct=None,
            y_top=y,
            box_h=38.0,
        )

    # ── Footer ────────────────────────────────────────────────────────────────
    report_ref = f"Report No: {str(data.get('enrollment_id', ''))[:8].upper()}"
    draw_footer(
        c,
        brand_rgb=brand_rgb,
        next_term_begins=data.get("next_term_begins") or "",
        report_ref=report_ref,
    )

    # ── Assemble PDF ──────────────────────────────────────────────────────────
    stream_bytes = c.stream()
    compressed = zlib.compress(stream_bytes, level=6)

    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: (
            f"<< /Type /Page /Parent 2 0 R "
            f"/MediaBox [0 0 {A4_W:.0f} {A4_H:.0f}] "
            f"/Contents 4 0 R "
            f"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>"
        ).encode(),
        4: (
            f"<< /Length {len(compressed)} /Filter /FlateDecode >>\nstream\n".encode()
            + compressed
            + b"\nendstream"
        ),
        5: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        6: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    }

    return _build_pdf(objects, root_id=1)


# ── Bulk PDF: merge multiple per-student PDFs ─────────────────────────────────

def merge_pdfs(pdf_list: list[bytes]) -> bytes:
    """
    Naively merge a list of single-page PDFs into one multi-page PDF.
    Each input must be a single-page PDF produced by generate_cbc_report_pdf().
    """
    if not pdf_list:
        return b""
    if len(pdf_list) == 1:
        return pdf_list[0]

    # Re-render all pages into a fresh multi-page document.
    # Since each source PDF has its own object numbering we re-extract the page
    # stream content and rebuild a single PDF with a shared resource dict.
    # Simpler approach: generate each student's canvas stream and embed them
    # all in one PDF. We call generate_cbc_report_pdf per student anyway so
    # we already have the per-page streams; the easiest correct merge is to
    # parse each PDF's content stream back out.  For now, produce a sequential
    # multi-stream document.

    # Extract compressed stream from each single-page PDF
    import re
    streams: list[bytes] = []
    for pdf_bytes in pdf_list:
        # Find "stream\n...\nendstream" — grab the raw bytes between markers
        m = re.search(rb"stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.DOTALL)
        if m:
            streams.append(m.group(1))

    if not streams:
        return pdf_list[0]

    n = len(streams)
    objects: dict[int, bytes] = {}

    # Catalog (1) + Pages (2) + n pages (3..n+2) + n streams (n+3..2n+2)
    # + fonts shared (2n+3, 2n+4)
    font_f1 = 2 * n + 3
    font_f2 = 2 * n + 4

    kid_ids = list(range(3, 3 + n))
    stream_ids = list(range(3 + n, 3 + 2 * n))

    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    kids_str = " ".join(f"{k} 0 R" for k in kid_ids)
    objects[2] = f"<< /Type /Pages /Kids [{kids_str}] /Count {n} >>".encode()

    for i, (page_id, stream_id, stream_data) in enumerate(zip(kid_ids, stream_ids, streams)):
        objects[page_id] = (
            f"<< /Type /Page /Parent 2 0 R "
            f"/MediaBox [0 0 {A4_W:.0f} {A4_H:.0f}] "
            f"/Contents {stream_id} 0 R "
            f"/Resources << /Font << /F1 {font_f1} 0 R /F2 {font_f2} 0 R >> >> >>"
        ).encode()
        objects[stream_id] = (
            f"<< /Length {len(stream_data)} /Filter /FlateDecode >>\nstream\n".encode()
            + stream_data
            + b"\nendstream"
        )

    objects[font_f1] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    objects[font_f2] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"

    return _build_pdf(objects, root_id=1)
