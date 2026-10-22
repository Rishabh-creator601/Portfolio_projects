"""Glyph height in millimetres -- build order step 4.

**Never measure font height from an OCR bounding box.** CRAFT and PaddleOCR both
return a box around a text *region*, sized to that region's ascenders and
descenders plus padding. A box around "200 g" is as tall as the g descender; a
box around "MRP" has no descender at all. Measuring from those is inconsistent
by 20-40% depending on which letters happen to be in the string, and it skews
**high** -- so it reports Rule 7(2) violations that are not there. In an
enforcement tool, false positives are the expensive kind of error.

The method implemented here instead:

    a. OCR localises the numeral -- that is all it is used for
    b. crop that region from the full-resolution original, upscale 3-4x
    c. Sauvola binarise (adaptive; handles uneven packaging light better
       than a global Otsu threshold)
    d. connected components -> one component per glyph
    e. filter to digit glyphs, take the median component height in px
    f. height_mm = median_px * mm_per_px
"""

from __future__ import annotations

import cv2
import numpy as np
from skimage.filters import threshold_sauvola

from ..config import settings
from ..schemas import Box, Confidence, GlyphMetrics


def crop(image: np.ndarray, box: Box, pad_ratio: float = 0.15) -> np.ndarray:
    """Crop a region with a little padding, clamped to the image."""
    height, width = image.shape[:2]
    pad_x = int(box.width * pad_ratio)
    pad_y = int(box.height * pad_ratio)

    x0 = max(box.x - pad_x, 0)
    y0 = max(box.y - pad_y, 0)
    x1 = min(box.x + box.width + pad_x, width)
    y1 = min(box.y + box.height + pad_y, height)

    if x1 <= x0 or y1 <= y0:
        return np.empty((0, 0), dtype=image.dtype)
    return image[y0:y1, x0:x1]


def _sauvola_window(crop_height_px: int) -> int:
    """Pick an odd Sauvola window that is wider than the strokes it must span.

    Sauvola thresholds each pixel against its local mean. If the window is
    narrower than a stroke, the middle of that stroke looks like uniform local
    background and drops out -- large bold numerals come back hollow and
    fragment into several components, which drags the median height down.
    So the window tracks the crop height (roughly the glyph height) rather than
    staying at one fixed size across every pack.
    """
    window = max(settings.SAUVOLA_WINDOW, int(crop_height_px / 3))
    window = min(window, max(crop_height_px - 1, 3))

    if window % 2 == 0:
        window -= 1
    return max(window, 3)


def binarize(gray: np.ndarray, upscale: int | None = None) -> np.ndarray:
    """Upscale then Sauvola binarise, returning a mask where glyph pixels are 255.

    Sauvola thresholds each pixel against the local mean and standard deviation,
    so a gradient across the label -- shadow on one side, highlight on the other
    -- does not swallow half the text the way a single global threshold does.
    """
    factor = upscale or settings.GLYPH_UPSCALE
    if gray.size == 0:
        return gray

    if factor > 1:
        gray = cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)

    window = _sauvola_window(gray.shape[0])

    threshold = threshold_sauvola(gray, window_size=window, k=settings.SAUVOLA_K)
    mask = (gray < threshold).astype(np.uint8) * 255  # dark ink on a light label

    # Printing is rarely light-on-dark, but when it is, the mask comes back
    # mostly filled -- invert so "set pixel" always means "ink".
    if mask.mean() > 127:
        mask = cv2.bitwise_not(mask)

    return mask


def _components(mask: np.ndarray) -> list[dict]:
    """Connected components with their stats, excluding the background label."""
    count, _, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)

    out: list[dict] = []
    for i in range(1, count):
        x, y, w, h, area = stats[i]
        out.append(
            {
                "x": int(x),
                "y": int(y),
                "width": int(w),
                "height": int(h),
                "area": int(area),
                "cx": float(centroids[i][0]),
                "cy": float(centroids[i][1]),
            }
        )
    return out


def _filter_to_glyphs(components: list[dict], mask_height: int) -> list[dict]:
    """Keep components that plausibly are single digit glyphs.

    Rejected: specks and JPEG noise (too small), the label border or a merged
    word blob (too tall), and dashes, dots and underscores (too wide for their
    height). A digit is always taller than it is wide.
    """
    if not components:
        return []

    tallest = max(c["height"] for c in components)
    keep: list[dict] = []

    for c in components:
        if c["area"] < settings.MIN_GLYPH_AREA_PX:
            continue
        if c["height"] > mask_height * settings.MAX_GLYPH_HEIGHT_RATIO:
            continue
        if c["height"] < tallest * settings.MIN_GLYPH_HEIGHT_RATIO:
            continue
        if c["width"] > c["height"] * settings.MAX_GLYPH_ASPECT:
            continue
        keep.append(c)

    return keep


def measure(
    image: np.ndarray,
    box: Box,
    mm_per_px: float | None,
    *,
    upscale: int | None = None,
    quality_ok: bool = True,
) -> GlyphMetrics:
    """Measure median glyph height and width for one text region.

    ``image`` must be the full-resolution original (or its rectified copy) --
    never a compressed report attachment. ``mm_per_px`` is expressed in the
    coordinates of that same image; the upscale factor is divided back out here.
    """
    factor = upscale or settings.GLYPH_UPSCALE
    notes: list[str] = []

    region = crop(image, box)
    if region.size == 0:
        return GlyphMetrics(
            confidence=Confidence.LOW, notes=["Region fell outside the image bounds."]
        )

    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if region.ndim == 3 else region
    mask = binarize(gray, factor)
    if mask.size == 0:
        return GlyphMetrics(confidence=Confidence.LOW, notes=["Region could not be binarised."])

    glyphs = _filter_to_glyphs(_components(mask), mask.shape[0])

    if len(glyphs) < settings.MIN_GLYPHS_FOR_MEDIAN:
        return GlyphMetrics(
            glyph_count=len(glyphs),
            upscale_factor=factor,
            confidence=Confidence.LOW,
            notes=[
                f"Only {len(glyphs)} glyph component(s) survived filtering; "
                "not enough to take a median."
            ],
        )

    # Divide the upscale back out to return px in original-image coordinates.
    heights_px = np.array([g["height"] for g in glyphs], dtype=float) / factor
    widths_px = np.array([g["width"] for g in glyphs], dtype=float) / factor

    median_height = float(np.median(heights_px))
    median_width = float(np.median(widths_px))

    # A tight spread means the components really are a row of glyphs; a wide one
    # means the filter probably kept some noise alongside them.
    spread = float(np.std(heights_px) / median_height) if median_height else 1.0

    if not quality_ok:
        confidence = Confidence.LOW
        notes.append("Capture quality gate failed; measurement is indicative only.")
    elif mm_per_px is None:
        confidence = Confidence.LOW
        notes.append("No millimetre calibration; height is reported in pixels only.")
    elif spread > 0.35:
        confidence = Confidence.MEDIUM
        notes.append(f"Glyph heights vary by {spread * 100:.0f}%; an officer should confirm.")
    elif len(glyphs) < 3:
        confidence = Confidence.MEDIUM
        notes.append("Median taken over fewer than three glyphs.")
    else:
        confidence = Confidence.HIGH

    return GlyphMetrics(
        median_digit_height_px=round(median_height, 2),
        median_digit_height_mm=round(median_height * mm_per_px, 3) if mm_per_px else None,
        median_letter_width_px=round(median_width, 2),
        median_letter_width_mm=round(median_width * mm_per_px, 3) if mm_per_px else None,
        glyph_count=len(glyphs),
        upscale_factor=factor,
        confidence=confidence,
        notes=notes,
    )


def glyph_mask_for_region(image: np.ndarray, box: Box, upscale: int | None = None) -> np.ndarray:
    """The binarised mask for a region.

    Contrast and clear space both fall out of this same mask, which is why the
    build order calls them "nearly free" once step 4 exists.
    """
    region = crop(image, box)
    if region.size == 0:
        return np.empty((0, 0), dtype=np.uint8)

    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if region.ndim == 3 else region
    return binarize(gray, upscale)
