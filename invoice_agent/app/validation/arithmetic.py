"""Line, subtotal, total, balance and tax math."""

from decimal import ROUND_HALF_UP, Decimal

from app.config import TOLERANCE
from app.schemas import Invoice, Issue, IssueCode, Severity


def _money(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):,.2f}"


def _mismatch(code: IssueCode, field: str, what: str, expected: Decimal, found: Decimal) -> Issue:
    return Issue(code=code, severity=Severity.ERROR, field=field, expected=_money(expected), found=_money(found),
                 message=f"{what} should be {_money(expected)} but the invoice shows {_money(found)}.")


def check_arithmetic(inv: Invoice) -> list[Issue]:
    issues = []

    for i, line in enumerate(inv.line_items):
        if line.quantity is None or line.unit_price is None or line.amount is None:
            continue
        expected = line.quantity * line.unit_price
        if abs(expected - line.amount) > TOLERANCE:
            issues.append(_mismatch(IssueCode.LINE_AMOUNT_MISMATCH, f"line_items.{i}.amount",
                                    f"Line {i + 1} amount", expected, line.amount))

    amounts = [line.amount for line in inv.line_items]
    if inv.subtotal is not None and amounts and all(a is not None for a in amounts):
        expected = sum(amounts, Decimal(0))
        if abs(expected - inv.subtotal) > TOLERANCE:
            issues.append(_mismatch(IssueCode.SUBTOTAL_MISMATCH, "subtotal", "Subtotal", expected, inv.subtotal))

    tax_amounts = [tax.amount for tax in inv.taxes]
    if inv.total is not None and inv.subtotal is not None and all(a is not None for a in tax_amounts):
        expected = inv.subtotal - abs(inv.discount or 0) + (inv.shipping or 0) + (inv.round_off or 0)
        if not inv.prices_include_tax:
            expected += sum(tax_amounts, Decimal(0))
        if abs(expected - inv.total) > TOLERANCE:
            issues.append(_mismatch(IssueCode.TOTAL_MISMATCH, "total", "Total", expected, inv.total))

    if inv.total is not None and inv.amount_paid is not None and inv.balance_due is not None:
        expected = inv.total - inv.amount_paid
        if abs(expected - inv.balance_due) > TOLERANCE:
            issues.append(_mismatch(IssueCode.BALANCE_MISMATCH, "balance_due", "Balance due", expected, inv.balance_due))

    return issues


def _derived_base(inv: Invoice, rate: Decimal, label: str | None) -> Decimal | None:
    """Work out the taxable amount when the invoice doesn't print it. None if it can't be done safely."""
    if inv.prices_include_tax or inv.shipping:     # shipping may or may not be taxed
        return None
    full_rate = rate * 2 if label in {"CGST", "SGST"} else rate
    rates = {line.tax_rate for line in inv.line_items}
    if None in rates or any(line.amount is None for line in inv.line_items) or full_rate not in rates:
        return None
    if len(rates) == 1 and inv.subtotal is not None:
        return inv.subtotal - abs(inv.discount or 0)
    if inv.discount:
        return None                                 # can't tell how a discount splits across rates
    return sum((line.amount for line in inv.line_items if line.tax_rate == full_rate), Decimal(0))


def check_tax_amounts(inv: Invoice) -> list[Issue]:
    issues = []
    for i, tax in enumerate(inv.taxes):
        if tax.rate is None or tax.amount is None:
            continue
        base = tax.taxable_amount if tax.taxable_amount is not None else _derived_base(inv, tax.rate, tax.label)
        if base is None:
            continue
        expected = base * tax.rate / 100
        if abs(expected - tax.amount) > TOLERANCE:
            issues.append(_mismatch(IssueCode.TAX_AMOUNT_MISMATCH, f"taxes.{i}.amount",
                                    f"{tax.label or 'Tax'} at {tax.rate.normalize():f}%", expected, tax.amount))
    return issues
