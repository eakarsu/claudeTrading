/**
 * Redis-backed price cache.
 *
 * Drop-in supplement for the existing in-process priceCache.js. When Redis is
 * available, prices are stored there so multiple Node instances share state.
 * When Redis is unavailable (connection error / REDIS_URL not set), the module
 * logs a warning and falls back transparently to the in-process cache, keeping
 * the existing behaviour intact.
 *
 * Env vars:
 *   REDIS_URL  — connection string (default: redis://localhost:6379)
 *
 * Usage (from priceCache.js or anywhere):
 *   import { getCachedPrice, setCachedPrice } from './redisCache.js';
 *
 *   const price = await getCachedPrice('AAPL');          // null if missing/stale
 *   await setCachedPrice('AAPL', 182.50, 30);            // TTL in seconds
 */

import { logger } from '../logger.js';

// ─── Lazy Redis initialisation ────────────────────────────────────────────
// We import ioredis dynamically so the server still boots when Redis is not
// installed — the fallback path will be used instead.

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const KEY_PREFIX = 'price:';

// Singleton Redis client. null = not yet initialised. false = permanently
// unavailable (failed to connect; don't keep retrying noisily).
let redis = null;
let redisAvailable = null; // null=unknown, true=ok, false=failed

async function getRedis() {
  if (redisAvailable === false) return null;
  if (redis && redisAvailable === true) return redis;

  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(REDIS_URL, {
      // Don't hammer the server with reconnects if Redis isn't available.
      maxRetriesPerRequest: 1,
      // Emit an error event instead of throwing so we can handle it.
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    // Test the connection once.
    await client.connect();
    await client.ping();

    client.on('error', (err) => {
      logger.warn({ err: err.message }, 'redisCache: connection error — falling back to in-process cache');
      redisAvailable = false;
      redis = null;
    });

    redis = client;
    redisAvailable = true;
    logger.info({ url: REDIS_URL.replace(/:\/\/.*@/, '://***@') }, 'redisCache: connected');
    return client;
  } catch (err) {
    logger.warn(
      { err: err.message, url: REDIS_URL.replace(/:\/\/.*@/, '://***@') },
      'redisCache: could not connect — falling back to in-process cache',
    );
    redisAvailable = false;
    return null;
  }
}

// ─── In-process fallback (same shape as original priceCache Map) ──────────
// Keyed by symbol; each entry is { price, expiresAt }.
const localCache = new Map();

function localGet(symbol) {
  const entry = localCache.get(symbol);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    localCache.delete(symbol);
    return null;
  }
  return entry.price;
}

function localSet(symbol, price, ttlSeconds) {
  localCache.set(symbol, { price, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Get a cached price for a symbol.
 *
 * Returns the price (number) if found and not expired, or null if the cache
 * is empty / stale for this symbol.
 *
 * @param {string} symbol  Ticker, e.g. 'AAPL'
 * @returns {Promise<number|null>}
 */
export async function getCachedPrice(symbol) {
  const client = await getRedis();
  if (client) {
    try {
      const val = await client.get(`${KEY_PREFIX}${symbol}`);
      if (val === null) return null;
      const n = Number(val);
      return Number.isFinite(n) ? n : null;
    } catch (err) {
      logger.debug({ err: err.message, symbol }, 'redisCache: GET failed, using in-process fallback');
    }
  }
  return localGet(symbol);
}

/**
 * Store a price in the cache.
 *
 * @param {string} symbol      Ticker, e.g. 'AAPL'
 * @param {number} price       Latest trade price
 * @param {number} [ttl=30]    Time-to-live in seconds (default 30)
 * @returns {Promise<void>}
 */
export async function setCachedPrice(symbol, price, ttl = 30) {
  if (!Number.isFinite(price)) return;
  const client = await getRedis();
  if (client) {
    try {
      await client.set(`${KEY_PREFIX}${symbol}`, String(price), 'EX', ttl);
      return;
    } catch (err) {
      logger.debug({ err: err.message, symbol }, 'redisCache: SET failed, using in-process fallback');
    }
  }
  localSet(symbol, price, ttl);
}

/**
 * Bulk-get multiple prices. Returns a partial object — missing symbols are
 * omitted rather than included as null so callers can safely spread the result.
 *
 * @param {string[]} symbols
 * @returns {Promise<Record<string, number>>}
 */
export async function getCachedPrices(symbols) {
  if (!symbols.length) return {};
  const client = await getRedis();
  const result = {};

  if (client) {
    try {
      const keys = symbols.map((s) => `${KEY_PREFIX}${s}`);
      const vals = await client.mget(...keys);
      for (let i = 0; i < symbols.length; i++) {
        if (vals[i] == null) continue;
        const n = Number(vals[i]);
        if (Number.isFinite(n)) result[symbols[i]] = n;
      }
      return result;
    } catch (err) {
      logger.debug({ err: err.message }, 'redisCache: MGET failed, using in-process fallback');
    }
  }

  // In-process fallback
  for (const sym of symbols) {
    const p = localGet(sym);
    if (p !== null) result[sym] = p;
  }
  return result;
}

/**
 * Bulk-set prices from a { symbol: price } map.
 *
 * @param {Record<string, number>} priceMap
 * @param {number} [ttl=30]
 * @returns {Promise<void>}
 */
export async function setCachedPrices(priceMap, ttl = 30) {
  const entries = Object.entries(priceMap).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return;

  const client = await getRedis();
  if (client) {
    try {
      // Use a pipeline for efficiency
      const pipeline = client.pipeline();
      for (const [sym, price] of entries) {
        pipeline.set(`${KEY_PREFIX}${sym}`, String(price), 'EX', ttl);
      }
      await pipeline.exec();
      return;
    } catch (err) {
      logger.debug({ err: err.message }, 'redisCache: pipeline SET failed, using in-process fallback');
    }
  }

  for (const [sym, price] of entries) {
    localSet(sym, price, ttl);
  }
}

/**
 * Gracefully close the Redis connection (call during server shutdown).
 */
export async function closeRedis() {
  if (redis) {
    try {
      await redis.quit();
    } catch {
      // ignore errors during shutdown
    }
    redis = null;
    redisAvailable = null;
  }
}

export default { getCachedPrice, setCachedPrice, getCachedPrices, setCachedPrices, closeRedis };
