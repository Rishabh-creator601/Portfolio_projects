"""Deterministic fallback used when no OCR weights are installed.

It keeps the API and the whole downstream pipeline exercisable in development
and in CI. Every response it produces is tagged ``engine="stub"`` so a caller
can never mistake it for a real reading -- the Node client marks such an
inspection as needing review.
"""

from __future__ import annotations

import numpy as np

from ..schemas import Box, Token
from .base import OCREngine

# A compliant biscuit pack, laid out so the quantity declaration sits where a
# principal display panel would put it.
_TEMPLATE = [
    ("Manufactured by", 10, 20, 200, 16, 0.95),
    ("ABC Foods Pvt Ltd", 10, 40, 250, 16, 0.92),
    ("123, Industrial Area, New Delhi 110001", 10, 60, 300, 15, 0.88),
    ("Biscuits", 150, 100, 100, 28, 0.97),
    ("Net Wt. 200 g", 10, 150, 130, 18, 0.94),
    ("MRP Rs 40.00 incl. of all taxes", 10, 180, 280, 16, 0.93),
    ("Packed 08/2026", 10, 205, 160, 15, 0.90),
    ("Consumer Care: 18001234567 care@abcfoods.in", 10, 228, 320, 14, 0.91),
]


class StubEngine(OCREngine):
    name = "stub"

    def is_available(self) -> bool:
        return True

    def unavailable_reason(self) -> str:
        return ""

    def read(self, image: np.ndarray, languages: list[str]) -> list[Token]:
        # Scale the template onto whatever image was posted so the boxes still
        # land inside it and the geometry stages have something real to chew on.
        height, width = image.shape[:2]
        sx, sy = width / 360.0, height / 260.0

        tokens: list[Token] = []
        for text, x, y, w, h, conf in _TEMPLATE:
            tokens.append(
                Token(
                    text=text,
                    box=Box(
                        x=int(x * sx),
                        y=int(y * sy),
                        width=max(int(w * sx), 1),
                        height=max(int(h * sy), 1),
                    ),
                    confidence=conf,
                    script=self._detect_script(text),
                )
            )
        return tokens
