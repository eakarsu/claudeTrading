/**
 * Wrap an async route handler so thrown errors/rejections are forwarded to
 * the Express error middleware chain instead of crashing the process.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
