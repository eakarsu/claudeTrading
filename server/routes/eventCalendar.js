import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { syncLimiter } from '../middleware/rateLimit.js';
import { idParam, eventCalendarQuery, eventCalendarCreateSchema } from '../schemas.js';
import { listEvents, addEvent } from '../services/eventCalendar.js';
import { fetchUpcomingEarnings } from '../services/earningsFetcher.js';
import { EventCalendar } from '../models/index.js';
import { NotFoundError } from '../errors.js';
import { z } from 'zod';

const router = Router();

/**
 * GET /api/event-calendar?start=YYYY-MM-DD&end=YYYY-MM-DD&symbol=AAPL
 * Returns the merged static + DB calendar for the given window. `symbol`
 * narrows earnings events but always returns macro (no-symbol) rows.
 */
router.get(
  '/',
  validate({ query: eventCalendarQuery }),
  asyncHandler(async (req, res) => {
    const { start, end, symbol } = req.query;
    res.json(await listEvents({ start, end, symbol }));
  }),
);

/**
 * POST /api/event-calendar
 * Add a DB-backed event (typically earnings). Static macro events are
 * immutable — to hide one, users can override with a skipDates entry instead.
 */
router.post(
  '/',
  validate({ body: eventCalendarCreateSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await addEvent(req.body));
  }),
);

/**
 * DELETE /api/event-calendar/:id — remove a DB-backed event.
 * Static rows have no id so this only affects user-added entries.
 */
router.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const row = await EventCalendar.findByPk(req.params.id);
    if (!row) throw new NotFoundError('Event');
    await row.destroy();
    res.json({ ok: true });
  }),
);

/**
 * POST /api/event-calendar/sync-earnings
 * On-demand refresh of earnings dates from the configured provider
 * (EARNINGS_PROVIDER env). Intended to be called manually or from a nightly
 * cron; rate-limited-friendly to call infrequently. Returns the counts from
 * the provider so the UI can show a "synced N earnings" toast.
 */
router.post(
  '/sync-earnings',
  syncLimiter,
  validate({
    body: z.object({
      daysAhead: z.coerce.number().int().positive().max(365).default(30),
      symbols:   z.array(z.string().trim().toUpperCase()).max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await fetchUpcomingEarnings(req.body));
  }),
);

export default router;
