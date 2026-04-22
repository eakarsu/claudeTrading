import { BaseExchangeAdapter } from './adapter.js';
import * as alpaca from '../alpaca.js';
import { logger } from '../../logger.js';

/**
 * Exchange registry — returns adapters by id. Lazy-loads the ccxt package
 * on first use so the rest of the server doesn't need to install it.
 *
 * Currently bundled:
 *   - alpaca           : our existing US equity broker (native)
 *   - binance, coinbase, kraken : via ccxt if available (crypto)
 *
 * More ccxt-backed exchanges can be registered by adding their id to
 * CCXT_IDS — ccxt itself supports 100+ exchanges through a uniform API.
 */

class AlpacaAdapter extends BaseExchangeAdapter {
  constructor() {
    super({ id: 'alpaca', name: 'Alpaca Markets (US Equities)', kind: 'equity' });
    this.supports = { brackets: true, shorting: true, fractional: true };
  }
  getBars(symbol, timeframe, limit) { return alpaca.getBars(symbol, timeframe, limit); }
  async getLatestQuote(symbol) {
    const q = await alpaca.getLatestQuotes([symbol]);
    const row = q?.[symbol];
    return row ? { bid: row.bp, ask: row.ap, last: (row.bp + row.ap) / 2 } : null;
  }
  async getPositions() {
    const rows = await alpaca.getPositions();
    return rows.map((p) => ({
      symbol: p.symbol,
      qty: Number(p.qty),
      avgPrice: Number(p.avg_entry_price),
      currentPrice: Number(p.current_price),
      pnl: Number(p.unrealized_pl),
    }));
  }
  placeOrder(params) { return alpaca.placeOrder(params); }
  cancelOrder(id) { return alpaca.cancelOrder(id); }
}

class CcxtAdapter extends BaseExchangeAdapter {
  constructor(id, name, client) {
    super({ id, name, kind: 'crypto' });
    this.client = client;
    this.supports = { brackets: false, shorting: !!client?.has?.createMarginOrder, fractional: true };
  }
  async getBars(symbol, timeframe = '1d', limit = 200) {
    // ccxt OHLCV returns [[ts, open, high, low, close, volume], ...].
    const data = await this.client.fetchOHLCV(symbol, timeframe, undefined, limit);
    return data.map(([t, o, h, l, c, v]) => ({
      time: new Date(t).toISOString(), open: o, high: h, low: l, close: c, volume: v,
    }));
  }
  async getLatestQuote(symbol) {
    const t = await this.client.fetchTicker(symbol);
    return { bid: t.bid, ask: t.ask, last: t.last };
  }
  async getPositions() {
    if (!this.client.has?.fetchPositions) return [];
    const raw = await this.client.fetchPositions();
    return raw.map((p) => ({
      symbol: p.symbol,
      qty: Number(p.contracts) || Number(p.amount) || 0,
      avgPrice: Number(p.entryPrice) || 0,
      currentPrice: Number(p.markPrice) || 0,
      pnl: Number(p.unrealizedPnl) || 0,
    }));
  }
  placeOrder({ symbol, qty, side, type = 'market', price }) {
    return this.client.createOrder(symbol, type, side, qty, price);
  }
  cancelOrder(id) { return this.client.cancelOrder(id); }
}

const CCXT_IDS = { binance: 'Binance', coinbase: 'Coinbase', kraken: 'Kraken' };
const adapters = new Map();
let ccxtLoaded = null; // null = not tried; false = unavailable; object = module

async function loadCcxt() {
  if (ccxtLoaded !== null) return ccxtLoaded;
  try {
    const mod = await import('ccxt');
    ccxtLoaded = mod.default || mod;
    logger.info('ccxt loaded — crypto adapters available');
  } catch (_) {
    ccxtLoaded = false;
    logger.info('ccxt not installed — only alpaca adapter available');
  }
  return ccxtLoaded;
}

export async function getAdapter(id) {
  if (adapters.has(id)) return adapters.get(id);
  if (id === 'alpaca') {
    const a = new AlpacaAdapter();
    adapters.set(id, a); return a;
  }
  if (CCXT_IDS[id]) {
    const ccxt = await loadCcxt();
    if (!ccxt) throw new Error(`ccxt not installed — run \`npm install ccxt\` to enable ${id}`);
    const Klass = ccxt[id];
    if (!Klass) throw new Error(`ccxt has no adapter named ${id}`);
    // Credentials expected in env, e.g. BINANCE_API_KEY / BINANCE_SECRET.
    const client = new Klass({
      apiKey: process.env[`${id.toUpperCase()}_API_KEY`],
      secret: process.env[`${id.toUpperCase()}_SECRET`],
      enableRateLimit: true,
    });
    const a = new CcxtAdapter(id, CCXT_IDS[id], client);
    adapters.set(id, a); return a;
  }
  throw new Error(`Unknown exchange: ${id}`);
}

export async function listExchanges() {
  const ccxt = await loadCcxt();
  const out = [
    { id: 'alpaca', name: 'Alpaca Markets (US Equities)', kind: 'equity', available: true },
  ];
  for (const [id, name] of Object.entries(CCXT_IDS)) {
    out.push({ id, name, kind: 'crypto', available: !!ccxt });
  }
  return out;
}
