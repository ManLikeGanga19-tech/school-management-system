"""Phase F5 — invoice PDF renders an explicit Scholarship Discount subtotal
row when the invoice carries scholarship-tagged negative lines.

invoice_pdf compresses its content stream with FlateDecode, so we inflate
each stream object and concatenate the text-show operators before asserting
on the visible text.
"""
from __future__ import annotations

import re
import zlib
from decimal import Decimal

import pytest

from app.utils.invoice_pdf import generate_invoice_pdf


def _extract_text(pdf: bytes) -> str:
    """Find every FlateDecode-encoded stream and inflate it. Concatenate the
    text inside (Tj ...) operators so caller can substring-search."""
    chunks: list[str] = []
    # Greedy split on `stream\n` ... `\nendstream` blocks.
    for match in re.finditer(rb"stream\n(.*?)\nendstream", pdf, flags=re.DOTALL):
        raw = match.group(1)
        try:
            decoded = zlib.decompress(raw)
        except zlib.error:
            continue
        # Pull text from `(literal) Tj` operators.
        for tj in re.finditer(rb"\((.*?)\)\s*Tj", decoded):
            try:
                chunks.append(tj.group(1).decode("latin-1"))
            except Exception:
                pass
    return "\n".join(chunks)


def _base_payload(*, lines):
    """Minimal valid build_invoice_document() shape."""
    total = sum(Decimal(str(l["amount"])) for l in lines)
    return {
        "document_type":      "INVOICE",
        "document_no":        "INV-PDF-001",
        "invoice_no":         "INV-PDF-001",
        "student_name":       "Test Student",
        "admission_no":       "A-001",
        "class_code":         "GRADE_1",
        "parent_name":        "Parent",
        "currency":           "KES",
        "status":             "ISSUED",
        "term_number":        1,
        "academic_year":      2026,
        "student_type_snapshot": "RETURNING",
        "created_at":         "2026-01-15T08:00:00",
        "lines":              lines,
        "total_amount":       str(total),
        "paid_amount":        "0",
        "balance_amount":     str(total),
        "payment_settings":   {},
        "profile":            {"school_header": "Acme Test School"},
    }


def test_scholarship_subtotal_row_appears_when_discount_present():
    lines = [
        {"description": "Tuition", "amount": "10000", "meta": {}},
        {
            "description": "Scholarship: Bursary",
            "amount": "-3000",
            "meta": {"scholarship_id": "abc"},
        },
    ]
    pdf = generate_invoice_pdf(_base_payload(lines=lines))
    assert pdf.startswith(b"%PDF-")
    text = _extract_text(pdf)
    assert "Scholarship Discount:" in text
    assert "Fees Subtotal:" in text


def test_no_scholarship_row_when_no_discount():
    lines = [{"description": "Tuition", "amount": "10000", "meta": {}}]
    text = _extract_text(generate_invoice_pdf(_base_payload(lines=lines)))
    assert "Fees Subtotal:" in text
    assert "Scholarship Discount:" not in text


def test_other_credits_row_for_non_scholarship_negatives():
    lines = [
        {"description": "Tuition", "amount": "10000", "meta": {}},
        {
            "description": "Interview Fee Credit",
            "amount": "-500",
            "meta": {"line_type": "INTERVIEW_CREDIT"},
        },
    ]
    text = _extract_text(generate_invoice_pdf(_base_payload(lines=lines)))
    assert "Other Credits:" in text
    assert "Scholarship Discount:" not in text
