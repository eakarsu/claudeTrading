import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { STRATEGIES } from '../services/strategyEngine.js';
import { INTRADAY_STRATEGIES } from '../services/intradayStrategies.js';
import { UserStrategy, HyperoptRun, AutoTraderTrade, SavedBacktest } from '../models/index.js';
import * as alpaca from '../services/alpaca.js';
import { listExchanges } from '../services/exchanges/registry.js';
import { BadRequestError, NotFoundError } from '../errors.js';

/**
 * Utility sub-commands (freqtrade parity).
 *
 *   GET  /list-strategies    built-in + user-authored strategy keys
 *   GET  /list-timeframes    supported timeframe strings
 *   GET  /list-markets       exchanges we can talk to
 *   GET  /list-pairs         user-configurable pairs (watchlist-derived)
 *   GET  /list-data/:symbol  last bar timestamp for a symbol (freqtrade's
 *                            `list-data` shows what you've already downloaded)
 *   GET  /show-trades        recent AutoTraderTrade rows, trimmed
 *   POST /test-pairlist      filter a list of symbols by trivial liveness
 *                            (currently: non-empty symbol + alpha-only)
 *   GET  /hyperopt-list      HyperoptRun rows
 *   GET  /hyperopt-show/:id  single HyperoptRun row (includes params blob)
 */

const router = Router();

const INTRADAY_KEYS = new Set(Object.keys(INTRADAY_STRATEGIES));
const TIMEFRAMES = ['1Min', '5Min', '15Min', '30Min', '1Hour', '4Hour', '1Day', '1Week', '1Month'];

router.get('/list-strategies', asyncHandler(async (req, res) => {
  const builtin = Object.entries(STRATEGIES).map(([key, s]) => ({
    key, name: s.name, description: s.description,
    intraday: INTRADAY_KEYS.has(key),
    source: 'builtin',
  }));
  const userRows = await UserStrategy.findAll({
    where: { userId: req.userId },
    attributes: ['id', 'name', 'notes', 'updatedAt'],
  });
  const userList = userRows.map((r) => ({
    key: `user:${r.id}`, name: r.name, description: r.notes || '', source: 'user',
    updatedAt: r.updatedAt,
  }));
  res.json({ items: [...builtin, ...userList], total: builtin.length + userList.length });
}));

router.get('/list-timeframes', (_req, res) => {
  res.json({ items: TIMEFRAMES });
});

router.get('/list-markets', asyncHandler(async (_req, res) => {
  // Exchange adapters we can talk to. Mirrors /api/exchanges but served under
  // the util namespace so the util page can render everything via one
  // endpoint family.
  res.json({ items: await listExchanges() });
}));

router.get('/list-pairs', asyncHandler(async (req, res) => {
  // Freqtrade's list-pairs shows the exchange's tradable pairs. We don't
  // fan out to remote metadata here — instead we show the user's own
  // watchlist and any symbols that have appeared in their recent trades.
  const trades = await AutoTraderTrade.findAll({
    where: { userId: req.userId },
    attributes: ['symbol'],
    order: [['createdAt', 'DESC']],
    limit: 500,
  });
  const symbols = Array.from(new Set(trades.map((t) => t.symbol).filter(Boolean))).sort();
  res.json({ items: symbols });
}));

router.get('/list-data/:symbol', asyncHandler(async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const timeframe = req.query.timeframe || '1Day';
  const days = Math.min(Number(req.query.days) || 30, 365);
  try {
    const bars = await alpaca.getBars(symbol, timeframe, days);
    if (!bars.length) return res.json({ symbol, timeframe, bars: 0, first: null, last: null });
    res.json({
      symbol, timeframe, bars: bars.length,
      first: bars[0].time,
      last: bars[bars.length - 1].time,
      lastClose: bars[bars.length - 1].close,
    });
  } catch (e) {
    throw new BadRequestError(`list-data failed: ${e.message}`);
  }
}));

router.get('/show-trades', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const rows = await AutoTraderTrade.findAll({
    where: { userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit,
    attributes: ['id', 'symbol', 'action', 'qty', 'price', 'strategy', 'reason', 'pnl', 'leverage', 'createdAt'],
  });
  res.json({ items: rows });
}));

router.post('/test-pairlist', asyncHandler(async (req, res) => {
  const { symbols = [] } = req.body || {};
  if (!Array.isArray(symbols)) throw new BadRequestError('symbols must be an array');
  const accepted = [];
  const rejected = [];
  for (const s of symbols) {
    if (!s || typeof s !== 'string') { rejected.push({ symbol: s, reason: 'not a string' }); continue; }
    const clean = s.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,10}$/.test(clean)) { rejected.push({ symbol: s, reason: 'malformed' }); continue; }
    accepted.push(clean);
  }
  res.json({ accepted, rejected, totalIn: symbols.length });
}));

router.get('/hyperopt-list', asyncHandler(async (req, res) => {
  const rows = await HyperoptRun.findAll({
    where: { userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit: 100,
    attributes: { exclude: ['results'] },  // heavy blob — keep list response small
  });
  res.json({ items: rows });
}));

router.get('/hyperopt-show/:id', asyncHandler(async (req, res) => {
  const row = await HyperoptRun.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Hyperopt run not found');
  res.json(row);
}));

export default router;
