import * as alpaca from './alpaca.js';

/**
 * Pairlist handlers — filter/rank a symbol universe before passing it to the
 * auto-trader. Modeled on freqtrade's pairlist handlers: each handler is a
 * pure transform on the list, chained in order.
 *
 * Handlers implemented:
 *   - VolumePairList: keep top N by rolling dollar volume
 *   - AgeFilter:      drop symbols younger than minDays (reject new listings)
 *   - PriceFilter:    drop symbols outside [minPrice, maxPrice]
 *   - SpreadFilter:   drop symbols with wide bid/ask (needs live quotes)
 *
 * Usage:
 *   await applyPairlists(['AAPL','TSLA',...], [
 *     { kind: 'VolumePairList', number_assets: 20 },
 *     { kind: 'AgeFilter', min_days: 90 },
 *     { kind: 'PriceFilter', min_price: 5, max_price: 500 },
 *     { kind: 'SpreadFilter', max_spread_pct: 0.005 },
 *   ]);
 */

const BAR_CACHE = new Map(); // symbol → { ts, bars }
const BAR_TTL_MS = 10 * 60_000;

async function cachedBars(symbol, timeframe, limit) {
  const key = `${symbol}:${timeframe}:${limit}`;
  const cached = BAR_CACHE.get(key);
  if (cached && Date.now() - cached.ts < BAR_TTL_MS) return cached.bars;
  const bars = await alpaca.getBars(symbol, timeframe, limit).catch(() => []);
  BAR_CACHE.set(key, { ts: Date.now(), bars });
  return bars;
}

// ── VolumePairList ──
async function volumePairList(symbols, cfg) {
  const n = Math.max(1, Math.min(200, Number(cfg?.number_assets) || 20));
  const lookback = Math.max(1, Math.min(60, Number(cfg?.lookback_days) || 7));
  const scored = [];
  for (const s of symbols) {
    const bars = await cachedBars(s, '1Day', lookback);
    if (!bars.length) continue;
    // Rolling dollar volume = sum(close_i * volume_i). Proxy for liquidity.
    const dv = bars.reduce((sum, b) => sum + (Number(b.close) || 0) * (Number(b.volume) || 0), 0);
    scored.push({ symbol: s, dollarVolume: dv });
  }
  scored.sort((a, b) => b.dollarVolume - a.dollarVolume);
  return scored.slice(0, n).map((x) => x.symbol);
}

// ── AgeFilter ──
async function ageFilter(symbols, cfg) {
  const minDays = Math.max(1, Number(cfg?.min_days) || 90);
  const kept = [];
  for (const s of symbols) {
    // We use bar history depth as a proxy — if Alpaca can serve >= minDays of
    // daily bars, the symbol is at least that old.
    const bars = await cachedBars(s, '1Day', minDays + 5);
    if (bars.length >= minDays) kept.push(s);
  }
  return kept;
}

// ── PriceFilter ──
async function priceFilter(symbols, cfg) {
  const minP = Number(cfg?.min_price);
  const maxP = Number(cfg?.max_price);
  const kept = [];
  for (const s of symbols) {
    const bars = await cachedBars(s, '1Day', 2);
    const last = bars[bars.length - 1];
    if (!last) continue;
    const p = Number(last.close);
    if (Number.isFinite(minP) && p < minP) continue;
    if (Number.isFinite(maxP) && p > maxP) continue;
    kept.push(s);
  }
  return kept;
}

// ── SpreadFilter ──
async function spreadFilter(symbols, cfg) {
  const maxSpreadPct = Number(cfg?.max_spread_pct) || 0.005; // 0.5% default
  const quotes = await alpaca.getLatestQuotes(symbols).catch(() => ({}));
  const kept = [];
  for (const s of symbols) {
    const q = quotes[s];
    const ask = Number(q?.ap); const bid = Number(q?.bp);
    if (!Number.isFinite(ask) || !Number.isFinite(bid) || ask <= 0 || bid <= 0) {
      // No quote = can't evaluate; conservatively drop (same as freqtrade).
      continue;
    }
    const mid = (ask + bid) / 2;
    const spread = mid > 0 ? (ask - bid) / mid : 1;
    if (spread <= maxSpreadPct) kept.push(s);
  }
  return kept;
}

const HANDLERS = {
  VolumePairList: volumePairList,
  AgeFilter: ageFilter,
  PriceFilter: priceFilter,
  SpreadFilter: spreadFilter,
};

/**
 * Apply a chain of pairlist handlers. Each handler receives the output of the
 * previous one. Invalid / unknown handler kinds throw so misconfigurations
 * surface immediately rather than silently passing everything through.
 */
export async function applyPairlists(symbols, chain) {
  if (!Array.isArray(symbols)) throw new Error('symbols must be an array');
  if (!Array.isArray(chain) || !chain.length) return symbols;
  let current = symbols.map((s) => String(s).toUpperCase());
  const trace = [{ after: 'input', symbols: current }];
  for (const step of chain) {
    const fn = HANDLERS[step.kind];
    if (!fn) throw new Error(`Unknown pairlist handler: ${step.kind}`);
    current = await fn(current, step);
    trace.push({ after: step.kind, symbols: current });
  }
  return { symbols: current, trace };
}

export const PAIRLIST_HANDLERS = Object.keys(HANDLERS);
