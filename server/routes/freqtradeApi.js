import { Router } from 'express';
import { Op } from 'sequelize';
import { asyncHandler } from '../middleware/async.js';
import * as alpaca from '../services/alpaca.js';
import {
  AutoTraderState, AutoTraderTrade,
} from '../models/index.js';
import { startAutoTrader, stopAutoTrader } from '../services/autoTrader.js';
import { BadRequestError } from '../errors.js';

/**
 * Freqtrade-style REST API v1 — namespace under /api/v1 that mirrors
 * freqtrade's REST surface for users who want to reuse existing freqtrade
 * tooling. Endpoints return payloads shaped to match freqtrade's schema
 * where practical, translating from our own AutoTrader models.
 *
 * This is a *compat shim* over the existing services, not a rewrite. Some
 * freqtrade-specific concepts (pair notation, locks) are approximated or
 * omitted.
 */

const router = Router();

// ─── /status, /show_config, /ping ───
router.get('/ping', (req, res) => res.json({ status: 'pong' }));

router.get('/show_config', asyncHandler(async (req, res) => {
  const state = await AutoTraderState.findOne({ where: { userId: req.userId } });
  res.json({
    dry_run: !!state?.config?.dryRun,
    trading_mode: state?.config?.dryRun ? 'dry_run' : 'live',
    state: state?.running ? 'running' : 'stopped',
    strategy: state?.activeStrategy || null,
    stake_currency: 'USD',
    max_open_trades: state?.config?.maxOpenPositions ?? null,
    timeframe: state?.config?.timeframe || '1Day',
    runmode: state?.config?.dryRun ? 'dry_run' : 'live',
  });
}));

router.get('/status', asyncHandler(async (req, res) => {
  // Freqtrade /status returns open trades. We map to open Alpaca positions.
  try {
    const positions = await alpaca.getPositions();
    res.json(positions.map((p) => ({
      pair: p.symbol,
      base_currency: p.symbol,
      quote_currency: 'USD',
      is_open: true,
      amount: Number(p.qty),
      open_rate: Number(p.avg_entry_price),
      current_rate: Number(p.current_price),
      profit_abs: Number(p.unrealized_pl),
      profit_pct: Number(p.unrealized_plpc) * 100,
    })));
  } catch (e) {
    res.json([]);
  }
}));

router.get('/balance', asyncHandler(async (req, res) => {
  const a = await alpaca.getAccount();
  const total = Number(a.equity);
  res.json({
    currencies: [{
      currency: 'USD',
      free: Number(a.cash),
      used: total - Number(a.cash),
      balance: total,
      est_stake: total,
    }],
    total,
    symbol: 'USD',
  });
}));

// ─── /trades, /trade/:id ───
router.get('/trades', asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  const rows = await AutoTraderTrade.findAll({
    where: { userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit,
  });
  res.json({
    trades: rows.map(toFreqtradeTrade),
    trades_count: rows.length,
    total_trades: await AutoTraderTrade.count({ where: { userId: req.userId } }),
  });
}));

router.get('/trade/:id', asyncHandler(async (req, res) => {
  const row = await AutoTraderTrade.findOne({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(toFreqtradeTrade(row));
}));

// ─── /profit, /performance, /stats, /count, /daily, /weekly, /monthly ───
router.get('/profit', asyncHandler(async (req, res) => {
  const closed = await AutoTraderTrade.findAll({
    where: { userId: req.userId, action: 'sell', pnl: { [Op.ne]: null } },
  });
  const wins = closed.filter((t) => Number(t.pnl) > 0);
  const losses = closed.filter((t) => Number(t.pnl) < 0);
  const total = closed.reduce((s, t) => s + Number(t.pnl), 0);
  const best = closed.reduce((b, t) => (Number(t.pnl) > Number(b?.pnl ?? -Infinity) ? t : b), null);
  const worst = closed.reduce((b, t) => (Number(t.pnl) < Number(b?.pnl ?? Infinity) ? t : b), null);
  res.json({
    profit_closed_coin: total,
    profit_closed_percent: null,
    profit_all_coin: total,
    profit_all_percent: null,
    trade_count: closed.length,
    closed_trade_count: closed.length,
    winning_trades: wins.length,
    losing_trades: losses.length,
    best_pair: best ? best.symbol : null,
    best_rate: best ? Number(best.pnl) : 0,
    worst_pair: worst ? worst.symbol : null,
    worst_rate: worst ? Number(worst.pnl) : 0,
  });
}));

router.get('/performance', asyncHandler(async (req, res) => {
  const rows = await AutoTraderTrade.findAll({
    where: { userId: req.userId, action: 'sell', pnl: { [Op.ne]: null } },
  });
  const bySym = {};
  for (const r of rows) {
    const p = (bySym[r.symbol] ||= { pair: r.symbol, profit_abs: 0, count: 0 });
    p.profit_abs += Number(r.pnl) || 0;
    p.count += 1;
  }
  res.json(Object.values(bySym).sort((a, b) => b.profit_abs - a.profit_abs));
}));

router.get('/count', asyncHandler(async (req, res) => {
  const positions = await alpaca.getPositions().catch(() => []);
  const state = await AutoTraderState.findOne({ where: { userId: req.userId } });
  res.json({
    current: positions.length,
    max: state?.config?.maxOpenPositions ?? null,
    total_stake: positions.reduce((s, p) => s + Number(p.qty) * Number(p.avg_entry_price), 0),
  });
}));

async function bucketedProfit(userId, days, bucketDays) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await AutoTraderTrade.findAll({
    where: { userId, action: 'sell', pnl: { [Op.ne]: null }, createdAt: { [Op.gte]: since } },
  });
  const buckets = new Map();
  for (const r of rows) {
    const d = new Date(r.createdAt);
    // Align to bucket start — for day=1 we just use the date; for weeks we use Monday-of.
    const epoch = Math.floor(d.getTime() / (86_400_000 * bucketDays));
    const key = new Date(epoch * 86_400_000 * bucketDays).toISOString().slice(0, 10);
    const b = buckets.get(key) || { date: key, abs_profit: 0, trade_count: 0 };
    b.abs_profit += Number(r.pnl);
    b.trade_count += 1;
    buckets.set(key, b);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

router.get('/daily',   asyncHandler(async (req, res) => res.json({ data: await bucketedProfit(req.userId, 30, 1) })));
router.get('/weekly',  asyncHandler(async (req, res) => res.json({ data: await bucketedProfit(req.userId, 180, 7) })));
router.get('/monthly', asyncHandler(async (req, res) => res.json({ data: await bucketedProfit(req.userId, 365, 30) })));

router.get('/stats', asyncHandler(async (req, res) => {
  const all = await AutoTraderTrade.findAll({ where: { userId: req.userId, action: 'sell', pnl: { [Op.ne]: null } } });
  const wins = all.filter((t) => Number(t.pnl) > 0);
  const losses = all.filter((t) => Number(t.pnl) < 0);
  const durations = []; // we don't persist entry time per row; skip
  res.json({
    durations: { wins: durations, losses: durations, draws: [] },
    exit_reasons: summarizeReasons(all),
  });
}));

function summarizeReasons(rows) {
  const out = {};
  for (const r of rows) {
    const reason = r.reason || 'unknown';
    out[reason] = (out[reason] || 0) + 1;
  }
  return out;
}

// ─── /forcebuy, /forcesell ───
router.post('/forcebuy', asyncHandler(async (req, res) => {
  const { pair, price } = req.body || {};
  if (!pair) throw new BadRequestError('pair required');
  // Freqtrade-compat: just place a market buy for 1 share (size defaults would
  // come from the user's strategy config in a real implementation).
  const order = await alpaca.placeOrder({
    symbol: pair.toUpperCase(), qty: 1, side: 'buy', type: 'market', time_in_force: 'day',
  });
  res.json({ status: 'ok', order_id: order.id });
}));

router.post('/forcesell', asyncHandler(async (req, res) => {
  const { tradeid: pair } = req.body || {};
  if (!pair) throw new BadRequestError('tradeid (pair) required');
  await alpaca.closePosition(pair.toUpperCase());
  res.json({ status: 'ok' });
}));

// ─── /start, /stop ───
router.post('/start', asyncHandler(async (req, res) => {
  const state = await AutoTraderState.findOne({ where: { userId: req.userId } });
  if (!state) throw new BadRequestError('configure auto-trader first');
  await startAutoTrader(req.userId, state.config || {});
  res.json({ status: 'starting' });
}));

router.post('/stop', asyncHandler(async (req, res) => {
  await stopAutoTrader(req.userId);
  res.json({ status: 'stopping' });
}));

// ─── /logs ───
router.get('/logs', asyncHandler(async (req, res) => {
  // Freqtrade /logs returns recent log lines. We don't persist server-side
  // logs; return the last N AuditLog rows for the user as an approximation.
  const { AuditLog } = await import('../models/index.js');
  const rows = await AuditLog.findAll({
    where: { userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit: Math.max(1, Math.min(500, Number(req.query.limit) || 200)),
  });
  res.json({
    log_count: rows.length,
    logs: rows.map((r) => [
      r.createdAt.toISOString(),
      new Date(r.createdAt).getTime() / 1000,
      r.action || 'audit',
      'INFO',
      JSON.stringify(r.meta || {}),
    ]),
  });
}));

// ─── Shared helper ───
function toFreqtradeTrade(t) {
  return {
    trade_id: t.id,
    pair: t.symbol,
    is_open: t.action === 'buy',
    amount: Number(t.qty) || 0,
    open_rate: t.action === 'buy' ? Number(t.price) : null,
    close_rate: t.action === 'sell' ? Number(t.price) : null,
    profit_abs: Number(t.pnl) || 0,
    open_date: t.createdAt,
    close_date: t.action === 'sell' ? t.createdAt : null,
    strategy: t.strategy,
    exit_reason: t.action === 'sell' ? t.reason : null,
  };
}

export default router;
