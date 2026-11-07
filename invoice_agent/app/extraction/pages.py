"""Opens PDFs and images, and decides which pages can be read from their text layer."""

from pathlib import Path

import pymupdf

SUPPORTED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg"}
MIN_TEXT_CHARS = 20     # fewer than this is a scan with stray marks, not a real text layer


class DocumentError(ValueError):
    """The file cannot be opened as an invoice document."""


def read_pages(path: Path | str, max_pages: int = 50, content: bytes | None = None) -> list[dict]:
    """Return [{"number": 1, "text": "..."}, ...]. Raises DocumentError for unusable files.

    Pass content to check a file's bytes before saving it. `path` then only supplies the file type.
    """
    try:
        if content is None:
            doc = pymupdf.open(path)
        else:
            doc = pymupdf.open(stream=content, filetype=Path(path).suffix.lstrip("."))
    except Exception as error:
        raise DocumentError("The file is damaged or is not a readable PDF or image.") from error
    with doc:
        if doc.needs_pass:
            raise DocumentError("The PDF is password protected.")
        if doc.page_count == 0:
            raise DocumentError("The file has no pages.")
        if doc.page_count > max_pages:
            raise DocumentError(f"The file has {doc.page_count} pages; the limit is {max_pages}.")
        return [{"number": page.number + 1, "text": page.get_text().strip()} for page in doc]


def has_text_layer(page: dict) -> bool:
    return len(page["text"]) >= MIN_TEXT_CHARS


def render_page(path: Path | str, number: int, dpi: int) -> bytes:
    """Render a 1-based page number to PNG bytes."""
    with pymupdf.open(path) as doc:
        return doc[number - 1].get_pixmap(dpi=dpi, alpha=False).tobytes("png")
