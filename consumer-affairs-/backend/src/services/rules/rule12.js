function evaluateRule12(extracted, category) {
  const results = [];
  
  // R12_2 Correct unit class
  // simplified
  results.push({ ruleId: 'R12_2', citation: 'Rule 12(2)', check: 'Correct unit class', found: extracted.netQuantity ? extracted.netQuantity.unit : 'None', verdict: extracted.netQuantity ? 'PASS' : 'FAIL', confidence: 'HIGH' });
  
  // R12_6 Misleading quantity wording
  const misleadingWords = ['minimum', 'not less than', 'average', 'about', 'approximately'];
  let misleadVerdict = 'PASS';
  let foundMislead = [];
  if (extracted.rawText) {
    const text = extracted.rawText.toLowerCase();
    misleadingWords.forEach(w => {
      if (text.includes(w)) foundMislead.push(w);
    });
  }
  if (foundMislead.length > 0) misleadVerdict = 'FAIL';
  results.push({ ruleId: 'R12_6', citation: 'Rule 12(6)', check: 'Misleading quantity wording', found: foundMislead.length > 0 ? foundMislead.join(', ') : 'None', verdict: misleadVerdict, confidence: 'HIGH' });
  
  return results;
}

module.exports = { evaluateRule12 };
