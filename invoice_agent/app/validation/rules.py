"""Required fields, date logic, and whether extracted values appear in the document."""

import re
from datetime import date

from app.extraction.pages import has_text_layer
from app.schemas import Invoice, Issue, IssueCode, RawInvoice, Severity

_REQUIRED = {
    "vendor_name": "Vendor name",
    "invoice_number": "Invoice number",
    "invoice_date": "Invoice date",
    "currency": "Currency",
    "total": "Total",
}


def check_required(inv: Invoice) -> list[Issue]:
    issues = [Issue(code=IssueCode.MISSING_FIELD, severity=Severity.ERROR, field=name, message=f"{label} is missing.")
              for name, label in _REQUIRED.items() if getattr(inv, name) in (None, "")]
    if not inv.line_items:
        issues.append(Issue(code=IssueCode.MISSING_FIELD, severity=Severity.ERROR, field="line_items",
                            message="No line items were found."))
    return issues


def check_logic(inv: Invoice, today: date) -> list[Issue]:
    issues = []
    if inv.invoice_date and inv.invoice_date > today:
        issues.append(Issue(code=IssueCode.FUTURE_INVOICE_DATE, severity=Severity.WARNING, field="invoice_date",
                            found=inv.invoice_date.isoformat(),
                            message=f"The invoice date {inv.invoice_date.isoformat()} is in the future."))
    if inv.invoice_date and inv.due_date and inv.due_date < inv.invoice_date:
        issues.append(Issue(code=IssueCode.DUE_BEFORE_INVOICE, severity=Severity.WARNING, field="due_date",
                            found=inv.due_date.isoformat(),
                            message=f"The due date {inv.due_date.isoformat()} is before the invoice date {inv.invoice_date.isoformat()}."))
    for i, line in enumerate(inv.line_items):
        if line.amount is not None and line.amount < 0:
            issues.append(Issue(code=IssueCode.NEGATIVE_AMOUNT, severity=Severity.WARNING, field=f"line_items.{i}.amount",
                                found=f"{line.amount:,.2f}", message=f"Line {i + 1} has a negative amount."))
    if inv.total is not None and inv.total < 0:
        issues.append(Issue(code=IssueCode.NEGATIVE_AMOUNT, severity=Severity.WARNING, field="total",
                            found=f"{inv.total:,.2f}", message="The total is negative."))
    return issues


def check_source(raw: RawInvoice, pages: list[dict]) -> list[Issue]:
    """For digital PDFs, the values that matter must actually be printed. Scans have no text to compare."""
    if not pages or not all(has_text_layer(page) for page in pages):
        return []
    source = re.sub(r"\s", "", " ".join(page["text"] for page in pages))
    values = {"invoice_number": raw.invoice_number, "subtotal": raw.subtotal, "total": raw.total,
              "balance_due": raw.balance_due}
    values |= {f"line_items.{i}.amount": line.amount for i, line in enumerate(raw.line_items)}
    values |= {f"taxes.{i}.amount": tax.amount for i, tax in enumerate(raw.taxes)}
    return [Issue(code=IssueCode.VALUE_NOT_IN_SOURCE, severity=Severity.WARNING, field=name, found=value,
                  message=f"'{value}' was extracted but does not appear in the PDF text.")
            for name, value in values.items() if value and re.sub(r"\s", "", value) not in source]
