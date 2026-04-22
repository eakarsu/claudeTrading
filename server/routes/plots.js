import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import * as alpaca from '../services/alpaca.js';
import { backtest } from '../services/backtester.js';
import { barsPerYearForTimeframe } from '../services/comboBacktester.js';
import { computeAll } from '../services/indicators.js';
import { STRATEGIES } from '../services/strategyEngine.js';
import { BadRequestError } from '../errors.js';

/**
 * Plot commands — return chart-ready JSON for various freqtrade plot types:
 *   /equity       — equity curve (time, equity) from a backtest
 *   /drawdown     — drawdown %, per-bar
 *   /trades       — trade markers (buy/sell points on price chart)
 *   /indicators   — indicator series (sma20, sma50, rsi, macd, bollinger)
 *
 * The client side can render these with its existing chart components
 * (EquityCurveChart, DrawdownChart).
 */

const router = Router();

function requireBacktest(req) {
  const { strategyKey, symbol, days = 365, timeframe = '1Day' } = req.query;
  if (!strategyKey || !STRATEGIES[strategyKey]) throw new BadRequestError('unknown strategyKey');
  if (!symbol) throw new BadRequestError('symbol required');
  const d = Math.max(30, Math.min(3650, Number(days) || 365));
  return { strategyKey, symbol: String(symbol).toUpperCase(), days: d, timeframe };
}

router.get('/equity', asyncHandler(async (req, res) => {
  const q = requireBacktest(req);
  const bars = await alpaca.getBars(q.symbol, q.timeframe, q.days);
  const r = backtest(q.strategyKey, bars, { barsPerYear: barsPerYearForTimeframe(q.timeframe) });
  res.json({ symbol: q.symbol, strategy: q.strategyKey, curve: r.equityCurve || [] });
}));

router.get('/drawdown', asyncHandler(async (req, res) => {
  const q = requireBacktest(req);
  const bars = await alpaca.getBars(q.symbol, q.timeframe, q.days);
  const r = backtest(q.strategyKey, bars, { barsPerYear: barsPerYearForTimeframe(q.timeframe) });
  const curve = r.equityCurve || [];
  let peak = 0;
  const dd = curve.map((p) => {
    if (p.equity > peak) peak = p.equity;
    return { time: p.time, drawdown: peak > 0 ? (peak - p.equity) / peak : 0 };
  });
  res.json({ symbol: q.symbol, strategy: q.strategyKey, drawdown: dd });
}));

router.get('/trades', asyncHandler(async (req, res) => {
  const q = requireBacktest(req);
  const bars = await alpaca.getBars(q.symbol, q.timeframe, q.days);
  const r = backtest(q.strategyKey, bars, { barsPerYear: barsPerYearForTimeframe(q.timeframe) });
  res.json({
    symbol: q.symbol,
    strategy: q.strategyKey,
    // Flatten the trade log into marker-friendly rows. Each row is a single
    // entry/exit point so the frontend can plot both ends of a trade.
    markers: (r.trades || []).flatMap((t) => [
      { time: t.entryTime, price: t.entryPrice, side: 'buy' },
      { time: t.exitTime,  price: t.exitPrice,  side: 'sell', pnl: t.pnl, reason: t.exitReason },
    ]),
    bars: bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })),
  });
}));

router.get('/indicators', asyncHandler(async (req, res) => {
  const { symbol, days = 365, timeframe = '1Day' } = req.query;
  if (!symbol) throw new BadRequestError('symbol required');
  const d = Math.max(30, Math.min(3650, Number(days) || 365));
  const bars = await alpaca.getBars(String(symbol).toUpperCase(), timeframe, d);
  const ind = computeAll(bars);
  res.json({
    symbol: String(symbol).toUpperCase(),
    time: bars.map((b) => b.time),
    close: bars.map((b) => b.close),
    sma20: ind.sma20, sma50: ind.sma50, sma200: ind.sma200,
    ema12: ind.ema12, ema26: ind.ema26,
    rsi:   ind.rsi,
    macd:  ind.macd,
    bollinger: ind.bollinger,
    adx:   ind.adx,
  });
}));

export default router;
