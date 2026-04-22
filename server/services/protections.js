import { Op } from 'sequelize';
import { AutoTraderTrade } from '../models/index.js';

/**
 * Protections — runtime safety gates that block new entries under unfavorable
 * conditions. Modeled on freqtrade's protections framework.
 *
 * Contract: `checkProtections({ userId, symbol, config, accountEquity, peakEquity })`
 * returns `{ allowed, reason? }`. The auto-trader calls this before placing
 * any new entry; any failing check blocks the entry.
 *
 * Config shape (from user's scfg.protections, all optional):
 *   stoplossGuard:  { lookbackMinutes, tradeLimit, onlyPerPair }
 *   cooldownPeriod: { cooldownMinutes }
 *   maxDrawdown:    { maxDrawdownPct, lookbackMinutes, tradeLimit }
 *   lowProfitPairs: { lookbackMinutes, minTrades, requiredProfit }
 *
 * Each protection evaluates recent closed trades (`action='sell'` with a
 * non-null pnl). A missing/empty block for a given protection = that
 * protection is disabled.
 */

const MS_PER_MIN = 60_000;

function sinceDate(minutes) {
  return new Date(Date.now() - minutes * MS_PER_MIN);
}

async function recentClosedTrades({ userId, symbol, sinceMs }) {
  const where = {
    userId: userId ?? null,
    action: 'sell',
    pnl: { [Op.ne]: null },
    createdAt: { [Op.gte]: sinceMs },
  };
  if (symbol) where.symbol = symbol;
  return AutoTraderTrade.findAll({ where, order: [['createdAt', 'DESC']] });
}

// ─── StoplossGuard ───
// Block new entries (optionally per-pair) when the user has hit >= tradeLimit
// losing trades within the lookback window. This is the primary "slow down
// when things are bad" circuit breaker.
async function stoplossGuard({ userId, symbol, cfg }) {
  if (!cfg?.tradeLimit || cfg.tradeLimit < 1) return { allowed: true };
  const lookback = Math.max(1, Number(cfg.lookbackMinutes) || 60);
  const perPair = !!cfg.onlyPerPair;

  const trades = await recentClosedTrades({
    userId,
    symbol: perPair ? symbol : null,
    sinceMs: sinceDate(lookback),
  });
  const losses = trades.filter((t) => Number(t.pnl) < 0).length;
  if (losses >= cfg.tradeLimit) {
    return {
      allowed: false,
      reason: `StoplossGuard: ${losses} losing trades in last ${lookback}m${perPair ? ` on ${symbol}` : ''} (limit ${cfg.tradeLimit})`,
    };
  }
  return { allowed: true };
}

// ─── CooldownPeriod ───
// Block re-entry on a symbol for N minutes after the last exit on that symbol.
// Prevents immediate re-entry whipsaws after a stop-out.
async function cooldownPeriod({ userId, symbol, cfg }) {
  if (!cfg?.cooldownMinutes || cfg.cooldownMinutes < 1) return { allowed: true };
  const mostRecent = await AutoTraderTrade.findOne({
    where: { userId: userId ?? null, symbol, action: 'sell' },
    order: [['createdAt', 'DESC']],
  });
  if (!mostRecent) return { allowed: true };

  const ageMs = Date.now() - new Date(mostRecent.createdAt).getTime();
  const remainingMs = cfg.cooldownMinutes * MS_PER_MIN - ageMs;
  if (remainingMs > 0) {
    const remainMin = Math.ceil(remainingMs / MS_PER_MIN);
    return {
      allowed: false,
      reason: `CooldownPeriod: ${symbol} in cooldown for another ${remainMin}m`,
    };
  }
  return { allowed: true };
}

// ─── MaxDrawdown ───
// Halt ALL new entries if realized drawdown in the lookback window exceeds
// maxDrawdownPct of the running peak (computed from the closed-trade
// equity curve, NOT live account equity — we use trade history so the check
// is self-contained and doesn't depend on broker-side NAV).
async function maxDrawdown({ userId, cfg }) {
  if (!cfg?.maxDrawdownPct) return { allowed: true };
  const lookback = Math.max(1, Number(cfg.lookbackMinutes) || 1440);
  const minTrades = Math.max(1, Number(cfg.tradeLimit) || 5);

  const trades = await recentClosedTrades({ userId, sinceMs: sinceDate(lookback) });
  if (trades.length < minTrades) return { allowed: true };

  // Trades came back DESC; reverse for chronological P&L curve.
  const pnls = trades.slice().reverse().map((t) => Number(t.pnl) || 0);
  let running = 0;
  let peak = 0;
  let trough = 0;
  for (const p of pnls) {
    running += p;
    if (running > peak) { peak = running; trough = running; }
    if (running < trough) trough = running;
  }
  // Relative to starting notional is unknown here, so express DD as absolute
  // currency below peak. Callers pass maxDrawdownPct as a *dollar* threshold
  // when they don't have equity — or see below, we normalize by peak when
  // peak > 0 and treat maxDrawdownPct as a fraction of peak.
  const dd = peak - trough;
  const ddPct = peak > 0 ? dd / peak : 0;
  if (peak > 0 && ddPct >= cfg.maxDrawdownPct) {
    return {
      allowed: false,
      reason: `MaxDrawdown: realized DD ${(ddPct * 100).toFixed(1)}% in last ${lookback}m exceeds ${(cfg.maxDrawdownPct * 100).toFixed(1)}%`,
    };
  }
  return { allowed: true };
}

// ─── LowProfitPairs ───
// Block further entries on a symbol whose recent expectancy (avg pnl per
// closed trade) is below the threshold. Requires at least `minTrades` samples
// to avoid blocking based on one-off noise.
async function lowProfitPairs({ userId, symbol, cfg }) {
  if (cfg?.requiredProfit == null) return { allowed: true };
  const lookback = Math.max(1, Number(cfg.lookbackMinutes) || 1440);
  const minTrades = Math.max(1, Number(cfg.minTrades) || 4);

  const trades = await recentClosedTrades({
    userId, symbol, sinceMs: sinceDate(lookback),
  });
  if (trades.length < minTrades) return { allowed: true };

  const total = trades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const avg = total / trades.length;
  // requiredProfit is in dollars per trade (the same units as pnl in the DB).
  if (avg < Number(cfg.requiredProfit)) {
    return {
      allowed: false,
      reason: `LowProfitPairs: ${symbol} avg P&L $${avg.toFixed(2)} over ${trades.length} trades < required $${Number(cfg.requiredProfit).toFixed(2)}`,
    };
  }
  return { allowed: true };
}

/**
 * Evaluate all configured protections. Short-circuits on the first block.
 * @returns {Promise<{allowed: true} | {allowed: false, reason: string, protection: string}>}
 */
export async function checkProtections({ userId, symbol, config }) {
  const p = config?.protections;
  if (!p) return { allowed: true };

  const checks = [
    ['stoplossGuard',  () => stoplossGuard({ userId, symbol, cfg: p.stoplossGuard })],
    ['cooldownPeriod', () => cooldownPeriod({ userId, symbol, cfg: p.cooldownPeriod })],
    ['maxDrawdown',    () => maxDrawdown({ userId, cfg: p.maxDrawdown })],
    ['lowProfitPairs', () => lowProfitPairs({ userId, symbol, cfg: p.lowProfitPairs })],
  ];

  for (const [name, run] of checks) {
    const r = await run();
    if (!r.allowed) return { allowed: false, reason: r.reason, protection: name };
  }
  return { allowed: true };
}

/**
 * Standalone helper for the UI — returns the current state of each protection
 * without evaluating a hypothetical entry. Useful for "why are my trades
 * being blocked?" diagnostics.
 */
export async function summarizeProtections({ userId, config, symbols = [] }) {
  const p = config?.protections;
  if (!p) return { enabled: false, symbols: [] };
  const perSymbol = [];
  for (const sym of symbols) {
    const r = await checkProtections({ userId, symbol: sym, config });
    perSymbol.push({ symbol: sym, ...r });
  }
  return { enabled: true, symbols: perSymbol };
}
