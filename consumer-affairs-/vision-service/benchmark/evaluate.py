"""Engine and pipeline evaluation -- the accuracy table.

Two jobs:

1. Settle the PaddleOCR vs EasyOCR question by measurement rather than
   reputation (build order step 1: "run both over the ground-truth set from
   step 2 and keep the winner. A day's work, turns a guess into a measurement").

2. Produce per-rule precision / recall plus the review-queue rate, which is the
   table the solution document is missing.

Run:
    python -m benchmark.evaluate --ground-truth data/ground_truth.json
    python -m benchmark.evaluate --ground-truth data/ground_truth.json --compare-engines
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engines import get_engine, list_engines  # noqa: E402
from app.schemas import AnalyzeRequest, Confidence  # noqa: E402
from benchmark.groundtruth import GroundTruthEntry, coverage_report, load  # noqa: E402


@dataclass
class FieldScore:
    """Per-declaration-head extraction accuracy."""

    head: str
    true_positive: int = 0
    false_positive: int = 0
    false_negative: int = 0
    exact_match: int = 0
    total: int = 0

    @property
    def precision(self) -> float:
        denominator = self.true_positive + self.false_positive
        return self.true_positive / denominator if denominator else 0.0

    @property
    def recall(self) -> float:
        denominator = self.true_positive + self.false_negative
        return self.true_positive / denominator if denominator else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) else 0.0

    @property
    def exact_match_rate(self) -> float:
        return self.exact_match / self.total if self.total else 0.0


@dataclass
class MeasurementScore:
    """How close the measured numeral heights are to hand measurement.

    Absolute error in millimetres is what matters here, not percentage: the
    Rule 7(2) bands are 1, 2, 4 and 6 mm, so an error of 0.4 mm can flip a
    verdict at the 1 mm band and cannot at the 6 mm band.
    """

    errors_mm: list[float] = field(default_factory=list)
    band_correct: int = 0
    band_total: int = 0

    @property
    def mean_absolute_error_mm(self) -> float:
        return statistics.fmean(self.errors_mm) if self.errors_mm else 0.0

    @property
    def p95_error_mm(self) -> float:
        if not self.errors_mm:
            return 0.0
        ordered = sorted(self.errors_mm)
        return ordered[min(int(len(ordered) * 0.95), len(ordered) - 1)]

    @property
    def band_accuracy(self) -> float:
        return self.band_correct / self.band_total if self.band_total else 0.0


def rule7_band_mm(net_quantity_g: float | None, blown: bool = False) -> float | None:
    """Rule 7(2) Table I -- minimum numeral height by net weight or volume.

    Up to 200 g/ml -> 1 mm; above 200 up to 500 -> 2 mm; above 500 -> 4 mm.
    Doubled where blown, formed, moulded, embossed or perforated.
    """
    if net_quantity_g is None:
        return None

    if net_quantity_g <= 200:
        base = 1.0
    elif net_quantity_g <= 500:
        base = 2.0
    else:
        base = 4.0

    return base * 2 if blown else base


def _normalise(value: str | None) -> str:
    return " ".join((value or "").lower().split())


def _fuzzy_equal(predicted: str | None, expected: str | None, threshold: float = 0.85) -> bool:
    """Token-overlap comparison, so OCR noise in a long address is not a miss."""
    p, e = _normalise(predicted), _normalise(expected)
    if not p or not e:
        return False
    if p == e:
        return True

    p_tokens, e_tokens = set(p.split()), set(e.split())
    if not e_tokens:
        return False

    return len(p_tokens & e_tokens) / len(e_tokens) >= threshold


def _numeric_equal(predicted: str | None, expected: str | None, tolerance: float = 1e-6) -> bool:
    """Compare a value-and-unit declaration by its number, not its spelling.

    "40.00" and "40" are the same retail sale price, and "200 g" and "200g" the
    same net quantity. Scoring those as misses would understate the engine.
    """
    p, e = _normalise(predicted), _normalise(expected)
    if not p or not e:
        return False

    number = re.compile(r"[-+]?\d*\.?\d+")
    p_number, e_number = number.search(p), number.search(e)
    if not p_number or not e_number:
        return p == e

    if abs(float(p_number.group()) - float(e_number.group())) > tolerance:
        return False

    # Where both carry a unit, it has to be the same unit.
    p_unit = p[p_number.end():].strip().rstrip(".")
    e_unit = e[e_number.end():].strip().rstrip(".")
    if p_unit and e_unit:
        return p_unit == e_unit

    return True


def score_extraction(predicted: dict, entry: GroundTruthEntry, scores: dict[str, FieldScore]) -> None:
    """Score one package's six heads against what a human read off the pack."""
    declarations = entry.declarations

    # "fuzzy" for free text, "numeric" for value declarations, exact otherwise.
    comparisons = [
        ("manufacturer_name", predicted.get("manufacturer_name"), declarations.manufacturer_name, "fuzzy"),
        ("manufacturer_address", predicted.get("manufacturer_address"), declarations.manufacturer_address, "fuzzy"),
        ("generic_name", predicted.get("generic_name"), declarations.generic_name, "fuzzy"),
        ("net_quantity", predicted.get("net_quantity"), _quantity_string(declarations), "numeric"),
        ("month_year", predicted.get("month_year"), declarations.month_year, "exact"),
        ("mrp", predicted.get("mrp"), _mrp_string(declarations), "numeric"),
        ("consumer_care_phone", predicted.get("consumer_care_phone"), declarations.consumer_care_phone, "numeric"),
        ("consumer_care_email", predicted.get("consumer_care_email"), declarations.consumer_care_email, "exact"),
    ]

    for head, got, want, mode in comparisons:
        score = scores.setdefault(head, FieldScore(head=head))
        score.total += 1

        has_got, has_want = bool(_normalise(got)), bool(_normalise(want))

        if has_got and has_want:
            if mode == "fuzzy":
                matched = _fuzzy_equal(got, want)
            elif mode == "numeric":
                matched = _numeric_equal(got, want)
            else:
                matched = _normalise(got) == _normalise(want)
            if matched:
                score.true_positive += 1
                score.exact_match += 1
            else:
                # Read something, read it wrong: counts against both sides.
                score.false_positive += 1
                score.false_negative += 1
        elif has_got and not has_want:
            score.false_positive += 1
        elif has_want and not has_got:
            score.false_negative += 1
        else:
            # Correctly absent on both sides; a true negative, scored nowhere.
            score.exact_match += 1


def _quantity_string(d) -> str | None:
    if d.net_quantity_value is None or not d.net_quantity_unit:
        return None
    value = d.net_quantity_value
    rendered = int(value) if float(value).is_integer() else value
    return f"{rendered} {d.net_quantity_unit}".strip()


def _mrp_string(d) -> str | None:
    if d.mrp_value is None:
        return None
    return f"{d.mrp_value:.2f}".rstrip("0").rstrip(".")


def evaluate_engine(entries: list[GroundTruthEntry], engine_name: str, root: Path) -> dict:
    """Run one engine over the whole set and return its accuracy table."""
    from app import pipeline

    engine = get_engine(engine_name)
    field_scores: dict[str, FieldScore] = {}
    measurement = MeasurementScore()

    review_queue = 0
    processed = 0
    failures: list[str] = []
    durations: list[float] = []

    for entry in entries:
        image_path = (root / entry.image_path).resolve()
        if not image_path.exists():
            failures.append(f"{entry.id}: image not found at {image_path}")
            continue

        data = image_path.read_bytes()
        request = AnalyzeRequest(
            reference_width_mm=entry.reference_width_mm,
            is_curved_surface=entry.is_curved_surface,
            is_blown_or_moulded=entry.is_blown_or_moulded,
            engine=engine.name,
        )

        started = time.perf_counter()
        try:
            result = pipeline.analyze(data, request)
        except Exception as exc:  # pragma: no cover - per-image robustness
            failures.append(f"{entry.id}: {exc}")
            continue
        durations.append(time.perf_counter() - started)
        processed += 1

        # A row that cannot be asserted goes to a person; that rate is as
        # important as accuracy, because it is the cost of the honesty.
        if (
            result.numeral_metrics.confidence == Confidence.LOW
            or result.calibration.confidence == Confidence.LOW
        ):
            review_queue += 1

        score_extraction(_tokens_to_fields(result.tokens), entry, field_scores)

        if entry.has_measurements and result.numeral_metrics.median_digit_height_mm is not None:
            expected_mm = entry.measurements.numeral_height_mm
            measured_mm = result.numeral_metrics.median_digit_height_mm
            measurement.errors_mm.append(abs(measured_mm - expected_mm))

            quantity_g = _to_grams(entry.declarations)
            band = rule7_band_mm(quantity_g, entry.is_blown_or_moulded)
            if band is not None:
                measurement.band_total += 1
                # The verdict is what matters: both sides on the same side of
                # the statutory minimum counts as correct.
                if (measured_mm >= band) == (expected_mm >= band):
                    measurement.band_correct += 1

    return {
        "engine": engine.name,
        "requested_engine": engine_name,
        "processed": processed,
        "failures": failures,
        "mean_latency_ms": round(statistics.fmean(durations) * 1000, 1) if durations else 0.0,
        "review_queue_rate": round(review_queue / processed, 4) if processed else 0.0,
        "fields": {
            head: {
                "precision": round(score.precision, 4),
                "recall": round(score.recall, 4),
                "f1": round(score.f1, 4),
                "exact_match_rate": round(score.exact_match_rate, 4),
                "n": score.total,
            }
            for head, score in sorted(field_scores.items())
        },
        "numeral_measurement": {
            "n": len(measurement.errors_mm),
            "mean_absolute_error_mm": round(measurement.mean_absolute_error_mm, 3),
            "p95_error_mm": round(measurement.p95_error_mm, 3),
            "rule7_band_accuracy": round(measurement.band_accuracy, 4),
            "band_n": measurement.band_total,
        },
    }


def _to_grams(declarations) -> float | None:
    value, unit = declarations.net_quantity_value, (declarations.net_quantity_unit or "").lower()
    if value is None:
        return None
    if unit in {"g", "gm", "gms", "ml"}:
        return float(value)
    if unit in {"kg", "l", "ltr", "litre"}:
        return float(value) * 1000
    return None


def _tokens_to_fields(tokens) -> dict:
    """Minimal tagger used only for scoring.

    The production tagger lives in the Node extraction service; this one exists
    so the benchmark measures the OCR engine rather than the tagger.
    """
    import re

    text = " ".join(t.text for t in tokens)

    quantity = re.search(
        r"(\d+(?:\.\d+)?)\s*(g|gm|gms|kg|ml|l|ltr)\b", text, re.IGNORECASE
    )
    mrp = re.search(r"(?:mrp|rs\.?|₹)\s*(\d+(?:\.\d{1,2})?)", text, re.IGNORECASE)
    month_year = re.search(r"\b(\d{2}[/-]\d{4}|[A-Za-z]{3,9}\s+\d{4})\b", text)
    phone = re.search(r"\b(?:1800[\s-]?\d{3}[\s-]?\d{4}|\d{10,11})\b", text)
    email = re.search(r"[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}", text)
    manufacturer = re.search(
        r"(?:manufactured by|packed by|imported by|marketed by)[:\s]+([^,0-9]{3,60})",
        text,
        re.IGNORECASE,
    )
    address = re.search(r"([^,]*(?:,[^,]*){0,3},?\s*\d{6})\b", text)

    return {
        "manufacturer_name": manufacturer.group(1).strip() if manufacturer else None,
        "manufacturer_address": address.group(1).strip() if address else None,
        "generic_name": None,  # unstructured head: VLM or officer, never regex
        "net_quantity": f"{quantity.group(1)} {quantity.group(2).lower()}" if quantity else None,
        "month_year": month_year.group(1) if month_year else None,
        "mrp": mrp.group(1) if mrp else None,
        "consumer_care_phone": phone.group(0) if phone else None,
        "consumer_care_email": email.group(0) if email else None,
    }


def render(report: dict) -> str:
    lines = [
        f"\nEngine: {report['engine']}  (requested: {report['requested_engine']})",
        f"Packages processed: {report['processed']}   "
        f"mean latency: {report['mean_latency_ms']} ms   "
        f"review-queue rate: {report['review_queue_rate'] * 100:.1f}%",
        "",
        f"{'DECLARATION HEAD':<24}{'PRECISION':>11}{'RECALL':>9}{'F1':>8}{'N':>6}",
        "-" * 58,
    ]
    for head, score in report["fields"].items():
        lines.append(
            f"{head:<24}{score['precision']:>11.3f}{score['recall']:>9.3f}"
            f"{score['f1']:>8.3f}{score['n']:>6}"
        )

    measurement = report["numeral_measurement"]
    lines += [
        "",
        "Rule 7(2) numeral height vs hand measurement",
        f"  n = {measurement['n']}   "
        f"MAE = {measurement['mean_absolute_error_mm']} mm   "
        f"p95 = {measurement['p95_error_mm']} mm",
        f"  band accuracy = {measurement['rule7_band_accuracy'] * 100:.1f}% "
        f"over {measurement['band_n']} packages",
    ]

    if report["failures"]:
        lines += ["", f"Failures ({len(report['failures'])}):"]
        lines += [f"  {failure}" for failure in report["failures"][:10]]

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="LM-Verify vision benchmark")
    parser.add_argument("--ground-truth", required=True, help="Path to ground_truth.json")
    parser.add_argument("--engine", default=None, help="Engine to evaluate")
    parser.add_argument(
        "--compare-engines",
        action="store_true",
        help="Run every available engine and print them side by side",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of a table")
    args = parser.parse_args()

    path = Path(args.ground_truth)
    if not path.exists():
        print(f"Ground-truth file not found: {path}", file=sys.stderr)
        print(
            "Build the set first -- it is step 2 for a reason. See benchmark/groundtruth.py "
            "and data/ground_truth.example.json.",
            file=sys.stderr,
        )
        return 2

    entries = load(path)
    root = path.parent

    coverage = coverage_report(entries)
    if not args.json:
        print(f"\nGround-truth coverage: {coverage['total']}/{coverage['target']} packages")
        print(f"  by category: {coverage['by_category']}")
        print(f"  hand-measured: {coverage['hand_measured']}/{coverage['hand_measured_target']}")
        for gap in coverage["gaps"]:
            print(f"  GAP: {gap}")
        if not coverage["usable"]:
            print(
                "\n  The set is not yet complete. Numbers below are indicative, "
                "not the accuracy table."
            )

    if args.compare_engines:
        names = [e.name for e in list_engines() if e.available]
    else:
        names = [args.engine] if args.engine else [None]

    reports = [evaluate_engine(entries, name, root) for name in names]

    if args.json:
        print(json.dumps({"coverage": coverage, "reports": reports}, indent=2))
    else:
        for report in reports:
            print(render(report))

        if len(reports) > 1:
            print("\n" + "=" * 58)
            print("Keep the winner. This is the measurement, not the reputation.")
            best = max(
                reports,
                key=lambda r: statistics.fmean([f["f1"] for f in r["fields"].values()] or [0]),
            )
            print(f"Best mean F1: {best['engine']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
