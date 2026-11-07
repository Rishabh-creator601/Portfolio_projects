"""The validator must raise exactly the planted flags: nothing missed and nothing extra."""

from datetime import date
from decimal import Decimal

import pytest

from app.extraction.normalize import detect_decimal_separator, normalize, parse_date, parse_number, parse_supply_code
from app.extraction.pages import read_pages
from app.schemas import IssueCode, RawInvoice, RawLineItem
from app.validation import check_source, validate
from tests.fixtures.cases import CASES, build_case

TODAY = date(2026, 11, 7)
STORED_ONLY = {IssueCode.DUPLICATE_INVOICE}   # needs earlier invoices, so tested through the graph


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_normalize_recovers_the_truth_from_printed_values(case):
    built = build_case(case)
    invoice, issues = normalize(built.raw)
    assert issues == []
    assert invoice == built.truth


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_validator_raises_exactly_the_planted_flags(case):
    built = build_case(case)
    invoice, _ = normalize(built.raw)
    found = {(issue.code, issue.field) for issue in validate(invoice, TODAY)}
    expected = {(code, field) for code, field in case.expected if code not in STORED_ONLY}
    assert found == expected


def test_digital_pdfs_pass_the_source_check(fixture_set):
    out, answers = fixture_set
    for answer in answers:
        if answer.kind == "digital":
            assert check_source(answer.raw, read_pages(out / answer.file)) == [], answer.id


def test_source_check_catches_an_invented_total(fixture_set):
    out, answers = fixture_set
    answer = next(a for a in answers if a.id == "clean_intrastate")
    invented = answer.raw.model_copy(update={"total": "99,999.99"})
    issues = check_source(invented, read_pages(out / answer.file))
    assert [(i.code, i.field) for i in issues] == [(IssueCode.VALUE_NOT_IN_SOURCE, "total")]


def test_source_check_is_skipped_for_scans(fixture_set):
    out, answers = fixture_set
    answer = next(a for a in answers if a.id == "scan_light_clean_intrastate")
    invented = answer.raw.model_copy(update={"total": "99,999.99"})
    assert check_source(invented, read_pages(out / answer.file)) == []


@pytest.mark.parametrize("text, separator, value, trustworthy", [
    ("1,234.56", None, "1234.56", True),
    ("1.234,56", None, "1234.56", True),
    ("1,00,000.00", None, "100000.00", True),
    ("1,00,000", None, "100000", True),
    ("1.234.567", None, "1234567", True),
    ("12,50", None, "12.50", True),
    ("1,234", None, "1234", True),
    ("1.234", None, "1.234", False),
    ("1.234", ",", "1234", True),
    ("1.234", ".", "1.234", True),
    ("1,234", ",", "1.234", True),
    ("Rs. 1,500.00", None, "1500.00", True),
    ("₹1,500.00", None, "1500.00", True),
    ("INR 1,500.00", None, "1500.00", True),
    ("$ 99.50", None, "99.50", True),
    ("(500.00)", None, "-500.00", True),
    ("500.00-", None, "-500.00", True),
    ("-0.46", None, "-0.46", True),
    ("18%", None, "18", True),
    ("2.5 %", None, "2.5", True),
])
def test_parse_number(text, separator, value, trustworthy):
    assert parse_number(text, separator) == (Decimal(value), trustworthy)


@pytest.mark.parametrize("text", ["N/A", "abc", "12x"])
def test_unreadable_numbers_are_reported_not_guessed(text):
    assert parse_number(text) == (None, False)


def test_blank_number_is_not_an_error():
    assert parse_number(None) == (None, True)
    assert parse_number("  ") == (None, True)


def test_ambiguous_amount_becomes_a_warning():
    raw = RawInvoice(line_items=[RawLineItem(quantity="1", unit_price="1.234", amount="1.234")], total="1.234")
    _, issues = normalize(raw)
    assert {i.code for i in issues} == {IssueCode.AMBIGUOUS_NUMBER}
    assert {i.field for i in issues} == {"line_items.0.unit_price", "line_items.0.amount", "total"}


def test_decimal_separator_uses_the_majority():
    assert detect_decimal_separator(["1.234,56", "12,50", "9.99"]) == ","
    assert detect_decimal_separator(["1,234.56", "12.50"]) == "."
    assert detect_decimal_separator(["100", "200"]) is None


@pytest.mark.parametrize("text, currency, expected", [
    ("14/03/2026", "INR", date(2026, 3, 14)),
    ("03/04/2026", "INR", date(2026, 4, 3)),
    ("03/04/2026", "USD", date(2026, 3, 4)),
    ("14.03.2026", "EUR", date(2026, 3, 14)),
    ("14-Mar-2026", "INR", date(2026, 3, 14)),
    ("Mar 14, 2026", "USD", date(2026, 3, 14)),
    ("2026-03-14", None, date(2026, 3, 14)),
])
def test_parse_date(text, currency, expected):
    assert parse_date(text, currency) == (expected, True)


def test_unreadable_date_is_reported():
    assert parse_date("soon") == (None, False)


@pytest.mark.parametrize("text, code", [
    ("Karnataka (29)", "29"), ("29-Karnataka", "29"), ("Maharashtra", "27"), ("tamil  nadu", "33"),
    ("Atlantis", None), (None, None),
])
def test_place_of_supply(text, code):
    assert parse_supply_code(text) == code
