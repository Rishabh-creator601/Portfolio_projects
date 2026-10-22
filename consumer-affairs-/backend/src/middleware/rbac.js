/**
 * Route guard: allows the request only if the authenticated user holds one of
 * the listed roles. `protect` must run first.
 */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: { message: 'Not authorized, no active session', code: 401 }
    });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: {
        message: `Role "${req.user.role}" is not permitted to perform this action`,
        code: 403,
        requiredRoles: roles
      }
    });
  }

  next();
};

module.exports = authorize;
