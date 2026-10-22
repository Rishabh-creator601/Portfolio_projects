function evaluateRule11(extracted, category) {
  const results = [];
  
  // R11_2 When packed qualifier
  let whenPackedVerdict = 'PASS';
  let hasWhenPacked = extracted.netQuantity && extracted.netQuantity.hasWhenPackedQualifier;
  if (hasWhenPacked && !category.whenPackedAllowed) {
    whenPackedVerdict = 'FAIL';
  }
  
  results.push({ ruleId: 'R11_2', citation: 'Rule 11(2)', check: 'When packed qualifier', found: hasWhenPacked ? 'Present' : 'Not present', verdict: whenPackedVerdict, confidence: 'HIGH' });
  
  return results;
}

module.exports = { evaluateRule11 };
