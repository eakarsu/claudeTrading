import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { AutoTraderTrade, SavedBacktest } from '../models/index.js';
import { analyze } from '../services/backtestAnalysis.js';
import { BadRequestError, NotFoundError } from '../errors.js';

/**
 * Backtesting-analysis endpoints (freqtrade parity).
 *
 *   GET  /trades?group=0..5&enterReasons=&exitReasons=   — analyze AutoTraderTrade rows
 *   GET  /saved/:id?group=0..5&enterReasons=&exitReasons= — analyze a saved backtest's trades
 *
 * enterReasons/exitReasons are CSV strings.
 */

const router = Router();

function parseCsv(q) {
  if (!q) return null;
  return String(q).split(',').map((s) => s.trim()).filter(Boolean);
}

router.get('/trades', asyncHandler(async (req, res) => {
  const group = Number(req.query.group ?? 0);
  if (!Number.isFinite(group) || group < 0 || group > 5) throw new BadRequestError('group must be 0..5');

  const rows = await AutoTraderTrade.findAll({
    where: { userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit: 10_000,
  });

  const result = analyze(rows, {
    group,
    enterReasonList: parseCsv(req.query.enterReasons),
    exitReasonList:  parseCsv(req.query.exitReasons),
  });
  res.json(result);
}));

router.get('/saved/:id', asyncHandler(async (req, res) => {
  const group = Number(req.query.group ?? 0);
  if (!Number.isFinite(group) || group < 0 || group > 5) throw new BadRequestError('group must be 0..5');

  const row = await SavedBacktest.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Saved backtest not found');

  const trades = row.result?.trades || [];
  const result = analyze(trades, {
    group,
    enterReasonList: parseCsv(req.query.enterReasons),
    exitReasonList:  parseCsv(req.query.exitReasons),
    fallbackSymbol: row.symbol,   // backtest trades lack symbol — stamp from run
  });
  res.json({ savedBacktestId: row.id, symbol: row.symbol, strategyKey: row.strategyKey, ...result });
}));

export default router;
