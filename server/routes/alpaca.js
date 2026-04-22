import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { tradeLimiter } from '../middleware/rateLimit.js';
import { audit } from '../middleware/audit.js';
import * as alpaca from '../services/alpaca.js';
import { orderSchema, ordersQuery, portfolioHistoryQuery } from '../schemas.js';

const router = Router();

router.get('/account', asyncHandler(async (req, res) => {
  res.json(await alpaca.getAccount());
}));

router.get('/positions', asyncHandler(async (req, res) => {
  res.json(await alpaca.getPositions());
}));

router.get('/positions/:symbol', asyncHandler(async (req, res) => {
  res.json(await alpaca.getPosition(req.params.symbol));
}));

router.post(
  '/orders',
  tradeLimiter,
  validate({ body: orderSchema }),
  audit('alpaca.order.place', 'order', { captureBody: true }),
  asyncHandler(async (req, res) => {
    const result = await alpaca.placeOrder(req.body);
    res.json(result);
  }),
);

router.get('/orders', validate({ query: ordersQuery }), asyncHandler(async (req, res) => {
  const { status, limit } = req.query;
  res.json(await alpaca.getOrders(status, limit));
}));

router.delete('/orders/:id', audit('alpaca.order.cancel', 'order'), asyncHandler(async (req, res) => {
  await alpaca.cancelOrder(req.params.id);
  res.json({ success: true });
}));

// Close a single position at market. Alpaca liquidates the full qty — we do
// NOT expose partial-close here because the UI button is always "close".
// Literal path ordering: must be declared before any catch-all pattern.
router.delete(
  '/positions/close-all',
  tradeLimiter,
  audit('alpaca.positions.close-all', 'position'),
  asyncHandler(async (req, res) => {
    const result = await alpaca.closeAllPositions();
    res.json(result);
  }),
);

/**
 * POST /positions/:symbol/close-safely
 * Cancels every open order for this symbol first, then closes the
 * position. This is the fix for Alpaca's "insufficient qty available
 * for order (requested: N, available: 0)" error, which happens when a
 * pending order (e.g. a bracket-stop auto-placed on entry) has already
 * reserved the full qty against a close. Runs the two steps server-side
 * so the UI doesn't race.
 */
router.post(
  '/positions/:symbol/close-safely',
  tradeLimiter,
  audit('alpaca.position.close-safely', 'position', { captureBody: true }),
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const openOrders = await alpaca.getOrders('open', 100).catch(() => []);
    const toCancel = (openOrders || []).filter((o) => o.symbol === symbol);
    const cancelled = [];
    for (const o of toCancel) {
      try { await alpaca.cancelOrder(o.id); cancelled.push(o.id); }
      catch (_) { /* ignore — order may have filled in the meantime */ }
    }
    const closeResult = await alpaca.closePosition(symbol);
    res.json({ cancelled, closeResult });
  }),
);

router.delete(
  '/positions/:symbol',
  tradeLimiter,
  audit('alpaca.position.close', 'position'),
  asyncHandler(async (req, res) => {
    const result = await alpaca.closePosition(req.params.symbol);
    res.json(result);
  }),
);

router.get('/clock', asyncHandler(async (req, res) => {
  res.json(await alpaca.getClock());
}));

router.get(
  '/portfolio-history',
  validate({ query: portfolioHistoryQuery }),
  asyncHandler(async (req, res) => {
    const { period, timeframe } = req.query;
    res.json(await alpaca.getPortfolioHistory(period, timeframe));
  }),
);

export default router;
