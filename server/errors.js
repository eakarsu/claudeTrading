/**
 * Typed errors that carry an HTTP status + optional cause.
 * Services throw these; the error middleware maps them to JSON responses.
 */
export class HttpError extends Error {
  constructor(status, message, { cause, code, details } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (cause !== undefined) this.cause = cause;
    if (code !== undefined) this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request', opts) { super(400, message, opts); this.name = 'BadRequestError'; }
}
export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized', opts) { super(401, message, opts); this.name = 'UnauthorizedError'; }
}
export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', opts) { super(403, message, opts); this.name = 'ForbiddenError'; }
}
export class NotFoundError extends HttpError {
  constructor(message = 'Not found', opts) { super(404, message, opts); this.name = 'NotFoundError'; }
}
export class ConflictError extends HttpError {
  constructor(message = 'Conflict', opts) { super(409, message, opts); this.name = 'ConflictError'; }
}
export class TooManyRequestsError extends HttpError {
  constructor(message = 'Too many requests', opts) { super(429, message, opts); this.name = 'TooManyRequestsError'; }
}
export class UpstreamError extends HttpError {
  constructor(message = 'Upstream service failed', opts) { super(502, message, opts); this.name = 'UpstreamError'; }
}
