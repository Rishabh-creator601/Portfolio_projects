"""Connects uploads, the graph and storage. Invoices are processed one at a time, in upload order,
so the duplicate check always sees earlier invoices."""

import hashlib
import logging
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from typing import Callable

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

from app.config import Settings
from app.db.store import Store
from app.extraction.llm import ExtractionError, Extractor
from app.extraction.pages import SUPPORTED_SUFFIXES, DocumentError, read_pages
from app.graph.builder import build_graph, result_data

log = logging.getLogger(__name__)

_SIGNATURES = {".pdf": [b"%PDF"], ".png": [b"\x89PNG"], ".jpg": [b"\xff\xd8\xff"], ".jpeg": [b"\xff\xd8\xff"]}


class ReviewConflict(RuntimeError):
    """The invoice is not waiting for review."""


class InvoiceService:
    def __init__(self, settings: Settings, extractor: Extractor, today: Callable[[], date] = date.today):
        self.settings = settings
        settings.files_dir.mkdir(parents=True, exist_ok=True)
        self.store = Store(settings.db_path)
        self.store.fail_unfinished("Processing stopped because the server restarted. Please upload the file again.")
        self._checkpoints = sqlite3.connect(settings.checkpoint_path, check_same_thread=False)
        self.graph = build_graph(extractor, self.store, SqliteSaver(self._checkpoints), settings, today)
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="invoice")

    def close(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=True)
        self._checkpoints.close()

    def add_file(self, filename: str, content: bytes) -> dict:
        """Check and save an upload. Raises DocumentError if it can't be used."""
        name = Path(filename).name or "upload"
        suffix = Path(name).suffix.lower()
        if suffix not in SUPPORTED_SUFFIXES:
            raise DocumentError("Only PDF, PNG and JPG files are supported.")
        if len(content) > self.settings.max_upload_mb * 1024 * 1024:
            raise DocumentError(f"The file is larger than {self.settings.max_upload_mb} MB.")
        if not any(content.startswith(signature) for signature in _SIGNATURES[suffix]):
            raise DocumentError(f"The contents don't match the {suffix} file type.")

        pages = read_pages(name, self.settings.max_pages, content=content)

        invoice_id = uuid.uuid4().hex[:12]
        path = self.settings.files_dir / f"{invoice_id}{suffix}"
        path.write_bytes(content)
        self.store.add(invoice_id, name, str(path), hashlib.sha256(content).hexdigest(), len(pages))
        return self.store.get(invoice_id)

    def submit(self, invoice_id: str) -> None:
        self._executor.submit(self.process, invoice_id)

    def process(self, invoice_id: str) -> None:
        record = self.store.get(invoice_id)
        state = {"invoice_id": invoice_id, "file_path": record["file_path"], "file_hash": record["file_hash"]}
        self._run(invoice_id, state)

    def _run(self, invoice_id: str, graph_input) -> None:
        config = {"configurable": {"thread_id": invoice_id}}
        try:
            self.graph.invoke(graph_input, config)
        except (ExtractionError, DocumentError) as error:
            self.store.set_status(invoice_id, "failed", str(error))
            return
        except Exception:
            log.exception("Processing failed for invoice %s", invoice_id)
            self.store.set_status(invoice_id, "failed", "The invoice could not be processed. See the server log for details.")
            return
        snapshot = self.graph.get_state(config)
        if snapshot.next:
            self.store.save_result(invoice_id, "needs_review", result_data(snapshot.values))

    def review(self, invoice_id: str, decision: dict) -> dict:
        record = self.store.get(invoice_id)
        if record["status"] != "needs_review":
            raise ReviewConflict(f"This invoice is '{record['status']}', not waiting for review.")
        self._run(invoice_id, Command(resume=decision))
        return self.store.get(invoice_id)
