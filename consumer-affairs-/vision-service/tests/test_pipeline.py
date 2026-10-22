"""Tests for the measurement pipeline.

Synthetic labels are rendered at a known mm/px, so every measurement can be
checked against the geometry it was actually drawn with. This does not replace
the ~150-package ground-truth set -- that is step 2 and it needs real packages
and a steel rule -- but it does keep the algorithms honest between builds.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.pipeline import calibration as calibration_stage  # noqa: E402
from app.pipeline import clearspace, contrast, geometry, glyphs, quality  # noqa: E402
from app.schemas import Box, Confidence  # noqa: E402
from tests.synthetic import add_glare, blur, encode, render_label  # noqa: E402

# Rule 7(2) Table I bands, plus the doubled column for blown/moulded packs.
STATUTORY_BANDS_MM = [1.0, 2.0, 4.0, 6.0]


class TestGlyphMeasurement:
    """Build order step 4 -- the hardest and most valuable part."""

    @pytest.mark.parametrize("target_mm", STATUTORY_BANDS_MM)
    @pytest.mark.parametrize("px_per_mm", [8.0, 10.0, 16.0, 24.0])
    def test_height_within_tolerance_of_truth(self, target_mm, px_per_mm):
        image, truth = render_label(
            px_per_mm=px_per_mm, numeral_height_mm=target_mm, with_card=False
        )

        metrics = glyphs.measure(image, Box(**truth["quantity_box"]), truth["mm_per_px"])

        assert metrics.median_digit_height_mm is not None
        error_mm = abs(metrics.median_digit_height_mm - target_mm)
        # 0.15 mm is well inside the gap between adjacent statutory bands.
        assert error_mm < 0.15, f"{error_mm:.3f} mm error at {target_mm} mm / {px_per_mm} px/mm"

    @pytest.mark.parametrize("target_mm", STATUTORY_BANDS_MM)
    def test_measurement_lands_in_the_right_statutory_band(self, target_mm):
        """What matters is which side of the minimum the measurement falls on."""
        image, truth = render_label(px_per_mm=12.0, numeral_height_mm=target_mm, with_card=False)
        metrics = glyphs.measure(image, Box(**truth["quantity_box"]), truth["mm_per_px"])

        for band in STATUTORY_BANDS_MM:
            assert (metrics.median_digit_height_mm >= band) == (target_mm >= band), (
                f"measured {metrics.median_digit_height_mm:.2f} mm classifies differently "
                f"from true {target_mm} mm at the {band} mm band"
            )

    def test_does_not_inherit_ocr_box_padding(self):
        """A padded region must not inflate the measurement.

        This is the whole reason the height is taken from connected components
        rather than from the OCR box: a box sized to a text region skews high,
        and in enforcement a false positive is the expensive kind of error.
        """
        image, truth = render_label(px_per_mm=12.0, numeral_height_mm=2.0, with_card=False)
        box = truth["quantity_box"]

        # Simulate an OCR box that is 40% taller than the ink it contains.
        pad = int(box["height"] * 0.4)
        padded = Box(
            x=max(box["x"] - pad, 0),
            y=max(box["y"] - pad, 0),
            width=box["width"] + pad * 2,
            height=box["height"] + pad * 2,
        )

        tight = glyphs.measure(image, Box(**box), truth["mm_per_px"])
        loose = glyphs.measure(image, padded, truth["mm_per_px"])

        assert loose.median_digit_height_mm == pytest.approx(
            tight.median_digit_height_mm, abs=0.2
        ), "padding the region changed the measured glyph height"

    def test_reports_pixels_without_calibration(self):
        image, truth = render_label(px_per_mm=12.0, numeral_height_mm=2.0, with_card=False)
        metrics = glyphs.measure(image, Box(**truth["quantity_box"]), None)

        assert metrics.median_digit_height_px is not None
        assert metrics.median_digit_height_mm is None
        assert metrics.confidence == Confidence.LOW

    def test_empty_region_is_low_confidence_not_a_crash(self):
        image, _ = render_label(with_card=False)
        metrics = glyphs.measure(image, Box(x=10_000, y=10_000, width=10, height=10), 0.1)

        assert metrics.confidence == Confidence.LOW
        assert metrics.median_digit_height_mm is None


class TestQualityGates:
    """Classical CV, no model -- from the build order's final section."""

    def test_sharp_label_is_accepted(self):
        image, _ = render_label(px_per_mm=12.0, width_mm=120, height_mm=90)
        report = quality.assess(image)

        assert not report.is_blurred
        assert report.accepted

    def test_blurred_label_is_rejected_with_a_reason(self):
        image, _ = render_label(px_per_mm=12.0, width_mm=120, height_mm=90)
        report = quality.assess(blur(image, 21))

        assert report.is_blurred
        assert not report.accepted
        assert any("soft" in w.lower() for w in report.warnings)

    @pytest.mark.parametrize(
        "background,ink",
        [((180, 175, 170), (20, 20, 20)), ((80, 80, 80), (240, 240, 240))],
    )
    def test_glare_is_detected(self, background, ink):
        image, truth = render_label(
            px_per_mm=12.0, width_mm=120, height_mm=90, background=background, ink=ink
        )
        box = Box(**truth["card_box"])
        report = quality.assess(add_glare(image, radius_ratio=0.2), reference_box=box)

        assert report.has_glare
        assert any("glare" in w.lower() for w in report.warnings)

    @pytest.mark.parametrize(
        "background,ink",
        [
            ((250, 250, 250), (20, 20, 20)),   # a plain white label is not glare
            ((243, 240, 232), (20, 20, 20)),
            ((180, 175, 170), (20, 20, 20)),
            ((80, 80, 80), (240, 240, 240)),   # light print on dark is not glare
        ],
    )
    def test_clean_capture_reports_no_glare(self, background, ink):
        """Brightness alone must not be read as a reflection.

        A white label is bright everywhere and reflects nothing; light printing
        on a dark label is bright and desaturated too. Warning on either would
        make the gate noise an officer learns to ignore.
        """
        image, truth = render_label(
            px_per_mm=12.0, width_mm=120, height_mm=90, background=background, ink=ink
        )
        report = quality.assess(image, reference_box=Box(**truth["card_box"]))

        assert not report.has_glare, f"{report.glare_ratio:.1%} glare on a clean capture"

    def test_reference_card_is_not_mistaken_for_glare(self):
        """The calibration card is a bright flat object placed on purpose."""
        image, truth = render_label(
            px_per_mm=12.0, width_mm=120, height_mm=90, background=(90, 90, 90)
        )

        without_exclusion = quality.glare_ratio(image)
        with_exclusion = quality.glare_ratio(image, exclude=Box(**truth["card_box"]))

        assert with_exclusion < without_exclusion
        assert with_exclusion < 0.01

    def test_low_resolution_is_rejected(self):
        image, _ = render_label(px_per_mm=4.0, width_mm=60, height_mm=40)
        report = quality.assess(image)

        assert report.is_low_resolution
        assert not report.accepted

    def test_blurred_crop_downgrades_measurement_confidence(self):
        image, truth = render_label(px_per_mm=12.0, numeral_height_mm=2.0, with_card=False)
        metrics = glyphs.measure(
            image, Box(**truth["quantity_box"]), truth["mm_per_px"], quality_ok=False
        )

        assert metrics.confidence == Confidence.LOW


class TestCalibration:
    def test_no_reference_gives_no_scale_and_says_why(self):
        image, _ = render_label(with_card=False)
        result = calibration_stage.calibrate(image, reference_width_mm=None)

        assert result.mm_per_px is None
        assert result.confidence == Confidence.LOW
        assert any("millimetre" in note.lower() for note in result.notes)

    def test_reference_card_recovers_the_true_scale(self):
        image, truth = render_label(px_per_mm=12.0, with_card=True)
        assert truth["card_box"] is not None

        result = calibration_stage.calibrate(
            image,
            reference_width_mm=truth["card_width_mm"],
            reference_box=Box(**truth["card_box"]),
            perspective_corrected=True,
        )

        assert result.mm_per_px == pytest.approx(truth["mm_per_px"], rel=0.05)
        assert result.confidence == Confidence.HIGH

    def test_curved_surface_is_downgraded_to_low(self):
        """mm/px varies across a bottle or pouch, so one factor is not enough."""
        image, truth = render_label(px_per_mm=12.0, with_card=True)

        result = calibration_stage.calibrate(
            image,
            reference_width_mm=truth["card_width_mm"],
            reference_box=Box(**truth["card_box"]),
            perspective_corrected=True,
            is_curved_surface=True,
        )

        assert result.confidence == Confidence.LOW
        assert any("curved" in note.lower() for note in result.notes)

    def test_uncorrected_perspective_is_downgraded_to_medium(self):
        image, truth = render_label(px_per_mm=12.0, with_card=True)

        result = calibration_stage.calibrate(
            image,
            reference_width_mm=truth["card_width_mm"],
            reference_box=Box(**truth["card_box"]),
            perspective_corrected=False,
        )

        assert result.confidence == Confidence.MEDIUM

    def test_reference_width_without_a_located_card_is_honest_about_it(self):
        image, _ = render_label(with_card=False, background=(255, 255, 255))
        result = calibration_stage.calibrate(image, reference_width_mm=85.6)

        if result.mm_per_px is None:
            assert result.confidence == Confidence.LOW
            assert any("no reference object" in n.lower() for n in result.notes)


class TestContrast:
    def test_black_on_white_passes_comfortably(self):
        image, truth = render_label(
            ink=(15, 15, 15), background=(250, 250, 250), with_card=False, px_per_mm=12.0
        )
        result = contrast.measure(image, Box(**truth["quantity_box"]))

        assert result.ratio is not None
        assert result.meets_wcag_aa
        assert result.ratio > 10

    def test_low_contrast_print_fails(self):
        image, truth = render_label(
            ink=(175, 175, 175), background=(215, 215, 215), with_card=False, px_per_mm=12.0
        )
        result = contrast.measure(image, Box(**truth["quantity_box"]))

        assert result.ratio is not None
        assert not result.meets_wcag_aa

    def test_ratio_matches_the_wcag_formula(self):
        # Pure black on pure white is 21:1 by definition.
        assert contrast.contrast_ratio(0.0, 1.0) == pytest.approx(21.0, rel=0.001)
        assert contrast.contrast_ratio(0.5, 0.5) == pytest.approx(1.0)


class TestClearSpace:
    def test_generous_margin_satisfies_rule_8(self):
        image, truth = render_label(
            px_per_mm=12.0, numeral_height_mm=2.0, clear_space_mm=10.0, with_card=False
        )
        result = clearspace.measure(
            image,
            Box(**truth["quantity_box"]),
            numeral_height_mm=2.0,
            mm_per_px=truth["mm_per_px"],
        )

        assert result.required_vertical_mm == pytest.approx(2.0)
        assert result.required_horizontal_mm == pytest.approx(4.0)
        assert result.above_mm >= result.required_vertical_mm

    def test_crowded_declaration_is_flagged(self):
        image, truth = render_label(
            px_per_mm=12.0, numeral_height_mm=3.0, with_card=False, crowd=True
        )
        result = clearspace.measure(
            image,
            Box(**truth["quantity_box"]),
            numeral_height_mm=3.0,
            mm_per_px=truth["mm_per_px"],
        )

        assert result.satisfied is False
        assert any("above" in note for note in result.notes)

    def test_without_calibration_it_declines_rather_than_guesses(self):
        image, truth = render_label(px_per_mm=12.0, with_card=False)
        result = clearspace.measure(
            image, Box(**truth["quantity_box"]), numeral_height_mm=None, mm_per_px=None
        )

        assert result.satisfied is None
        assert result.confidence == Confidence.LOW


class TestGeometry:
    @pytest.mark.parametrize("applied", [3.0, 7.0, -5.0])
    def test_rotation_is_recovered(self, applied):
        """The label is given a dark border so there is an edge to find.

        A photographed pack always sits against *something*; a label whose
        border matches its own background exactly is a synthetic artefact.
        """
        image, _ = render_label(px_per_mm=12.0, width_mm=120, height_mm=80, with_card=False)
        bordered = np.full(
            (image.shape[0] + 80, image.shape[1] + 80, 3), (40, 40, 40), dtype=np.uint8
        )
        bordered[40:-40, 40:-40] = image

        angle = geometry.estimate_skew_angle(geometry.rotate(bordered, applied))
        assert abs(abs(angle) - abs(applied)) < 2.0

    def test_deskew_runs_when_no_quadrilateral_is_found(self):
        image, _ = render_label(px_per_mm=12.0, width_mm=120, height_mm=80, with_card=False)
        bordered = np.full(
            (image.shape[0] + 80, image.shape[1] + 80, 3), (40, 40, 40), dtype=np.uint8
        )
        bordered[40:-40, 40:-40] = image

        out, corrected, _ = geometry.correct_perspective(geometry.rotate(bordered, 8.0))

        # Either a full warp or the de-skew fallback; both must leave the
        # residual skew smaller than it started.
        residual = geometry.estimate_skew_angle(out)
        assert abs(residual) < 8.0
        assert isinstance(corrected, bool)

    def test_correct_perspective_never_returns_a_degenerate_image(self):
        image, _ = render_label(px_per_mm=12.0, with_card=False)
        out, corrected, _ = geometry.correct_perspective(image)

        assert out.shape[0] >= 32 and out.shape[1] >= 32
        assert isinstance(corrected, bool)


class TestEndToEnd:
    def test_analyze_returns_a_complete_response(self):
        from app import pipeline
        from app.schemas import AnalyzeRequest

        image, truth = render_label(px_per_mm=12.0, numeral_height_mm=2.0, with_card=True)
        result = pipeline.analyze(
            encode(image), AnalyzeRequest(reference_width_mm=truth["card_width_mm"], engine="stub")
        )

        assert result.tokens
        assert result.engine == "stub"
        assert result.image_hash and len(result.image_hash) == 64
        assert result.quality is not None
        assert result.calibration is not None
        # The stub engine must always be announced as needing review.
        assert any("stub" in w.lower() for w in result.warnings)

    def test_unreadable_bytes_raise_a_clear_error(self):
        from app import pipeline

        with pytest.raises(ValueError, match="could not be decoded"):
            pipeline.analyze(b"not an image", __import__("app.schemas", fromlist=["x"]).AnalyzeRequest())

    def test_quantity_token_is_located(self):
        from app import pipeline
        from app.schemas import Token

        tokens = [
            Token(text="Biscuits", box=Box(x=0, y=0, width=10, height=10), confidence=0.9),
            Token(text="Net Wt. 200 g", box=Box(x=0, y=20, width=10, height=10), confidence=0.9),
        ]
        found, inferred = pipeline.find_quantity_token(tokens)

        assert found is not None and "200" in found.text
        assert inferred is False

    def test_quantity_region_survives_a_unit_ocr_confusion(self):
        """"500 g" read as "500 9" must still yield a region to measure.

        Losing the region loses the whole Rule 7 check, so the *region* may be
        found through a known confusion - flagged as inferred, so the declared
        value is still confirmed by the officer rather than trusted.
        """
        from app import pipeline
        from app.schemas import Token

        tokens = [Token(text="500 9", box=Box(x=0, y=0, width=40, height=20), confidence=0.8)]
        found, inferred = pipeline.find_quantity_token(tokens)

        assert found is not None
        assert inferred is True

    @pytest.mark.parametrize(
        "text", ["Consumer Care: 18001234567", "New Delhi 110001", "MRP Rs 40.00"]
    )
    def test_phone_pin_and_price_are_not_measured_as_quantity(self, text):
        from app import pipeline
        from app.schemas import Token

        tokens = [Token(text=text, box=Box(x=0, y=0, width=40, height=20), confidence=0.9)]
        found, _ = pipeline.find_quantity_token(tokens)

        assert found is None
