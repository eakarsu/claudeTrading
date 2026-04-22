import { Router } from 'express';
import { Op } from 'sequelize';
import { asyncHandler } from '../middleware/async.js';
import { ProducedSignal } from '../models/index.js';
import { BadRequestError } from '../errors.js';

/**
 * Producer / Consumer mode — a strategy instance (the "producer") posts
 * signals to a named channel; one or more "consumer" instances subscribe and
 * read them. DB-backed so producers and consumers don't need to share a
 * process. Signals auto-expire via expiresAt.
 *
 * Compared to freqtrade's WebSocket relay, this is simpler: consumers poll
 * /consumer/:producerId. Good enough for the use case (minutes-granular
 * decision loops) and avoids needing a websocket layer.
 */

const router = Router();

const ALLOWED_ACTIONS = new Set(['buy', 'sell', 'hold']);

router.post('/producer/:producerId', asyncHandler(async (req, res) => {
  const { producerId } = req.params;
  if (!producerId || producerId.length > 64) throw new BadRequestError('producerId ≤64 chars required');
  const { symbol, action, price, strategy, meta, ttlSeconds = 3600 } = req.body || {};
  if (!symbol || !action) throw new BadRequestError('symbol and action required');
  if (!ALLOWED_ACTIONS.has(action)) throw new BadRequestError(`action must be one of ${[...ALLOWED_ACTIONS].join(',')}`);
  const ttl = Math.max(10, Math.min(86_400, Number(ttlSeconds) || 3600));
  const row = await ProducedSignal.create({
    userId: req.userId ?? null,
    producerId,
    symbol: symbol.toUpperCase(),
    action, price: price ?? null, strategy: strategy ?? null,
    meta: meta || {},
    expiresAt: new Date(Date.now() + ttl * 1000),
  });
  res.status(201).json(row);
}));

router.get('/consumer/:producerId', asyncHandler(async (req, res) => {
  const { producerId } = req.params;
  const sinceId = Number(req.query.sinceId) || 0;
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const rows = await ProducedSignal.findAll({
    where: {
      producerId,
      userId: req.userId ?? null,
      id: { [Op.gt]: sinceId },
      expiresAt: { [Op.gt]: new Date() },
    },
    order: [['id', 'ASC']],
    limit,
  });
  res.json({ items: rows, lastId: rows.length ? rows[rows.length - 1].id : sinceId });
}));

// Housekeeping: purge expired signals. Called by the route handler on read
// (lazy cleanup). Idempotent.
router.delete('/expired', asyncHandler(async (req, res) => {
  const n = await ProducedSignal.destroy({
    where: { expiresAt: { [Op.lte]: new Date() } },
  });
  res.json({ purged: n });
}));

export default router;
