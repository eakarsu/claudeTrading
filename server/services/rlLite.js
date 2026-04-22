/**
 * RL-lite — tabular Q-learning over a discrete market-state vector.
 *
 * This is the "rl-lite" counterpart to freqaiLite: a tiny, pure-JS Q-learning
 * trainer whose policy is legible (dump the table and read it). Freqtrade's
 * ReinforcementLearning module plugs in gym environments with deep agents;
 * we give up function approximation in exchange for something you can reason
 * about in your head.
 *
 * State is a 3-tuple of bucket indices:
 *   rsiBucket (5) × adxBucket (3) × trendBucket (3) → 45 discrete states.
 * Actions: 0 = hold, 1 = enter long, 2 = exit.
 *   When flat, action 2 is a no-op; when in a position, action 1 is a no-op.
 * Reward is the log-return realized on exit (0 otherwise).
 *
 * No function approximation, no eligibility traces — just the textbook
 * Q(s,a) += α(r + γ·max_a' Q(s',a') − Q(s,a)) update.
 */

import { computeAll } from './indicators.js';

// Bucket edges — left-closed, right-open. Last bucket absorbs overshoots.
const RSI_EDGES   = [0, 30, 45, 55, 70, 101];
const ADX_EDGES   = [0, 20, 35, 101];
const TREND_EDGES = [-Infinity, -0.02, 0.02, Infinity];  // (close/sma20 - 1)

export const BUCKETS = {
  rsi: RSI_EDGES, adx: ADX_EDGES, trend: TREND_EDGES,
  nStates: (RSI_EDGES.length - 1) * (ADX_EDGES.length - 1) * (TREND_EDGES.length - 1),
  nActions: 3,
};

function bucketIdx(v, edges) {
  for (let i = 0; i < edges.length - 1; i++) {
    if (v >= edges[i] && v < edges[i + 1]) return i;
  }
  return edges.length - 2;
}

/**
 * Walk bars, emit { idx, state, price, valid } for each bar where the
 * required indicators exist. `state` is a 3-tuple of bucket indices.
 */
export function bucketizeBars(bars) {
  const ind = computeAll(bars);
  const out = [];
  for (let i = 50; i < bars.length; i++) {
    const close = bars[i].close;
    const rsi = ind.rsi?.[i];
    const adx = ind.adx?.[i];
    const sma20 = ind.sma20?.[i];
    if (![rsi, adx, sma20, close].every(Number.isFinite)) continue;
    const trendPct = (close - sma20) / sma20;
    const state = [
      bucketIdx(rsi, RSI_EDGES),
      bucketIdx(adx, ADX_EDGES),
      bucketIdx(trendPct, TREND_EDGES),
    ];
    out.push({ idx: i, time: bars[i].time, price: close, state });
  }
  return out;
}

const keyOf = (s) => JSON.stringify(s);
const qGet = (qt, s) => qt[keyOf(s)] || [0, 0, 0];
const qSet = (qt, s, a, v) => {
  const k = keyOf(s);
  if (!qt[k]) qt[k] = [0, 0, 0];
  qt[k][a] = v;
};

function argmax(arr) {
  let best = 0; let bestV = arr[0];
  for (let i = 1; i < arr.length; i++) if (arr[i] > bestV) { bestV = arr[i]; best = i; }
  return best;
}

/**
 * Train a Q-table on a bar series.
 *
 * Single pass per episode: walk bars in order, maintain a position variable
 * (entryPrice or null), sample an action, apply, update Q on the observed
 * transition. Reward arrives on exit (log return from entry to exit).
 */
export function trainQTable(bars, {
  episodes = 30, alpha = 0.1, gamma = 0.95,
  epsilonStart = 0.3, epsilonEnd = 0.02,
  commission = 0.0005,
} = {}) {
  const series = bucketizeBars(bars);
  if (series.length < 100) throw new Error('Not enough bucketable bars (need ≥100)');

  const qTable = {};
  const log = { episodes: [], totalTrades: 0 };

  for (let ep = 0; ep < episodes; ep++) {
    const epsilon = epsilonStart + (epsilonEnd - epsilonStart) * (ep / Math.max(1, episodes - 1));
    let entry = null;
    let epReturn = 0;
    let epTrades = 0;

    for (let i = 0; i < series.length - 1; i++) {
      const s  = series[i].state;
      const s2 = series[i + 1].state;
      const price = series[i].price;
      const nextPrice = series[i + 1].price;

      // ε-greedy action selection
      let a;
      const q = qGet(qTable, s);
      if (Math.random() < epsilon) a = Math.floor(Math.random() * 3);
      else a = argmax(q);

      // Apply action → compute reward + next position
      let reward = 0;
      if (entry == null) {
        if (a === 1) {          // enter long
          entry = price * (1 + commission);
        } else {                // hold / exit-when-flat → no reward, no pos change
          a = 0;                // normalize no-op into "hold" for the Q update
        }
      } else {
        if (a === 2) {          // exit
          const exitP = price * (1 - commission);
          reward = Math.log(exitP / entry);
          epReturn += reward;
          epTrades += 1;
          entry = null;
        } else {
          // mark-to-market shaping reward — tiny nudge so the agent learns
          // to hold winners through flat bars. Scaled down to avoid swamping
          // the realized-return signal on exit.
          reward = 0.1 * Math.log(nextPrice / price);
          a = entry != null ? 0 : a;  // treat any non-exit as "hold" in-position
        }
      }

      // Q update. Terminal if we've exited and the episode ends next step —
      // otherwise bootstrap from max over s'.
      const qNext = qGet(qTable, s2);
      const target = reward + gamma * Math.max(...qNext);
      const cur = qGet(qTable, s);
      const updated = cur[a] + alpha * (target - cur[a]);
      qSet(qTable, s, a, updated);
    }

    // Force-close any open position at the end of the episode for accounting.
    if (entry != null) {
      const last = series[series.length - 1].price * (1 - commission);
      epReturn += Math.log(last / entry);
      epTrades += 1;
      entry = null;
    }

    log.episodes.push({ episode: ep, epsilon: Number(epsilon.toFixed(3)), return: epReturn, trades: epTrades });
    log.totalTrades += epTrades;
  }

  return { qTable, buckets: BUCKETS, log };
}

/**
 * Greedy evaluation — no exploration, no learning. Walk bars with the trained
 * policy, produce a trade ledger + summary stats.
 */
export function evaluatePolicy(bars, qTable, { commission = 0.0005 } = {}) {
  const series = bucketizeBars(bars);
  let entry = null;
  let entryTime = null;
  const trades = [];
  let equity = 0;

  for (const { state, price, time } of series) {
    const q = qGet(qTable, state);
    const a = argmax(q);
    if (entry == null && a === 1) {
      entry = price * (1 + commission);
      entryTime = time;
    } else if (entry != null && a === 2) {
      const exitP = price * (1 - commission);
      const pnl = Math.log(exitP / entry);
      equity += pnl;
      trades.push({ entryTime, exitTime: time, entry, exit: exitP, pnlLog: pnl, pnlPct: (exitP / entry - 1) * 100 });
      entry = null;
      entryTime = null;
    }
  }
  if (entry != null) {
    // Force-close at last bar for reporting.
    const last = series[series.length - 1];
    const exitP = last.price * (1 - commission);
    const pnl = Math.log(exitP / entry);
    equity += pnl;
    trades.push({ entryTime, exitTime: last.time, entry, exit: exitP, pnlLog: pnl, pnlPct: (exitP / entry - 1) * 100, forced: true });
  }

  const wins = trades.filter((t) => t.pnlLog > 0).length;
  return {
    trades,
    totalTrades: trades.length,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    totalReturnLog: equity,
    totalReturnPct: (Math.exp(equity) - 1) * 100,
    statesVisited: new Set(series.map((s) => keyOf(s.state))).size,
  };
}
