const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const {
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  JWT_EXPIRY,
  REFRESH_EXPIRY,
  REFRESH_EXPIRY_MS,
  COOKIE_SECURE
} = require('../config/env');

const REFRESH_COOKIE = 'lmv_refresh';

/**
 * Access tokens are short lived and carry the claims the API needs on every
 * request. Refresh tokens carry a random jti so a stolen-and-replayed token can
 * be distinguished from the live one after rotation.
 */
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      jurisdiction: user.jurisdiction,
      tv: user.tokenVersion || 0
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY, issuer: 'lm-verify', audience: 'lm-verify-api' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      tv: user.tokenVersion || 0,
      jti: crypto.randomBytes(16).toString('hex')
    },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRY, issuer: 'lm-verify', audience: 'lm-verify-refresh' }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET, { issuer: 'lm-verify', audience: 'lm-verify-api' });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET, { issuer: 'lm-verify', audience: 'lm-verify-refresh' });
}

function refreshExpiryDate() {
  return new Date(Date.now() + REFRESH_EXPIRY_MS);
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SECURE ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: REFRESH_EXPIRY_MS
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SECURE ? 'none' : 'lax',
    path: '/api/auth'
  });
}

function readRefreshToken(req) {
  return (req.cookies && req.cookies[REFRESH_COOKIE]) || (req.body && req.body.refreshToken) || null;
}

module.exports = {
  REFRESH_COOKIE,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  refreshExpiryDate,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshToken
};
