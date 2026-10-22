const User = require('../models/User');
const { verifyAccessToken } = require('../services/tokenService');

const unauthorized = (res, message, code = 'UNAUTHORIZED') =>
  res.status(401).json({ success: false, error: { message, code: 401, reason: code } });

/**
 * Validates the bearer access token and loads the live user record, so a
 * deactivated or force-logged-out account cannot keep using a valid-looking JWT.
 */
const protect = async (req, res, next) => {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return unauthorized(res, 'Not authorized, no token provided', 'NO_TOKEN');
  }

  const token = header.slice(7).trim();
  if (!token) return unauthorized(res, 'Not authorized, no token provided', 'NO_TOKEN');

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return unauthorized(res, 'Access token expired', 'TOKEN_EXPIRED');
    }
    return unauthorized(res, 'Not authorized, token failed verification', 'TOKEN_INVALID');
  }

  const user = await User.findById(decoded.sub);

  if (!user) return unauthorized(res, 'Account no longer exists', 'USER_NOT_FOUND');
  if (!user.isActive) return unauthorized(res, 'Account has been deactivated', 'USER_INACTIVE');
  if ((user.tokenVersion || 0) !== (decoded.tv || 0)) {
    return unauthorized(res, 'Session has been revoked, please sign in again', 'TOKEN_REVOKED');
  }

  req.user = user;
  req.token = decoded;
  next();
};

module.exports = protect;
