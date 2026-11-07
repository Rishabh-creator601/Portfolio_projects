"""Stands in for the LLM by returning each file's known answer. Lets everything except
the model's reading be tested without an API key. Says nothing about real reading accuracy."""

import hashlib
from pathlib import Path

from app.schemas import RawInvoice
from tests.fixtures.generate import AnswerFile


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class FakeExtractor:
    def __init__(self, fixture_dir: Path):
        self.answers: dict[str, RawInvoice] = {}
        for answer_path in Path(fixture_dir).glob("*.json"):
            answer = AnswerFile.model_validate_json(answer_path.read_text(encoding="utf-8"))
            self.answers[_sha(Path(fixture_dir) / answer.file)] = answer.raw
        self.calls: list[dict] = []
        self.second_read: RawInvoice | None = None      # lets a test make the reread disagree
        self.error: Exception | None = None

    def extract(self, path: Path, pages: list[dict], *, force_images: bool = False, dpi: int = 150) -> RawInvoice:
        self.calls.append({"path": path, "force_images": force_images, "dpi": dpi})
        if self.error:
            raise self.error
        if force_images and self.second_read is not None:
            return self.second_read
        return self.answers[_sha(Path(path))]
