import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import * as alpaca from '../services/alpaca.js';
import { UserStrategy } from '../models/index.js';
import { validateStrategy, backtestUserStrategy, EXAMPLE_STRATEGY } from '../services/strategySandbox.js';
import { barsPerYearForTimeframe } from '../services/comboBacktester.js';
import { BadRequestError, NotFoundError } from '../errors.js';

/**
 * User-authored JS strategies (sandboxed).
 *
 *   GET    /                     list
 *   GET    /example              canonical example source (for the editor)
 *   GET    /:id                  read
 *   POST   /                     create    { name, sourceJs, params?, notes? }
 *   PUT    /:id                  update
 *   DELETE /:id                  delete
 *   POST   /validate             validate source without saving
 *   POST   /:id/backtest         run a backtest using the stored strategy
 *   POST   /inline-backtest      run a backtest using body.sourceJs (no save)
 */

const router = Router();

function assertName(name) {
  if (!name || typeof name !== 'string' || name.length > 120) {
    throw new BadRequestError('name (≤120 chars) required');
  }
}
function assertSource(src) {
  if (!src || typeof src !== 'string') throw new BadRequestError('sourceJs required');
  if (src.length > 64 * 1024) throw new BadRequestError('sourceJs must be ≤64KB');
}

router.get('/', asyncHandler(async (req, res) => {
  const rows = await UserStrategy.findAll({
    where: { userId: req.userId },
    order: [['updatedAt', 'DESC']],
    attributes: ['id', 'name', 'notes', 'params', 'createdAt', 'updatedAt'],
  });
  res.json({ items: rows });
}));

router.get('/example', asyncHandler(async (_req, res) => {
  res.json({ sourceJs: EXAMPLE_STRATEGY });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await UserStrategy.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Strategy not found');
  res.json(row);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, sourceJs, params = {}, notes = null } = req.body || {};
  assertName(name); assertSource(sourceJs);

  // Compile-check before persisting so we never store a broken strategy.
  const check = validateStrategy(sourceJs, params);
  if (!check.ok) throw new BadRequestError(`Strategy failed validation: ${check.error}`);

  const row = await UserStrategy.create({ userId: req.userId, name, sourceJs, params, notes });
  res.status(201).json(row);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const row = await UserStrategy.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Strategy not found');

  const { name, sourceJs, params, notes } = req.body || {};
  if (name !== undefined) { assertName(name); row.name = name; }
  if (sourceJs !== undefined) {
    assertSource(sourceJs);
    const check = validateStrategy(sourceJs, params !== undefined ? params : row.params);
    if (!check.ok) throw new BadRequestError(`Strategy failed validation: ${check.error}`);
    row.sourceJs = sourceJs;
  }
  if (params !== undefined) row.params = params;
  if (notes !== undefined) row.notes = notes;
  await row.save();
  res.json(row);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const row = await UserStrategy.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Strategy not found');
  await row.destroy();
  res.json({ ok: true });
}));

router.post('/validate', asyncHandler(async (req, res) => {
  const { sourceJs, params = {} } = req.body || {};
  assertSource(sourceJs);
  res.json(validateStrategy(sourceJs, params));
}));

router.post('/:id/backtest', asyncHandler(async (req, res) => {
  const row = await UserStrategy.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Strategy not found');

  const { symbol, days = 365, timeframe = '1Day', options = {} } = req.body || {};
  if (!symbol) throw new BadRequestError('symbol required');
  const d = Number(days);
  if (!Number.isFinite(d) || d < 30 || d > 3650) throw new BadRequestError('days must be 30..3650');

  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, d);
  if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);
  const result = backtestUserStrategy(row.sourceJs, bars, {
    barsPerYear: barsPerYearForTimeframe(timeframe),
    params: row.params,
    ...options,
  });
  res.json({ ...result, strategyKey: `user:${row.id}`, strategy: row.name });
}));

router.post('/inline-backtest', asyncHandler(async (req, res) => {
  const { sourceJs, params = {}, symbol, days = 365, timeframe = '1Day', options = {} } = req.body || {};
  assertSource(sourceJs);
  if (!symbol) throw new BadRequestError('symbol required');
  const d = Number(days);
  if (!Number.isFinite(d) || d < 30 || d > 3650) throw new BadRequestError('days must be 30..3650');

  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, d);
  if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);
  const result = backtestUserStrategy(sourceJs, bars, {
    barsPerYear: barsPerYearForTimeframe(timeframe),
    params,
    ...options,
  });
  res.json(result);
}));

export default router;
