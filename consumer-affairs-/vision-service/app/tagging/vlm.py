"""VLM extraction for what regex and geometry cannot read -- build order step 3.

Four of the six declaration heads are statutorily patterned, so regex plus a
fuzzy match gets most of the way, and that tagger lives in the Node extraction
service. What comes here is what pattern matching genuinely cannot do:

  * the manufacturer block, including the 'manufactured by' / 'packed by' /
    'imported by' attribution that Explanations I and II to Rule 6 turn on --
    reading comprehension, not pattern matching;
  * the common or generic name, which has to be told apart from the brand;
  * the package itself -- what kind of container it is, which sets the curved
    and blown/moulded flags that otherwise rely on an officer remembering to
    tick a box, and which change Rule 7(2) heights and Rule 9(1)(b) contrast;
  * the nutrition panel, which is a *table*. Note that nutrition is FSSAI
    Labelling and Display Regulations 2020, **not** PCR 2011 -- it is extracted
    here for completeness and must be evaluated by a separate FSSAI rule pack,
    never mixed into a Legal Metrology verdict.

Deliberately **not** done: fine-tuning LayoutLMv3 or LiLT. That is the textbook
answer and the wrong one at this stage -- it needs several hundred hand-labelled
packages before it beats regex.

The boundary that matters: this module only ever *extracts*. Once fields are
extracted and confirmed, the rule engine is pure functions over JSON. That
boundary is what makes a verdict defensible.

No key is ever hard-coded. Keys come from the environment; see app/config.py.
"""

from __future__ import annotations

import base64
import json
from typing import Any

from ..config import settings

SUPPORTED_PROVIDERS = ("anthropic", "google", "openai")

# Every field is nullable: "not on the pack" is a legitimate and important
# answer, and inventing a value would be far worse than returning nothing.
EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "manufacturer": {
            "type": "object",
            "properties": {
                "name": {"type": ["string", "null"]},
                "address": {"type": ["string", "null"]},
                "qualifier": {
                    "type": ["string", "null"],
                    "description": (
                        "The attribution printed before the name: 'manufactured by', "
                        "'packed by', 'imported by', 'marketed by', or null if none. "
                        "Explanation I to Rule 6: a name with no qualifier is presumed "
                        "to be the manufacturer's. Explanation II: a brand owner shown "
                        "as marketer is liable as deemed manufacturer."
                    ),
                },
                "is_first_named": {
                    "type": ["boolean", "null"],
                    "description": (
                        "True when this is the first name on the panel. Where several "
                        "names appear, prosecution is launched against the one named first."
                    ),
                },
            },
            "required": ["name", "address", "qualifier"],
        },
        "generic_name": {
            "type": ["string", "null"],
            "description": (
                "Rule 6(1)(b): the common or generic name of the commodity, e.g. "
                "'Biscuits', 'Carbonated Water', 'Toilet Soap'. NOT the brand name "
                "and NOT a marketing descriptor."
            ),
        },
        "brand_name": {
            "type": ["string", "null"],
            "description": "Recorded separately so it is never mistaken for the generic name.",
        },
        "package": {
            "type": "object",
            "description": "The container itself. Drives Rule 7(2) and Rule 9(1)(b).",
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
                "is_curved_surface": {
                    "type": ["boolean", "null"],
                    "description": (
                        "True for bottles, cans, tubes and filled pouches. On a curved "
                        "label the millimetre scale varies across the surface, so every "
                        "measurement that depends on it must be routed to review."
                    ),
                },
                "is_blown_or_moulded": {
                    "type": ["boolean", "null"],
                    "description": (
                        "True where the declaration is blown, formed, moulded, embossed "
                        "or perforated into the container rather than printed. Rule 7(2) "
                        "doubles every minimum height; Rule 9(1)(b) contrast stops applying."
                    ),
                },
                "label_is_light_text_on_dark": {
                    "type": ["boolean", "null"],
                    "description": "True for white-on-red packs such as a cola label.",
                },
            },
            "required": ["type", "is_curved_surface", "is_blown_or_moulded"],
        },
        "nutrition": {
            "type": ["object", "null"],
            "description": (
                "The nutrition panel, if one is visible. FSSAI Labelling and Display "
                "Regulations 2020 -- NOT Legal Metrology. Transcribe both the per-100 "
                "column and the per-serve column where both are printed."
            ),
            "properties": {
                "basis": {
                    "type": ["string", "null"],
                    "description": "e.g. 'per 100 ml', 'per 100 g', 'per 250 ml serve'",
                },
                "serving_size": {"type": ["string", "null"]},
                "energy_kcal": {"type": ["number", "null"]},
                "protein_g": {"type": ["number", "null"]},
                "carbohydrate_g": {"type": ["number", "null"]},
                "total_sugars_g": {"type": ["number", "null"]},
                "added_sugars_g": {"type": ["number", "null"]},
                "total_fat_g": {"type": ["number", "null"]},
                "saturated_fat_g": {"type": ["number", "null"]},
                "trans_fat_g": {"type": ["number", "null"]},
                "cholesterol_mg": {"type": ["number", "null"]},
                "sodium_mg": {"type": ["number", "null"]},
            },
        },
        "ingredients": {
            "type": ["string", "null"],
            "description": "The ingredients list as printed, if visible.",
        },
        "fssai_licence_number": {
            "type": ["string", "null"],
            "description": "The 14-digit FSSAI licence number, if printed.",
        },
        "veg_nonveg_mark": {
            "type": ["string", "null"],
            "enum": ["veg", "non-veg", "not shown", None],
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "notes": {
            "type": ["string", "null"],
            "description": "Anything illegible, obscured or ambiguous.",
        },
    },
    "required": ["manufacturer", "generic_name", "package", "confidence"],
}

PROMPT = """You are reading the label of an Indian pre-packaged commodity to support a \
Legal Metrology (Packaged Commodities) Rules, 2011 inspection.

Extract:

1. The manufacturer / packer / importer block under Rule 6(1)(a) - name, complete \
address, and the qualifier printed before the name ("manufactured by", "packed by", \
"imported by", "marketed by"). The qualifier matters legally: under Explanation I to \
Rule 6 a name with no qualifier is presumed to be the manufacturer's, and under \
Explanation II a brand owner shown as marketer is liable as deemed manufacturer. Where \
several names appear, say which is printed first - prosecution is launched against that one.

2. The common or generic name under Rule 6(1)(b) - what the product generically IS \
("Biscuits", "Carbonated Water", "Toilet Soap"), not the brand and not a marketing line. \
Record the brand separately.

3. The package itself - container type and material, whether the surface carrying the \
declaration is curved, and whether the declaration is moulded or embossed into the \
container rather than printed. These change which measurements are valid.

4. The nutrition panel and ingredients, if visible. Transcribe the numbers exactly as \
printed, keeping the per-100 and per-serve columns distinct.

Rules for your answer:
- Transcribe what is printed. Do not correct, expand, convert or infer.
- If something is not legible or not present, return null. Never guess a number.
- Do not comment on compliance. You are reading the label, not judging it.

Return JSON matching the schema and nothing else.

OCR tokens already read from this image, as a hint (they may contain errors):
{tokens}
"""


class VLMUnavailable(RuntimeError):
    """Raised when tagging is requested but no usable provider is configured."""


def is_configured() -> bool:
    return bool(
        settings.VLM_ENABLED
        and settings.VLM_API_KEY
        and settings.VLM_PROVIDER in SUPPORTED_PROVIDERS
    )


def status() -> dict[str, Any]:
    return {
        "enabled": settings.VLM_ENABLED,
        "configured": is_configured(),
        "provider": settings.VLM_PROVIDER,
        "supported_providers": list(SUPPORTED_PROVIDERS),
        "model": settings.VLM_MODEL if is_configured() else None,
        "key_present": bool(settings.VLM_API_KEY),
        "extracts": ["manufacturer", "generic_name", "package", "nutrition", "ingredients"],
        "detail": (
            "Regex handles MRP, net quantity, month/year and consumer care. Only the "
            "unstructured heads, the package type and the nutrition table come here. "
            "Nutrition is FSSAI, not Legal Metrology, and is evaluated separately."
        ),
    }


# --- provider adapters -------------------------------------------------------


def _call_anthropic(image_b64: str, media_type: str, prompt: str) -> dict[str, Any]:
    import anthropic

    client = anthropic.Anthropic(api_key=settings.VLM_API_KEY, timeout=settings.VLM_TIMEOUT_S)
    message = client.messages.create(
        model=settings.VLM_MODEL,
        max_tokens=2048,
        tools=[
            {
                "name": "record_label",
                "description": "Record what is printed on the label.",
                "input_schema": EXTRACTION_SCHEMA,
            }
        ],
        tool_choice={"type": "tool", "name": "record_label"},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": image_b64},
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )

    for block in message.content:
        if getattr(block, "type", None) == "tool_use":
            return dict(block.input)

    raise VLMUnavailable("Model returned no structured extraction.")


def _call_google(image_b64: str, media_type: str, prompt: str) -> dict[str, Any]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=settings.VLM_API_KEY)
    response = client.models.generate_content(
        model=settings.VLM_MODEL,
        contents=[
            types.Part.from_bytes(data=base64.b64decode(image_b64), mime_type=media_type),
            prompt,
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=EXTRACTION_SCHEMA,
        ),
    )

    return json.loads(response.text)


def _call_openai(image_b64: str, media_type: str, prompt: str) -> dict[str, Any]:
    from openai import OpenAI

    client = OpenAI(api_key=settings.VLM_API_KEY, timeout=settings.VLM_TIMEOUT_S)
    response = client.chat.completions.create(
        model=settings.VLM_MODEL,
        max_tokens=2048,
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "label", "schema": EXTRACTION_SCHEMA, "strict": False},
        },
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type};base64,{image_b64}"},
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )

    return json.loads(response.choices[0].message.content)


_ADAPTERS = {
    "anthropic": _call_anthropic,
    "google": _call_google,
    "openai": _call_openai,
}


def tag(image_bytes: bytes, ocr_tokens: list[str], media_type: str = "image/jpeg") -> dict[str, Any]:
    """Extract the unstructured heads, the package type and the nutrition panel.

    Raises VLMUnavailable when unconfigured, so the caller falls back to the
    regex tagger and routes those heads to officer review rather than failing
    the whole inspection.
    """
    if not settings.VLM_ENABLED:
        raise VLMUnavailable(
            "VLM tagging is switched off. Set VLM_ENABLED=true in .env to turn it on."
        )

    if settings.VLM_PROVIDER not in SUPPORTED_PROVIDERS:
        raise VLMUnavailable(
            f"Unsupported VLM_PROVIDER '{settings.VLM_PROVIDER}'. "
            f"Choose one of: {', '.join(SUPPORTED_PROVIDERS)}."
        )

    if not settings.VLM_API_KEY:
        raise VLMUnavailable(
            "No API key found. Put it in .env as VLM_API_KEY (never in source, and "
            "never committed). Leave it unset and the unstructured heads route to "
            "officer review instead."
        )

    prompt = PROMPT.format(tokens=json.dumps(ocr_tokens[:80]))
    image_b64 = base64.b64encode(image_bytes).decode("ascii")

    try:
        return _ADAPTERS[settings.VLM_PROVIDER](image_b64, media_type, prompt)
    except ImportError as exc:
        package = {
            "anthropic": "anthropic",
            "google": "google-genai",
            "openai": "openai",
        }[settings.VLM_PROVIDER]
        raise VLMUnavailable(
            f"The {settings.VLM_PROVIDER} SDK is not installed. Run: pip install {package}"
        ) from exc
