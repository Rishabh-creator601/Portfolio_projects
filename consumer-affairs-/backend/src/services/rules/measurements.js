/**
 * Shared measurement plumbing for the geometry rules (7, 8 and 9).
 *
 * The vision sidecar returns a physical measurement plus a confidence band. The
 * band decides what the rule is allowed to assert, which is the single most
 * important behaviour in the system:
 *
 *   HIGH    the verdict is recorded as stated
 *   MEDIUM  the measurement is reported, but the row reads REVIEW
 *   LOW     nothing is asserted; the row reads REVIEW and names what was missing
 *
 * A compliance system that is right 95% of the time and silent about which 5%
 * is unusable in enforcement. One that is right 90% of the time and says clearly
 * which 10% it is unsure about is entirely usable, because the uncertainty is
 * routed to a person instead of buried in a verdict.
 */

const HIGH = 'HIGH';
const MEDIUM = 'MEDIUM';
const LOW = 'LOW';

/**
 * Rule 7(2) Table I -- minimum numeral height where net quantity is declared by
 * weight or volume. Second column applies where the declaration is blown,
 * formed, moulded, embossed or perforated.
 */
const TABLE_I = [
  { upToGrams: 200, normal: 1, blown: 2, label: 'Up to 200 g/ml' },
  { upToGrams: 500, normal: 2, blown: 4, label: 'Above 200 and up to 500 g/ml' },
  { upToGrams: Infinity, normal: 4, blown: 6, label: 'Above 500 g/ml' }
];

/**
 * Rule 7(2) Table II -- minimum numeral height where quantity is declared by
 * length, area or number, indexed by the area of the principal display panel.
 */
const TABLE_II = [
  { upToCm2: 100, normal: 1, blown: 2, label: 'Up to 100 cm²' },
  { upToCm2: 500, normal: 2, blown: 4, label: 'Above 100 and up to 500 cm²' },
  { upToCm2: 2500, normal: 4, blown: 6, label: 'Above 500 and up to 2500 cm²' },
  { upToCm2: Infinity, normal: 6, blown: 6, label: 'Above 2500 cm²' }
];

/** Rule 7(3): letters are at least 1 mm, or 2 mm when blown or moulded. */
const MIN_LETTER_HEIGHT_MM = { normal: 1, blown: 2 };

/** Rule 7(3): width at least one-third of height. */
const MIN_WIDTH_TO_HEIGHT_RATIO = 1 / 3;

function lookupTableI(grams, isBlownOrMoulded = false) {
  const row = TABLE_I.find((r) => grams <= r.upToGrams) || TABLE_I[TABLE_I.length - 1];
  return { mm: isBlownOrMoulded ? row.blown : row.normal, band: row.label };
}

function lookupTableII(areaCm2, isBlownOrMoulded = false) {
  const row = TABLE_II.find((r) => areaCm2 <= r.upToCm2) || TABLE_II[TABLE_II.length - 1];
  return { mm: isBlownOrMoulded ? row.blown : row.normal, band: row.label };
}

/**
 * Accepts either the vision sidecar's measurement object or the older
 * `{ isCalibrated: true }` shape, and returns one predictable structure.
 */
function normalizeMeasurements(input, extracted = {}) {
  const legacyDeclarations = extracted.declarations || {};

  if (input && (input.calibration || input.numeral || input.clearSpace)) {
    const calibration = input.calibration || {};
    const numeral = input.numeral || {};
    const contrast = input.contrast || {};
    const clearSpace = input.clearSpace || {};
    const panel = input.panelGeometry || {};
    const quality = input.quality || {};

    return {
      isCalibrated: Boolean(calibration.mm_per_px),
      calibrationConfidence: calibration.confidence || LOW,
      isCurvedSurface: Boolean(calibration.is_curved_surface),
      qualityAccepted: quality.accepted !== false,
      qualityWarnings: quality.warnings || [],
      numeralHeightMm: numeral.median_digit_height_mm ?? null,
      letterWidthMm: numeral.median_letter_width_mm ?? null,
      numeralConfidence: numeral.confidence || LOW,
      numeralNotes: numeral.notes || [],
      contrastRatio: contrast.ratio ?? null,
      meetsContrast: contrast.meets_wcag_aa ?? null,
      contrastConfidence: contrast.confidence || LOW,
      contrastNotes: contrast.notes || [],
      clearSpace: {
        aboveMm: clearSpace.above_mm ?? null,
        belowMm: clearSpace.below_mm ?? null,
        leftMm: clearSpace.left_mm ?? null,
        rightMm: clearSpace.right_mm ?? null,
        requiredVerticalMm: clearSpace.required_vertical_mm ?? null,
        requiredHorizontalMm: clearSpace.required_horizontal_mm ?? null,
        satisfied: clearSpace.satisfied ?? null,
        confidence: clearSpace.confidence || LOW,
        notes: clearSpace.notes || []
      },
      panelAreaCm2: panel.area_cm2 ?? null,
      panelConfidence: panel.confidence || LOW,
      source: 'vision-service'
    };
  }

  // Legacy path: a bare isCalibrated flag with measurements on the extraction.
  const isCalibrated = Boolean(input && input.isCalibrated);

  return {
    isCalibrated,
    calibrationConfidence: isCalibrated ? HIGH : LOW,
    isCurvedSurface: false,
    qualityAccepted: true,
    qualityWarnings: [],
    numeralHeightMm: legacyDeclarations.numeralHeightMm ?? null,
    letterWidthMm: legacyDeclarations.letterWidthMm ?? null,
    numeralConfidence: isCalibrated && legacyDeclarations.numeralHeightMm != null ? HIGH : LOW,
    numeralNotes: [],
    contrastRatio: extracted.contrastRatio ?? null,
    meetsContrast: extracted.contrastRatio != null ? extracted.contrastRatio >= 3 : null,
    contrastConfidence: extracted.contrastRatio != null ? HIGH : LOW,
    contrastNotes: [],
    clearSpace: {
      aboveMm: null,
      belowMm: null,
      leftMm: null,
      rightMm: null,
      requiredVerticalMm: null,
      requiredHorizontalMm: null,
      satisfied: null,
      confidence: legacyDeclarations.bbox ? MEDIUM : LOW,
      notes: []
    },
    panelAreaCm2: legacyDeclarations.panelAreaCm2 ?? null,
    panelConfidence: legacyDeclarations.panelAreaCm2 != null ? MEDIUM : LOW,
    source: 'legacy'
  };
}

/**
 * Applies the confidence band to a computed verdict.
 *
 * A measurement is only allowed to assert PASS or FAIL at HIGH confidence.
 * Anything less is reported honestly as REVIEW with the measurement attached,
 * so the officer sees the number and the reason rather than a bare verdict.
 */
function gate(verdict, confidence, reasons = []) {
  if (confidence === HIGH) {
    return { verdict, confidence, note: null };
  }

  if (confidence === MEDIUM) {
    return {
      verdict: 'REVIEW',
      confidence,
      note: `Provisional verdict ${verdict}. ${reasons.join(' ') || 'Confirmation required.'}`.trim()
    };
  }

  return {
    verdict: 'REVIEW',
    confidence: LOW,
    note: reasons.join(' ') || 'Not enough evidence in the image to assert a verdict.'
  };
}

/** The weakest of several confidence bands governs the combined result. */
function weakest(...bands) {
  if (bands.includes(LOW)) return LOW;
  if (bands.includes(MEDIUM)) return MEDIUM;
  return HIGH;
}

/** Net quantity in grams or millilitres, for the Table I lookup. */
function toBaseUnits(netQuantity = {}) {
  if (netQuantity.valueInGrams != null) return netQuantity.valueInGrams;

  const value = netQuantity.value;
  const unit = String(netQuantity.unit || '').toLowerCase();
  if (typeof value !== 'number' || Number.isNaN(value)) return null;

  if (['g', 'gm', 'gms', 'gram', 'grams', 'ml'].includes(unit)) return value;
  if (['kg', 'kgs', 'l', 'ltr', 'litre', 'liter'].includes(unit)) return value * 1000;

  return null;
}

/** True where quantity is declared by length, area or number -- the Table II path. */
function isCountOrMeasure(netQuantity = {}) {
  const unit = String(netQuantity.unit || '').toLowerCase();
  return ['n', 'u', 'no', 'nos', 'number', 'pc', 'pcs', 'pieces', 'cm', 'm', 'cm2', 'm2'].includes(
    unit
  );
}

module.exports = {
  HIGH,
  MEDIUM,
  LOW,
  TABLE_I,
  TABLE_II,
  MIN_LETTER_HEIGHT_MM,
  MIN_WIDTH_TO_HEIGHT_RATIO,
  lookupTableI,
  lookupTableII,
  normalizeMeasurements,
  gate,
  weakest,
  toBaseUnits,
  isCountOrMeasure
};
