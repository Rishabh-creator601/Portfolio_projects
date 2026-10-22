/**
 * Minimal cookie parser. Kept in-repo so the service has no extra runtime
 * dependency for the two cookies the auth flow uses.
 */
function cookieParser(req, res, next) {
  const header = req.headers.cookie;
  req.cookies = {};

  if (header) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 1) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!key || key in req.cookies) continue;
      try {
        req.cookies[key] = decodeURIComponent(value);
      } catch {
        req.cookies[key] = value;
      }
    }
  }

  next();
}

module.exports = cookieParser;
