/**
 * Performance analytics. Aggregates realized P&L from TradeJournal +
 * AutoTraderTrade with optional Alpaca portfolio-history overlay for the
 * equity curve. The goal is to give traders the daily numbers most matter
 * without them having to open a backtest:
 *
 *   GET /api/performance/summary
 *     → returns {
 *         period: { mtd, wtd, ytd, allTime },  // realized P&L totals
 *         stats: {
 *           trades, wins, losses, winRate,
 *           avgWin, avgLoss, profitFactor, expectancy,
 *           sharpe, sortino, maxDrawdown, maxDrawdownPct,
 *           bestTrade, worstTrade,
 *         },
 *         perSymbol: [{ symbol, trades, pnl, winRate }, ...],
 *         equityCurve: [{ time, equity }, ...],   // from Alpaca if available
 *       }
 *
 * Metrics are computed from closed journal + auto-trader trades. Cash flows
 * from Alpaca (dividends etc.) aren't included — realized P&L is strictly
 * entry/exit P&L on trades the user logged or the bot booked.
 */

import { Router } from 'express';
import { Op } from 'sequelize';
import { asyncHandler } from '../middleware/async.js';
import { TradeJournal, AutoTraderTrade } from '../models/index.js';
import * as alpaca from '../services/alpaca.js';
import { logger } from '../logger.js';

const router = Router();

// ─── Aggregate helpers ────────────────────────────────────────────────────

function toDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isFinite(d.getTime()) ? d : null;
}

function startOf(kind, now = new Date()) {
  const d = new Date(now);
  if (kind === 'week') {
    const dow = d.getUTCDay(); // 0 = Sun
    d.setUTCDate(d.getUTCDate() - dow);
    d.setUTCHours(0, 0, 0, 0);
  } else if (kind === 'month') {
    d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  } else if (kind === 'year') {
    d.setUTCMonth(0, 1); d.setUTCHours(0, 0, 0, 0);
  }
  return d;
}

// Collects raw closed trades from both tables. TradeJournal is the user's own
// log (entry + exit with pnl). AutoTraderTrade is bot fills — we only count
// rows that carry an explicit realized pnl (exit legs), never the entries.
async function collectClosedTrades(userId) {
  const [journal, auto] = await Promise.all([
    TradeJournal.findAll({
      where: { userId, pnl: { [Op.ne]: null } },
      order: [['tradeDate', 'ASC']],
    }).catch(() => []),
    AutoTraderTrade.findAll({
      where: { userId, pnl: { [Op.ne]: null, [Op.ne]: 0 } },
      order: [['createdAt', 'ASC']],
    }).catch(() => []),
  ]);
  const rows = [];
  for (const t of journal) {
    rows.push({
      source: 'journal',
      symbol: t.symbol,
      pnl: Number(t.pnl) || 0,
      when: toDate(t.tradeDate) || t.createdAt || new Date(),
    });
  }
  for (const t of auto) {
    rows.push({
      source: 'auto',
      symbol: t.symbol,
      pnl: Number(t.pnl) || 0,
      when: t.createdAt || new Date(),
    });
  }
  rows.sort((a, b) => a.when - b.when);
  return rows;
}

// ─── Statistics ───────────────────────────────────────────────────────────
// Sharpe/Sortino computed from per-trade returns assuming risk-free=0. We
// don't have per-trade capital basis so "return" here is just pnl — useful
// for relative comparison, not a true IRR.
function computeStats(trades) {
  const n = trades.length;
  if (!n) return null;
  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const sum = pnls.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const variance = pnls.reduce((acc, p) => acc + (p - avg) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  // Sortino: only downside deviation.
  const downside = pnls.filter((p) => p < avg).map((p) => (p - avg) ** 2);
  const downStd = downside.length ? Math.sqrt(downside.reduce((a, b) => a + b, 0) / downside.length) : 0;

  // Max drawdown on the cumulative P&L curve.
  let peak = 0, curve = 0, maxDD = 0, maxDDpct = 0;
  for (const p of pnls) {
    curve += p;
    if (curve > peak) peak = curve;
    const dd = peak - curve;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDpct = peak > 0 ? (dd / peak) * 100 : 0;
    }
  }

  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const profitFactor = losses.length
    ? Math.abs(wins.reduce((a, b) => a + b, 0) / losses.reduce((a, b) => a + b, 0))
    : null; // undefined when no losses
  const expectancy = avg;

  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / n) * 100,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    sharpe: stdev > 0 ? avg / stdev : null,
    sortino: downStd > 0 ? avg / downStd : null,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDpct,
    bestTrade: Math.max(...pnls),
    worstTrade: Math.min(...pnls),
  };
}

function perSymbol(trades) {
  const by = new Map();
  for (const t of trades) {
    const row = by.get(t.symbol) || { symbol: t.symbol, trades: 0, pnl: 0, wins: 0 };
    row.trades += 1;
    row.pnl += t.pnl;
    if (t.pnl > 0) row.wins += 1;
    by.set(t.symbol, row);
  }
  return [...by.values()]
    .map((r) => ({ ...r, winRate: r.trades ? (r.wins / r.trades) * 100 : 0 }))
    .sort((a, b) => b.pnl - a.pnl);
}

// ─── Route ────────────────────────────────────────────────────────────────

router.get('/summary', asyncHandler(async (req, res) => {
  const trades = await collectClosedTrades(req.userId);

  const now = new Date();
  const wtdStart = startOf('week',  now);
  const mtdStart = startOf('month', now);
  const ytdStart = startOf('year',  now);

  const sumSince = (start) =>
    trades.filter((t) => t.when >= start).reduce((a, b) => a + b.pnl, 0);

  const period = {
    wtd: sumSince(wtdStart),
    mtd: sumSince(mtdStart),
    ytd: sumSince(ytdStart),
    allTime: trades.reduce((a, b) => a + b.pnl, 0),
  };

  // Alpaca portfolio-history gives us a real equity curve (account value
  // including unrealized P&L and cash). It's optional — many users won't
  // have Alpaca configured and we shouldn't fail the whole endpoint.
  let equityCurve = [];
  try {
    const hist = await alpaca.getPortfolioHistory('3M', '1D');
    if (hist?.timestamp?.length && hist?.equity?.length) {
      equityCurve = hist.timestamp.map((t, i) => ({
        time: new Date(t * 1000).toISOString().slice(0, 10),
        equity: Number(hist.equity[i]),
      })).filter((r) => Number.isFinite(r.equity));
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'performance: portfolio history unavailable');
  }

  res.json({
    period,
    stats: computeStats(trades),
    perSymbol: perSymbol(trades).slice(0, 25),
    equityCurve,
    trades: trades.length,
  });
}));

export default router;
