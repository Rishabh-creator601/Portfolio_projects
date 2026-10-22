"""Client-facing extraction report.

Turns a Gemini extraction into a plain-language summary an officer or a client
can read, plus a completeness view of the six mandatory declarations.

This is deliberately **not** a compliance verdict. It reports what is present
and what is absent on the label. Whether an absence is a breach depends on the
product category and the exemptions that apply to it, which is the rule engine's
job -- and that engine is currently inactive. Saying "not found" is a fact about
the photograph; saying "non-compliant" would be a legal conclusion this path is
not entitled to draw.
"""

from __future__ import annotations

from typing import Any

# The six mandatory declarations under Rule 6, with the citation each carries.
DECLARATION_HEADS = [
    ("manufacturer_name", "Rule 6(1)(a)", "Manufacturer / packer / importer"),
    ("manufacturer_address", "Rule 6(1)(a)", "Complete address"),
    ("generic_name", "Rule 6(1)(b)", "Common or generic name"),
    ("net_quantity", "Rule 6(1)(c)", "Net quantity"),
    ("month_year", "Rule 6(1)(d)", "Month and year"),
    ("mrp", "Rule 6(1)(e)", "Retail sale price"),
    ("consumer_care", "Rule 6(2)", "Consumer care details"),
]

# FSSAI Labelling and Display Regulations 2020 -- a different statute, reported
# separately so it is never mistaken for a Legal Metrology finding.
FSSAI_HEADS = [
    ("nutrition", "Nutrition panel"),
    ("ingredients", "Ingredients list"),
    ("allergen_declaration", "Allergen declaration"),
    ("fssai_licence_number", "FSSAI licence number"),
    ("veg_nonveg_mark", "Veg / non-veg mark"),
]


def _value_for(data: dict[str, Any], key: str) -> tuple[str | None, Any]:
    """Return a display string and the raw value for one declaration head."""
    manufacturer = data.get("manufacturer") or {}
    quantity = data.get("net_quantity") or {}
    date = data.get("month_year") or {}
    mrp = data.get("mrp") or {}
    care = data.get("consumer_care") or {}

    if key == "manufacturer_name":
        name, qualifier = manufacturer.get("name"), manufacturer.get("qualifier")
        if not name:
            return None, None
        return (f"{qualifier}: {name}" if qualifier else name), name

    if key == "manufacturer_address":
        return manufacturer.get("address"), manufacturer.get("address")

    if key == "generic_name":
        return data.get("generic_name"), data.get("generic_name")

    if key == "net_quantity":
        if quantity.get("value") is None:
            return None, None
        rendered = f"{quantity['value']} {quantity.get('unit') or ''}".strip()
        return rendered, quantity

    if key == "month_year":
        return date.get("raw"), date

    if key == "mrp":
        if mrp.get("value") is None:
            return None, None
        currency = mrp.get("currency") or "Rs"
        return f"{currency} {mrp['value']}", mrp

    if key == "consumer_care":
        parts = [care.get("phone"), care.get("email")]
        present = [p for p in parts if p]
        return (" / ".join(present) if present else None), care

    return None, None


def build(data: dict[str, Any], *, image_hash: str | None = None) -> dict[str, Any]:
    """Assemble the client report from one extraction."""
    declarations = []
    found = 0

    for key, citation, label in DECLARATION_HEADS:
        display, raw = _value_for(data, key)
        is_present = bool(display)
        if is_present:
            found += 1

        declarations.append(
            {
                "key": key,
                "citation": citation,
                "label": label,
                "value": display,
                "raw": raw,
                "status": "found" if is_present else "not_found",
            }
        )

    fssai = []
    for key, label in FSSAI_HEADS:
        value = data.get(key)
        present = value not in (None, "", [], {}) and value != "not shown"
        fssai.append(
            {
                "key": key,
                "label": label,
                "value": value,
                "status": "found" if present else "not_found",
            }
        )

    nutrition = data.get("nutrition") or {}
    package = data.get("package") or {}
    detections = data.get("detections") or []
    meta = data.get("_meta") or {}

    completeness = round(found / len(DECLARATION_HEADS) * 100)

    return {
        "summary": {
            "product": data.get("generic_name") or "Unidentified product",
            "brand": data.get("brand_name"),
            "packageType": package.get("type"),
            "packageMaterial": package.get("material"),
            "declarationsFound": found,
            "declarationsTotal": len(DECLARATION_HEADS),
            "completenessPercent": completeness,
            "extractionConfidence": data.get("confidence"),
            "regionsDetected": len(detections),
            "imageHash": image_hash,
            "model": meta.get("model"),
            "processingTimeMs": meta.get("processing_time_ms"),
        },
        "declarations": declarations,
        "fssai": fssai,
        "nutrition": nutrition or None,
        "package": package,
        "detections": detections,
        "legibilityIssues": data.get("legibility_issues") or [],
        "notes": data.get("notes"),
        "disclaimer": (
            "This is an extraction report, not a compliance determination. It states "
            "what was read from the photograph and what could not be found. Whether a "
            "missing declaration is a breach depends on the product category and the "
            "exemptions that apply to it under the Legal Metrology (Packaged "
            "Commodities) Rules, 2011, which an officer must determine. Nutrition and "
            "ingredient particulars are governed by the FSSAI Labelling and Display "
            "Regulations, 2020, not by these Rules."
        ),
    }
