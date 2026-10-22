"""PaddleOCR (PP-OCRv5) adapter.

The build order starts here: better on small dense print, better multilingual
coverage for the regional-language roadmap, and faster on CPU than EasyOCR.
That is a starting hypothesis, not a conclusion -- benchmark/evaluate.py runs
both over the ground-truth set and the winner is whichever measures better.
"""

from __future__ import annotations

import numpy as np

from ..schemas import Token
from .base import OCREngine

# Rule 9(4): declarations are in Devanagari or English, so those are the two
# language packs that matter. PaddleOCR bundles both under one 'devanagari'
# recognition model that also reads Latin.
_LANG_MAP = {"en": "en", "hi": "devanagari", "mr": "devanagari", "ne": "devanagari"}


class PaddleEngine(OCREngine):
    name = "paddleocr"

    def __init__(self) -> None:
        self._readers: dict[str, object] = {}
        self._reason = ""

    def is_available(self) -> bool:
        try:
            import paddleocr  # noqa: F401
        except Exception as exc:  # pragma: no cover - depends on the host
            self._reason = f"paddleocr not importable: {exc}"
            return False
        return True

    def unavailable_reason(self) -> str:
        return self._reason or "unknown"

    def _reader(self, lang: str):
        """Readers are cached per language; loading weights is the slow part."""
        if lang not in self._readers:
            from paddleocr import PaddleOCR

            self._readers[lang] = PaddleOCR(
                use_angle_cls=True,
                lang=lang,
                show_log=False,
            )
        return self._readers[lang]

    def read(self, image: np.ndarray, languages: list[str]) -> list[Token]:
        lang = _LANG_MAP.get((languages or ["en"])[0], "en")
        result = self._reader(lang).ocr(image, cls=True)

        tokens: list[Token] = []
        # PaddleOCR returns one list per image; each entry is [quad, (text, score)].
        for page in result or []:
            for entry in page or []:
                try:
                    quad, (text, score) = entry[0], entry[1]
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
