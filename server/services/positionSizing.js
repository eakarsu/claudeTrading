/**
 * Advanced position sizing: Kelly and correlation-aware adjustments.
 *
 * The auto-trader's default sizing is simple: notional cap or risk-per-trade.
 * Kelly sizing uses the user's own win rate and average payoff to compute the
 * theoretical optimal fraction; correlation adjustment reduces size when the
 * candidate symbol moves together with what the trader is already long in.
 *
 * Both helpers are opt-in via the auto-trader config (`useKelly`,
 * `useCorrelationAdjust`). When disabled they're not called at all, so they
 * add zero overhead to the default sizing path.
 */

import { AutoTraderTrade } from '../models/index.js';
import * as alpaca from './alpaca.js';
import { logger } from '../logger.js';

/**
 * Fractional Kelly from the user's historical auto-trader sells.
 * Returns a fraction in [0, kellyFraction]. Null if we don't have enough
 * trade history (< MIN_TRADES) to be confident, or if edge is negative.
 *
 * f* = W - (1 - W) / R   where W = win rate, R = avg_win / |avg_loss|
 */
const MIN_TRADES = 20;

export async function kellyFractionForUser(userId, { kellyFraction = 0.25, minTrades = MIN_TRADES } = {}) {
  const sells = await AutoTraderTrade.findAll({
    where: { userId: userId ?? null, action: 'sell' },
    attributes: ['pnl'],
  }).catch((err) => {
    logger.warn({ err, userId }, 'kellyFractionForUser: query failed');
    return [];
  });
  if (sells.length < minTrades) return null;

  const pnls = sells.map((t) => parseFloat(t.pnl) || 0);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  if (!wins.length || !losses.length) return null;

  const W = wins.length / pnls.length;
  const avgWin = wins.reduce((s, v) => s + v, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length);
  if (avgLoss === 0) return null;

  const R = avgWin / avgLoss;
  const fStar = W - (1 - W) / R;
  if (!Number.isFinite(fStar) || fStar <= 0) return null;

  // Cap the raw Kelly by the safety fraction — full Kelly is too aggressive
  // for real accounts because edge estimates are noisy.
  return Math.min(fStar * kellyFraction, kellyFraction);
}

/**
 * Pearson correlation of two equal-length series. Returns NaN if either
 * series has zero variance (flat prices).
 */
function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n, meanB = sumB / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    num += x * y;
    dA += x * x;
    dB += y * y;
  }
  if (dA === 0 || dB === 0) return NaN;
  return num / Math.sqrt(dA * dB);
}

function pctReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    if (!closes[i - 1]) continue;
    out.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return out;
}

/**
 * Multiplier in (0, 1] that scales position qty down when the candidate
 * symbol is highly correlated with existing positions. Goal: avoid stacking
 * 5 tech names and calling it 5 positions of independent risk.
 *
 *   max |ρ| with any open position     multiplier
 *   < threshold                         1.0 (no change)
 *   threshold .. 0.9                    0.5
 *   >= 0.9                              0.0 (block entirely — caller can skip)
 *
 * Returns 1.0 if there are no open positions, correlation can't be computed,
 * or correlations are below the threshold.
 */
export async function correlationMultiplier(candidateSymbol, openPositions, {
  timeframe = '1Day',
  lookback = 60,
  threshold = 0.7,
} = {}) {
  const otherSymbols = openPositions
    .map((p) => p.symbol)
    .filter((s) => s && s !== candidateSymbol);
  if (!otherSymbols.length) return 1;

  let candidateBars;
  try {
    candidateBars = await alpaca.getBars(candidateSymbol, timeframe, lookback);
  } catch (err) {
    logger.warn({ err, candidateSymbol }, 'correlationMultiplier: candidate bars failed');
    return 1;
  }
  const candidateReturns = pctReturns(candidateBars.map((b) => b.close));
  if (candidateReturns.length < 10) return 1;

  let maxAbs = 0;
  for (const s of otherSymbols) {
    let bars;
    try {
      bars = await alpaca.getBars(s, timeframe, lookback);
    } catch {
      continue;
    }
    const returns = pctReturns(bars.map((b) => b.close));
    const rho = correlation(candidateReturns, returns);
    if (Number.isFinite(rho) && Math.abs(rho) > maxAbs) maxAbs = Math.abs(rho);
  }

  if (maxAbs < threshold) return 1;
  if (maxAbs >= 0.9) return 0;
  return 0.5;
}
