# LM-Verify Vision Service

OCR and measurement sidecar for the Legal Metrology (Packaged Commodities) Rules, 2011
compliance checker. It **reads and measures**; it never decides compliance. Verdicts come
from the deterministic rule pack in the Node service, which is what makes a finding
reproducible and defensible months later.

Built in the order set out in `ML_Build_Order.txt`.

---

## The contract

```
POST /ocr       ->  { tokens: [{text, box, confidence}, ...], engine, ... }
POST /analyze   ->  tokens + quality + calibration + numeral/contrast/clear-space metrics
POST /tag       ->  VLM pass over the two unstructured declaration heads (optional)
GET  /engines   ->  which engines are installed, and why any are not
GET  /health    ->  status and capabilities
```

`/ocr` is deliberately narrow. PaddleOCR and EasyOCR both implement it, so which engine
runs is an operational choice rather than an architectural one.

---

## Step 1 — two engines, one interface

| Engine | Module | Notes |
| --- | --- | --- |
| PaddleOCR (PP-OCRv5) | `app/engines/paddle_engine.py` | Starting choice: better on small dense print, better multilingual coverage for the regional-language roadmap, faster on CPU |
| EasyOCR | `app/engines/easyocr_engine.py` | The alternative, same contract |
| Stub | `app/engines/stub_engine.py` | No weights installed — keeps the pipeline exercisable, and flags every reading for officer review |

Neither engine is a hard dependency. Install one:

```bash
pip install paddlepaddle==2.6.1 paddleocr==2.8.1   # or
pip install easyocr==1.7.2
```

**Do not pick by reputation.** Run both over the ground-truth set and keep the winner:

```bash
python -m benchmark.evaluate --ground-truth data/ground_truth.json --compare-engines
```

---

## Step 2 — the ground-truth set (build this first)

~150 photographed packages spread across food / cosmetics / detergent / bidi, so every
category exemption path is covered, with the six declaration heads as a human reads them
and hand-measured numeral heights for a subset.

```bash
python -m benchmark.make_sample_set --out data/sample   # synthetic smoke test only
python -m benchmark.evaluate --ground-truth data/sample/ground_truth.json
```

`benchmark/groundtruth.py` defines the schema and reports coverage gaps. The harness
refuses to present itself as an accuracy table until the set is complete — a number
measured on an incomplete set is worse than no number.

---

## Step 3 — regex first, VLM for the remainder

Four of the six heads are statutorily patterned and are tagged by regex in the Node
extraction service: MRP (Rule 6(1)(e) prescribes the wording), net quantity (number plus a
closed unit set, cross-checked against Rule 13), month/year (bounded format space per the
Explanation to Rule 6(1)(d)), and consumer care (e-mail, Indian phone, 6-digit PIN
anchoring the address block).

Two heads are not patterned and go to a VLM with a JSON schema (`app/tagging/vlm.py`):

* the manufacturer block, including the *manufactured by* / *packed by* / *imported by*
  attribution that Explanations I and II to Rule 6 turn on — reading comprehension, not
  pattern matching;
* the common or generic name, which has to be told apart from the brand.

Deliberately **not** done: fine-tuning LayoutLMv3 or LiLT. That is the textbook answer and
the wrong one here — it needs several hundred hand-labelled packages before it beats regex.

---

## Step 4 — glyph height in millimetres

**Never measure font height from an OCR bounding box.** CRAFT and PaddleOCR both return a
box around a text *region*, sized to its ascenders and descenders plus padding. A box
around "200 g" is as tall as the g descender; a box around "MRP" has no descender at all.
Measuring from those is inconsistent by 20–40% depending on which letters are in the
string, and it skews **high** — reporting Rule 7(2) violations that are not there. In an
enforcement tool, false positives are the expensive kind.

The implemented method (`app/pipeline/glyphs.py`):

1. OCR localises the numeral — that is all it is used for
2. crop from the full-resolution original, upscale 4×
3. Sauvola binarise (adaptive; survives uneven packaging light where a global Otsu does not)
4. connected components → one component per glyph
5. filter to digit glyphs, take the **median** component height in px
6. `height_mm = median_px × mm_per_px`

`mm_per_px` = known reference width in mm ÷ its measured width in px, computed **after**
perspective correction, never before (`app/pipeline/calibration.py`).

**Known limit:** on curved surfaces — bottles, pouches — mm/px varies across the label, so
one scale factor is only valid near the reference. The officer marks the pack as curved at
capture and every dependent measurement drops to LOW confidence and routes to review.

### Measured accuracy against known geometry

`tests/test_pipeline.py` renders labels at a known mm/px across all four statutory bands
(1, 2, 4, 6 mm) and three capture resolutions:

| Metric | Result |
| --- | --- |
| Worst-case height error | **< 0.09 mm** |
| Rule 7(2) band classification | **100% correct** |
| Padding a region by 40% | changes the measurement by < 0.2 mm |

With EasyOCR in the loop over the synthetic benchmark set: MAE **0.03 mm**, p95 **0.07 mm**,
band accuracy **100%**. Those are rendered labels, not photographs — the real figures come
from the step-2 set.

---

## Step 5 — contrast and clear space

Both fall out of the same mask, so they are nearly free once step 4 exists.

* **Rule 9(1)(b)** (`contrast.py`) — WCAG relative-luminance ratio between glyph pixels and
  a dilated ring of local background. The Rules say "contrasts conspicuously" without a
  number, so the published 3:1 threshold is what gets cited. Where the print contrasts too
  weakly for adaptive binarisation — which is exactly the violation being looked for — it
  falls back to Otsu rather than declining to measure.
* **Rule 7(3)** — width at no less than one-third of height, straight off the component boxes.
* **Rule 8(1)** (`clearspace.py`) — geometric measurement of the printed-matter-free margin:
  one numeral height above and below, twice that left and right.

---

## What needs no model at all

| Concern | Implementation |
| --- | --- |
| De-skew / perspective | `geometry.py` — findContours + warpPerspective, with a Hough de-skew fallback |
| Blur gate | `quality.py` — variance of the Laplacian |
| Glare detection | `quality.py` — highlight / low-saturation mask |
| PDP vs side/back panel | Asked of the officer at capture. A UI answer to an ML problem — no segmenter is trained |
| Sticker over MRP | Edge/texture discontinuity → officer confirms |
| Product dedup | Perceptual hash + brand + quantity (Node side) |
| Spell check | Domain lexicon in the Node service |

---

## Confidence gating

Every measurement carries a band, and the band decides what the rule engine may assert:

| Band | Behaviour |
| --- | --- |
| **HIGH** | The verdict is recorded as stated |
| **MEDIUM** | The measurement is reported, the row reads REVIEW, the case cannot close until an officer looks |
| **LOW** | Nothing is asserted; the row names what was missing and joins the pending queue |

A compliance system that is right 95% of the time and silent about which 5% is unusable in
enforcement. One that is right 90% of the time and says clearly which 10% it is unsure
about is entirely usable, because the uncertainty is routed to a person.

---

## Running it

```bash
pip install -r requirements-dev.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
pytest tests/ -q
```

Configuration is environment-driven; see `app/config.py`. Every threshold there is a
measurement threshold — the statute itself lives in the Node rule pack.
