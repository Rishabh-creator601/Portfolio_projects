"""Synthetic label generator for testing the measurement stages.

A rendered label has a known mm/px by construction, so the measured numeral
height can be checked against the height it was actually drawn at. That is what
makes the step-4 pipeline testable without a photograph and a steel rule -- the
real ground-truth set still has to be built, but this catches regressions.
"""

from __future__ import annotations

import cv2
import numpy as np

# ID-1 reference card, the one the calibration stage looks for.
CARD_WIDTH_MM = 85.6
CARD_ASPECT = 85.6 / 53.98

# Digits only: the pipeline measures digit glyphs, and letters with descenders
# (the 'g' in "200 g") sit lower than the digit cap height.
_DIGITS = "0123456789"


def _ink_height_px(text: str, font: int, scale: float, thickness: int) -> float:
    """Median height of the digit glyphs as actually rendered, in pixels."""
    (w, h), baseline = cv2.getTextSize(text, font, scale, thickness)
    canvas = np.full((h + baseline + 40, w + 40), 255, dtype=np.uint8)
    cv2.putText(canvas, text, (20, h + 20), font, scale, 0, thickness, cv2.LINE_AA)

    ink = (canvas < 128).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)

    digit_count = sum(1 for ch in text if ch in _DIGITS)
    components = sorted(
        (stats[i][cv2.CC_STAT_HEIGHT] for i in range(1, count) if stats[i][cv2.CC_STAT_AREA] >= 5)
    )
    if not components:
        return 0.0

    # Digits are the shortest full-height glyphs here; drop anything taller
    # (descenders) before taking the median.
    if digit_count and digit_count <= len(components):
        components = components[:digit_count]

    return float(np.median(components))


def _solve_scale_for_ink_height(
    text: str, font: int, thickness: int, target_px: float, tolerance: float = 0.5
) -> float:
    """Binary-search the font scale that renders digits at ``target_px`` tall."""
    low, high = 0.05, 20.0

    for _ in range(60):
        mid = (low + high) / 2
        measured = _ink_height_px(text, font, mid, thickness)
        if measured == 0:
            low = mid
            continue
        if abs(measured - target_px) <= tolerance:
            return mid
        if measured < target_px:
            low = mid
        else:
            high = mid

    return (low + high) / 2


def render_label(
    *,
    px_per_mm: float = 10.0,
    numeral_height_mm: float = 2.0,
    quantity_text: str = "200 g",
    width_mm: float = 100.0,
    height_mm: float = 70.0,
    with_card: bool = True,
    ink: tuple[int, int, int] = (20, 20, 20),
    background: tuple[int, int, int] = (245, 245, 245),
    clear_space_mm: float = 6.0,
    crowd: bool = False,
    full_declarations: bool = False,
) -> tuple[np.ndarray, dict]:
    """Render a label whose true geometry is known exactly.

    Returns the image and the truth dict the tests assert against.
    """
    width_px = int(width_mm * px_per_mm)
    height_px = int(height_mm * px_per_mm)

    image = np.full((height_px, width_px, 3), background, dtype=np.uint8)

    target_px = numeral_height_mm * px_per_mm
    font = cv2.FONT_HERSHEY_SIMPLEX
    thickness = max(1, int(round(target_px / 8)))

    # Solve the font scale against *rendered ink*, never against getTextSize.
    # getTextSize returns a padded layout box -- for FONT_HERSHEY_SIMPLEX it
    # reports about 24px for 18px of actual ink. Trusting it here would bake a
    # 30% error into the test's own ground truth, which is precisely the
    # mistake the pipeline exists to avoid making with OCR boxes.
    scale = _solve_scale_for_ink_height(quantity_text, font, thickness, target_px)

    (text_w, text_h), baseline = cv2.getTextSize(quantity_text, font, scale, thickness)

    origin_x = int(width_px * 0.25)
    origin_y = int(height_px * 0.55)
    cv2.putText(image, quantity_text, (origin_x, origin_y), font, scale, ink, thickness, cv2.LINE_AA)

    quantity_box = {
        "x": origin_x,
        "y": origin_y - text_h,
        "width": text_w,
        "height": text_h + baseline,
    }

    # Other printed matter, placed at a known distance from the declaration.
    gap_px = int(clear_space_mm * px_per_mm)
    if crowd:
        gap_px = int(0.4 * numeral_height_mm * px_per_mm)

    small_scale = scale * 0.5
    cv2.putText(
        image,
        "MRP Rs 40.00",
        (origin_x, max(quantity_box["y"] - gap_px, 12)),
        font,
        small_scale,
        ink,
        max(1, thickness // 2),
        cv2.LINE_AA,
    )

    # The rest of the mandatory declaration set. Off by default so the geometry
    # tests keep a clean panel, on for the benchmark set -- otherwise the ground
    # truth claims heads the image never carried, and the engine is scored as
    # missing text that was never drawn.
    if full_declarations:
        tiny = max(small_scale * 0.62, 0.30)
        tiny_thickness = max(1, thickness // 3)
        line_step = max(int(height_px * 0.052), 12)
        y = line_step

        for line in (
            "Manufactured by",
            "ABC Foods Pvt Ltd",
            "123, Industrial Area, New Delhi 110001",
        ):
            cv2.putText(image, line, (8, y), font, tiny, ink, tiny_thickness, cv2.LINE_AA)
            y += line_step

        cv2.putText(
            image,
            "Biscuits",
            (int(width_px * 0.55), line_step * 2),
            font,
            small_scale,
            ink,
            max(1, thickness // 2),
            cv2.LINE_AA,
        )

        bottom = height_px - line_step
        for line in reversed(
            ("Consumer Care: 18001234567", "care@abcfoods.in", "Packed 08/2026")
        ):
            cv2.putText(
                image,
                line,
                (int(width_px * 0.42), bottom),
                font,
                tiny,
                ink,
                tiny_thickness,
                cv2.LINE_AA,
            )
            bottom -= line_step

    card_box = None
    if with_card:
        # A white card with a dark border, sized so its long edge is CARD_WIDTH_MM.
        card_w = int(CARD_WIDTH_MM * px_per_mm * 0.5)
        card_h = int(card_w / CARD_ASPECT)
        cx, cy = 8, height_px - card_h - 8
        if cy > 0:
            cv2.rectangle(image, (cx, cy), (cx + card_w, cy + card_h), (255, 255, 255), -1)
            cv2.rectangle(image, (cx, cy), (cx + card_w, cy + card_h), (0, 0, 0), 2)
            card_box = {"x": cx, "y": cy, "width": card_w, "height": card_h}

    truth = {
        "px_per_mm": px_per_mm,
        "mm_per_px": 1.0 / px_per_mm,
        "numeral_height_mm": numeral_height_mm,
        "numeral_height_px": target_px,
        "quantity_box": quantity_box,
        "quantity_text": quantity_text,
        "card_box": card_box,
        "card_width_mm": CARD_WIDTH_MM * 0.5 if with_card else None,
        "clear_space_mm": clear_space_mm if not crowd else 0.4 * numeral_height_mm,
    }
    return image, truth


def encode(image: np.ndarray, ext: str = ".png") -> bytes:
    ok, buffer = cv2.imencode(ext, image)
    if not ok:
        raise RuntimeError("Failed to encode synthetic label")
    return buffer.tobytes()


def blur(image: np.ndarray, kernel: int = 15) -> np.ndarray:
    return cv2.GaussianBlur(image, (kernel | 1, kernel | 1), 0)


def add_glare(image: np.ndarray, radius_ratio: float = 0.25, strength: float = 1.0) -> np.ndarray:
    """Add a specular highlight with radial falloff.

    A flat white disc is not what glare looks like: a real reflection clips at
    the centre and falls away to the surface value, which is exactly the local
    excess the detector keys on.
    """
    out = image.copy().astype(np.float32)
    height, width = out.shape[:2]

    cy, cx = height * 0.5, width * 0.5
    radius = min(width, height) * radius_ratio

    yy, xx = np.mgrid[0:height, 0:width]
    distance = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)

    # Gaussian falloff, clipped at the centre the way a sensor clips.
    falloff = np.exp(-(distance**2) / (2 * (radius / 1.6) ** 2))
    boost = (falloff * 255 * strength)[:, :, None]

    return np.clip(out + boost, 0, 255).astype(np.uint8)
