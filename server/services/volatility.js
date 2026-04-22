/**
 * Historical volatility and HV-rank computation.
 *
 * Why HV rank instead of IV rank? IV (implied volatility) requires an options
 * feed with bid/ask quotes across strikes, which Alpaca's free tier does not
 * provide. HV rank uses the same idea (where does current vol sit in the past
 * year's distribution?) but against realized returns — a reasonable proxy for
 * mean-reversion / breakout callers.
 *
 * Caller passes a bars[] array (OHLC, chronological).
 */

import { getBars } from './alpaca.js';

/**
 * Annualized realized volatility over the last N bars.
 * Uses log returns + 252-day annualization (US equity convention).
 */
export function historicalVolatility(bars, window = 20) {
  if (!Array.isArray(bars) || bars.length < window + 1) return null;
  const tail = bars.slice(-window - 1);
  const rets = [];
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1].close;
    const curr = tail[i].close;
    if (prev > 0 && curr > 0) rets.push(Math.log(curr / prev));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * HV rank (0..100): where does today's HV sit in the distribution of rolling
 * HV values over a lookback window? 100 = current HV is the highest seen in
 * the window; 0 = lowest.
 */
export function hvRank(bars, { window = 20, lookback = 252 } = {}) {
  if (!Array.isArray(bars) || bars.length < window + 2) return null;
  const series = [];
  for (let i = window; i < bars.length; i++) {
    const slice = bars.slice(i - window, i + 1);
    const v = historicalVolatility(slice, window);
    if (v != null) series.push(v);
  }
  const recent = series.slice(-lookback);
  if (recent.length < 2) return null;
  const current = recent[recent.length - 1];
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  if (max === min) return 50;
  const rank = ((current - min) / (max - min)) * 100;
  return Math.round(rank * 100) / 100;
}

/**
 * Convenience: fetch bars + compute HV and rank in one call. Returns null for
 * symbols with too little history.
 */
export async function getHvRankForSymbol(symbol, { days = 365, window = 20 } = {}) {
  const bars = await getBars(symbol, '1Day', days);
  const hv   = historicalVolatility(bars, window);
  const rank = hvRank(bars, { window, lookback: 252 });
  return {
    symbol,
    bars: bars.length,
    hv:   hv == null ? null : Math.round(hv * 10000) / 10000,
    hvRank: rank,
    interpretation: rank == null ? 'insufficient data'
      : rank >= 80 ? 'very high vol (sell premium / mean revert)'
      : rank >= 50 ? 'elevated vol'
      : rank >= 20 ? 'subdued vol'
      : 'very low vol (buy premium / breakout setup)',
  };
}
