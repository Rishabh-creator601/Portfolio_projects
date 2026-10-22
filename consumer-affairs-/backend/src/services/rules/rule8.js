const { normalizeMeasurements, gate, weakest, LOW } = require('./measurements');

/**
 * Rule 8(1) -- principal display panel placement and clear space.
 *
 * "All declarations appear on the principal display panel, and the area around
 * the quantity declaration is free of printed matter: clear space above and
 * below at least equal to the numeral height, and to left and right at least
 * twice the numeral height."
 *
 * Measured geometrically off the same binarised mask the numeral height came
 * from, so it costs almost nothing once Rule 7 has been measured.
 */
function evaluateRule8(extracted, category, measurementInput) {
  const m = normalizeMeasurements(measurementInput, extracted);
  const space = m.clearSpace;

  // Which panel was photographed is answered by the officer at capture, not
  // inferred by a segmenter. An officer who photographed a side panel is told
  // so rather than having the declaration judged against the wrong panel.
  const panel = extracted.panel || 'principal';
  if (panel !== 'principal') {
    return [
      {
        ruleId: 'R8_1',
        citation: 'Rule 8(1)',
        check: 'Panel placement and clear space',
        found: `Capture is marked as the ${panel} panel`,
        required: 'Declarations must appear on the principal display panel',
        verdict: 'REVIEW',
        confidence: LOW,
        note: 'Re-capture the principal display panel to evaluate placement and clear space.'
      }
    ];
  }

  if (space.satisfied === null || space.requiredVerticalMm == null) {
    return [
      {
        ruleId: 'R8_1',
        citation: 'Rule 8(1)',
        check: 'Panel placement and clear space',
        found: 'Not measured',
        required: 'Clear space of one numeral height above and below, twice that left and right',
        verdict: 'REVIEW',
        confidence: LOW,
        note:
          space.notes.join(' ') ||
          'Clear space is prescribed in multiples of the numeral height, so it cannot be ' +
            'evaluated without a millimetre calibration.'
      }
    ];
  }

  const margins = [
    ['above', space.aboveMm, space.requiredVerticalMm],
    ['below', space.belowMm, space.requiredVerticalMm],
    ['left', space.leftMm, space.requiredHorizontalMm],
    ['right', space.rightMm, space.requiredHorizontalMm]
  ];

  const breaches = margins
    .filter(([, actual, required]) => actual != null && required != null && actual < required)
    .map(([side, actual, required]) => `${side} ${actual.toFixed(1)} mm of ${required.toFixed(1)} mm`);

  const gated = gate(
    breaches.length === 0 ? 'PASS' : 'FAIL',
    weakest(space.confidence, m.calibrationConfidence, m.numeralConfidence),
    space.notes
  );

  return [
    {
      ruleId: 'R8_1',
      citation: 'Rule 8(1)',
      check: 'Panel placement and clear space',
      found:
        breaches.length > 0
          ? `Encroached: ${breaches.join(', ')}`
          : `Clear: above ${fmt(space.aboveMm)}, below ${fmt(space.belowMm)}, ` +
            `left ${fmt(space.leftMm)}, right ${fmt(space.rightMm)}`,
      required:
        `${space.requiredVerticalMm.toFixed(1)} mm above and below, ` +
        `${space.requiredHorizontalMm.toFixed(1)} mm left and right`,
      verdict: gated.verdict,
      confidence: gated.confidence,
      measuredValue: `${fmt(space.aboveMm)} / ${fmt(space.belowMm)} / ${fmt(space.leftMm)} / ${fmt(space.rightMm)}`,
      prescribedValue: `${space.requiredVerticalMm.toFixed(1)} mm / ${space.requiredHorizontalMm.toFixed(1)} mm`,
      note: gated.note
    }
  ];
}

const fmt = (value) => (value == null ? '—' : `${value.toFixed(1)} mm`);

module.exports = { evaluateRule8 };
