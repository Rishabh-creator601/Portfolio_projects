const { parseMRP } = require('../src/utils/priceParser');

describe('priceParser', () => {
  it('parses valid MRP', () => {
    const res = parseMRP('Maximum Retail Price Rs 100.50 inclusive of all taxes');
    expect(res.isValid).toBe(true);
    expect(res.value).toBe(100.50);
  });

  it('fails on missing inclusive of all taxes', () => {
    const res = parseMRP('MRP Rs 100.50');
    expect(res.isValid).toBe(false);
    expect(res.violations).toContain('Missing prescribed wording "inclusive of all taxes"');
  });
  
  it('warns on improper rounding', () => {
    const res = parseMRP('MRP Rs 100.25 inclusive of all taxes');
    expect(res.violations).toContain('MRP fraction should be rounded down or to 50 paise (Rule 2m)');
  });
});
