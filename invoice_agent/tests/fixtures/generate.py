"""Builds the test invoice set and one answer file per invoice.

    python -m tests.fixtures.generate            # writes to tests/fixtures/generated
    python -m tests.fixtures.generate --out DIR
"""

import argparse
import shutil
import zlib
from pathlib import Path

from pydantic import BaseModel

from app.schemas import Invoice, IssueCode, RawInvoice

from .cases import CASES, DUPLICATE_FILES, SCANS, build_case
from .degrade import degrade
from .render import render_pdf

DEFAULT_OUT = Path(__file__).parent / "generated"


class ExpectedIssue(BaseModel):
    code: IssueCode
    field: str | None = None


class AnswerFile(BaseModel):
    id: str
    file: str
    kind: str                       # digital | scan
    source_case: str
    scan_profile: str | None = None
    duplicate_of: str | None = None
    note: str = ""
    expected_issues: list[ExpectedIssue]
    raw: RawInvoice                 # exactly as printed
    truth: Invoice                  # parsed values


def _write_answer(out: Path, answer: AnswerFile) -> None:
    (out / f"{answer.id}.json").write_text(answer.model_dump_json(indent=2), encoding="utf-8")


def generate(out: Path = DEFAULT_OUT) -> list[AnswerFile]:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    built = {case.id: build_case(case) for case in CASES}
    answers = []

    def answer_for(built_case, answer_id, file_name, kind, profile=None, duplicate_of=None):
        case = built_case.case
        return AnswerFile(
            id=answer_id, file=file_name, kind=kind, source_case=case.id, scan_profile=profile,
            duplicate_of=duplicate_of or case.duplicate_of, note=case.note,
            expected_issues=[ExpectedIssue(code=c, field=f) for c, f in case.expected],
            raw=built_case.raw, truth=built_case.truth,
        )

    for case_id, item in built.items():
        file_name = f"{case_id}.pdf"
        render_pdf(item, out / file_name)
        answers.append(answer_for(item, case_id, file_name, "digital"))

    for new_id, source_id in DUPLICATE_FILES:
        file_name = f"{new_id}.pdf"
        shutil.copyfile(out / f"{source_id}.pdf", out / file_name)
        answer = answer_for(built[source_id], new_id, file_name, "digital", duplicate_of=source_id)
        answer.expected_issues = [ExpectedIssue(code=IssueCode.DUPLICATE_INVOICE, field="invoice_number")]
        answer.note = "Byte-for-byte copy of another file."
        answers.append(answer)

    for case_id, profile, output_format in SCANS:
        scan_id = f"scan_{profile}_{case_id}"
        file_name = f"{scan_id}.{output_format}"
        seed = zlib.crc32(scan_id.encode())     # stable between runs, unlike hash()
        degrade(out / f"{case_id}.pdf", out / file_name, profile, output_format, seed)
        answers.append(answer_for(built[case_id], scan_id, file_name, "scan", profile=profile))

    for answer in answers:
        _write_answer(out, answer)
    return answers


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    answers = generate(args.out)
    digital = sum(a.kind == "digital" for a in answers)
    flagged = sum(bool(a.expected_issues) for a in answers)
    print(f"{len(answers)} invoices in {args.out}: {digital} digital, {len(answers) - digital} scans, "
          f"{flagged} with planted errors, {len(answers) - flagged} clean")


if __name__ == "__main__":
    main()
