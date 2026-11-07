"""The UI's only connection to the backend."""

import os

import httpx

API_URL = os.getenv("API_URL", "http://localhost:8000")
_client = httpx.Client(base_url=API_URL, timeout=60)


class ApiError(RuntimeError):
    pass


def _check(response: httpx.Response) -> httpx.Response:
    if response.is_error:
        try:
            detail = response.json().get("detail", response.text)
        except ValueError:
            detail = response.text
        if isinstance(detail, dict):
            detail = detail.get("message", str(detail))
        elif isinstance(detail, list):      # FastAPI validation errors
            detail = "; ".join(f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e in detail)
        raise ApiError(str(detail))
    return response


def is_up() -> bool:
    try:
        return _client.get("/health", timeout=3).is_success
    except httpx.HTTPError:
        return False


def upload(files: list[tuple[str, bytes]]) -> dict:
    return _check(_client.post("/invoices", files=[("files", file) for file in files])).json()


def list_invoices() -> list[dict]:
    return _check(_client.get("/invoices")).json()


def get_invoice(invoice_id: str) -> dict:
    return _check(_client.get(f"/invoices/{invoice_id}")).json()


def page_image(invoice_id: str, number: int) -> bytes:
    return _check(_client.get(f"/invoices/{invoice_id}/pages/{number}")).content


def review(invoice_id: str, payload: dict) -> dict:
    return _check(_client.post(f"/invoices/{invoice_id}/review", json=payload)).json()


def export(ids: list[str]) -> bytes:
    return _check(_client.get("/exports/invoices.xlsx", params={"ids": ids})).content
