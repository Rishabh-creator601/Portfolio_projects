const {
  lookupTableI,
  lookupTableII,
  normalizeMeasurements,
  gate,
  weakest,
  toBaseUnits,
  isCountOrMeasure,
  MIN_LETTER_HEIGHT_MM,
  MIN_WIDTH_TO_HEIGHT_RATIO,
  LOW
} = require('./measurements');

/**
 * Rule 7 -- principal display panel, size and placement.
 *
 * Every height here is prescribed in millimetres, and a photograph carries no
 * physical scale. So without a calibration these checks return REVIEW rather
 * than a verdict the image cannot support. That is not a gap in the system; it
 * is the system refusing to assert something it cannot defend.
 */
function evaluateRule7(extracted, category, measurementInput) {
  const results = [];
  const m = normalizeMeasurements(measurementInput, extracted);
  const netQuantity = extracted.netQuantity || {};
  const isBlown = Boolean(extracted.isBlownOrMoulded || (measurementInput || {}).isBlownOrMoulded);

  // Rule 7(4): Rules 7(1) to 7(3) do not apply where the same information is
  // also required under any other law in force -- food under FSSAI, cosmetics
  // under the Drugs and Cosmetics Rules, and so on.
  if (category && category.overridingLaw) {
    const reason = `Rule 7(4): size requirements are displaced by ${category.overridingLaw}.`;
    return [
      naRow('R7_2_T1', 'Rule 7(2) Table I', 'Numeral height by weight/volume', reason),
      naRow('R7_2_T2', 'Rule 7(2) Table II', 'Numeral height by panel area', reason),
      naRow('R7_3', 'Rule 7(3)', 'Letter height and width', reason)
    ];
  }

  const uncalibratedReasons = [
    'Rule 7 prescribes heights in millimetres and no scale reference was captured.',
    'Include a reference card beside the declaration, or enter a known package dimension.'
  ];

  // --- R7_2_T1: numeral height by weight or volume ---
  const grams = toBaseUnits(netQuantity);
  const byCount = isCountOrMeasure(netQuantity);

  if (byCount) {
    results.push(
      naRow(
        'R7_2_T1',
        'Rule 7(2) Table I',
        'Numeral height by weight/volume',
        'Quantity is declared by number or measure, so Table II governs instead.'
      )
    );
  } else if (grams == null) {
    results.push(
      reviewRow(
        'R7_2_T1',
        'Rule 7(2) Table I',
        'Numeral height by weight/volume',
        'Net quantity could not be read, so the applicable height band is unknown.'
      )
    );
  } else {
    const required = lookupTableI(grams, isBlown);
    const measured = m.numeralHeightMm;

    if (measured == null) {
      results.push(
        reviewRow(
          'R7_2_T1',
          'Rule 7(2) Table I',
          'Numeral height by weight/volume',
          m.isCalibrated
            ? (m.numeralNotes.join(' ') || 'The numerals could not be measured in this image.')
            : uncalibratedReasons.join(' '),
          { required: `${required.mm} mm minimum (${required.band})` }
        )
      );
    } else {
      const confidence = weakest(m.numeralConfidence, m.calibrationConfidence);
      const verdict = measured >= required.mm ? 'PASS' : 'FAIL';
      const gated = gate(verdict, confidence, [...m.numeralNotes]);

      results.push({
        ruleId: 'R7_2_T1',
        citation: 'Rule 7(2) Table I',
        check: 'Numeral height by weight/volume',
        found: `${measured.toFixed(2)} mm measured`,
        required: `${required.mm} mm minimum (${required.band}${isBlown ? ', blown or moulded' : ''})`,
        verdict: gated.verdict,
        confidence: gated.confidence,
        measuredValue: `${measured.toFixed(2)} mm`,
        prescribedValue: `${required.mm} mm`,
        note: gated.note
      });
    }
  }

  // --- R7_2_T2: numeral height by principal display panel area ---
  if (!byCount) {
    results.push(
      naRow(
        'R7_2_T2',
        'Rule 7(2) Table II',
        'Numeral height by panel area',
        'Quantity is declared by weight or volume, so Table I governs instead.'
      )
    );
  } else if (m.panelAreaCm2 == null) {
    results.push(
      reviewRow(
        'R7_2_T2',
        'Rule 7(2) Table II',
        'Numeral height by panel area',
        'The principal display panel area could not be measured from this capture.'
      )
    );
  } else {
    const required = lookupTableII(m.panelAreaCm2, isBlown);
    const measured = m.numeralHeightMm;

    if (measured == null) {
      results.push(
        reviewRow(
          'R7_2_T2',
          'Rule 7(2) Table II',
          'Numeral height by panel area',
          m.isCalibrated ? 'The numerals could not be measured.' : uncalibratedReasons.join(' '),
          { required: `${required.mm} mm minimum (${required.band})` }
        )
      );
    } else {
      const confidence = weakest(m.numeralConfidence, m.calibrationConfidence, m.panelConfidence);
      const gated = gate(measured >= required.mm ? 'PASS' : 'FAIL', confidence, [
        'Panel area is estimated from the captured frame.'
      ]);

      results.push({
        ruleId: 'R7_2_T2',
        citation: 'Rule 7(2) Table II',
        check: 'Numeral height by panel area',
        found: `${measured.toFixed(2)} mm on a ${m.panelAreaCm2} cm² panel`,
        required: `${required.mm} mm minimum (${required.band})`,
        verdict: gated.verdict,
        confidence: gated.confidence,
        measuredValue: `${measured.toFixed(2)} mm`,
        prescribedValue: `${required.mm} mm`,
        note: gated.note
      });
    }
  }

  // --- R7_3: letter height at least 1 mm (2 mm blown), width at least a third ---
  const height = m.numeralHeightMm;
  const width = m.letterWidthMm;
  const minHeight = isBlown ? MIN_LETTER_HEIGHT_MM.blown : MIN_LETTER_HEIGHT_MM.normal;

  if (height == null || width == null) {
    results.push(
      reviewRow(
        'R7_3',
        'Rule 7(3)',
        'Letter height and width',
        m.isCalibrated
          ? 'Glyph geometry could not be measured in this image.'
          : uncalibratedReasons.join(' '),
        { required: `${minHeight} mm tall, width at least one-third of height` }
      )
    );
  } else {
    const requiredWidth = height * MIN_WIDTH_TO_HEIGHT_RATIO;
    const heightOk = height >= minHeight;
    const widthOk = width >= requiredWidth;

    const failures = [];
    if (!heightOk) failures.push(`height ${height.toFixed(2)} mm is below ${minHeight} mm`);
    if (!widthOk) {
      failures.push(`width ${width.toFixed(2)} mm is below one-third of height (${requiredWidth.toFixed(2)} mm)`);
    }

    const gated = gate(
      failures.length === 0 ? 'PASS' : 'FAIL',
      weakest(m.numeralConfidence, m.calibrationConfidence),
      [
        // The proviso excludes the numeral '1' and the letters i, I and l from
        // the width test; a median over the whole string cannot tell which
        // glyphs those were, so a marginal width is never asserted as a breach.
        "Numeral '1' and the letters i, I and l are exempt from the width test."
      ]
    );

    results.push({
      ruleId: 'R7_3',
      citation: 'Rule 7(3)',
      check: 'Letter height and width',
      found:
        failures.length > 0
          ? failures.join('; ')
          : `height ${height.toFixed(2)} mm, width ${width.toFixed(2)} mm`,
      required: `${minHeight} mm tall, width at least one-third of height`,
      verdict: gated.verdict,
      confidence: gated.confidence,
      measuredValue: `${height.toFixed(2)} × ${width.toFixed(2)} mm`,
      prescribedValue: `≥ ${minHeight} mm, width ≥ ${requiredWidth.toFixed(2)} mm`,
      note: gated.note
    });
  }

  return results;
}

function naRow(ruleId, citation, check, reason) {
  return {
    ruleId,
    citation,
    check,
    found: 'Not applicable',
    required: '—',
    verdict: 'NOT_APPLICABLE',
    confidence: 'HIGH',
    note: reason
  };
}

function reviewRow(ruleId, citation, check, reason, extra = {}) {
  return {
    ruleId,
    citation,
    check,
    found: 'Not measured',
    required: extra.required || '—',
    verdict: 'REVIEW',
    confidence: LOW,
    note: reason
  };
}

module.exports = { evaluateRule7, lookupTableI, lookupTableII };
