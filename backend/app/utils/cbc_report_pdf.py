"""CBC Learner Progress Report PDF generator.

Produces a pure-Python A4 PDF using only stdlib + raw PDF primitives.
Layout (matches Kenyan CBC progress report conventions):
  • School name / term header
  • Learner bio block
  • Per learning area: performance level table (sub-strand → BE/AE/ME/EE)
  • Teacher observations column
  • Legend strip (BE / AE / ME / EE meanings)
  • Signature strip

Performance levels:
  BE — Below Expectation
  AE — Approaching Expectation
  ME — Meeting Expectation
  EE — Exceeding Expectation
"""
from __future__ import annotations

import struct
import zlib
from typing import Any


# ── PDF primitives ────────────────────────────────────────────────────────────

def _pdf_obj(objects: dict[int, bytes], oid: int, content: bytes) -> None:
    objects[oid] = content


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


# ── Level helpers ─────────────────────────────────────────────────────────────

_LEVEL_LABEL = {
    "BE": "Below Expectation",
    "AE": "Approaching Expectation",
    "ME": "Meeting Expectation",
    "EE": "Exceeding Expectation",
}

_LEVEL_COLOR = {
    "BE": (0.95, 0.3, 0.3),    # red-ish
    "AE": (0.95, 0.75, 0.2),   # amber
    "ME": (0.3, 0.75, 0.3),    # green
    "EE": (0.2, 0.55, 0.95),   # blue
}


def _safe(text: str | None) -> str:
    if not text:
        return ""
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


# ── Main generator ────────────────────────────────────────────────────────────

def generate_cbc_report_pdf(data: dict[str, Any], school_name: str = "School") -> bytes:
    """
    data: result from service.get_learner_report()
    Returns raw PDF bytes.
    """
    # Page dimensions (A4 in points: 595 x 842)
    W, H = 595.0, 842.0
    ML, MR, MT, MB = 36.0, 36.0, 36.0, 36.0  # margins

    # We'll accumulate stream content
    stream_lines: list[str] = []

    def txt(x: float, y: float, text: str, size: int = 9, bold: bool = False) -> None:
        font = "F2" if bold else "F1"
        stream_lines.append(f"BT /{font} {size} Tf {x:.1f} {y:.1f} Td ({_safe(text)}) Tj ET")

    def rule(x1: float, y1: float, x2: float, y2: float, w: float = 0.4) -> None:
        stream_lines.append(f"{w} w {x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S")

    def rect(x: float, y: float, w: float, h: float, fill: bool = False, stroke: bool = True) -> None:
        op = "f" if (fill and not stroke) else "B" if (fill and stroke) else "S"
        stream_lines.append(f"{x:.1f} {y:.1f} {w:.1f} {h:.1f} re {op}")

    def colored_rect(x: float, y: float, w: float, h: float, r: float, g: float, b: float) -> None:
        stream_lines.append(f"{r:.2f} {g:.2f} {b:.2f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f 0 0 0 rg")

    # ── Header ────────────────────────────────────────────────────────────────
    y = H - MT

    # Banner background
    colored_rect(ML, y - 40, W - ML - MR, 44, 0.12, 0.45, 0.72)
    txt(ML + 4, y - 14, school_name, size=13, bold=True)
    stream_lines.append(f"1 1 1 rg")
    txt(ML + 4, y - 28, "CBC LEARNER PROGRESS REPORT", size=10, bold=True)
    stream_lines.append(f"0 0 0 rg")

    y -= 52

    # Bio block
    student_name = data.get("student_name", "—")
    admission_no = data.get("admission_no", "—")
    class_name = data.get("class_name", "—")
    term_name = data.get("term_name", "—")

    txt(ML, y, "Learner:", bold=True)
    txt(ML + 55, y, student_name)
    txt(ML + 250, y, "Adm. No:", bold=True)
    txt(ML + 300, y, admission_no)
    y -= 14
    txt(ML, y, "Class:", bold=True)
    txt(ML + 55, y, class_name)
    txt(ML + 250, y, "Term:", bold=True)
    txt(ML + 300, y, term_name)
    y -= 8
    rule(ML, y, W - MR, y)
    y -= 12

    # ── Learning areas ────────────────────────────────────────────────────────
    col_subject_w = 220.0
    col_level_w   = 40.0
    col_obs_w     = W - ML - MR - col_subject_w - col_level_w
    row_h         = 14.0

    for la in data.get("learning_areas", []):
        # Check page overflow — simple version: restart if too close to bottom
        if y < MB + 60:
            # For now, continue on same page (full pagination would add pages)
            pass

        # Learning area header
        colored_rect(ML, y - row_h + 3, W - ML - MR, row_h, 0.18, 0.48, 0.75)
        stream_lines.append("1 1 1 rg")
        la_title = f"{la['learning_area_name']}  [{la.get('grade_band', '').replace('_', ' ')}]"
        txt(ML + 4, y - 10, la_title, size=9, bold=True)
        stream_lines.append("0 0 0 rg")
        y -= row_h

        for strand in la.get("strands", []):
            if y < MB + 40:
                pass
            # Strand row
            colored_rect(ML, y - row_h + 3, W - ML - MR, row_h - 1, 0.88, 0.92, 0.97)
            txt(ML + 8, y - 10, strand["strand_name"], size=8, bold=True)
            y -= row_h

            # Column headers
            txt(ML + 12, y - 10, "Sub-strand", size=7, bold=True)
            txt(ML + col_subject_w + 4, y - 10, "Level", size=7, bold=True)
            txt(ML + col_subject_w + col_level_w + 4, y - 10, "Teacher Observations", size=7, bold=True)
            rule(ML, y - row_h + 3, W - MR, y - row_h + 3, w=0.2)
            y -= row_h

            for ss in strand.get("sub_strands", []):
                if y < MB + 20:
                    pass
                level = ss.get("performance_level", "")
                obs = ss.get("teacher_observations") or ""

                # Sub-strand name
                txt(ML + 12, y - 10, ss["sub_strand_name"], size=8)

                # Level badge
                r, g, b = _LEVEL_COLOR.get(level, (0.8, 0.8, 0.8))
                colored_rect(
                    ML + col_subject_w + 2, y - row_h + 4,
                    col_level_w - 4, row_h - 5,
                    r, g, b,
                )
                stream_lines.append("1 1 1 rg")
                txt(ML + col_subject_w + 4, y - 10, level, size=8, bold=True)
                stream_lines.append("0 0 0 rg")

                # Observations (truncated to fit)
                if obs:
                    max_chars = 55
                    obs_disp = obs[:max_chars] + ("…" if len(obs) > max_chars else "")
                    txt(ML + col_subject_w + col_level_w + 4, y - 10, obs_disp, size=7)

                rule(ML, y - row_h + 3, W - MR, y - row_h + 3, w=0.15)
                y -= row_h

        y -= 4  # gap between learning areas

    # ── Legend ────────────────────────────────────────────────────────────────
    y -= 6
    rule(ML, y, W - MR, y)
    y -= 12
    txt(ML, y, "Performance Level Key:", size=8, bold=True)
    y -= 12
    legend_x = ML
    for code, label in _LEVEL_LABEL.items():
        r, g, b = _LEVEL_COLOR[code]
        colored_rect(legend_x, y - 9, 18, 11, r, g, b)
        stream_lines.append("1 1 1 rg")
        txt(legend_x + 3, y - 8, code, size=7, bold=True)
        stream_lines.append("0 0 0 rg")
        txt(legend_x + 22, y - 8, label, size=7)
        legend_x += 130

    # ── Signature strip ───────────────────────────────────────────────────────
    y -= 28
    rule(ML, y, W - MR, y)
    y -= 14
    sig_cols = [ML, ML + 170, ML + 340]
    for x, label in zip(sig_cols, ["Class Teacher", "Parent / Guardian", "Head Teacher / Principal"]):
        rule(x, y - 20, x + 140, y - 20)
        txt(x, y - 32, label, size=8)

    # ── Build PDF objects ─────────────────────────────────────────────────────
    stream_content = "\n".join(stream_lines).encode("latin-1", errors="replace")
    compressed = zlib.compress(stream_content)

    objects: dict[int, bytes] = {}

    # 1 — Catalog
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"

    # 2 — Pages
    objects[2] = b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"

    # 3 — Page
    objects[3] = (
        f"<< /Type /Page /Parent 2 0 R "
        f"/MediaBox [0 0 {W:.0f} {H:.0f}] "
        f"/Contents 4 0 R "
        f"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>"
    ).encode()

    # 4 — Content stream (compressed)
    objects[4] = (
        f"<< /Length {len(compressed)} /Filter /FlateDecode >>\nstream\n".encode()
        + compressed
        + b"\nendstream"
    )

    # 5 — Helvetica
    objects[5] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"

    # 6 — Helvetica-Bold
    objects[6] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"

    return _build_pdf(objects, root_id=1)
