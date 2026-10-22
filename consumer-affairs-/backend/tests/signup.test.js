const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../src/app');
const User = require('../src/models/User');

jest.setTimeout(120000);

let mongod;
let app;

const BASE = {
  password: 'Str0ng!Passw0rd',
  displayName: 'New Officer'
};

// The signup limiter is keyed on ip + email, so each test needs its own address
// or later cases in the file would be throttled rather than exercised.
let emailSeq = 0;
const freshEmail = () => `officer${++emailSeq}@lmverify.gov.in`;

let VALID;
beforeEach(() => {
  VALID = { ...BASE, email: freshEmail() };
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  await User.deleteMany({});
});

const signup = (body) => request(app).post('/api/auth/signup').send(body);

describe('GET /api/auth/providers', () => {
  it('advertises password sign-in and reports Google as unconfigured', async () => {
    const res = await request(app).get('/api/auth/providers');

    expect(res.status).toBe(200);
    expect(res.body.data.password).toBe(true);
    // No GOOGLE_CLIENT_ID/SECRET in the test env, so the UI must not offer it.
    expect(res.body.data.google).toBe(false);
    expect(res.body.data.signupEnabled).toBe(true);
  });
});

describe('POST /api/auth/signup', () => {
  it('creates an account and returns a usable session', async () => {
    const res = await signup(VALID);

    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe(VALID.email);
    expect(res.body.data.user.displayName).toBe(VALID.displayName);

    // The session works straight away - no separate sign-in step.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(VALID.email);
  });

  it('always assigns the least-privileged role', async () => {
    const res = await signup(VALID);

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('field_inspector');
  });

  it('ignores a role supplied by the caller, so it cannot mint a controller', async () => {
    const res = await signup({ ...VALID, role: 'controller' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('field_inspector');

    const stored = await User.findOne({ email: VALID.email });
    expect(stored.role).toBe('field_inspector');
  });

  it('sets the refresh cookie as httpOnly', async () => {
    const res = await signup(VALID);
    const cookies = res.headers['set-cookie'] || [];
    const refresh = cookies.find((c) => c.startsWith('lmv_refresh='));

    expect(refresh).toBeDefined();
    expect(refresh).toMatch(/HttpOnly/i);
  });

  it('rejects a weak password without creating anything', async () => {
    const res = await signup({ ...VALID, password: 'abc' });

    expect(res.status).toBe(400);
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects a malformed email', async () => {
    const res = await signup({ ...VALID, email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects a duplicate email with 409', async () => {
    await signup(VALID);
    const res = await signup(VALID);

    expect(res.status).toBe(409);
    expect(await User.countDocuments()).toBe(1);
  });

  it('never returns the password hash', async () => {
    const res = await signup(VALID);

    expect(JSON.stringify(res.body)).not.toContain(VALID.password);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('records the account as local with a password set', async () => {
    const res = await signup(VALID);

    expect(res.body.data.user.authProvider).toBe('local');
    expect(res.body.data.user.hasPassword).toBe(true);
  });
});

describe('Google OAuth endpoints when unconfigured', () => {
  it('bounces /google back to the app instead of erroring', async () => {
    const res = await request(app).get('/api/auth/google');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/auth/callback');
    expect(res.headers.location).toContain('error=google_not_configured');
  });

  it('rejects a callback that carries no state cookie', async () => {
    const res = await request(app).get('/api/auth/google/callback?code=abc&state=xyz');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=');
    // Nothing may be created from an unverified callback.
    expect(await User.countDocuments()).toBe(0);
  });
});
