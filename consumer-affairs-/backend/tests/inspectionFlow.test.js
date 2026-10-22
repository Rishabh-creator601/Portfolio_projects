const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../src/app');
const User = require('../src/models/User');
const Product = require('../src/models/Product');

jest.setTimeout(120000);

let mongod;
let app;
let inspectorToken;
let seniorToken;
let product;

const OCR_TOKENS = [
  { text: 'Manufactured by', bbox: [10, 20, 200, 35], confidence: 0.95, panel: 'principal' },
  { text: 'ABC Foods Pvt Ltd', bbox: [10, 40, 250, 55], confidence: 0.92, panel: 'principal' },
  { text: '123, Industrial Area, New Delhi 110001', bbox: [10, 60, 300, 75], confidence: 0.88, panel: 'principal' },
  { text: 'Biscuits', bbox: [150, 100, 250, 130], confidence: 0.97, panel: 'principal' },
  { text: 'Net Wt. 200g', bbox: [10, 150, 130, 165], confidence: 0.96, panel: 'principal' },
  { text: 'MRP Rs 40 incl. of all taxes', bbox: [10, 180, 280, 195], confidence: 0.93, panel: 'principal' },
  { text: 'Packed 08/2026', bbox: [10, 200, 200, 215], confidence: 0.9, panel: 'principal' },
  { text: 'Consumer Care: 18001234567 care@abc.in', bbox: [10, 220, 300, 235], confidence: 0.91, panel: 'principal' }
];

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();

  await User.create({
    email: 'flow.inspector@lmverify.gov.in',
    passwordHash: 'Str0ng!Passw0rd',
    role: 'field_inspector',
    displayName: 'Flow Inspector',
    jurisdiction: 'Delhi Central'
  });

  await User.create({
    email: 'flow.senior@lmverify.gov.in',
    passwordHash: 'Str0ng!Passw0rd',
    role: 'senior_inspector',
    displayName: 'Flow Senior',
    jurisdiction: 'Delhi Central'
  });

  product = await Product.create({
    brand: 'Test Brand',
    genericName: 'Biscuits',
    category: 'biscuits_bread',
    gtin: '8901030384912'
  });

  const signIn = async (email) =>
    (await request(app).post('/api/auth/login').send({ email, password: 'Str0ng!Passw0rd' })).body.data
      .accessToken;

  inspectorToken = await signIn('flow.inspector@lmverify.gov.in');
  seniorToken = await signIn('flow.senior@lmverify.gov.in');
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

describe('Inspection lifecycle', () => {
  let inspectionId;

  it('raises an inspection against the signed-in officer', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set('Authorization', `Bearer ${inspectorToken}`)
      .send({ productId: product._id.toString(), ocrTokens: OCR_TOKENS });

    expect(res.status).toBe(201);
    expect(res.body.data.ref).toMatch(/^INS-\d{4}-\d{5}$/);
    expect(res.body.data.status).toBe('draft');
    inspectionId = res.body.data._id;
  });

  it('maps OCR tokens onto the statutory declaration heads', async () => {
    const res = await request(app)
      .put(`/api/inspections/${inspectionId}/extract`)
      .set('Authorization', `Bearer ${inspectorToken}`)
      .send({});

    expect(res.status).toBe(200);

    const extracted = res.body.data.extracted;
    expect(res.body.data.status).toBe('extracted');
    expect(extracted.manufacturer.name).toContain('ABC Foods');
    expect(extracted.genericName).toBe('Biscuits');
    expect(extracted.netQuantity).toMatchObject({ value: 200, unit: 'g' });
    expect(extracted.mrp.value).toBe(40);
    expect(extracted.monthYear.raw).toBe('08/2026');
    expect(extracted.consumerCare.phone).toBeTruthy();
    expect(extracted.consumerCare.email).toBe('care@abc.in');
  });

  it('runs the real rule engine and stores citations and penalties', async () => {
    const res = await request(app)
      .put(`/api/inspections/${inspectionId}/evaluate`)
      .set('Authorization', `Bearer ${inspectorToken}`)
      .send({});

    expect(res.status).toBe(200);

    const { results, penalties, verdict, status } = res.body.data;
    expect(results.length).toBeGreaterThan(5);
    expect(status).toBe('under_review');
    expect(['compliant', 'non_compliant', 'review']).toContain(verdict);

    // Mandatory Rule 6 declarations must all be present and cited.
    const rule6 = results.find((r) => r.ruleId === 'R6_1_A');
    expect(rule6.citation).toBe('Rule 6(1)(a)');
    expect(rule6.verdict).toBe('PASS');
    expect(results.find((r) => r.ruleId === 'R6_1_C').verdict).toBe('PASS');
    expect(results.find((r) => r.ruleId === 'R6_1_E').verdict).toBe('PASS');

    // Penalty exposure is derived from the failing rules, at Rule 32 rates.
    const failures = results.filter((r) => r.verdict === 'FAIL').length;
    expect(penalties.total).toBe(failures * 2000);
  });

  it('stops a field inspector from overriding a verdict', async () => {
    const res = await request(app)
      .put(`/api/inspections/${inspectionId}/override`)
      .set('Authorization', `Bearer ${inspectorToken}`)
      .send({ ruleId: 'R9_2', overrideVerdict: 'PASS', overrideReason: 'Checked visually on the pack' });

    expect(res.status).toBe(403);
  });

  it('requires a substantive reason for an override', async () => {
    const res = await request(app)
      .put(`/api/inspections/${inspectionId}/override`)
      .set('Authorization', `Bearer ${seniorToken}`)
      .send({ ruleId: 'R9_2', overrideVerdict: 'PASS', overrideReason: 'ok' });

    expect(res.status).toBe(400);
  });

  it('records a senior officer override and re-computes the penalty', async () => {
    const before = await request(app)
      .get(`/api/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${seniorToken}`);

    const target = before.body.data.results.find((r) => r.verdict !== 'FAIL');

    const res = await request(app)
      .put(`/api/inspections/${inspectionId}/override`)
      .set('Authorization', `Bearer ${seniorToken}`)
      .send({
        ruleId: target.ruleId,
        overrideVerdict: 'FAIL',
        overrideReason: 'Measured against the physical pack during inspection'
      });

    expect(res.status).toBe(200);

    const overridden = res.body.data.results.find((r) => r.ruleId === target.ruleId);
    expect(overridden.overridden).toBe(true);
    expect(overridden.overrideVerdict).toBe('FAIL');
    expect(overridden.overrideBy).toBeTruthy();

    const effective = (r) => (r.overridden ? r.overrideVerdict : r.verdict);
    const failing = res.body.data.results.filter((r) => effective(r) === 'FAIL').length;
    expect(res.body.data.penalties.total).toBe(failing * 2000);
  });

  it('adjudicates and writes the outcome to the product history', async () => {
    const res = await request(app)
      .put(`/api/inspections/${inspectionId}/adjudicate`)
      .set('Authorization', `Bearer ${seniorToken}`)
      .send({ verdict: 'non_compliant', remarks: 'Numeral height below the prescribed minimum.' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('adjudicated');

    const history = await request(app)
      .get(`/api/products/${product._id}`)
      .set('Authorization', `Bearer ${seniorToken}`);

    expect(history.body.data.complianceHistory).toHaveLength(1);
    expect(history.body.data.complianceHistory[0].verdict).toBe('non_compliant');
  });

  it('scopes a field inspector list to their own inspections', async () => {
    const res = await request(app)
      .get('/api/inspections')
      .set('Authorization', `Bearer ${inspectorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
  });
});

describe('Dashboard aggregations', () => {
  it('reports figures derived from real inspections', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${seniorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalScanned).toBe(1);
    expect(res.body.data.totalViolations).toBe(1);
    expect(res.body.data.complianceRate).toBe(0);
  });

  it('ranks the most violated rules', async () => {
    const res = await request(app)
      .get('/api/dashboard/violations')
      .set('Authorization', `Bearer ${seniorToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    if (res.body.data.length > 0) {
      expect(res.body.data[0]).toHaveProperty('count');
      expect(res.body.data[0]).toHaveProperty('rule');
    }
  });

  it('returns a padded 12-month trend series', async () => {
    const res = await request(app)
      .get('/api/dashboard/trends')
      .set('Authorization', `Bearer ${seniorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(12);
  });
});

describe('Rule pack API', () => {
  it('serves the bundled rule pack with citations', async () => {
    const res = await request(app).get('/api/rules').set('Authorization', `Bearer ${seniorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(20);
    expect(res.body.data[0]).toHaveProperty('citation');
    expect(res.body.meta.version).toBeTruthy();
  });

  it('filters the pack by severity', async () => {
    const res = await request(app)
      .get('/api/rules?severity=critical')
      .set('Authorization', `Bearer ${seniorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.severity === 'critical')).toBe(true);
  });
});
