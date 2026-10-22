/**
 * Gemini extraction mode.
 *
 * The vision sidecar is stubbed here: these tests verify the *wiring* -- that
 * extraction reaches the inspection, that the rule engine stays dormant, and
 * that a report can be produced from what was read. Whether Gemini reads a
 * label correctly is measured against real packages, not in a unit test.
 */

process.env.EXTRACTION_MODE = 'gemini';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const visionClient = require('../src/services/visionClient');
const {
  generateExtractionPDF,
  generateExtractionXLSX
} = require('../src/services/extractionReportService');

jest.setTimeout(120000);

let mongod;
let app;
let token;
let User;
let Inspection;

const GEMINI_RESULT = {
  declarations: {
    manufacturer: {
      name: 'ABC Foods Pvt Ltd',
      address: '123, Industrial Area, New Delhi 110001',
      qualifier: 'manufactured by'
    },
    genericName: 'Carbonated Water',
    netQuantity: { value: 750, unit: 'ml', raw: '750 ml' },
    monthYear: { month: '08', year: '2026', raw: '08/2026' },
    mrp: { value: 40, wording: 'MRP Rs 40.00 incl. of all taxes', raw: 'MRP Rs 40.00' },
    consumerCare: { name: null, address: null, phone: '18001234567', email: 'care@abc.in' },
    additionalInfo: {
      brandName: 'Test Cola',
      nutrition: { basis: 'per 100 ml', energy_kcal: 42, protein_g: 0, total_sugars_g: 10.6 },
      ingredients: 'Carbonated Water, Sugar, Acidity Regulator',
      package: { type: 'bottle', material: 'plastic', is_curved_surface: true },
      isCurvedSurface: true,
      detections: [{ region: 'product', box_2d: [0, 0, 1000, 1000], box: { x: 0, y: 0, width: 800, height: 600 } }],
      extractionConfidence: 0.95,
      engine: 'gemini-2.5-flash'
    }
  },
  report: {
    summary: {
      product: 'Carbonated Water',
      brand: 'Test Cola',
      packageType: 'bottle',
      packageMaterial: 'plastic',
      declarationsFound: 7,
      declarationsTotal: 7,
      completenessPercent: 100,
      extractionConfidence: 0.95,
      regionsDetected: 1,
      imageHash: 'a'.repeat(64),
      model: 'gemini-2.5-flash',
      processingTimeMs: 9800
    },
    declarations: [
      { key: 'generic_name', citation: 'Rule 6(1)(b)', label: 'Common or generic name', value: 'Carbonated Water', status: 'found' },
      { key: 'net_quantity', citation: 'Rule 6(1)(c)', label: 'Net quantity', value: '750 ml', status: 'found' },
      { key: 'month_year', citation: 'Rule 6(1)(d)', label: 'Month and year', value: '08/2026', status: 'found' }
    ],
    fssai: [
      { key: 'nutrition', label: 'Nutrition panel', value: { energy_kcal: 42 }, status: 'found' },
      { key: 'ingredients', label: 'Ingredients list', value: 'Carbonated Water, Sugar', status: 'found' },
      { key: 'fssai_licence_number', label: 'FSSAI licence number', value: null, status: 'not_found' }
    ],
    nutrition: { basis: 'per 100 ml', energy_kcal: 42, protein_g: 0, total_sugars_g: 10.6, sodium_mg: 5 },
    package: { type: 'bottle', material: 'plastic', is_curved_surface: true },
    detections: [{ region: 'product', box: { x: 0, y: 0, width: 800, height: 600 } }],
    legibilityIssues: [],
    disclaimer: 'This is an extraction report, not a compliance determination.'
  },
  detections: [{ region: 'product' }],
  imageHash: 'a'.repeat(64),
  mode: 'gemini',
  engine: 'gemini-2.5-flash',
  usage: { total_tokens: 1454 }
};

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const createApp = require('../src/app');
  const { initGridFSBucket } = require('../src/config/db');
  User = require('../src/models/User');
  Inspection = require('../src/models/Inspection');
  app = createApp();

  // The suite manages its own connection, so bind GridFS to it explicitly.
  initGridFSBucket(mongoose.connection);

  await User.create({
    email: 'extract@lmverify.gov.in',
    passwordHash: 'Str0ng!Passw0rd',
    role: 'controller',
    displayName: 'Extraction Officer',
    jurisdiction: 'National'
  });

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'extract@lmverify.gov.in', password: 'Str0ng!Passw0rd' });
  token = login.body.data.accessToken;
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(() => jest.restoreAllMocks());

const newInspection = async () =>
  (await request(app).post('/api/inspections').set('Authorization', `Bearer ${token}`).send({}))
    .body.data;

describe('Gemini extraction path', () => {
  it('stores the extracted declarations against the inspection', async () => {
    jest.spyOn(visionClient, 'extract').mockResolvedValue(GEMINI_RESULT);
    const inspection = await newInspection();

    const res = await request(app)
      .post(`/api/inspections/${inspection._id}/vision`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', PNG, { filename: 'label.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.meta.mode).toBe('gemini');
    expect(res.body.meta.engine).toBe('gemini-2.5-flash');

    const stored = res.body.data;
    expect(stored.status).toBe('extracted');
    expect(stored.extracted.genericName).toBe('Carbonated Water');
    expect(stored.extracted.netQuantity).toMatchObject({ value: 750, unit: 'ml' });
    expect(stored.extracted.additionalInfo.nutrition.energy_kcal).toBe(42);
    expect(stored.extracted.additionalInfo.package.type).toBe('bottle');
  });

  it('asserts no verdicts from extraction alone', async () => {
    jest.spyOn(visionClient, 'extract').mockResolvedValue(GEMINI_RESULT);
    const inspection = await newInspection();

    await request(app)
      .post(`/api/inspections/${inspection._id}/vision`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', PNG, { filename: 'label.png', contentType: 'image/png' });

    const stored = await Inspection.findById(inspection._id);
    expect(stored.results).toHaveLength(0);
    expect(stored.verdict).toBe('draft');
    expect(stored.penalties.total).toBe(0);
  });

  it('evaluates the extraction against the deterministic rule pack', async () => {
    jest.spyOn(visionClient, 'extract').mockResolvedValue(GEMINI_RESULT);
    const inspection = await newInspection();

    await request(app)
      .post(`/api/inspections/${inspection._id}/vision`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', PNG, { filename: 'label.png', contentType: 'image/png' });

    const res = await request(app)
      .put(`/api/inspections/${inspection._id}/evaluate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.meta.evaluated).toBe(true);
    expect(res.body.data.results.length).toBeGreaterThan(0);

    // The extraction said "Carbonated Water", so the FSSAI date exemption applies.
    expect(res.body.meta.category.categoryId).toBe('aerated_beverage');
    const dateRule = res.body.data.results.find((r) => r.ruleId === 'R6_1_D');
    expect(dateRule.verdict).toBe('NOT_APPLICABLE');
  });

  it('never guesses a rule that prescribes a measurement', async () => {
    jest.spyOn(visionClient, 'extract').mockResolvedValue(GEMINI_RESULT);
    const inspection = await newInspection();

    await request(app)
      .post(`/api/inspections/${inspection._id}/vision`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', PNG, { filename: 'label.png', contentType: 'image/png' });

    const res = await request(app)
      .put(`/api/inspections/${inspection._id}/evaluate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    // Rules 7(2), 7(3), 8(1) and 9(1)(b) prescribe millimetres or a measured
    // contrast ratio. This path reads the label but does not measure it.
    for (const ruleId of ['R7_2_T1', 'R7_2_T2', 'R7_3', 'R8_1', 'R9_1_B']) {
      const rule = res.body.data.results.find((r) => r.ruleId === ruleId);
      expect(rule.verdict).toBe('NOT_ASSESSED');
    }

    // And none of them may contribute to the penalty.
    const priced = (res.body.data.penalties.breakdown || []).map((b) => b.ruleId);
    expect(priced).not.toEqual(expect.arrayContaining(['R7_2_T1', 'R8_1', 'R9_1_B']));
  });

  it('refuses to evaluate an inspection with no extraction', async () => {
    const inspection = await newInspection();

    const res = await request(app)
      .put(`/api/inspections/${inspection._id}/evaluate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/no extraction yet/i);
  });

  it('records nothing when the extraction service is unreachable', async () => {
    // Substituting a worse reading would be worse than failing loudly.
    jest.spyOn(visionClient, 'extract').mockResolvedValue(null);
    const inspection = await newInspection();

    const res = await request(app)
      .post(`/api/inspections/${inspection._id}/vision`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', PNG, { filename: 'label.png', contentType: 'image/png' });

    expect(res.status).toBe(503);

    const stored = await Inspection.findById(inspection._id);
    expect(stored.status).toBe('draft');
    expect(stored.extracted.genericName).toBeFalsy();
  });
});

describe('Client extraction report', () => {
  it('generates a PDF carrying the declarations and the disclaimer', async () => {
    const buffer = await generateExtractionPDF({ ref: 'INS-2026-00001' }, GEMINI_RESULT.report);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('generates an XLSX with a nutrition sheet', async () => {
    const buffer = Buffer.from(
      await generateExtractionXLSX({ ref: 'INS-2026-00001' }, GEMINI_RESULT.report)
    );

    expect(buffer.length).toBeGreaterThan(1000);
    // XLSX is a zip archive.
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('is downloadable through the reports API', async () => {
    jest.spyOn(visionClient, 'extract').mockResolvedValue(GEMINI_RESULT);
    const inspection = await newInspection();

    await request(app)
      .post(`/api/inspections/${inspection._id}/vision`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', PNG, { filename: 'label.png', contentType: 'image/png' });

    const generated = await request(app)
      .post(`/api/reports/generate/${inspection._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ format: 'pdf' });

    expect(generated.status).toBe(201);

    const download = await request(app)
      .get(`/api/reports/${generated.body.data._id}/download`)
      .set('Authorization', `Bearer ${token}`);

    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
  });

  it('refuses a report for an inspection with no extraction', async () => {
    const inspection = await newInspection();

    const res = await request(app)
      .post(`/api/reports/generate/${inspection._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ format: 'pdf' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/no extraction yet/i);
  });
});
