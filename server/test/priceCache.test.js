import { describe, it, expect, beforeEach, vi } from 'vitest';

// The priceCache module holds state (cache, consecutiveFailures,
// breakerOpenUntil) at module scope. We re-import it in each test via
// vi.resetModules so one test's breaker state doesn't leak into the next.

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Tighten config so tests finish fast.
process.env.PRICE_CACHE_TTL_MS = '1';
process.env.PRICE_CACHE_BREAKER_THRESHOLD = '3';
process.env.PRICE_CACHE_BREAKER_COOLDOWN_MS = '50';

async function loadModule(getLatestTradesImpl) {
  vi.resetModules();
  vi.doMock('../services/alpaca.js', () => ({ getLatestTrades: getLatestTradesImpl }));
  const mod = await import('../services/priceCache.js');
  return mod.getLatestTradePrices;
}

async function advanceBeyondTtl() {
  await new Promise((r) => setTimeout(r, 5));
}

describe('priceCache', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns upstream data on success', async () => {
    const spy = vi.fn().mockResolvedValue({ AAPL: { p: 190 } });
    const getLatestTradePrices = await loadModule(spy);
    const out = await getLatestTradePrices(['AAPL']);
    expect(out).toEqual({ AAPL: { p: 190 } });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent callers into one upstream request', async () => {
    const spy = vi.fn().mockResolvedValue({ AAPL: { p: 190 } });
    const getLatestTradePrices = await loadModule(spy);
    const [a, b, c] = await Promise.all([
      getLatestTradePrices(['AAPL']),
      getLatestTradePrices(['AAPL']),
      getLatestTradePrices(['AAPL']),
    ]);
    expect(a).toEqual({ AAPL: { p: 190 } });
    expect(b).toEqual({ AAPL: { p: 190 } });
    expect(c).toEqual({ AAPL: { p: 190 } });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('opens the breaker after 3 failures and stops hammering upstream', async () => {
    let callIdx = 0;
    const spy = vi.fn().mockImplementation(async () => {
      callIdx++;
      if (callIdx === 1) return { MSFT: { p: 410 } }; // seed cache
      throw new Error('read ECONNRESET');
    });
    const getLatestTradePrices = await loadModule(spy);

    // Prime the cache with a real value.
    await getLatestTradePrices(['MSFT']);
    await advanceBeyondTtl();

    // 3 failing ticks — breaker opens on the third.
    for (let i = 0; i < 3; i++) {
      const out = await getLatestTradePrices(['MSFT']);
      expect(out).toEqual({ MSFT: { p: 410 } }); // stale served
      await advanceBeyondTtl();
    }

    const callsBefore = spy.mock.calls.length;

    // 4th call — breaker is open, upstream must NOT be called.
    const out = await getLatestTradePrices(['MSFT']);
    expect(out).toEqual({ MSFT: { p: 410 } });
    expect(spy.mock.calls.length).toBe(callsBefore);
  });

  it('closes the breaker after cooldown when upstream recovers', async () => {
    let callIdx = 0;
    const spy = vi.fn().mockImplementation(async () => {
      callIdx++;
      // First 3 calls fail (open breaker). After cooldown we succeed.
      if (callIdx <= 3) throw new Error('read ECONNRESET');
      return { TSLA: { p: 250 } };
    });
    const getLatestTradePrices = await loadModule(spy);

    for (let i = 0; i < 3; i++) {
      await getLatestTradePrices(['TSLA']).catch(() => {});
      await advanceBeyondTtl();
    }

    await new Promise((r) => setTimeout(r, 80)); // past cooldown
    const out = await getLatestTradePrices(['TSLA']);
    expect(out).toEqual({ TSLA: { p: 250 } });
  });
});
