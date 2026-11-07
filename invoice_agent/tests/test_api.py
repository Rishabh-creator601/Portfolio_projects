import io
import time

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.api.main import create_app
from app.config import Settings
from tests.fake_extractor import FakeExtractor


@pytest.fixture
def client(fixture_set, tmp_path):
    out, _ = fixture_set
    app = create_app(Settings(storage_dir=tmp_path / "storage"), FakeExtractor(out))
    with TestClient(app) as test_client:
        yield test_client


def upload(client, out, *names):
    files = [("files", (name, (out / name).read_bytes())) for name in names]
    response = client.post("/invoices", files=files)
    assert response.status_code == 202
    return response.json()["accepted"]


def wait_for(client, invoice_id):
    deadline = time.time() + 20
    while time.time() < deadline:
        detail = client.get(f"/invoices/{invoice_id}").json()
        if detail["status"] not in {"queued", "processing"}:
            return detail
        time.sleep(0.05)
    raise TimeoutError(invoice_id)


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_upload_review_and_export(client, fixture_set):
    out, _ = fixture_set
    accepted = upload(client, out, "clean_intrastate.pdf", "err_total.pdf")
    clean, flagged = (wait_for(client, item["id"]) for item in accepted)
    assert clean["status"] == "approved"
    assert flagged["status"] == "needs_review" and flagged["error_count"] == 1

    assert len(client.get("/invoices", params={"status": "needs_review"}).json()) == 1

    corrected = dict(flagged["invoice"], total="37497.46")
    result = client.post(f"/invoices/{flagged['id']}/review", json={"action": "correct", "invoice": corrected}).json()
    assert result["status"] == "approved" and result["issues"] == []

    response = client.get("/exports/invoices.xlsx")
    assert response.status_code == 200
    book = load_workbook(io.BytesIO(response.content))
    assert book.sheetnames == ["Invoices", "Line Items", "Issues"]
    assert book["Invoices"].max_row == 3


def test_page_image(client, fixture_set):
    out, _ = fixture_set
    item = upload(client, out, "clean_intrastate.pdf")[0]
    response = client.get(f"/invoices/{item['id']}/pages/1")
    assert response.headers["content-type"] == "image/png" and response.content.startswith(b"\x89PNG")
    assert client.get(f"/invoices/{item['id']}/pages/2").status_code == 404


@pytest.mark.parametrize("name, content, reason", [
    ("notes.txt", b"hello", "supported"),
    ("fake.pdf", b"this is not a pdf", "don't match"),
    ("broken.pdf", b"%PDF-1.7 garbage", "damaged"),
    ("fake.png", b"%PDF-1.7", "don't match"),
])
def test_bad_uploads_are_rejected(client, name, content, reason):
    response = client.post("/invoices", files=[("files", (name, content))])
    assert response.status_code == 400
    assert reason in response.json()["detail"]["rejected"][0]["reason"]


def test_mixed_upload_keeps_the_good_file(client, fixture_set):
    out, _ = fixture_set
    files = [("files", ("notes.txt", b"hello")),
             ("files", ("clean_intrastate.pdf", (out / "clean_intrastate.pdf").read_bytes()))]
    body = client.post("/invoices", files=files).json()
    assert len(body["accepted"]) == 1 and len(body["rejected"]) == 1


def test_uploaded_path_cannot_escape_storage(client, fixture_set):
    out, _ = fixture_set
    content = (out / "clean_intrastate.pdf").read_bytes()
    body = client.post("/invoices", files=[("files", ("../../evil.pdf", content))]).json()
    assert body["accepted"][0]["filename"] == "evil.pdf"


def test_oversized_upload_is_rejected(fixture_set, tmp_path):
    out, _ = fixture_set
    app = create_app(Settings(storage_dir=tmp_path / "s", max_upload_mb=0), FakeExtractor(out))
    with TestClient(app) as test_client:
        response = test_client.post("/invoices", files=[("files", ("a.pdf", b"%PDF-1.7 data"))])
    assert response.status_code == 400 and "larger" in response.json()["detail"]["rejected"][0]["reason"]


def test_review_errors(client, fixture_set):
    out, _ = fixture_set
    assert client.post("/invoices/nope/review", json={"action": "approve"}).status_code == 404
    item = wait_for(client, upload(client, out, "clean_intrastate.pdf")[0]["id"])
    assert client.post(f"/invoices/{item['id']}/review", json={"action": "approve"}).status_code == 409
    assert client.post(f"/invoices/{item['id']}/review", json={"action": "correct"}).status_code == 422
    bad = {"action": "correct", "invoice": {"total": "not a number"}}
    assert client.post(f"/invoices/{item['id']}/review", json=bad).status_code == 422


def test_export_with_nothing_finished(client):
    assert client.get("/exports/invoices.xlsx").status_code == 404
