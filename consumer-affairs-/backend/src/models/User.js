const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { BCRYPT_ROUNDS, MAX_LOGIN_ATTEMPTS, LOCK_WINDOW_MS } = require('../config/env');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/,
      'Please add a valid email'
    ]
  },
  // Optional: an account created through Google has no local password until
  // the officer sets one. Every read path must tolerate its absence.
  passwordHash: {
    type: String,
    select: false
  },
  role: {
    type: String,
    enum: ['field_inspector', 'senior_inspector', 'controller', 'legal_officer', 'auditor'],
    required: true
  },
  // Google's stable subject id. Sparse so local-only accounts don't collide on null.
  googleId: {
    type: String,
    unique: true,
    sparse: true,
    select: false
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  avatarUrl: {
    type: String
  },
  // Mirrors "passwordHash is set". Kept as its own field because passwordHash
  // is select:false, so deriving this on a normal read would always say false.
  hasPassword: {
    type: Boolean,
    default: false
  },
  jurisdiction: {
    type: String
  },
  displayName: {
    type: String
  },
  mfaEnabled: {
    type: Boolean,
    default: false
  },
  mfaSecret: {
    type: String,
    select: false
  },
  // Incremented on logout-all / password change / deactivation so previously
  // issued access and refresh tokens stop validating immediately.
  tokenVersion: {
    type: Number,
    default: 0
  },
  // SHA-256 of the currently valid refresh token (rotation + revocation).
  refreshTokenHash: {
    type: String,
    select: false
  },
  refreshTokenExpiresAt: {
    type: Date,
    select: false
  },
  failedLoginAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  lockUntil: {
    type: Date,
    select: false
  },
  passwordChangedAt: {
    type: Date
  },
  lastLogin: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Hash the password whenever it is set or changed.
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash') || !this.passwordHash) return next();

  try {
    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    this.hasPassword = true;
    this.passwordChangedAt = new Date();
    if (!this.isNew) this.tokenVersion += 1;
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = function (enteredPassword) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(enteredPassword, this.passwordHash);
};

userSchema.methods.isLocked = function () {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
};

userSchema.methods.registerFailedLogin = function () {
  const attempts = (this.failedLoginAttempts || 0) + 1;
  const update = { $set: { failedLoginAttempts: attempts } };

  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    update.$set.lockUntil = new Date(Date.now() + LOCK_WINDOW_MS);
    update.$set.failedLoginAttempts = 0;
  }

  return this.constructor.updateOne({ _id: this._id }, update);
};

userSchema.methods.registerSuccessfulLogin = function () {
  return this.constructor.updateOne(
    { _id: this._id },
    { $set: { failedLoginAttempts: 0, lastLogin: new Date() }, $unset: { lockUntil: 1 } }
  );
};

// Refresh tokens are stored hashed, never in plaintext.
userSchema.statics.hashToken = function (token) {
  return crypto.createHash('sha256').update(token).digest('hex');
};

userSchema.methods.setRefreshToken = function (token, expiresAt) {
  return this.constructor.updateOne(
    { _id: this._id },
    { $set: { refreshTokenHash: this.constructor.hashToken(token), refreshTokenExpiresAt: expiresAt } }
  );
};

userSchema.methods.clearRefreshToken = function () {
  return this.constructor.updateOne(
    { _id: this._id },
    { $unset: { refreshTokenHash: 1, refreshTokenExpiresAt: 1 } }
  );
};

userSchema.methods.toSafeJSON = function () {
  return {
    _id: this._id,
    email: this.email,
    displayName: this.displayName,
    role: this.role,
    jurisdiction: this.jurisdiction,
    isActive: this.isActive,
    authProvider: this.authProvider,
    emailVerified: this.emailVerified,
    avatarUrl: this.avatarUrl,
    hasPassword: this.hasPassword,
    mfaEnabled: this.mfaEnabled,
    lastLogin: this.lastLogin,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);
