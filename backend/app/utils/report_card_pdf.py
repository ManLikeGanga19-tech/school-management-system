"""8-4-4 term report card PDF generator.

Produces a pure-Python A4 PDF — no external dependencies beyond the stdlib.
The layout follows Kenyan secondary-school report card conventions:
  • School name / term header
  • Student bio block
  • Subject marks table (subject | marks | grade | remarks)
  • Aggregate row (total / mean / mean grade / position)
  • Attendance summary
  • Conduct + remarks block
  • Signature strip
"""
from __future__ import annotations

import re
from typing import Any


# ── 8-4-4 grading helpers ─────────────────────────────────────────────────────

_GRADE_SCALE = [
    (80, "A",  12),
    (75, "A-", 11),
    (70, "B+", 10),
    (65, "B",   9),
    (60, "B-",  8),
    (55, "C+",  7),
    (50, "C",   6),
    (45, "C-",  5),
    (40, "D+",  4),
    (35, "D",   3),
    (30, "D-",  2),
    (0,  "E",   1),
]

_MEAN_GRADE_POINTS = [
    (11.5, "A"),
    (10.5, "A-"),
    (9.5,  "B+"),
    (8.5,  "B"),
    (7.5,  "B-"),
    (6.5,  "C+"),
    (5.5,  "C"),
    (4.5,  "C-"),
    (3.5,  "D+"),
    (2.5,  "D"),
    (1.5,  "D-"),
    (0.0,  "E"),
]


def _grade_for_pct(pct: float) -> tuple[str, int]:
    """Return (letter_grade, grade_points) for a percentage mark."""
    for threshold, letter, pts in _GRADE_SCALE:
        if pct >= threshold:
            return letter, pts
    return "E", 1


def _mean_grade(mean_pts: float) -> str:
    for threshold, letter in _MEAN_GRADE_POINTS:
        if mean_pts >= threshold:
            return letter
    return "E"


# ── Pure-Python PDF helpers ───────────────────────────────────────────────────

def _safe(text: str) -> str:
    """Escape special PDF string characters."""
    text = str(text or "")
    text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    # Strip any non-Latin-1 chars so encoding stays clean
    return text.encode("latin-1", "replace").decode("latin-1")


def _pdf(objects: dict[int, bytes], root_id: int) -> bytes:
    """Serialise PDF objects into a valid PDF byte string."""
    body = b"%PDF-1.4\n"
    offsets: dict[int, int] = {}

    for oid in sorted(objects):
        offsets[oid] = len(body)
        obj = objects[oid]
        if isinstance(obj, str):
            obj = obj.encode("latin-1", "replace")
        body += f"{oid} 0 obj\n".encode() + obj + b"\nendobj\n"

    xref_offset = len(body)
    count = max(objects) + 1
    body += f"xref\n0 {count}\n".encode()
    body += b"0000000000 65535 f \n"
    for oid in range(1, count):
        off = offsets.get(oid, 0)
        body += f"{off:010d} 00000 n \n".encode()

    body += (
        f"trailer\n<< /Size {count} /Root {root_id} 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode()
    return body


# ── Report card generator ─────────────────────────────────────────────────────

def generate_report_card_pdf(data: dict[str, Any]) -> bytes:
    """
    ``data`` dict shape (all values are strings / lists / None):
    {
        "school_name": str,
        "school_address": str,
        "term_name": str,
        "academic_year": str,

        "student_name": str,
        "admission_no": str,
        "class_code": str,
        "gender": str | None,
        "position": int | None,      # position in class (1-based)
        "out_of": int | None,        # total students in class

        "subjects": [
            {
                "name": str,
                "marks": float,          # percentage or raw (see max_marks)
                "max_marks": float,
                "grade": str,            # pre-computed or None (we compute it)
                "remarks": str | None,
            },
            ...
        ],

        # Attendance (from Phase 2 — may be missing)
        "attendance_total": int | None,
        "attendance_present": int | None,

        # Remarks
        "class_teacher_comment": str | None,
        "principal_comment": str | None,
        "conduct": str | None,
        "next_term_begins": str | None,   # ISO date string
    }
    """
    school_name  = data.get("school_name") or "School Name"
    school_addr  = data.get("school_address") or ""
    term_name    = data.get("term_name") or "Term"
    acad_year    = data.get("academic_year") or ""
    student_name = data.get("student_name") or "Student"
    adm_no       = data.get("admission_no") or ""
    class_code   = data.get("class_code") or ""
    gender       = data.get("gender") or ""
    position     = data.get("position")
    out_of       = data.get("out_of")

    subjects    = data.get("subjects") or []
    att_total   = data.get("attendance_total")
    att_present = data.get("attendance_present")

    ct_comment    = data.get("class_teacher_comment") or ""
    principal_cmt = data.get("principal_comment") or ""
    conduct       = data.get("conduct") or ""
    next_term     = data.get("next_term_begins") or ""

    # ── Build content stream ──────────────────────────────────────────────────
    page_w, page_h = 595, 842
    ml, mr = 42, 42
    content_w = page_w - ml - mr

    lines: list[str] = []

    def _text(x: float, y: float, text: str, size: int = 10, bold: bool = False) -> None:
        font_ref = "/FB" if bold else "/F1"
        lines.append(f"BT {font_ref} {size} Tf {x:.1f} {y:.1f} Td ({_safe(text)}) Tj ET")

    def _rule(x1: float, y1: float, x2: float, y2: float, width: float = 0.5) -> None:
        lines.append(f"{width} w {x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S")

    def _rect(x: float, y: float, w: float, h: float, fill: bool = False) -> None:
        op = "f" if fill else "S"
        lines.append(f"0.9 0.9 0.9 rg" if fill else "0 0 0 rg")
        lines.append(f"{x:.1f} {y:.1f} {w:.1f} {h:.1f} re {op}")
        if fill:
            lines.append("0 0 0 rg")

    # y cursor (top-down)
    y = page_h - 36.0

    # ── School header ─────────────────────────────────────────────────────────
    _text(ml, y, school_name.upper(), size=14, bold=True)
    y -= 16
    _text(ml, y, school_addr, size=9)
    y -= 12
    _text(ml, y, f"{term_name}  ·  {acad_year}", size=9)
    y -= 8
    _rule(ml, y, page_w - mr, y, width=1.5)
    y -= 14

    _text(page_w / 2 - 60, y, "STUDENT ACADEMIC REPORT", size=12, bold=True)
    y -= 20

    # ── Student bio block ────────────────────────────────────────────────────
    _text(ml, y, f"Name: {student_name}", size=10, bold=True)
    _text(ml + 260, y, f"Adm No: {adm_no}", size=10)
    y -= 14
    _text(ml, y, f"Class: {class_code}")
    _text(ml + 130, y, f"Gender: {gender}")
    if position and out_of:
        _text(ml + 260, y, f"Position: {position} / {out_of}")
    y -= 8
    _rule(ml, y, page_w - mr, y)
    y -= 14

    # ── Marks table header ────────────────────────────────────────────────────
    col_subj  = ml
    col_marks = ml + 260
    col_grade = ml + 330
    col_rem   = ml + 370
    row_h = 14.0

    _rect(ml, y - 2, content_w, row_h, fill=True)
    _text(col_subj,  y, "SUBJECT",  size=9, bold=True)
    _text(col_marks, y, "MARKS/%", size=9, bold=True)
    _text(col_grade, y, "GRADE",   size=9, bold=True)
    _text(col_rem,   y, "REMARKS", size=9, bold=True)
    y -= row_h

    # ── Subject rows ──────────────────────────────────────────────────────────
    total_pts = 0
    grade_points_list: list[int] = []

    for subj in subjects:
        name     = str(subj.get("name") or "")
        marks    = float(subj.get("marks") or 0)
        max_m    = float(subj.get("max_marks") or 100)
        pct      = round(marks / max_m * 100, 1) if max_m else 0.0
        grade    = str(subj.get("grade") or "") or _grade_for_pct(pct)[0]
        _, pts   = _grade_for_pct(pct)
        remarks  = str(subj.get("remarks") or "")

        grade_points_list.append(pts)
        total_pts += pct

        _text(col_subj,  y, name,              size=9)
        _text(col_marks, y, f"{pct:.1f}",      size=9)
        _text(col_grade, y, grade,             size=9)
        _text(col_rem,   y, remarks[:40],      size=8)
        y -= row_h

    _rule(ml, y + 2, page_w - mr, y + 2)
    y -= 4

    # ── Aggregate row ─────────────────────────────────────────────────────────
    n_subj = len(subjects)
    if n_subj:
        mean_pct = round(total_pts / n_subj, 2)
        mean_pts = round(sum(grade_points_list) / n_subj, 2)
        overall_grade = _mean_grade(mean_pts)
    else:
        mean_pct, mean_pts, overall_grade = 0.0, 0.0, "—"

    _rect(ml, y - 2, content_w, row_h, fill=True)
    _text(col_subj,  y, "MEAN SCORE",            size=9, bold=True)
    _text(col_marks, y, f"{mean_pct:.2f}",        size=9, bold=True)
    _text(col_grade, y, overall_grade,            size=9, bold=True)
    _text(col_rem,   y, f"Pts: {mean_pts:.2f}",  size=8)
    y -= row_h + 10

    # ── Attendance ────────────────────────────────────────────────────────────
    if att_total is not None:
        att_str = f"Days Present: {att_present or 0} / {att_total}"
        if att_total > 0:
            rate = round((att_present or 0) / att_total * 100, 1)
            att_str += f"  ({rate}%)"
        _text(ml, y, att_str, size=9)
        y -= 14

    _rule(ml, y, page_w - mr, y)
    y -= 14

    # ── Conduct + remarks ─────────────────────────────────────────────────────
    _text(ml, y, f"Conduct: {conduct}", size=9, bold=True)
    if next_term:
        _text(ml + 200, y, f"Next Term Begins: {next_term}", size=9)
    y -= 16

    _text(ml, y, "Class Teacher's Comment:", size=9, bold=True)
    y -= 12
    _text(ml + 10, y, (ct_comment or "")[:120], size=9)
    y -= 16

    _text(ml, y, "Principal's Comment:", size=9, bold=True)
    y -= 12
    _text(ml + 10, y, (principal_cmt or "")[:120], size=9)
    y -= 20

    # ── Signature strip ───────────────────────────────────────────────────────
    _rule(ml, y, ml + 130, y)
    _rule(ml + 200, y, ml + 330, y)
    _rule(ml + 400, y, page_w - mr, y)
    y -= 12
    _text(ml,       y, "Class Teacher",  size=8)
    _text(ml + 200, y, "Principal",      size=8)
    _text(ml + 400, y, "Date",           size=8)

    # ── Assemble PDF ─────────────────────────────────────────────────────────
    stream = "\n".join(lines).encode("latin-1", "replace")
    objects: dict[int, bytes] = {}

    catalog_id = 1
    pages_id   = 2
    font_id    = 3
    bold_id    = 4
    content_id = 5
    page_id    = 6

    objects[font_id] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    objects[bold_id] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
    objects[content_id] = (
        f"<< /Length {len(stream)} >>\nstream\n".encode("ascii")
        + stream
        + b"\nendstream"
    )
    objects[page_id] = (
        f"<< /Type /Page /Parent {pages_id} 0 R "
        f"/MediaBox [0 0 {page_w} {page_h}] "
        f"/Resources << /Font << /F1 {font_id} 0 R /FB {bold_id} 0 R >> >> "
        f"/Contents {content_id} 0 R >>"
    ).encode("ascii")
    objects[pages_id] = (
        f"<< /Type /Pages /Kids [{page_id} 0 R] /Count 1 >>"
    ).encode("ascii")
    objects[catalog_id] = (
        f"<< /Type /Catalog /Pages {pages_id} 0 R >>"
    ).encode("ascii")

    return _pdf(objects, catalog_id)
