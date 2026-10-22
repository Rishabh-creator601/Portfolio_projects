/**
 * Compliance over a Gemini extraction.
 *
 * The boundary these tests protect: the model extracts, pure functions decide.
 * Every verdict here must be reproducible from the extracted JSON alone, and
 * the checks that need a physical measurement must say so rather than guess.
 */

const {
  evaluateExtraction,
  deriveVerdict,
  scopeGate,
  toRuleInput,
  MEASUREMENT_RULES
} = require('../src/services/geminiCompliance');
const { resolveCategory } = require('../src/services/categoryResolver');

/** A fully compliant biscuit pack as Gemini would return it. */
const compliantPack = () => ({
  manufacturer: {
    name: 'ABC Foods Pvt Ltd',
    address: '123, Industrial Area, New Delhi 110001',
    qualifier: 'manufactured by'
  },
  genericName: 'Biscuits',
  netQuantity: { value: 200, unit: 'g', raw: 'Net Wt. 200 g' },
  monthYear: { month: '08', year: '2026', raw: '08/2026' },
  mrp: {
    value: 40,
    wording: 'MRP Rs 40.00 inclusive of all taxes',
    raw: 'MRP Rs 40.00 inclusive of all taxes'
  },
  consumerCare: {
    name: 'Consumer Care Cell',
    address: 'Mumbai 400001',
    phone: '18001234567',
    email: 'care@abcfoods.in'
  },
  additionalInfo: { extractionConfidence: 0.95, otherText: [] }
});

const ruleFor = (evaluation, ruleId) => evaluation.results.find((r) => r.ruleId === ruleId);

describe('Category resolution', () => {
  it.each([
    ['Carbonated Water', 'aerated_beverage'],
    ['Biscuits', 'biscuits_bread'],
    ['Toilet Soap', 'toilet_soap'],
    ['Bidi', 'bidi'],
    ['Packaged Drinking Water', 'packaged_water'],
    ['Shampoo', 'cosmetics']
  ])('resolves %s to %s', (genericName, expected) => {
    expect(resolveCategory({ genericName }).categoryId).toBe(expected);
  });

  it('falls back to unknown rather than guessing', () => {
    const result = resolveCategory({ genericName: 'Widget 3000' });
    expect(result.categoryId).toBe('unknown');
    expect(result.confidence).toBe('LOW');
  });

  it('lets an explicit category beat the keyword match', () => {
    const result = resolveCategory({ genericName: 'Biscuits', explicitCategory: 'bidi' });
    expect(result.categoryId).toBe('bidi');
    expect(result.matchedOn).toBe('explicit');
  });
});

describe('Measurement rules are never guessed', () => {
  it('reports every millimetre rule as NOT_ASSESSED', () => {
    const evaluation = evaluateExtraction(compliantPack());

    for (const ruleId of Object.keys(MEASUREMENT_RULES)) {
      const rule = ruleFor(evaluation, ruleId);
      expect(rule).toBeDefined();
      expect(rule.verdict).toBe('NOT_ASSESSED');
      expect(rule.note).toMatch(/does not measure it/i);
    }
  });

  it('never prices a not-assessed rule', () => {
    const evaluation = evaluateExtraction(compliantPack());
    const priced = evaluation.penaltyExposure.breakdown.map((b) => b.ruleId);

    for (const ruleId of Object.keys(MEASUREMENT_RULES)) {
      expect(priced).not.toContain(ruleId);
    }
  });
});

describe('Rule 6 over an extraction', () => {
  it('passes a complete pack', () => {
    const evaluation = evaluateExtraction(compliantPack());

    expect(ruleFor(evaluation, 'R6_1_A').verdict).toBe('PASS');
    expect(ruleFor(evaluation, 'R6_1_B').verdict).toBe('PASS');
    expect(ruleFor(evaluation, 'R6_1_C').verdict).toBe('PASS');
    expect(ruleFor(evaluation, 'R6_1_E').verdict).toBe('PASS');
    expect(ruleFor(evaluation, 'R6_2').verdict).toBe('PASS');
    expect(evaluation.summary.failed).toBe(0);
  });

  it('fails an MRP that omits the prescribed tax wording', () => {
    const pack = compliantPack();
    pack.mrp = { value: 40, wording: 'MRP Rs 40.00', raw: 'MRP Rs 40.00' };

    const rule = ruleFor(evaluateExtraction(pack), 'R6_1_E');
    expect(rule.verdict).toBe('FAIL');
    expect(rule.note).toMatch(/inclusive of all taxes/i);
  });

  it('fails a missing manufacturer address', () => {
    const pack = compliantPack();
    pack.manufacturer.address = null;

    expect(ruleFor(evaluateExtraction(pack), 'R6_1_A').verdict).toBe('FAIL');
  });

  it('applies the category exemption for date marking', () => {
    // A soft drink is food, so Rule 6(1)(d) is governed by FSSAI.
    const pack = compliantPack();
    pack.genericName = 'Carbonated Water';
    pack.monthYear = { raw: null };

    const evaluation = evaluateExtraction(pack);
    expect(evaluation.category.categoryId).toBe('aerated_beverage');
    expect(ruleFor(evaluation, 'R6_1_D').verdict).toBe('NOT_APPLICABLE');
  });

  it('exempts bidi from both date and retail sale price', () => {
    const pack = compliantPack();
    pack.genericName = 'Bidi';
    pack.monthYear = { raw: null };
    pack.mrp = { value: null, raw: null };

    const evaluation = evaluateExtraction(pack);
    expect(ruleFor(evaluation, 'R6_1_D').verdict).toBe('NOT_APPLICABLE');
    expect(ruleFor(evaluation, 'R6_1_E').verdict).toBe('NOT_APPLICABLE');
  });
});

describe('Rule 9(4) language', () => {
  it('derives the script from the transcribed characters', () => {
    // Not from the model's own answer, which it may omit entirely.
    const pack = compliantPack();
    pack.additionalInfo.scriptsPresent = [];

    const rule = ruleFor(evaluateExtraction(pack), 'R9_4');
    expect(rule.verdict).toBe('PASS');
    expect(rule.found).toContain('Latin');
  });

  it('recognises Devanagari alongside Latin', () => {
    const pack = compliantPack();
    pack.genericName = 'बिस्कुट Biscuits';

    const rule = ruleFor(evaluateExtraction(pack), 'R9_4');
    expect(rule.found).toContain('Devanagari');
    expect(rule.verdict).toBe('PASS');
  });
});

describe('Scope gate', () => {
  it('excludes a pack of 10 g or less under Rule 26(a)', () => {
    const result = scopeGate({ netQuantity: { value: 8, unit: 'g' } }, {});
    expect(result.inScope).toBe(false);
    expect(result.citation).toBe('Rule 26(a)');
  });

  it('excludes a pack over 25 kg under Rule 3(a)', () => {
    const result = scopeGate({ netQuantity: { value: 30, unit: 'kg' } }, {});
    expect(result.inScope).toBe(false);
    expect(result.citation).toBe('Rule 3(a)');
  });

  it('lets cement up to 50 kg stay in scope', () => {
    // Rule 3(a) lifts the ceiling for cement and fertiliser only.
    const result = scopeGate({ netQuantity: { value: 50, unit: 'kg' } }, { maxRetailWeightKg: 50 });
    expect(result.inScope).toBe(true);
  });

  it('issues no checklist for an out-of-scope pack', () => {
    const pack = compliantPack();
    pack.netQuantity = { value: 5, unit: 'g', raw: '5 g' };

    const evaluation = evaluateExtraction(pack);
    expect(evaluation.inScope).toBe(false);
    expect(evaluation.results).toHaveLength(0);
    expect(deriveVerdict(evaluation)).toBe('not_applicable');
  });
});

describe('Overall verdict', () => {
  it('is non_compliant when any rule fails', () => {
    const pack = compliantPack();
    pack.manufacturer.name = null;

    expect(deriveVerdict(evaluateExtraction(pack))).toBe('non_compliant');
  });

  it('is review when nothing failed but something was not assessed', () => {
    // A clean pack still has the millimetre rules outstanding, so this path
    // must never report a bare "compliant".
    const evaluation = evaluateExtraction(compliantPack());

    expect(evaluation.summary.failed).toBe(0);
    expect(evaluation.summary.notAssessed).toBeGreaterThan(0);
    expect(deriveVerdict(evaluation)).toBe('review');
  });

  it('prices failures at the Rule 32 rate', () => {
    const pack = compliantPack();
    pack.manufacturer.name = null;
    pack.mrp = { value: 40, wording: 'MRP Rs 40.00', raw: 'MRP Rs 40.00' };

    const evaluation = evaluateExtraction(pack);
    expect(evaluation.penaltyExposure.total).toBe(evaluation.summary.failed * 2000);
  });
});

describe('Rule input mapping', () => {
  it('converts the net quantity to grams for the band lookup', () => {
    const input = toRuleInput({ netQuantity: { value: 1.5, unit: 'kg' } });
    expect(input.netQuantity.valueInGrams).toBe(1500);
  });

  it('carries the sticker signal through to Rule 6(3)', () => {
    const pack = compliantPack();
    pack.additionalInfo.stickerOverDeclaration = { present: true, covers_declaration: 'mrp' };

    const rule = ruleFor(evaluateExtraction(pack), 'R6_3');
    expect(rule.verdict).toBe('REVIEW');
    expect(rule.note).toMatch(/reduced mrp/i);
  });

  it('builds searchable text for the misleading-wording rule', () => {
    const pack = compliantPack();
    pack.netQuantity.raw = 'Net Wt. approximately 200 g';

    const rule = ruleFor(evaluateExtraction(pack), 'R12_6');
    expect(rule.verdict).toBe('FAIL');
    expect(rule.found).toContain('approximately');
  });
});
