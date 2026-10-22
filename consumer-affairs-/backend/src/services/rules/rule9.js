const { normalizeMeasurements, gate, LOW, HIGH } = require('./measurements');

/**
 * Rule 9 -- manner of declaration.
 *
 * 9(1)(a) legibility and prominence
 * 9(1)(b) MRP and net quantity numerals in a conspicuously contrasting colour
 * 9(2)   no declaration may need to be read through a liquid in the pack
 * 9(4)   declarations in Hindi in Devanagari script, or in English
 */
function evaluateRule9(extracted, category, measurementInput) {
  const results = [];
  const m = normalizeMeasurements(measurementInput, extracted);

  // --- R9_1_A: legibility and prominence ---
  // Legibility is a judgement, but a capture the quality gate rejected, or text
  // OCR read with poor confidence, is evidence the officer should see.
  const tokenConfidences = (extracted.tokenConfidences || []).filter((c) => typeof c === 'number');
  const meanTokenConfidence = tokenConfidences.length
    ? tokenConfidences.reduce((sum, c) => sum + c, 0) / tokenConfidences.length
    : null;

  if (!m.qualityAccepted) {
    results.push({
      ruleId: 'R9_1_A',
      citation: 'Rule 9(1)(a)',
      check: 'Legibility and prominence',
      found: 'Capture quality too poor to judge',
      required: 'Every declaration legible and prominent',
      verdict: 'REVIEW',
      confidence: LOW,
      note: m.qualityWarnings.join(' ') || 'Re-capture the panel before judging legibility.'
    });
  } else if (meanTokenConfidence != null && meanTokenConfidence < 0.6) {
    results.push({
      ruleId: 'R9_1_A',
      citation: 'Rule 9(1)(a)',
      check: 'Legibility and prominence',
      found: `Mean OCR confidence ${(meanTokenConfidence * 100).toFixed(0)}%`,
      required: 'Every declaration legible and prominent',
      verdict: 'REVIEW',
      confidence: LOW,
      note:
        'Text was read with low confidence across the panel, which may indicate poor ' +
        'legibility or a poor capture. An officer should look at the pack.'
    });
  } else {
    results.push({
      ruleId: 'R9_1_A',
      citation: 'Rule 9(1)(a)',
      check: 'Legibility and prominence',
      found:
        meanTokenConfidence != null
          ? `Declarations read cleanly (mean OCR confidence ${(meanTokenConfidence * 100).toFixed(0)}%)`
          : 'Declarations read cleanly',
      required: 'Every declaration legible and prominent',
      verdict: 'REVIEW',
      confidence: 'MEDIUM',
      // Machine-readable is not the same as legible and prominent to a consumer,
      // so this never closes on its own.
      note: 'Machine legibility is evidence, not a finding. Prominence is an officer judgement.'
    });
  }

  // --- R9_1_B: contrast of the MRP and quantity numerals ---
  // The proviso: contrast is not required where the information is blown,
  // formed or moulded on glass or plastic.
  const isBlown = Boolean(extracted.isBlownOrMoulded || (measurementInput || {}).isBlownOrMoulded);

  if (isBlown) {
    results.push({
      ruleId: 'R9_1_B',
      citation: 'Rule 9(1)(b)',
      check: 'Contrast of MRP and quantity',
      found: 'Declaration is blown, formed or moulded',
      required: 'Contrast not required for blown, formed or moulded declarations',
      verdict: 'NOT_APPLICABLE',
      confidence: HIGH,
      note: 'Proviso to Rule 9(1)(b).'
    });
  } else if (m.contrastRatio == null) {
    results.push({
      ruleId: 'R9_1_B',
      citation: 'Rule 9(1)(b)',
      check: 'Contrast of MRP and quantity',
      found: 'Not measured',
      required: 'Numerals in a colour contrasting conspicuously with the background',
      verdict: 'REVIEW',
      confidence: LOW,
      note: m.contrastNotes.join(' ') || 'No contrast measurement was returned for this capture.'
    });
  } else {
    const gated = gate(m.meetsContrast ? 'PASS' : 'FAIL', m.contrastConfidence, m.contrastNotes);

    results.push({
      ruleId: 'R9_1_B',
      citation: 'Rule 9(1)(b)',
      check: 'Contrast of MRP and quantity',
      found: `Luminance contrast ratio ${m.contrastRatio}:1`,
      required: 'Conspicuous contrast (assessed at the WCAG 3:1 large-text ratio)',
      verdict: gated.verdict,
      confidence: gated.confidence,
      measuredValue: `${m.contrastRatio}:1`,
      prescribedValue: '3:1',
      note: gated.note
    });
  }

  // --- R9_2: not to be read through a liquid ---
  // Flagged, never auto-failed: whether a declaration must be read through the
  // contents depends on the filled pack, which a single photograph of the panel
  // cannot settle.
  results.push({
    ruleId: 'R9_2',
    citation: 'Rule 9(2)',
    check: 'Not read through liquid',
    found: 'Requires inspection of the filled pack',
    required: 'No declaration may need to be read through the liquid in the package',
    verdict: 'REVIEW',
    confidence: LOW,
    note: 'Check this on the filled pack, not the empty one.'
  });

  // --- R9_4: language ---
  const scripts = Array.isArray(extracted.detectedScripts) ? extracted.detectedScripts : [];
  const permitted = scripts.filter((s) => /devanagari|latin/i.test(String(s)));

  if (scripts.length === 0) {
    results.push({
      ruleId: 'R9_4',
      citation: 'Rule 9(4)',
      check: 'Language',
      found: 'No script detected',
      required: 'Hindi in Devanagari script, or English',
      verdict: 'REVIEW',
      confidence: LOW,
      note: 'No text was read, so the script could not be determined.'
    });
  } else {
    const verdict = permitted.length > 0 ? 'PASS' : 'FAIL';
    results.push({
      ruleId: 'R9_4',
      citation: 'Rule 9(4)',
      check: 'Language',
      found: scripts.join(', '),
      required: 'Hindi in Devanagari script, or English',
      verdict,
      confidence: HIGH,
      note:
        verdict === 'PASS'
          ? 'Any additional language is permitted alongside.'
          : 'Declarations were read in a script the Rules do not permit on their own.'
    });
  }

  return results;
}

module.exports = { evaluateRule9 };
