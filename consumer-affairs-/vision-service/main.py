"""LM-Verify vision service.

One OCR contract with interchangeable engines, plus the classical-CV measurement
stages Rules 7, 8 and 9 need. Everything here is on the *extraction* side of the
line: it reads and measures, and never decides compliance. Verdicts come from
the deterministic rule pack in the Node service, which is what makes a finding
reproducible and defensible.
"""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app import pipeline
from app.config import settings
from app.engines import get_engine, list_engines
from app.gemini import extractor as gemini_extractor
from app.gemini import report as gemini_report
from app.schemas import AnalyzeRequest, AnalyzeResponse, HealthResponse, OcrResponse
from app.tagging import vlm

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("lm-verify.vision")

app = FastAPI(
    title="LM-Verify Vision Service",
    version=settings.VERSION,
    description=(
        "OCR and measurement sidecar for Legal Metrology (Packaged Commodities) "
        "Rules, 2011 compliance checking."
    ),
)

# The Node API is the only intended caller; it is reached server-to-server, so
# this is permissive only for local development convenience.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png"}


async def _read_upload(file: UploadFile) -> bytes:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported type {file.content_type}. Send image/jpeg or image/png.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 25 MB limit.")
    return data


def _analyze_request(
    panel: str = Form("principal"),
    reference_width_mm: float | None = Form(None),
    reference_kind: str = Form("reference_card"),
    is_curved_surface: bool = Form(False),
    is_blown_or_moulded: bool = Form(False),
    languages: str = Form("en"),
    engine: str | None = Form(None),
) -> AnalyzeRequest:
    return AnalyzeRequest(
        panel=panel,
        reference_width_mm=reference_width_mm,
        reference_kind=reference_kind,
        is_curved_surface=is_curved_surface,
        is_blown_or_moulded=is_blown_or_moulded,
        languages=[lang.strip() for lang in languages.split(",") if lang.strip()] or ["en"],
        engine=engine,
    )


@app.post("/ocr", response_model=OcrResponse)
async def ocr(
    file: UploadFile = File(...),
    languages: str = Form("en"),
    engine: str | None = Form(None),
):
    """The single OCR contract: tokens of {text, box, confidence}.

    PaddleOCR and EasyOCR both implement this, so which one is running is an
    operational choice rather than an architectural one.
    """
    import time

    data = await _read_upload(file)
    langs = [lang.strip() for lang in languages.split(",") if lang.strip()] or ["en"]

    started = time.perf_counter()
    try:
        image = pipeline.decode_image(data)
        selected = get_engine(engine)
        tokens = selected.read(image, langs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - engine runtime failures
        logger.exception("OCR failed")
        raise HTTPException(status_code=500, detail=f"OCR failed: {exc}") from exc

    return OcrResponse(
        tokens=tokens,
        engine=selected.name,
        languages=langs,
        processing_time_ms=int((time.perf_counter() - started) * 1000),
    )


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    file: UploadFile = File(...),
    request: AnalyzeRequest = Depends(_analyze_request),
):
    """Full pipeline: quality gate, rectify, calibrate, read, measure.

    Returns measurements and confidence bands only. It states what the numeral
    height is; whether that height complies with Rule 7(2) is the rule engine's
    call, not this service's.
    """
    data = await _read_upload(file)

    try:
        return pipeline.analyze(data, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - pipeline runtime failures
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}") from exc


@app.post("/extract")
async def extract(
    file: UploadFile = File(...),
    build_report: bool = Form(True),
    model: str | None = Form(None),
):
    """Gemini label extraction and object detection -- the active path.

    Returns the transcribed declarations, the located regions with pixel boxes,
    the nutrition panel, and a client report. The OCR engines and the millimetre
    measurement stages are not run: when EXTRACTION_MODE is "gemini" they are
    inactive by design, and the legacy pipeline remains available at /analyze.
    """
    data = await _read_upload(file)

    try:
        import cv2
        import numpy as np

        decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        size = (decoded.shape[1], decoded.shape[0]) if decoded is not None else None

        result = gemini_extractor.extract(
            data, file.content_type or "image/jpeg", image_size=size, model=model
        )
    except gemini_extractor.GeminiUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - provider runtime failures
        logger.exception("Gemini extraction failed")
        raise HTTPException(status_code=502, detail=f"Extraction failed: {exc}") from exc

    payload: dict = {
        "extraction": result,
        "declarations": gemini_extractor.to_declaration_heads(result),
        "imageHash": pipeline.image_hash(data),
        "mode": settings.EXTRACTION_MODE,
    }

    if build_report:
        payload["report"] = gemini_report.build(result, image_hash=payload["imageHash"])

    return {"success": True, "data": payload}


@app.post("/tag")
async def tag(file: UploadFile = File(...), tokens: str = Form("")):
    """VLM pass over the two unstructured heads (build order step 3).

    Returns 503 with an explanation when no provider is configured, so the
    caller falls back to the regex tagger and routes those heads to review
    rather than failing the inspection.
    """
    data = await _read_upload(file)
    token_list = [t for t in (tokens or "").split("\n") if t.strip()]

    try:
        return {"success": True, "data": vlm.tag(data, token_list, file.content_type or "image/jpeg")}
    except vlm.VLMUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - provider runtime failures
        logger.exception("VLM tagging failed")
        raise HTTPException(status_code=502, detail=f"VLM tagging failed: {exc}") from exc


@app.get("/engines")
def engines():
    """Which engines are installed, and why any are not."""
    return {"engines": [e.model_dump() for e in list_engines()], "default": settings.DEFAULT_ENGINE}


@app.get("/health", response_model=HealthResponse)
def health():
    available = [e for e in list_engines() if e.available]
    real_engine_present = any(e.name != "stub" for e in available)

    return HealthResponse(
        status="healthy" if real_engine_present else "degraded",
        version=settings.VERSION,
        engines=list_engines(),
        capabilities={
            "extraction_mode": settings.EXTRACTION_MODE,
            "gemini_extraction": {
                "active": settings.EXTRACTION_MODE in ("gemini", "hybrid"),
                "configured": gemini_extractor.is_configured(),
                "model": settings.VLM_MODEL,
            },
            "legacy_pipeline_active": settings.EXTRACTION_MODE in ("legacy", "hybrid"),
            "ocr": True,
            "perspective_correction": True,
            "mm_calibration": True,
            "glyph_measurement": True,
            "contrast": True,
            "clear_space": True,
            "vlm_tagging": vlm.status(),
            "note": (
                "Measurement only. Compliance verdicts are decided by the rule pack "
                "in the Node service."
            ),
        },
    )


# Backwards compatibility with the original stub route, so an older Node build
# keeps working against this service.
@app.post("/api/ocr/analyze")
async def legacy_analyze(file: UploadFile = File(...), languages: str = Form("en")):
    result = await ocr(file=file, languages=languages, engine=None)
    return {
        "tokens": [
            {
                "text": t.text,
                "bbox": t.box.as_list(),
                "confidence": t.confidence,
                "panel": t.panel or "principal",
            }
            for t in result.tokens
        ],
        "languages": result.languages,
        "processingTime": result.processing_time_ms,
    }
