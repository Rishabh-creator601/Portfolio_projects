"""Invoice records in SQLite. Opens a short-lived connection per call, so it is safe across threads."""

import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS invoices (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    reviewed INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    vendor_key TEXT,
    number_key TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hash ON invoices(file_hash);
CREATE INDEX IF NOT EXISTS idx_vendor_number ON invoices(vendor_key, number_key);
"""


def _key(text: str | None) -> str | None:
    return " ".join(text.split()).casefold() if text else None


def _record(row: sqlite3.Row) -> dict:
    record = dict(row)
    record["data"] = json.loads(record["data"])
    record["reviewed"] = bool(record["reviewed"])
    return record


class Store:
    def __init__(self, path: Path):
        self.path = path
        with closing(self._connect()) as conn, conn:
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def add(self, id: str, filename: str, file_path: str, file_hash: str, page_count: int) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO invoices (id, filename, file_path, file_hash, page_count, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, 'queued', ?)",
                (id, filename, file_path, file_hash, page_count, datetime.now(timezone.utc).isoformat()),
            )

    def get(self, id: str) -> dict | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM invoices WHERE id = ?", (id,)).fetchone()
        return _record(row) if row else None

    def list(self, status: str | None = None) -> list[dict]:
        query, params = "SELECT * FROM invoices", ()
        if status:
            query, params = query + " WHERE status = ?", (status,)
        with closing(self._connect()) as conn:
            return [_record(row) for row in conn.execute(query + " ORDER BY seq", params)]

    def set_status(self, id: str, status: str, error: str | None = None) -> None:
        with closing(self._connect()) as conn, conn:
            conn.execute("UPDATE invoices SET status = ?, error = ? WHERE id = ?", (status, error, id))

    def save_result(self, id: str, status: str, data: dict, reviewed: bool = False) -> None:
        invoice = data.get("invoice") or {}
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "UPDATE invoices SET status = ?, data = ?, reviewed = ?, error = NULL, vendor_key = ?, number_key = ? "
                "WHERE id = ?",
                (status, json.dumps(data), int(reviewed), _key(invoice.get("vendor_name")),
                 _key(invoice.get("invoice_number")), id),
            )

    def find_duplicate(self, id: str, file_hash: str, vendor: str | None, number: str | None) -> dict | None:
        """Find an earlier invoice with the same file, or the same vendor and invoice number."""
        vendor_key, number_key = _key(vendor), _key(number)
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT * FROM invoices WHERE seq < (SELECT seq FROM invoices WHERE id = ?) AND status != 'failed' "
                "AND (file_hash = ? OR (vendor_key = ? AND number_key = ?)) ORDER BY seq LIMIT 1",
                (id, file_hash, vendor_key, number_key),
            ).fetchone()
        return _record(row) if row else None

    def fail_unfinished(self, message: str) -> None:
        """Called at startup: anything queued or processing was lost when the server stopped."""
        with closing(self._connect()) as conn, conn:
            conn.execute("UPDATE invoices SET status = 'failed', error = ? WHERE status IN ('queued', 'processing')",
                         (message,))
