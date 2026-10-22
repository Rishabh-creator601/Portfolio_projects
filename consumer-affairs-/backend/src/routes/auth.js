const express = require('express');
const router = express.Router();
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const rateLimit = require('../middleware/rateLimit');
const {
  validate,
  loginSchema,
  registerSchema,
  signupSchema,
  changePasswordSchema
} = require('../utils/validators');
const {
  APP_URL,
  GOOGLE_ENABLED,
  SIGNUP_ENABLED,
  SELF_SIGNUP_ROLE,
  COOKIE_SECURE
} = require('../config/env');
const {
  randomToken,
  buildAuthUrl,
  exchangeCode,
  verifyIdToken,
  isDomainAllowed
} = require('../services/googleOAuth');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  refreshExpiryDate,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshToken
} = require('../services/tokenService');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'login',
  message: 'Too many sign-in attempts. Please wait before trying again.'
});

const refreshLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, keyPrefix: 'refresh' });

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyPrefix: 'signup',
  message: 'Too many accounts created from this network. Please try again later.'
});

const oauthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keyPrefix: 'oauth' });

const record = (req, action, outcome, extra = {}) =>
  AuditLog.logAction({
    actor: req.user ? req.user._id : null,
    actorEmail: (req.user && req.user.email) || (req.body && req.body.email) || 'anonymous',
    action,
    target: 'auth',
    after: { outcome, ...extra },
    ip: req.ip,
    userAgent: req.get('User-Agent')
  }).catch(() => {});

/** Issues a fresh access token and rotates the stored refresh token. */
async function issueSession(res, user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  await user.setRefreshToken(refreshToken, refreshExpiryDate());
  setRefreshCookie(res, refreshToken);

  return { accessToken, refreshToken, user: user.toSafeJSON() };
}

// POST /api/auth/register - controllers provision officer accounts
router.post(
  '/register',
  protect,
  authorize('controller'),
  validate(registerSchema),
  async (req, res, next) => {
    try {
      const { email, password, role, jurisdiction, displayName } = req.body;

      if (await User.findOne({ email })) {
        return res.status(409).json({
          success: false,
          error: { message: 'An account with that email already exists', code: 409 }
        });
      }

      const user = await User.create({
        email,
        passwordHash: password, // hashed by the pre-save hook
        role,
        jurisdiction,
        displayName
      });

      record(req, 'auth.register', 'success', { createdUser: user.email, role });
      res.status(201).json({ success: true, data: user.toSafeJSON() });
    } catch (error) {
      next(error);
    }
  }
);

// Cookies carrying the OAuth state and nonce. Short-lived: they only need to
// survive the round trip to Google's consent screen.
const OAUTH_STATE_COOKIE = 'lmv_oauth_state';
const OAUTH_NONCE_COOKIE = 'lmv_oauth_nonce';
const OAUTH_COOKIE_MAX_AGE = 10 * 60 * 1000;

const oauthCookieOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  // 'lax' is required: Google's redirect back is a cross-site top-level GET, and
  // 'strict' would stop the browser sending these cookies on that navigation.
  sameSite: COOKIE_SECURE ? 'none' : 'lax',
  path: '/api/auth',
  maxAge: OAUTH_COOKIE_MAX_AGE
};

const clearOAuthCookies = (res) => {
  const opts = { ...oauthCookieOptions };
  delete opts.maxAge;
  res.clearCookie(OAUTH_STATE_COOKIE, opts);
  res.clearCookie(OAUTH_NONCE_COOKIE, opts);
};

/** Sends the browser back to the app's OAuth landing page with an outcome. */
const redirectToApp = (res, params) =>
  res.redirect(`${APP_URL}/auth/callback?${new URLSearchParams(params).toString()}`);

// GET /api/auth/providers - lets the sign-in UI show only what actually works
router.get('/providers', (req, res) => {
  res.status(200).json({
    success: true,
    data: { password: true, google: GOOGLE_ENABLED, signupEnabled: SIGNUP_ENABLED }
  });
});

// POST /api/auth/signup - public self-registration
router.post('/signup', signupLimiter, validate(signupSchema), async (req, res, next) => {
  try {
    if (!SIGNUP_ENABLED) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Self-registration is disabled. Ask your Controller to provision an account.',
          code: 403
        }
      });
    }

    const { email, password, displayName, jurisdiction } = req.body;

    if (await User.findOne({ email })) {
      return res.status(409).json({
        success: false,
        error: { message: 'An account with that email already exists', code: 409 }
      });
    }

    const user = await User.create({
      email,
      passwordHash: password, // hashed by the pre-save hook
      // Never taken from the request body: self-registration always yields the
      // least-privileged role, and a Controller promotes from there.
      role: SELF_SIGNUP_ROLE,
      jurisdiction: jurisdiction || 'Unassigned',
      displayName,
      authProvider: 'local'
    });

    const session = await issueSession(res, user);
    record(req, 'auth.signup', 'success', { role: SELF_SIGNUP_ROLE });
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/google - starts the consent round trip
router.get('/google', oauthLimiter, (req, res, next) => {
  try {
    if (!GOOGLE_ENABLED) {
      return redirectToApp(res, { error: 'google_not_configured' });
    }

    const state = randomToken();
    const nonce = randomToken();

    res.cookie(OAUTH_STATE_COOKIE, state, oauthCookieOptions);
    res.cookie(OAUTH_NONCE_COOKIE, nonce, oauthCookieOptions);

    res.redirect(buildAuthUrl({ state, nonce }));
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/google/callback - Google redirects the browser back here
router.get('/google/callback', oauthLimiter, async (req, res, next) => {
  const fail = (reason) => {
    clearOAuthCookies(res);
    record(req, 'auth.google', 'failure', { reason });
    return redirectToApp(res, { error: reason });
  };

  try {
    if (!GOOGLE_ENABLED) return fail('google_not_configured');
    if (req.query.error) return fail('consent_denied');

    const { code, state } = req.query;
    const expectedState = req.cookies && req.cookies[OAUTH_STATE_COOKIE];
    const expectedNonce = req.cookies && req.cookies[OAUTH_NONCE_COOKIE];

    if (!code) return fail('missing_code');
    if (!state || !expectedState || state !== expectedState) return fail('state_mismatch');

    const idToken = await exchangeCode(String(code));
    const profile = await verifyIdToken(idToken, expectedNonce);

    if (!isDomainAllowed(profile.email, profile.hostedDomain)) {
      return fail('domain_not_allowed');
    }

    // Match on the Google subject first, then fall back to email so an officer
    // provisioned with a password can link Google to the same account.
    let user =
      (await User.findOne({ googleId: profile.googleId }).select('+googleId')) ||
      (await User.findOne({ email: profile.email }).select('+googleId'));

    if (user) {
      if (!user.isActive) return fail('account_inactive');

      let dirty = false;
      if (!user.googleId) {
        user.googleId = profile.googleId;
        dirty = true;
      }
      if (!user.avatarUrl && profile.avatarUrl) {
        user.avatarUrl = profile.avatarUrl;
        dirty = true;
      }
      if (profile.emailVerified && !user.emailVerified) {
        user.emailVerified = true;
        dirty = true;
      }
      if (dirty) await user.save();

      await user.registerSuccessfulLogin();
      record(req, 'auth.google', 'success', { linked: true, userId: user._id });
    } else {
      if (!SIGNUP_ENABLED) return fail('signup_disabled');

      user = await User.create({
        email: profile.email,
        googleId: profile.googleId,
        role: SELF_SIGNUP_ROLE,
        jurisdiction: 'Unassigned',
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        emailVerified: profile.emailVerified,
        authProvider: 'google'
        // No passwordHash: this account signs in through Google until the
        // officer sets a password from their profile.
      });

      record(req, 'auth.google', 'success', { created: true, userId: user._id });
    }

    clearOAuthCookies(res);
    await issueSession(res, user);

    // The access token is not put in the URL - the app calls /auth/refresh with
    // the httpOnly cookie that issueSession just set.
    return redirectToApp(res, { status: 'ok' });
  } catch (error) {
    if (error && /nonce|id_token|authorization code|signing key/i.test(error.message)) {
      return fail('token_verification_failed');
    }
    return next(error);
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select(
      '+passwordHash +failedLoginAttempts +lockUntil +refreshTokenHash'
    );

    // Uniform response for unknown email / wrong password / inactive account so
    // the endpoint cannot be used to enumerate valid officer accounts.
    const invalid = () => {
      record(req, 'auth.login', 'failure');
      return res
        .status(401)
        .json({ success: false, error: { message: 'Invalid email or password', code: 401 } });
    };

    if (!user) {
      // Equalise timing against the bcrypt comparison on the happy path.
      await new Promise((resolve) => setTimeout(resolve, 120));
      return invalid();
    }

    if (user.isLocked()) {
      record(req, 'auth.login', 'locked');
      const retryAfter = Math.ceil((user.lockUntil.getTime() - Date.now()) / 1000);
      return res.status(423).json({
        success: false,
        error: {
          message: 'Account temporarily locked after repeated failed sign-in attempts.',
          code: 423,
          retryAfter
        }
      });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      await user.registerFailedLogin();
      return invalid();
    }

    if (!user.isActive) return invalid();

    await user.registerSuccessfulLogin();
    const session = await issueSession(res, user);

    record(req, 'auth.login', 'success');
    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/refresh - rotates the refresh token on every use
router.post('/refresh', refreshLimiter, async (req, res, next) => {
  try {
    const token = readRefreshToken(req);

    const reject = (message, reason) => {
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, error: { message, code: 401, reason } });
    };

    if (!token) return reject('No refresh token provided', 'NO_REFRESH_TOKEN');

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch (err) {
      return reject('Refresh token is invalid or expired', 'REFRESH_INVALID');
    }

    const user = await User.findById(decoded.sub).select('+refreshTokenHash +refreshTokenExpiresAt');

    if (!user || !user.isActive) return reject('Session is no longer valid', 'USER_INVALID');
    if ((user.tokenVersion || 0) !== (decoded.tv || 0)) {
      return reject('Session has been revoked', 'TOKEN_REVOKED');
    }

    // The token must match the one currently on record. A mismatch means it was
    // already rotated - treat that as replay and kill the whole session.
    if (!user.refreshTokenHash || user.refreshTokenHash !== User.hashToken(token)) {
      await user.clearRefreshToken();
      record(req, 'auth.refresh', 'replay_detected', { userId: user._id });
      return reject('Session has been revoked, please sign in again', 'TOKEN_REUSE');
    }

    if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt.getTime() < Date.now()) {
      await user.clearRefreshToken();
      return reject('Session expired, please sign in again', 'REFRESH_EXPIRED');
    }

    const session = await issueSession(res, user);
    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout - revokes the stored refresh token
router.post('/logout', protect, async (req, res, next) => {
  try {
    await req.user.clearRefreshToken();
    clearRefreshCookie(res);
    record(req, 'auth.logout', 'success');
    res.status(200).json({ success: true, data: { message: 'Signed out' } });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout-all - invalidates every issued token for this account
router.post('/logout-all', protect, async (req, res, next) => {
  try {
    await User.updateOne(
      { _id: req.user._id },
      { $inc: { tokenVersion: 1 }, $unset: { refreshTokenHash: 1, refreshTokenExpiresAt: 1 } }
    );
    clearRefreshCookie(res);
    record(req, 'auth.logout_all', 'success');
    res.status(200).json({ success: true, data: { message: 'All sessions revoked' } });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/change-password
router.post('/change-password', protect, validate(changePasswordSchema), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+passwordHash');

    if (!(await user.comparePassword(currentPassword))) {
      record(req, 'auth.change_password', 'failure');
      return res
        .status(401)
        .json({ success: false, error: { message: 'Current password is incorrect', code: 401 } });
    }

    if (await user.comparePassword(newPassword)) {
      return res.status(400).json({
        success: false,
        error: { message: 'New password must be different from the current password', code: 400 }
      });
    }

    // The pre-save hook re-hashes and bumps tokenVersion, revoking old sessions.
    user.passwordHash = newPassword;
    await user.save();
    await user.clearRefreshToken();
    clearRefreshCookie(res);

    record(req, 'auth.change_password', 'success');
    res.status(200).json({
      success: true,
      data: { message: 'Password updated. Please sign in again with your new password.' }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
router.get('/me', protect, (req, res) => {
  res.status(200).json({ success: true, data: req.user.toSafeJSON() });
});

module.exports = router;
