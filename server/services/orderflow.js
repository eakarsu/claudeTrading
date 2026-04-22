/**
 * Orderflow-lite — recent tape + quote-inferred trade side, and a
 * shallow order-book imbalance proxy.
 *
 * Alpaca doesn't expose L2 orderbook on the equities API, so a true
 * bid/ask depth imbalance isn't available. We approximate with:
 *
 *   - Latest trade(s) vs. latest quote bid/ask — classify each trade as
 *     "buy" (at/above ask), "sell" (at/below bid), or "mid".
 *   - Aggregate the last N trades into a running imbalance ratio:
 *         (buyVolume - sellVolume) / totalVolume
 *
 * That's enough to power the UI widget freqtrade's orderflow doc describes
 * without overstating what we can know from L1 quotes.
 */

import * as alpaca from './alpaca.js';

const DATA = 'https://data.alpaca.markets';

async function fetchJson(url) {
  const { ALPACA_KEY_ID, ALPACA_SECRET_KEY } = process.env;
  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': ALPACA_KEY_ID || '',
      'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY || '',
    },
  });
  if (!res.ok) throw new Error(`Alpaca ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Fetch last N trades (tape). Returns [{ time, price, size, side }].
 * `side` is inferred from the latest quote — "buy" if ≥ ask, "sell" if ≤ bid.
 */
export async function recentTrades(symbol, limit = 100) {
  symbol = symbol.toUpperCase();
  const url = `${DATA}/v2/stocks/${symbol}/trades?limit=${Math.min(limit, 1000)}`;
  const [tape, quotes] = await Promise.all([
    fetchJson(url),
    alpaca.getLatestQuotes([symbol]).catch(() => null),
  ]);

  const q = quotes?.[symbol] || null;
  const bid = q?.bp ?? null;
  const ask = q?.ap ?? null;

  const trades = (tape.trades || []).map((t) => {
    const price = t.p;
    let side = 'mid';
    if (bid != null && ask != null) {
      if (price >= ask - 1e-6) side = 'buy';
      else if (price <= bid + 1e-6) side = 'sell';
    }
    return { time: t.t, price, size: t.s, side };
  });

  return { symbol, bid, ask, trades };
}

/**
 * Imbalance over the last N trades — a proxy for orderbook pressure.
 *   positive → buying pressure
 *   negative → selling pressure
 */
export async function imbalance(symbol, lookback = 100) {
  const { trades, bid, ask } = await recentTrades(symbol, lookback);
  let buyVol = 0, sellVol = 0, midVol = 0;
  for (const t of trades) {
    if (t.side === 'buy') buyVol += t.size;
    else if (t.side === 'sell') sellVol += t.size;
    else midVol += t.size;
  }
  const total = buyVol + sellVol + midVol;
  const ratio = total > 0 ? (buyVol - sellVol) / total : 0;
  return {
    symbol: symbol.toUpperCase(),
    lookback,
    bid, ask,
    buyVolume: buyVol, sellVolume: sellVol, midVolume: midVol, totalVolume: total,
    imbalance: Math.round(ratio * 10000) / 10000,
    bias: ratio > 0.1 ? 'buyers' : ratio < -0.1 ? 'sellers' : 'balanced',
  };
}
