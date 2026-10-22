"""Response schemas for Gemini label extraction and object detection.

Every field is nullable. "Not on the pack" is a legitimate and important answer
in an enforcement context, and a guessed value is far worse than a null.

Bounding boxes follow Gemini's convention: ``box_2d`` is
``[ymin, xmin, ymax, xmax]`` normalised to 0-1000 against the image, which the
service converts to pixels before returning.
"""

from __future__ import annotations

from typing import Any

# Regions worth locating on a package. The label and nutrition panel matter
# most: they are what an officer wants to zoom into as evidence.
DETECTABLE_REGIONS = [
    "product",
    "principal_display_panel",
    "label",
    "nutrition_panel",
    "ingredients_list",
    "net_quantity_declaration",
    "mrp_declaration",
    "manufacturer_block",
    "consumer_care_block",
    "date_marking",
    "barcode",
    "fssai_logo",
    "veg_nonveg_mark",
]

_BOX = {
    "type": "array",
    "description": "Bounding box as [ymin, xmin, ymax, xmax], normalised 0-1000.",
    "items": {"type": "integer"},
    "minItems": 4,
    "maxItems": 4,
}

_TEXT = {"type": ["string", "null"]}
_NUM = {"type": ["number", "null"]}

EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        # --- object detection -------------------------------------------------
        "detections": {
            "type": "array",
            "description": "Every region located on the image, with its box.",
            "items": {
                "type": "object",
                "properties": {
                    "region": {"type": "string", "enum": DETECTABLE_REGIONS},
                    "box_2d": _BOX,
                    "confidence": {"type": "number"},
                    "text": {
                        "type": ["string", "null"],
                        "description": "Text inside this region, verbatim.",
                    },
                },
                "required": ["region", "box_2d"],
            },
        },
        # --- the package itself ----------------------------------------------
        "package": {
            "type": "object",
            "properties": {
                "type": {
                    "type": ["string", "null"],
                    "enum": [
                        "bottle", "can", "pouch", "sachet", "carton", "box",
                        "jar", "tube", "tub", "bag", "wrapper", "blister", None,
                    ],
                },
                "material": {
                    "type": ["string", "null"],
                    "enum": ["plastic", "glass", "metal", "paper", "foil", "composite", None],
                },
                "is_curved_surface": {"type": ["boolean", "null"]},
                "is_blown_or_moulded": {"type": ["boolean", "null"]},
                "label_is_light_text_on_dark": {"type": ["boolean", "null"]},
                "dominant_colours": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["type", "is_curved_surface"],
        },
        # --- the six mandatory declarations, Rule 6 ---------------------------
        "manufacturer": {
            "type": "object",
            "properties": {
                "name": _TEXT,
                "address": _TEXT,
                "qualifier": {
                    "type": ["string", "null"],
                    "description": (
                        "The attribution printed before the name: 'manufactured by', "
                        "'packed by', 'imported by', 'marketed by', or null. Explanation I "
                        "to Rule 6: an unqualified name is presumed the manufacturer's. "
                        "Explanation II: a brand owner shown as marketer is liable as "
                        "deemed manufacturer."
                    ),
                },
                "is_first_named": {"type": ["boolean", "null"]},
                "all_names_in_printed_order": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["name", "address", "qualifier"],
        },
        "generic_name": {
            "type": ["string", "null"],
            "description": (
                "Rule 6(1)(b): what the commodity generically IS - 'Biscuits', "
                "'Carbonated Water', 'Toilet Soap'. NOT the brand, NOT a marketing line."
            ),
        },
        "brand_name": _TEXT,
        "net_quantity": {
            "type": "object",
            "properties": {
                "value": _NUM,
                "unit": {
                    "type": ["string", "null"],
                    "description": "Standard unit as printed: g, kg, ml, L, N, cm, m.",
                },
                "raw": _TEXT,
                "has_when_packed_qualifier": {"type": ["boolean", "null"]},
            },
            "required": ["value", "unit", "raw"],
        },
        "month_year": {
            "type": "object",
            "properties": {
                "month": _TEXT,
                "year": _TEXT,
                "raw": _TEXT,
                "kind": {
                    "type": ["string", "null"],
                    "enum": ["manufacture", "packing", "import", "expiry", "best_before", None],
                },
            },
            "required": ["raw"],
        },
        "mrp": {
            "type": "object",
            "properties": {
                "value": _NUM,
                "currency": _TEXT,
                "raw": _TEXT,
                "states_inclusive_of_all_taxes": {"type": ["boolean", "null"]},
            },
            "required": ["value", "raw"],
        },
        "consumer_care": {
            "type": "object",
            "properties": {
                "name": _TEXT,
                "address": _TEXT,
                "phone": _TEXT,
                "email": _TEXT,
            },
        },
        # --- FSSAI territory, extracted but never mixed into a PCR verdict ----
        "nutrition": {
            "type": ["object", "null"],
            "description": (
                "The nutrition panel. FSSAI Labelling and Display Regulations 2020, "
                "NOT Legal Metrology. Keep the per-100 and per-serve columns distinct."
            ),
            "properties": {
                "basis": _TEXT,
                "serving_size": _TEXT,
                "servings_per_pack": _TEXT,
                "energy_kcal": _NUM,
                "protein_g": _NUM,
                "carbohydrate_g": _NUM,
                "total_sugars_g": _NUM,
                "added_sugars_g": _NUM,
                "total_fat_g": _NUM,
                "saturated_fat_g": _NUM,
                "trans_fat_g": _NUM,
                "cholesterol_mg": _NUM,
                "sodium_mg": _NUM,
                "per_serve": {
                    "type": ["object", "null"],
                    "description": "The per-serve column, where printed alongside per-100.",
                    "properties": {
                        "energy_kcal": _NUM,
                        "protein_g": _NUM,
                        "carbohydrate_g": _NUM,
                        "total_sugars_g": _NUM,
                        "total_fat_g": _NUM,
                        "sodium_mg": _NUM,
                    },
                },
            },
        },
        "ingredients": _TEXT,
        "allergen_declaration": _TEXT,
        "fssai_licence_number": _TEXT,
        "veg_nonveg_mark": {
            "type": ["string", "null"],
            "enum": ["veg", "non-veg", "not shown", None],
        },
        "country_of_origin": _TEXT,
        "batch_number": _TEXT,
        # Rule 9(4): declarations must be in Hindi in Devanagari script or in
        # English. Asked for directly because the script a human sees is more
        # reliable than inferring it from transcribed characters.
        "scripts_present": {
            "type": "array",
            "description": (
                "Which scripts the declarations are printed in. Rule 9(4) permits "
                "Devanagari (Hindi) or Latin (English); any further language is allowed "
                "alongside."
            ),
            "items": {"type": "string", "enum": ["Devanagari", "Latin", "Tamil", "Telugu",
                                                  "Bengali", "Gujarati", "Kannada",
                                                  "Malayalam", "Odia", "Gurmukhi", "Other"]},
        },
        # Rule 6(3): no sticker may alter or make a mandatory declaration. The
        # single exception is a sticker showing a *reduced* MRP that does not
        # cover the original price.
        "sticker_over_declaration": {
            "type": ["object", "null"],
            "properties": {
                "present": {"type": ["boolean", "null"]},
                "covers_declaration": {"type": ["string", "null"]},
                "appears_to_reduce_price": {"type": ["boolean", "null"]},
                "original_price_still_visible": {"type": ["boolean", "null"]},
            },
        },
        "other_text": {
            "type": "array",
            "description": "Any further printed text not captured above.",
            "items": {"type": "string"},
        },
        # --- self-assessment --------------------------------------------------
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "legibility_issues": {
            "type": "array",
            "description": "What was obscured, blurred, cut off or unreadable.",
            "items": {"type": "string"},
        },
        "notes": _TEXT,
    },
    "required": [
        "detections",
        "package",
        "manufacturer",
        "generic_name",
        "net_quantity",
        "mrp",
        "confidence",
    ],
}

EXTRACTION_PROMPT = """You are reading a photograph of an Indian pre-packaged commodity \
for a Legal Metrology (Packaged Commodities) Rules, 2011 inspection.

Do two things.

**A. Locate regions.** For every region you can see, return a bounding box as \
box_2d [ymin, xmin, ymax, xmax] normalised 0-1000. Include the product itself, the \
principal display panel, and whichever of these are visible: nutrition panel, \
ingredients list, net quantity declaration, MRP declaration, manufacturer block, \
consumer care block, date marking, barcode, FSSAI logo, veg/non-veg mark.

**B. Transcribe the label.** Extract:

- The manufacturer / packer / importer block: name, complete address, and the \
qualifier printed before the name ("manufactured by", "packed by", "imported by", \
"marketed by"). The qualifier carries legal weight: an unqualified name is presumed \
to be the manufacturer's, and a brand owner shown as marketer is liable as deemed \
manufacturer. If several names appear, list them in printed order - prosecution \
follows the first named.
- The common or generic name: what the product generically IS, not the brand. \
Record the brand separately.
- Net quantity: value and unit exactly as printed.
- Month and year, and whether it is manufacture, packing, import, expiry or best-before.
- Retail sale price, and whether it states "inclusive of all taxes".
- Consumer care: name, address, phone, e-mail.
- The nutrition panel, ingredients, allergens, FSSAI licence number, veg/non-veg \
mark, country of origin and batch number, where visible.
- The package itself: container type, material, whether the surface carrying the \
declaration is curved, and whether the declaration is moulded or embossed rather \
than printed.

Rules for your answer:
- Transcribe exactly what is printed. Do not correct spelling, expand abbreviations, \
convert units or infer missing values.
- If something is not legible or not present, return null. **Never guess a number.**
- List anything obscured, cut off or unreadable in legibility_issues.
- Do not comment on compliance. You are reading the label, not judging it.

Return JSON matching the schema and nothing else.
"""
