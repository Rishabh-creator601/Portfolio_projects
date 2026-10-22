/**
 * Fixed-window in-memory rate limiter. Sufficient for a single-node deployment;
 * swap the store for Redis when the API is horizontally scaled.
 */
const buckets = new Map();

const CLEANUP_INTERVAL_MS = 60 * 1000;
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, CLEANUP_INTERVAL_MS);
if (cleanup.unref) cleanup.unref();

function rateLimit({ windowMs = 60 * 1000, max = 30, keyPrefix = 'rl', message } = {}) {
  return (req, res, next) => {
    const identifier = `${keyPrefix}:${req.ip}:${(req.body && req.body.email) || ''}`;
    const now = Date.now();
    let entry = buckets.get(identifier);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(identifier, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: {
          message: message || 'Too many requests. Please try again later.',
          code: 429,
          retryAfter
        }
      });
    }

    next();
  };
}

module.exports = rateLimit;
