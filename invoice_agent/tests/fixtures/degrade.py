"""Turns a clean PDF into something that looks scanned or photographed."""

import io

import numpy as np
import pymupdf
from PIL import Image, ImageEnhance, ImageFilter

PROFILES = {
    "light": {"dpi": 200, "angle": 0.6, "blur": 0.3, "noise": 4, "contrast": 0.95, "gray": True, "jpeg": 85, "tint": None},
    "heavy": {"dpi": 150, "angle": 1.8, "blur": 0.7, "noise": 12, "contrast": 0.8, "gray": True, "jpeg": 55, "tint": None},
    "photo": {"dpi": 170, "angle": 2.5, "blur": 0.5, "noise": 7, "contrast": 0.85, "gray": False, "jpeg": 70,
              "tint": (1.0, 0.97, 0.9)},
}


def _degrade_page(image: Image.Image, profile: dict, rng: np.random.Generator) -> Image.Image:
    angle = rng.uniform(0.5, 1.0) * profile["angle"] * rng.choice([-1, 1])
    image = image.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=(245, 245, 245))
    image = image.filter(ImageFilter.GaussianBlur(profile["blur"]))
    image = ImageEnhance.Contrast(image).enhance(profile["contrast"])

    pixels = np.asarray(image, dtype=np.float32)
    if profile["tint"]:
        pixels = pixels * np.array(profile["tint"], dtype=np.float32)
    pixels = pixels + rng.normal(0, profile["noise"], pixels.shape)
    image = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
    return image.convert("L") if profile["gray"] else image


def degrade(source_pdf, output, profile_name: str, output_format: str, seed: int) -> None:
    """Write a degraded copy. pdf output is image-only with no text layer; png and jpg keep page 1."""
    profile = PROFILES[profile_name]
    rng = np.random.default_rng(seed)
    pages = []
    with pymupdf.open(source_pdf) as doc:
        for page in doc:
            pix = page.get_pixmap(dpi=profile["dpi"], alpha=False)
            image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            pages.append(_degrade_page(image, profile, rng))

    if output_format == "png":
        pages[0].save(output, format="PNG", optimize=True)
    elif output_format == "jpg":
        pages[0].convert("RGB").save(output, format="JPEG", quality=profile["jpeg"])
    else:
        with pymupdf.open() as out:
            for image in pages:
                buffer = io.BytesIO()
                image.save(buffer, format="JPEG", quality=profile["jpeg"])
                page = out.new_page(width=image.width * 72 / profile["dpi"], height=image.height * 72 / profile["dpi"])
                page.insert_image(page.rect, stream=buffer.getvalue())
            out.save(output, garbage=3, deflate=True)
