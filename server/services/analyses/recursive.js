import { runStrategy } from '../strategyEngine.js';

/**
 * Recursive formula analysis — measures how stable the latest bar's signal /
 * indicators are as the amount of preceding history grows.
 *
 * Motivation: many indicators (EMA, RSI, ADX…) converge asymptotically. In
 * live trading you might only have the last 500 bars, whereas a backtest ran
 * on 5,000. If the "signal at the last bar" changes meaningfully depending on
 * how much history preceded it, live trading will diverge from the backtest.
 *
 * How it works: pick the last bar and re-run the strategy with progressively
 * larger tails of history leading up to it — startupCandles, startupCandles+stride,
 * … up to all available bars. Record the signal (if any) at the last bar for
 * each window. If the signal flips between windows, the strategy has
 * insufficient startup candles.
 *
 * Based on freqtrade's recursive_analysis concept.
 */

export function recursiveAnalysis(strategyKey, bars, { startupCandles = 50, stride = 50, maxWindows = 12 } = {}) {
  if (!Array.isArray(bars) || bars.length < startupCandles + stride) {
    throw new Error(`Need at least ${startupCandles + stride} bars; got ${bars?.length || 0}`);
  }

  const finalIndex = bars.length - 1;
  const finalTime = bars[finalIndex].time;

  // Build a list of tail lengths to test: startupCandles, +stride, +2*stride, …
  // up to min(bars.length, startupCandles + maxWindows*stride).
  const lengths = [];
  for (let len = startupCandles; len <= bars.length && lengths.length < maxWindows; len += stride) {
    lengths.push(len);
  }
  if (lengths[lengths.length - 1] !== bars.length) lengths.push(bars.length);

  const windows = lengths.map((len) => {
    const tail = bars.slice(bars.length - len);
    const signals = runStrategy(strategyKey, tail);
    // Look for a signal at the final bar (by timestamp, to avoid off-by-one
    // when strategies drop bars for warmup).
    const lastSig = signals.find((s) => s.time === finalTime) || null;
    return {
      barsUsed: len,
      signalAtLastBar: lastSig ? lastSig.action : 'none',
      // Some strategies annotate signals with scalar metrics (rsi, adx, ema).
      // Surface a few numeric fields when present for the caller to chart.
      metrics: lastSig ? pickNumeric(lastSig) : null,
    };
  });

  // Flag bar: how many distinct actions did we observe across windows? Anything
  // >1 means the last-bar signal is unstable under different lookback depths.
  const distinctActions = new Set(windows.map((w) => w.signalAtLastBar));
  const stable = distinctActions.size === 1;

  // For each numeric metric, compute the final vs second-to-last window drift
  // so callers can get a quick "is my EMA converged?" number.
  const lastTwo = windows.slice(-2);
  const drifts = {};
  if (lastTwo.length === 2 && lastTwo[0].metrics && lastTwo[1].metrics) {
    for (const k of Object.keys(lastTwo[1].metrics)) {
      const a = lastTwo[0].metrics[k];
      const b = lastTwo[1].metrics[k];
      if (typeof a === 'number' && typeof b === 'number' && a !== 0) {
        drifts[k] = round6((b - a) / Math.abs(a));
      }
    }
  }

  return {
    strategyKey,
    barsAnalyzed: bars.length,
    startupCandles,
    stride,
    stable,
    distinctActions: Array.from(distinctActions),
    windows,
    // Drift is expressed as relative change in the most recent step (stride
    // more bars of history). Small values (< 0.01) indicate convergence.
    lastStepDrift: drifts,
  };
}

function pickNumeric(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function round6(n) { return Math.round(n * 1e6) / 1e6; }
