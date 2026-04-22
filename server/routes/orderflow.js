import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { recentTrades, imbalance } from '../services/orderflow.js';
import { BadRequestError } from '../errors.js';

/**
 * Orderflow endpoints — recent tape + L1-inferred imbalance.
 *
 *   GET /:symbol/trades?limit=100   — recent trade tape with side classification
 *   GET /:symbol/imbalance?n=100    — aggregated buy/sell pressure ratio
 */

const router = Router();

router.get('/:symbol/trades', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  if (!Number.isFinite(limit) || limit <= 0) throw new BadRequestError('limit must be positive');
  res.json(await recentTrades(req.params.symbol, limit));
}));

router.get('/:symbol/imbalance', asyncHandler(async (req, res) => {
  const n = Math.min(Number(req.query.n) || 100, 1000);
  res.json(await imbalance(req.params.symbol, n));
}));

export default router;
