/**
 * Earnings calendar fetcher.
 *
 * Populates EventCalendar rows with upcoming earnings dates. We support two
 * backends, picked by env:
 *
 *   1. EARNINGS_PROVIDER=finnhub  (+ FINNHUB_API_KEY)
 *      Uses finnhub.io/calendar/earnings — free tier is rate-limited but
 *      sufficient for a nightly sync.
 *   2. EARNINGS_PROVIDER=none (default)
 *      Noop — useful in CI and for installations that manage earnings dates
 *      manually via the /api/event-calendar UI.
 *
 * The fetcher is idempotent: for each (date, symbol) we upsert a row with
 * kind='earnings' so re-running doesn't create duplicates. Rows previously
 * added by the user (source='db', kind='earnings') are left alone if they
 * match the fetched date.
 *
 * We deliberately do NOT wire this into server boot — call
 * `fetchUpcomingEarnings()` from a cron entry, or expose it behind an admin
 * route if you want on-demand refresh. Pulling on every boot is too much
 * noise for a restart.
 */

import { EventCalendar } from '../models/index.js';
import { logger } from '../logger.js';

const PROVIDER = (process.env.EARNINGS_PROVIDER || 'none').toLowerCase();

/**
 * Fetch earnings for a rolling window [today, today+daysAhead].
 * Optionally restrict to a specific list of symbols — useful if you only
 * care about your watchlist and don't want the full S&P calendar.
 */
export async function fetchUpcomingEarnings({ daysAhead = 30, symbols = null } = {}) {
  const to   = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const from = new Date();
  switch (PROVIDER) {
    case 'finnhub': return fetchFromFinnhub({ from, to, symbols });
    case 'none':    return { inserted: 0, skipped: 0, provider: 'none' };
    default:
      logger.warn({ provider: PROVIDER }, 'Unknown EARNINGS_PROVIDER — noop');
      return { inserted: 0, skipped: 0, provider: PROVIDER };
  }
}

async function fetchFromFinnhub({ from, to, symbols }) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    logger.warn('EARNINGS_PROVIDER=finnhub but FINNHUB_API_KEY is not set');
    return { inserted: 0, skipped: 0, provider: 'finnhub', error: 'no_api_key' };
  }
  const iso = (d) => d.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${iso(from)}&to=${iso(to)}&token=${key}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Finnhub earnings fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  const entries = Array.isArray(body?.earningsCalendar) ? body.earningsCalendar : [];

  const wanted = symbols ? new Set(symbols.map((s) => s.toUpperCase())) : null;
  let inserted = 0;
  let skipped = 0;
  for (const e of entries) {
    if (!e?.symbol || !e?.date) { skipped++; continue; }
    if (wanted && !wanted.has(e.symbol.toUpperCase())) { skipped++; continue; }
    // findOrCreate keyed on (date, symbol, kind) — guarantees idempotency.
    const [, created] = await EventCalendar.findOrCreate({
      where:    { date: e.date, symbol: e.symbol.toUpperCase(), kind: 'earnings' },
      defaults: {
        date:    e.date,
        symbol:  e.symbol.toUpperCase(),
        kind:    'earnings',
        note:    noteFromEntry(e),
      },
    });
    if (created) inserted++; else skipped++;
  }
  logger.info({ inserted, skipped, provider: 'finnhub' }, 'Earnings sync complete');
  return { inserted, skipped, provider: 'finnhub' };
}

function noteFromEntry(e) {
  // Finnhub returns epsEstimate / revenueEstimate / hour ('bmo'/'amc'/'dmh').
  const hour = e.hour ? ` (${e.hour})` : '';
  const eps = e.epsEstimate != null ? ` eps≈${e.epsEstimate}` : '';
  return `Earnings${hour}${eps}`.trim();
}
