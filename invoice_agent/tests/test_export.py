import io
from datetime import datetime
from decimal import Decimal

from openpyxl import load_workbook

from app.export.excel import _ERROR_FILL, _WARNING_FILL, build_workbook, safe_text
from app.extraction.normalize import normalize
from app.schemas import Issue, IssueCode, Severity
from tests.fixtures.cases import CASES, build_case


def record(case_id="clean_intrastate", issues=(), **invoice_updates):
    built = build_case(next(c for c in CASES if c.id == case_id))
    invoice, _ = normalize(built.raw)
    data = invoice.model_dump(mode="json") | invoice_updates
    return {"id": "abc123", "filename": f"{case_id}.pdf", "status": "approved", "reviewed": False,
            "data": {"invoice": data, "issues": [i.model_dump(mode="json") for i in issues]}}


def load(records):
    return load_workbook(io.BytesIO(build_workbook(records)))


def by_header(sheet, row=2):
    return {sheet.cell(1, c).value: sheet.cell(row, c) for c in range(1, sheet.max_column + 1)}


def test_numbers_and_dates_are_real_cells():
    cells = by_header(load([record()])["Invoices"])
    assert cells["Total"].value == 37497.46 and cells["Total"].number_format == "#,##0.00"
    assert isinstance(cells["Invoice Date"].value, datetime)
    assert cells["CGST"].value == 2859.98 and cells["SGST"].value == 2859.98
    assert cells["IGST"].value is None


def test_line_items_match_the_invoice():
    sheet = load([record()])["Line Items"]
    assert sheet.max_row == 4
    cells = by_header(sheet)
    assert cells["Description"].value == "Stainless steel storage rack"
    assert cells["Qty"].value == 4 and cells["Amount"].value == 13000


def test_flags_are_listed_and_cells_highlighted():
    issues = [
        Issue(code=IssueCode.TOTAL_MISMATCH, severity=Severity.ERROR, message="bad total", field="total"),
        Issue(code=IssueCode.NEGATIVE_AMOUNT, severity=Severity.WARNING, message="negative", field="line_items.1.amount"),
    ]
    book = load([record(issues=issues)])
    cells = by_header(book["Invoices"])
    assert cells["Total"].fill.fgColor.rgb.endswith(_ERROR_FILL.fgColor.rgb[-6:])
    assert cells["Errors"].value == 1 and cells["Warnings"].value == 1
    assert by_header(book["Line Items"], row=3)["Amount"].fill.fgColor.rgb.endswith(_WARNING_FILL.fgColor.rgb[-6:])
    assert book["Issues"].max_row == 3
    assert by_header(book["Issues"])["Code"].value == "total_mismatch"


def test_formula_text_from_an_invoice_cannot_run():
    malicious = '=HYPERLINK("http://evil.example","click")'
    book = load([record(vendor_name=malicious, invoice_number="+1+1", buyer_name="@SUM(A1)")])
    cells = by_header(book["Invoices"])
    for name in ["Vendor", "Invoice No", "Buyer"]:
        assert cells[name].data_type == "s" and cells[name].value.startswith("'"), name


def test_safe_text_leaves_normal_values_alone():
    assert safe_text("Indigo Peak Traders") == "Indigo Peak Traders"
    assert safe_text(None) is None
    assert safe_text(Decimal("-5")) == Decimal("-5")


def test_several_invoices_get_their_own_rows():
    book = load([record("clean_intrastate"), record("clean_multi_rate")])
    assert book["Invoices"].max_row == 3
    assert book["Line Items"].max_row == 1 + 3 + 4
