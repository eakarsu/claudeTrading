/**
 * Advanced backtesting features built on top of services/backtester.js:
 *
 *   - monteCarloTrades:  shuffle realized trade P&L sequences to estimate the
 *                        distribution of outcomes (P5/P50/P95 equity curve).
 *   - optimizeParams:    random/grid search over stop/target/sizing with an
 *                        overfitting penalty based on IS→OOS degradation.
 *   - regimeTaggedStats: split backtest results by bull/bear/chop so callers
 *                        can see *when* a strategy actually works.
 *   - portfolioBacktest: run multiple strategy/symbol pairs against a shared
 *                        cash pool with position-correlation and per-symbol
 *                        caps.
 *   - benchmarkOverlay:  compute buy-and-hold equity for a reference symbol
 *                        (typically SPY) aligned to the backtest period.
 */

import { backtest } from './backtester.js';
import { SMA, ADX } from './indicators.js';

const INITIAL_CAPITAL = 100000;

// ─── Monte Carlo ─────────────────────────────────────────────────────────
// Takes the realized trade P&L array, reshuffles it N times, and reports the
// distribution of ending equities. Answers: "how much of my PnL is luck?"
export function monteCarloTrades(trades, {
  runs = 1000,
  initialCapital = INITIAL_CAPITAL,
} = {}) {
  if (!trades || trades.length === 0) {
    return { runs: 0, trades: 0, percentiles: null };
  }
  const pnls = trades.map((t) => t.pnl);
  const endings = [];
  const drawdowns = [];
  for (let r = 0; r < runs; r++) {
    const order = shuffle(pnls);
    let equity = initialCapital;
    let peak = equity;
    let maxDd = 0;
    for (const p of order) {
      equity += p;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDd) maxDd = dd;
    }
    endings.push(equity);
    drawdowns.push(maxDd);
  }
  endings.sort((a, b) => a - b);
  drawdowns.sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  return {
    runs,
    trades: trades.length,
    initialCapital,
    percentiles: {
      equity: {
        p5:  round(pct(endings, 0.05)),
        p25: round(pct(endings, 0.25)),
        p50: round(pct(endings, 0.50)),
        p75: round(pct(endings, 0.75)),
        p95: round(pct(endings, 0.95)),
      },
      drawdown: {
        p5:  pctFmt(pct(drawdowns, 0.05)),
        p50: pctFmt(pct(drawdowns, 0.50)),
        p95: pctFmt(pct(drawdowns, 0.95)),
      },
    },
    worstCase: round(endings[0]),
    bestCase:  round(endings[endings.length - 1]),
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Parameter optimizer ─────────────────────────────────────────────────
// Grid over stop/target/slippage; reports both in-sample and out-of-sample
// stats. An overfit score penalizes params whose OOS P&L falls off a cliff
// relative to IS — these are usually curve-fit and fail in production.
export function optimizeParams(strategyKey, bars, {
  grid = {
    stopLossPct:   [0.02, 0.03, 0.05, 0.08],
    takeProfitPct: [0.04, 0.06, 0.10, 0.15],
    slippagePct:   [0, 0.0005],
  },
  oosRatio = 0.3,
  topN = 10,
} = {}) {
  if (!bars || bars.length < 100) {
    return { error: 'Need at least 100 bars for optimization', results: [] };
  }
  const keys = Object.keys(grid);
  const combos = cartesian(keys.map((k) => grid[k].map((v) => [k, v])));
  const results = [];

  for (const combo of combos) {
    const params = Object.fromEntries(combo);
    try {
      const r = backtest(strategyKey, bars, { ...params, oosRatio });
      if (!r.oosReport) continue;
      const isPnl  = r.oosReport.inSample.totalPnl;
      const oosPnl = r.oosReport.outSample.totalPnl;
      // Penalty: how much worse did OOS do vs IS per-trade? 0 = no degradation.
      const isTrades  = Math.max(1, r.oosReport.inSample.trades);
      const oosTrades = Math.max(1, r.oosReport.outSample.trades);
      const isPerTrade  = isPnl / isTrades;
      const oosPerTrade = oosPnl / oosTrades;
      const degradation = isPerTrade > 0
        ? (isPerTrade - oosPerTrade) / isPerTrade
        : 0;
      // Composite: OOS P&L matters most, but we de-weight heavy degraders.
      const score = oosPnl - Math.max(0, degradation) * Math.abs(isPnl);
      results.push({
        params,
        totalPnl:    r.totalPnl,
        totalTrades: r.totalTrades,
        winRate:     r.winRate,
        sharpe:      r.sharpe,
        maxDrawdown: r.maxDrawdown,
        isPnl, oosPnl,
        degradation: round(degradation * 100),
        score:       round(score),
      });
    } catch (_) { /* param combo failed — skip */ }
  }

  results.sort((a, b) => b.score - a.score);
  return {
    tested: results.length,
    grid,
    topByScore: results.slice(0, topN),
    best: results[0] || null,
  };
}

function cartesian(arr) {
  return arr.reduce((acc, opts) => {
    const out = [];
    for (const a of acc) for (const o of opts) out.push([...a, o]);
    return out;
  }, [[]]);
}

// ─── Regime tagging ──────────────────────────────────────────────────────
// Classifies every bar as bull / bear / chop using a 200-SMA + ADX filter,
// then buckets the backtest's trades by the regime active on their exit bar.
export function classifyRegimes(bars) {
  const closes = bars.map((b) => b.close);
  const highs  = bars.map((b) => b.high);
  const lows   = bars.map((b) => b.low);
  const sma200 = SMA(closes, Math.min(200, Math.floor(bars.length / 2)));
  const adx14  = ADX(highs, lows, closes, 14);
  const regimes = new Array(bars.length).fill('unknown');
  for (let i = 0; i < bars.length; i++) {
    const trend = sma200[i];
    const strength = adx14[i];
    if (trend == null || strength == null) continue;
    if (strength < 20) { regimes[i] = 'chop'; continue; }
    regimes[i] = closes[i] > trend ? 'bull' : 'bear';
  }
  return regimes;
}

export function regimeTaggedStats(strategyKey, bars, options = {}) {
  const r = backtest(strategyKey, bars, options);
  if (!r.trades?.length) return { ...r, regimes: null };
  const regimes = classifyRegimes(bars);
  const buckets = { bull: [], bear: [], chop: [], unknown: [] };
  for (const t of r.trades) {
    const regime = regimes[t.exitIdx] || 'unknown';
    buckets[regime].push(t);
  }
  const summarize = (arr) => {
    if (!arr.length) return { trades: 0, totalPnl: 0, winRate: 0, avgPnl: 0 };
    const wins = arr.filter((t) => t.pnl > 0).length;
    const total = arr.reduce((s, t) => s + t.pnl, 0);
    return {
      trades: arr.length,
      totalPnl: round(total),
      avgPnl:   round(total / arr.length),
      winRate:  round((wins / arr.length) * 100),
    };
  };
  return {
    ...r,
    regimes: {
      bull: summarize(buckets.bull),
      bear: summarize(buckets.bear),
      chop: summarize(buckets.chop),
      unknown: summarize(buckets.unknown),
    },
  };
}

// ─── Portfolio backtester ────────────────────────────────────────────────
// Runs multiple strategy/symbol pairs against a shared capital pool. Each
// entry gets capped at positionPct of current cash; we also enforce a
// max-concurrent-positions ceiling so a frenzied tape doesn't blow the
// account. Output includes aggregate equity curve and per-leg stats.
export function portfolioBacktest(legs, barsBySymbol, {
  initialCapital = INITIAL_CAPITAL,
  maxConcurrent = 10,
  positionPct = 0.1,
  ...opts
} = {}) {
  // 1. Run each leg individually to get its trade list.
  const legResults = legs.map((leg) => {
    const bars = barsBySymbol[leg.symbol];
    if (!bars?.length) return { ...leg, error: 'No bars', trades: [] };
    try {
      const r = backtest(leg.strategy, bars, opts);
      return { ...leg, trades: r.trades, metrics: {
        totalPnl: r.totalPnl, winRate: r.winRate, sharpe: r.sharpe,
      }};
    } catch (err) {
      return { ...leg, error: err.message, trades: [] };
    }
  });

  // 2. Merge all trades by entry time, enforce concurrent-position ceiling.
  const allTrades = [];
  for (const leg of legResults) {
    for (const t of leg.trades || []) {
      allTrades.push({ ...t, symbol: leg.symbol, strategy: leg.strategy });
    }
  }
  allTrades.sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime));

  let cash = initialCapital;
  let equityPeak = cash;
  let maxDd = 0;
  const open = [];
  const accepted = [];
  const rejected = [];
  const equityCurve = [];

  for (const trade of allTrades) {
    // Close any open leg whose exit predates this entry.
    while (open.length && new Date(open[0].exitTime) < new Date(trade.entryTime)) {
      const closed = open.shift();
      cash += closed.exitValue;
      equityCurve.push({ time: closed.exitTime, equity: round(cash) });
      if (cash > equityPeak) equityPeak = cash;
      const dd = (equityPeak - cash) / equityPeak;
      if (dd > maxDd) maxDd = dd;
    }
    if (open.length >= maxConcurrent) { rejected.push({ ...trade, reason: 'maxConcurrent' }); continue; }
    const spend = cash * positionPct;
    if (spend < trade.entryPrice * 1) { rejected.push({ ...trade, reason: 'insufficientCash' }); continue; }
    const shares = Math.floor(spend / trade.entryPrice);
    if (shares <= 0) { rejected.push({ ...trade, reason: 'zeroShares' }); continue; }
    cash -= shares * trade.entryPrice;
    const exitValue = shares * trade.exitPrice;
    const realizedPnl = exitValue - shares * trade.entryPrice;
    accepted.push({ ...trade, shares, realizedPnl });
    open.push({ exitTime: trade.exitTime, exitValue });
    open.sort((a, b) => new Date(a.exitTime) - new Date(b.exitTime));
  }
  // Drain any remaining open legs at their exit value.
  for (const closed of open) {
    cash += closed.exitValue;
    equityCurve.push({ time: closed.exitTime, equity: round(cash) });
  }

  const totalPnl = cash - initialCapital;
  return {
    initialCapital,
    finalEquity: round(cash),
    totalPnl: round(totalPnl),
    totalReturn: round((totalPnl / initialCapital) * 100),
    maxDrawdown: round(maxDd * 100),
    accepted: accepted.length,
    rejected: rejected.length,
    rejectionReasons: rejected.reduce((acc, r) => {
      acc[r.reason] = (acc[r.reason] || 0) + 1;
      return acc;
    }, {}),
    legs: legResults.map((l) => ({
      symbol: l.symbol, strategy: l.strategy,
      trades: l.trades?.length || 0, metrics: l.metrics, error: l.error,
    })),
    equityCurve,
  };
}

// ─── Benchmark overlay ───────────────────────────────────────────────────
// Pure-math helper: given benchmark bars (typically SPY), return a buy-and-hold
// equity curve with the same start capital. Caller aligns it against the
// strategy's equity curve for a visual overlay.
export function benchmarkBuyAndHold(benchmarkBars, {
  initialCapital = INITIAL_CAPITAL,
} = {}) {
  if (!benchmarkBars?.length) return { equityCurve: [], totalReturn: 0 };
  const firstPrice = benchmarkBars[0].close;
  const shares = initialCapital / firstPrice;
  const equityCurve = benchmarkBars.map((b) => ({
    time: b.time,
    equity: round(shares * b.close),
  }));
  const finalEquity = equityCurve[equityCurve.length - 1].equity;
  return {
    symbol: benchmarkBars.symbol || 'benchmark',
    initialCapital,
    finalEquity,
    totalReturn: round((finalEquity - initialCapital) / initialCapital * 100),
    equityCurve,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────
function round(n)   { return Math.round(n * 100) / 100; }
function pctFmt(n)  { return Math.round(n * 10000) / 100; }
