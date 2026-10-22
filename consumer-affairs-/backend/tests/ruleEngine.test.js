const { evaluateCompliance } = require('../src/services/ruleEngine');

describe('Rule Engine Tests', () => {
  it('Fully compliant product', () => {
    const extractedData = {
      manufacturer: { name: 'Acme', address: '123 St' },
      genericName: 'Soap',
      netQuantity: { value: 100, unit: 'g', valueInGrams: 100, hasWhenPackedQualifier: false },
      monthYear: '01/2024',
      mrp: 'Maximum Retail Price Rs 10.00 inclusive of all taxes',
      consumerCare: { name: 'CC', address: '123', telephone: '123', email: 'a@a.com' },
      hasStickerOverMRP: false,
      declarations: { bbox: {}, numeralHeightMm: 5, letterWidthMm: 2 },
      contrastRatio: 5,
      detectedScripts: ['Latin'],
      rawText: 'clean soap'
    };
    
    const calibrationData = { isCalibrated: true };
    const result = evaluateCompliance(extractedData, 'v1', 'toilet_soap', calibrationData);
    
    expect(result.violations.length).toBe(0);
    expect(result.penaltyExposure.total).toBe(0);
  });
  
  it('Missing manufacturer fails R6_1_A', () => {
    const extractedData = {
      genericName: 'Soap'
    };
    const result = evaluateCompliance(extractedData, 'v1', 'toilet_soap', null);
    
    const v = result.violations.find(x => x.ruleId === 'R6_1_A');
    expect(v).toBeDefined();
  });
});
