"""Wire contracts for the vision service.

The OCR contract is deliberately narrow -- ``POST /ocr`` returns
``[{text, box, confidence}, ...]`` and nothing else -- so PaddleOCR and EasyOCR
are interchangeable behind it (ML build order, step 1).
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class Confidence(str, Enum):
    """Confidence bands drive what happens to a row without an officer asking.

    Solution design, section 10: HIGH records the verdict, MEDIUM records it
    behind a review flag, LOW asserts nothing and joins the pending queue.
    """

    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class Box(BaseModel):
    """Axis-aligned bounding box in pixels of the image that was read."""

    x: int
    y: int
    width: int
    height: int

    def as_list(self) -> list[int]:
        return [self.x, self.y, self.x + self.width, self.y + self.height]


class Token(BaseModel):
    """One recognised word. This is the whole OCR contract."""

    text: str
    box: Box
    confidence: float = Field(ge=0.0, le=1.0)
    # Everything below is optional enrichment; never required of an engine.
    script: str | None = None
    panel: str | None = None


class OcrResponse(BaseModel):
    tokens: list[Token]
    engine: str
    languages: list[str] = ["en"]
    processing_time_ms: int


class QualityReport(BaseModel):
    """Capture gates that need no model at all (build order, final section)."""

    blur_score: float = Field(description="Variance of the Laplacian; higher is sharper")
    is_blurred: bool
    glare_ratio: float = Field(description="Fraction of pixels in specular highlight")
    has_glare: bool
    resolution: tuple[int, int]
    is_low_resolution: bool
    accepted: bool
    warnings: list[str] = []


class Calibration(BaseModel):
    """Pixels to millimetres.

    ``mm_per_px`` is only meaningful near the reference; on curved packaging the
    scale varies across the label, which is why ``is_curved_surface`` downgrades
    every measurement that depends on it.
    """

    mm_per_px: float | None = None
    source: str = Field(default="none", description="reference_card | known_dimension | none")
    reference_width_mm: float | None = None
    reference_width_px: float | None = None
    perspective_corrected: bool = False
    is_curved_surface: bool = False
    confidence: Confidence = Confidence.LOW
    notes: list[str] = []


class GlyphMetrics(BaseModel):
    """Measured from a binarised crop, never from an OCR bounding box.

    OCR boxes are sized to the text region including ascenders, descenders and
    padding, which skews high by 20-40% depending on which letters are present.
    In enforcement, a false positive is the expensive kind of error.
    """

    median_digit_height_px: float | None = None
    median_digit_height_mm: float | None = None
    median_letter_width_px: float | None = None
    median_letter_width_mm: float | None = None
    glyph_count: int = 0
    upscale_factor: int = 1
    method: str = "sauvola+connected_components"
    confidence: Confidence = Confidence.LOW
    notes: list[str] = []


class ContrastMetrics(BaseModel):
    """Rule 9(1)(b): glyph pixels against a dilated ring of local background."""

    ratio: float | None = None
    glyph_luminance: float | None = None
    background_luminance: float | None = None
    meets_wcag_aa: bool | None = None
    confidence: Confidence = Confidence.LOW
    notes: list[str] = []


class ClearSpaceMetrics(BaseModel):
    """Rule 8(1): one numeral height above and below, twice that left and right."""

    above_mm: float | None = None
    below_mm: float | None = None
    left_mm: float | None = None
    right_mm: float | None = None
    required_vertical_mm: float | None = None
    required_horizontal_mm: float | None = None
    satisfied: bool | None = None
    confidence: Confidence = Confidence.LOW
    notes: list[str] = []


class PanelGeometry(BaseModel):
    """Principal display panel area, needed for Rule 7(2) Table II."""

    width_mm: float | None = None
    height_mm: float | None = None
    area_cm2: float | None = None
    confidence: Confidence = Confidence.LOW


class AnalyzeRequest(BaseModel):
    """Officer-supplied context. The panel is asked for, never inferred.

    Build order: "PDP vs side/back panel -- ask the officer during capture
    (UI answer to an ML problem -- do not train a segmenter)".
    """

    panel: str = "principal"
    reference_width_mm: float | None = Field(
        default=None, description="Width in mm of the reference card or known package dimension"
    )
    reference_kind: str = "reference_card"
    is_curved_surface: bool = False
    is_blown_or_moulded: bool = Field(
        default=False, description="Rule 7(2): doubles every minimum numeral height"
    )
    languages: list[str] = ["en"]
    engine: str | None = None


class AnalyzeResponse(BaseModel):
    tokens: list[Token]
    engine: str
    quality: QualityReport
    calibration: Calibration
    numeral_metrics: GlyphMetrics
    contrast: ContrastMetrics
    clear_space: ClearSpaceMetrics
    panel_geometry: PanelGeometry
    quantity_region: Box | None = None
    image_hash: str
    processing_time_ms: int
    warnings: list[str] = []

    model_config = {"json_schema_extra": {"examples": []}}


class EngineInfo(BaseModel):
    name: str
    available: bool
    is_default: bool
    detail: str = ""


class HealthResponse(BaseModel):
    status: str
    service: str = "lm-verify-vision"
    version: str
    engines: list[EngineInfo]
    capabilities: dict[str, Any]
