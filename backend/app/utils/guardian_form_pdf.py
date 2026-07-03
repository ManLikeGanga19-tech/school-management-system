"""Phase T4 — Guardian Information Update Form (printable PDF).

One A4 page per flagged student. The school prints the batch, hands each
student their page, the guardian fills it in by hand at home or at the
office, and the secretary keys the corrections back into the system.

Design constraints:
  * Branded with the tenant print profile (same header block as invoices
    and receipts — school name, motto, P.O. Box, contacts).
  * WIDE handwriting fields: full-width answer boxes with generous row
    height (11mm+) so a parent can comfortably write with a pen.
  * The student's current (on-file) values are shown next to each field
    so the guardian can confirm or correct — never a blank mystery form.
  * Flags what specifically is wrong on THIS student's record, in plain
    language, so the office knows why the form went home.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any


_ISSUE_EXPLANATIONS = {
    "NAME_MISSING": "Guardian name is missing on our records",
    "NAME_IS_PHONE": "Guardian name field contains a phone number",
    "PHONE_MULTI": "Two phone numbers are stored in one field",
    "PHONE_INVALID": "Guardian phone number is invalid or incomplete",
    "PARENT_UNLINKED": "Guardian record is not linked to this student",
}


def generate_guardian_correction_forms_pdf(doc: dict[str, Any]) -> bytes:
    """doc = {profile: dict, students: list[dict], generated_at: str}
    where each student row matches the data-quality scan output."""
    from reportlab.lib.pagesizes import A4  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors  # type: ignore
    from reportlab.platypus import (  # type: ignore
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        HRFlowable, PageBreak,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.lib.enums import TA_CENTER, TA_LEFT  # type: ignore

    profile = doc.get("profile") or {}
    students = [s for s in (doc.get("students") or []) if isinstance(s, dict)]

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
            leading=leading or size + 3,
        )

    buf = io.BytesIO()
    page_w, page_h = A4
    lm = rm = 14 * mm
    usable_w = page_w - lm - rm

    doc_pdf = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=10 * mm, bottomMargin=12 * mm,
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

    # ── Answer-box helper: label column + WIDE ruled writing area ─────────
    # 12mm row height gives a comfortable pen-writing lane; the answer cell
    # is ~70% of the usable width.
    def answer_table(rows: list[tuple[str, str]]) -> Table:
        data = []
        for label, current in rows:
            current_label = (
                Paragraph(
                    f"<font size=7 color='#64748b'>currently: {current}</font>",
                    _s(f"cur_{label}", size=7),
                )
                if current
                else Paragraph("", _s(f"cur_{label}", size=7))
            )
            data.append([
                Paragraph(f"<b>{label}</b>", _s(f"lbl_{label}", size=9)),
                current_label,
                "",  # the handwriting lane
            ])
        tbl = Table(
            data,
            colWidths=[usable_w * 0.22, usable_w * 0.20, usable_w * 0.58],
            rowHeights=[12 * mm] * len(data),
        )
        tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            # Ruled line under each handwriting lane only.
            ("LINEBELOW", (2, 0), (2, -1), 0.7, colors.HexColor("#334155")),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        return tbl

    for idx, s in enumerate(students):
        if idx > 0:
            story.append(PageBreak())

        # ── Branded header (school document structure) ────────────────
        story.append(Paragraph(
            school_name, _s("school", size=15, bold=True, align=TA_CENTER, space_after=1),
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
                   color=colors.HexColor("#475569"), space_after=4),
            ))
        story.append(HRFlowable(width="100%", thickness=1.2,
                                color=colors.HexColor("#173f49")))
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph(
            "GUARDIAN INFORMATION UPDATE FORM",
            _s("title", size=13, bold=True, align=TA_CENTER, space_after=2),
        ))
        story.append(Paragraph(
            "Please confirm or correct the guardian details below and return "
            "this form to the school office.",
            _s("subtitle", size=9, align=TA_CENTER,
               color=colors.HexColor("#475569"), space_after=6),
        ))

        # ── Student identity (prefilled) ───────────────────────────────
        ident_rows = [
            ["Student Name:", str(s.get("student_name") or "—"),
             "Admission No:", str(s.get("admission_number") or "—")],
            ["Class:", str(s.get("class_code") or "—"),
             "Date:", generated_label],
        ]
        ident_tbl = Table(
            ident_rows,
            colWidths=[usable_w * 0.16, usable_w * 0.44, usable_w * 0.16, usable_w * 0.24],
        )
        ident_tbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(ident_tbl)
        story.append(Spacer(1, 3 * mm))

        # ── Why this form was issued ───────────────────────────────────
        issues = [str(i) for i in (s.get("issues") or [])]
        reasons = [
            _ISSUE_EXPLANATIONS.get(code, code.replace("_", " ").title())
            for code in issues
        ]
        if reasons:
            story.append(Paragraph(
                "<b>Reason for this form:</b> " + "; ".join(reasons) + ".",
                _s("reasons", size=8.5, color=colors.HexColor("#92400e"),
                   space_after=5),
            ))

        # ── Guardian details (wide handwriting fields) ─────────────────
        story.append(Paragraph(
            "GUARDIAN / PARENT DETAILS (please write clearly in block letters)",
            _s("sect1", size=9.5, bold=True, space_after=3,
               color=colors.HexColor("#173f49")),
        ))
        g_name = str(s.get("guardian_name") or "")
        g_phone = str(s.get("guardian_phone") or "")
        story.append(answer_table([
            ("Full Name", g_name),
            ("Relationship to Student", ""),
            ("Primary Phone (07.. / 01..)", g_phone),
            ("Alternate Phone", ""),
            ("Email Address", ""),
            ("National ID / Passport No.", ""),
            ("Occupation", ""),
        ]))
        story.append(Spacer(1, 2 * mm))
        story.append(Paragraph(
            "HOME ADDRESS",
            _s("sect2", size=9.5, bold=True, space_after=3,
               color=colors.HexColor("#173f49")),
        ))
        story.append(answer_table([
            ("Physical Address", ""),
            ("Town / County", ""),
        ]))
        story.append(Spacer(1, 4 * mm))

        # ── Declaration + signatures ───────────────────────────────────
        story.append(Paragraph(
            "I confirm that the information provided above is true and "
            "correct, and should replace the details currently held by the "
            "school for this student.",
            _s("decl", size=8.5, color=colors.HexColor("#475569"), space_after=5),
        ))
        sig_rows = [
            ["Guardian Signature:", "", "Date:", ""],
            ["Received by (Office):", "", "Date:", ""],
        ]
        sig_tbl = Table(
            sig_rows,
            colWidths=[usable_w * 0.22, usable_w * 0.38, usable_w * 0.10, usable_w * 0.30],
            rowHeights=[12 * mm, 12 * mm],
        )
        sig_tbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LINEBELOW", (1, 0), (1, -1), 0.7, colors.HexColor("#334155")),
            ("LINEBELOW", (3, 0), (3, -1), 0.7, colors.HexColor("#334155")),
        ]))
        story.append(sig_tbl)
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(
            f"Generated by the school management system on {generated_label}. "
            "For office use: enter the corrections on the student's profile "
            "after verification.",
            _s("foot", size=7, align=TA_CENTER,
               color=colors.HexColor("#94a3b8")),
        ))

    if not students:
        story.append(Paragraph(
            "No students currently have guardian data issues.",
            _s("empty", size=11, align=TA_CENTER),
        ))

    doc_pdf.build(story)
    return buf.getvalue()
