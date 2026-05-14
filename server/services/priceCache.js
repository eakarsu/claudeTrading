import * as alpaca from './alpaca.js';
import { logger } from '../logger.js';
import { getCachedPrices, setCachedPrices } from './redisCache.js';

/**
 * Short-TTL cache for latest trade prices.
 *
 * Layer 1 — Redis (shared across Node instances, enabled when REDIS_URL is set).
 * Layer 2 — In-process Map (original behaviour, always active as fallback).
 *
 * Dedupes bursts of concurrent callers into a single upstream request.
 *
 * Default TTL is tuned for daily-ish polling (5s). Intraday callers (auto
 * trader on 1Min/5Min, live-signal polling) should pass a shorter maxAgeMs.
 *
 * Circuit breaker:
 *   After BREAKER_THRESHOLD consecutive upstream failures we "open" the
 *   circuit and stop hammering Alpaca for BREAKER_COOLDOWN_MS. Repeated
 *   failures also get demoted from `warn` to `debug` so a flaky network
 *   (ECONNRESET / DNS) doesn't spam the logs every 30s.
 */
const DEFAULT_TTL_MS = parseInt(process.env.PRICE_CACHE_TTL_MS || '5000', 10);
const BREAKER_THRESHOLD = parseInt(process.env.PRICE_CACHE_BREAKER_THRESHOLD || '3', 10);
const BREAKER_COOLDOWN_MS = parseInt(process.env.PRICE_CACHE_BREAKER_COOLDOWN_MS || '60000', 10);

// In-process fallback cache (original implementation)
let cache = { at: 0, data: new Map(), key: '' };
let inflight = null;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

export async function getLatestTradePrices(symbols, { maxAgeMs } = {}) {
  if (!symbols.length) return {};
  const key = [...symbols].sort().join(',');
  const now = Date.now();
  const ttl = maxAgeMs ?? DEFAULT_TTL_MS;

  // ── Layer 1: Redis check ──────────────────────────────────────────────
  // Try Redis first. If all requested symbols are cached there, return
  // immediately without touching the in-process cache or Alpaca.
  try {
    const redisPrices = await getCachedPrices(symbols);
    const hitCount = Object.keys(redisPrices).length;
    if (hitCount === symbols.length) {
      // Full hit — populate the local cache too so the circuit breaker logic
      // stays consistent, then return.
      cache = { at: Date.now(), data: new Map(Object.entries(redisPrices)), key };
      return redisPrices;
    }
    // Partial hit — use what we have as stale data but still fetch upstream
    // for the missing symbols. Fall through to the existing logic below.
  } catch {
    // Redis unavailable — proceed to in-process cache / Alpaca
  }

  // ── Layer 2: In-process cache ─────────────────────────────────────────
  if (cache.key === key && now - cache.at < ttl) {
    return Object.fromEntries(cache.data);
  }
  if (inflight && inflight.key === key) return inflight.promise;

  // Circuit open — skip the upstream call entirely. Serve stale if we have
  // it, otherwise return an empty map so callers can degrade gracefully.
  if (now < breakerOpenUntil) {
    if (cache.data.size) return Object.fromEntries(cache.data);
    return {};
  }

  const promise = (async () => {
    try {
      const trades = await alpaca.getLatestTrades(symbols);
      const entries = Object.entries(trades || {});
      cache = { at: Date.now(), data: new Map(entries), key };
      if (consecutiveFailures > 0) {
        logger.info({ after: consecutiveFailures }, 'priceCache: upstream recovered');
      }
      consecutiveFailures = 0;
      breakerOpenUntil = 0;

      // Populate Redis with fresh prices (TTL = maxAgeMs in seconds, min 5s)
      const ttlSec = Math.max(5, Math.round((maxAgeMs ?? DEFAULT_TTL_MS) / 1000));
      // Build a flat { symbol: price } map from the Alpaca trades response
      // (shape: { AAPL: { p: 182.50, ... }, ... })
      const priceMap = {};
      for (const [sym, trade] of entries) {
        if (trade?.p != null && Number.isFinite(Number(trade.p))) {
          priceMap[sym] = Number(trade.p);
        }
      }
      setCachedPrices(priceMap, ttlSec).catch(() => {}); // fire-and-forget

      return trades;
    } catch (err) {
      consecutiveFailures += 1;
      const openingBreaker =
        consecutiveFailures === BREAKER_THRESHOLD && breakerOpenUntil === 0;
      if (openingBreaker) {
        breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
        logger.warn(
          { err, consecutiveFailures, cooldownMs: BREAKER_COOLDOWN_MS },
          'priceCache: opening circuit breaker after repeated failures',
        );
      } else if (consecutiveFailures < BREAKER_THRESHOLD) {
        logger.warn({ err, consecutiveFailures }, 'priceCache: upstream failed, returning stale if present');
      } else {
        // Already past the threshold — demote to debug so logs stay quiet.
        logger.debug({ err, consecutiveFailures }, 'priceCache: upstream still failing (breaker open)');
      }
      if (cache.data.size) return Object.fromEntries(cache.data);
      throw err;
    } finally {
      inflight = null;
    }
  })();

  inflight = { key, promise };
  return promise;
}
