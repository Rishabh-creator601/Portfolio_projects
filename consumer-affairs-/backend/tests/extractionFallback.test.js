/**
 * The extraction fallback chain.
 *
 *   key 1  ->  key 2  ->  local OCR
 *
 * Each tier exists for a different failure. The point of the tests below is
 * that a degraded reading is never passed off as a good one: an officer who
 * cannot tell which engine read a label cannot judge how far to trust it.
 */

process.env.EXTRACTION_MODE = 'gemini';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const visionClient = require('../src/services/visionClient');

jest.setTimeout(120000);

let mongod;
let app;
let token;
let Inspection;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** What the sidecar returns when a key served the request. */
const geminiResult = (keyUsed = 'key_1') => ({
  extraction: { detections: [{ region: 'product' }], _meta: { model: 'gemini-2.5-flash', key_used: keyUsed } },
  declarations: {
    manufacturer: { name: 'ABC Foods Pvt Ltd', address: 'New Delhi 110001', qualifier: 'manufactured by' },
    genericName: 'Biscuits',
    netQuantity: { value: 200, unit: 'g', raw: '200 g' },
    monthYear: { raw: '08/2026' },
    mrp: { value: 40, wording: 'MRP Rs 40.00 inclusive of all taxes', raw: 'MRP Rs 40.00 inclusive of all taxes' },
    consumerCare: { name: 'Care', address: 'Delhi', phone: '18001234567', email: 'c@abc.in' },
    additionalInfo: { extractionConfidence: 0.95 }
  },
  report: { summary: { product: 'Biscuits', declarationsFound: 7, declarationsTotal: 7 }, declarations: [], fssai: [] },
  imageHash: 'a'.repeat(64),
  mode: 'gemini',
  engine: 'gemini-2.5-flash',
  source: 'gemini',
  keyUsed,
  detections: [{ region: 'product' }],
  warnings: keyUsed === 'key_1' ? [] : ['The primary API key could not be used.']
});

/** What the sidecar returns for the legacy OCR pipeline. */
const ocrAnalysis = () => ({
  tokens: [
    { text: 'Manufactured by ABC Foods Pvt Ltd', bbox: [0, 0, 10, 10], confidence: 0.9 },
    { text: '123, Industrial Area, New Delhi 110001', bbox: [0, 20, 10, 30], confidence: 0.88 },
    { text: 'Biscuits', bbox: [0, 40, 10, 50], confidence: 0.97 },
    { text: 'Net Wt. 200 g', bbox: [0, 60, 10, 70], confidence: 0.95 },
    { text: 'MRP Rs 40.00 incl. of all taxes', bbox: [0, 80, 10, 90], confidence: 0.93 }
  ],
  engine: 'easyocr',
  source: 'vision-service',
  imageHash: 'b'.repeat(64),
  measurements: {},
  warnings: []
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const createApp = require('../src/app');
  const { initGridFSBucket } = require('../src/config/db');
  const User = require('../src/models/User');
  Inspection = require('../src/models/Inspection');

  app = createApp();
  initGridFSBucket(mongoose.connection);

  await User.create({
    email: 'fallback@lmverify.gov.in',
    passwordHash: 'Str0ng!Passw0rd',
    role: 'controller',
    displayName: 'Fallback Officer',
    jurisdiction: 'National'
  });

  token = (
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'fallback@lmverify.gov.in', password: 'Str0ng!Passw0rd' })
  ).body.data.accessToken;
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(() => jest.restoreAllMocks());

const newInspection = async () =>
  (await request(app).post('/api/inspections').set('Authorization', `Bearer ${token}`).send({}))
    .body.data;

const capture = async (id) =>
  request(app)
    .post(`/api/inspections/${id}/vision`)
    .set('Authorization', `Bearer ${token}`)
    .attach('image', PNG, { filename: 'label.png', contentType: 'image/png' });

describe('Tier 1 - the primary key', () => {
  it('records a clean reading with no warning', async () => {
    jest.spyOn(visionClient, 'extract').mockResolvedValue(geminiResult('key_1'));
    const inspection = await newInspection();

    const res = await capture(inspection._id);

    expect(res.status).toBe(200);
    expect(res.body.meta.source).toBe('gemini');
    expect(res.body.meta.keyUsed).toBe('key_1');
    expect(res.body.meta.warnings).toHaveLength(0);
  });
});

describe('Tier 2 - the backup key', () => {
  it('serves the reading and says which key was used', async () => {
    jest.spyOn(visionClient, 'extract').mockResolvedValue(geminiResult('key_2'));
    const inspection = await newInspection();

    const res = await capture(inspection._id);

    expect(res.status).toBe(200);
    expect(res.body.meta.keyUsed).toBe('key_2');
    // The reading is just as good, but the operator should know the primary is down.
    expect(res.body.meta.warnings.join(' ')).toMatch(/primary api key/i);
    expect(res.body.data.extracted.genericName).toBe('Biscuits');
  });

  it('still produces a full-quality extraction', async () => {
    jest.spyOn(visionClient, 'extract').mockResolvedValue(geminiResult('key_2'));
    const inspection = await newInspection();
    await capture(inspection._id);

    const stored = await Inspection.findById(inspection._id);
    expect(stored.extractionSource).toBe('gemini');
    expect(stored.extracted.netQuantity.value).toBe(200);
  });
});

describe('Tier 3 - local OCR when no key works', () => {
  it('reads the label rather than losing the capture', async () => {
    // Both keys are gone, so the sidecar's /extract returns nothing.
    jest.spyOn(visionClient, 'analyze').mockResolvedValue(ocrAnalysis());
    const inspection = await newInspection();

    const result = await visionClient.extractViaOcr({
      buffer: PNG,
      mimetype: 'image/png',
      originalname: 'label.png'
    });

    expect(result).not.toBeNull();
    expect(result.source).toBe('ocr-fallback');
    expect(result.engine).toBe('easyocr');
    expect(result.declarations.genericName).toBe('Biscuits');
    expect(result.declarations.netQuantity.value).toBe(200);
  });

  it('marks the reading as degraded at every level', async () => {
    jest.spyOn(visionClient, 'analyze').mockResolvedValue(ocrAnalysis());

    const result = await visionClient.extractViaOcr({
      buffer: PNG,
      mimetype: 'image/png',
      originalname: 'label.png'
    });

    // On the result...
    expect(result.warnings.join(' ')).toMatch(/no api key could be used/i);
    // ...in the report the client downloads...
    expect(result.report.disclaimer).toMatch(/no api key could be used/i);
    // ...and against the legibility notes an officer reads.
    expect(result.report.legibilityIssues.join(' ')).toMatch(/confirmed against the pack/i);
  });

  it('does not claim the nutrition panel it never attempted', async () => {
    // Only the model reads nutrition tables; OCR must not imply it tried.
    jest.spyOn(visionClient, 'analyze').mockResolvedValue(ocrAnalysis());

    const result = await visionClient.extractViaOcr({
      buffer: PNG,
      mimetype: 'image/png',
      originalname: 'label.png'
    });

    expect(result.report.nutrition).toBeNull();
    expect(result.report.fssai.every((row) => row.status === 'not_found')).toBe(true);
  });

  it('records the source so the degradation survives on the inspection', async () => {
    jest.spyOn(visionClient, 'extract').mockImplementation(async () => {
      jest.spyOn(visionClient, 'analyze').mockResolvedValue(ocrAnalysis());
      return visionClient.extractViaOcr({
        buffer: PNG,
        mimetype: 'image/png',
        originalname: 'label.png'
      });
    });

    const inspection = await newInspection();
    const res = await capture(inspection._id);

    expect(res.status).toBe(200);
    expect(res.body.meta.source).toBe('ocr-fallback');

    const stored = await Inspection.findById(inspection._id);
    expect(stored.extractionSource).toBe('ocr-fallback');
  });
});

describe('When nothing can read the label', () => {
  it('records nothing rather than an empty extraction', async () => {
    jest.spyOn(visionClient, 'extract').mockResolvedValue(null);
    const inspection = await newInspection();

    const res = await capture(inspection._id);

    expect(res.status).toBe(503);

    const stored = await Inspection.findById(inspection._id);
    expect(stored.status).toBe('draft');
    expect(stored.extracted.genericName).toBeFalsy();
  });

  it('returns null when OCR finds no text either', async () => {
    jest.spyOn(visionClient, 'analyze').mockResolvedValue({ tokens: [], engine: 'easyocr' });

    const result = await visionClient.extractViaOcr({
      buffer: PNG,
      mimetype: 'image/png',
      originalname: 'label.png'
    });

    expect(result).toBeNull();
  });
});

describe('Compliance still runs on a degraded reading', () => {
  it('evaluates an OCR extraction against the same rule pack', async () => {
    jest.spyOn(visionClient, 'analyze').mockResolvedValue(ocrAnalysis());
    const ocr = await visionClient.extractViaOcr({
      buffer: PNG,
      mimetype: 'image/png',
      originalname: 'label.png'
    });

    const { evaluateExtraction } = require('../src/services/geminiCompliance');
    const evaluation = evaluateExtraction(ocr.declarations);

    // The rules do not care which engine read the label; they care what it says.
    expect(evaluation.results.length).toBeGreaterThan(0);
    expect(evaluation.category.categoryId).toBe('biscuits_bread');
    expect(evaluation.results.find((r) => r.ruleId === 'R6_1_B').verdict).toBe('PASS');
  });
});
