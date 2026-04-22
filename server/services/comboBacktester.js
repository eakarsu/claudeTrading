/**
 * Combo Backtester — tests combinations of 1, 2, or 3 strategies together.
 * Requires multiple signals to agree (confluence) within a time window before trading.
 * Finds the best single, pair, and triple strategy combinations.
 */

import { computeAll } from './indicators.js';
import { STRATEGIES } from './strategyEngine.js';

const INITIAL_CAPITAL = 100000;
const POSITION_PCT = 0.10;
const STOP_LOSS_PCT = 0.03;
const TAKE_PROFIT_PCT = 0.06;
const CONFLUENCE_WINDOW = 3; // Signals must fire within N bars of each other
const BARS_PER_YEAR_DAILY = 252; // Sharpe annualization factor for daily bars

// Map a timeframe string to its Sharpe annualization factor (approx US equity hours).
// Exported for the routes layer so backtests on intraday timeframes don't
// report nonsense Sharpe ratios.
export function barsPerYearForTimeframe(tf) {
  switch (tf) {
    case '1Min': return 390 * 252;
    case '5Min': return 78 * 252;
    case '15Min': return 26 * 252;
    case '1H': return 7 * 252;
    case '4H': return 2 * 252;
    case '1Day':
    default: return 252;
  }
}

// Run a single strategy function and get signal indices
function getSignalMap(strategyFn, indicators, numBars) {
  const raw = strategyFn(indicators);
  const buyBars = new Set();
  const sellBars = new Set();
  for (const sig of raw) {
    if (sig.action === 'buy') buyBars.add(sig.index);
    else if (sig.action === 'sell') sellBars.add(sig.index);
  }
  return { buyBars, sellBars };
}

// Check if a signal fired within a window around a bar index
function hasFiredNear(signalSet, barIndex, window) {
  for (let offset = -window; offset <= window; offset++) {
    if (signalSet.has(barIndex + offset)) return true;
  }
  return false;
}

// Find confluence points where ALL strategies agree within the window
function findConfluenceSignals(signalMaps, numBars, window) {
  const buys = [];
  const sells = [];

  for (let i = 0; i < numBars; i++) {
    // Check if ALL strategies have a buy signal near this bar
    const allBuy = signalMaps.every(m => hasFiredNear(m.buyBars, i, window));
    if (allBuy) buys.push(i);

    const allSell = signalMaps.every(m => hasFiredNear(m.sellBars, i, window));
    if (allSell) sells.push(i);
  }

  // Deduplicate: only keep first signal in each cluster
  const dedupe = (arr) => {
    const result = [];
    let last = -999;
    for (const idx of arr) {
      if (idx - last > window * 2) {
        result.push(idx);
        last = idx;
      }
    }
    return result;
  };

  return { buys: dedupe(buys), sells: dedupe(sells) };
}

// Backtest a combination of strategies.
// `signalCache` is an optional Map<strategyKey, { buyBars, sellBars }> so the
// caller can amortize strategy-function cost across the many combos that
// reuse the same component strategy (each strategy appears in O(N) pairs
// and O(N²) triples).
function backtestCombo(strategyKeys, bars, indicators, options = {}, signalCache = null) {
  const {
    capital = INITIAL_CAPITAL,
    positionPct = POSITION_PCT,
    stopLossPct = STOP_LOSS_PCT,
    takeProfitPct = TAKE_PROFIT_PCT,
    window = CONFLUENCE_WINDOW,
    barsPerYear = BARS_PER_YEAR_DAILY,
    slippagePct = 0,
    commissionPerTrade = 0,
    minAdx = 0,
  } = options;
  const adx = indicators.adx || [];

  // Get signal maps for each strategy, using the per-run cache if provided.
  const signalMaps = strategyKeys.map(key => {
    if (signalCache && signalCache.has(key)) return signalCache.get(key);
    const strat = STRATEGIES[key];
    if (!strat) throw new Error(`Unknown strategy: ${key}`);
    const map = getSignalMap(strat.fn, indicators, bars.length);
    if (signalCache) signalCache.set(key, map);
    return map;
  });

  // Find confluence signals
  const { buys, sells } = findConfluenceSignals(signalMaps, bars.length, window);

  // Simulate trading
  const trades = [];
  let cash = capital;
  let position = null;
  let peakEquity = capital;
  let maxDrawdown = 0;
  const equityCurve = [];

  const buySet = new Set(buys);
  const sellSet = new Set(sells);

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const equity = cash + (position ? position.shares * bar.close : 0);
    equityCurve.push({ time: bar.time, equity: Math.round(equity * 100) / 100 });

    if (equity > peakEquity) peakEquity = equity;
    const dd = (peakEquity - equity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Check stop/target
    if (position) {
      if (bar.low <= position.stopPrice) {
        const fill = position.stopPrice * (1 - slippagePct);
        const pnl = (fill - position.entryPrice) * position.shares - commissionPerTrade;
        cash += position.shares * fill - commissionPerTrade;
        trades.push({
          entryTime: position.entryTime, exitTime: bar.time,
          entryPrice: position.entryPrice, exitPrice: fill,
          shares: position.shares, pnl, reason: 'Stop loss',
        });
        position = null;
        continue;
      }
      if (bar.high >= position.targetPrice) {
        const fill = position.targetPrice * (1 - slippagePct);
        const pnl = (fill - position.entryPrice) * position.shares - commissionPerTrade;
        cash += position.shares * fill - commissionPerTrade;
        trades.push({
          entryTime: position.entryTime, exitTime: bar.time,
          entryPrice: position.entryPrice, exitPrice: fill,
          shares: position.shares, pnl, reason: 'Target hit',
        });
        position = null;
        continue;
      }
    }

    // Buy signal (gated by ADX if minAdx set)
    if (buySet.has(i) && !position) {
      if (minAdx > 0 && (adx[i] == null || adx[i] < minAdx)) continue;
      const entry = bar.close * (1 + slippagePct);
      const maxSpend = cash * positionPct;
      const shares = Math.floor(maxSpend / entry);
      if (shares <= 0) continue;
      cash -= shares * entry + commissionPerTrade;
      position = {
        shares, entryPrice: entry, entryTime: bar.time,
        stopPrice: Math.round(entry * (1 - stopLossPct) * 100) / 100,
        targetPrice: Math.round(entry * (1 + takeProfitPct) * 100) / 100,
      };
    }

    // Sell signal
    if (sellSet.has(i) && position) {
      const exit = bar.close * (1 - slippagePct);
      const pnl = (exit - position.entryPrice) * position.shares - commissionPerTrade;
      cash += position.shares * exit - commissionPerTrade;
      trades.push({
        entryTime: position.entryTime, exitTime: bar.time,
        entryPrice: position.entryPrice, exitPrice: exit,
        shares: position.shares, pnl, reason: 'Sell signal',
      });
      position = null;
    }
  }

  // Close open position
  if (position && bars.length > 0) {
    const last = bars[bars.length - 1];
    const exit = last.close * (1 - slippagePct);
    const pnl = (exit - position.entryPrice) * position.shares - commissionPerTrade;
    cash += position.shares * exit - commissionPerTrade;
    trades.push({
      entryTime: position.entryTime, exitTime: last.time,
      entryPrice: position.entryPrice, exitPrice: exit,
      shares: position.shares, pnl, reason: 'End of period',
    });
  }

  const finalEquity = cash;
  const totalPnl = finalEquity - capital;
  const totalReturn = totalPnl / capital;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : avgWin > 0 ? Infinity : 0;

  let sharpe = 0;
  if (equityCurve.length > 1) {
    const returns = [];
    for (let i = 1; i < equityCurve.length; i++) {
      returns.push((equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity);
    }
    const avgRet = returns.reduce((s, r) => s + r, 0) / returns.length;
    const stdRet = Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / returns.length);
    sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(barsPerYear) : 0;
  }

  return {
    strategies: strategyKeys,
    strategyNames: strategyKeys.map(k => STRATEGIES[k]?.name || k),
    comboName: strategyKeys.map(k => STRATEGIES[k]?.name || k).join(' + '),
    comboSize: strategyKeys.length,
    initialCapital: capital,
    finalEquity: Math.round(finalEquity * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalReturn: Math.round(totalReturn * 10000) / 100,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Math.round(winRate * 10000) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    buySignals: buys.length,
    sellSignals: sells.length,
    trades,
  };
}

/**
 * Find the best strategy combinations across 1, 2, and 3 signal combos.
 * Tests all selected strategies individually, then all pairs, then top triples.
 */
export function findBestCombos(bars, selectedKeys = null, options = {}) {
  const { oosRatio = 0 } = options;
  const keys = selectedKeys || Object.keys(STRATEGIES);

  // Walk-forward validation: select the best combo on in-sample data, then
  // re-run it on out-of-sample bars the selection never saw.
  const splitIdx = oosRatio > 0 ? Math.floor(bars.length * (1 - oosRatio)) : bars.length;
  const isBars = oosRatio > 0 ? bars.slice(0, splitIdx) : bars;
  const oosBars = oosRatio > 0 ? bars.slice(splitIdx) : [];

  const indicators = computeAll(isBars);
  const allResults = [];
  // Amortize strategy execution across the O(N²) pair + O(N³) triple loops.
  // Each strategy is evaluated against the bars at most once per findBestCombos call.
  const isSignalCache = new Map();

  console.log(`[ComboBacktester] Testing ${keys.length} singles, ${keys.length * (keys.length - 1) / 2} pairs...`);

  // Singles
  for (const key of keys) {
    try {
      const result = backtestCombo([key], isBars, indicators, options, isSignalCache);
      allResults.push(result);
    } catch (_) {}
  }

  // Pairs (all combinations of 2)
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      try {
        const result = backtestCombo([keys[i], keys[j]], isBars, indicators, options, isSignalCache);
        if (result.totalTrades > 0) allResults.push(result);
      } catch (_) {}
    }
  }

  // Triples (top strategies only to keep it fast)
  // Take top 8 singles by P&L, then test all triples from those
  const topSingles = allResults
    .filter(r => r.comboSize === 1)
    .sort((a, b) => b.totalPnl - a.totalPnl)
    .slice(0, 8)
    .map(r => r.strategies[0]);

  if (topSingles.length >= 3) {
    for (let i = 0; i < topSingles.length; i++) {
      for (let j = i + 1; j < topSingles.length; j++) {
        for (let k = j + 1; k < topSingles.length; k++) {
          try {
            const result = backtestCombo([topSingles[i], topSingles[j], topSingles[k]], isBars, indicators, options, isSignalCache);
            if (result.totalTrades > 0) allResults.push(result);
          } catch (_) {}
        }
      }
    }
  }

  // Score and rank: weighted score = P&L * 0.3 + winRate * 0.3 + sharpe * 0.2 + profitFactor * 0.2
  for (const r of allResults) {
    const pnlScore = Math.min(r.totalPnl / 10000, 5); // Normalize
    const wrScore = r.winRate / 20; // 100% = 5
    const sharpeScore = r.sharpe;
    const pfScore = Math.min(r.profitFactor / 2, 5);
    r.score = Math.round((pnlScore * 0.3 + wrScore * 0.3 + sharpeScore * 0.2 + pfScore * 0.2) * 100) / 100;
  }

  allResults.sort((a, b) => b.score - a.score);

  const singles = allResults.filter(r => r.comboSize === 1).slice(0, 10);
  const pairs = allResults.filter(r => r.comboSize === 2).slice(0, 10);
  const triples = allResults.filter(r => r.comboSize === 3).slice(0, 10);
  const overall = allResults.slice(0, 20);

  console.log(`[ComboBacktester] Done. Tested ${allResults.length} combos. Best: ${overall[0]?.comboName} (score ${overall[0]?.score})`);

  // Walk-forward: re-run the top in-sample combo on the held-out tail.
  let oosValidation = null;
  if (oosRatio > 0 && oosBars.length > 20 && overall[0]) {
    try {
      const oosIndicators = computeAll(oosBars);
      // Fresh OOS cache — IS signal maps are bar-specific and don't carry over.
      const oosSignalCache = new Map();
      const oosResult = backtestCombo(overall[0].strategies, oosBars, oosIndicators, options, oosSignalCache);
      oosValidation = {
        splitIdx,
        isBars: isBars.length,
        oosBars: oosBars.length,
        bestCombo: overall[0].comboName,
        inSample: {
          totalPnl: overall[0].totalPnl,
          winRate: overall[0].winRate,
          totalTrades: overall[0].totalTrades,
          sharpe: overall[0].sharpe,
        },
        outOfSample: {
          totalPnl: oosResult.totalPnl,
          winRate: oosResult.winRate,
          totalTrades: oosResult.totalTrades,
          sharpe: oosResult.sharpe,
        },
      };
    } catch (err) {
      console.warn('[ComboBacktester] OOS validation failed:', err.message);
    }
  }

  return {
    totalCombos: allResults.length,
    best: overall[0] || null,
    topOverall: overall,
    topSingles: singles,
    topPairs: pairs,
    topTriples: triples,
    oosValidation,
  };
}

/**
 * Find best combos across multiple symbols and aggregate results.
 */
export async function findBestCombosMulti(symbolBarsMap, selectedKeys = null, options = {}) {
  const allSymbolResults = {};
  const comboTotals = {};

  for (const [symbol, bars] of Object.entries(symbolBarsMap)) {
    if (!bars || bars.length < 50) continue;
    const result = findBestCombos(bars, selectedKeys, options);
    allSymbolResults[symbol] = result;

    // Aggregate combo performance across symbols
    for (const r of result.topOverall) {
      const comboKey = r.strategies.sort().join('+');
      if (!comboTotals[comboKey]) {
        comboTotals[comboKey] = {
          strategies: r.strategies,
          comboName: r.comboName,
          comboSize: r.comboSize,
          totalPnl: 0, totalTrades: 0, wins: 0, losses: 0,
          scores: [], symbols: 0,
        };
      }
      comboTotals[comboKey].totalPnl += r.totalPnl;
      comboTotals[comboKey].totalTrades += r.totalTrades;
      comboTotals[comboKey].wins += r.wins;
      comboTotals[comboKey].losses += r.losses;
      comboTotals[comboKey].scores.push(r.score);
      comboTotals[comboKey].symbols++;
    }
  }

  const ranking = Object.values(comboTotals)
    .map(c => ({
      ...c,
      avgScore: c.scores.length ? Math.round(c.scores.reduce((s, v) => s + v, 0) / c.scores.length * 100) / 100 : 0,
      winRate: c.totalTrades > 0 ? Math.round((c.wins / c.totalTrades) * 10000) / 100 : 0,
      totalPnl: Math.round(c.totalPnl * 100) / 100,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl)
    .slice(0, 20);

  return { ranking, details: allSymbolResults };
}
