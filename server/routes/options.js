/**
 * Options data routes.
 *
 *   POST /api/options/sync/:symbol   — fetch Tradier chain + upsert to DB
 *     Body (optional): { expiration: "YYYY-MM-DD" }
 *     Default expiration: next Friday (standard weekly options cycle)
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { syncOptionsChain } from '../services/optionsData.js';
import { BadRequestError } from '../errors.js';

const router = Router();

/** Return the next Friday from today as YYYY-MM-DD (default expiry). */
function nextFriday() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun … 6=Sat
  const daysUntilFriday = day <= 5 ? 5 - day : 6; // if today is Saturday, 6 days
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilFriday);
  return next.toISOString().slice(0, 10);
}

/**
 * POST /api/options/sync/:symbol
 *
 * Triggers a Tradier options chain fetch for the given symbol and upserts all
 * contracts into the local OptionsChain table.  The AI /options-strategy
 * endpoint will automatically pick up the refreshed rows.
 *
 * Example:
 *   POST /api/options/sync/AAPL
 *   { "expiration": "2025-01-17" }
 */
router.post('/sync/:symbol', asyncHandler(async (req, res) => {
  const symbol = req.params.symbol?.trim().toUpperCase();
  if (!symbol || !/^[A-Z]{1,6}$/.test(symbol)) {
    throw new BadRequestError('symbol must be 1-6 uppercase letters');
  }

  let { expiration } = req.body || {};
  if (!expiration) {
    expiration = nextFriday();
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) {
    throw new BadRequestError('expiration must be YYYY-MM-DD');
  }

  const result = await syncOptionsChain(symbol, expiration);

  res.json({
    ok: true,
    symbol,
    expiration,
    upserted: result.upserted,
    message: `Synced ${result.upserted} option contracts for ${symbol} (exp ${expiration}).`,
  });
}));

export default router;
