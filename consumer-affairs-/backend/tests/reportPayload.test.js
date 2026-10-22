const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../src/app');
const User = require('../src/models/User');
const Product = require('../src/models/Product');
const Inspection = require('../src/models/Inspection');
const Report = require('../src/models/Report');

jest.setTimeout(120000);

let mongod;
let app;
let token;
let officer;
let inspection;

const CONTROLLER = { email: 'reports.controller@lmverify.gov.in', password: 'Str0ng!Passw0rd' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();

  officer = await User.create({
    email: CONTROLLER.email,
    passwordHash: CONTROLLER.password,
    role: 'controller',
    displayName: 'Report Controller',
    jurisdiction: 'National'
  });

  const login = await request(app).post('/api/auth/login').send(CONTROLLER);
  token = login.body.data.accessToken;

  const product = await Product.create({
    brand: 'Parle-G',
    genericName: 'Biscuits',
    category: 'biscuits_bread'
  });

  inspection = await Inspection.create({
    ref: 'LMV-TEST-0001',
    officerId: officer._id,
    productId: product._id,
    verdict: 'non_compliant',
    status: 'adjudicated',
    extracted: {
      genericName: 'Biscuits',
      netQuantity: { value: 200, unit: 'g' },
      mrp: { raw: 'Rs 40.00' }
    },
    results: [
      { ruleId: 'R6_1a', citation: 'Rule 6(1)(a)', verdict: 'PASS' },
      { ruleId: 'R7_2', citation: 'Rule 7(2)', verdict: 'FAIL' },
      { ruleId: 'R8_1', citation: 'Rule 8(1)', verdict: 'FAIL' }
    ],
    penalties: { total: 4000, breakdown: [{ ruleId: 'R7_2', amount: 2000 }] },
    // The app defaults to extraction mode, so a report needs a reading to
    // certify. Minimal but realistically shaped.
    extractionReport: {
      summary: { found: 5, missing: 2, total: 7 },
      declarations: [
        { label: 'Generic name', value: 'Biscuits', status: 'FOUND' },
        { label: 'Net quantity', value: '200 g', status: 'FOUND' },
        { label: 'Month & year of packing', value: null, status: 'MISSING' }
      ],
      detections: [],
      legibilityIssues: [],
      disclaimer: 'Extraction report, not a compliance certificate.'
    }
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

const generate = () =>
  auth(request(app).post(`/api/reports/generate/${inspection._id}`)).send({});

describe('report storage', () => {
  afterEach(async () => {
    await Report.deleteMany({});
  });

  it('stores the report as JSON rather than a rendered file', async () => {
    const res = await generate();
    expect(res.status).toBe(201);

    const stored = await Report.findById(res.body.data._id);
    expect(stored.format).toBe('json');
    expect(stored.payload).toBeTruthy();
    // Nothing binary is written: no GridFS handle at all.
    expect(stored.fileId).toBeUndefined();
  });

  it('links the report to the inspecting officer', async () => {
    const res = await generate();

    const stored = await Report.findById(res.body.data._id);
    expect(String(stored.ownerId)).toBe(String(officer._id));
    expect(String(stored.issuedBy)).toBe(String(officer._id));
  });

  it('freezes a snapshot that survives later edits to the inspection', async () => {
    const res = await generate();
    const stored = await Report.findById(res.body.data._id);

    expect(stored.payload.summary.verdict).toBe('non_compliant');
    expect(stored.payload.summary.ruleCount).toBe(3);
    expect(stored.payload.summary.failedRules).toBe(2);
    expect(stored.payload.summary.penaltyTotal).toBe(4000);

    // Change the live inspection; the stored report must not follow.
    await Inspection.updateOne({ _id: inspection._id }, { $set: { verdict: 'compliant' } });

    const after = await Report.findById(res.body.data._id);
    expect(after.payload.summary.verdict).toBe('non_compliant');

    await Inspection.updateOne({ _id: inspection._id }, { $set: { verdict: 'non_compliant' } });
  });

  it('denormalises fields the repository list needs', async () => {
    const res = await generate();
    const stored = await Report.findById(res.body.data._id);

    expect(stored.inspectionRef).toBe('LMV-TEST-0001');
    expect(stored.verdict).toBe('non_compliant');
    expect(stored.productLabel).toContain('Parle-G');
  });
});

describe('GET /api/reports/mine', () => {
  afterEach(async () => {
    await Report.deleteMany({});
  });

  it("returns the officer's own reports", async () => {
    await generate();
    const res = await auth(request(app).get('/api/reports/mine'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].inspectionRef).toBe('LMV-TEST-0001');
    expect(res.body.meta.total).toBe(1);
  });

  it('never ships the whole payload in the list', async () => {
    await generate();
    const res = await auth(request(app).get('/api/reports/mine'));

    expect(res.body.data[0].payload).toBeUndefined();
    // The precomputed summary is enough to render a row.
    expect(res.body.data[0].summary.failedRules).toBe(2);
  });

  it('excludes reports owned by a different officer', async () => {
    await generate();
    await Report.updateMany({}, { $set: { ownerId: new mongoose.Types.ObjectId() } });

    const res = await auth(request(app).get('/api/reports/mine'));
    expect(res.body.data).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/reports/mine');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reports/:id/download', () => {
  afterEach(async () => {
    await Report.deleteMany({});
  });

  it('renders a real PDF from the stored JSON', async () => {
    const generated = await generate();

    const res = await auth(
      request(app).get(`/api/reports/${generated.body.data._id}/download?format=pdf`)
    ).buffer();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['x-report-source']).toBe('json-payload');
    // %PDF- magic bytes prove a document was actually produced.
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('defaults to PDF when no format is given', async () => {
    const generated = await generate();

    const res = await auth(
      request(app).get(`/api/reports/${generated.body.data._id}/download`)
    ).buffer();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('can hand back the stored JSON itself', async () => {
    const generated = await generate();

    const res = await auth(
      request(app).get(`/api/reports/${generated.body.data._id}/download?format=json`)
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const parsed = JSON.parse(res.text);
    expect(parsed.summary.ref).toBe('LMV-TEST-0001');
  });

  it('rejects a format this report cannot be rendered into', async () => {
    const generated = await generate();

    const res = await auth(
      request(app).get(`/api/reports/${generated.body.data._id}/download?format=csv`)
    );

    expect(res.status).toBe(400);
  });

  it('404s for an unknown report id', async () => {
    const res = await auth(
      request(app).get(`/api/reports/${new mongoose.Types.ObjectId()}/download`)
    );

    expect(res.status).toBe(404);
  });
});
