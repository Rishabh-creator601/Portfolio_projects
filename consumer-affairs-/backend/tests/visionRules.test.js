const { evaluateCompliance } = require('../src/services/ruleEngine');
const { lookupTableI, lookupTableII } = require('../src/services/rules/measurements');
const { checkSpelling, evaluateSpelling } = require('../src/services/spellCheckService');

/**
 * The statutory tables, and the confidence gating that decides what the system
 * is allowed to assert from a measurement.
 */

const baseExtraction = {
  manufacturer: { name: 'ABC Foods Pvt Ltd', address: '123, Industrial Area, New Delhi 110001' },
  genericName: 'Biscuits',
  netQuantity: { value: 200, unit: 'g', valueInGrams: 200, hasWhenPackedQualifier: false },
  monthYear: '08/2026',
  mrp: 'Maximum Retail Price Rs 40.00 inclusive of all taxes',
  consumerCare: {
    name: 'Consumer Care Cell',
    address: 'Mumbai 400001',
    telephone: '18001234567',
    email: 'care@abcfoods.in'
  },
  detectedScripts: ['Latin'],
  panel: 'principal',
  rawText: 'biscuits net weight maximum retail price'
};

/** A vision-service response measuring a numeral of the given height. */
const measurementsFor = (heightMm, overrides = {}) => ({
  quality: { accepted: true, blur_score: 320, glare_ratio: 0.01, warnings: [] },
  calibration: { mm_per_px: 0.08, source: 'reference_card', confidence: 'HIGH', notes: [] },
  numeral: {
    median_digit_height_mm: heightMm,
    median_letter_width_mm: heightMm / 2,
    glyph_count: 4,
    confidence: 'HIGH',
    notes: []
  },
  contrast: { ratio: 12.4, meets_wcag_aa: true, confidence: 'HIGH', notes: [] },
  clearSpace: {
    above_mm: heightMm * 1.5,
    below_mm: heightMm * 1.5,
    left_mm: heightMm * 2.5,
    right_mm: heightMm * 2.5,
    required_vertical_mm: heightMm,
    required_horizontal_mm: heightMm * 2,
    satisfied: true,
    confidence: 'HIGH',
    notes: []
  },
  panelGeometry: { area_cm2: 180, confidence: 'MEDIUM' },
  ...overrides
});

const findRule = (results, ruleId) => results.find((r) => r.ruleId === ruleId);

describe('Rule 7(2) statutory height tables', () => {
  // Table I: up to 200 g/ml -> 1 mm; above 200 up to 500 -> 2 mm; above 500 -> 4 mm.
  it.each([
    [50, 1],
    [200, 1],
    [201, 2],
    [500, 2],
    [501, 4],
    [5000, 4]
  ])('net quantity %i g requires %i mm', (grams, expected) => {
    expect(lookupTableI(grams).mm).toBe(expected);
  });

  it('doubles every band for blown, formed or moulded declarations', () => {
    expect(lookupTableI(200, true).mm).toBe(2);
    expect(lookupTableI(400, true).mm).toBe(4);
    expect(lookupTableI(900, true).mm).toBe(6);
  });

  // Table II is indexed by principal display panel area.
  it.each([
    [80, 1],
    [100, 1],
    [300, 2],
    [500, 2],
    [2000, 4],
    [2500, 4],
    [4000, 6]
  ])('panel area %i cm² requires %i mm', (areaCm2, expected) => {
    expect(lookupTableII(areaCm2).mm).toBe(expected);
  });
});

describe('Rule 7 evaluation against measurements', () => {
  it('passes a 200 g pack whose numerals clear the 1 mm minimum', () => {
    const { results } = evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', measurementsFor(1.4));
    const rule = findRule(results, 'R7_2_T1');

    expect(rule.verdict).toBe('PASS');
    expect(rule.required).toContain('1 mm');
    expect(rule.measuredValue).toBe('1.40 mm');
  });

  it('fails a 200 g pack whose numerals fall below the minimum', () => {
    const { results } = evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', measurementsFor(0.7));
    const rule = findRule(results, 'R7_2_T1');

    expect(rule.verdict).toBe('FAIL');
    expect(rule.prescribedValue).toBe('1 mm');
  });

  it('applies the 2 mm band once the pack passes 200 g', () => {
    const heavier = {
      ...baseExtraction,
      netQuantity: { value: 500, unit: 'g', valueInGrams: 500 }
    };
    const { results } = evaluateCompliance(heavier, '1.0.0', 'toilet_soap', measurementsFor(1.5));

    expect(findRule(results, 'R7_2_T1').verdict).toBe('FAIL');
    expect(findRule(results, 'R7_2_T1').prescribedValue).toBe('2 mm');
  });

  it('routes to review rather than asserting when there is no calibration', () => {
    const { results } = evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', null);
    const rule = findRule(results, 'R7_2_T1');

    expect(rule.verdict).toBe('REVIEW');
    expect(rule.note).toMatch(/millimetres/i);
  });

  it('is displaced entirely where another law governs the same information', () => {
    // Rule 7(4): the size requirements do not apply where the information is
    // also required under any other law in force.
    const { results } = evaluateCompliance(baseExtraction, '1.0.0', 'cosmetics', measurementsFor(0.2));

    expect(findRule(results, 'R7_2_T1').verdict).toBe('NOT_APPLICABLE');
    expect(findRule(results, 'R7_3').verdict).toBe('NOT_APPLICABLE');
  });

  it('checks width against one third of height under Rule 7(3)', () => {
    const narrow = measurementsFor(2.0);
    narrow.numeral.median_letter_width_mm = 0.4; // below 2.0 / 3

    const { results } = evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', narrow);
    const rule = findRule(results, 'R7_3');

    expect(rule.verdict).toBe('FAIL');
    expect(rule.found).toMatch(/one-third/i);
  });
});

describe('Confidence gating', () => {
  it('records the verdict as stated at HIGH confidence', () => {
    const { results } = evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', measurementsFor(1.4));
    expect(findRule(results, 'R7_2_T1').verdict).toBe('PASS');
  });

  it('downgrades a MEDIUM-confidence measurement to REVIEW but keeps the number', () => {
    const shaky = measurementsFor(1.4);
    shaky.numeral.confidence = 'MEDIUM';
    shaky.numeral.notes = ['Glyph heights vary by 40%.'];

    const rule = findRule(
      evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', shaky).results,
      'R7_2_T1'
    );

    expect(rule.verdict).toBe('REVIEW');
    expect(rule.measuredValue).toBe('1.40 mm');
    expect(rule.note).toMatch(/provisional verdict pass/i);
  });

  it('asserts nothing at LOW confidence', () => {
    const weak = measurementsFor(0.5);
    weak.numeral.confidence = 'LOW';

    const rule = findRule(
      evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', weak).results,
      'R7_2_T1'
    );

    expect(rule.verdict).toBe('REVIEW');
  });

  it('lets a curved surface downgrade an otherwise clean measurement', () => {
    const curved = measurementsFor(1.4);
    curved.calibration.confidence = 'LOW';
    curved.calibration.is_curved_surface = true;

    const rule = findRule(
      evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', curved).results,
      'R7_2_T1'
    );

    expect(rule.verdict).toBe('REVIEW');
  });
});

describe('Rule 8(1) clear space', () => {
  it('passes a declaration with the prescribed margins', () => {
    const rule = findRule(
      evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', measurementsFor(1.4)).results,
      'R8_1'
    );

    expect(rule.verdict).toBe('PASS');
  });

  it('fails when printed matter encroaches on the margin', () => {
    const crowded = measurementsFor(2.0);
    crowded.clearSpace.above_mm = 0.5; // below the one numeral height required
    crowded.clearSpace.satisfied = false;

    const rule = findRule(
      evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', crowded).results,
      'R8_1'
    );

    expect(rule.verdict).toBe('FAIL');
    expect(rule.found).toMatch(/above/i);
  });

  it('does not judge placement from a side panel capture', () => {
    const sidePanel = { ...baseExtraction, panel: 'side' };
    const rule = findRule(
      evaluateCompliance(sidePanel, '1.0.0', 'toilet_soap', measurementsFor(1.4)).results,
      'R8_1'
    );

    expect(rule.verdict).toBe('REVIEW');
    expect(rule.note).toMatch(/principal display panel/i);
  });
});

describe('Rule 9 manner of declaration', () => {
  it('passes adequate contrast', () => {
    const rule = findRule(
      evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', measurementsFor(1.4)).results,
      'R9_1_B'
    );

    expect(rule.verdict).toBe('PASS');
    expect(rule.measuredValue).toBe('12.4:1');
  });

  it('fails print that does not contrast conspicuously', () => {
    const faint = measurementsFor(1.4);
    faint.contrast = { ratio: 1.6, meets_wcag_aa: false, confidence: 'HIGH', notes: [] };

    const rule = findRule(
      evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', faint).results,
      'R9_1_B'
    );

    expect(rule.verdict).toBe('FAIL');
  });

  it('does not require contrast on a blown or moulded declaration', () => {
    const moulded = { ...baseExtraction, isBlownOrMoulded: true };
    const rule = findRule(
      evaluateCompliance(moulded, '1.0.0', 'toilet_soap', measurementsFor(4.0)).results,
      'R9_1_B'
    );

    // Proviso to Rule 9(1)(b).
    expect(rule.verdict).toBe('NOT_APPLICABLE');
  });

  it('accepts Devanagari or Latin under Rule 9(4)', () => {
    const devanagari = { ...baseExtraction, detectedScripts: ['Devanagari'] };
    expect(
      findRule(evaluateCompliance(devanagari, '1.0.0', 'toilet_soap', null).results, 'R9_4').verdict
    ).toBe('PASS');
  });

  it('never auto-fails the read-through-liquid check', () => {
    const rule = findRule(
      evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', measurementsFor(1.4)).results,
      'R9_2'
    );

    expect(rule.verdict).toBe('REVIEW');
  });
});

describe('Rule 6 text declarations', () => {
  it('does not fail consumer care for a missing e-mail alone', () => {
    // Rule 6(2) requires the e-mail only "if available".
    const noEmail = {
      ...baseExtraction,
      consumerCare: { name: 'Care Cell', address: 'Mumbai', telephone: '18001234567' }
    };

    const rule = findRule(evaluateCompliance(noEmail, '1.0.0', 'toilet_soap', null).results, 'R6_2');
    expect(rule.verdict).toBe('PASS');
    expect(rule.note).toMatch(/if available/i);
  });

  it('fails consumer care when the telephone is missing', () => {
    const noPhone = {
      ...baseExtraction,
      consumerCare: { name: 'Care Cell', address: 'Mumbai', email: 'care@abc.in' }
    };

    expect(
      findRule(evaluateCompliance(noPhone, '1.0.0', 'toilet_soap', null).results, 'R6_2').verdict
    ).toBe('FAIL');
  });

  it('reviews rather than fails a sticker over the MRP', () => {
    // A reduced-MRP sticker is expressly permitted, so this is an officer call.
    const stickered = { ...baseExtraction, hasStickerOverMRP: true };
    const rule = findRule(
      evaluateCompliance(stickered, '1.0.0', 'toilet_soap', null).results,
      'R6_3'
    );

    expect(rule.verdict).toBe('REVIEW');
    expect(rule.note).toMatch(/reduced mrp/i);
  });

  it('exempts bidi from both date marking and retail sale price', () => {
    const { results } = evaluateCompliance(baseExtraction, '1.0.0', 'bidi', null);

    expect(findRule(results, 'R6_1_D').verdict).toBe('NOT_APPLICABLE');
    expect(findRule(results, 'R6_1_E').verdict).toBe('NOT_APPLICABLE');
  });
});

describe('Spelling advisory', () => {
  it('recognises the statutory vocabulary', () => {
    const result = checkSpelling('Maximum Retail Price inclusive of all taxes net weight');
    expect(result.misspellings).toHaveLength(0);
    expect(result.score).toBe(1);
  });

  it('flags a misspelling and suggests the correction', () => {
    const result = checkSpelling('Maximam Retial Price');
    const words = result.misspellings.map((m) => m.word);

    expect(words).toContain('maximam');
    expect(result.misspellings.find((m) => m.word === 'maximam').suggestions).toContain('maximum');
  });

  it('recognises an OCR failure rather than blaming the speller', () => {
    const result = checkSpelling('xqz vbn plq zzz');
    expect(result.likelyOCRError).toBe(true);
  });

  it('never fails an inspection and never carries a penalty', () => {
    const misspelled = {
      ...baseExtraction,
      genericName: 'Bisciut',
      rawText: 'Bisciut Maximam Retial Pirce'
    };

    const evaluation = evaluateCompliance(misspelled, '1.0.0', 'toilet_soap', measurementsFor(1.4));
    const spell = findRule(evaluation.results, 'SPELL');

    expect(spell.verdict).toBe('REVIEW');
    expect(spell.spellCheck.misspellings.length).toBeGreaterThan(0);
    expect(evaluation.penaltyExposure.breakdown.find((b) => b.ruleId === 'SPELL')).toBeUndefined();
  });

  it('reports not-applicable when there is no description text', () => {
    expect(evaluateSpelling({}).verdict).toBe('NOT_APPLICABLE');
  });
});

describe('Evaluation summary', () => {
  it('counts every verdict class and prices only the failures', () => {
    const failing = measurementsFor(0.4);
    const evaluation = evaluateCompliance(baseExtraction, '1.0.0', 'toilet_soap', failing);

    expect(evaluation.summary.total).toBe(evaluation.results.length);
    expect(evaluation.summary.failed).toBe(evaluation.violations.length);
    expect(evaluation.summary.review).toBe(evaluation.needsReview.length);
    expect(evaluation.penaltyExposure.total).toBe(
      evaluation.violations.reduce((sum, v) => sum + (v.ruleId === 'R31_2' ? 4000 : 2000), 0)
    );
  });
});
