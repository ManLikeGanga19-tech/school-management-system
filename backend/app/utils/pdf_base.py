"""Shared PDF primitives for all report card and fee structure generators.

Provides:
  - Raw PDF serialisation (_build_pdf, _pdf_obj)
  - Safe text encoding (_safe)
  - Hex colour → PDF RGB triplet (_hex_to_rgb)
  - A page-level canvas helper (PageCanvas) with typed drawing methods
  - draw_school_header()   — branded top banner with school name + contact
  - draw_student_bio()     — two-column learner info block
  - draw_footer()          — bottom bar + "Next term begins / Report No" strip
  - draw_section_label()   — branded section divider
  - draw_remarks_block()   — teacher comment box + signature line
"""
from __future__ import annotations

import zlib
from typing import Any


# ── PDF serialisation ─────────────────────────────────────────────────────────

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


def _compress(data: bytes) -> bytes:
    return zlib.compress(data, level=6)


# ── Text safety ───────────────────────────────────────────────────────────────

def _safe(text: Any) -> str:
    """Escape a string for use inside a PDF text string literal."""
    s = str(text or "")
    # Common Unicode replacements that latin-1 can't encode
    for src, dst in (
        ("\u2014", "-"), ("\u2013", "-"), ("\u2019", "'"), ("\u2018", "'"),
        ("\u201c", '"'), ("\u201d", '"'), ("\u2026", "..."), ("\u00a0", " "),
        ("\u2022", "*"),
    ):
        s = s.replace(src, dst)
    s = s.encode("latin-1", errors="replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


# ── Colour helpers ────────────────────────────────────────────────────────────

def _hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
    """Convert a 6-digit hex colour (#RRGGBB) to a 0..1 RGB triplet."""
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return (0.10, 0.24, 0.42)      # fallback dark blue
    try:
        r = int(h[0:2], 16) / 255
        g = int(h[2:4], 16) / 255
        b = int(h[4:6], 16) / 255
        return (r, g, b)
    except ValueError:
        return (0.10, 0.24, 0.42)


def _darken(rgb: tuple[float, float, float], factor: float = 0.75) -> tuple[float, float, float]:
    """Return a slightly darker version of an RGB triplet (for table header rows)."""
    return tuple(max(0.0, c * factor) for c in rgb)  # type: ignore[return-value]


def _lighten(rgb: tuple[float, float, float], factor: float = 0.88) -> tuple[float, float, float]:
    """Return a very light tint of an RGB triplet (for alternate table rows)."""
    return tuple(min(1.0, 1 - (1 - c) * (1 - factor)) for c in rgb)  # type: ignore[return-value]


# ── Page canvas ───────────────────────────────────────────────────────────────

# Standard A4 dimensions in PDF user units (1 pt = 1/72 inch)
A4_W: float = 595.0
A4_H: float = 842.0
MARGIN_L: float = 22.0
MARGIN_R: float = 22.0
MARGIN_T: float = 22.0
MARGIN_B: float = 22.0
USABLE_W: float = A4_W - MARGIN_L - MARGIN_R


class PageCanvas:
    """Thin wrapper around a list of PDF stream instructions for one page."""

    def __init__(self) -> None:
        self._lines: list[str] = []

    # ── Core drawing commands ─────────────────────────────────────────────────

    def text(
        self,
        x: float, y: float,
        content: Any,
        size: int = 10,
        bold: bool = False,
        color: tuple[float, float, float] = (0, 0, 0),
    ) -> None:
        font = "F2" if bold else "F1"
        r, g, b = color
        self._lines.append(
            f"{r:.3f} {g:.3f} {b:.3f} rg "
            f"BT /{font} {size} Tf {x:.1f} {y:.1f} Td ({_safe(content)}) Tj ET "
            f"0 0 0 rg"
        )

    def rect_fill(
        self,
        x: float, y: float, w: float, h: float,
        rgb: tuple[float, float, float],
    ) -> None:
        r, g, b = rgb
        self._lines.append(
            f"{r:.3f} {g:.3f} {b:.3f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f 0 0 0 rg"
        )

    def rect_stroke(
        self,
        x: float, y: float, w: float, h: float,
        rgb: tuple[float, float, float] = (0.7, 0.7, 0.7),
        lw: float = 0.4,
    ) -> None:
        r, g, b = rgb
        self._lines.append(
            f"{lw:.1f} w {r:.3f} {g:.3f} {b:.3f} RG "
            f"{x:.1f} {y:.1f} {w:.1f} {h:.1f} re S 0 0 0 RG"
        )

    def line(
        self,
        x1: float, y1: float, x2: float, y2: float,
        rgb: tuple[float, float, float] = (0.7, 0.7, 0.7),
        lw: float = 0.4,
    ) -> None:
        r, g, b = rgb
        self._lines.append(
            f"{lw:.2f} w {r:.3f} {g:.3f} {b:.3f} RG "
            f"{x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S 0 0 0 RG"
        )

    def stream(self) -> bytes:
        return "\n".join(self._lines).encode("latin-1", errors="replace")


# ── Shared layout blocks ──────────────────────────────────────────────────────

def draw_school_header(
    c: PageCanvas,
    *,
    school_name: str,
    school_address: str,
    school_phone: str,
    school_email: str,
    brand_rgb: tuple[float, float, float],
    doc_title: str,           # e.g. "CBC LEARNER PROGRESS REPORT"
    doc_subtitle: str = "",   # e.g. "Term 2 · 2026"
    y_top: float = A4_H - MARGIN_T,
) -> float:
    """
    Draw the full-width branded header block.
    Returns the y coordinate of the bottom of the header (next content starts here).
    """
    banner_h = 64.0
    y_banner_bottom = y_top - banner_h

    # Brand colour filled banner
    c.rect_fill(MARGIN_L, y_banner_bottom, USABLE_W, banner_h, brand_rgb)

    # Thin top accent bar (slightly darker)
    dark = _darken(brand_rgb, 0.7)
    c.rect_fill(MARGIN_L, y_top - 5, USABLE_W, 5, dark)

    white = (1.0, 1.0, 1.0)

    # Left: School name (large) + address + phone
    c.text(MARGIN_L + 10, y_top - 20, school_name, size=16, bold=True, color=white)
    if school_address:
        c.text(MARGIN_L + 10, y_top - 34, school_address, size=8, color=white)
    contact_parts = []
    if school_phone:
        contact_parts.append(f"Tel: {school_phone}")
    if school_email:
        contact_parts.append(school_email)
    if contact_parts:
        c.text(MARGIN_L + 10, y_top - 44, "  |  ".join(contact_parts), size=8, color=white)

    # Right: Document title box
    title_x = MARGIN_L + USABLE_W * 0.52
    title_w = USABLE_W * 0.46
    box_h = 26.0
    box_y = y_banner_bottom + (banner_h - box_h) / 2

    # White box outline around the title
    c.rect_fill(title_x, box_y, title_w, box_h, (1.0, 1.0, 1.0))
    # Title text in brand colour
    c.text(title_x + 6, box_y + 16, doc_title, size=11, bold=True, color=brand_rgb)
    if doc_subtitle:
        c.text(title_x + 6, box_y + 6, doc_subtitle, size=9, color=brand_rgb)

    return y_banner_bottom - 8


def draw_student_bio(
    c: PageCanvas,
    *,
    brand_rgb: tuple[float, float, float],
    fields: list[tuple[str, str]],    # [(label, value), ...]
    y_top: float,
    section_title: str = "LEARNER INFORMATION",
) -> float:
    """
    Draw the two-column student bio block with a branded section label.
    fields — list of (label, value) pairs rendered left→right, top→bottom.
    Returns y coordinate below the block.
    """
    label_h = 14.0
    light = _lighten(brand_rgb, 0.92)

    # Section label bar
    c.rect_fill(MARGIN_L, y_top - label_h, USABLE_W, label_h, light)
    c.line(MARGIN_L, y_top, MARGIN_L + USABLE_W, y_top, rgb=brand_rgb, lw=1.2)
    c.line(MARGIN_L, y_top - label_h, MARGIN_L + USABLE_W, y_top - label_h, rgb=(0.82, 0.82, 0.82))
    c.text(MARGIN_L + 5, y_top - 10, section_title, size=8, bold=True, color=brand_rgb)
    y = y_top - label_h - 5

    # Two-column grid of fields
    col_w = USABLE_W / 2
    row_h = 16.0
    max_per_col = (len(fields) + 1) // 2

    for i, (label, value) in enumerate(fields):
        col = i // max_per_col
        row = i % max_per_col
        x = MARGIN_L + col * col_w + 5
        field_y = y - row * row_h

        # Alternate row tint (only for left column to span full width)
        if col == 0 and row % 2 == 0:
            c.rect_fill(MARGIN_L, field_y - row_h + 2, USABLE_W, row_h, (0.97, 0.97, 0.97))

        c.text(x, field_y - 4, label + ":", size=7, bold=True, color=(0.45, 0.45, 0.45))
        c.text(x + 80, field_y - 4, value or "—", size=9, bold=False)

    total_rows = max_per_col
    return y - total_rows * row_h - 6


def draw_section_label(
    c: PageCanvas,
    *,
    brand_rgb: tuple[float, float, float],
    label: str,
    y_top: float,
) -> float:
    """Draw a thin branded section divider. Returns y below."""
    bar_h = 14.0
    light = _lighten(brand_rgb, 0.92)
    c.rect_fill(MARGIN_L, y_top - bar_h, USABLE_W, bar_h, light)
    c.line(MARGIN_L, y_top, MARGIN_L + USABLE_W, y_top, rgb=brand_rgb, lw=1.0)
    c.text(MARGIN_L + 5, y_top - 10, label, size=8, bold=True, color=brand_rgb)
    return y_top - bar_h - 4


def draw_remarks_block(
    c: PageCanvas,
    *,
    brand_rgb: tuple[float, float, float],
    label: str,
    comment: str,
    conduct: str | None,
    y_top: float,
    box_h: float = 44.0,
) -> float:
    """
    Draw a labelled remarks section with a comment box and signature line.
    Returns y below the block.
    """
    y = draw_section_label(c, brand_rgb=brand_rgb, label=label, y_top=y_top)
    # Comment box outline
    c.rect_stroke(MARGIN_L, y - box_h, USABLE_W * 0.72, box_h, rgb=(0.75, 0.75, 0.75))
    if comment:
        # Wrap long comments naively at ~110 chars per line
        words = comment.split()
        lines: list[str] = []
        current = ""
        for w in words:
            if len(current) + len(w) + 1 > 110:
                lines.append(current)
                current = w
            else:
                current = f"{current} {w}".strip()
        if current:
            lines.append(current)
        for li, ln in enumerate(lines[:3]):      # max 3 lines visible
            c.text(MARGIN_L + 4, y - 12 - li * 11, ln, size=8)
    else:
        c.text(MARGIN_L + 4, y - 12, "(no comment recorded)", size=8, color=(0.6, 0.6, 0.6))

    # Conduct label if provided
    if conduct:
        c.text(MARGIN_L + USABLE_W * 0.74, y - 14, "Conduct:", size=8, bold=True)
        c.text(MARGIN_L + USABLE_W * 0.74, y - 26, conduct.replace("_", " ").title(), size=9)

    sig_y = y - box_h - 4
    c.line(MARGIN_L, sig_y, MARGIN_L + 130, sig_y, rgb=(0.5, 0.5, 0.5))
    c.text(MARGIN_L + 2, sig_y - 10, "Signature & Date", size=7, color=(0.55, 0.55, 0.55))
    return sig_y - 16


def draw_footer(
    c: PageCanvas,
    *,
    brand_rgb: tuple[float, float, float],
    next_term_begins: str,
    report_ref: str,
) -> None:
    """Draw the bottom branded bar with next-term date and report reference."""
    bar_h = 18.0
    y_bar = MARGIN_B + 14
    c.rect_fill(MARGIN_L, y_bar, USABLE_W, bar_h, brand_rgb)
    white = (1.0, 1.0, 1.0)
    if next_term_begins:
        c.text(MARGIN_L + 8, y_bar + 5, f"Next Term Begins:  {next_term_begins}", size=9, bold=True, color=white)
    c.text(MARGIN_L + USABLE_W - 110, y_bar + 5, report_ref, size=8, color=white)
