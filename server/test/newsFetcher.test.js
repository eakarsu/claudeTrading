import { describe, it, expect, beforeEach, vi } from 'vitest';

// Env controls the provider. Stub before import so the module reads it.
process.env.NEWS_PROVIDER = 'finnhub';
process.env.FINNHUB_API_KEY = 'test-key';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// findOrCreate simulates the (title, publishedAt) dedup — the same (title,
// day) pair returns the existing row; a new pair returns created=true.
const findOrCreate = vi.fn();
vi.mock('../models/index.js', () => ({
  MarketNews: { findOrCreate: (...args) => findOrCreate(...args) },
}));

const { fetchLatestNews } = await import('../services/newsFetcher.js');

function mockFinnhubResponse(entries) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => entries,
  });
}

describe('newsFetcher — finnhub', () => {
  beforeEach(() => {
    findOrCreate.mockReset();
  });

  it('inserts new rows and counts skipped duplicates', async () => {
    mockFinnhubResponse([
      { headline: 'A headline', url: 'https://example.com/a', datetime: 1700000000, summary: 's1', source: 'Reuters' },
      { headline: 'B headline', url: 'https://example.com/b', datetime: 1700000000, summary: 's2', source: 'Reuters' },
      { headline: 'A headline', url: 'https://example.com/a', datetime: 1700000000, summary: 's1', source: 'Reuters' }, // dup
    ]);

    // First two are "created", third is not (dup of first).
    findOrCreate
      .mockResolvedValueOnce([{}, true])
      .mockResolvedValueOnce([{}, true])
      .mockResolvedValueOnce([{}, false]);

    const out = await fetchLatestNews({ category: 'general', max: 10 });
    expect(out.provider).toBe('finnhub');
    expect(out.inserted).toBe(2);
    expect(out.skipped).toBe(1);
    expect(findOrCreate).toHaveBeenCalledTimes(3);
  });

  it('skips malformed entries (missing headline or url)', async () => {
    mockFinnhubResponse([
      { headline: '',           url: 'https://example.com/x', datetime: 1700000000 },
      { headline: 'Has title',  url: '',                      datetime: 1700000000 },
      { headline: 'Good one',   url: 'https://example.com/g', datetime: 1700000000 },
    ]);
    findOrCreate.mockResolvedValue([{}, true]);

    const out = await fetchLatestNews({ category: 'general', max: 10 });
    expect(out.inserted).toBe(1);
    expect(out.skipped).toBe(2);
    expect(findOrCreate).toHaveBeenCalledTimes(1);
  });

  it('returns no_api_key error when FINNHUB_API_KEY is unset', async () => {
    const prev = process.env.FINNHUB_API_KEY;
    delete process.env.FINNHUB_API_KEY;
    vi.resetModules();
    const { fetchLatestNews: fresh } = await import('../services/newsFetcher.js');
    const out = await fresh({ category: 'general' });
    expect(out.error).toBe('no_api_key');
    expect(out.provider).toBe('finnhub');
    expect(out.inserted).toBe(0);
    process.env.FINNHUB_API_KEY = prev;
  });
});
