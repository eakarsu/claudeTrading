/**
 * Backtesting engine — simulates trades from strategy signals against historical data.
 * Tracks P&L, win rate, max drawdown, Sharpe ratio, and trade history.
 */

import { runStrategy, runAllStrategies, STRATEGIES } from './strategyEngine.js';

const INITIAL_CAPITAL = 100000;
const POSITION_SIZE_PCT = 0.10; // Risk 10% of capital per trade
const STOP_LOSS_PCT = 0.03;    // 3% stop loss
const TAKE_PROFIT_PCT = 0.06;  // 6% take profit (2:1 R:R)

export function backtest(strategyKey, bars, options = {}) {
  const {
    capital = INITIAL_CAPITAL,
    positionPct = POSITION_SIZE_PCT,
    stopLossPct = STOP_LOSS_PCT,
    takeProfitPct = TAKE_PROFIT_PCT,
    barsPerYear = 252, // Sharpe annualization — override for intraday bars
    slippagePct = 0,          // e.g. 0.0005 = 5bps each fill
    commissionPerTrade = 0,   // $ per side
    oosRatio = 0,             // 0..0.5 — fraction of bars held out for OOS report
  } = options;

  // Walk-forward / OOS split. We still run the single continuous sim on the
  // full bar set (strategies don't retrain here), but we report per-segment
  // stats so callers can see IS vs OOS performance.
  const splitIdx = oosRatio > 0
    ? Math.floor(bars.length * (1 - oosRatio))
    : bars.length;

  const signals = runStrategy(strategyKey, bars);
  const trades = [];
  let cash = capital;
  let position = null; // { shares, entryPrice, entryTime, side, stopPrice, targetPrice }
  let peakEquity = capital;
  let maxDrawdown = 0;
  const equityCurve = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    // Long-only equity: cash + mark-to-market of open position. The engine
    // doesn't open short positions, so we don't need a dual-side formula.
    const equity = cash + (position && position.side === 'buy' ? position.shares * bar.close : 0);

    equityCurve.push({ time: bar.time, equity: Math.round(equity * 100) / 100 });

    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Check stop loss / take profit if in position
    if (position && position.side === 'buy') {
      if (bar.low <= position.stopPrice) {
        // Stopped out — slip the fill worse than the trigger.
        const fill = position.stopPrice * (1 - slippagePct);
        const gross = (fill - position.entryPrice) * position.shares;
        const pnl = gross - commissionPerTrade; // already paid on entry, pay again on exit
        cash += position.shares * fill - commissionPerTrade;
        trades.push({
          entryTime: position.entryTime, exitTime: bar.time,
          entryPrice: position.entryPrice, exitPrice: fill,
          shares: position.shares, side: 'buy', pnl, reason: 'Stop loss hit',
          entryIdx: position.entryIdx, exitIdx: i,
        });
        position = null;
        continue;
      }
      if (bar.high >= position.targetPrice) {
        // Target hit — slip the fill worse than the trigger (more conservative).
        const fill = position.targetPrice * (1 - slippagePct);
        const gross = (fill - position.entryPrice) * position.shares;
        const pnl = gross - commissionPerTrade;
        cash += position.shares * fill - commissionPerTrade;
        trades.push({
          entryTime: position.entryTime, exitTime: bar.time,
          entryPrice: position.entryPrice, exitPrice: fill,
          shares: position.shares, side: 'buy', pnl, reason: 'Target hit',
          entryIdx: position.entryIdx, exitIdx: i,
        });
        position = null;
        continue;
      }
    }

    // Check signals at this bar
    const barSignals = signals.filter(s => s.time === bar.time);
    for (const sig of barSignals) {
      if (sig.action === 'buy' && !position) {
        const entry = bar.close * (1 + slippagePct);     // pay a bit more on entry
        const maxSpend = cash * positionPct;
        const shares = Math.floor(maxSpend / entry);
        if (shares <= 0) continue;

        cash -= shares * entry + commissionPerTrade;
        position = {
          shares,
          entryPrice: entry,
          entryTime: bar.time,
          entryIdx: i,
          side: 'buy',
          stopPrice: Math.round(entry * (1 - stopLossPct) * 100) / 100,
          targetPrice: Math.round(entry * (1 + takeProfitPct) * 100) / 100,
        };
      } else if (sig.action === 'sell' && position && position.side === 'buy') {
        const exit = bar.close * (1 - slippagePct);
        const gross = (exit - position.entryPrice) * position.shares;
        const pnl = gross - commissionPerTrade;
        cash += position.shares * exit - commissionPerTrade;
        trades.push({
          entryTime: position.entryTime, exitTime: bar.time,
          entryPrice: position.entryPrice, exitPrice: exit,
          shares: position.shares, side: 'buy', pnl, reason: sig.reason,
          entryIdx: position.entryIdx, exitIdx: i,
        });
        position = null;
      }
    }
  }

  // Close any open position at last bar
  if (position && bars.length > 0) {
    const lastBar = bars[bars.length - 1];
    const exit = lastBar.close * (1 - slippagePct);
    const gross = (exit - position.entryPrice) * position.shares;
    const pnl = gross - commissionPerTrade;
    cash += position.shares * exit - commissionPerTrade;
    trades.push({
      entryTime: position.entryTime, exitTime: lastBar.time,
      entryPrice: position.entryPrice, exitPrice: exit,
      shares: position.shares, side: 'buy', pnl, reason: 'End of period',
      entryIdx: position.entryIdx, exitIdx: bars.length - 1,
    });
    position = null;
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

  // Sharpe ratio (simplified: daily returns)
  let sharpe = 0;
  if (equityCurve.length > 1) {
    const returns = [];
    for (let i = 1; i < equityCurve.length; i++) {
      returns.push((equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity);
    }
    const avgRet = returns.reduce((s, r) => s + r, 0) / returns.length;
    const stdRet = Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / returns.length);
    sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(barsPerYear) : 0; // Annualized
  }

  // OOS sub-report: subset trades whose exit fell inside the held-out tail.
  let oosReport = null;
  if (oosRatio > 0 && trades.length) {
    const inSample = trades.filter((t) => (t.exitIdx ?? 0) < splitIdx);
    const outSample = trades.filter((t) => (t.exitIdx ?? 0) >= splitIdx);
    const summarize = (arr) => {
      const w = arr.filter((t) => t.pnl > 0);
      const l = arr.filter((t) => t.pnl <= 0);
      const pnl = arr.reduce((s, t) => s + t.pnl, 0);
      return {
        trades: arr.length,
        wins: w.length,
        losses: l.length,
        winRate: arr.length ? Math.round((w.length / arr.length) * 10000) / 100 : 0,
        totalPnl: Math.round(pnl * 100) / 100,
      };
    };
    oosReport = {
      splitIdx,
      inSample: summarize(inSample),
      outSample: summarize(outSample),
    };
  }

  return {
    strategy: STRATEGIES[strategyKey]?.name || strategyKey,
    strategyKey,
    initialCapital: capital,
    finalEquity: Math.round(finalEquity * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalReturn: Math.round(totalReturn * 10000) / 100, // percentage
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Math.round(winRate * 10000) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    trades,
    equityCurve,
    oosReport,
  };
}

// Backtest all strategies on the same bars and rank them
export function backtestAll(bars, options = {}) {
  const results = [];
  for (const key of Object.keys(STRATEGIES)) {
    try {
      results.push(backtest(key, bars, options));
    } catch (err) {
      results.push({ strategyKey: key, strategy: STRATEGIES[key].name, error: err.message });
    }
  }

  // Sort by total P&L descending
  results.sort((a, b) => (b.totalPnl || 0) - (a.totalPnl || 0));

  return results;
}
