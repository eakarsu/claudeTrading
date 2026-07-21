import '../env.js';
import { UpstreamError } from '../errors.js';
import { logger } from '../logger.js';

export const ALPACA_ENDPOINTS = Object.freeze({
  paper: 'https://paper-api.alpaca.markets',
  live: 'https://api.alpaca.markets',
});
const DATA_ENDPOINT = 'https://data.alpaca.markets';
const FETCH_TIMEOUT_MS = Number.parseInt(process.env.ALPACA_FETCH_TIMEOUT_MS || '8000', 10);
const FETCH_RETRIES = Number.parseInt(process.env.ALPACA_FETCH_RETRIES || '1', 10);

function isRetryableRequest(method, body) {
  if (method === 'GET' || method === 'HEAD') return true;
  return method === 'POST' && Boolean(body?.client_order_id);
}

function orderBody({
  symbol, qty, side, type = 'market', time_in_force = 'day', limit_price,
  stop_price, trail_percent, trail_price, client_order_id, order_class,
  take_profit, stop_loss,
}) {
  const body = { symbol: symbol.toUpperCase(), qty: String(qty), side, type, time_in_force };
  if (client_order_id) body.client_order_id = client_order_id;
  if (type === 'limit' && limit_price != null) body.limit_price = String(limit_price);
  if (type === 'stop' && stop_price != null) body.stop_price = String(stop_price);
  if (type === 'stop_limit') {
    if (limit_price != null) body.limit_price = String(limit_price);
    if (stop_price != null) body.stop_price = String(stop_price);
  }
  if (type === 'trailing_stop') {
    body.time_in_force = 'gtc';
    if (trail_percent != null) body.trail_percent = String(trail_percent);
    else if (trail_price != null) body.trail_price = String(trail_price);
  }
  if (order_class) {
    body.order_class = order_class;
    if (order_class === 'bracket' || order_class === 'oco') body.time_in_force = 'gtc';
    if (take_profit?.limit_price != null) body.take_profit = { limit_price: String(take_profit.limit_price) };
    if (stop_loss?.stop_price != null) {
      body.stop_loss = { stop_price: String(stop_loss.stop_price) };
      if (stop_loss.limit_price != null) body.stop_loss.limit_price = String(stop_loss.limit_price);
    }
  }
  return body;
}

/**
 * Creates a credential-bound adapter. The trading endpoint is selected only
 * from the declared environment; callers cannot combine paper credentials
 * with a live URL or smuggle an arbitrary endpoint into an order request.
 */
export function createAlpacaClient({ apiKey, apiSecret, environment = 'paper', fetchImpl = fetch } = {}) {
  if (!Object.hasOwn(ALPACA_ENDPOINTS, environment)) {
    throw new UpstreamError(`Unsupported Alpaca environment: ${environment}`);
  }
  if (!apiKey || !apiSecret || apiKey === 'your-alpaca-key-here') {
    throw new UpstreamError('Alpaca API keys not configured.');
  }
  const endpoint = ALPACA_ENDPOINTS[environment];
  const headers = {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': apiSecret,
    'Content-Type': 'application/json',
  };

  async function fetchJson(url, { method = 'GET', body } = {}) {
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const maxAttempts = isRetryableRequest(method, body) ? FETCH_RETRIES + 1 : 1;
    let res;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        res = await fetchImpl(url, { ...opts, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        break;
      } catch (err) {
        if (attempt >= maxAttempts) {
          logger.error({ err, url, attempts: attempt }, 'Alpaca network error');
          throw new UpstreamError(`Alpaca connection failed: ${err.message}`, { cause: err });
        }
        const delay = 100 * attempt + Math.floor(Math.random() * 200 * attempt);
        logger.warn({ err, url, attempt }, 'Alpaca network error, retrying');
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      throw new UpstreamError(data?.message || `Alpaca error ${res.status}`, {
        code: 'ALPACA_ERROR', details: { status: res.status },
      });
    }
    return data;
  }

  const client = {
    environment,
    getAccount: () => fetchJson(`${endpoint}/v2/account`),
    getPositions: () => fetchJson(`${endpoint}/v2/positions`),
    getPosition: (symbol) => fetchJson(`${endpoint}/v2/positions/${encodeURIComponent(symbol)}`),
    getClock: () => fetchJson(`${endpoint}/v2/clock`),
    getAsset: (symbol) => fetchJson(`${endpoint}/v2/assets/${encodeURIComponent(symbol.toUpperCase())}`),
    placeOrder: (params) => fetchJson(`${endpoint}/v2/orders`, { method: 'POST', body: orderBody(params) }),
    getOrders: (status = 'all', limit = 50) =>
      fetchJson(`${endpoint}/v2/orders?status=${status}&limit=${limit}&direction=desc&nested=true`),
    getOrder: (orderId) => fetchJson(`${endpoint}/v2/orders/${encodeURIComponent(orderId)}?nested=true`),
    getOrderByClientId: (clientOrderId) =>
      fetchJson(`${endpoint}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}&nested=true`),
    cancelOrder: (orderId) => fetchJson(`${endpoint}/v2/orders/${orderId}`, { method: 'DELETE' }),
    cancelAllOrders: () => fetchJson(`${endpoint}/v2/orders`, { method: 'DELETE' }),
    closePosition: (symbol) => fetchJson(`${endpoint}/v2/positions/${encodeURIComponent(symbol)}`, { method: 'DELETE' }),
    closeAllPositions: () => fetchJson(`${endpoint}/v2/positions?cancel_orders=true`, { method: 'DELETE' }),
    getPortfolioHistory: (period = '1M', timeframe = '1D') =>
      fetchJson(`${endpoint}/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}`),
    getLatestQuotes: async (symbols) => {
      const data = await fetchJson(`${DATA_ENDPOINT}/v2/stocks/quotes/latest?symbols=${encodeURIComponent(symbols.join(','))}`);
      return data.quotes || data;
    },
    getLatestTrades: async (symbols) => {
      const data = await fetchJson(`${DATA_ENDPOINT}/v2/stocks/trades/latest?symbols=${encodeURIComponent(symbols.join(','))}`);
      return data.trades || data;
    },
    getBars: async (symbol, timeframe = '1Day', limit = 200) => {
      const isIntraday = timeframe !== '1Day' && timeframe !== '1D';
      const daysBack = isIntraday ? Math.max(7, Math.ceil(limit / 60)) : Math.max(1, limit);
      const start = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];
      const data = await fetchJson(`${DATA_ENDPOINT}/v2/stocks/${symbol}/bars?timeframe=${timeframe}&start=${start}&limit=${limit}`);
      if (!data.bars) return [];
      return data.bars.map((bar) => ({
        time: isIntraday ? bar.t : bar.t.split('T')[0],
        timestamp: bar.t,
        open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v,
      }));
    },
  };
  client.placeTrailingStop = ({ symbol, qty, side = 'sell', trailPercent, client_order_id }) =>
    client.placeOrder({ symbol, qty, side, type: 'trailing_stop', time_in_force: 'gtc', trail_percent: trailPercent, client_order_id });
  return Object.freeze(client);
}

// Legacy adapter remains paper-only. Live execution is available exclusively
// through the per-user governed connection service.
let defaultClient;
function legacyClient() {
  if (!defaultClient) defaultClient = createAlpacaClient({
    apiKey: process.env.ALPACA_API_KEY,
    apiSecret: process.env.ALPACA_API_SECRET,
    environment: 'paper',
  });
  return defaultClient;
}

export const getAccount = (...args) => legacyClient().getAccount(...args);
export const getPositions = (...args) => legacyClient().getPositions(...args);
export const getPosition = (...args) => legacyClient().getPosition(...args);
export const getClock = (...args) => legacyClient().getClock(...args);
export const getAsset = (...args) => legacyClient().getAsset(...args);
export const placeOrder = (...args) => legacyClient().placeOrder(...args);
export const getOrders = (...args) => legacyClient().getOrders(...args);
export const getOrder = (...args) => legacyClient().getOrder(...args);
export const getOrderByClientId = (...args) => legacyClient().getOrderByClientId(...args);
export const cancelOrder = (...args) => legacyClient().cancelOrder(...args);
export const cancelAllOrders = (...args) => legacyClient().cancelAllOrders(...args);
export const closePosition = (...args) => legacyClient().closePosition(...args);
export const closeAllPositions = (...args) => legacyClient().closeAllPositions(...args);
export const placeTrailingStop = (...args) => legacyClient().placeTrailingStop(...args);
export const getPortfolioHistory = (...args) => legacyClient().getPortfolioHistory(...args);
export const getLatestQuotes = (...args) => legacyClient().getLatestQuotes(...args);
export const getLatestTrades = (...args) => legacyClient().getLatestTrades(...args);
export const getBars = (...args) => legacyClient().getBars(...args);
