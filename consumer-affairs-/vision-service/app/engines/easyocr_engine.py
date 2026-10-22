"""EasyOCR adapter -- the second implementation of the same contract."""

from __future__ import annotations

import numpy as np

from ..schemas import Token
from .base import OCREngine

# EasyOCR's Devanagari model already includes Latin, and it refuses some
# language combinations, so Hindi requests are sent as ['hi', 'en'].
_LANG_SETS = {"en": ["en"], "hi": ["hi", "en"], "mr": ["mr", "en"], "ne": ["ne", "en"]}


class EasyOCREngine(OCREngine):
    name = "easyocr"

    def __init__(self) -> None:
        self._readers: dict[str, object] = {}
        self._reason = ""

    def is_available(self) -> bool:
        try:
            import easyocr  # noqa: F401
        except Exception as exc:  # pragma: no cover - depends on the host
            self._reason = f"easyocr not importable: {exc}"
            return False
        return True

    def unavailable_reason(self) -> str:
        return self._reason or "unknown"

    def _reader(self, key: str, langs: list[str]):
        if key not in self._readers:
            import easyocr

            self._readers[key] = easyocr.Reader(langs, gpu=False, verbose=False)
        return self._readers[key]

    def read(self, image: np.ndarray, languages: list[str]) -> list[Token]:
        primary = (languages or ["en"])[0]
        langs = _LANG_SETS.get(primary, ["en"])
        result = self._reader(primary, langs).readtext(image, detail=1, paragraph=False)

        tokens: list[Token] = []
        for entry in result or []:
            try:
                quad, text, score = entry[0], entry[1], entry[2]
            except (ValueError, IndexError, TypeError):
                continue
            if not text or not str(text).strip():
                continue
            tokens.append(
                Token(
                    text=str(text).strip(),
                    box=self._box_from_quad(quad),
                    confidence=float(score),
                    script=self._detect_script(str(text)),
                )
            )
        return tokens
