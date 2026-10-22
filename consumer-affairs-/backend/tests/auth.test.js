const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const createApp = require('../src/app');
const User = require('../src/models/User');

jest.setTimeout(120000);

let mongod;
let app;

const CONTROLLER = { email: 'controller@lmverify.gov.in', password: 'Str0ng!Passw0rd' };
const INSPECTOR = { email: 'inspector@lmverify.gov.in', password: 'An0ther!Passw0rd' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();

  await User.create({
    email: CONTROLLER.email,
    passwordHash: CONTROLLER.password,
    role: 'controller',
    displayName: 'Test Controller',
    jurisdiction: 'National'
  });

  await User.create({
    email: INSPECTOR.email,
    passwordHash: INSPECTOR.password,
    role: 'field_inspector',
    displayName: 'Test Inspector',
    jurisdiction: 'Delhi Central'
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

const login = (creds) => request(app).post('/api/auth/login').send(creds);

const refreshCookie = (res) =>
  (res.headers['set-cookie'] || []).find((c) => c.startsWith('lmv_refresh='));

describe('Authentication', () => {
  it('rejects a login with the wrong password without revealing the account exists', async () => {
    const res = await login({ email: CONTROLLER.email, password: 'WrongPassword1!' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('returns the same message for an unknown account', async () => {
    const res = await login({ email: 'nobody@lmverify.gov.in', password: 'WrongPassword1!' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('rejects a malformed email before touching the database', async () => {
    const res = await login({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('issues an access token and an httpOnly refresh cookie on success', async () => {
    const res = await login(CONTROLLER);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe(CONTROLLER.email);
    expect(res.body.data.user.passwordHash).toBeUndefined();

    const cookie = refreshCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
  });

  it('stores the refresh token hashed, never in plaintext', async () => {
    const res = await login(CONTROLLER);
    const raw = res.body.data.refreshToken;
    const user = await User.findOne({ email: CONTROLLER.email }).select('+refreshTokenHash');

    expect(user.refreshTokenHash).toBeDefined();
    expect(user.refreshTokenHash).not.toBe(raw);
    expect(user.refreshTokenHash).toBe(User.hashToken(raw));
  });

  it('blocks protected routes without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.reason).toBe('NO_TOKEN');
  });

  it('blocks protected routes with a tampered token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.status).toBe(401);
    expect(res.body.error.reason).toBe('TOKEN_INVALID');
  });

  it('returns the current user for a valid token', async () => {
    const { body } = await login(CONTROLLER);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.data.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('controller');
  });

  it('rotates the refresh token and rejects the old one (replay protection)', async () => {
    const first = await login(CONTROLLER);
    const oldCookie = refreshCookie(first);

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.accessToken).toEqual(expect.any(String));

    // Replaying the consumed token must fail and kill the session.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.reason).toBe('TOKEN_REUSE');

    const newCookie = refreshCookie(rotated);
    const afterRevoke = await request(app).post('/api/auth/refresh').set('Cookie', newCookie);
    expect(afterRevoke.status).toBe(401);
  });

  it('revokes the refresh token on logout', async () => {
    const session = await login(CONTROLLER);
    const cookie = refreshCookie(session);

    const out = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${session.body.data.accessToken}`);
    expect(out.status).toBe(200);

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('locks the account after repeated failed attempts', async () => {
    const victim = await User.create({
      email: 'lockme@lmverify.gov.in',
      passwordHash: 'Correct!Passw0rd',
      role: 'auditor',
      displayName: 'Lock Target',
      jurisdiction: 'Test'
    });

    for (let i = 0; i < 5; i += 1) {
      await login({ email: victim.email, password: 'Wrong!Passw0rd' });
    }

    const locked = await login({ email: victim.email, password: 'Correct!Passw0rd' });
    expect(locked.status).toBe(423);
  });
});

describe('Role-based access control', () => {
  let controllerToken;
  let inspectorToken;

  beforeAll(async () => {
    controllerToken = (await login(CONTROLLER)).body.data.accessToken;
    inspectorToken = (await login(INSPECTOR)).body.data.accessToken;
  });

  it('lets a controller list users', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${controllerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.every((u) => u.passwordHash === undefined)).toBe(true);
  });

  it('forbids a field inspector from listing users', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${inspectorToken}`);
    expect(res.status).toBe(403);
  });

  it('forbids a field inspector from provisioning accounts', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${inspectorToken}`)
      .send({
        email: 'new@lmverify.gov.in',
        password: 'Str0ng!Passw0rd',
        role: 'auditor',
        jurisdiction: 'Delhi',
        displayName: 'New Officer'
      });

    expect(res.status).toBe(403);
  });

  it('rejects a weak password when a controller provisions an account', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${controllerToken}`)
      .send({
        email: 'weak@lmverify.gov.in',
        password: 'password',
        role: 'auditor',
        jurisdiction: 'Delhi',
        displayName: 'Weak Password'
      });

    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('lets a controller provision a strong account that can then sign in', async () => {
    const created = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${controllerToken}`)
      .send({
        email: 'fresh@lmverify.gov.in',
        password: 'Str0ng!Passw0rd',
        role: 'senior_inspector',
        jurisdiction: 'Delhi North',
        displayName: 'Fresh Officer'
      });

    expect(created.status).toBe(201);

    const signedIn = await login({ email: 'fresh@lmverify.gov.in', password: 'Str0ng!Passw0rd' });
    expect(signedIn.status).toBe(200);
  });

  it('revokes live sessions when an account is deactivated', async () => {
    const target = await User.create({
      email: 'revoke@lmverify.gov.in',
      passwordHash: 'Str0ng!Passw0rd',
      role: 'auditor',
      displayName: 'Revoke Target',
      jurisdiction: 'Test'
    });

    const session = await login({ email: target.email, password: 'Str0ng!Passw0rd' });
    const token = session.body.data.accessToken;

    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

    await request(app)
      .delete(`/api/users/${target._id}`)
      .set('Authorization', `Bearer ${controllerToken}`);

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });
});

describe('Health and routing', () => {
  it('exposes an unauthenticated health check', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
