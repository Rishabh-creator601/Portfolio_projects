"""Draws a built case to a PDF. Only prints values from RawInvoice, so the file
and its answer key cannot disagree."""

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .cases import BuiltCase

LAYOUTS = {
    "classic": {"font": "Helvetica", "bold": "Helvetica-Bold", "accent": colors.HexColor("#333333"), "grid": True,
                "title": "TAX INVOICE"},
    "band": {"font": "Helvetica", "bold": "Helvetica-Bold", "accent": colors.HexColor("#1F4E79"), "grid": False,
             "title": "Invoice"},
    "minimal": {"font": "Times-Roman", "bold": "Times-Bold", "accent": colors.black, "grid": False,
                "title": "INVOICE"},
}


def _details(raw):
    rows = [
        ("Invoice No", raw.invoice_number),
        ("Invoice Date", raw.invoice_date),
        ("Due Date", raw.due_date),
        ("Place of Supply", raw.place_of_supply),
        ("Currency", raw.currency),
    ]
    return [[f"{k}:", v] for k, v in rows if v]


def _party(heading: str, name, tax_id, id_label: str, style):
    parts = [f"<b>{heading}</b>", name or ""]
    if tax_id:
        parts.append(f"{id_label}: {tax_id}")
    return Paragraph("<br/>".join(parts), style)


def _totals(raw):
    rows = [("Subtotal", raw.subtotal)]
    if raw.discount:
        rows.append(("Discount", raw.discount))
    if raw.shipping:
        rows.append(("Shipping", raw.shipping))
    for tax in raw.taxes:
        label = f"{tax.label} @ {tax.rate}"
        if tax.taxable_amount:
            label += f" on {tax.taxable_amount}"
        if raw.prices_include_tax:
            label += " (included)"
        rows.append((label, tax.amount))
    if raw.round_off:
        rows.append(("Round Off", raw.round_off))
    if raw.total:
        rows.append(("Total", raw.total))
    if raw.amount_paid:
        rows.append(("Amount Paid", raw.amount_paid))
    if raw.balance_due:
        rows.append(("Balance Due", raw.balance_due))
    return rows


def render_pdf(built: BuiltCase, path) -> None:
    raw = built.raw
    look = LAYOUTS[built.case.layout]
    font, bold, accent = look["font"], look["bold"], look["accent"]
    is_gst = built.case.tax_kind != "vat"
    id_label = "GSTIN" if is_gst else "VAT ID"

    styles = getSampleStyleSheet()
    body = styles["BodyText"].clone("body", fontName=font, fontSize=9, leading=12)
    cell = body.clone("cell", fontSize=8, leading=10)
    title = styles["Title"].clone("title", fontName=bold, fontSize=18, textColor=accent, alignment=0)

    story = [Paragraph(look["title"], title), Spacer(1, 4 * mm)]

    parties = Table(
        [[_party("From", raw.vendor_name, raw.vendor_tax_id, id_label, body),
          _party("Bill To", raw.buyer_name, raw.buyer_tax_id, id_label, body)]],
        colWidths=[85 * mm, 85 * mm],
    )
    parties.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [parties, Spacer(1, 4 * mm)]

    details = Table(_details(raw), colWidths=[32 * mm, 60 * mm], hAlign="LEFT")
    details.setStyle(TableStyle([
        ("FONT", (0, 0), (0, -1), bold, 9), ("FONT", (1, 0), (1, -1), font, 9),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    story += [details, Spacer(1, 5 * mm)]

    code_label = "HSN/SAC" if is_gst else "Code"
    rows = [["#", "Description", code_label, "Qty", "Unit Price", "Tax", "Amount"]]
    for i, line in enumerate(raw.line_items, 1):
        rows.append([str(i), Paragraph(line.description or "", cell), line.hsn_sac, line.quantity,
                     line.unit_price, line.tax_rate, line.amount])
    items = Table(rows, colWidths=[8 * mm, 66 * mm, 17 * mm, 12 * mm, 24 * mm, 13 * mm, 30 * mm], repeatRows=1)
    table_style = [
        ("FONT", (0, 0), (-1, 0), bold, 8), ("FONT", (0, 1), (-1, -1), font, 8),
        ("ALIGN", (3, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, accent),
    ]
    if look["grid"]:
        table_style.append(("GRID", (0, 0), (-1, -1), 0.4, colors.grey))
    if built.case.layout == "band":
        table_style += [("BACKGROUND", (0, 0), (-1, 0), accent), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#EEF3F8")])]
    items.setStyle(TableStyle(table_style))
    story += [items, Spacer(1, 4 * mm)]

    summary_rows = _totals(raw)
    totals = Table([[k, v] for k, v in summary_rows], colWidths=[75 * mm, 30 * mm], hAlign="RIGHT")
    total_style = [("FONT", (0, 0), (-1, -1), font, 9), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                   ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]
    for i, (label, _) in enumerate(summary_rows):
        if label in ("Total", "Balance Due"):
            total_style += [("FONT", (0, i), (-1, i), bold, 10), ("LINEABOVE", (0, i), (-1, i), 0.8, accent)]
    totals.setStyle(TableStyle(total_style))
    story.append(totals)

    if raw.prices_include_tax:
        story += [Spacer(1, 3 * mm), Paragraph("All prices are inclusive of tax.", body)]
    story += [Spacer(1, 8 * mm), Paragraph("Sample document generated for software testing. Not a real invoice.", cell)]

    SimpleDocTemplate(str(path), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                      topMargin=16 * mm, bottomMargin=16 * mm, title="Sample invoice").build(story)
