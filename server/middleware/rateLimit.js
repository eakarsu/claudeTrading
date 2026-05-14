/**
 * Minimal in-memory rate limiter — no extra deps.
 * Good enough to stop casual brute-force and AI-cost-drain.
 * For production use a Redis-backed limiter (e.g. `rate-limiter-flexible`).
 */
export function createLimiter({ windowMs, max, keyFn = (req) => req.ip, message = 'Too many requests' }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Try again later.',
});

export const aiLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyFn: (req) => req.userId || req.ip,
  message: 'AI rate limit exceeded',
});

/**
 * Hourly AI budget — 20 AI calls per user per hour. This is the cross-project
 * standard "aiRateLimiter" that bounds runaway token spend even when individual
 * minutes stay under the burst cap. Configurable via AI_HOURLY_LIMIT.
 */
export const aiHourlyLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.AI_HOURLY_LIMIT || '20', 10),
  keyFn: (req) => req.userId || req.ip,
  message: 'Hourly AI budget exhausted (20 calls/hr). Try again later.',
});

export const tradeLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyFn: (req) => req.userId || req.ip,
  message: 'Trade rate limit exceeded',
});

/**
 * Sync limiter — protects endpoints that proxy to a 3rd-party provider
 * with its own quota (Finnhub, earnings providers). Intentionally strict:
 * a single user shouldn't be able to burn the shared API key.
 */
export const syncLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyFn: (req) => req.userId || req.ip,
  message: 'Sync rate limit exceeded. Try again in a few minutes.',
});
