const { normalizeUnit } = require('../../utils/unitNormalizer');

function evaluateRule13(extracted) {
  const results = [];
  
  // R13_2 Unit subdivision and SI units
  let v = 'FAIL';
  let found = 'No unit';
  if (extracted.netQuantity && extracted.netQuantity.unit) {
    const norm = normalizeUnit(extracted.netQuantity.value, extracted.netQuantity.unit);
    if (norm.isStandard) {
      v = 'PASS';
    }
    found = extracted.netQuantity.unit;
  }
  
  results.push({ ruleId: 'R13_2', citation: 'Rule 13(2)', check: 'Unit subdivision', found: found, verdict: v, confidence: 'HIGH' });
  
  return results;
}

module.exports = { evaluateRule13 };
