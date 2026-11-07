"""Measures real LLM reading accuracy on the test invoices. Needs OPENAI_API_KEY and costs money.

    python -m tests.eval_extraction                 # scans only
    python -m tests.eval_extraction --all           # every invoice
"""

import argparse
import sys
import tempfile
from datetime import date
from pathlib import Path

from app.config import Settings
from app.extraction.llm import ExtractionError, OpenAIExtractor
from app.extraction.normalize import normalize
from app.extraction.pages import read_pages
from app.graph.builder import diff_invoices
from app.validation import validate
from tests.fixtures.generate import generate


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="Include digital PDFs as well as scans")
    args = parser.parse_args()

    settings = Settings()
    extractor = OpenAIExtractor(settings.chat_model)
    with tempfile.TemporaryDirectory() as folder:
        out = Path(folder)
        answers = [a for a in generate(out) if args.all or a.kind == "scan"]

        exact = caught = planted = false_flags = clean = 0
        for answer in answers:
            path = out / answer.file
            try:
                raw = extractor.extract(path, read_pages(path), dpi=settings.extract_dpi)
            except ExtractionError as error:
                print(error)
                return 1
            invoice, parse_issues = normalize(raw)
            differences = diff_invoices(answer.truth, invoice)
            exact += not differences

            flags = {i.code for i in parse_issues + validate(invoice, date.today())}
            expected = {i.code for i in answer.expected_issues}
            # The duplicate check needs stored invoices, so it can't fire here.
            expected = {code for code in expected if code.value != "duplicate_invoice"}
            if expected:
                planted += 1
                caught += expected <= flags
            else:
                clean += 1
                false_flags += bool(flags)

            verdict = "exact" if not differences else f"{len(differences)} difference(s)"
            print(f"{answer.id}: {verdict}; flags {sorted(c.value for c in flags)}", flush=True)
            for difference in differences[:5]:
                print(f"    {difference}")

    print(f"\nModel: {settings.chat_model}")
    print(f"Invoices read exactly: {exact}/{len(answers)}")
    print(f"Planted errors still caught after reading: {caught}/{planted}")
    print(f"Clean invoices wrongly flagged: {false_flags}/{clean}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
