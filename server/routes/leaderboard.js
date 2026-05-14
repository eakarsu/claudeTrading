/**
 * Strategy performance leaderboard.
 *
 *   GET /api/leaderboard/strategies
 *
 * Aggregates from AutoTraderTrade grouped by strategy. Only includes users
 * who have share_performance = true (opt-in). Returns strategies sorted by
 * win rate descending.
 *
 * Response shape:
 *   {
 *     leaderboard: [
 *       {
 *         strategy:        string,
 *         totalTrades:     number,
 *         wins:            number,
 *         losses:          number,
 *         winRate:         number,   // 0-100
 *         totalPnl:        number,
 *         avgPnl:          number,
 *         avgDurationMs:   number | null,
 *         sharpe:          number | null,
 *       },
 *       ...
 *     ],
 *     asOf: string   // ISO timestamp
 *   }
 */

import { Router } from 'express';
import { Op } from 'sequelize';
import { asyncHandler } from '../middleware/async.js';
import { AutoTraderTrade, User } from '../models/index.js';

const router = Router();

/**
 * Compute Sharpe ratio approximation from an array of P&L values.
 * Uses avg(pnl) / std(pnl) scaled by sqrt(252) to annualise on a
 * per-trade basis (assumes ~252 trades/year — a rough but standard proxy).
 */
function sharpeApprox(pnls) {
  const n = pnls.length;
  if (n < 2) return null;
  const avg = pnls.reduce((a, b) => a + b, 0) / n;
  const variance = pnls.reduce((a, p) => a + (p - avg) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  // Annualise: treat each trade as ~1 trading day equivalent
  return Math.round((avg / std) * Math.sqrt(252) * 100) / 100;
}

/**
 * Parse a duration in milliseconds from two ISO strings (entryTime, exitTime).
 * Returns null if either value is missing or invalid.
 */
function durationMs(entryTimeStr, exitTimeStr) {
  if (!entryTimeStr || !exitTimeStr) return null;
  const entry = new Date(entryTimeStr);
  const exit = new Date(exitTimeStr);
  if (!Number.isFinite(entry.getTime()) || !Number.isFinite(exit.getTime())) return null;
  const ms = exit.getTime() - entry.getTime();
  return ms >= 0 ? ms : null;
}

router.get('/strategies', asyncHandler(async (req, res) => {
  // Resolve the set of opt-in user IDs.
  // The User model has a share_performance column — users must explicitly opt
  // in before their strategy data appears in the leaderboard.
  // Fall back gracefully if the column doesn't exist yet (returns empty set).
  let optInUserIds;
  try {
    const optInUsers = await User.findAll({
      where: { share_performance: true },
      attributes: ['id'],
    });
    optInUserIds = optInUsers.map((u) => u.id);
  } catch {
    // Column not yet added — leaderboard is empty until migration runs.
    optInUserIds = [];
  }

  if (!optInUserIds.length) {
    return res.json({ leaderboard: [], asOf: new Date().toISOString() });
  }

  // Fetch all closed trades (non-null pnl) for opt-in users that have a
  // strategy name set. Rows without a strategy are excluded.
  const trades = await AutoTraderTrade.findAll({
    where: {
      userId: { [Op.in]: optInUserIds },
      pnl: { [Op.ne]: null },
      strategy: { [Op.ne]: null, [Op.ne]: '' },
    },
    attributes: ['strategy', 'pnl', 'createdAt'],
    order: [['createdAt', 'ASC']],
  });

  // Group by strategy
  const byStrategy = new Map();
  for (const t of trades) {
    const key = t.strategy;
    if (!byStrategy.has(key)) byStrategy.set(key, []);
    byStrategy.get(key).push({
      pnl: Number(t.pnl) || 0,
      createdAt: t.createdAt,
    });
  }

  const leaderboard = [];
  for (const [strategy, rows] of byStrategy) {
    const pnls = rows.map((r) => r.pnl);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p <= 0);
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const winRate = rows.length ? (wins.length / rows.length) * 100 : 0;
    const avgPnl = rows.length ? totalPnl / rows.length : 0;

    // Average duration: time between successive trades in the same strategy
    // is used as a proxy for hold time (we don't have separate entry/exit rows
    // in AutoTraderTrade, only the closed-leg timestamp).
    let avgDurationMs = null;
    if (rows.length >= 2) {
      const timestamps = rows.map((r) => new Date(r.createdAt).getTime()).filter(Number.isFinite);
      if (timestamps.length >= 2) {
        const gaps = [];
        for (let i = 1; i < timestamps.length; i++) {
          const g = timestamps[i] - timestamps[i - 1];
          if (g >= 0) gaps.push(g);
        }
        if (gaps.length) avgDurationMs = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      }
    }

    leaderboard.push({
      strategy,
      totalTrades: rows.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Math.round(winRate * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgPnl: Math.round(avgPnl * 100) / 100,
      avgDurationMs,
      sharpe: sharpeApprox(pnls),
    });
  }

  // Sort by win rate descending; break ties by total P&L
  leaderboard.sort((a, b) => b.winRate - a.winRate || b.totalPnl - a.totalPnl);

  res.json({ leaderboard, asOf: new Date().toISOString() });
}));

export default router;
