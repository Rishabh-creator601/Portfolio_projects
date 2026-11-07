"""Turns as-printed strings into Decimal and date values, and reports what it could not trust."""

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from app.gst import STATE_NAMES
from app.schemas import Invoice, Issue, IssueCode, LineItem, RawInvoice, Severity, TaxLine

_CURRENCY = re.compile(r"(?i)\b(rs\.?|inr|usd|eur|gbp)(?![a-z])|[₹$€£]")
_DAY_FIRST = ["%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y"]
_MONTH_FIRST = ["%m/%d/%Y", "%m-%d-%Y"]
_NAMED = ["%Y-%m-%d", "%d-%b-%Y", "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y", "%d-%B-%Y"]


def _amount_strings(raw: RawInvoice) -> list[str]:
    values = [raw.subtotal, raw.discount, raw.shipping, raw.round_off, raw.total, raw.amount_paid, raw.balance_due]
    values += [line.unit_price for line in raw.line_items] + [line.amount for line in raw.line_items]
    values += [tax.amount for tax in raw.taxes] + [tax.taxable_amount for tax in raw.taxes]
    return [v for v in values if v]


def detect_decimal_separator(values: list[str]) -> str | None:
    """Use the unambiguous amounts on an invoice, such as 12,50, to read ambiguous ones, such as 1.234."""
    dots = sum(bool(re.search(r"\.\d{2}\s*$", v)) for v in values)
    commas = sum(bool(re.search(r",\d{2}\s*$", v)) for v in values)
    if dots == commas:
        return None
    return "." if dots > commas else ","


def parse_number(text: str | None, separator: str | None = None) -> tuple[Decimal | None, bool]:
    """Return (value, trustworthy). A blank is (None, True); unreadable text is (None, False)."""
    if text is None or not text.strip():
        return None, True
    cleaned = _CURRENCY.sub("", text).replace("%", "")
    cleaned = re.sub(r"\s", "", cleaned)

    negative = False
    if cleaned.startswith("(") and cleaned.endswith(")"):
        negative, cleaned = True, cleaned[1:-1]
    if cleaned.endswith("-"):
        negative, cleaned = True, cleaned[:-1]
    if cleaned.startswith("-"):
        negative, cleaned = True, cleaned[1:]
    if not re.fullmatch(r"\d[\d.,]*", cleaned):
        return None, False

    trustworthy = True
    dots, commas = cleaned.count("."), cleaned.count(",")
    if dots and commas:
        decimal = "." if cleaned.rfind(".") > cleaned.rfind(",") else ","
    elif dots > 1 or commas > 1:
        decimal = None                                  # 1.234.567 or 1,00,000: grouping only
    elif dots or commas:
        mark = "." if dots else ","
        if len(cleaned.rsplit(mark, 1)[1]) == 3:        # 1,234 or 1.234: grouping or decimal?
            if separator:
                decimal = mark if separator == mark else None
            elif mark == ",":
                decimal = None                          # a comma before 3 digits is nearly always grouping
            else:
                decimal, trustworthy = ".", False       # 1.234 with no evidence either way
        else:
            decimal = mark
    else:
        decimal = None

    digits = cleaned
    for mark in ".,":
        if mark != decimal:
            digits = digits.replace(mark, "")
    if decimal:
        digits = digits.replace(decimal, ".")
    try:
        value = Decimal(digits)
    except InvalidOperation:
        return None, False
    return (-value if negative else value), trustworthy


def parse_date(text: str | None, currency: str | None = None) -> tuple[date | None, bool]:
    if text is None or not text.strip():
        return None, True
    text = text.strip()
    numeric = _MONTH_FIRST + _DAY_FIRST if currency == "USD" else _DAY_FIRST + _MONTH_FIRST
    for pattern in _NAMED + numeric:
        try:
            return datetime.strptime(text, pattern).date(), True
        except ValueError:
            continue
    return None, False


def parse_supply_code(text: str | None) -> str | None:
    if not text:
        return None
    match = re.search(r"\b(\d{2})\b", text)
    if match:
        return match.group(1)
    name = re.sub(r"\s+", " ", text.replace("&", "and")).strip().lower()
    return STATE_NAMES.get(name)


def _clean_tax_id(text: str | None) -> str | None:
    if not text:
        return None
    return re.sub(r"[\s-]", "", text).upper() or None


def _blank_to_none(text: str | None) -> str | None:
    return text.strip() or None if text else None


def normalize(raw: RawInvoice) -> tuple[Invoice, list[Issue]]:
    issues: list[Issue] = []
    separator = detect_decimal_separator(_amount_strings(raw))

    def number(text, field_name):
        value, trustworthy = parse_number(text, separator)
        if not trustworthy:
            message = (f"'{text}' could mean two different amounts." if value is not None
                       else f"'{text}' could not be read as a number.")
            issues.append(Issue(code=IssueCode.AMBIGUOUS_NUMBER, severity=Severity.WARNING, message=message,
                                field=field_name, found=text))
        return value

    currency = _blank_to_none(raw.currency)
    currency = currency.upper() if currency else None

    def when(text, field_name):
        value, readable = parse_date(text, currency)
        if not readable:
            issues.append(Issue(code=IssueCode.AMBIGUOUS_NUMBER, severity=Severity.WARNING,
                                message=f"'{text}' could not be read as a date.", field=field_name, found=text))
        return value

    lines = [
        LineItem(description=_blank_to_none(line.description), hsn_sac=_blank_to_none(line.hsn_sac),
                 quantity=number(line.quantity, f"line_items.{i}.quantity"),
                 unit_price=number(line.unit_price, f"line_items.{i}.unit_price"),
                 tax_rate=number(line.tax_rate, f"line_items.{i}.tax_rate"),
                 amount=number(line.amount, f"line_items.{i}.amount"))
        for i, line in enumerate(raw.line_items)
    ]
    taxes = [
        TaxLine(label=_blank_to_none(tax.label).upper() if _blank_to_none(tax.label) else None,
                rate=number(tax.rate, f"taxes.{i}.rate"),
                taxable_amount=number(tax.taxable_amount, f"taxes.{i}.taxable_amount"),
                amount=number(tax.amount, f"taxes.{i}.amount"))
        for i, tax in enumerate(raw.taxes)
    ]
    invoice = Invoice(
        vendor_name=_blank_to_none(raw.vendor_name), vendor_tax_id=_clean_tax_id(raw.vendor_tax_id),
        buyer_name=_blank_to_none(raw.buyer_name), buyer_tax_id=_clean_tax_id(raw.buyer_tax_id),
        invoice_number=_blank_to_none(raw.invoice_number),
        invoice_date=when(raw.invoice_date, "invoice_date"), due_date=when(raw.due_date, "due_date"),
        place_of_supply_code=parse_supply_code(raw.place_of_supply), currency=currency,
        prices_include_tax=bool(raw.prices_include_tax), line_items=lines,
        subtotal=number(raw.subtotal, "subtotal"), discount=number(raw.discount, "discount"),
        shipping=number(raw.shipping, "shipping"), taxes=taxes, round_off=number(raw.round_off, "round_off"),
        total=number(raw.total, "total"), amount_paid=number(raw.amount_paid, "amount_paid"),
        balance_due=number(raw.balance_due, "balance_due"),
    )
    return invoice, issues
