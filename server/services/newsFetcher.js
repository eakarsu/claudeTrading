/**
 * Market news fetcher.
 *
 * Populates MarketNews rows with real articles from a configured provider.
 * Mirrors the pattern used by earningsFetcher.js so the same operational
 * conventions apply (opt-in via env, idempotent upserts, nightly cron).
 *
 * Providers:
 *   1. NEWS_PROVIDER=finnhub (+ FINNHUB_API_KEY)
 *      https://finnhub.io/api/v1/news?category=general — free tier, real
 *      articles with canonical URLs, headline, summary, source.
 *   2. NEWS_PROVIDER=none (default)
 *      Noop. Seed data and user-authored rows are the only content.
 *
 * Idempotency: we keyed de-dup on (title, publishedAt) so re-running the
 * sync in the same day is cheap and won't explode the table.
 */

import { MarketNews } from '../models/index.js';
import { logger } from '../logger.js';

const PROVIDER = (process.env.NEWS_PROVIDER || 'none').toLowerCase();

/**
 * Fetch latest market news. `category` maps to Finnhub's
 * {general, forex, crypto, merger} channels. `symbol` switches to the
 * company-news endpoint, with a 7-day rolling window.
 */
export async function fetchLatestNews({ category = 'general', symbol = null, max = 25 } = {}) {
  switch (PROVIDER) {
    case 'finnhub': return fetchFromFinnhub({ category, symbol, max });
    case 'none':    return { inserted: 0, skipped: 0, provider: 'none' };
    default:
      logger.warn({ provider: PROVIDER }, 'Unknown NEWS_PROVIDER — noop');
      return { inserted: 0, skipped: 0, provider: PROVIDER };
  }
}

async function fetchFromFinnhub({ category, symbol, max }) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    logger.warn('NEWS_PROVIDER=finnhub but FINNHUB_API_KEY is not set');
    return { inserted: 0, skipped: 0, provider: 'finnhub', error: 'no_api_key' };
  }

  let url;
  if (symbol) {
    const to   = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${key}`;
  } else {
    url = `https://finnhub.io/api/v1/news?category=${encodeURIComponent(category)}&token=${key}`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Finnhub news fetch failed: ${res.status} ${res.statusText}`);
  }
  const entries = await res.json();
  if (!Array.isArray(entries)) {
    return { inserted: 0, skipped: 0, provider: 'finnhub', error: 'bad_response' };
  }

  let inserted = 0;
  let skipped = 0;
  for (const e of entries.slice(0, max)) {
    if (!e?.headline || !e?.url) { skipped++; continue; }
    const publishedAt = e.datetime
      ? new Date(e.datetime * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // findOrCreate keyed on (title, publishedAt) — two outlets running the
    // same wire story still de-dup by headline on the same day.
    const [, created] = await MarketNews.findOrCreate({
      where: { title: e.headline, publishedAt },
      defaults: {
        title:       e.headline,
        summary:     (e.summary || '').slice(0, 4000) || null,
        source:      e.source || 'Finnhub',
        symbol:      symbol || (e.related || '').split(',')[0] || null,
        sentiment:   'neutral',
        publishedAt,
        url:         e.url,
      },
    });
    if (created) inserted++; else skipped++;
  }
  logger.info({ inserted, skipped, provider: 'finnhub', symbol, category }, 'News sync complete');
  return { inserted, skipped, provider: 'finnhub' };
}
