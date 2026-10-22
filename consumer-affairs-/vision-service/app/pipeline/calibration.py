"""Pixels to millimetres.

    mm_per_px = known reference width in mm / its measured width in px

computed **after** perspective correction, never before.

Caveat carried into the response as a note: on curved surfaces -- bottles,
pouches -- mm/px varies across the label, so one scale factor is only valid
near the reference. Either the card sits adjacent to the declaration being
measured, or the package is routed to needs-review.
"""

from __future__ import annotations

import cv2
import numpy as np

from ..config import settings
from ..schemas import Box, Calibration, Confidence, PanelGeometry


def detect_reference_card(image: np.ndarray) -> Box | None:
    """Find a rectangular calibration card by its aspect ratio.

    A standard ID-1 card is 85.6 x 53.98 mm, an aspect of about 1.586. Looking
    for that shape is far more reliable than looking for a colour, which shifts
    under shop lighting.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 40, 130)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = float(image.shape[0] * image.shape[1])

    best: tuple[float, Box] | None = None

    for contour in contours:
        area = cv2.contourArea(contour)
        # A card that fills the frame is not a card; one that is a speck is noise.
        if area < image_area * 0.005 or area > image_area * 0.4:
            continue

        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.03 * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue

        x, y, w, h = cv2.boundingRect(approx)
        if h == 0 or w < settings.MIN_REFERENCE_WIDTH_PX:
            continue

        aspect = max(w, h) / float(min(w, h))
        error = abs(aspect - 1.586)
        if error > 0.25:
            continue

        if best is None or error < best[0]:
            best = (error, Box(x=int(x), y=int(y), width=int(w), height=int(h)))

    return best[1] if best else None


def calibrate(
    image: np.ndarray,
    *,
    reference_width_mm: float | None,
    reference_kind: str = "reference_card",
    perspective_corrected: bool = False,
    is_curved_surface: bool = False,
    reference_box: Box | None = None,
) -> Calibration:
    """Derive mm_per_px, and state honestly how much it can be trusted."""
    notes: list[str] = []

    if not reference_width_mm or reference_width_mm <= 0:
        return Calibration(
            source="none",
            perspective_corrected=perspective_corrected,
            is_curved_surface=is_curved_surface,
            confidence=Confidence.LOW,
            notes=[
                "No reference width supplied. Rule 7 prescribes heights in millimetres, "
                "so without a scale the font checks return needs-review rather than a "
                "false verdict."
            ],
        )

    box = reference_box
    if box is None and reference_kind == "reference_card":
        box = detect_reference_card(image)

    if box is None:
        return Calibration(
            source="none",
            reference_width_mm=reference_width_mm,
            perspective_corrected=perspective_corrected,
            is_curved_surface=is_curved_surface,
            confidence=Confidence.LOW,
            notes=[
                "A reference width was given but no reference object was located in frame. "
                "Place the card flat beside the declaration being measured, or enter a "
                "known package dimension instead."
            ],
        )

    # The card's long edge is the one whose real width we know.
    measured_px = float(max(box.width, box.height))
    if measured_px < settings.MIN_REFERENCE_WIDTH_PX:
        notes.append(
            f"Reference occupies only {measured_px:.0f}px; move closer so it fills more of the frame."
        )

    mm_per_px = reference_width_mm / measured_px

    if not perspective_corrected:
        confidence = Confidence.MEDIUM
        notes.append(
            "Perspective could not be corrected, so the scale carries any tilt in the shot."
        )
    elif is_curved_surface:
        confidence = Confidence.LOW
        notes.append(
            "Curved surface: mm/px varies across the label, so this scale is valid only "
            "immediately around the reference. Measurements are routed to review."
        )
    elif measured_px < settings.MIN_REFERENCE_WIDTH_PX:
        confidence = Confidence.MEDIUM
    else:
        confidence = Confidence.HIGH

    return Calibration(
        mm_per_px=round(mm_per_px, 6),
        source=reference_kind,
        reference_width_mm=reference_width_mm,
        reference_width_px=round(measured_px, 2),
        perspective_corrected=perspective_corrected,
        is_curved_surface=is_curved_surface,
        confidence=confidence,
        notes=notes,
    )


def panel_geometry(image: np.ndarray, calibration: Calibration) -> PanelGeometry:
    """Principal display panel size, which Rule 7(2) Table II is indexed by."""
    if not calibration.mm_per_px:
        return PanelGeometry(confidence=Confidence.LOW)

    height_px, width_px = image.shape[:2]
    width_mm = width_px * calibration.mm_per_px
    height_mm = height_px * calibration.mm_per_px

    return PanelGeometry(
        width_mm=round(width_mm, 2),
        height_mm=round(height_mm, 2),
        area_cm2=round((width_mm * height_mm) / 100.0, 2),
        # The panel is only the whole frame if the officer framed it that way,
        # so this never claims better than medium.
        confidence=(
            Confidence.MEDIUM if calibration.confidence == Confidence.HIGH else Confidence.LOW
        ),
    )
