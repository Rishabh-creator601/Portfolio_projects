"""HTTP API. Start with: uvicorn --factory app.api.main:create_app"""

from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, model_validator

from app.config import Settings
from app.export.excel import build_workbook
from app.extraction.llm import Extractor, OpenAIExtractor
from app.extraction.pages import DocumentError, render_page
from app.schemas import Invoice
from app.service import InvoiceService, ReviewConflict

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
EXPORTABLE = {"approved", "needs_review"}


class ReviewRequest(BaseModel):
    action: Literal["approve", "correct"]
    invoice: Invoice | None = None

    @model_validator(mode="after")
    def correct_needs_invoice(self):
        if self.action == "correct" and self.invoice is None:
            raise ValueError("A correction must include the corrected invoice.")
        return self


def _summary(record: dict) -> dict:
    invoice = record["data"].get("invoice") or {}
    issues = record["data"].get("issues") or []
    return {
        "id": record["id"], "filename": record["filename"], "status": record["status"],
        "page_count": record["page_count"], "reviewed": record["reviewed"], "error": record["error"],
        "created_at": record["created_at"], "vendor": invoice.get("vendor_name"),
        "invoice_number": invoice.get("invoice_number"), "total": invoice.get("total"),
        "currency": invoice.get("currency"),
        "error_count": sum(i["severity"] == "error" for i in issues),
        "warning_count": sum(i["severity"] == "warning" for i in issues),
    }


def _detail(record: dict) -> dict:
    data = record["data"]
    return {**_summary(record), "raw": data.get("raw"), "invoice": data.get("invoice"),
            "issues": data.get("issues") or [], "reread_count": data.get("reread_count") or 0,
            "reread_changes": data.get("reread_changes") or []}


def create_app(settings: Settings | None = None, extractor: Extractor | None = None) -> FastAPI:
    settings = settings or Settings()
    service = InvoiceService(settings, extractor or OpenAIExtractor(settings.chat_model))

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        service.close()

    app = FastAPI(title="Invoice Agent API", lifespan=lifespan)
    app.state.service = service

    def get_record(invoice_id: str) -> dict:
        record = service.store.get(invoice_id)
        if not record:
            raise HTTPException(404, "Invoice not found.")
        return record

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/invoices", status_code=202)
    def upload(files: list[UploadFile] = File(...)):
        limit = settings.max_upload_mb * 1024 * 1024
        accepted, rejected = [], []
        for upload_file in files:
            filename = upload_file.filename or "upload"
            try:
                record = service.add_file(filename, upload_file.file.read(limit + 1))
            except DocumentError as error:
                rejected.append({"filename": filename, "reason": str(error)})
                continue
            accepted.append({"id": record["id"], "filename": record["filename"]})
            service.submit(record["id"])
        if not accepted:
            raise HTTPException(400, {"message": "None of the files could be used.", "rejected": rejected})
        return {"accepted": accepted, "rejected": rejected}

    @app.get("/invoices")
    def list_invoices(status: str | None = None):
        return [_summary(record) for record in service.store.list(status)]

    @app.get("/invoices/{invoice_id}")
    def get_invoice(invoice_id: str):
        return _detail(get_record(invoice_id))

    @app.get("/invoices/{invoice_id}/pages/{number}")
    def get_page(invoice_id: str, number: int):
        record = get_record(invoice_id)
        if not 1 <= number <= record["page_count"]:
            raise HTTPException(404, "Page not found.")
        return Response(render_page(record["file_path"], number, settings.extract_dpi), media_type="image/png")

    @app.post("/invoices/{invoice_id}/review")
    def review(invoice_id: str, request: ReviewRequest):
        get_record(invoice_id)
        decision = {"action": request.action}
        if request.invoice is not None:
            decision["invoice"] = request.invoice.model_dump(mode="json")
        try:
            return _detail(service.review(invoice_id, decision))
        except ReviewConflict as error:
            raise HTTPException(409, str(error)) from error

    @app.get("/exports/invoices.xlsx")
    def export(ids: list[str] | None = Query(None)):
        records = service.store.list() if not ids else [r for r in (service.store.get(i) for i in ids) if r]
        records = [r for r in records if r["status"] in EXPORTABLE]
        if not records:
            raise HTTPException(404, "There are no finished invoices to export.")
        return Response(build_workbook(records), media_type=XLSX_TYPE,
                        headers={"Content-Disposition": 'attachment; filename="invoices.xlsx"'})

    return app
