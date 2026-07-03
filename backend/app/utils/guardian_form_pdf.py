"""Phase U — Guardian Information Update Sheet (printable PDF).

ONE tabular worksheet — rows are the flagged students, columns are the
details to collect. The secretary prints it and walks class to class
filling in corrections by hand, then keys them back into the system.

Design constraints:
  * Branded with the tenant print profile (same header structure as
    invoices and receipts).
  * Landscape A4 — maximizes handwriting width per row.
  * Rows sorted by CLASS then student name, so the sheet follows the
    secretary's walking order; the class is its own column.
  * Tall rows (13mm) + two wide blank columns ("Corrected Guardian
    Name", "Corrected Phone(s)") for pen writing.
  * Current on-file values shown compactly so the secretary sees what
    is wrong without cross-referencing the system.
  * Table header repeats on every page.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any


_ISSUE_SHORT = {
    "NAME_MISSING": "name missing",
    "NAME_IS_PHONE": "name = phone no.",
    "PHONE_MULTI": "2 phone nos.",
    "PHONE_INVALID": "bad phone",
    "PARENT_UNLINKED": "parent not linked",
}


def generate_guardian_correction_forms_pdf(doc: dict[str, Any]) -> bytes:
    """doc = {profile: dict, students: list[dict], generated_at: str}
    where each student row matches the data-quality scan output."""
    from reportlab.lib.pagesizes import A4, landscape  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors  # type: ignore
    from reportlab.platypus import (  # type: ignore
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.lib.enums import TA_CENTER, TA_LEFT  # type: ignore

    profile = doc.get("profile") or {}
    students = [s for s in (doc.get("students") or []) if isinstance(s, dict)]
    # Walking order: class, then student name.
    students.sort(key=lambda s: (
        str(s.get("class_code") or "~"),  # unknown class sorts last
        str(s.get("student_name") or "").lower(),
    ))

    styles = getSampleStyleSheet()

    def _s(
        name: str, size: int = 10, bold: bool = False,
        align: int = TA_LEFT, color=colors.black,
        space_after: int = 2, leading: int | None = None,
    ) -> ParagraphStyle:
        return ParagraphStyle(
            name, parent=styles["Normal"], fontSize=size,
            fontName="Helvetica-Bold" if bold else "Helvetica",
            alignment=align, textColor=color, spaceAfter=space_after,
            leading=leading or size + 2,
        )

    buf = io.BytesIO()
    page_w, page_h = landscape(A4)
    lm = rm = 10 * mm
    usable_w = page_w - lm - rm

    doc_pdf = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        topMargin=8 * mm, bottomMargin=10 * mm,
        leftMargin=lm, rightMargin=rm,
    )

    school_name = str(profile.get("school_header") or profile.get("school_name") or "School")
    motto = str(profile.get("school_motto") or "")
    po_box = str(profile.get("po_box") or "")
    address = str(profile.get("physical_address") or "")
    phone = str(profile.get("phone") or "")
    email = str(profile.get("email") or "")

    contact_bits = []
    if po_box:
        contact_bits.append(f"P.O. Box {po_box}")
    if address:
        contact_bits.append(address)
    if phone:
        contact_bits.append(f"Tel: {phone}")
    if email:
        contact_bits.append(email)
    contact_line = "  |  ".join(contact_bits)

    generated_label = str(doc.get("generated_at") or "")[:10] or (
        datetime.now(timezone.utc).strftime("%Y-%m-%d")
    )

    story: list = []

    # ── Branded header (school document structure) ────────────────────────
    story.append(Paragraph(
        school_name, _s("school", size=14, bold=True, align=TA_CENTER, space_after=1),
    ))
    if motto:
        story.append(Paragraph(
            f"<i>{motto}</i>",
            _s("motto", size=8, align=TA_CENTER,
               color=colors.HexColor("#64748b"), space_after=1),
        ))
    if contact_line:
        story.append(Paragraph(
            contact_line,
            _s("contact", size=8, align=TA_CENTER,
               color=colors.HexColor("#475569"), space_after=3),
        ))
    story.append(HRFlowable(width="100%", thickness=1.2,
                            color=colors.HexColor("#173f49")))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(
        "GUARDIAN INFORMATION UPDATE SHEET",
        _s("title", size=12, bold=True, align=TA_CENTER, space_after=1),
    ))
    story.append(Paragraph(
        f"Generated {generated_label} · {len(students)} student"
        f"{'s' if len(students) != 1 else ''} · sorted by class — "
        "write corrections clearly in the blank columns, then enter them on "
        "each student's profile.",
        _s("subtitle", size=8, align=TA_CENTER,
           color=colors.HexColor("#475569"), space_after=4),
    ))

    if not students:
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph(
            "No students currently have guardian data issues.",
            _s("empty", size=11, align=TA_CENTER),
        ))
        doc_pdf.build(story)
        return buf.getvalue()

    # ── The worksheet ──────────────────────────────────────────────────────
    cell = _s("cell", size=8, leading=9)
    cell_dim = _s("cell_dim", size=7.5, color=colors.HexColor("#64748b"), leading=8.5)
    cell_issue = _s("cell_issue", size=7.5, color=colors.HexColor("#b45309"), leading=8.5)

    header = [
        "#", "Student", "Class", "Adm No.",
        "On-file Guardian", "Issues",
        "Corrected Guardian Name", "Corrected Phone(s)",
    ]
    rows: list[list] = [header]
    for i, s in enumerate(students, start=1):
        on_file_bits = []
        if s.get("guardian_name"):
            on_file_bits.append(str(s["guardian_name"]))
        if s.get("guardian_phone"):
            on_file_bits.append(str(s["guardian_phone"]))
        on_file = "<br/>".join(on_file_bits) if on_file_bits else "—"
        issues = ", ".join(
            _ISSUE_SHORT.get(str(c), str(c).lower().replace("_", " "))
            for c in (s.get("issues") or [])
        )
        rows.append([
            str(i),
            Paragraph(str(s.get("student_name") or "—"), cell),
            Paragraph(str(s.get("class_code") or "—"), cell),
            Paragraph(str(s.get("admission_number") or "—"), cell_dim),
            Paragraph(on_file, cell_dim),
            Paragraph(issues, cell_issue),
            "",  # handwriting: corrected guardian name
            "",  # handwriting: corrected phone(s)
        ])

    col_w = [
        usable_w * 0.030,  # #
        usable_w * 0.150,  # Student
        usable_w * 0.065,  # Class
        usable_w * 0.075,  # Adm No
        usable_w * 0.145,  # On-file guardian
        usable_w * 0.115,  # Issues
        usable_w * 0.235,  # Corrected guardian name (wide, blank)
        usable_w * 0.185,  # Corrected phone(s)     (wide, blank)
    ]
    # Tall rows for handwriting; compact header.
    row_heights = [8 * mm] + [13 * mm] * len(students)

    tbl = Table(rows, colWidths=col_w, rowHeights=row_heights, repeatRows=1)
    tbl.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173f49")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 7.5),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        # Body
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
        # Zebra striping on the read-only columns keeps rows traceable
        # across the wide page.
        ("ROWBACKGROUNDS", (0, 1), (5, -1),
         [colors.white, colors.HexColor("#f8fafc")]),
        # Handwriting columns stay pure white for pen clarity.
        ("BACKGROUND", (6, 1), (-1, -1), colors.white),
        ("TOPPADDING", (0, 1), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl)

    # ── Footer: completion sign-off ────────────────────────────────────────
    story.append(Spacer(1, 5 * mm))
    sig_tbl = Table(
        [["Completed by:", "", "Signature:", "", "Date:", ""]],
        colWidths=[
            usable_w * 0.10, usable_w * 0.28,
            usable_w * 0.08, usable_w * 0.24,
            usable_w * 0.06, usable_w * 0.24,
        ],
        rowHeights=[10 * mm],
    )
    sig_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (1, 0), (1, 0), 0.7, colors.HexColor("#334155")),
        ("LINEBELOW", (3, 0), (3, 0), 0.7, colors.HexColor("#334155")),
        ("LINEBELOW", (5, 0), (5, 0), 0.7, colors.HexColor("#334155")),
    ]))
    story.append(sig_tbl)

    doc_pdf.build(story)
    return buf.getvalue()
