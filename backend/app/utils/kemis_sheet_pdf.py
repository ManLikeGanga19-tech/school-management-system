"""Phase W (D6) — Prefilled KEMIS Students' Data Capture Sheet.

Mirrors the official 2026 KEMIS registration sheet: the system prefills
every field it knows; unknown fields render as dotted blanks for the
guardian/office to complete by hand. Branded with the tenant print
profile like every other school document.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any


_DOTS = "." * 46


def _val(v: Any, width: int = 46) -> str:
    text = str(v).strip() if v is not None else ""
    return text if text else "." * width


def generate_kemis_sheet_pdf(doc: dict[str, Any]) -> bytes:
    """doc = {profile, student: {...}, parents: {mother, father, guardian}, generated_at}"""
    from reportlab.lib.pagesizes import A4  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors  # type: ignore
    from reportlab.platypus import (  # type: ignore
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.lib.enums import TA_CENTER, TA_LEFT  # type: ignore

    profile = doc.get("profile") or {}
    stu = doc.get("student") or {}
    parents = doc.get("parents") or {}

    styles = getSampleStyleSheet()

    def _s(name, size=9, bold=False, align=TA_LEFT, color=colors.black,
           space_after=2, leading=None):
        return ParagraphStyle(
            name, parent=styles["Normal"], fontSize=size,
            fontName="Helvetica-Bold" if bold else "Helvetica",
            alignment=align, textColor=color, spaceAfter=space_after,
            leading=leading or size + 4,
        )

    buf = io.BytesIO()
    page_w, _ = A4
    lm = rm = 14 * mm
    usable_w = page_w - lm - rm
    doc_pdf = SimpleDocTemplate(
        buf, pagesize=A4, topMargin=9 * mm, bottomMargin=10 * mm,
        leftMargin=lm, rightMargin=rm,
    )

    school_name = str(profile.get("school_header") or profile.get("school_name") or "School")
    contact_bits = [b for b in (
        f"P.O. Box {profile.get('po_box')}" if profile.get("po_box") else "",
        str(profile.get("physical_address") or ""),
        f"Tel: {profile.get('phone')}" if profile.get("phone") else "",
        str(profile.get("email") or ""),
    ) if b]

    body = _s("body", size=8.5, leading=14)
    sect = _s("sect", size=9.5, bold=True, color=colors.white)

    story: list = []
    story.append(Paragraph(school_name, _s("school", size=13, bold=True, align=TA_CENTER, space_after=1)))
    if contact_bits:
        story.append(Paragraph("  |  ".join(contact_bits),
                               _s("contact", size=7.5, align=TA_CENTER,
                                  color=colors.HexColor("#475569"), space_after=2)))
    story.append(Paragraph(
        "All students will be issued with a Unique Learner Identifier (ULI)",
        _s("uli_note", size=8.5, bold=True, align=TA_CENTER,
           color=colors.HexColor("#b91c1c"), space_after=1),
    ))
    story.append(Paragraph("KEMIS (Kenya Education Management Information System)",
                           _s("kemis", size=9, bold=True, align=TA_CENTER, space_after=1)))
    story.append(Paragraph("STUDENTS' DATA CAPTURE SHEET — KEMIS REGISTRATION 2026 · ADMISSIONS OFFICE",
                           _s("title", size=9.5, bold=True, align=TA_CENTER, space_after=3)))
    story.append(HRFlowable(width="100%", thickness=1.6, color=colors.black))
    story.append(Spacer(1, 2.5 * mm))

    gen_date = str(doc.get("generated_at") or "")[:10] or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    story.append(Paragraph(
        f"<b>ADM No:</b> {_val(stu.get('admission_no'), 16)}    "
        f"<b>Grade/Class &amp; stream:</b> {_val(stu.get('class_display'), 20)}    "
        f"<b>Date:</b> {gen_date}",
        body,
    ))
    story.append(Spacer(1, 1.5 * mm))

    def section(label: str):
        tbl = Table([[Paragraph(label, sect)]], colWidths=[usable_w])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#173f49")),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 1.5 * mm))

    def line(label: str, value: Any, label2: str | None = None, value2: Any = None,
             w1: int = 40, w2: int = 30):
        text = f"<b>{label}:</b> {_val(value, w1)}"
        if label2:
            text += f"    <b>{label2}:</b> {_val(value2, w2)}"
        story.append(Paragraph(text, body))

    # ── (A) Learner details ────────────────────────────────────────────
    section("(A)  LEARNER DETAILS")
    line("KEMIS ULI", stu.get("uli"), "KNEC Assessment No", stu.get("assessment_no"))
    line("KCPE/KJSEA Year", stu.get("kcpe_kjsea_year"), "Legacy NEMIS (if any)", stu.get("legacy_nemis"))
    story.append(Paragraph("<b>NAME (As Per Birth Certificate)</b>", body))
    line("First Name", stu.get("first_name"), "Middle Name", stu.get("other_names"))
    line("Last Name", stu.get("last_name"))
    line("Nationality/Country of Birth", stu.get("nationality"), "County of Birth", stu.get("county"))
    line("Sub-County of Birth", stu.get("sub_county"), "Location of Birth", stu.get("location_of_birth"))
    line("Birth Certificate Entry No", stu.get("birth_certificate_no"), "DoB", stu.get("date_of_birth"))
    line("Medical Condition", stu.get("medical_condition"), "Religion", stu.get("religion"))
    line("Learner Interests (Music/Sports/Environmental/Science)", stu.get("learner_interests"))
    story.append(Paragraph("<b>BIOGRAPHICAL INFORMATION</b>", body))
    line("Sex", stu.get("gender"), "Orphan", stu.get("orphan_status"))
    line("SNE/Disability", stu.get("sne_disability"), "Disability Type", stu.get("disability_type"))
    story.append(Spacer(1, 1.5 * mm))

    # ── (B)(C)(D) Parents ──────────────────────────────────────────────
    for key, title in (
        ("mother", "(B)  MOTHER'S DETAILS"),
        ("father", "(C)  FATHER'S DETAILS"),
        ("guardian", "(D)  IN CASE THERE ARE NO PARENTS PROVIDE GUARDIAN'S DETAILS"),
    ):
        p = parents.get(key) or {}
        section(title)
        line("First Name", p.get("first_name"), "Middle Name", p.get("middle_name"))
        line("Last Name", p.get("last_name"))
        if key == "guardian":
            line("Relationship", p.get("relationship"))
        line("Type of ID", p.get("id_type"), "National ID No", p.get("national_id"))
        line("Country of Residence", p.get("country_of_residence"))
        line("Mobile No", p.get("phone"), "Email", p.get("email"))
        story.append(Spacer(1, 1.5 * mm))

    story.append(HRFlowable(width="100%", thickness=1.4, color=colors.black))
    story.append(Paragraph(
        "Note: Attach copies of the Learner's Birth Certificate and Parents' IDs",
        _s("note", size=8.5, bold=True, align=TA_CENTER,
           color=colors.HexColor("#b91c1c"), space_after=0),
    ))

    doc_pdf.build(story)
    return buf.getvalue()
