"""Rule 9(1)(b) contrast -- build order step 5.

"Numerals of MRP and net quantity are printed, painted or inscribed in a colour
that contrasts conspicuously with the label background."

The Rules do not put a number on "conspicuously", so the WCAG relative-luminance
ratio is used: it is published, reproducible and defensible under challenge in a
way that an ad-hoc threshold is not. Glyph pixels come from the step-4 mask;
the background is a dilated ring around those glyphs, which is the local
background a reader actually sees the text against -- not the page average.
"""

from __future__ import annotations

import cv2
import numpy as np

from ..config import settings
from ..schemas import Box, Confidence, ContrastMetrics
from .glyphs import crop, glyph_mask_for_region


def _relative_luminance(bgr: np.ndarray) -> float:
    """WCAG 2.x relative luminance for a mean BGR colour in 0-255."""
    srgb = np.asarray(bgr, dtype=float)[::-1] / 255.0  # BGR -> RGB

    linear = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    return float(0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2])


def contrast_ratio(l1: float, l2: float) -> float:
    """WCAG contrast ratio; always >= 1, lighter over darker."""
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def measure(image: np.ndarray, box: Box, *, quality_ok: bool = True) -> ContrastMetrics:
    """Contrast between the glyphs in ``box`` and their local background."""
    region = crop(image, box)
    if region.size == 0:
        return ContrastMetrics(confidence=Confidence.LOW, notes=["Region outside image bounds."])

    if region.ndim == 2:
        region = cv2.cvtColor(region, cv2.COLOR_GRAY2BGR)

    notes: list[str] = []

    mask = glyph_mask_for_region(image, box)
    if mask.size == 0:
        return ContrastMetrics(confidence=Confidence.LOW, notes=["Region could not be binarised."])

    # The mask was computed on an upscaled crop; bring it back to crop scale.
    mask = cv2.resize(mask, (region.shape[1], region.shape[0]), interpolation=cv2.INTER_NEAREST)
    glyph_mask = mask > 0

    if glyph_mask.sum() < 20:
        # Sauvola is tuned for legibility, so it finds almost no ink precisely
        # when the print barely contrasts with the label -- which is the Rule
        # 9(1)(b) violation this check exists to catch. Declining to measure
        # there would let the worst cases through, so fall back to Otsu, which
        # always splits the region into two clusters however close they sit.
        gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
        _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        glyph_mask = otsu > 0

        # Otsu labels the larger cluster arbitrarily; ink is the minority.
        if glyph_mask.mean() > 0.5:
            glyph_mask = ~glyph_mask

        mask = (glyph_mask.astype(np.uint8)) * 255
        notes.append(
            "Print contrasts too weakly for adaptive binarisation; measured via Otsu "
            "clustering instead."
        )

        if glyph_mask.sum() < 20:
            return ContrastMetrics(
                confidence=Confidence.LOW,
                notes=notes + ["Too few ink pixels to measure contrast."],
            )

    # Dilate the glyphs, then subtract them: what is left is a ring of the
    # background immediately surrounding the text.
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (settings.CONTRAST_RING_DILATION_PX * 2 + 1, settings.CONTRAST_RING_DILATION_PX * 2 + 1),
    )
    dilated = cv2.dilate(mask, kernel, iterations=1) > 0
    ring_mask = dilated & ~glyph_mask

    if ring_mask.sum() < 20:
        return ContrastMetrics(
            confidence=Confidence.LOW,
            notes=["No clear background ring around the glyphs; text may be touching other print."],
        )

    glyph_colour = region[glyph_mask].mean(axis=0)
    background_colour = region[ring_mask].mean(axis=0)

    glyph_luminance = _relative_luminance(glyph_colour)
    background_luminance = _relative_luminance(background_colour)
    ratio = contrast_ratio(glyph_luminance, background_luminance)

    margin = abs(ratio - settings.CONTRAST_AA_RATIO) / settings.CONTRAST_AA_RATIO

    if not quality_ok:
        confidence = Confidence.LOW
        notes.append("Capture quality gate failed; contrast is indicative only.")
    elif margin < settings.MEASUREMENT_MARGIN:
        # Sitting on the threshold is exactly the case not to assert.
        confidence = Confidence.MEDIUM
        notes.append(
            f"Ratio {ratio:.2f} sits within {settings.MEASUREMENT_MARGIN * 100:.0f}% of the "
            f"{settings.CONTRAST_AA_RATIO:.1f} threshold; an officer should confirm."
        )
    else:
        confidence = Confidence.HIGH

    return ContrastMetrics(
        ratio=round(ratio, 2),
        glyph_luminance=round(glyph_luminance, 4),
        background_luminance=round(background_luminance, 4),
        meets_wcag_aa=ratio >= settings.CONTRAST_AA_RATIO,
        confidence=confidence,
        notes=notes,
    )
