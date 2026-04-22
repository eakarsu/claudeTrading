/**
 * Audit-log middleware.
 *
 * Captures "someone did X" events for sensitive endpoints (auto-trader start/
 * stop, live-order placement, config changes). These rows live in AuditLog and
 * are queryable for compliance / post-incident review.
 *
 * Usage: attach after auth, naming the action:
 *   router.post('/start', audit('auto-trader.start', 'auto-trader'), handler)
 *
 * We log BEFORE the handler runs (not after) because a failed handler is often
 * the most important thing to record. meta.status is patched in via res.on('finish').
 */

import { AuditLog } from '../models/index.js';
import { logger } from '../logger.js';

export function audit(action, resource = null, { captureBody = false } = {}) {
  return (req, res, next) => {
    const row = {
      userId: req.userId ?? null,
      action,
      resource,
      resourceId: req.params?.id?.toString?.() || null,
      ip: (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').trim().slice(0, 45),
      userAgent: (req.headers['user-agent'] || '').slice(0, 256),
      // Bodies may contain sensitive data (passwords, tokens). Opt-in only.
      meta: captureBody
        ? { body: scrub(req.body) }
        : {},
    };

    res.on('finish', () => {
      row.meta = { ...row.meta, status: res.statusCode };
      AuditLog.create(row).catch((err) => logger.warn({ err, action }, 'Audit log write failed'));
    });

    next();
  };
}

// Drop common secret-bearing keys from the body before persisting.
function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const k of Object.keys(clone)) {
    if (/password|token|secret|key/i.test(k)) {
      clone[k] = '[redacted]';
    } else if (clone[k] && typeof clone[k] === 'object') {
      clone[k] = scrub(clone[k]);
    }
  }
  return clone;
}
