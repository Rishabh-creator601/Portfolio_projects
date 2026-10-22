"""Rule 8(1) clear space -- build order step 5.

"All declarations appear on the principal display panel, and the area around the
quantity declaration is free of printed matter: clear space above and below at
least equal to the numeral height, and to left and right at least twice the
numeral height."

Geometric measurement of the printed-matter-free margin, using the same
binarised mask that step 4 produced. The declaration's own ink is excluded; what
is being looked for is the distance to the *next* piece of printing.
"""

from __future__ import annotations

import cv2
import numpy as np

from ..config import settings
from ..schemas import Box, ClearSpaceMetrics, Confidence
from .glyphs import binarize


def _ink_profile(mask: np.ndarray, axis: int) -> np.ndarray:
    """Count ink pixels along an axis, giving a 1-D profile of where print sits."""
    return (mask > 0).sum(axis=axis).astype(float)


def _distance_to_ink(profile: np.ndarray, start: int, direction: int, noise_floor: float) -> int:
    """Walk outward from ``start`` until the profile shows real printed matter.

    ``noise_floor`` ignores JPEG speckle and faint background texture so a
    single stray pixel does not read as a neighbouring declaration.
    """
    index = start
    steps = 0
    limit = len(profile)

    while 0 <= index < limit:
        if profile[index] > noise_floor:
            return steps
        index += direction
        steps += 1

    return steps  # ran to the edge of the panel without meeting any print


def measure(
    image: np.ndarray,
    quantity_box: Box,
    *,
    numeral_height_mm: float | None,
    mm_per_px: float | None,
    quality_ok: bool = True,
) -> ClearSpaceMetrics:
    """Measure the printed-matter-free margin around the quantity declaration."""
    if not mm_per_px or not numeral_height_mm:
        return ClearSpaceMetrics(
            confidence=Confidence.LOW,
            notes=[
                "Clear space is prescribed in multiples of the numeral height, so it "
                "cannot be evaluated without a millimetre calibration."
            ],
        )

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    mask = binarize(gray, upscale=1)
    if mask.size == 0:
        return ClearSpaceMetrics(confidence=Confidence.LOW, notes=["Panel could not be binarised."])

    height, width = mask.shape[:2]

    # Blank out the declaration itself: its own ink is not an encroachment.
    working = mask.copy()
    x0 = max(quantity_box.x, 0)
    y0 = max(quantity_box.y, 0)
    x1 = min(quantity_box.x + quantity_box.width, width)
    y1 = min(quantity_box.y + quantity_box.height, height)
    if x1 <= x0 or y1 <= y0:
        return ClearSpaceMetrics(
            confidence=Confidence.LOW, notes=["Quantity region outside the panel bounds."]
        )
    working[y0:y1, x0:x1] = 0

    # Profiles restricted to the declaration's own rows/columns, so print
    # elsewhere on the panel is not mistaken for a crowding neighbour.
    row_band = working[:, x0:x1]
    col_band = working[y0:y1, :]

    vertical_profile = _ink_profile(row_band, axis=1)     # ink per row
    horizontal_profile = _ink_profile(col_band, axis=0)   # ink per column

    v_noise = max(1.0, (x1 - x0) * 0.01)
    h_noise = max(1.0, (y1 - y0) * 0.01)

    above_px = _distance_to_ink(vertical_profile, y0 - 1, -1, v_noise)
    below_px = _distance_to_ink(vertical_profile, y1, +1, v_noise)
    left_px = _distance_to_ink(horizontal_profile, x0 - 1, -1, h_noise)
    right_px = _distance_to_ink(horizontal_profile, x1, +1, h_noise)

    above_mm = above_px * mm_per_px
    below_mm = below_px * mm_per_px
    left_mm = left_px * mm_per_px
    right_mm = right_px * mm_per_px

    required_vertical = numeral_height_mm          # one numeral height
    required_horizontal = numeral_height_mm * 2.0  # twice, left and right

    satisfied = (
        above_mm >= required_vertical
        and below_mm >= required_vertical
        and left_mm >= required_horizontal
        and right_mm >= required_horizontal
    )

    notes: list[str] = []
    margins = [
        ("above", above_mm, required_vertical),
        ("below", below_mm, required_vertical),
        ("left", left_mm, required_horizontal),
        ("right", right_mm, required_horizontal),
    ]
    for side, actual, required in margins:
        if actual < required:
            notes.append(f"{side}: {actual:.1f} mm against {required:.1f} mm required")

    # Any margin that ran to the edge of the frame is unmeasured, not infinite.
    touched_edge = (
        above_px >= y0 or below_px >= height - y1 or left_px >= x0 or right_px >= width - x1
    )

    tightest = min(actual / required for _, actual, required in margins if required > 0)

    if not quality_ok:
        confidence = Confidence.LOW
        notes.append("Capture quality gate failed; margins are indicative only.")
    elif touched_edge:
        confidence = Confidence.MEDIUM
        notes.append(
            "At least one margin reaches the edge of the captured frame, so the true "
            "clear space may extend beyond the shot."
        )
    elif abs(tightest - 1.0) < settings.MEASUREMENT_MARGIN:
        confidence = Confidence.MEDIUM
        notes.append("Tightest margin sits on the statutory threshold; an officer should confirm.")
    else:
        confidence = Confidence.HIGH

    return ClearSpaceMetrics(
        above_mm=round(above_mm, 2),
        below_mm=round(below_mm, 2),
        left_mm=round(left_mm, 2),
        right_mm=round(right_mm, 2),
        required_vertical_mm=round(required_vertical, 2),
        required_horizontal_mm=round(required_horizontal, 2),
        satisfied=satisfied,
        confidence=confidence,
        notes=notes,
    )
