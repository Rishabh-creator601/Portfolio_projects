function parseMRP(rawText) {
  if (!rawText) return { value: null, wording: '', isValid: false, violations: ['Missing MRP'] };
  
  const violations = [];
  let value = null;
  
  const valMatch = rawText.match(/(?:Rs\.?|₹|INR)\s*(\d+(?:\.\d{1,2})?)/i);
  if (valMatch) {
    value = parseFloat(valMatch[1]);
    const fraction = Math.round((value % 1) * 100);
    if (fraction > 0 && fraction < 50) {
      violations.push('MRP fraction should be rounded down or to 50 paise (Rule 2m)');
    } else if (fraction > 50 && fraction < 95) {
      violations.push('MRP fraction should be rounded to 50 paise (Rule 2m)');
    }
  } else {
    violations.push('Could not parse numeric value for MRP');
  }

  const hasMRPWord = /MRP|Maximum Retail Price/i.test(rawText);
  const hasInclTaxes = /incl\.? of all taxes|inclusive of all taxes/i.test(rawText);
  
  if (!hasMRPWord) violations.push('Missing prescribed wording "Maximum Retail Price" or "MRP"');
  if (!hasInclTaxes) violations.push('Missing prescribed wording "inclusive of all taxes"');

  return {
    value,
    wording: rawText,
    isValid: violations.length === 0,
    violations
  };
}

module.exports = {
  parseMRP
};
