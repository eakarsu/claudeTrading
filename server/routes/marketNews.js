/**
 * Market News custom routes. Mounted ahead of the generic CRUD router so
 * named paths (e.g. /sync) resolve before the CRUD `/:id` parameterised
 * route swallows them.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { syncLimiter } from '../middleware/rateLimit.js';
import { fetchLatestNews } from '../services/newsFetcher.js';
import { z } from 'zod';

const router = Router();

/**
 * POST /api/market-news/sync
 * On-demand refresh of market news from the configured provider
 * (NEWS_PROVIDER env, typically `finnhub` + FINNHUB_API_KEY). Accepts an
 * optional category ('general' | 'forex' | 'crypto' | 'merger') or a
 * specific symbol to pull company-news for. Returns the provider's
 * inserted / skipped counts so the UI can show a toast.
 */
router.post(
  '/sync',
  syncLimiter,
  validate({
    body: z.object({
      category: z.enum(['general', 'forex', 'crypto', 'merger']).default('general'),
      symbol:   z.string().trim().toUpperCase().max(12).optional(),
      max:      z.coerce.number().int().positive().max(100).default(25),
    }).partial().optional(),
  }),
  asyncHandler(async (req, res) => {
    const result = await fetchLatestNews(req.body || {});
    res.json(result);
  }),
);

export default router;
