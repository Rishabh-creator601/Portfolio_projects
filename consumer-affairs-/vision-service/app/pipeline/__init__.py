"""Pipeline orchestration: bytes in, measurements out.

Stage order matters and is not negotiable:

    quality gate -> perspective correction -> calibration -> OCR
                 -> glyph measurement -> contrast -> clear space

Calibration sits after perspective correction because a scale measured on a
tilted label is wrong. Glyph measurement sits after OCR because OCR is used
only to *localise* the numerals -- the measurement itself comes off the
binarised crop.
"""

from __future__ import annotations

import hashlib
import re
import time

import cv2
import numpy as np

from ..engines import get_engine
from ..schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    Box,
    ClearSpaceMetrics,
    Confidence,
    ContrastMetrics,
    GlyphMetrics,
    Token,
)
from . import calibration as calibration_stage
from . import clearspace, contrast, geometry, glyphs, quality

# Rule 6(1)(c) net quantity: a number followed by a unit from the closed set in
# the Fourth Schedule / Rule 13. Used to find which token to measure.
_QUANTITY_RE = re.compile(
    r"(?:net\s*(?:wt|weight|qty|quantity|vol|volume)\.?\s*[:\-]?\s*)?"
    r"(\d+(?:[.,]\d+)?)\s*"
    r"(g|gm|gms|gram|grams|kg|kgs|ml|l|ltr|litre|liter|n|no|nos|u|cm|m)\b",
    re.IGNORECASE,
)

# Localisation fallback. OCR confuses the unit glyph with a digit often enough
# that "500 g" comes back as "500 9" -- and losing the region to measure loses
# the whole Rule 7 check. So the *region* may be found through a known
# confusion; the declared value is still parsed strictly downstream. OCR
# localises, the binarised crop measures, and neither decides what was declared.
# Real units may sit flush against the number ("200g"). A digit-like confusion
# may not: without a separator, "2526" would parse as "252" followed by unit
# "6", and the measurement would land on a date instead of the quantity.
_QUANTITY_LOCALISE_RE = re.compile(
    r"(?:net\s*(?:wt|weight|qty|quantity|vol|volume)\.?\s*[:\-]?\s*)?"
    r"\b(\d{1,5}(?:[.,]\d{1,3})?)\s*(?:"
    r"(?:g|gm|gms|kg|ml|l|ltr|n|no|nos|u|cm|m)"  # a real unit, flush or spaced
    r"|(?:\s+[9q6o0８8])"                          # a confused unit, separated
    r")\b",
    re.IGNORECASE,
)

# Anything longer is a phone number, a PIN code or a batch code, never a net
# quantity -- so it must not attract the measurement.
_LONG_DIGIT_RUN_RE = re.compile(r"\d{6,}")

_MRP_RE = re.compile(r"(mrp|maximum\s+retail\s+price|rs\.?|₹|inr)", re.IGNORECASE)


def decode_image(data: bytes) -> np.ndarray:
    """Decode uploaded bytes to BGR. Raises ValueError on anything unreadable."""
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Image could not be decoded; expected JPEG or PNG.")
    return image


def image_hash(data: bytes) -> str:
    """SHA-256 of the original bytes, for the evidence chain."""
    return hashlib.sha256(data).hexdigest()


def find_quantity_token(tokens: list[Token]) -> tuple[Token | None, bool]:
    """Locate the net quantity declaration -- the region Rules 7 and 8 turn on.

    Returns the token and whether it was found only through an OCR confusion,
    which the caller reports so the officer knows the region was inferred.
    """
    for token in tokens:
        if _QUANTITY_RE.search(token.text):
            return token, False

    candidates = [
        token
        for token in tokens
        if not _LONG_DIGIT_RUN_RE.search(token.text)
        and not _MRP_RE.search(token.text)
        and _QUANTITY_LOCALISE_RE.search(token.text)
    ]

    if not candidates:
        return None, False

    # Rule 7(2) requires the quantity declaration to be the prominent one, so
    # where several tokens could be it, the largest is the right guess -- not
    # simply the first one encountered, which is as likely to be a batch code.
    return max(candidates, key=lambda t: t.box.height), True


def find_mrp_token(tokens: list[Token]) -> Token | None:
    """Locate the retail sale price declaration, for the Rule 9(1)(b) check."""
    for token in tokens:
        if _MRP_RE.search(token.text) and any(ch.isdigit() for ch in token.text):
            return token
    return None


def analyze(data: bytes, request: AnalyzeRequest) -> AnalyzeResponse:
    """Run the full vision pipeline over one captured frame."""
    started = time.perf_counter()
    warnings: list[str] = []

    original = decode_image(data)

    # 1. Quality gate -- cheap, and it decides whether measuring is honest at all.
    # The calibration card is located first so it is not itself read as glare.
    reference_box = (
        calibration_stage.detect_reference_card(original) if request.reference_width_mm else None
    )
    quality_report = quality.assess(original, reference_box=reference_box)
    warnings.extend(quality_report.warnings)

    # 2. Perspective correction, before any scale is derived.
    rectified, corrected, matrix = geometry.correct_perspective(original)
    if not corrected:
        warnings.append(
            "No label quadrilateral found, so the image was not rectified. "
            "Measurements carry any perspective in the shot."
        )

    # 3. Calibration on the rectified image.
    calibration = calibration_stage.calibrate(
        rectified,
        reference_width_mm=request.reference_width_mm,
        reference_kind=request.reference_kind,
        perspective_corrected=corrected,
        is_curved_surface=request.is_curved_surface,
    )
    warnings.extend(calibration.notes)

    # 4. OCR -- localisation only, on the rectified image.
    engine = get_engine(request.engine)
    tokens = engine.read(rectified, request.languages)
    for token in tokens:
        token.panel = request.panel

    quantity_token, inferred_region = find_quantity_token(tokens)
    mrp_token = find_mrp_token(tokens)

    if inferred_region and quantity_token is not None:
        warnings.append(
            f"The quantity declaration was located through a likely OCR confusion "
            f"(read as {quantity_token.text!r}). The region was measured; confirm the "
            f"declared quantity itself against the pack."
        )

    # 5. Glyph measurement from the binarised crop, never the OCR box.
    if quantity_token is not None:
        numeral_metrics = glyphs.measure(
            rectified,
            quantity_token.box,
            calibration.mm_per_px,
            quality_ok=quality_report.accepted,
        )
        if inferred_region and numeral_metrics.confidence == Confidence.HIGH:
            # A region found through a guessed character is not a HIGH-confidence
            # basis for a statutory verdict, however clean the glyphs measured.
            numeral_metrics = numeral_metrics.model_copy(
                update={
                    "confidence": Confidence.MEDIUM,
                    "notes": [
                        *numeral_metrics.notes,
                        "Region located through a likely OCR confusion; officer should confirm.",
                    ],
                }
            )
    else:
        numeral_metrics = GlyphMetrics(
            confidence=Confidence.LOW,
            notes=["No net quantity declaration was located, so no numeral could be measured."],
        )

    # 6 and 7. Contrast and clear space, off the same mask.
    contrast_target = mrp_token or quantity_token
    if contrast_target is not None:
        contrast_metrics = contrast.measure(
            rectified, contrast_target.box, quality_ok=quality_report.accepted
        )
    else:
        contrast_metrics = ContrastMetrics(
            confidence=Confidence.LOW, notes=["No MRP or quantity region located to measure."]
        )

    if quantity_token is not None:
        clear_space = clearspace.measure(
            rectified,
            quantity_token.box,
            numeral_height_mm=numeral_metrics.median_digit_height_mm,
            mm_per_px=calibration.mm_per_px,
            quality_ok=quality_report.accepted,
        )
    else:
        clear_space = ClearSpaceMetrics(
            confidence=Confidence.LOW, notes=["No quantity declaration to measure margins around."]
        )

    panel = calibration_stage.panel_geometry(rectified, calibration)

    if engine.name == "stub":
        warnings.append(
            "No OCR weights are installed, so a deterministic stub reading was returned. "
            "Every declaration on this inspection needs officer review."
        )

    return AnalyzeResponse(
        tokens=tokens,
        engine=engine.name,
        quality=quality_report,
        calibration=calibration,
        numeral_metrics=numeral_metrics,
        contrast=contrast_metrics,
        clear_space=clear_space,
        panel_geometry=panel,
        quantity_region=quantity_token.box if quantity_token else None,
        image_hash=image_hash(data),
        processing_time_ms=int((time.perf_counter() - started) * 1000),
        warnings=warnings,
    )


__all__ = [
    "analyze",
    "decode_image",
    "image_hash",
    "find_quantity_token",
    "find_mrp_token",
    "calibration_stage",
    "clearspace",
    "contrast",
    "geometry",
    "glyphs",
    "quality",
]
