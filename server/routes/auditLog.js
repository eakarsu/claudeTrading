/**
 * Read-only audit log access. Listing is paginated and filterable by action
 * or resource; there is deliberately no delete/update route — audit rows are
 * append-only to preserve their forensic value.
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { AuditLog } from '../models/index.js';
import { toCsv } from '../services/csv.js';
import { z } from 'zod';

const router = Router();

const listQuery = z.object({
  action:   z.string().max(64).optional(),
  resource: z.string().max(64).optional(),
  userId:   z.coerce.number().int().positive().optional(),
  limit:    z.coerce.number().int().positive().max(500).default(100),
  offset:   z.coerce.number().int().nonnegative().default(0),
});

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { action, resource, userId, limit, offset } = req.query;
    const where = {};
    if (action)   where.action = action;
    if (resource) where.resource = resource;
    if (userId)   where.userId = userId;
    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      limit, offset,
      order: [['createdAt', 'DESC']],
    });
    res.json({ items: rows.map((r) => r.toJSON()), total: count, limit, offset });
  }),
);

/**
 * CSV export of the same view. Same filters, but uncapped (500 row max per
 * call) so an operator can spool the log for offline review.
 */
router.get(
  '/export.csv',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { action, resource, userId, limit, offset } = req.query;
    const where = {};
    if (action)   where.action = action;
    if (resource) where.resource = resource;
    if (userId)   where.userId = userId;
    const rows = await AuditLog.findAll({
      where, limit, offset, order: [['createdAt', 'DESC']],
    });
    const csv = toCsv(
      rows.map((r) => r.toJSON()),
      ['id', 'createdAt', 'userId', 'action', 'resource', 'resourceId', 'ip', 'userAgent', 'meta'],
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.csv"`);
    res.send(csv);
  }),
);

export default router;
