const { parseMRP } = require('../../utils/priceParser');
const { parseMonthYear } = require('../../utils/dateParser');

/**
 * Rule 6 -- the mandatory declarations on every retail package.
 *
 * These are the six heads plus the consumer-care block and the sticker rule.
 * All are read from text, so they do not depend on the millimetre calibration
 * that Rules 7 to 9 need.
 */
function evaluateRule6(extracted, category = {}) {
  const results = [];
  const exemptions = category.exemptions || {};

  // --- R6_1_A: manufacturer / packer / importer, name and complete address ---
  const mfg = extracted.manufacturer || {};
  const missingMfg = [];
  if (!mfg.name) missingMfg.push('name');
  if (!mfg.address) missingMfg.push('complete address');

  const mfgNote = mfg.qualifier
    ? `Attributed as "${mfg.qualifier}".`
    : // Explanation I: a name with no qualifier is presumed to be the
      // manufacturer's, and liability follows accordingly.
      'No "manufactured by" / "packed by" / "imported by" qualifier was found. Under ' +
      'Explanation I to Rule 6 the name is presumed to be the manufacturer\'s.';

  results.push({
    ruleId: 'R6_1_A',
    citation: 'Rule 6(1)(a)',
    check: 'Manufacturer / packer / importer name and address',
    found: missingMfg.length
      ? `Missing: ${missingMfg.join(', ')}`
      : `${mfg.name}, ${mfg.address}`,
    required: 'Name and complete address, per Rule 10(1)',
    verdict: missingMfg.length ? 'FAIL' : 'PASS',
    confidence: 'HIGH',
    note: mfgNote
  });

  // --- R6_1_B: common or generic name ---
  // The generic name is an unstructured head: regex cannot tell "Parle-G" from
  // "Biscuits", so a low-confidence read is routed to the officer rather than
  // guessed at.
  const genericName = extracted.genericName;
  results.push({
    ruleId: 'R6_1_B',
    citation: 'Rule 6(1)(b)',
    check: 'Common or generic name',
    found: genericName || 'Not found',
    required: 'The generic name of the commodity, not the brand name',
    verdict: genericName ? 'PASS' : 'FAIL',
    confidence: genericName ? 'MEDIUM' : 'HIGH',
    note: genericName
      ? 'Confirm this is the generic name and not the brand; the two are easily confused.'
      : 'No commodity name was recognised on the panel.'
  });

  // --- R6_1_C: net quantity in the standard unit ---
  const netQuantity = extracted.netQuantity || {};
  const hasQuantity = netQuantity.value != null && Boolean(netQuantity.unit);

  results.push({
    ruleId: 'R6_1_C',
    citation: 'Rule 6(1)(c)',
    check: 'Net quantity declared',
    found: hasQuantity ? `${netQuantity.value} ${netQuantity.unit}` : 'Not found',
    required: 'Net quantity in the standard unit of weight, measure or number',
    verdict: hasQuantity ? 'PASS' : 'FAIL',
    confidence: 'HIGH',
    note: hasQuantity ? 'Unit verified against the Fourth Schedule by Rule 12.' : null
  });

  // --- R6_1_D: month and year of manufacture, pre-packing or import ---
  // Food, cosmetics and seeds are governed by other laws; bidi, incense sticks
  // and PSU LPG cylinders are exempt outright.
  if (exemptions.date) {
    results.push({
      ruleId: 'R6_1_D',
      citation: 'Rule 6(1)(d)',
      check: 'Month and year of packing',
      found: 'Exempt for this category',
      required: '—',
      verdict: 'NOT_APPLICABLE',
      confidence: 'HIGH',
      note:
        exemptions.reason ||
        `Date marking for ${category.name || category.id} is governed elsewhere.`
    });
  } else {
    const raw = extracted.monthYear;
    const parsed = parseMonthYear(raw);
    const hasDate = Boolean(parsed.month && parsed.year);

    results.push({
      ruleId: 'R6_1_D',
      citation: 'Rule 6(1)(d)',
      check: 'Month and year of packing',
      found: raw || 'Not found',
      required: 'Month and year, in words, numerals or both',
      verdict: hasDate ? 'PASS' : 'FAIL',
      confidence: 'HIGH',
      note: hasDate ? `Parsed as ${parsed.month}/${parsed.year}.` : null
    });
  }

  // --- R6_1_E: retail sale price ---
  if (exemptions.mrp) {
    results.push({
      ruleId: 'R6_1_E',
      citation: 'Rule 6(1)(e)',
      check: 'Retail sale price',
      found: 'Exempt for this category',
      required: '—',
      verdict: 'NOT_APPLICABLE',
      confidence: 'HIGH',
      note: exemptions.reason || null
    });
  } else {
    const mrp = parseMRP(extracted.mrp);

    results.push({
      ruleId: 'R6_1_E',
      citation: 'Rule 6(1)(e)',
      check: 'Retail sale price',
      found: extracted.mrp || 'Not found',
      required: '"Maximum retail price Rs ... inclusive of all taxes", rounded per Rule 2(m)',
      verdict: mrp.isValid ? 'PASS' : 'FAIL',
      confidence: 'HIGH',
      measuredValue: mrp.value != null ? `Rs ${mrp.value}` : null,
      note: mrp.violations.length ? mrp.violations.join('; ') : null
    });
  }

  // --- R6_1_F: dimensions, where size is relevant ---
  // Only bites where the commodity's size is material, which the category
  // defines; elsewhere it is simply not applicable.
  if (category.dimensionsRelevant) {
    const dimensions = extracted.dimensions;
    results.push({
      ruleId: 'R6_1_F',
      citation: 'Rule 6(1)(f)',
      check: 'Dimensions of the commodity',
      found: dimensions || 'Not found',
      required: 'Dimensions where size is relevant, each piece separately if they differ',
      verdict: dimensions ? 'PASS' : 'FAIL',
      confidence: 'MEDIUM'
    });
  } else {
    results.push({
      ruleId: 'R6_1_F',
      citation: 'Rule 6(1)(f)',
      check: 'Dimensions of the commodity',
      found: 'Not applicable to this commodity',
      required: '—',
      verdict: 'NOT_APPLICABLE',
      confidence: 'HIGH',
      note: 'Dimensions are declared only where the size of the commodity is relevant.'
    });
  }

  // --- R6_2: consumer-complaint contact ---
  // "name, address, telephone number and e-mail address if available". The
  // e-mail is conditional; the other three are not. A standalone requirement,
  // not satisfied by the manufacturer's address alone.
  const care = extracted.consumerCare || {};
  const missingCare = [];
  if (!care.name) missingCare.push('contact name or office');
  if (!care.address) missingCare.push('address');
  if (!care.telephone && !care.phone) missingCare.push('telephone number');

  const hasEmail = Boolean(care.email);

  results.push({
    ruleId: 'R6_2',
    citation: 'Rule 6(2)',
    check: 'Consumer care details',
    found: missingCare.length
      ? `Missing: ${missingCare.join(', ')}`
      : `Complete${hasEmail ? ' with e-mail' : ''}`,
    required: 'Name, address and telephone of the contact; e-mail if available',
    verdict: missingCare.length ? 'FAIL' : 'PASS',
    confidence: 'HIGH',
    note: hasEmail
      ? null
      : 'No e-mail address found. Rule 6(2) requires it only "if available", so its ' +
        'absence is not on its own a breach.'
  });

  // --- R6_3: stickers over mandatory declarations ---
  // Assisted, never auto-failed: a sticker showing a *reduced* MRP inclusive of
  // all taxes is expressly permitted, provided it does not cover the original
  // price printed by the manufacturer. Telling those apart is an officer's call.
  if (extracted.hasStickerOverMRP) {
    results.push({
      ruleId: 'R6_3',
      citation: 'Rule 6(3)',
      check: 'Sticker over a mandatory declaration',
      found: 'A sticker was detected over the price declaration',
      required: 'No sticker may alter or make a mandatory declaration',
      verdict: 'REVIEW',
      confidence: 'LOW',
      note:
        'A sticker declaring a reduced MRP inclusive of all taxes is permitted, so long as ' +
        'it does not cover the original price. Confirm which this is before deciding.'
    });
  } else {
    results.push({
      ruleId: 'R6_3',
      citation: 'Rule 6(3)',
      check: 'Sticker over a mandatory declaration',
      found: 'No sticker detected',
      required: 'No sticker may alter or make a mandatory declaration',
      verdict: 'PASS',
      confidence: 'MEDIUM',
      note: 'Detected by edge and texture discontinuity; confirm on the physical pack.'
    });
  }

  return results;
}

module.exports = { evaluateRule6 };
