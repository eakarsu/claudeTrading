import { Op } from 'sequelize';
import { AutoTraderTrade } from '../models/index.js';

/**
 * Edge positioning — per-symbol win-rate + expectancy tracked from the user's
 * recent closed trades. Used to size positions proportional to historical
 * edge and to block trades on symbols with negative expectancy.
 *
 * Expectancy (freqtrade formula):
 *   E = (winRate × avgWin) − (lossRate × avgLoss)
 * Interpreted in dollars per trade. Positive E = edge, negative = avoid.
 *
 * Edge ratio (used for sizing): E / avgLoss. Caps at MAX_EDGE_RATIO so a
 * single lucky streak can't blow up position size.
 */

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MIN_TRADES = 5;
const MAX_EDGE_RATIO = 2.0;

/**
 * Compute the edge metrics for one symbol, based on `userId`'s recent closed
 * trades (action='sell' with non-null pnl).
 */
export async function getEdge(userId, symbol, {
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  minTrades = DEFAULT_MIN_TRADES,
} = {}) {
  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  const trades = await AutoTraderTrade.findAll({
    where: {
      userId: userId ?? null,
      symbol,
      action: 'sell',
      pnl: { [Op.ne]: null },
      createdAt: { [Op.gte]: since },
    },
  });

  const n = trades.length;
  if (n < minTrades) {
    return {
      symbol, trades: n, insufficient: true,
      winRate: null, avgWin: null, avgLoss: null,
      expectancy: null, edgeRatio: null, recommendation: 'unknown',
    };
  }

  const wins = trades.filter((t) => Number(t.pnl) > 0);
  const losses = trades.filter((t) => Number(t.pnl) < 0);
  const winRate = wins.length / n;
  const avgWin = wins.length ? wins.reduce((s, t) => s + Number(t.pnl), 0) / wins.length : 0;
  // Use positive magnitude for avg loss so the formula reads naturally.
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + Number(t.pnl), 0) / losses.length) : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
  const edgeRatio = avgLoss > 0
    ? Math.min(MAX_EDGE_RATIO, expectancy / avgLoss)
    : (expectancy > 0 ? MAX_EDGE_RATIO : 0);

  let recommendation;
  if (expectancy <= 0) recommendation = 'avoid';
  else if (edgeRatio >= 1) recommendation = 'strong';
  else if (edgeRatio >= 0.3) recommendation = 'ok';
  else recommendation = 'weak';

  return {
    symbol, trades: n, insufficient: false,
    winRate: round4(winRate),
    avgWin: round2(avgWin),
    avgLoss: round2(avgLoss),
    expectancy: round2(expectancy),
    edgeRatio: round4(edgeRatio),
    recommendation,
  };
}

/**
 * Batch — compute edges for a symbol list. Handy for the UI and for the
 * auto-trader when it wants to rank candidates.
 */
export async function getEdges(userId, symbols, opts = {}) {
  return Promise.all(symbols.map((s) => getEdge(userId, s, opts)));
}

/**
 * Edge-adjusted position multiplier, meant to be applied to a base notional.
 *   - If we have insufficient data, return 1 (fall back to base sizing).
 *   - If expectancy is negative, return 0 (skip the trade).
 *   - Otherwise scale from `floor` to 1 linearly in edgeRatio ∈ [0, 1].
 *     EdgeRatio > 1 is clamped — we don't want edge to grow unbounded.
 */
export function edgeMultiplier(edge, { floor = 0.5 } = {}) {
  if (!edge || edge.insufficient) return 1;
  if (edge.expectancy <= 0) return 0;
  const er = Math.max(0, Math.min(1, edge.edgeRatio));
  return floor + (1 - floor) * er;
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }
