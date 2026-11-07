"""Checks the test set itself, so later accuracy numbers can be trusted."""

from decimal import Decimal

import pymupdf
import pytest
from PIL import Image

from app.gst import has_valid_checksum
from app.schemas import IssueCode
from tests.fixtures.cases import CASES, build_case
from tests.fixtures.generate import AnswerFile, generate

ARITHMETIC_CODES = {
    IssueCode.LINE_AMOUNT_MISMATCH, IssueCode.SUBTOTAL_MISMATCH, IssueCode.TOTAL_MISMATCH,
    IssueCode.BALANCE_MISMATCH, IssueCode.TAX_AMOUNT_MISMATCH,
}
TOLERANCE = Decimal("0.01")


def arithmetic_failures(t) -> set[IssueCode]:
    """A small independent re-check of the math, separate from the code that built the invoice."""
    failures = set()
    if any(abs(l.quantity * l.unit_price - l.amount) > TOLERANCE for l in t.line_items):
        failures.add(IssueCode.LINE_AMOUNT_MISMATCH)
    if abs(sum(l.amount for l in t.line_items) - t.subtotal) > TOLERANCE:
        failures.add(IssueCode.SUBTOTAL_MISMATCH)
    for tax in t.taxes:
        if tax.taxable_amount is not None and abs(tax.taxable_amount * tax.rate / 100 - tax.amount) > TOLERANCE:
            failures.add(IssueCode.TAX_AMOUNT_MISMATCH)
    if t.total is not None:
        expected = t.subtotal - (t.discount or 0) + (t.shipping or 0) + (t.round_off or 0)
        if not t.prices_include_tax:
            expected += sum(tax.amount for tax in t.taxes)
        if abs(expected - t.total) > TOLERANCE:
            failures.add(IssueCode.TOTAL_MISMATCH)
        if t.amount_paid is not None and abs(t.total - t.amount_paid - t.balance_due) > TOLERANCE:
            failures.add(IssueCode.BALANCE_MISMATCH)
    return failures


def digital(answers):
    return [a for a in answers if a.kind == "digital"]


def test_every_invoice_has_an_answer_file(fixture_set):
    out, answers = fixture_set
    invoices = {p.name for p in out.iterdir() if p.suffix in {".pdf", ".png", ".jpg"}}
    answer_files = {p.stem for p in out.glob("*.json")}
    assert invoices == {a.file for a in answers}
    assert answer_files == {a.id for a in answers}
    for path in out.glob("*.json"):
        loaded = AnswerFile.model_validate_json(path.read_text(encoding="utf-8"))
        assert (out / loaded.file).stat().st_size > 0


def test_every_issue_a_fixture_can_plant_is_declared(fixture_set):
    planted = {i.code for a in fixture_set[1] for i in a.expected_issues}
    # Filled by extraction rather than a planted invoice, so tested in later milestones.
    not_plantable = {IssueCode.AMBIGUOUS_NUMBER, IssueCode.VALUE_NOT_IN_SOURCE, IssueCode.REREAD_CHANGED}
    assert planted == set(IssueCode) - not_plantable


def test_clean_invoices_really_add_up(fixture_set):
    clean = [a for a in fixture_set[1] if not a.expected_issues]
    assert clean
    for answer in clean:
        assert arithmetic_failures(answer.truth) == set(), answer.id


@pytest.mark.parametrize("case", [c for c in CASES if c.expected], ids=lambda c: c.id)
def test_planted_math_errors_break_exactly_what_they_declare(case):
    declared = {code for code, _ in case.expected} & ARITHMETIC_CODES
    assert arithmetic_failures(build_case(case).truth) == declared


def test_clean_gst_invoices_have_valid_gstins(fixture_set):
    for answer in fixture_set[1]:
        if answer.expected_issues or answer.truth.currency != "INR":
            continue
        assert has_valid_checksum(answer.truth.vendor_tax_id), answer.id
        assert has_valid_checksum(answer.truth.buyer_tax_id), answer.id


def _flatten(raw):
    values = [raw.vendor_name, raw.vendor_tax_id, raw.buyer_name, raw.buyer_tax_id, raw.invoice_number,
              raw.invoice_date, raw.due_date, raw.place_of_supply, raw.subtotal, raw.discount, raw.shipping,
              raw.round_off, raw.total, raw.amount_paid, raw.balance_due]
    for line in raw.line_items:
        values += [line.hsn_sac, line.quantity, line.unit_price, line.tax_rate, line.amount]
    for tax in raw.taxes:
        values += [tax.label, tax.rate, tax.taxable_amount, tax.amount]
    return [v for v in values if v]


def test_digital_pdfs_print_every_value_in_the_answer_file(fixture_set):
    out, answers = fixture_set
    for answer in digital(answers):
        with pymupdf.open(out / answer.file) as doc:
            text = " ".join(" ".join(page.get_text().split()) for page in doc)
        for value in _flatten(answer.raw):
            assert value in text, f"{answer.id}: {value!r} is not printed"


def test_long_invoice_spans_several_pages(fixture_set):
    out, _ = fixture_set
    with pymupdf.open(out / "clean_long_multi_page.pdf") as doc:
        assert doc.page_count > 1


def test_scanned_pdfs_have_no_text_layer(fixture_set):
    out, answers = fixture_set
    scans = [a for a in answers if a.kind == "scan" and a.file.endswith(".pdf")]
    assert scans
    for answer in scans:
        with pymupdf.open(out / answer.file) as doc:
            assert all(not page.get_text().strip() for page in doc), answer.id


def test_image_scans_open_and_are_large_enough_to_read(fixture_set):
    out, answers = fixture_set
    images = [a for a in answers if a.kind == "scan" and not a.file.endswith(".pdf")]
    assert {a.file.rsplit(".", 1)[1] for a in images} == {"png", "jpg"}
    for answer in images:
        with Image.open(out / answer.file) as image:
            assert image.width > 1000 and image.height > 1400, answer.id


def test_scans_cover_both_clean_and_planted_errors(fixture_set):
    scans = [a for a in fixture_set[1] if a.kind == "scan"]
    assert any(a.expected_issues for a in scans) and any(not a.expected_issues for a in scans)


def test_file_duplicate_is_a_byte_copy(fixture_set):
    out, _ = fixture_set
    assert (out / "err_duplicate_file.pdf").read_bytes() == (out / "clean_interstate.pdf").read_bytes()


def test_scans_are_reproducible(tmp_path, fixture_set):
    out, _ = fixture_set
    second = tmp_path / "again"
    generate(second)
    assert (out / "scan_photo_clean_round_off.jpg").read_bytes() == (second / "scan_photo_clean_round_off.jpg").read_bytes()
    name = "scan_light_clean_intrastate.pdf"
    with pymupdf.open(out / name) as first, pymupdf.open(second / name) as again:
        assert first[0].get_pixmap().samples == again[0].get_pixmap().samples
