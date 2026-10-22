"""Engine registry.

``get_engine`` resolves a requested engine, falling back down
``ENGINE_FALLBACK_ORDER`` when the requested one has no weights installed. The
name of whatever actually ran is returned to the caller on every response.
"""

from __future__ import annotations

from ..config import settings
from ..schemas import EngineInfo
from .base import OCREngine
from .easyocr_engine import EasyOCREngine
from .paddle_engine import PaddleEngine
from .stub_engine import StubEngine

_REGISTRY: dict[str, OCREngine] = {
    "paddleocr": PaddleEngine(),
    "easyocr": EasyOCREngine(),
    "stub": StubEngine(),
}


def get_engine(requested: str | None = None) -> OCREngine:
    """Return the best available engine, preferring the requested one."""
    order: list[str] = []
    if requested:
        order.append(requested)
    order.append(settings.DEFAULT_ENGINE)
    order.extend(settings.ENGINE_FALLBACK_ORDER)

    seen: set[str] = set()
    for name in order:
        if name in seen or name not in _REGISTRY:
            continue
        seen.add(name)
        engine = _REGISTRY[name]
        if engine.is_available():
            return engine

    return _REGISTRY["stub"]


def list_engines() -> list[EngineInfo]:
    infos: list[EngineInfo] = []
    for name, engine in _REGISTRY.items():
        available = engine.is_available()
        infos.append(
            EngineInfo(
                name=name,
                available=available,
                is_default=(name == settings.DEFAULT_ENGINE),
                detail="" if available else engine.unavailable_reason(),
            )
        )
    return infos


__all__ = ["OCREngine", "get_engine", "list_engines"]
