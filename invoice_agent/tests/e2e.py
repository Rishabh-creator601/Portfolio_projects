"""Starts the real API and UI servers and runs the whole flow over HTTP.

    python -m tests.e2e                 # run the checks, then stop the servers
    python -m tests.e2e --serve DIR     # just start the servers, using DIR for test files and storage

Uses the stand-in extractor, so it needs no API key but does not test the LLM's reading accuracy.
Use tests/eval_extraction.py for that.
"""

import argparse
import io
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from openpyxl import load_workbook

from app.schemas import IssueCode
from tests.fixtures.generate import generate

API_PORT, UI_PORT = 8000, 8501
API_URL = f"http://127.0.0.1:{API_PORT}"
UI_URL = f"http://127.0.0.1:{UI_PORT}"
ROOT = Path(__file__).parent.parent
DUPLICATE = (IssueCode.DUPLICATE_INVOICE.value, "invoice_number")


class Servers:
    def __init__(self, base: Path):
        self.base = base
        self.env = {**os.environ, "FIXTURE_DIR": str(base / "invoices"), "STORAGE_DIR": str(base / "storage"),
                    "API_URL": API_URL, "PYTHONPATH": str(ROOT)}
        self.env.pop("OPENAI_API_KEY", None)
        self.api = self.ui = None

    def _start(self, name: str, args: list[str]) -> subprocess.Popen:
        log = open(self.base / f"{name}.log", "a", encoding="utf-8")
        return subprocess.Popen([sys.executable, "-m", *args], cwd=ROOT, env=self.env, stdout=log, stderr=subprocess.STDOUT)

    def start_api(self) -> None:
        self.api = self._start("api", ["uvicorn", "--factory", "tests.fake_server:create_app", "--port", str(API_PORT)])
        _wait_until_up(f"{API_URL}/health", self.api)

    def stop_api(self) -> None:
        self.api.terminate()
        self.api.wait(timeout=20)

    def start_ui(self) -> None:
        self.ui = self._start("ui", ["streamlit", "run", "ui/app.py", "--server.port", str(UI_PORT),
                                     "--server.headless", "true", "--browser.gatherUsageStats", "false"])
        _wait_until_up(f"{UI_URL}/_stcore/health", self.ui)

    def stop(self) -> None:
        for process in (self.ui, self.api):
            if process and process.poll() is None:
                process.terminate()
                process.wait(timeout=20)


def _wait_until_up(url: str, process: subprocess.Popen, seconds: int = 90) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"The server for {url} exited with code {process.returncode}.")
        try:
            if httpx.get(url, timeout=2).is_success:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    raise TimeoutError(f"{url} did not start within {seconds}s.")


class Report:
    def __init__(self):
        self.failures = 0
        self.passes = 0

    def check(self, condition: bool, label: str, detail="") -> bool:
        print(f"  {'PASS' if condition else 'FAIL'}  {label}" + (f"  ({detail})" if detail and not condition else ""), flush=True)
        self.passes += bool(condition)
        self.failures += not condition
        return condition


def _wait_for_all(client: httpx.Client, seconds: int = 180) -> list[dict]:
    deadline = time.time() + seconds
    while time.time() < deadline:
        invoices = client.get("/invoices").json()
        if invoices and all(i["status"] not in {"queued", "processing"} for i in invoices):
            return invoices
        time.sleep(0.5)
    raise TimeoutError("Invoices did not finish processing.")


def run_checks(servers: Servers, answers: list) -> Report:
    report = Report()
    invoices_dir = servers.base / "invoices"
    client = httpx.Client(base_url=API_URL, timeout=60)

    print("Servers")
    report.check(client.get("/health").json() == {"status": "ok"}, "API is healthy")
    page = httpx.get(UI_URL)
    report.check(page.status_code == 200 and "<title>" in page.text.lower(), "UI serves its page")

    print("Bad uploads")
    bad = client.post("/invoices", files=[("files", ("notes.txt", b"hello")), ("files", ("fake.pdf", b"not a pdf"))])
    report.check(bad.status_code == 400 and len(bad.json()["detail"]["rejected"]) == 2, "Unsupported and fake files are rejected")

    print(f"Processing {len(answers)} invoices")
    ordered = [a for a in answers if a.kind == "digital"] + [a for a in answers if a.kind == "scan"]
    upload = client.post("/invoices", files=[("files", (a.file, (invoices_dir / a.file).read_bytes())) for a in ordered])
    report.check(upload.status_code == 202 and len(upload.json()["accepted"]) == len(ordered), "All invoices are accepted")
    ids = {item["filename"]: item["id"] for item in upload.json()["accepted"]}
    _wait_for_all(client)

    planted_ok = clean_ok = 0
    planted_total = clean_total = 0
    wrong = []
    for answer in ordered:
        detail = client.get(f"/invoices/{ids[answer.file]}").json()
        found = {(i["code"], i["field"]) for i in detail["issues"]}
        expected = {(i.code.value, i.field) for i in answer.expected_issues}
        if answer.kind == "scan":
            expected.add(DUPLICATE)     # the digital original of each scan was uploaded first
        status = "needs_review" if expected else "approved"
        correct = found == expected and detail["status"] == status
        if answer.expected_issues:
            planted_total += 1
            planted_ok += correct
        else:
            clean_total += 1
            clean_ok += correct
        if not correct:
            wrong.append(f"{answer.id}: expected {sorted(expected)} [{status}], got {sorted(found)} [{detail['status']}]")
    report.check(planted_ok == planted_total, f"Invoices with planted errors flagged exactly: {planted_ok}/{planted_total}", "; ".join(wrong))
    report.check(clean_ok == clean_total, f"Clean invoices give the expected result: {clean_ok}/{clean_total}", "; ".join(wrong))

    print("Review")
    err_total = client.get(f"/invoices/{ids['err_total.pdf']}").json()
    report.check(err_total["reread_count"] == 1, "A math error triggers a second read")
    fixed_total = str(next(a for a in answers if a.id == "err_total").truth.total - 100)
    fixed = client.post(f"/invoices/{err_total['id']}/review",
                        json={"action": "correct", "invoice": {**err_total["invoice"], "total": fixed_total}}).json()
    report.check(fixed["status"] == "approved" and fixed["reviewed"] and not fixed["issues"], "A correction is rechecked and approved")

    subtotal_id = ids["err_subtotal.pdf"]
    approved = client.post(f"/invoices/{subtotal_id}/review", json={"action": "approve"}).json()
    report.check(approved["status"] == "approved" and approved["error_count"] == 1, "Approving keeps the flag on record")
    repeat = client.post(f"/invoices/{subtotal_id}/review", json={"action": "approve"})
    report.check(repeat.status_code == 409, "An invoice can't be reviewed twice")

    print("Page images")
    image = client.get(f"/invoices/{ids['clean_intrastate.pdf']}/pages/1")
    report.check(image.content.startswith(b"\x89PNG"), "A digital page renders")
    jpg = next(a.file for a in answers if a.file.endswith(".jpg"))
    report.check(client.get(f"/invoices/{ids[jpg]}/pages/1").content.startswith(b"\x89PNG"), "A photographed page renders")

    print("Excel export")
    response = client.get("/exports/invoices.xlsx")
    book = load_workbook(io.BytesIO(response.content))
    report.check(book.sheetnames == ["Invoices", "Line Items", "Issues"], "The workbook has all three sheets")
    report.check(book["Invoices"].max_row == len(ordered) + 1, f"It has one row per invoice ({len(ordered)})",
                 f"got {book['Invoices'].max_row - 1}")
    headers = [cell.value for cell in book["Invoices"][1]]
    rows = {row[headers.index("File")]: row for row in book["Invoices"].iter_rows(min_row=2, values_only=True)}
    total = rows["clean_intrastate.pdf"][headers.index("Total")]
    report.check(isinstance(total, (int, float)) and total == 37497.46, "Totals are real numbers with the right value", repr(total))

    print("Restart")
    waiting = client.get("/invoices", params={"status": "needs_review"}).json()
    invoice_id = waiting[0]["id"]
    servers.stop_api()
    servers.start_api()
    report.check(client.get(f"/invoices/{invoice_id}").json()["status"] == "needs_review", "A paused review survives a restart")
    resumed = client.post(f"/invoices/{invoice_id}/review", json={"action": "approve"}).json()
    report.check(resumed["status"] == "approved", "It can be resumed after the restart")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", type=Path, help="Start the servers using this folder and keep them running")
    args = parser.parse_args()

    base = args.serve or Path(tempfile.mkdtemp(prefix="invoice-e2e-"))
    if args.serve and (base / "storage").exists():
        shutil.rmtree(base / "storage")
    base.mkdir(parents=True, exist_ok=True)
    answers = generate(base / "invoices")
    servers = Servers(base)
    try:
        servers.start_api()
        servers.start_ui()
        if args.serve:
            print(f"API {API_URL}\nUI  {UI_URL}\nTest invoices in {base / 'invoices'}", flush=True)
            servers.ui.wait()
            return 0
        report = run_checks(servers, answers)
        print(f"\n{report.passes} passed, {report.failures} failed")
        return 1 if report.failures else 0
    finally:
        servers.stop()
        if not args.serve:
            shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
