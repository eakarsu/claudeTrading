import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import * as alpaca from '../services/alpaca.js';
import { QTable } from '../models/index.js';
import { trainQTable, evaluatePolicy, BUCKETS } from '../services/rlLite.js';
import { BadRequestError, NotFoundError } from '../errors.js';

/**
 * RL-lite — tabular Q-learning endpoints.
 *
 *   GET    /buckets                  discretization reference
 *   GET    /                         list user's saved tables
 *   GET    /:id                      read full Q-table
 *   POST   /train                    train + optionally save {symbol,timeframe,days,params,save,name}
 *   POST   /:id/evaluate             eval stored table on fresh bars
 *   DELETE /:id
 */

const router = Router();

router.get('/buckets', (_req, res) => res.json(BUCKETS));

router.get('/', asyncHandler(async (req, res) => {
  const rows = await QTable.findAll({
    where: { userId: req.userId },
    attributes: ['id', 'name', 'symbol', 'timeframe', 'params', 'stats', 'trainedAt', 'createdAt'],
    order: [['trainedAt', 'DESC']],
  });
  res.json({ items: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await QTable.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Q-table not found');
  res.json(row);
}));

router.post('/train', asyncHandler(async (req, res) => {
  const {
    symbol, timeframe = '1Day', days = 365,
    params = {}, oosSplit = 0.2,
    save = false, name = null,
  } = req.body || {};
  if (!symbol) throw new BadRequestError('symbol required');
  const d = Number(days);
  if (!Number.isFinite(d) || d < 60 || d > 3650) throw new BadRequestError('days must be 60..3650');
  if (oosSplit < 0 || oosSplit >= 0.5) throw new BadRequestError('oosSplit must be in [0, 0.5)');

  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, d);
  if (bars.length < 100) throw new BadRequestError('Need ≥100 bars');

  const splitIdx = Math.floor(bars.length * (1 - oosSplit));
  const trainBars = bars.slice(0, splitIdx);
  const oosBars = bars.slice(splitIdx);

  const { qTable, log } = trainQTable(trainBars, params);
  const inSample = evaluatePolicy(trainBars, qTable);
  const oos = oosBars.length >= 50 ? evaluatePolicy(oosBars, qTable) : null;

  const stats = {
    inSample: {
      totalTrades: inSample.totalTrades,
      winRate: inSample.winRate,
      totalReturnPct: inSample.totalReturnPct,
    },
    oos: oos ? {
      totalTrades: oos.totalTrades,
      winRate: oos.winRate,
      totalReturnPct: oos.totalReturnPct,
    } : null,
    statesVisited: inSample.statesVisited,
    episodes: log.episodes,
  };

  let saved = null;
  if (save) {
    if (!name) throw new BadRequestError('name required when save=true');
    saved = await QTable.create({
      userId: req.userId,
      name,
      symbol: symbol.toUpperCase(),
      timeframe,
      buckets: BUCKETS,
      qTable,
      params,
      stats,
    });
  }

  res.json({
    symbol: symbol.toUpperCase(),
    timeframe,
    params,
    qTable,
    stats,
    inSampleTrades: inSample.trades,
    oosTrades: oos?.trades || [],
    savedId: saved?.id || null,
  });
}));

router.post('/:id/evaluate', asyncHandler(async (req, res) => {
  const row = await QTable.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Q-table not found');

  const { symbol = row.symbol, timeframe = row.timeframe, days = 365 } = req.body || {};
  const d = Number(days);
  if (!Number.isFinite(d) || d < 60 || d > 3650) throw new BadRequestError('days must be 60..3650');

  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, d);
  const result = evaluatePolicy(bars, row.qTable);
  res.json({ symbol: symbol.toUpperCase(), timeframe, ...result });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const row = await QTable.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Q-table not found');
  await row.destroy();
  res.json({ ok: true });
}));

export default router;
