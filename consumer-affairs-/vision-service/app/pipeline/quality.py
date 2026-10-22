"""Capture quality gates.

From the build order's "what needs no model at all" list: blur is the variance
of the Laplacian, glare is a highlight/saturation mask. Both are classical CV
and both run before anything expensive, because measuring a blurred crop
produces a confident wrong answer rather than an honest refusal.
"""

from __future__ import annotations

import cv2
import numpy as np

from ..config import settings
from ..schemas import Box, QualityReport


def laplacian_variance(gray: np.ndarray) -> float:
    """Focus measure. Low variance means few sharp edges, i.e. a soft image."""
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def glare_ratio(image: np.ndarray, exclude: Box | None = None) -> float:
    """Fraction of the frame lost to specular glare.

    Computed on a downsampled copy: glare is a large-scale phenomenon, so
    working at ~256px costs nothing in accuracy, makes the result independent of
    capture resolution, and keeps the whole gate to a few milliseconds.

    Three conditions, because no single one is sufficient:

      * **desaturated and not in shadow** -- a reflection washes colour out;
      * **a local excess of brightness** -- the defining property. Brightness
        alone would call every white label glare, since a plain white label is
        bright everywhere and reflects nothing;
      * **broad rather than thin** -- light printing on a dark label is also
        bright and desaturated, so an opening erases anything narrower than a
        reflection would be.

    ``exclude`` masks out a region known to be a deliberately placed bright
    object -- the calibration card -- which is otherwise indistinguishable from
    a reflection, and correctly so: a white card on a dark label really is a
    large bright flat patch.

    Known limit: glare on an already-white label raises no local excess, because
    the surface is already at the top of the range. Such a capture is caught by
    the blur gate instead, or by the officer.
    """
    if image.ndim == 2:
        value_full = image
        saturation_full = np.zeros_like(image)
    else:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        saturation_full, value_full = hsv[:, :, 1], hsv[:, :, 2]

    height, width = value_full.shape[:2]
    scale = settings.GLARE_WORKING_EDGE_PX / float(min(height, width))
    if scale < 1.0:
        size = (max(int(width * scale), 32), max(int(height * scale), 32))
        value = cv2.resize(value_full, size, interpolation=cv2.INTER_AREA)
        saturation = cv2.resize(saturation_full, size, interpolation=cv2.INTER_AREA)
    else:
        value, saturation = value_full, saturation_full

    # Sigma is set explicitly: OpenCV derives a small sigma from kernel size,
    # which would leave the "background" tracking the very highlight sought.
    sigma = max(4.0, min(value.shape[:2]) / 6.0)
    local_background = cv2.GaussianBlur(value, (0, 0), sigmaX=sigma, sigmaY=sigma)
    excess = value.astype(np.int16) - local_background.astype(np.int16)

    candidate = (
        (value >= settings.GLARE_VALUE_FLOOR)
        & (saturation <= settings.GLARE_SATURATION_MAX)
        & (excess >= settings.GLARE_LOCAL_EXCESS)
    ).astype(np.uint8)

    if exclude is not None:
        factor = value.shape[1] / float(width)
        x0 = max(int(exclude.x * factor) - 2, 0)
        y0 = max(int(exclude.y * factor) - 2, 0)
        x1 = min(int((exclude.x + exclude.width) * factor) + 2, value.shape[1])
        y1 = min(int((exclude.y + exclude.height) * factor) + 2, value.shape[0])
        if x1 > x0 and y1 > y0:
            candidate[y0:y1, x0:x1] = 0

    radius = max(3, int(min(value.shape[:2]) * settings.GLARE_MIN_BLOB_RATIO)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius, radius))
    mask = cv2.morphologyEx(candidate, cv2.MORPH_OPEN, kernel)

    return float((mask > 0).sum()) / float(mask.size)


def assess(image: np.ndarray, reference_box: Box | None = None) -> QualityReport:
    """Decide whether this frame is worth measuring.

    ``reference_box``, when the calibration card has already been located, is
    excluded from the glare measurement -- it is a bright object the officer
    put there on purpose.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    height, width = gray.shape[:2]

    blur = laplacian_variance(gray)
    glare = glare_ratio(image, exclude=reference_box)

    is_blurred = blur < settings.BLUR_THRESHOLD
    has_glare = glare > settings.GLARE_RATIO_THRESHOLD
    is_low_res = min(width, height) < settings.MIN_RESOLUTION_PX

    warnings: list[str] = []
    if is_blurred:
        warnings.append(
            f"Image is soft (focus score {blur:.0f}, need {settings.BLUR_THRESHOLD:.0f}). "
            "Re-shoot closer with the panel flat to the lens."
        )
    if has_glare:
        warnings.append(
            f"Glare covers {glare * 100:.1f}% of the frame. Tilt the pack away from the light source."
        )
    if is_low_res:
        warnings.append(
            f"Shortest edge is {min(width, height)}px, below the {settings.MIN_RESOLUTION_PX}px "
            "needed to measure glyph heights."
        )

    return QualityReport(
        blur_score=round(blur, 2),
        is_blurred=is_blurred,
        glare_ratio=round(glare, 4),
        has_glare=has_glare,
        resolution=(width, height),
        is_low_resolution=is_low_res,
        # Glare alone does not reject the frame: OCR often still reads around it,
        # and the measurement stages downgrade their own confidence instead.
        accepted=not (is_blurred or is_low_res),
        warnings=warnings,
    )
