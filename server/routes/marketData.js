/**
 * Real-time-ish market data routes:
 *   - GET /api/market-data/hv-rank/:symbol → historical-vol + HV rank
 *   - GET /api/market-data/stream?symbols=AAPL,TSLA (SSE) → price ticks
 *
 * We use Server-Sent Events rather than WebSockets because:
 *   - SSE rides on standard HTTP, so the existing auth middleware + CORS + reverse
 *     proxy setup all work unchanged.
 *   - Ticks are server→client only; we don't need the bidirectional channel.
 *   - Reconnect handling is browser-native via EventSource.
 *
 * The stream reuses priceCache.getLatestTradePrices so we don't hammer the
 * upstream broker — every connected client shares the same cached response.
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { symbolSchema } from '../schemas.js';
import { z } from 'zod';
import { getHvRankForSymbol } from '../services/volatility.js';
import { getLatestTradePrices } from '../services/priceCache.js';
import * as alpaca from '../services/alpaca.js';
import { getIndexQuote, getIndexBars } from '../services/yahooFinance.js';
import { logger } from '../logger.js';

// Tiny TTL cache for /bars responses. The index strip on the dashboard will
// fan out 4 symbols on mount for every user — without this, each client hit
// ripples into an Alpaca data call. 60s is a good balance between freshness
// and rate-limit headroom for intraday 5Min bars.
const BARS_CACHE_TTL_MS = Number.parseInt(process.env.BARS_CACHE_TTL_MS || '60000', 10);
const barsCache = new Map(); // key -> { at, data }

const router = Router();

// Per-user SSE concurrency cap. A single user opening unlimited tabs (each
// with its own EventSource) would multiply polling load and could saturate
// the broker's rate limit. Default 4 streams/user; override via env.
const SSE_MAX_PER_USER = Number.parseInt(process.env.SSE_MAX_PER_USER || '4', 10);
const sseOpenCount = new Map(); // userId -> number of open streams

router.get(
  '/hv-rank/:symbol',
  validate({ params: z.object({ symbol: symbolSchema }) }),
  asyncHandler(async (req, res) => {
    res.json(await getHvRankForSymbol(req.params.symbol));
  }),
);

/**
 * GET /api/market-data/quotes?symbols=SPY,QQQ,DIA,IWM
 * One-shot REST snapshot of the latest trade for a small set of symbols.
 * Reuses priceCache so repeated calls across clients share a single upstream
 * request. Capped at 25 symbols to keep the cache key bounded.
 */
router.get('/quotes', asyncHandler(async (req, res) => {
  const raw = (req.query.symbols || '').toString();
  const symbols = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.]{1,6}$/.test(s))
    .slice(0, 25);
  if (!symbols.length) return res.status(400).json({ error: 'symbols query param required' });
  const quotes = await getLatestTradePrices(symbols, { maxAgeMs: 30_000 });
  // Normalize to { SYMBOL: { price, time } } — Alpaca's shape is { p, t }.
  const out = {};
  for (const s of symbols) {
    const q = quotes?.[s];
    if (q && Number.isFinite(q.p)) out[s] = { price: q.p, time: q.t || null };
    else out[s] = null;
  }
  res.json(out);
}));

/**
 * GET /api/market-data/indices
 *
 * Bundles quote + intraday bars for the major indices shown on the dashboard
 * strip. Alpaca can't serve indices (^GSPC, ^NDX, ^DJI, ^VIX, DX-Y.NYB are
 * non-tradeable), so this hits Yahoo Finance under the hood. Response:
 *   {
 *     SPX: { ticker, name, quote: { price, previousClose, time }, bars: [...] },
 *     ...
 *   }
 *
 * Cached at the service level so many dashboards polling this route cost a
 * single Yahoo round trip per cache window.
 */
const INDEX_LIST = [
  { ticker: 'SPX', name: 'S&P 500 Index' },
  { ticker: 'NDQ', name: 'US 100 Index' },
  { ticker: 'DJI', name: 'Dow Jones Industrial Average' },
  { ticker: 'VIX', name: 'Volatility S&P 500 Index' },
  { ticker: 'DXY', name: 'U.S. Dollar Currency Index' },
];
router.get('/indices', asyncHandler(async (_req, res) => {
  const entries = await Promise.all(
    INDEX_LIST.map(async ({ ticker, name }) => {
      const [quote, bars] = await Promise.all([
        getIndexQuote(ticker),
        // Daily candles, ~1 year back (≈252 trading days). Gives enough
        // context to see multi-month trend on the dashboard tile.
        getIndexBars(ticker, { interval: '1d', range: '1y' }),
      ]);
      return [ticker, { ticker, name, quote, bars }];
    }),
  );
  res.json(Object.fromEntries(entries));
}));

/**
 * GET /api/market-data/bars/:symbol?timeframe=5Min&limit=78
 *
 * Thin pass-through to Alpaca's historical bars, used by the dashboard index
 * strip for mini sparkline charts. Response shape:
 *   [{ time, open, high, low, close, volume }, ...]
 *
 * The timeframe whitelist below keeps the cache key bounded and matches what
 * Alpaca actually accepts; anything else gets rejected before we burn a
 * round-trip.
 */
const BARS_TIMEFRAMES = new Set(['1Min', '5Min', '15Min', '30Min', '1Hour', '1Day']);
router.get('/bars/:symbol',
  validate({ params: z.object({ symbol: symbolSchema }) }),
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol;
    const timeframe = BARS_TIMEFRAMES.has(req.query.timeframe) ? req.query.timeframe : '5Min';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 78, 5), 500);

    const key = `${symbol}|${timeframe}|${limit}`;
    const hit = barsCache.get(key);
    if (hit && Date.now() - hit.at < BARS_CACHE_TTL_MS) {
      return res.json(hit.data);
    }
    try {
      const bars = await alpaca.getBars(symbol, timeframe, limit);
      barsCache.set(key, { at: Date.now(), data: bars });
      res.json(bars);
    } catch (err) {
      logger.warn({ err, symbol, timeframe }, 'bars fetch failed');
      // Serve stale data on upstream failure if we have it — better to show a
      // slightly old chart than a broken one during a transient Alpaca hiccup.
      if (hit) return res.json(hit.data);
      res.status(502).json({ error: 'Upstream bars unavailable' });
    }
  }),
);

/**
 * SSE price stream. Caller opens `EventSource('/api/market-data/stream?symbols=AAPL,TSLA')`
 * and receives JSON messages:
 *   { type: 'tick', symbol, price, at }
 *   { type: 'error', error }
 *
 * The connection closes if symbols is missing or > 25 (to keep the cache
 * single-request-per-tick cheap).
 */
router.get('/stream', (req, res) => {
  const raw = (req.query.symbols || '').toString();
  const symbols = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.]{1,6}$/.test(s))
    .slice(0, 25);
  if (!symbols.length) {
    res.status(400).json({ error: 'symbols query param required' });
    return;
  }

  // Per-user concurrency cap. We reserve one slot up front so racing opens
  // can't both squeeze through the "at limit?" check.
  const userKey = req.userId ?? 'anon';
  const current = sseOpenCount.get(userKey) || 0;
  if (current >= SSE_MAX_PER_USER) {
    res.status(429).json({
      error: `Too many concurrent streams (limit ${SSE_MAX_PER_USER}). Close another tab and retry.`,
    });
    return;
  }
  sseOpenCount.set(userKey, current + 1);

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection:      'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx response buffering
  });
  res.write(': connected\n\n');

  let closed = false;
  const poll = async () => {
    if (closed) return;
    try {
      const prices = await getLatestTradePrices(symbols, { maxAgeMs: 2000 });
      for (const [symbol, price] of Object.entries(prices || {})) {
        res.write(`data: ${JSON.stringify({ type: 'tick', symbol, price, at: Date.now() })}\n\n`);
      }
    } catch (err) {
      logger.warn({ err }, 'SSE poll failed');
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    }
  };

  // First push immediately; subsequent every 3s. Tune via env if needed.
  poll();
  const intervalMs = parseInt(process.env.MARKET_STREAM_INTERVAL_MS || '3000', 10);
  const timer = setInterval(poll, intervalMs);
  // Keep-alive comment every 15s — some proxies drop idle connections.
  const keepAlive = setInterval(() => { if (!closed) res.write(': keep-alive\n\n'); }, 15_000);

  req.on('close', () => {
    closed = true;
    clearInterval(timer);
    clearInterval(keepAlive);
    const n = (sseOpenCount.get(userKey) || 1) - 1;
    if (n <= 0) sseOpenCount.delete(userKey);
    else sseOpenCount.set(userKey, n);
    res.end();
  });
});

export default router;
