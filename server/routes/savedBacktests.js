import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import * as alpaca from '../services/alpaca.js';
import { backtest } from '../services/backtester.js';
import { barsPerYearForTimeframe } from '../services/comboBacktester.js';
import { SavedBacktest } from '../models/index.js';
import { STRATEGIES } from '../services/strategyEngine.js';
import { BadRequestError, NotFoundError } from '../errors.js';

/**
 * Persisted backtest runs — the user runs a backtest, tags it with a name,
 * and we store the full result blob. Later they can list/browse/compare
 * runs instead of re-computing.
 */

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const rows = await SavedBacktest.findAll({
    where: { userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit: 200,
    // Omit the heavy result blob from the list endpoint — send a summary only.
    attributes: { exclude: ['result'] },
  });
  res.json({ items: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await SavedBacktest.findOne({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!row) throw new NotFoundError('Saved backtest not found');
  res.json(row);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, strategyKey, symbol, days = 365, timeframe = '1Day', options = {}, tags = [] } = req.body || {};
  if (!name || typeof name !== 'string' || name.length > 120) throw new BadRequestError('name (≤120 chars) required');
  if (!strategyKey || !STRATEGIES[strategyKey]) throw new BadRequestError('unknown strategyKey');
  if (!symbol || typeof symbol !== 'string') throw new BadRequestError('symbol required');
  const d = Number(days);
  if (!Number.isFinite(d) || d < 30 || d > 3650) throw new BadRequestError('days must be 30..3650');

  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, d);
  if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);
  const result = backtest(strategyKey, bars, {
    barsPerYear: barsPerYearForTimeframe(timeframe),
    ...options,
  });

  const row = await SavedBacktest.create({
    userId: req.userId,
    name, strategyKey, symbol: symbol.toUpperCase(),
    timeframe, days: d, options, result, tags,
  });
  res.status(201).json(row);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const row = await SavedBacktest.findOne({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!row) throw new NotFoundError('Saved backtest not found');
  await row.destroy();
  res.json({ ok: true });
}));

export default router;
