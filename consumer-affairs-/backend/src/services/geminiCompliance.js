const { evaluateCompliance } = require('./ruleEngine');
const { resolveCategory } = require('./categoryResolver');
const { toBaseGrams } = require('../utils/unitNormalizer');

/**
 * Compliance evaluation over a Gemini extraction.
 *
 * The boundary is unchanged and load-bearing: **the model extracts, pure
 * functions decide**. Gemini transcribes what is printed; the verdicts below
 * come from the same deterministic rule pack an officer can open, read and diff.
 * Asking a model whether a pack complies would produce a finding nobody could
 * defend under challenge, and would change its mind between runs.
 *
 * What this path can and cannot decide:
 *
 *   CAN   Rule 6 (every mandatory declaration), Rule 9(4) language,
 *         Rule 11(2) "when packed", Rule 12 unit class and misleading wording,
 *         Rule 13 sub-division, Rule 6(3) stickers, and the spelling advisory.
 *         All of these are questions about *text*, which is what was extracted.
 *
 *   CANNOT Rules 7(2), 7(3), 8(1) and 9(1)(b). Those prescribe millimetres and
 *         contrast ratios, and an extraction carries no physical measurement.
 *         They are reported as NOT_ASSESSED with the reason, never guessed.
 */

// The geometry rules. Each needs a calibrated measurement that extraction mode
// does not produce.
const MEASUREMENT_RULES = {
  R7_2_T1: 'Numeral height is prescribed in millimetres (Rule 7(2) Table I).',
  R7_2_T2: 'Numeral height is prescribed in millimetres (Rule 7(2) Table II).',
  R7_3: 'Letter height and width are prescribed in millimetres (Rule 7(3)).',
  R8_1: 'Clear space is prescribed in multiples of the numeral height (Rule 8(1)).',
  R9_1_B: 'Contrast is a measured luminance ratio (Rule 9(1)(b)).'
};

/**
 * Scripts present in the transcribed text.
 *
 * The model is asked which scripts it sees, but this is computable from the
 * characters it returned, so the derivation is authoritative and the model's
 * answer is only a fallback hint. Rule 9(4) turns on this, and a check that
 * silently depends on the model remembering an optional field is a check that
 * will fail quietly.
 */
function deriveScripts(text) {
  const scripts = new Set();
  if (!text) return [];

  if (/[ऀ-ॿ]/.test(text)) scripts.add('Devanagari');
  if (/[A-Za-z]/.test(text)) scripts.add('Latin');
  if (/[஀-௿]/.test(text)) scripts.add('Tamil');
  if (/[ఀ-౿]/.test(text)) scripts.add('Telugu');
  if (/[ঀ-৿]/.test(text)) scripts.add('Bengali');
  if (/[઀-૿]/.test(text)) scripts.add('Gujarati');
  if (/[ಀ-೿]/.test(text)) scripts.add('Kannada');
  if (/[ഀ-ൿ]/.test(text)) scripts.add('Malayalam');
  if (/[਀-੿]/.test(text)) scripts.add('Gurmukhi');

  return [...scripts];
}

const MEASUREMENT_NOTE =
  'Not assessed in extraction mode: this build reads the label but does not measure it. ' +
  'Capture the panel with a scale reference and run the measurement pipeline to decide this.';

/**
 * Builds the rule engine's flat input from a stored Gemini extraction.
 *
 * The extraction already sits in the Inspection schema shape, so this mostly
 * unpacks additionalInfo and derives the couple of things the rules need that
 * the model does not report directly.
 */
function toRuleInput(extracted = {}) {
  const additional = extracted.additionalInfo || {};
  const netQuantity = extracted.netQuantity || {};
  const care = extracted.consumerCare || {};
  const sticker = additional.stickerOverDeclaration || {};

  // Free text the wording rules search. Rule 12(6) looks for "minimum", "about",
  // "approximately" and the like anywhere near the quantity declaration.
  const rawText = [
    extracted.genericName,
    additional.brandName,
    netQuantity.raw,
    extracted.mrp && extracted.mrp.raw,
    extracted.monthYear && extracted.monthYear.raw,
    additional.ingredients,
    ...(additional.otherText || [])
  ]
    .filter(Boolean)
    .join(' ');

  return {
    manufacturer: extracted.manufacturer || {},
    genericName: extracted.genericName,
    netQuantity: {
      value: netQuantity.value,
      unit: netQuantity.unit,
      raw: netQuantity.raw,
      valueInGrams: toBaseGrams(netQuantity.value, netQuantity.unit),
      hasWhenPackedQualifier: Boolean(
        additional.hasWhenPackedQualifier || /when packed/i.test(netQuantity.raw || '')
      )
    },
    monthYear: (extracted.monthYear && extracted.monthYear.raw) || null,
    mrp: (extracted.mrp && (extracted.mrp.wording || extracted.mrp.raw)) || null,
    consumerCare: { ...care, telephone: care.telephone || care.phone },
    dimensions: extracted.dimensions || null,

    // Rule 6(3): a sticker only matters where it covers a mandatory declaration.
    hasStickerOverMRP: Boolean(sticker.present),

    // Rule 9(4): derived from the characters actually transcribed, falling back
    // to whatever the model reported. Derivation first, because it cannot be
    // forgotten.
    detectedScripts: (() => {
      const derived = deriveScripts(
        [rawText, extracted.manufacturer && extracted.manufacturer.address]
          .filter(Boolean)
          .join(' ')
      );
      if (derived.length > 0) return derived;
      return additional.scriptsPresent || additional.detectedScripts || [];
    })(),

    // Legibility is judged from the model's own confidence in its reading.
    tokenConfidences:
      typeof additional.extractionConfidence === 'number'
        ? [additional.extractionConfidence]
        : [],

    panel: 'principal',
    isBlownOrMoulded: Boolean(additional.isBlownOrMoulded),
    description: additional.ingredients || null,
    rawText
  };
}

/**
 * Replaces geometry verdicts with an explicit NOT_ASSESSED.
 *
 * The rule engine returns REVIEW for these because it found no measurement.
 * That is correct but under-informative: "needs review" reads like the system
 * tried and hesitated, when in fact this build never attempts them. Saying so
 * plainly is the difference between an honest report and a vague one.
 */
function markUnmeasured(results) {
  return results.map((result) => {
    const reason = MEASUREMENT_RULES[result.ruleId];
    if (!reason) return result;

    return {
      ...result,
      verdict: 'NOT_ASSESSED',
      confidence: 'LOW',
      found: 'Not measured',
      measuredValue: null,
      note: `${reason} ${MEASUREMENT_NOTE}`
    };
  });
}

/**
 * Rule 3 and Rule 26 scope gate.
 *
 * Chapter II does not reach every package, and issuing a checklist for one it
 * does not reach is a worse error than a mis-measured numeral. Only the tests
 * answerable from an extraction are applied here; the rest need facts about the
 * transaction that no photograph carries.
 */
function scopeGate(extracted = {}, category = {}) {
  const netQuantity = extracted.netQuantity || {};
  const grams = toBaseGrams(netQuantity.value, netQuantity.unit);

  if (category.outOfScope) {
    return {
      inScope: false,
      citation: 'Rule 26(c)',
      reason:
        `${category.name} is outside these Rules; the DPCO and the Drugs and Cosmetics ` +
        'Rules govern instead.'
    };
  }

  if (grams != null) {
    // Rule 26(a): 10 g / 10 ml or less is outside the Rules.
    if (grams <= 10) {
      return {
        inScope: false,
        citation: 'Rule 26(a)',
        reason: `Net quantity is ${netQuantity.value} ${netQuantity.unit}, at or below the 10 g / 10 ml threshold.`
      };
    }

    // Rule 3(a): above 25 kg / 25 litre Chapter II does not apply, except
    // cement and fertiliser in bags up to 50 kg.
    const ceilingKg = category.maxRetailWeightKg || 25;
    if (grams > ceilingKg * 1000) {
      return {
        inScope: false,
        citation: 'Rule 3(a)',
        reason:
          `Net quantity is ${netQuantity.value} ${netQuantity.unit}, above the ` +
          `${ceilingKg} kg ceiling for this commodity.`
      };
    }
  }

  return { inScope: true };
}

/**
 * Evaluate a Gemini extraction against the rule pack.
 */
function evaluateExtraction(extracted = {}, options = {}) {
  const additional = extracted.additionalInfo || {};

  const category = resolveCategory({
    genericName: extracted.genericName,
    brandName: additional.brandName,
    extraText: (additional.otherText || []).join(' '),
    explicitCategory: options.categoryId
  });

  const { loadCategories } = require('./ruleEngine');
  const categoryRecord =
    loadCategories().find((c) => c.id === category.categoryId) || { id: category.categoryId };

  const scope = scopeGate(extracted, categoryRecord);

  if (!scope.inScope) {
    return {
      inScope: false,
      scope,
      category,
      results: [],
      violations: [],
      penaltyExposure: { total: 0, breakdown: [] },
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        review: 0,
        notApplicable: 0,
        notAssessed: 0,
        category: category.categoryId
      }
    };
  }

  const evaluation = evaluateCompliance(
    toRuleInput(extracted),
    options.rulePackVersion || '1.0.0',
    category.categoryId,
    null // no measurements exist in this mode, and none are invented
  );

  const results = markUnmeasured(evaluation.results);
  const violations = results.filter((r) => r.verdict === 'FAIL');
  const { calculatePenalty } = require('../utils/penaltyCalculator');

  return {
    inScope: true,
    scope,
    category,
    results,
    violations,
    penaltyExposure: calculatePenalty(violations),
    summary: {
      total: results.length,
      passed: results.filter((r) => r.verdict === 'PASS').length,
      failed: violations.length,
      review: results.filter((r) => r.verdict === 'REVIEW').length,
      notApplicable: results.filter((r) => r.verdict === 'NOT_APPLICABLE').length,
      notAssessed: results.filter((r) => r.verdict === 'NOT_ASSESSED').length,
      category: category.categoryId,
      categoryName: categoryRecord.name,
      rulePackVersion: options.rulePackVersion || '1.0.0'
    }
  };
}

/** Overall verdict from the evaluated rows. */
function deriveVerdict(evaluation) {
  if (!evaluation.inScope) return 'not_applicable';
  if (evaluation.summary.failed > 0) return 'non_compliant';
  if (evaluation.summary.review > 0 || evaluation.summary.notAssessed > 0) return 'review';
  return 'compliant';
}

module.exports = {
  evaluateExtraction,
  deriveVerdict,
  toRuleInput,
  scopeGate,
  MEASUREMENT_RULES,
  MEASUREMENT_NOTE
};
