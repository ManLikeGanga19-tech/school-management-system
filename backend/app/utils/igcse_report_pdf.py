"""IGCSE Learner Progress Report PDF generator.

Produces a full-A4 branded PDF using the shared pdf_base primitives.
Layout:
  • Branded school header (banner + title box)
  • Learner information block (two-column bio)
  • Subject grades table (Subject | Grade | % | Effort | Teacher Comment)
  • Grade key legend (A*-G + U)
  • Class teacher remarks + principal remarks
  • Branded footer

IGCSE Grade scale:
  A*  90-100  Outstanding
  A   80-89   Excellent
  B   70-79   Good
  C   60-69   Satisfactory
  D   50-59   Below Satisfactory
  E   40-49   Marginal
  F   30-39   Unsatisfactory
  G   20-29   Very Poor
  U   0-19    Ungraded
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

# ── Grade meta ────────────────────────────────────────────────────────────────

_GRADE_DATA = [
    ("A*", (0.06, 0.50, 0.20), "Outstanding",        90, 100),
    ("A",  (0.15, 0.65, 0.30), "Excellent",           80, 89),
    ("B",  (0.30, 0.75, 0.40), "Good",                70, 79),
    ("C",  (0.60, 0.80, 0.20), "Satisfactory",        60, 69),
    ("D",  (0.90, 0.70, 0.10), "Below Satisfactory",  50, 59),
    ("E",  (0.92, 0.55, 0.10), "Marginal",            40, 49),
    ("F",  (0.85, 0.30, 0.20), "Unsatisfactory",      30, 39),
    ("G",  (0.80, 0.20, 0.20), "Very Poor",           20, 29),
    ("U",  (0.55, 0.10, 0.10), "Ungraded",             0, 19),
]

_GRADE_COLOR: dict[str, tuple[float, float, float]] = {g: rgb for g, rgb, *_ in _GRADE_DATA}
_GRADE_LABEL: dict[str, str] = {g: lbl for g, _, lbl, *_ in _GRADE_DATA}

EFFORT_STARS = {
    "5": "★★★★★",
    "4": "★★★★☆",
    "3": "★★★☆☆",
    "2": "★★☆☆☆",
    "1": "★☆☆☆☆",
}


def _grade_color(grade: str) -> tuple[float, float, float]:
    g = (grade or "").strip().upper()
    return _GRADE_COLOR.get(g, (0.75, 0.75, 0.75))


def _effort_str(effort: Any) -> str:
    e = str(effort or "").strip()
    return EFFORT_STARS.get(e, e or "—")


# ── Main PDF generator ────────────────────────────────────────────────────────

def generate_igcse_report_pdf(data: dict[str, Any], branding: dict[str, Any] | None = None) -> bytes:
    """
    Generate a full-A4 branded IGCSE Learner Progress Report PDF.

    data      — from service or route:
      student_name, admission_no, gender, date_of_birth,
      class_name, class_code, term_name, academic_year,
      class_teacher_comment, principal_comment, conduct, next_term_begins,
      subjects: [
        { subject_name, grade, percentage, effort, teacher_comment }
      ]
    branding  — {school_name, school_address, school_phone, school_email, brand_color}
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
        doc_title="IGCSE LEARNER PROGRESS REPORT",
        doc_subtitle=doc_subtitle,
        y_top=A4_H - MARGIN_T,
    )

    # ── Learner bio ───────────────────────────────────────────────────────────
    bio_fields = [
        ("Learner Name", data.get("student_name", "—")),
        ("Gender", (data.get("gender") or "—").title()),
        ("Admission No.", data.get("admission_no", "—")),
        ("Date of Birth", data.get("date_of_birth") or "—"),
        ("Class / Form", data.get("class_name", "—")),
        ("Academic Year", data.get("academic_year") or "—"),
        ("Term", term_name),
        ("Examination Session", data.get("exam_session") or academic_year or "—"),
    ]
    y = draw_student_bio(c, brand_rgb=brand_rgb, fields=bio_fields, y_top=y)

    # ── Subject grades table ──────────────────────────────────────────────────
    y = draw_section_label(c, brand_rgb=brand_rgb, label="SUBJECT PERFORMANCE", y_top=y)

    subjects = data.get("subjects") or []
    row_h = 15.0
    dark = _darken(brand_rgb, 0.72)
    light = _lighten(brand_rgb, 0.92)

    # Column widths
    col_sub = USABLE_W * 0.35   # Subject name
    col_grd = 36.0              # Grade badge
    col_pct = 48.0              # Percentage
    col_eff = 70.0              # Effort stars
    col_cmt = USABLE_W - col_sub - col_grd - col_pct - col_eff  # Teacher comment

    # Table header row
    c.rect_fill(MARGIN_L, y - row_h, USABLE_W, row_h, dark)
    header_color = (1.0, 1.0, 1.0)
    c.text(MARGIN_L + 5, y - row_h + 4, "Subject", size=8, bold=True, color=header_color)
    c.text(MARGIN_L + col_sub + 4, y - row_h + 4, "Grade", size=8, bold=True, color=header_color)
    c.text(MARGIN_L + col_sub + col_grd + 4, y - row_h + 4, "Score %", size=8, bold=True, color=header_color)
    c.text(MARGIN_L + col_sub + col_grd + col_pct + 4, y - row_h + 4, "Effort", size=8, bold=True, color=header_color)
    c.text(MARGIN_L + col_sub + col_grd + col_pct + col_eff + 4, y - row_h + 4, "Teacher Comment", size=8, bold=True, color=header_color)
    y -= row_h

    for i, sub in enumerate(subjects):
        if y < MARGIN_B + 80:
            break  # Simple overflow guard

        grade = str(sub.get("grade") or "").strip().upper()
        pct = sub.get("percentage")
        effort = sub.get("effort")
        comment = str(sub.get("teacher_comment") or "")

        # Alternating row background
        if i % 2 == 0:
            c.rect_fill(MARGIN_L, y - row_h, USABLE_W, row_h, (0.97, 0.97, 0.97))

        # Subject name
        c.text(MARGIN_L + 5, y - row_h + 4, sub.get("subject_name", "—"), size=9)

        # Grade badge
        badge_rgb = _grade_color(grade)
        badge_x = MARGIN_L + col_sub + 2
        c.rect_fill(badge_x, y - row_h + 2, col_grd - 4, row_h - 4, badge_rgb)
        c.text(badge_x + 6, y - row_h + 4, grade if grade else "—", size=9, bold=True, color=(1.0, 1.0, 1.0))

        # Percentage
        if pct is not None:
            pct_str = f"{float(pct):.1f}%" if pct != "" else "—"
        else:
            pct_str = "—"
        c.text(MARGIN_L + col_sub + col_grd + 4, y - row_h + 4, pct_str, size=9)

        # Effort stars (stored as digit string 1-5)
        effort_disp = _effort_str(effort)
        c.text(MARGIN_L + col_sub + col_grd + col_pct + 4, y - row_h + 4, effort_disp, size=8, color=(0.85, 0.60, 0.10))

        # Teacher comment (truncated)
        if comment:
            cmt_disp = comment[:55] + ("…" if len(comment) > 55 else "")
            c.text(MARGIN_L + col_sub + col_grd + col_pct + col_eff + 4, y - row_h + 4, cmt_disp, size=7, color=(0.35, 0.35, 0.35))

        c.line(MARGIN_L, y - row_h, MARGIN_L + USABLE_W, y - row_h, rgb=(0.90, 0.90, 0.90), lw=0.3)
        y -= row_h

    # ── Grade key legend ──────────────────────────────────────────────────────
    if y > MARGIN_B + 30:
        y -= 4
        bar_h = 14.0
        tint = _lighten(brand_rgb, 0.92)
        c.rect_fill(MARGIN_L, y - bar_h, USABLE_W, bar_h, tint)
        c.line(MARGIN_L, y, MARGIN_L + USABLE_W, y, rgb=brand_rgb, lw=1.0)
        c.text(MARGIN_L + 5, y - bar_h + 4, "GRADE KEY:", size=7, bold=True, color=brand_rgb)
        legend_x = MARGIN_L + 75
        for grade, rgb, label, lo, hi in _GRADE_DATA:
            c.rect_fill(legend_x, y - bar_h + 2, 20, bar_h - 4, rgb)
            c.text(legend_x + 3, y - bar_h + 4, grade, size=6, bold=True, color=(1.0, 1.0, 1.0))
            c.text(legend_x + 23, y - bar_h + 4, f"{lo}-{hi}%", size=6, color=(0.40, 0.40, 0.40))
            legend_x += 54
        y -= bar_h + 4

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
