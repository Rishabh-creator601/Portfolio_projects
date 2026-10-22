"""Ground-truth set -- build order step 2.

"~150 packages. Build this BEFORE the models. Not after. It is what tells you
whether any of the rest works, and it is the accuracy table currently missing
from the solution document."

Spread across food / cosmetics / detergent / bidi so the category exemption
paths are covered. For each package record the six declaration heads as a human
reads them, plus hand-measured numeral heights in mm for a subset.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

# The category spread that has to be covered, because each one takes a different
# path through the exemption logic.
REQUIRED_CATEGORIES = {
    "food": "Rule 6(1)(d) date marking governed by FSSAI instead",
    "cosmetics": "Drugs and Cosmetics Rules 1945 override; Fourth Schedule unit",
    "detergent": "Baseline path with no override - the control group",
    "bidi": "Exempt from both date marking and MRP",
}

TARGET_SIZE = 150
MEASURED_SUBSET_TARGET = 40


@dataclass
class Declarations:
    """The six heads, exactly as a human reads them off the pack."""

    manufacturer_name: str | None = None
    manufacturer_address: str | None = None
    manufacturer_qualifier: str | None = None
    generic_name: str | None = None
    net_quantity_value: float | None = None
    net_quantity_unit: str | None = None
    month_year: str | None = None
    mrp_value: float | None = None
    mrp_wording: str | None = None
    consumer_care_name: str | None = None
    consumer_care_address: str | None = None
    consumer_care_phone: str | None = None
    consumer_care_email: str | None = None


@dataclass
class HandMeasurements:
    """Measured with a scale, not read off a screen. The subset that anchors Rule 7."""

    numeral_height_mm: float | None = None
    letter_height_mm: float | None = None
    letter_width_mm: float | None = None
    clear_space_above_mm: float | None = None
    clear_space_below_mm: float | None = None
    clear_space_left_mm: float | None = None
    clear_space_right_mm: float | None = None
    panel_area_cm2: float | None = None
    measured_by: str | None = None
    instrument: str = "steel rule, 0.5 mm graduations"


@dataclass
class GroundTruthEntry:
    id: str
    image_path: str
    category: str
    declarations: Declarations = field(default_factory=Declarations)
    measurements: HandMeasurements | None = None
    reference_width_mm: float | None = None
    is_curved_surface: bool = False
    is_blown_or_moulded: bool = False
    # Rule ids a human determined this pack actually breaches. This is the
    # answer key the per-rule precision and recall are scored against.
    expected_violations: list[str] = field(default_factory=list)
    notes: str = ""

    @property
    def has_measurements(self) -> bool:
        return self.measurements is not None and self.measurements.numeral_height_mm is not None


def load(path: str | Path) -> list[GroundTruthEntry]:
    """Load the set from JSON, tolerating entries that are still being filled in."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))

    entries: list[GroundTruthEntry] = []
    for item in raw:
        measurements = item.get("measurements")
        entries.append(
            GroundTruthEntry(
                id=item["id"],
                image_path=item["image_path"],
                category=item["category"],
                declarations=Declarations(**item.get("declarations", {})),
                measurements=HandMeasurements(**measurements) if measurements else None,
                reference_width_mm=item.get("reference_width_mm"),
                is_curved_surface=item.get("is_curved_surface", False),
                is_blown_or_moulded=item.get("is_blown_or_moulded", False),
                expected_violations=item.get("expected_violations", []),
                notes=item.get("notes", ""),
            )
        )
    return entries


def save(entries: list[GroundTruthEntry], path: str | Path) -> None:
    payload = []
    for entry in entries:
        item = asdict(entry)
        if entry.measurements is None:
            item.pop("measurements", None)
        payload.append(item)

    Path(path).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def coverage_report(entries: list[GroundTruthEntry]) -> dict:
    """How far the set is from being usable, and what is still missing.

    The set is the instrument. Reporting accuracy against a set that does not
    yet cover the exemption paths would be worse than reporting no accuracy.
    """
    by_category: dict[str, int] = {}
    for entry in entries:
        by_category[entry.category] = by_category.get(entry.category, 0) + 1

    measured = sum(1 for e in entries if e.has_measurements)
    missing_categories = [c for c in REQUIRED_CATEGORIES if by_category.get(c, 0) == 0]

    gaps: list[str] = []
    if len(entries) < TARGET_SIZE:
        gaps.append(f"{len(entries)}/{TARGET_SIZE} packages captured")
    if measured < MEASURED_SUBSET_TARGET:
        gaps.append(f"{measured}/{MEASURED_SUBSET_TARGET} hand-measured for Rule 7")
    for category in missing_categories:
        gaps.append(f"no '{category}' packages -- {REQUIRED_CATEGORIES[category]}")

    return {
        "total": len(entries),
        "target": TARGET_SIZE,
        "by_category": by_category,
        "hand_measured": measured,
        "hand_measured_target": MEASURED_SUBSET_TARGET,
        "missing_categories": missing_categories,
        "gaps": gaps,
        "usable": not gaps,
    }
