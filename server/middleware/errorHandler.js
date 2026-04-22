import { ZodError } from 'zod';
import { HttpError } from '../errors.js';
import { logger } from '../logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// 4-arg signature required by Express to be treated as an error middleware.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }
  // CORS preflight mismatch surfaces as a generic Error.
  if (err && /CORS:/.test(err.message)) {
    return res.status(403).json({ error: err.message });
  }

  logger.error({ err, reqId: req.id, path: req.path, method: req.method }, 'Unhandled error');
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({ error: isProd ? 'Internal server error' : err.message });
}
