const { normalizeUnit } = require('../src/utils/unitNormalizer');

describe('unitNormalizer', () => {
  it('normalizes gms to g', () => {
    const res = normalizeUnit(100, 'gms');
    expect(res.unit).toBe('g');
    expect(res.isStandard).toBe(true);
  });
  
  it('leaves unknown units alone', () => {
    const res = normalizeUnit(1, 'foo');
    expect(res.unit).toBe('foo');
    expect(res.isStandard).toBe(false);
  });
});
