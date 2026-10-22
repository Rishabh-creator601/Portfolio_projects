/**
 * Mock OCR service for development until real ML is integrated.
 */

const TEMPLATES = [
  {
    type: 'compliant',
    tokens: [
      { text: 'Manufactured by', bbox: [10,20,200,35], confidence: 0.95, panel: 'principal' },
      { text: 'ABC Foods Pvt Ltd', bbox: [10,40,250,55], confidence: 0.92, panel: 'principal' },
      { text: '123, Industrial Area, New Delhi - 110001', bbox: [10,60,300,75], confidence: 0.88, panel: 'principal' },
      { text: 'Biscuits', bbox: [150,100,250,130], confidence: 0.97, panel: 'principal' },
      { text: 'Net Wt.', bbox: [10,150,80,165], confidence: 0.94, panel: 'principal' },
      { text: '200g', bbox: [85,150,130,165], confidence: 0.96, panel: 'principal' },
      { text: 'MRP Rs 40 incl. of all taxes', bbox: [10,180,280,195], confidence: 0.93, panel: 'principal' },
      { text: 'Consumer Care: 18001234567', bbox: [10,210,250,225], confidence: 0.91, panel: 'principal' },
    ],
    languages: ['en'],
    processingTime: 1200
  },
  {
    type: 'non-compliant',
    tokens: [
      { text: 'Manufactured by XYZ Corp', bbox: [10,20,200,35], confidence: 0.90, panel: 'principal' },
      { text: 'Soap', bbox: [150,100,250,130], confidence: 0.97, panel: 'principal' },
      { text: 'Net Qty: 100g', bbox: [10,150,130,165], confidence: 0.94, panel: 'principal' },
      { text: 'MRP 50', bbox: [10,180,100,195], confidence: 0.93, panel: 'principal' }
      // Missing address, date, consumer care
    ],
    languages: ['en'],
    processingTime: 950
  },
  {
    type: 'misleading',
    tokens: [
      { text: 'Super Chips', bbox: [50,50,200,80], confidence: 0.99, panel: 'principal' },
      { text: 'Approximately 500g', bbox: [10,150,200,165], confidence: 0.95, panel: 'principal' },
      { text: 'MRP ₹ 100', bbox: [10,180,100,195], confidence: 0.93, panel: 'principal' }
    ],
    languages: ['en'],
    processingTime: 1050
  }
];

function analyzeImage(imageBuffer) {
  // Simulate network delay and random response for demo purposes
  const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  return {
    ...template
  };
}

function getServiceStatus() {
  return {
    status: 'healthy',
    model: 'stub',
    note: 'Mock OCR service - replace with real EasyOCR sidecar'
  };
}

module.exports = { analyzeImage, getServiceStatus };
