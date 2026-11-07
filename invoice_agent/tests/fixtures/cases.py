"""Test invoices and the errors planted in them.

Each Case describes an invoice in plain numbers. build_case() does the math the
way a correct invoicing system would, then applies the planted error, and returns
both the as-printed values and the parsed truth.

An error is planted so that it is the only thing wrong: for example, a wrong
subtotal still flows into the tax and total below it, so only the subtotal check
should fire. expected_issues lists exactly what the validator must report.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.gst import checksum
from app.schemas import Invoice, IssueCode, LineItem, RawInvoice, RawLineItem, RawTaxLine, TaxLine

CENT = Decimal("0.01")


def money(value) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def make_gstin(state: str, pan: str) -> str:
    first_14 = f"{state}{pan}1Z"
    return first_14 + checksum(first_14)


# All companies and tax IDs below are made up.
KA = make_gstin("29", "AABCI1234F")   # Karnataka
KA_BUYER = make_gstin("29", "AAFCN5678K")
MH = make_gstin("27", "AADCL4321P")   # Maharashtra
BAD_CHECKSUM = KA[:14] + ("A" if KA[14] != "A" else "B")

VENDOR_IN = "Indigo Peak Traders Pvt Ltd"
BUYER_IN = "Northwind Lane Retail LLP"
VENDOR_EU = "Halvorsen Nordlicht GmbH"
BUYER_EU = "Atelier Verrano SARL"
VENDOR_US = "Cedar Hollow Supply Co."
BUYER_US = "Blue Finch Studios Inc."

STATES = {"29": "Karnataka", "27": "Maharashtra"}

ITEMS = [
    ("Stainless steel storage rack", "9403", "4", "3250.00"),
    ("LED panel light 18W", "9405", "25", "480.50"),
    ("Corrugated packing boxes (bundle)", "4819", "60", "112.75"),
    ("Annual equipment servicing", "9987", "1", "18500.00"),
    ("Ergonomic office chair", "9401", "8", "6799.00"),
    ("Network cabling, Cat6 (per metre)", "8544", "150", "42.30"),
]


@dataclass
class Case:
    id: str
    items: list = field(default_factory=lambda: ITEMS[:3])
    rates: list = field(default_factory=lambda: ["18"])     # one rate per item, cycled
    tax_kind: str = "cgst_sgst"                             # cgst_sgst | igst | vat
    number_format: str = "in"                               # in | us | eu
    date_format: str = "%d/%m/%Y"
    layout: str = "classic"                                 # classic | band | minimal
    currency: str = "INR"
    vendor: str = VENDOR_IN
    vendor_id: str | None = KA
    buyer: str = BUYER_IN
    buyer_id: str | None = KA_BUYER
    supply_state: str | None = "29"
    invoice_number: str | None = "INV-2026-0001"
    invoice_date: date | None = date(2026, 3, 14)
    due_days: int | None = 30
    discount: str | None = None
    shipping: str | None = None
    paid: str | None = None
    round_total: bool = False
    tax_inclusive: bool = False
    show_tax_base: bool = True
    omit_total: bool = False
    # planted errors
    line_delta: Decimal | None = None       # added to the first line's printed amount
    negate_first_line: bool = False
    subtotal_delta: Decimal | None = None
    tax_delta: Decimal | None = None        # added to the first tax line's printed amount
    total_delta: Decimal | None = None
    balance_delta: Decimal | None = None
    # (code, field) pairs the validator must report
    expected: list = field(default_factory=list)
    duplicate_of: str | None = None
    note: str = ""


def group(n: str) -> str:
    """Add Indian digit grouping to a whole-number string: 1234567 -> 12,34,567."""
    if len(n) <= 3:
        return n
    head, tail = n[:-3], n[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    parts.insert(0, head)
    return ",".join(parts) + "," + tail


def fmt(value: Decimal, style: str) -> str:
    sign = "-" if value < 0 else ""
    whole, frac = f"{abs(value):.2f}".split(".")
    if style == "in":
        return f"{sign}{group(whole)}.{frac}"
    if style == "eu":
        return f"{sign}{int(whole):,}".replace(",", ".") + f",{frac}"
    return f"{sign}{int(whole):,}.{frac}"


def fmt_qty(value: Decimal) -> str:
    return str(value.normalize().quantize(Decimal(1)) if value == value.to_integral() else value)


@dataclass
class BuiltCase:
    case: Case
    raw: RawInvoice
    truth: Invoice


def build_case(case: Case) -> BuiltCase:
    style = case.number_format
    p = lambda v: fmt(v, style) if v is not None else None

    raw_lines, lines = [], []
    for i, (desc, code, qty, price) in enumerate(case.items):
        qty_d, price_d = Decimal(qty), Decimal(price)
        rate = Decimal(case.rates[i % len(case.rates)])
        amount = money(qty_d * price_d)
        if i == 0:
            if case.negate_first_line:
                price_d, amount = -price_d, -amount
            if case.line_delta is not None:
                amount += case.line_delta
        lines.append(LineItem(description=desc, hsn_sac=code, quantity=qty_d, unit_price=price_d,
                              tax_rate=rate, amount=amount))
        raw_lines.append(RawLineItem(description=desc, hsn_sac=code, quantity=fmt_qty(qty_d),
                                     unit_price=p(price_d), tax_rate=f"{rate}%", amount=p(amount)))

    subtotal = sum((l.amount for l in lines), Decimal(0))
    if case.subtotal_delta is not None:
        subtotal += case.subtotal_delta

    discount = money(case.discount) if case.discount else None
    shipping = money(case.shipping) if case.shipping else None

    # Group taxable value per rate. A discount is only used with a single rate.
    base_by_rate: dict[Decimal, Decimal] = {}
    for line in lines:
        base_by_rate[line.tax_rate] = base_by_rate.get(line.tax_rate, Decimal(0)) + line.amount
    if case.subtotal_delta is not None or discount:
        assert len(base_by_rate) == 1, "subtotal changes need a single tax rate"
        rate = next(iter(base_by_rate))
        base_by_rate[rate] = subtotal - (discount or 0)

    taxes: list[TaxLine] = []
    for rate, base in base_by_rate.items():
        if case.tax_inclusive:
            taxable = money(base * 100 / (100 + rate))
        else:
            taxable = money(base)
        tax = taxable * rate / 100
        if case.tax_kind == "cgst_sgst":
            half_rate = rate / 2
            half = money(tax / 2)
            taxes.append(TaxLine(label="CGST", rate=half_rate, taxable_amount=taxable, amount=half))
            taxes.append(TaxLine(label="SGST", rate=half_rate, taxable_amount=taxable, amount=half))
        else:
            label = "IGST" if case.tax_kind == "igst" else "VAT"
            taxes.append(TaxLine(label=label, rate=rate, taxable_amount=taxable, amount=money(tax)))

    if case.tax_delta is not None:
        taxes[0].amount += case.tax_delta

    tax_total = sum((t.amount for t in taxes), Decimal(0))
    total = subtotal - (discount or 0) + (shipping or 0)
    if not case.tax_inclusive:
        total += tax_total

    round_off = None
    if case.round_total:
        rounded = total.quantize(Decimal(1), rounding=ROUND_HALF_UP)
        round_off = rounded - total
        total = money(rounded)
    if case.total_delta is not None:
        total += case.total_delta

    paid = money(case.paid) if case.paid else None
    balance = None
    if paid is not None:
        balance = total - paid
        if case.balance_delta is not None:
            balance += case.balance_delta

    due = case.invoice_date + timedelta(days=case.due_days) if case.invoice_date and case.due_days is not None else None
    if case.omit_total:
        total = None

    supply = f"{STATES[case.supply_state]} ({case.supply_state})" if case.supply_state else None
    fmt_date = lambda d: d.strftime(case.date_format) if d else None

    raw = RawInvoice(
        vendor_name=case.vendor, vendor_tax_id=case.vendor_id, buyer_name=case.buyer, buyer_tax_id=case.buyer_id,
        invoice_number=case.invoice_number, invoice_date=fmt_date(case.invoice_date), due_date=fmt_date(due),
        place_of_supply=supply, currency=case.currency, prices_include_tax=case.tax_inclusive,
        line_items=raw_lines, subtotal=p(subtotal), discount=p(discount), shipping=p(shipping),
        taxes=[RawTaxLine(label=t.label, rate=f"{t.rate.normalize():f}%",
                          taxable_amount=p(t.taxable_amount) if case.show_tax_base else None,
                          amount=p(t.amount)) for t in taxes],
        round_off=p(round_off), total=p(total), amount_paid=p(paid), balance_due=p(balance),
    )
    truth = Invoice(
        vendor_name=case.vendor, vendor_tax_id=case.vendor_id, buyer_name=case.buyer, buyer_tax_id=case.buyer_id,
        invoice_number=case.invoice_number, invoice_date=case.invoice_date, due_date=due,
        place_of_supply_code=case.supply_state, currency=case.currency, prices_include_tax=case.tax_inclusive,
        line_items=lines, subtotal=subtotal, discount=discount, shipping=shipping,
        taxes=[t.model_copy(update={"taxable_amount": t.taxable_amount if case.show_tax_base else None}) for t in taxes],
        round_off=round_off, total=total, amount_paid=paid, balance_due=balance,
    )
    return BuiltCase(case, raw, truth)


D = Decimal
INTER = dict(tax_kind="igst", vendor_id=MH, supply_state="29")   # Maharashtra seller, Karnataka supply
EU = dict(tax_kind="vat", number_format="eu", currency="EUR", vendor=VENDOR_EU, buyer=BUYER_EU,
          vendor_id="DE811569869", buyer_id="FR40303265045", supply_state=None, rates=["19"],
          date_format="%d.%m.%Y", layout="minimal")
US = dict(tax_kind="vat", number_format="us", currency="USD", vendor=VENDOR_US, buyer=BUYER_US,
          vendor_id=None, buyer_id=None, supply_state=None, rates=["8"], date_format="%b %d, %Y", layout="band")

CASES = [
    # ----- clean: must produce no flags at all -----
    Case("clean_intrastate", invoice_number="INV-2026-0101"),
    Case("clean_interstate", invoice_number="INV-2026-0102", layout="band", **INTER),
    Case("clean_multi_rate", invoice_number="INV-2026-0103", items=ITEMS[:4], rates=["18", "12", "5", "18"],
         layout="minimal", date_format="%d-%b-%Y"),
    Case("clean_discount_shipping", invoice_number="INV-2026-0104", discount="1500.00", shipping="850.00"),
    Case("clean_round_off", invoice_number="INV-2026-0105", round_total=True, layout="band",
         note="Indian invoices commonly round the total to a whole rupee."),
    Case("clean_lakh_amounts", invoice_number="INV-2026-0106", items=[ITEMS[3], ITEMS[4], ("Server rack, 42U", "8471", "6", "187500.00")],
         note="Large amounts in lakh grouping, such as 11,25,000.00."),
    Case("clean_tax_inclusive", invoice_number="INV-2026-0107", tax_inclusive=True, items=ITEMS[1:3], rates=["12"],
         layout="minimal", note="Prices include GST, so tax must not be added on top."),
    Case("clean_partial_payment", invoice_number="INV-2026-0108", paid="10000.00"),
    Case("clean_no_tax_base", invoice_number="INV-2026-0109", show_tax_base=False, layout="minimal",
         note="Tax lines do not print the taxable amount, which is common."),
    Case("clean_long_multi_page", invoice_number="INV-2026-0110",
         items=[(f"{d}, batch {b}", c, q, pr) for b in range(1, 9) for d, c, q, pr in ITEMS], note="Spans several pages."),
    Case("clean_eu_vat", invoice_number="RE-2026-4471", **EU, note="European number format: 1.234,56."),
    Case("clean_us_sales_tax", invoice_number="US-88213", **US),

    # ----- arithmetic -----
    Case("err_line_amount", invoice_number="INV-2026-0201", line_delta=D("500.00"),
         expected=[(IssueCode.LINE_AMOUNT_MISMATCH, "line_items.0.amount")]),
    Case("err_subtotal", invoice_number="INV-2026-0202", layout="band", subtotal_delta=D("1000.00"),
         expected=[(IssueCode.SUBTOTAL_MISMATCH, "subtotal")]),
    Case("err_total", invoice_number="INV-2026-0203", total_delta=D("100.00"),
         expected=[(IssueCode.TOTAL_MISMATCH, "total")]),
    Case("err_total_small", invoice_number="INV-2026-0204", total_delta=D("0.50"), layout="minimal",
         expected=[(IssueCode.TOTAL_MISMATCH, "total")], note="Small enough to tempt a loose tolerance."),
    Case("err_balance", invoice_number="INV-2026-0205", paid="10000.00", balance_delta=D("-250.00"),
         expected=[(IssueCode.BALANCE_MISMATCH, "balance_due")]),
    Case("err_tax_amount", invoice_number="INV-2026-0206", tax_delta=D("75.00"), **INTER,
         expected=[(IssueCode.TAX_AMOUNT_MISMATCH, "taxes.0.amount")]),

    # ----- GST -----
    Case("err_gstin_checksum", invoice_number="INV-2026-0301", vendor_id=BAD_CHECKSUM,
         expected=[(IssueCode.GSTIN_INVALID_CHECKSUM, "vendor_tax_id")]),
    Case("err_gstin_format", invoice_number="INV-2026-0302", buyer_id="29AAFCN5678", layout="band",
         expected=[(IssueCode.GSTIN_INVALID_FORMAT, "buyer_tax_id")]),
    Case("err_gst_cgst_on_interstate", invoice_number="INV-2026-0303", vendor_id=MH,
         expected=[(IssueCode.GST_TYPE_MISMATCH, "taxes")], note="Inter-state supply wrongly charged CGST + SGST."),
    Case("err_gst_igst_on_intrastate", invoice_number="INV-2026-0304", tax_kind="igst",
         expected=[(IssueCode.GST_TYPE_MISMATCH, "taxes")], note="Same-state supply wrongly charged IGST."),
    Case("err_cgst_sgst_unequal", invoice_number="INV-2026-0305", tax_delta=D("120.00"),
         expected=[(IssueCode.CGST_SGST_UNEQUAL, "taxes"), (IssueCode.TAX_AMOUNT_MISMATCH, "taxes.0.amount")],
         note="Raising only CGST breaks both its own math and the equal-split rule."),

    # ----- required fields -----
    Case("err_missing_invoice_number", invoice_number=None,
         expected=[(IssueCode.MISSING_FIELD, "invoice_number")]),
    Case("err_missing_total", invoice_number="INV-2026-0402", omit_total=True, layout="minimal",
         expected=[(IssueCode.MISSING_FIELD, "total")]),

    # ----- logic -----
    Case("err_future_date", invoice_number="INV-2026-0501", invoice_date=date(2099, 1, 15),
         expected=[(IssueCode.FUTURE_INVOICE_DATE, "invoice_date")]),
    Case("err_due_before_invoice", invoice_number="INV-2026-0502", due_days=-10, layout="band",
         expected=[(IssueCode.DUE_BEFORE_INVOICE, "due_date")]),
    Case("err_negative_amount", invoice_number="INV-2026-0503", negate_first_line=True,
         items=[ITEMS[0], ITEMS[3], ITEMS[4]],
         expected=[(IssueCode.NEGATIVE_AMOUNT, "line_items.0.amount")]),

    # ----- duplicates: different file, same vendor and invoice number -----
    Case("err_duplicate_number", invoice_number="INV-2026-0101", items=ITEMS[3:5], layout="band",
         duplicate_of="clean_intrastate", expected=[(IssueCode.DUPLICATE_INVOICE, "invoice_number")]),
]

# Byte-for-byte copies: (new id, id of the case it copies)
DUPLICATE_FILES = [("err_duplicate_file", "clean_interstate")]

# Scanned copies: planted errors must survive being read from an image.
# (case id, scan profile, output format)
SCANS = [
    ("clean_intrastate", "light", "pdf"),
    ("clean_interstate", "heavy", "pdf"),
    ("clean_multi_rate", "light", "png"),
    ("clean_round_off", "photo", "jpg"),
    ("clean_lakh_amounts", "heavy", "pdf"),
    ("clean_eu_vat", "light", "pdf"),
    ("err_line_amount", "light", "pdf"),
    ("err_subtotal", "heavy", "pdf"),
    ("err_total", "light", "png"),
    ("err_total_small", "heavy", "pdf"),
    ("err_tax_amount", "photo", "jpg"),
    ("err_gst_cgst_on_interstate", "light", "pdf"),
    ("err_gstin_checksum", "heavy", "pdf"),
]
