"""Builds the Excel workbook: Invoices, Line Items and Issues, linked by invoice ID."""

import io
from datetime import date
from decimal import Decimal

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

_MONEY_FORMAT = "#,##0.00"
_DATE_FORMAT = "yyyy-mm-dd"
_HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
_HEADER_FONT = Font(bold=True, color="FFFFFF")
_ERROR_FILL = PatternFill("solid", fgColor="F8CBAD")
_WARNING_FILL = PatternFill("solid", fgColor="FFE699")

_INVOICE_COLUMNS = [
    "Invoice ID", "File", "Status", "Reviewed", "Vendor", "Vendor Tax ID", "Buyer", "Buyer Tax ID", "Invoice No",
    "Invoice Date", "Due Date", "Place of Supply", "Currency", "Subtotal", "Discount", "Shipping", "CGST", "SGST",
    "IGST", "Other Tax", "Round Off", "Total", "Paid", "Balance Due", "Errors", "Warnings",
]
_FIELD_TO_COLUMN = {
    "vendor_name": "Vendor", "vendor_tax_id": "Vendor Tax ID", "buyer_tax_id": "Buyer Tax ID",
    "invoice_number": "Invoice No", "invoice_date": "Invoice Date", "due_date": "Due Date", "currency": "Currency",
    "subtotal": "Subtotal", "discount": "Discount", "shipping": "Shipping", "round_off": "Round Off", "total": "Total",
    "amount_paid": "Paid", "balance_due": "Balance Due",
}
_TAX_COLUMNS = ["CGST", "SGST", "IGST", "Other Tax"]
_LINE_COLUMNS = ["Invoice ID", "Invoice No", "Line", "Description", "HSN/SAC", "Qty", "Unit Price", "Tax Rate %", "Amount"]
_LINE_FIELD_TO_COLUMN = {"quantity": "Qty", "unit_price": "Unit Price", "tax_rate": "Tax Rate %", "amount": "Amount"}
_ISSUE_COLUMNS = ["Invoice ID", "Invoice No", "Severity", "Code", "Field", "Message", "Expected", "Found"]


def safe_text(value):
    """Invoice text is untrusted. Stop Excel from running it as a formula."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _number(value) -> Decimal | None:
    return Decimal(value) if value is not None else None


def _date(value) -> date | None:
    return date.fromisoformat(value) if value else None


def _write_header(sheet, columns):
    sheet.append(columns)
    for cell in sheet[1]:
        cell.fill, cell.font = _HEADER_FILL, _HEADER_FONT
        cell.alignment = Alignment(vertical="center")
    sheet.freeze_panes = "A2"


def _finish(sheet, widths: dict[str, int]):
    headers = [cell.value for cell in sheet[1]]
    for i, header in enumerate(headers, 1):
        sheet.column_dimensions[get_column_letter(i)].width = widths.get(header, max(12, len(header) + 3))
    if sheet.max_row > 1:
        sheet.auto_filter.ref = sheet.dimensions


def _format_cells(row, columns, money=(), dates=()):
    for cell, header in zip(row, columns):
        if header in money:
            cell.number_format = _MONEY_FORMAT
        elif header in dates:
            cell.number_format = _DATE_FORMAT


def _worst(issues: list[dict]) -> PatternFill:
    return _ERROR_FILL if any(i["severity"] == "error" for i in issues) else _WARNING_FILL


def build_workbook(records: list[dict]) -> bytes:
    book = Workbook()
    invoices = book.active
    invoices.title = "Invoices"
    lines = book.create_sheet("Line Items")
    issues_sheet = book.create_sheet("Issues")
    _write_header(invoices, _INVOICE_COLUMNS)
    _write_header(lines, _LINE_COLUMNS)
    _write_header(issues_sheet, _ISSUE_COLUMNS)

    money_columns = {"Subtotal", "Discount", "Shipping", *_TAX_COLUMNS, "Round Off", "Total", "Paid", "Balance Due"}
    line_money = {"Unit Price", "Amount"}

    for record in records:
        inv = record["data"].get("invoice") or {}
        issues = record["data"].get("issues") or []
        number = safe_text(inv.get("invoice_number"))

        taxes = {name: Decimal(0) for name in _TAX_COLUMNS}
        printed = set()
        for tax in inv.get("taxes", []):
            if tax.get("amount") is None:
                continue
            column = tax.get("label") if tax.get("label") in {"CGST", "SGST", "IGST"} else "Other Tax"
            taxes[column] += Decimal(tax["amount"])
            printed.add(column)

        invoices.append([
            record["id"], safe_text(record["filename"]), record["status"], "Yes" if record["reviewed"] else "No",
            safe_text(inv.get("vendor_name")), safe_text(inv.get("vendor_tax_id")), safe_text(inv.get("buyer_name")),
            safe_text(inv.get("buyer_tax_id")), number, _date(inv.get("invoice_date")), _date(inv.get("due_date")),
            safe_text(inv.get("place_of_supply_code")), safe_text(inv.get("currency")), _number(inv.get("subtotal")),
            _number(inv.get("discount")), _number(inv.get("shipping")),
            *[taxes[name] if name in printed else None for name in _TAX_COLUMNS],
            _number(inv.get("round_off")), _number(inv.get("total")), _number(inv.get("amount_paid")),
            _number(inv.get("balance_due")), sum(i["severity"] == "error" for i in issues),
            sum(i["severity"] == "warning" for i in issues),
        ])
        row = invoices[invoices.max_row]
        _format_cells(row, _INVOICE_COLUMNS, money_columns, {"Invoice Date", "Due Date"})

        first_line_row = lines.max_row + 1
        for i, line in enumerate(inv.get("line_items", []), 1):
            lines.append([
                record["id"], number, i, safe_text(line.get("description")), safe_text(line.get("hsn_sac")),
                _number(line.get("quantity")), _number(line.get("unit_price")), _number(line.get("tax_rate")),
                _number(line.get("amount")),
            ])
            _format_cells(lines[lines.max_row], _LINE_COLUMNS, line_money)

        for issue in issues:
            issues_sheet.append([
                record["id"], number, issue["severity"], issue["code"], issue.get("field"), safe_text(issue["message"]),
                safe_text(issue.get("expected")), safe_text(issue.get("found")),
            ])
            fill = _ERROR_FILL if issue["severity"] == "error" else _WARNING_FILL
            issues_sheet.cell(issues_sheet.max_row, 3).fill = fill

        # Highlight the cells the flags point to.
        for issue in issues:
            field = issue.get("field") or ""
            parts = field.split(".")
            fill = _worst([i for i in issues if i.get("field") == field])
            if parts[0] == "line_items" and len(parts) == 3 and parts[2] in _LINE_FIELD_TO_COLUMN:
                column = _LINE_COLUMNS.index(_LINE_FIELD_TO_COLUMN[parts[2]]) + 1
                lines.cell(first_line_row + int(parts[1]), column).fill = fill
            elif parts[0] == "taxes":
                for name in _TAX_COLUMNS:
                    if name in printed:
                        row[_INVOICE_COLUMNS.index(name)].fill = fill
            elif field in _FIELD_TO_COLUMN:
                row[_INVOICE_COLUMNS.index(_FIELD_TO_COLUMN[field])].fill = fill

    _finish(invoices, {"Invoice ID": 16, "File": 34, "Vendor": 32, "Buyer": 32, "Vendor Tax ID": 19, "Buyer Tax ID": 19,
                       "Invoice No": 18, "Invoice Date": 13, "Due Date": 12, "Total": 14})
    _finish(lines, {"Invoice ID": 16, "Invoice No": 18, "Description": 44, "Amount": 14, "Unit Price": 13})
    _finish(issues_sheet, {"Invoice ID": 16, "Invoice No": 18, "Code": 26, "Field": 24, "Message": 80,
                           "Expected": 16, "Found": 28})

    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()
