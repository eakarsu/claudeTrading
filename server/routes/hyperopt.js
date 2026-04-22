import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { startHyperopt } from '../services/hyperopt.js';
import { startBayesianHyperopt } from '../services/bayesianHyperopt.js';
import { HyperoptRun } from '../models/index.js';
import { NotFoundError, BadRequestError } from '../errors.js';

const router = Router();

// List this user's recent hyperopt runs. The UI shows a sidebar of prior runs
// so users can compare optimization results without re-running the job.
router.get('/', asyncHandler(async (req, res) => {
  const rows = await HyperoptRun.findAll({
    where: { userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit: 50,
  });
  res.json({ items: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await HyperoptRun.findOne({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!row) throw new NotFoundError('Hyperopt run not found');
  res.json(row);
}));

// Kick off a new job. Accepts { strategyKey, symbol, days?, timeframe?, grid? }.
// Returns the row immediately; the client polls GET /:id for progress.
router.post('/', asyncHandler(async (req, res) => {
  const { strategyKey, symbol, days, timeframe, grid } = req.body || {};
  if (!strategyKey || typeof strategyKey !== 'string') {
    throw new BadRequestError('strategyKey required');
  }
  if (!symbol || typeof symbol !== 'string') {
    throw new BadRequestError('symbol required');
  }
  // Light validation on grid shape — each entry must be a non-empty array of
  // finite numbers. We don't want a user posting {grid: {stopLossPct: "foo"}}
  // and crashing the backtester mid-loop.
  if (grid && typeof grid === 'object') {
    for (const [k, v] of Object.entries(grid)) {
      if (!Array.isArray(v) || v.length === 0 || v.some((n) => !Number.isFinite(n))) {
        throw new BadRequestError(`grid.${k} must be a non-empty array of numbers`);
      }
    }
  }

  const row = await startHyperopt({
    userId: req.userId,
    strategyKey,
    symbol: symbol.toUpperCase(),
    days: days ? Number(days) : undefined,
    timeframe,
    grid: grid || {},
  });

  res.status(202).json({ id: row.id, status: row.status });
}));

// Bayesian variant — samples a continuous space instead of enumerating a grid.
// Body: { strategyKey, symbol, days?, timeframe?, space?, budget? }. The
// `space` shape is { paramName: { min, max, type: 'float'|'int' } }.
router.post('/bayesian', asyncHandler(async (req, res) => {
  const { strategyKey, symbol, days, timeframe, space, budget } = req.body || {};
  if (!strategyKey || !symbol) throw new BadRequestError('strategyKey and symbol required');
  if (space && typeof space === 'object') {
    for (const [k, d] of Object.entries(space)) {
      if (!d || typeof d !== 'object' || !Number.isFinite(d.min) || !Number.isFinite(d.max) || d.max <= d.min) {
        throw new BadRequestError(`space.${k} must have finite min < max`);
      }
    }
  }
  const b = Math.max(10, Math.min(500, Number(budget) || 40));
  const row = await startBayesianHyperopt({
    userId: req.userId,
    strategyKey, symbol: symbol.toUpperCase(),
    days: days ? Number(days) : undefined,
    timeframe,
    space: space || {},
    budget: b,
  });
  res.status(202).json({ id: row.id, status: row.status });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const row = await HyperoptRun.findOne({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!row) throw new NotFoundError('Hyperopt run not found');
  await row.destroy();
  res.json({ ok: true });
}));

export default router;
