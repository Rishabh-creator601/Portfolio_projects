"""Workflow behaviour: routing, the reread step, pause and resume, and restarts."""

from datetime import date
from pathlib import Path

import pytest

from app.config import Settings
from app.extraction.llm import ExtractionError, OpenAIExtractor
from app.graph.builder import diff_invoices
from app.schemas import Invoice, IssueCode
from app.service import InvoiceService, ReviewConflict
from tests.fake_extractor import FakeExtractor

TODAY = lambda: date(2026, 11, 7)


@pytest.fixture
def setup(fixture_set, tmp_path):
    out, answers = fixture_set
    extractor = FakeExtractor(out)
    settings = Settings(storage_dir=tmp_path / "storage")
    service = InvoiceService(settings, extractor, TODAY)
    yield service, extractor, out, {a.id: a for a in answers}, settings
    service.close()


def run(service, out: Path, answers, case_id):
    name = answers[case_id].file
    record = service.add_file(name, (out / name).read_bytes())
    service.process(record["id"])
    return service.store.get(record["id"])


def codes(record):
    return {i["code"] for i in record["data"]["issues"]}


def test_clean_invoice_is_approved_without_a_second_read(setup):
    service, extractor, out, answers, _ = setup
    record = run(service, out, answers, "clean_intrastate")
    assert record["status"] == "approved" and not record["reviewed"]
    assert record["data"]["issues"] == []
    assert len(extractor.calls) == 1


def test_math_error_gets_reread_as_images_then_goes_to_review(setup):
    service, extractor, out, answers, settings = setup
    record = run(service, out, answers, "err_total")
    assert record["status"] == "needs_review"
    assert codes(record) == {IssueCode.TOTAL_MISMATCH.value}
    assert record["data"]["reread_count"] == 1 and record["data"]["reread_changes"] == []
    assert len(extractor.calls) == 2
    assert extractor.calls[1]["force_images"] and extractor.calls[1]["dpi"] == settings.reread_dpi


def test_non_math_flag_goes_straight_to_review(setup):
    service, extractor, out, answers, _ = setup
    record = run(service, out, answers, "err_gstin_checksum")
    assert record["status"] == "needs_review"
    assert len(extractor.calls) == 1


def test_second_read_that_disagrees_always_goes_to_a_person(setup):
    """Even when the second read makes the math pass, a person must compare it with the document."""
    service, extractor, out, answers, _ = setup
    extractor.second_read = answers["clean_intrastate"].raw.model_copy(update={"invoice_number": "INV-2026-0203"})
    record = run(service, out, answers, "err_total")
    assert record["status"] == "needs_review"
    # The second read's total isn't printed in this PDF, so the source check fires as well.
    assert codes(record) == {IssueCode.REREAD_CHANGED.value, IssueCode.VALUE_NOT_IN_SOURCE.value}
    changed = next(i for i in record["data"]["issues"] if i["code"] == IssueCode.REREAD_CHANGED.value)
    assert "total: 37597.46 -> 37497.46" in changed["found"]


def test_correction_rechecks_and_approves(setup):
    service, _, out, answers, _ = setup
    record = run(service, out, answers, "err_total")
    corrected = dict(record["data"]["invoice"], total="37497.46")
    result = service.review(record["id"], {"action": "correct", "invoice": corrected})
    assert result["status"] == "approved" and result["reviewed"]
    assert result["data"]["issues"] == []


def test_bad_correction_returns_to_review_and_can_then_be_approved(setup):
    service, _, out, answers, _ = setup
    record = run(service, out, answers, "err_total")
    wrong = dict(record["data"]["invoice"], total="1.00")
    result = service.review(record["id"], {"action": "correct", "invoice": wrong})
    assert result["status"] == "needs_review" and codes(result) == {IssueCode.TOTAL_MISMATCH.value}

    result = service.review(record["id"], {"action": "approve"})
    assert result["status"] == "approved" and result["reviewed"]
    assert codes(result) == {IssueCode.TOTAL_MISMATCH.value}, "approving keeps the flag on record"


def test_cannot_review_an_invoice_that_is_not_waiting(setup):
    service, _, out, answers, _ = setup
    record = run(service, out, answers, "clean_intrastate")
    with pytest.raises(ReviewConflict):
        service.review(record["id"], {"action": "approve"})


def test_paused_review_survives_a_restart(fixture_set, tmp_path):
    out, answers = fixture_set
    answers = {a.id: a for a in answers}
    settings = Settings(storage_dir=tmp_path / "storage")
    first = InvoiceService(settings, FakeExtractor(out), TODAY)
    record = run(first, out, answers, "err_total")
    first.close()

    second = InvoiceService(settings, FakeExtractor(out), TODAY)
    try:
        assert second.store.get(record["id"])["status"] == "needs_review"
        corrected = dict(record["data"]["invoice"], total="37497.46")
        assert second.review(record["id"], {"action": "correct", "invoice": corrected})["status"] == "approved"
    finally:
        second.close()


def test_restart_marks_unfinished_uploads_as_failed(fixture_set, tmp_path):
    out, answers = fixture_set
    answer = next(a for a in answers if a.id == "clean_intrastate")
    settings = Settings(storage_dir=tmp_path / "storage")
    first = InvoiceService(settings, FakeExtractor(out), TODAY)
    record = first.add_file(answer.file, (out / answer.file).read_bytes())
    first.close()

    second = InvoiceService(settings, FakeExtractor(out), TODAY)
    try:
        stored = second.store.get(record["id"])
        assert stored["status"] == "failed" and "restarted" in stored["error"]
    finally:
        second.close()


def test_duplicates_flag_the_later_invoice_only(setup):
    service, _, out, answers, _ = setup
    assert run(service, out, answers, "clean_intrastate")["status"] == "approved"
    later = run(service, out, answers, "err_duplicate_number")
    assert codes(later) == {IssueCode.DUPLICATE_INVOICE.value}


def test_byte_copy_is_flagged_as_a_duplicate(setup):
    service, _, out, answers, _ = setup
    assert run(service, out, answers, "clean_interstate")["status"] == "approved"
    assert codes(run(service, out, answers, "err_duplicate_file")) == {IssueCode.DUPLICATE_INVOICE.value}


def test_extraction_failure_shows_a_clear_message(setup):
    service, extractor, out, answers, _ = setup
    extractor.error = ExtractionError("OPENAI_API_KEY is not set, so the invoice could not be read.")
    record = run(service, out, answers, "clean_intrastate")
    assert record["status"] == "failed" and "OPENAI_API_KEY" in record["error"]


def test_unexpected_failure_hides_internal_details(setup):
    service, extractor, out, answers, _ = setup
    extractor.error = RuntimeError("secret internal path C:/x")
    record = run(service, out, answers, "clean_intrastate")
    assert record["status"] == "failed" and "secret" not in record["error"]


def test_real_extractor_needs_a_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ExtractionError, match="OPENAI_API_KEY"):
        OpenAIExtractor("any-model").extract(Path("x.pdf"), [])


def test_diff_ignores_free_text_but_catches_numbers():
    a = Invoice(vendor_name="A", total="10.00")
    assert diff_invoices(a, Invoice(vendor_name="a ltd", total="10.0")) == []
    assert diff_invoices(a, Invoice(vendor_name="A", total="11.00")) == ["total: 10.00 -> 11.00"]
