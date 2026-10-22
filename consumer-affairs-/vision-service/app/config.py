"""Tunable thresholds for the vision pipeline.

Every number here is a measurement threshold, not a statutory one. The statute
lives in the Node rule pack; this file only decides when the image is good
enough to measure and when a measurement is confident enough to assert.
"""

from __future__ import annotations

import os
from pathlib import Path

# Load .env before anything reads the environment.
#
# Without this the service starts perfectly happily with no API key and silently
# falls back to its defaults -- which is how an integration can look finished
# while only ever having worked from inline shell variables.
#
# The project root .env is the shared one (the same file the Node API reads);
# a vision-service/.env overrides it for local experiments. Real environment
# variables always win, so Docker and CI are unaffected.
try:
    from dotenv import load_dotenv

    _SERVICE_DIR = Path(__file__).resolve().parents[1]
    for _candidate in (_SERVICE_DIR.parent / ".env", _SERVICE_DIR / ".env"):
        if _candidate.is_file():
            load_dotenv(_candidate, override=False)
except ImportError:  # pragma: no cover - dotenv is optional at runtime
    pass


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


def _i(name: str, default: int) -> int:
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


class Settings:
    VERSION = "3.0.0"

    # --- Extraction mode ---------------------------------------------------
    # "gemini"  the model reads the label; the OCR engines and the millimetre
    #           measurement stages do not run. This is the active path.
    # "legacy"  the original OCR + Sauvola/connected-components pipeline.
    # "hybrid"  both, for comparing one against the other on the same capture.
    #
    # The legacy code is left intact and simply not called, so switching back is
    # a one-line environment change rather than a revert.
    EXTRACTION_MODE = os.environ.get("EXTRACTION_MODE", "gemini").lower()

    # Engine selection. PP-OCRv5 first per the build order: better on small
    # dense print, better multilingual coverage, faster on CPU. The benchmark
    # in benchmark/evaluate.py is what actually settles it.
    DEFAULT_ENGINE = os.environ.get("OCR_ENGINE", "paddleocr")
    ENGINE_FALLBACK_ORDER = ["paddleocr", "easyocr", "stub"]

    # --- Capture quality gates (no model required) ---
    # Variance of the Laplacian. Below this the crop cannot be measured.
    BLUR_THRESHOLD = _f("BLUR_THRESHOLD", 100.0)
    # Fraction of pixels that are specular highlight before glare is called.
    GLARE_RATIO_THRESHOLD = _f("GLARE_RATIO_THRESHOLD", 0.06)
    # A reflection is defined by how far it rises above its own surroundings,
    # not by absolute brightness -- a plain white label is bright everywhere and
    # is not glare. The floor only stops a bright patch in deep shadow counting.
    GLARE_VALUE_FLOOR = _i("GLARE_VALUE_FLOOR", 140)
    GLARE_SATURATION_MAX = _i("GLARE_SATURATION_MAX", 60)
    GLARE_LOCAL_EXCESS = _i("GLARE_LOCAL_EXCESS", 22)
    # A reflection is broad; printing is thin. Candidate regions narrower than
    # this fraction of the shortest edge are erased as text, not glare.
    GLARE_MIN_BLOB_RATIO = _f("GLARE_MIN_BLOB_RATIO", 0.06)
    # Glare is large-scale, so it is measured on a downsampled copy.
    GLARE_WORKING_EDGE_PX = _i("GLARE_WORKING_EDGE_PX", 256)
    MIN_RESOLUTION_PX = _i("MIN_RESOLUTION_PX", 640)

    # --- Glyph measurement ---
    # The crop is upscaled before binarisation so thin strokes survive.
    GLYPH_UPSCALE = _i("GLYPH_UPSCALE", 4)
    # Sauvola window must be odd and comfortably larger than a stroke.
    SAUVOLA_WINDOW = _i("SAUVOLA_WINDOW", 25)
    SAUVOLA_K = _f("SAUVOLA_K", 0.2)
    # Connected components outside these bounds are noise or merged blobs.
    MIN_GLYPH_AREA_PX = _i("MIN_GLYPH_AREA_PX", 12)
    MIN_GLYPH_HEIGHT_RATIO = _f("MIN_GLYPH_HEIGHT_RATIO", 0.25)
    MAX_GLYPH_HEIGHT_RATIO = _f("MAX_GLYPH_HEIGHT_RATIO", 1.05)
    # A digit is taller than it is wide; this rejects dashes and full stops.
    MAX_GLYPH_ASPECT = _f("MAX_GLYPH_ASPECT", 1.6)
    MIN_GLYPHS_FOR_MEDIAN = _i("MIN_GLYPHS_FOR_MEDIAN", 2)

    # --- Contrast (Rule 9(1)(b)) ---
    # WCAG AA large-text ratio; the Rules say "contrasts conspicuously" without
    # a number, so this is the defensible published threshold to cite.
    CONTRAST_AA_RATIO = _f("CONTRAST_AA_RATIO", 3.0)
    CONTRAST_RING_DILATION_PX = _i("CONTRAST_RING_DILATION_PX", 6)

    # --- Calibration ---
    # Below this the reference card is too small in frame to trust.
    MIN_REFERENCE_WIDTH_PX = _i("MIN_REFERENCE_WIDTH_PX", 60)
    # A measurement within this fraction of the threshold is "too close to call"
    # and is downgraded to MEDIUM so an officer looks at it.
    MEASUREMENT_MARGIN = _f("MEASUREMENT_MARGIN", 0.15)

    # --- VLM tagging (build order step 3, optional) ---
    #
    # Keys are read from the environment only. Never hard-code one here: this
    # file is committed, and a key in git history stays there after it is
    # deleted. Put it in .env, which .gitignore already covers.
    VLM_ENABLED = os.environ.get("VLM_ENABLED", "false").lower() == "true"
    VLM_PROVIDER = os.environ.get("VLM_PROVIDER", "anthropic").lower()
    VLM_TIMEOUT_S = _f("VLM_TIMEOUT_S", 60.0)
    # Gemini 2.5 reasons before answering, which roughly trebles latency on a
    # transcription task that needs no reasoning. 0 disables it; raise it only
    # if extraction quality on hard packs actually calls for it.
    GEMINI_THINKING_BUDGET = _i("GEMINI_THINKING_BUDGET", 0)
    # Gemini returns 503 when the model is overloaded and 429 on rate limits.
    # Both are "not now", not "never", so they are retried with backoff rather
    # than costing an officer the capture they are standing in a shop to take.
    GEMINI_MAX_ATTEMPTS = _i("GEMINI_MAX_ATTEMPTS", 4)
    GEMINI_RETRY_BASE_S = _f("GEMINI_RETRY_BASE_S", 1.5)

    # Default model per provider, overridable with VLM_MODEL.
    _DEFAULT_MODELS = {
        "anthropic": "claude-sonnet-5",
        "google": "gemini-2.5-flash",
        "openai": "gpt-4o",
    }
    VLM_MODEL = os.environ.get("VLM_MODEL") or _DEFAULT_MODELS.get(
        os.environ.get("VLM_PROVIDER", "anthropic").lower(), "claude-sonnet-5"
    )

    # A generic VLM_API_KEY wins; otherwise fall back to the provider's own
    # conventional variable, so an existing environment keeps working.
    VLM_API_KEY = (
        os.environ.get("VLM_API_KEY")
        or os.environ.get("ANTHROPIC_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    )

    # Backup keys, tried in order when the primary cannot be used: revoked,
    # expired, out of quota. A key that is merely busy is retried rather than
    # abandoned -- see GEMINI_MAX_ATTEMPTS -- because rotating on a transient
    # would burn the spare for no reason.
    #
    # VLM_API_KEY_2 and VLM_API_KEY_3 are the named slots; VLM_API_KEYS takes a
    # comma-separated list for anyone who wants more.
    VLM_API_KEYS = [
        key
        for key in [
            VLM_API_KEY,
            os.environ.get("VLM_API_KEY_2", ""),
            os.environ.get("VLM_API_KEY_3", ""),
            *[k.strip() for k in os.environ.get("VLM_API_KEYS", "").split(",")],
        ]
        if key and key.strip()
    ]

    # When every key is exhausted, fall back to reading the label with the local
    # OCR engine instead of failing the capture outright. The reading is worse
    # and is flagged as such, but an officer standing in a shop still gets
    # something rather than nothing.
    EXTRACTION_FALLBACK_ENGINE = os.environ.get("EXTRACTION_FALLBACK_ENGINE", "easyocr")
    EXTRACTION_FALLBACK_ENABLED = (
        os.environ.get("EXTRACTION_FALLBACK_ENABLED", "true").lower() == "true"
    )


settings = Settings()
