"""One OCR contract, several implementations.

Build order, step 1: "One contract, two implementations. POST /ocr ->
[{text, box, confidence}, ...]". Engines are chosen by measurement against the
ground-truth set, not by reputation, so swapping one for another must not touch
anything downstream.
"""

from __future__ import annotations

import abc

import numpy as np

from ..schemas import Box, Token


class OCREngine(abc.ABC):
    """Base class every engine implements. Nothing else is part of the contract."""

    name: str = "base"

    @abc.abstractmethod
    def is_available(self) -> bool:
        """True when the library and its weights are installed and loadable."""

    @abc.abstractmethod
    def unavailable_reason(self) -> str:
        """Human-readable explanation shown on /health when not available."""

    @abc.abstractmethod
    def read(self, image: np.ndarray, languages: list[str]) -> list[Token]:
        """Return one Token per recognised word."""

    # -- helpers shared by implementations -------------------------------

    @staticmethod
    def _box_from_quad(quad) -> Box:
        """Collapse a 4-point polygon to the axis-aligned box the contract uses.

        The polygon is kept nowhere: glyph measurement re-derives geometry from
        the binarised crop, so an approximate region is all that is needed here.
        """
        xs = [float(p[0]) for p in quad]
        ys = [float(p[1]) for p in quad]
        x0, y0 = int(min(xs)), int(min(ys))
        x1, y1 = int(max(xs)), int(max(ys))
        return Box(x=x0, y=y0, width=max(x1 - x0, 1), height=max(y1 - y0, 1))

    @staticmethod
    def _detect_script(text: str) -> str:
        """Rule 9(4) allows Devanagari or Latin; anything else is reported as-is."""
        has_devanagari = any("ऀ" <= ch <= "ॿ" for ch in text)
        has_latin = any(("a" <= ch <= "z") or ("A" <= ch <= "Z") for ch in text)

        if has_devanagari and has_latin:
            return "Devanagari+Latin"
        if has_devanagari:
            return "Devanagari"
        if has_latin:
            return "Latin"
        return "Other"
