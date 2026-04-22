/**
 * Notifications — in-app feed.
 *
 * Routes are auth-scoped: every query filters by req.userId so one user can
 * never see or mutate another user's notifications.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { Notification } from '../models/index.js';
import { idParam } from '../schemas.js';
import { NotFoundError } from '../errors.js';

const router = Router();

const listQuery = z.object({
  unread: z.coerce.boolean().optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { unread, limit, offset } = req.query;
    const where = { userId: req.userId };
    if (unread === true) where.read = false;
    const { rows, count } = await Notification.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit, offset,
    });
    const unreadCount = await Notification.count({
      where: { userId: req.userId, read: false },
    });
    res.json({ items: rows, total: count, unreadCount, limit, offset });
  }),
);

router.get('/unread-count', asyncHandler(async (req, res) => {
  const unreadCount = await Notification.count({
    where: { userId: req.userId, read: false },
  });
  res.json({ unreadCount });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  const [count] = await Notification.update(
    { read: true },
    { where: { userId: req.userId, read: false } },
  );
  res.json({ success: true, updated: count });
}));

router.patch(
  '/:id/read',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const row = await Notification.findOne({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!row) throw new NotFoundError('Notification');
    await row.update({ read: true });
    res.json(row.toJSON());
  }),
);

router.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const row = await Notification.findOne({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!row) throw new NotFoundError('Notification');
    await row.destroy();
    res.json({ success: true });
  }),
);

export default router;
