import '../env.js';
import { UpstreamError } from '../errors.js';
import { logger } from '../logger.js';

const ENDPOINT = process.env.ALPACA_ENDPOINT || 'https://paper-api.alpaca.markets';
const DATA_ENDPOINT = 'https://data.alpaca.markets';
const API_KEY = process.env.ALPACA_API_KEY;
const API_SECRET = process.env.ALPACA_API_SECRET;

function authHeaders() {
  if (!API_KEY || !API_SECRET || API_KEY === 'your-alpaca-key-here') {
    throw new UpstreamError('Alpaca API keys not configured. Set ALPACA_API_KEY and ALPACA_API_SECRET in .env.');
  }
  return {
    'APCA-API-KEY-ID': API_KEY,
    'APCA-API-SECRET-KEY': API_SECRET,
    'Content-Type': 'application/json',
  };
}

const FETCH_TIMEOUT_MS = parseInt(process.env.ALPACA_FETCH_TIMEOUT_MS || '8000', 10);
const FETCH_RETRIES = parseInt(process.env.ALPACA_FETCH_RETRIES || '1', 10);

// Retry only for writes that are safe to repeat. Alpaca accepts client_order_id
// for idempotency, so POST /orders with a provided id is also retry-safe.
function isRetryableRequest(method, body) {
  if (method === 'GET' || method === 'HEAD') return true;
  if (method === 'POST' && body?.client_order_id) return true;
  return false;
}

async function fetchJson(url, { method = 'GET', body } = {}) {
  const opts = { method, headers: authHeaders() };
  if (body) opts.body = JSON.stringify(body);

  const maxAttempts = isRetryableRequest(method, body) ? FETCH_RETRIES + 1 : 1;
  let res;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetch(url, { ...opts, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts) {
        logger.error({ err, url, attempts: attempt }, 'Alpaca network error');
        throw new UpstreamError(`Alpaca connection failed: ${err.message}`, { cause: err });
      }
      // Jittered backoff: 100-300ms for attempt 1, 300-700ms for attempt 2, ...
      const delay = 100 * attempt + Math.floor(Math.random() * 200 * attempt);
      logger.warn({ err, url, attempt }, 'Alpaca network error, retrying');
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const message = data?.message || `Alpaca error ${res.status}`;
    throw new UpstreamError(message, { code: 'ALPACA_ERROR', details: { status: res.status } });
  }
  return data;
}

// ── Trading API ──
export const getAccount = () => fetchJson(`${ENDPOINT}/v2/account`);
export const getPositions = () => fetchJson(`${ENDPOINT}/v2/positions`);
export const getPosition = (symbol) => fetchJson(`${ENDPOINT}/v2/positions/${encodeURIComponent(symbol)}`);
export const getClock = () => fetchJson(`${ENDPOINT}/v2/clock`);
export const getAsset = (symbol) => fetchJson(`${ENDPOINT}/v2/assets/${encodeURIComponent(symbol.toUpperCase())}`);

export function placeOrder({
  symbol,
  qty,
  side,
  type = 'market',
  time_in_force = 'day',
  limit_price,
  stop_price,
  trail_percent,     // trailing_stop type
  trail_price,       // trailing_stop type (absolute $ trail, alternative to percent)
  client_order_id,
  order_class,       // 'simple' | 'bracket' | 'oto' | 'oco'
  take_profit,       // { limit_price }
  stop_loss,         // { stop_price, limit_price? }
}) {
  const body = { symbol: symbol.toUpperCase(), qty: String(qty), side, type, time_in_force };
  if (client_order_id) body.client_order_id = client_order_id; // enables Alpaca-side idempotency
  if (type === 'limit' && limit_price != null) body.limit_price = String(limit_price);
  if (type === 'stop' && stop_price != null) body.stop_price = String(stop_price);
  if (type === 'stop_limit') {
    if (limit_price != null) body.limit_price = String(limit_price);
    if (stop_price != null) body.stop_price = String(stop_price);
  }
  if (type === 'trailing_stop') {
    // Trailing stops must be GTC — Alpaca rejects DAY.
    body.time_in_force = 'gtc';
    if (trail_percent != null) body.trail_percent = String(trail_percent);
    else if (trail_price != null) body.trail_price = String(trail_price);
  }
  if (order_class) {
    body.order_class = order_class;
    // Bracket/OCO orders can't be DAY — they must remain open across sessions.
    if (order_class === 'bracket' || order_class === 'oco') {
      body.time_in_force = 'gtc';
    }
    if (take_profit?.limit_price != null) {
      body.take_profit = { limit_price: String(take_profit.limit_price) };
    }
    if (stop_loss?.stop_price != null) {
      body.stop_loss = { stop_price: String(stop_loss.stop_price) };
      if (stop_loss.limit_price != null) body.stop_loss.limit_price = String(stop_loss.limit_price);
    }
  }
  return fetchJson(`${ENDPOINT}/v2/orders`, { method: 'POST', body });
}

export const getOrders = (status = 'all', limit = 50) =>
  fetchJson(`${ENDPOINT}/v2/orders?status=${status}&limit=${limit}&direction=desc`);
export const cancelOrder = (orderId) => fetchJson(`${ENDPOINT}/v2/orders/${orderId}`, { method: 'DELETE' });
export const cancelAllOrders = () => fetchJson(`${ENDPOINT}/v2/orders`, { method: 'DELETE' });

// Close a single position at market (Alpaca liquidates the entire position).
export const closePosition = (symbol) =>
  fetchJson(`${ENDPOINT}/v2/positions/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
export const closeAllPositions = () =>
  fetchJson(`${ENDPOINT}/v2/positions?cancel_orders=true`, { method: 'DELETE' });

// Trailing stop (server-side). side='sell' exits a long by trail_percent below high-water.
export function placeTrailingStop({ symbol, qty, side = 'sell', trailPercent, client_order_id }) {
  const body = {
    symbol: symbol.toUpperCase(),
    qty: String(qty),
    side,
    type: 'trailing_stop',
    time_in_force: 'gtc',
    trail_percent: String(trailPercent),
  };
  if (client_order_id) body.client_order_id = client_order_id;
  return fetchJson(`${ENDPOINT}/v2/orders`, { method: 'POST', body });
}

export const getPortfolioHistory = (period = '1M', timeframe = '1D') =>
  fetchJson(`${ENDPOINT}/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}`);

// ── Market data API ──
export async function getLatestQuotes(symbols) {
  const url = `${DATA_ENDPOINT}/v2/stocks/quotes/latest?symbols=${encodeURIComponent(symbols.join(','))}`;
  const data = await fetchJson(url);
  return data.quotes || data;
}
export async function getLatestTrades(symbols) {
  const url = `${DATA_ENDPOINT}/v2/stocks/trades/latest?symbols=${encodeURIComponent(symbols.join(','))}`;
  const data = await fetchJson(url);
  return data.trades || data;
}

/**
 * Historical bars for backtesting / auto-trader.
 * Daily bars return `time` as 'YYYY-MM-DD' (legacy behavior, chart compat).
 * Intraday bars preserve the full ISO timestamp so strategies can group by session
 * and the client_order_id hash is unique per bar.
 */
export async function getBars(symbol, timeframe = '1Day', limit = 200) {
  const isIntraday = timeframe !== '1Day' && timeframe !== '1D';
  // Need a longer lookback in wall-clock days for intraday than `limit` bars implies.
  // Rough heuristic: assume ~78 bars/day on 5Min, 390 on 1Min, 26 on 15Min.
  const daysBack = isIntraday
    ? Math.max(7, Math.ceil(limit / 60))
    : Math.max(1, limit);
  const start = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const url = `${DATA_ENDPOINT}/v2/stocks/${symbol}/bars?timeframe=${timeframe}&start=${start}&limit=${limit}`;
  const data = await fetchJson(url);
  if (!data.bars) return [];
  return data.bars.map((b) => ({
    time: isIntraday ? b.t : b.t.split('T')[0],
    open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
  }));
}
