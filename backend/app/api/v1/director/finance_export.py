"""Director finance report exports — CSV + branded PDF.

Both formats consume the same in-memory bundle assembled from
`app.api.v1.tenants.dashboard_stats` so the numbers on the dashboard,
the CSV, and the PDF agree to the cent.

The PDF uses the tenant print profile (school header, motto, address,
contact line) so the branded report matches every other document the
system prints (invoices, receipts, fee structures).
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.v1.finance.service import get_tenant_print_profile
from app.api.v1.tenants.dashboard_stats import (
    _resolve_current_term_by_date,
    get_finance_all_time,
    get_finance_by_class,
    get_finance_by_provider,
    get_finance_by_term,
    get_finance_current_term,
    get_scholarship_breakdown,
    get_student_demographics,
    get_top_outstanding,
)


# ── Bundle ──────────────────────────────────────────────────────────────────


def build_finance_report_bundle(db: Session, *, tenant_id: UUID) -> dict[str, Any]:
    current = _resolve_current_term_by_date(db, tenant_id=tenant_id)
    return {
        "generated_at":    datetime.now(timezone.utc).isoformat(),
        "all_time":        get_finance_all_time(db, tenant_id=tenant_id),
        "current_term":    get_finance_current_term(db, tenant_id=tenant_id, current_term=current),
        "demographics":    get_student_demographics(db, tenant_id=tenant_id),
        "by_class":        get_finance_by_class(db, tenant_id=tenant_id),
        "by_term":         get_finance_by_term(db, tenant_id=tenant_id),
        "by_provider":     get_finance_by_provider(db, tenant_id=tenant_id),
        "top_outstanding": get_top_outstanding(db, tenant_id=tenant_id, limit=20),
        "scholarships":    get_scholarship_breakdown(db, tenant_id=tenant_id),
        "active_term":     current,
    }


# ── CSV ─────────────────────────────────────────────────────────────────────

def _money(v: Any) -> str:
    try:
        return f"{float(v):.2f}"
    except Exception:
        return "0.00"


def build_finance_report_csv(bundle: dict[str, Any], *, school_name: str) -> bytes:
    """Multi-section CSV. Each section starts with a `# Section` divider and a
    header row, then data rows. Sticks to ASCII so the file opens cleanly in
    every spreadsheet tool without import wizards. KES amounts are emitted as
    plain decimals so totals stay summable in Excel/Sheets."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow([f"# {school_name} — Finance Report"])
    w.writerow([f"# Generated: {bundle['generated_at']}"])
    w.writerow([])

    at = bundle["all_time"]
    w.writerow(["# All-time finance"])
    w.writerow(["Metric", "Value"])
    w.writerow(["Total billed (KES)",       _money(at["total_billed"])])
    w.writerow(["Total collected (KES)",    _money(at["total_collected"])])
    w.writerow(["Total outstanding (KES)",  _money(at["total_outstanding"])])
    w.writerow(["Invoice count",            int(at["invoice_count"])])
    w.writerow(["Payment count",            int(at["payment_count"])])
    w.writerow(["Collection rate (%)",      int(at["collection_rate_pct"])])
    w.writerow([])

    ct = bundle["current_term"]
    if ct:
        w.writerow([f"# Current term — {ct.get('term_name') or ct.get('term_code') or ''}"])
        w.writerow(["Metric", "Value"])
        w.writerow(["Term billed (KES)",      _money(ct["term_billed"])])
        w.writerow(["Term collected (KES)",   _money(ct["term_collected"])])
        w.writerow(["Term outstanding (KES)", _money(ct["term_outstanding"])])
        w.writerow(["Term invoice count",     int(ct["term_invoice_count"])])
        w.writerow(["Term collection rate (%)", int(ct["term_collection_rate_pct"])])
        if ct.get("term_number") is not None:
            w.writerow(["Term number",        int(ct["term_number"])])
        if ct.get("academic_year") is not None:
            w.writerow(["Academic year",      int(ct["academic_year"])])
        w.writerow([])

    dem = bundle["demographics"]
    w.writerow(["# Student demographics"])
    w.writerow(["Bucket", "Count", "Percentage"])
    w.writerow(["Boys",        int(dem["male_count"]),        f"{int(dem['male_pct'])}%"])
    w.writerow(["Girls",       int(dem["female_count"]),      f"{int(dem['female_pct'])}%"])
    w.writerow(["Unspecified", int(dem["unspecified_count"]), f"{int(dem['unspecified_pct'])}%"])
    w.writerow(["Total",       int(dem["total_students"]),    "100%"])
    w.writerow([])

    w.writerow(["# Finance by class"])
    w.writerow(["Class", "Billed (KES)", "Collected (KES)", "Outstanding (KES)", "Invoices"])
    for row in bundle["by_class"]:
        w.writerow([
            row["class_code"], _money(row["billed"]), _money(row["collected"]),
            _money(row["outstanding"]), int(row["invoice_count"]),
        ])
    w.writerow([])

    w.writerow(["# Finance by term"])
    w.writerow(["Term", "Year", "Billed (KES)", "Collected (KES)", "Outstanding (KES)", "Invoices"])
    for row in bundle["by_term"]:
        w.writerow([
            int(row["term_number"]), int(row["academic_year"]),
            _money(row["billed"]), _money(row["collected"]),
            _money(row["outstanding"]), int(row["invoice_count"]),
        ])
    w.writerow([])

    w.writerow(["# Payments by provider"])
    w.writerow(["Provider", "Payments", "Amount (KES)"])
    for row in bundle["by_provider"]:
        w.writerow([row["provider"], int(row["payment_count"]), _money(row["amount"])])
    w.writerow([])

    w.writerow(["# Top outstanding balances"])
    w.writerow(["Student", "Admission", "Class", "Outstanding (KES)", "Invoices"])
    for row in bundle["top_outstanding"]:
        w.writerow([
            row["student_name"], row.get("admission_no") or "",
            row.get("class_code") or "",
            _money(row["outstanding"]), int(row["invoice_count"]),
        ])
    w.writerow([])

    sch = bundle.get("scholarships") or {}
    summary = sch.get("summary") or {}
    w.writerow(["# Scholarships"])
    w.writerow(["Metric", "Value"])
    w.writerow(["Total discount granted (KES)", _money(summary.get("total_discount_granted") or 0)])
    w.writerow(["Active allocations",            int(summary.get("active_allocations") or 0)])
    w.writerow(["Unique recipients",             int(summary.get("unique_recipients") or 0)])
    w.writerow(["Active scholarships",           int(summary.get("active_scholarships") or 0)])
    # Phase M3 — student-level grants (attached at student level, auto-
    # apply on every subsequent invoice via Phase M2).
    w.writerow(["Active grants",                 int(summary.get("active_grants") or 0)])
    w.writerow(["Unique grant recipients",       int(summary.get("unique_grant_recipients") or 0)])
    w.writerow([])

    w.writerow(["# Scholarships — per programme"])
    w.writerow([
        "Name", "Type", "Budget (KES)", "Allocated (KES)", "Remaining (KES)",
        "Recipients", "Cap", "Active allocs", "Revoked allocs",
        "Active grants",
        "Active?", "Covers carry-forward?",
    ])
    for row in (sch.get("by_scholarship") or []):
        rem = row.get("remaining")
        w.writerow([
            row["name"], row["type"],
            _money(row.get("budget") or 0),
            _money(row.get("allocated") or 0),
            "" if rem is None else _money(rem),
            int(row.get("unique_recipients") or 0),
            "" if row.get("max_recipients") is None else int(row["max_recipients"]),
            int(row.get("active_allocations") or 0),
            int(row.get("revoked_allocations") or 0),
            int(row.get("active_grants") or 0),
            "yes" if row.get("is_active") else "no",
            "yes" if row.get("covers_carry_forward") else "no",
        ])
    w.writerow([])

    # Phase M3 — Top beneficiaries by total ACTIVE discount received.
    # Drives director's "who has the biggest bursary" view without needing
    # to click into individual student profiles.
    top = sch.get("top_beneficiaries") or []
    if top:
        w.writerow(["# Top Scholarship Beneficiaries"])
        w.writerow([
            "Student", "Admission", "Total discount (KES)",
            "Allocations", "Scholarships", "Active grants",
        ])
        for row in top:
            w.writerow([
                row.get("student_name") or "",
                row.get("admission_no") or "",
                _money(row.get("total_allocated") or 0),
                int(row.get("allocation_count") or 0),
                int(row.get("scholarship_count") or 0),
                int(row.get("active_grants") or 0),
            ])

    return buf.getvalue().encode("utf-8")


# ── PDF (reportlab, branded with tenant print profile) ─────────────────────

def build_finance_report_pdf(
    bundle: dict[str, Any], *, profile: dict[str, Any]
) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        HRFlowable, PageBreak,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

    school = str(profile.get("school_header") or profile.get("school_name") or "School")
    motto = str(profile.get("school_motto") or "")
    po_box = str(profile.get("po_box") or "")
    addr = str(profile.get("physical_address") or "")
    phone = str(profile.get("phone") or "")
    email = str(profile.get("email") or "")
    sig_name = str(profile.get("authorized_signatory_name") or "")
    sig_title = str(profile.get("authorized_signatory_title") or "Authorized Signatory")

    teal = colors.HexColor("#173f49")
    sage = colors.HexColor("#20644f")
    rust = colors.HexColor("#a24d35")
    grid = colors.HexColor("#cedfe1")
    alt = colors.HexColor("#f4f8f9")

    styles = getSampleStyleSheet()

    def style(name: str, *, size: int = 9, bold: bool = False,
              align: int = TA_LEFT, color: Any = colors.black) -> ParagraphStyle:
        return ParagraphStyle(
            name,
            parent=styles["Normal"],
            fontSize=size,
            leading=size + 3,
            alignment=align,
            fontName="Helvetica-Bold" if bold else "Helvetica",
            textColor=color,
            spaceAfter=2,
        )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=14 * mm, bottomMargin=14 * mm,
        leftMargin=14 * mm, rightMargin=14 * mm,
        title=f"{school} Finance Report",
        author=school,
    )

    story: list[Any] = []

    # ── Branded header band ──
    header_lines = [Paragraph(school.upper(), style("hdr", size=15, bold=True, color=teal))]
    contact_parts = []
    if po_box:
        contact_parts.append(f"P.O. Box {po_box}")
    if addr:
        contact_parts.append(addr)
    if contact_parts:
        header_lines.append(Paragraph(" · ".join(contact_parts), style("a", size=8)))
    line2 = []
    if phone:
        line2.append(f"Tel: {phone}")
    if email:
        line2.append(email)
    if line2:
        header_lines.append(Paragraph(" · ".join(line2), style("b", size=8)))
    if motto:
        header_lines.append(Paragraph(f"<i>{motto}</i>", style("m", size=8, color=sage)))

    story.extend(header_lines)
    story.append(Spacer(1, 3 * mm))
    story.append(HRFlowable(width="100%", thickness=1.2, color=teal))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph("FINANCE REPORT", style("t", size=12, bold=True, color=teal)))
    generated = str(bundle.get("generated_at") or "")
    try:
        gen_pretty = datetime.fromisoformat(generated.replace("Z", "+00:00")).strftime("%d %b %Y, %H:%M UTC")
    except Exception:
        gen_pretty = generated
    story.append(Paragraph(f"Generated: {gen_pretty}", style("g", size=8, color=colors.grey)))
    story.append(Spacer(1, 4 * mm))

    # ── KPI cards (2x2 mini-table) ──
    at = bundle["all_time"]
    kpi_data = [
        [
            Paragraph("<b>Total Billed</b>", style("k", size=8, color=colors.grey)),
            Paragraph("<b>Collected</b>",    style("k", size=8, color=colors.grey)),
            Paragraph("<b>Outstanding</b>",  style("k", size=8, color=colors.grey)),
            Paragraph("<b>Collection Rate</b>", style("k", size=8, color=colors.grey)),
        ],
        [
            Paragraph(f"<b>KES {at['total_billed']:,.2f}</b>",      style("v", size=11, bold=True, color=teal)),
            Paragraph(f"<b>KES {at['total_collected']:,.2f}</b>",   style("v", size=11, bold=True, color=sage)),
            Paragraph(f"<b>KES {at['total_outstanding']:,.2f}</b>", style("v", size=11, bold=True, color=rust)),
            Paragraph(f"<b>{at['collection_rate_pct']}%</b>",       style("v", size=11, bold=True, color=teal)),
        ],
    ]
    kpi_table = Table(kpi_data, colWidths=[None, None, None, None])
    kpi_table.setStyle(TableStyle([
        ("BOX",        (0, 0), (-1, -1), 0.5, grid),
        ("INNERGRID",  (0, 0), (-1, -1), 0.3, grid),
        ("BACKGROUND", (0, 0), (-1, 0),  alt),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 5 * mm))

    # ── Current term section ──
    ct = bundle.get("current_term")
    if ct:
        story.append(Paragraph(
            f"Current Term — {ct.get('term_name') or ct.get('term_code') or ''}",
            style("ct", size=11, bold=True, color=teal),
        ))
        if ct.get("term_number") is not None and ct.get("academic_year") is not None:
            story.append(Paragraph(
                f"Term {ct['term_number']} · {ct['academic_year']}",
                style("ctm", size=8, color=colors.grey),
            ))
        story.append(Spacer(1, 2 * mm))
        ct_rows = [
            ["Term Billed",      f"KES {ct['term_billed']:,.2f}",      f"{ct['term_invoice_count']} invoices"],
            ["Term Collected",   f"KES {ct['term_collected']:,.2f}",   f"{ct['term_collection_rate_pct']}%"],
            ["Term Outstanding", f"KES {ct['term_outstanding']:,.2f}", ""],
        ]
        ct_table = Table(ct_rows, colWidths=[55 * mm, 55 * mm, None])
        ct_table.setStyle(TableStyle([
            ("FONTSIZE",   (0, 0), (-1, -1), 9),
            ("BOX",        (0, 0), (-1, -1), 0.5, grid),
            ("INNERGRID",  (0, 0), (-1, -1), 0.3, grid),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, alt]),
            ("LEFTPADDING",   (0, 0), (-1, -1), 6),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
            ("TOPPADDING",    (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(ct_table)
        story.append(Spacer(1, 5 * mm))

    # ── Demographics ──
    dem = bundle["demographics"]
    story.append(Paragraph("Student Demographics", style("d", size=11, bold=True, color=teal)))
    story.append(Spacer(1, 2 * mm))
    dem_rows = [
        ["Bucket", "Count", "Share"],
        ["Boys",        f"{dem['male_count']:,}",        f"{dem['male_pct']}%"],
        ["Girls",       f"{dem['female_count']:,}",      f"{dem['female_pct']}%"],
        ["Unspecified", f"{dem['unspecified_count']:,}", f"{dem['unspecified_pct']}%"],
        ["Total",       f"{dem['total_students']:,}",    "100%"],
    ]
    dem_table = Table(dem_rows, colWidths=[60 * mm, 40 * mm, 40 * mm])
    dem_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), teal),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, -1), 9),
        ("BOX",        (0, 0), (-1, -1), 0.5, grid),
        ("INNERGRID",  (0, 0), (-1, -1), 0.3, grid),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, alt]),
        ("FONTNAME",   (0, -1), (-1, -1), "Helvetica-Bold"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(dem_table)
    story.append(Spacer(1, 5 * mm))

    # ── By class ──
    by_class = bundle.get("by_class") or []
    if by_class:
        story.append(Paragraph("Finance by Class", style("bc", size=11, bold=True, color=teal)))
        story.append(Spacer(1, 2 * mm))
        bc_rows = [["Class", "Billed", "Collected", "Outstanding", "Invoices"]]
        for row in by_class:
            bc_rows.append([
                row["class_code"],
                f"KES {row['billed']:,.2f}",
                f"KES {row['collected']:,.2f}",
                f"KES {row['outstanding']:,.2f}",
                f"{row['invoice_count']}",
            ])
        bc_table = Table(bc_rows, repeatRows=1, colWidths=[28 * mm, 38 * mm, 38 * mm, 38 * mm, 22 * mm])
        bc_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), teal),
            ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
            ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",   (0, 0), (-1, -1), 8.5),
            ("ALIGN",      (1, 1), (-1, -1), "RIGHT"),
            ("BOX",        (0, 0), (-1, -1), 0.5, grid),
            ("INNERGRID",  (0, 0), (-1, -1), 0.3, grid),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, alt]),
        ]))
        story.append(bc_table)
        story.append(Spacer(1, 5 * mm))

    # ── By term ──
    by_term = bundle.get("by_term") or []
    if by_term:
        story.append(Paragraph("Finance by Term", style("bt", size=11, bold=True, color=teal)))
        story.append(Spacer(1, 2 * mm))
        bt_rows = [["Year", "Term", "Billed", "Collected", "Outstanding", "Invoices"]]
        for row in by_term:
            bt_rows.append([
                f"{row['academic_year']}", f"T{row['term_number']}",
                f"KES {row['billed']:,.2f}",
                f"KES {row['collected']:,.2f}",
                f"KES {row['outstanding']:,.2f}",
                f"{row['invoice_count']}",
            ])
        bt_table = Table(bt_rows, repeatRows=1)
        bt_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), teal),
            ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
            ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",   (0, 0), (-1, -1), 8.5),
            ("ALIGN",      (2, 1), (-1, -1), "RIGHT"),
            ("BOX",        (0, 0), (-1, -1), 0.5, grid),
            ("INNERGRID",  (0, 0), (-1, -1), 0.3, grid),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, alt]),
        ]))
        story.append(bt_table)
        story.append(Spacer(1, 5 * mm))

    # ── Payments by provider ──
    by_prov = bundle.get("by_provider") or []
    if by_prov:
        story.append(PageBreak())
        story.append(Paragraph("Payments by Provider", style("bp", size=11, bold=True, color=teal)))
        story.append(Spacer(1, 2 * mm))
        prov_rows = [["Provider", "Payments", "Amount"]]
        for row in by_prov:
            prov_rows.append([
                row["provider"], f"{row['payment_count']:,}",
                f"KES {row['amount']:,.2f}",
            ])
        prov_table = Table(prov_rows, repeatRows=1, colWidths=[60 * mm, 40 * mm, 60 * mm])
        prov_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), teal),
            ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
            ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",   (0, 0), (-1, -1), 9),
            ("ALIGN",      (1, 1), (-1, -1), "RIGHT"),
            ("BOX",        (0, 0), (-1, -1), 0.5, grid),
            ("INNERGRID",  (0, 0), (-1, -1), 0.3, grid),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, alt]),
        ]))
        story.append(prov_table)
        story.append(Spacer(1, 5 * mm))

    # ── Top outstanding ──
    top_out = bundle.get("top_outstanding") or []
    if top_out:
        story.append(Paragraph("Top Outstanding Balances", style("to", size=11, bold=True, color=rust)))
        story.append(Spacer(1, 2 * mm))
        to_rows = [["Student", "Adm. No.", "Class", "Outstanding", "Invoices"]]
        for row in top_out:
            to_rows.append([
                row["student_name"],
                row.get("admission_no") or "—",
                row.get("class_code") or "—",
                f"KES {row['outstanding']:,.2f}",
                f"{row['invoice_count']}",
            ])
        to_table = Table(to_rows, repeatRows=1, colWidths=[60 * mm, 28 * mm, 24 * mm, 38 * mm, 22 * mm])
        to_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), rust),
            ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
            ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",   (0, 0), (-1, -1), 8.5),
            ("ALIGN",      (3, 1), (-1, -1), "RIGHT"),
            ("BOX",        (0, 0), (-1, -1), 0.5, grid),
            ("INNERGRID",  (0, 0), (-1, -1), 0.3, grid),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, alt]),
        ]))
        story.append(to_table)
        story.append(Spacer(1, 5 * mm))

    # ── Scholarships ──
    sch_bundle = bundle.get("scholarships") or {}
    sch_rows = sch_bundle.get("by_scholarship") or []
    sch_summary = sch_bundle.get("summary") or {}
    sch_top = sch_bundle.get("top_beneficiaries") or []
    if sch_rows or sch_summary.get("active_scholarships"):
        story.append(Paragraph("Scholarships", style("sch", size=11, bold=True, color=sage)))
        story.append(Spacer(1, 2 * mm))

        # Compact summary row — 5 KPI tiles (Phase M3 adds the active-grants
        # count so directors can see forward-looking commitments too).
        s_kpi = [
            [
                Paragraph("<b>Discount granted</b>", style("k", size=8, color=colors.grey)),
                Paragraph("<b>Active allocations</b>", style("k", size=8, color=colors.grey)),
                Paragraph("<b>Recipients</b>", style("k", size=8, color=colors.grey)),
                Paragraph("<b>Active scholarships</b>", style("k", size=8, color=colors.grey)),
                Paragraph("<b>Active grants</b>", style("k", size=8, color=colors.grey)),
            ],
            [
                Paragraph(f"<b>KES {sch_summary.get('total_discount_granted', 0):,.2f}</b>",
                          style("v", size=11, bold=True, color=sage)),
                Paragraph(f"<b>{int(sch_summary.get('active_allocations') or 0)}</b>",
                          style("v", size=11, bold=True, color=teal)),
                Paragraph(f"<b>{int(sch_summary.get('unique_recipients') or 0)}</b>",
                          style("v", size=11, bold=True, color=teal)),
                Paragraph(f"<b>{int(sch_summary.get('active_scholarships') or 0)}</b>",
                          style("v", size=11, bold=True, color=teal)),
                Paragraph(
                    f"<b>{int(sch_summary.get('active_grants') or 0)}</b>",
                    style("v", size=11, bold=True, color=teal),
                ),
            ],
        ]
        s_kpi_table = Table(s_kpi, colWidths=[None, None, None, None, None])
        s_kpi_table.setStyle(TableStyle([
            ("BOX",        (0, 0), (-1, -1), 0.5, grid),
            ("INNERGRID",  (0, 0), (-1, -1), 0.3, grid),
            ("BACKGROUND", (0, 0), (-1, 0),  alt),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(s_kpi_table)
        story.append(Spacer(1, 4 * mm))

        if sch_rows:
            sr_rows = [["Programme", "Type", "Budget", "Allocated", "Recip.", "Status"]]
            for row in sch_rows:
                budget_cell = "—" if (row["type"] or "").upper() != "FIXED" else f"KES {row['budget']:,.2f}"
                recip_cell = (
                    f"{row.get('unique_recipients', 0)}/{row['max_recipients']}"
                    if row.get("max_recipients") is not None
                    else str(row.get("unique_recipients", 0))
                )
                status_cell = "Active" if row.get("is_active") else "Inactive"
                if row.get("revoked_allocations"):
                    status_cell += f" · {row['revoked_allocations']} revoked"
                sr_rows.append([
                    row["name"],
                    row["type"].replace("_", " ").title(),
                    budget_cell,
                    f"KES {row['allocated']:,.2f}",
                    recip_cell,
                    status_cell,
                ])
            sr_table = Table(
                sr_rows, repeatRows=1,
                colWidths=[55 * mm, 30 * mm, 32 * mm, 32 * mm, 20 * mm, 30 * mm],
            )
            sr_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), sage),
                ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
                ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE",   (0, 0), (-1, -1), 8.5),
                ("ALIGN",      (2, 1), (4, -1), "RIGHT"),
                ("BOX",        (0, 0), (-1, -1), 0.5, grid),
                ("INNERGRID",  (0, 0), (-1, -1), 0.3, grid),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, alt]),
            ]))
            story.append(sr_table)
            story.append(Spacer(1, 5 * mm))

        # Phase M3 — Top beneficiaries. Shows who's on the biggest
        # bursaries so directors can reconcile against board policy at
        # a glance without opening individual student profiles.
        if sch_top:
            story.append(Paragraph(
                "Top Scholarship Beneficiaries",
                style("tb", size=11, bold=True, color=sage),
            ))
            story.append(Spacer(1, 2 * mm))
            tb_rows = [[
                "Student", "Admission", "Total discount",
                "Allocs", "Progs", "Grants",
            ]]
            for row in sch_top:
                tb_rows.append([
                    row.get("student_name") or "",
                    row.get("admission_no") or "—",
                    f"KES {float(row.get('total_allocated') or 0):,.2f}",
                    str(int(row.get("allocation_count") or 0)),
                    str(int(row.get("scholarship_count") or 0)),
                    str(int(row.get("active_grants") or 0)),
                ])
            tb_table = Table(
                tb_rows, repeatRows=1,
                colWidths=[55 * mm, 28 * mm, 38 * mm, 16 * mm, 16 * mm, 16 * mm],
            )
            tb_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), sage),
                ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
                ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE",   (0, 0), (-1, -1), 8.5),
                ("ALIGN",      (2, 1), (-1, -1), "RIGHT"),
                ("BOX",        (0, 0), (-1, -1), 0.5, grid),
                ("INNERGRID",  (0, 0), (-1, -1), 0.3, grid),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, alt]),
            ]))
            story.append(tb_table)
            story.append(Spacer(1, 5 * mm))

    # ── Footer / signature line ──
    story.append(Spacer(1, 8 * mm))
    story.append(HRFlowable(width="60%", thickness=0.5, color=colors.grey, hAlign="LEFT"))
    if sig_name:
        story.append(Paragraph(sig_name, style("sig", size=9, bold=True)))
    if sig_title:
        story.append(Paragraph(sig_title, style("sigt", size=8, color=colors.grey)))

    doc.build(story)
    return buf.getvalue()
