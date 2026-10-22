const path = require('path');
const fs = require('fs');

// dotenv.config() with no path reads process.cwd()/.env, which misses the
// shared root .env whenever the API is started from the backend/ directory --
// the usual way. Resolve it relative to this file instead, so the same file
// serves the Node API and the Python vision service.
//
// A backend/.env overrides the root one; real environment variables win over
// both, leaving Docker and CI untouched.
for (const candidate of [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env')
]) {
  if (fs.existsSync(candidate)) {
    require('dotenv').config({ path: candidate, override: false });
  }
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

const DEV_JWT_SECRET = 'dev-only-access-secret-do-not-use-in-production';
const DEV_REFRESH_SECRET = 'dev-only-refresh-secret-do-not-use-in-production';

const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || DEV_REFRESH_SECRET;

// Refuse to boot in production with the fallback development secrets.
if (isProd && (JWT_SECRET === DEV_JWT_SECRET || JWT_REFRESH_SECRET === DEV_REFRESH_SECRET)) {
  throw new Error(
    'JWT_SECRET and JWT_REFRESH_SECRET must be set to strong unique values when NODE_ENV=production.'
  );
}

if (isProd && JWT_SECRET === JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must not be identical.');
}

const parseOrigins = (raw) =>
  (raw || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

const parseList = (raw) =>
  (raw || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

// The browser-facing origin OAuth redirects land back on.
const APP_URL = (process.env.APP_URL || parseOrigins(process.env.CLIENT_URL)[0] || 'http://localhost:3000').replace(/\/$/, '');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL || `http://localhost:${process.env.PORT || 5000}/api/auth/google/callback`;

// Google sign-in only advertises itself once both halves of the client are set.
const GOOGLE_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

module.exports = {
  APP_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL,
  GOOGLE_ENABLED,
  // Empty list = any Google account may sign up. Set to e.g. "gov.in,nic.in"
  // to restrict self-registration to official domains.
  GOOGLE_ALLOWED_DOMAINS: parseList(process.env.GOOGLE_ALLOWED_DOMAINS),
  // Public sign-up can be turned off without redeploying the frontend.
  SIGNUP_ENABLED: process.env.SIGNUP_ENABLED !== 'false',
  // Everyone who self-registers lands on the least-privileged role; a
  // Controller promotes them from the admin console afterwards.
  SELF_SIGNUP_ROLE: process.env.SELF_SIGNUP_ROLE || 'field_inspector',

  PORT: process.env.PORT || 5000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/lm-verify',
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  JWT_EXPIRY: process.env.JWT_EXPIRY || '15m',
  REFRESH_EXPIRY: process.env.REFRESH_EXPIRY || '7d',
  REFRESH_EXPIRY_MS: Number(process.env.REFRESH_EXPIRY_MS || 7 * 24 * 60 * 60 * 1000),
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  OCR_SERVICE_URL: process.env.OCR_SERVICE_URL || 'http://localhost:8001',
  UPLOAD_MAX_SIZE: process.env.UPLOAD_MAX_SIZE || '20MB',
  BCRYPT_ROUNDS: Number(process.env.BCRYPT_ROUNDS || 12),
  // "gemini" makes the model the active extractor and leaves the OCR +
  // millimetre-measurement pipeline and the rule engine dormant. "legacy"
  // restores them. The dormant code is untouched, so switching back is an
  // environment change rather than a revert.
  EXTRACTION_MODE: (process.env.EXTRACTION_MODE || 'gemini').toLowerCase(),
  CORS_ORIGINS: parseOrigins(process.env.CLIENT_URL),
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true' || isProd,
  MAX_LOGIN_ATTEMPTS: Number(process.env.MAX_LOGIN_ATTEMPTS || 5),
  LOCK_WINDOW_MS: Number(process.env.LOCK_WINDOW_MS || 15 * 60 * 1000),
  NODE_ENV,
  isProd
};
