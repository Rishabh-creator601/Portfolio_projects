"""Generate a small synthetic ground-truth set.

This exists so the benchmark harness is runnable on day one and so the JSON
shape is unambiguous. It is **not** the ground-truth set the build order asks
for: synthetic labels cannot tell you whether the OCR reads real embossed
plastic, a crushed pouch, or Devanagari at 1 mm. That set is ~150 photographed
packages with hand measurements, and it has to be built before any accuracy
claim is made.

    python -m benchmark.make_sample_set --out data/sample
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2  # noqa: E402

from benchmark.groundtruth import (  # noqa: E402
    Declarations,
    GroundTruthEntry,
    HandMeasurements,
    coverage_report,
    save,
)
from tests.synthetic import render_label  # noqa: E402

# One per category so the exemption paths are all exercised, with the numeral
# height chosen to straddle the Rule 7(2) Table I bands.
SPECS = [
    # (id, category, quantity value/unit, numeral height mm, expected violations)
    ("food-001", "food", 200, "g", 1.2, []),
    ("food-002", "food", 200, "g", 0.7, ["R7_2_T1"]),
    ("food-003", "food", 500, "g", 2.4, []),
    ("food-004", "food", 500, "g", 1.6, ["R7_2_T1"]),
    ("cosmetics-001", "cosmetics", 100, "ml", 1.1, []),
    ("cosmetics-002", "cosmetics", 100, "ml", 0.8, ["R7_2_T1"]),
    ("detergent-001", "detergent", 1000, "g", 4.3, []),
    ("detergent-002", "detergent", 1000, "g", 3.1, ["R7_2_T1"]),
    ("bidi-001", "bidi", 20, "N", 1.3, []),
    ("bidi-002", "bidi", 20, "N", 0.6, ["R7_2_T1"]),
]

PX_PER_MM = 14.0


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a synthetic sample set")
    parser.add_argument("--out", default="data/sample", help="Output directory")
    args = parser.parse_args()

    out = Path(args.out)
    images = out / "images"
    images.mkdir(parents=True, exist_ok=True)

    entries: list[GroundTruthEntry] = []

    for entry_id, category, value, unit, height_mm, violations in SPECS:
        quantity_text = f"{value} {unit}"
        image, truth = render_label(
            px_per_mm=PX_PER_MM,
            numeral_height_mm=height_mm,
            quantity_text=quantity_text,
            width_mm=110,
            height_mm=78,
            with_card=True,
            full_declarations=True,
        )

        image_path = images / f"{entry_id}.png"
        cv2.imwrite(str(image_path), image)

        entries.append(
            GroundTruthEntry(
                id=entry_id,
                image_path=str(image_path.relative_to(out)).replace("\\", "/"),
                category=category,
                declarations=Declarations(
                    manufacturer_name="ABC Foods Pvt Ltd",
                    manufacturer_address="123, Industrial Area, New Delhi 110001",
                    manufacturer_qualifier="manufactured by",
                    generic_name="Biscuits",
                    net_quantity_value=float(value),
                    net_quantity_unit=unit,
                    month_year="08/2026",
                    mrp_value=40.0,
                    mrp_wording="MRP Rs 40.00 incl. of all taxes",
                    consumer_care_phone="18001234567",
                    consumer_care_email="care@abcfoods.in",
                ),
                measurements=HandMeasurements(
                    numeral_height_mm=height_mm,
                    panel_area_cm2=round((110 * 78) / 100.0, 2),
                    measured_by="synthetic (rendered at a known scale)",
                    instrument="rendered ground truth, not a steel rule",
                ),
                reference_width_mm=truth["card_width_mm"],
                expected_violations=list(violations),
                notes="Synthetic. Replace with a photographed pack before citing any accuracy figure.",
            )
        )

    save(entries, out / "ground_truth.json")

    coverage = coverage_report(entries)
    print(f"Wrote {len(entries)} synthetic entries to {out / 'ground_truth.json'}")
    print(f"  by category: {coverage['by_category']}")
    for gap in coverage["gaps"]:
        print(f"  GAP: {gap}")
    print(
        "\nThis is a harness smoke test, not an accuracy table. Photograph real "
        "packages and measure them by hand before publishing any number."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
