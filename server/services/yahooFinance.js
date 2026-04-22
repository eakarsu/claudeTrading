/**
 * Multi-source fetcher for major-index quotes + bars. Misleading filename —
 * this started as pure Yahoo but Yahoo now rate-limits unauthenticated calls
 * hard enough that it's unreliable as a primary. We now fan out per-index to
 * whichever free public source is most reliable for that ticker:
 *
 *   SPX / NDQ / DJI / DXY  → Stooq (real-time CSV)
 *   VIX                    → Cboe (public JSON)
 *   bars (for all charts)  → Yahoo best-effort, empty on rate-limit
 *
 * All fetches are cached aggressively — the dashboard polls every 60s and the
 * server hits upstream at most once per cache window regardless of client
 * fan-in.
 */
import { logger } from '../logger.js';
import * as alpaca from './alpaca.js';

const QUOTE_TTL_MS = Number.parseInt(process.env.INDEX_QUOTE_TTL_MS || '60000', 10);
const BARS_TTL_MS  = Number.parseInt(process.env.INDEX_BARS_TTL_MS  || '120000', 10);
const YAHOO_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const quoteCache = new Map(); // ticker -> { at, data }
const barsCache  = new Map(); // ticker|interval|range -> { at, data }

// ─── Source: Stooq ────────────────────────────────────────────────────────
// CSV format: Symbol,Date,Time,Open,High,Low,Close,Volume
// Stooq returns "N/D" for fields it doesn't have (e.g. VIX/DXY direct).
async function stooqQuote(stooqSymbol) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`stooq ${stooqSymbol}: HTTP ${res.status}`);
  const text = await res.text();
  const [, line] = text.trim().split('\n');
  if (!line) throw new Error('stooq: empty csv');
  const parts = line.split(',');
  const close = Number(parts[6]);
  const open = Number(parts[3]);
  if (!Number.isFinite(close)) throw new Error(`stooq ${stooqSymbol}: no close (${parts.join(',')})`);
  // Stooq gives no previous-close column, so use open as a fallback baseline
  // for session change. It's what Stooq shows on its own web UI.
  return {
    price: close,
    previousClose: Number.isFinite(open) ? open : null,
    time: parts[1] && parts[2] ? `${parts[1]}T${parts[2]}Z` : null,
  };
}

// ─── Source: Cboe ─────────────────────────────────────────────────────────
// JSON shape: { data: { current_price, price_change, close, ... } }
async function cboeQuote(cboeSymbol) {
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/quotes/${cboeSymbol}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cboe ${cboeSymbol}: HTTP ${res.status}`);
  const json = await res.json();
  const d = json?.data;
  if (!d || !Number.isFinite(Number(d.current_price))) throw new Error('cboe: bad payload');
  const price = Number(d.current_price);
  const change = Number(d.price_change);
  const previousClose = Number.isFinite(change) ? price - change : null;
  return {
    price,
    previousClose,
    time: json.timestamp ? new Date(json.timestamp.replace(' ', 'T') + 'Z').toISOString() : null,
  };
}

// ─── Source: Yahoo (bars only — quotes are too rate-limited) ──────────────
async function yahooBars(yahooSymbol, { interval = '5m', range = '1d' } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`
    + `?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': YAHOO_UA,
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://finance.yahoo.com/',
    },
  });
  if (!res.ok) throw new Error(`yahoo ${yahooSymbol}: HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`yahoo ${yahooSymbol}: ${json?.chart?.error?.description || 'no result'}`);
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const out = [];
  for (let i = 0; i < ts.length; i += 1) {
    const c = q.close?.[i];
    if (c == null) continue;
    out.push({
      time: ts[i],
      open:  Number(q.open?.[i]  ?? c),
      high:  Number(q.high?.[i]  ?? c),
      low:   Number(q.low?.[i]   ?? c),
      close: Number(c),
      volume: Number(q.volume?.[i] ?? 0),
    });
  }
  return out;
}

// ─── Per-ticker routing ───────────────────────────────────────────────────
// Map internal ticker → upstream source. `bars` is a Yahoo symbol only (bars
// from Stooq / Cboe free endpoints aren't available).
// `barsEtf` is an ETF proxy we use for CHART SHAPE only — we already have
// Alpaca working for stock bars, it never rate-limits, and the proxy's daily
// candles move proportionally to the underlying index (so the line's shape
// is identical even if absolute prices differ). The displayed price on the
// tile still comes from `quote`, which is the real index level.
const SOURCES = {
  SPX: { quote: () => stooqQuote('^spx'),   barsSymbol: '^GSPC',    barsEtf: 'SPY'  },
  NDQ: { quote: () => stooqQuote('^ndx'),   barsSymbol: '^NDX',     barsEtf: 'QQQ'  },
  DJI: { quote: () => stooqQuote('^dji'),   barsSymbol: '^DJI',     barsEtf: 'DIA'  },
  // Cboe publishes the authoritative VIX level; Stooq doesn't carry it.
  // VIXY tracks VIX futures — shape is close but not identical (contango
  // drift over long windows); good enough for a 3-month sparkline.
  VIX: { quote: () => cboeQuote('_VIX'),    barsSymbol: '^VIX',     barsEtf: 'VIXY' },
  // Stooq's dollar-index futures (DX.F) track the DXY index within pennies
  // and are free + real-time. UUP is the ETF proxy for chart shape.
  DXY: { quote: () => stooqQuote('dx.f'),   barsSymbol: 'DX-Y.NYB', barsEtf: 'UUP'  },
};

export async function getIndexQuote(ticker) {
  const src = SOURCES[ticker];
  if (!src) return null;
  const hit = quoteCache.get(ticker);
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) return hit.data;
  try {
    const data = await src.quote();
    quoteCache.set(ticker, { at: Date.now(), data });
    return data;
  } catch (err) {
    logger.warn({ err: err.message, ticker }, 'index quote failed');
    // Serve stale rather than blank the number on transient upstream errors.
    return hit ? hit.data : null;
  }
}

export async function getIndexBars(ticker, opts = {}) {
  const src = SOURCES[ticker];
  if (!src) return [];
  // Default to daily candles spanning ~3 months (≈63 bars). Much more useful
  // than a 5-min intraday sparkline for a dashboard at-a-glance view, and it
  // matches the mental model of "daily chart" that traders expect.
  const interval = opts.interval || '1d';
  const range    = opts.range    || '3mo';
  const key = `${ticker}|${interval}|${range}`;
  const hit = barsCache.get(key);
  if (hit && Date.now() - hit.at < BARS_TTL_MS) return hit.data;

  // Rough bar count for Alpaca. Alpaca's `getBars(sym, tf, limit)` uses
  // `limit` as BOTH the row cap AND the calendar-day lookback (via
  // `new Date(now - limit*day)`), so we have to size it to calendar days,
  // not trading days — a year = 365 calendar days ≈ 252 trading days.
  const limitByRange = { '1mo': 32, '3mo': 95, '6mo': 190, '1y': 365 };
  const alpacaLimit = limitByRange[range] || 95;
  const alpacaTf = interval === '1d' ? '1Day' : '5Min';

  // 1) Try Alpaca with the ETF proxy — this is the reliable path. Shape of
  //    SPY equals shape of SPX, etc., so the chart trend is faithful even
  //    though absolute prices differ. We then linearly scale each bar so
  //    values match the real index level (scale = realPrice / lastBarClose).
  //    Scaling is an approximation — it's exact for today's close and drifts
  //    for historical bars proportional to ETF tracking error + expense drag
  //    (a few % over a year for broad ETFs, more for VIXY/UUP). For a dash
  //    sparkline this is close enough that hovers read "approximately right".
  if (src.barsEtf) {
    try {
      const proxyBars = await alpaca.getBars(src.barsEtf, alpacaTf, alpacaLimit);
      if (proxyBars?.length) {
        const q = await getIndexQuote(ticker);
        const lastEtfClose = Number(proxyBars[proxyBars.length - 1]?.close);
        const scale = q && Number.isFinite(q.price) && Number.isFinite(lastEtfClose) && lastEtfClose > 0
          ? q.price / lastEtfClose
          : 1;
        const scaled = scale === 1
          ? proxyBars
          : proxyBars.map((b) => ({
              time: b.time,
              open:  b.open  * scale,
              high:  b.high  * scale,
              low:   b.low   * scale,
              close: b.close * scale,
              volume: b.volume,
            }));
        barsCache.set(key, { at: Date.now(), data: scaled });
        return scaled;
      }
    } catch (err) {
      logger.debug({ err: err.message, ticker, etf: src.barsEtf }, 'alpaca proxy bars failed, trying yahoo');
    }
  }

  // 2) Try Yahoo directly on the index symbol. Works when IP isn't throttled.
  try {
    const bars = await yahooBars(src.barsSymbol, { interval, range });
    if (bars.length) {
      barsCache.set(key, { at: Date.now(), data: bars });
      return bars;
    }
  } catch (err) {
    logger.warn({ err: err.message, ticker }, 'index bars: yahoo failed');
  }

  // 3) Serve stale cache if we have one, else a trivial 2-point synthesis
  //    from the quote so the tile is never completely blank.
  if (hit) return hit.data;
  try {
    const q = await getIndexQuote(ticker);
    if (q && Number.isFinite(q.price) && Number.isFinite(q.previousClose)) {
      const now = Math.floor(Date.now() / 1000);
      return [
        { time: now - 86400, open: q.previousClose, high: q.previousClose, low: q.previousClose, close: q.previousClose, volume: 0 },
        { time: now,         open: q.price,         high: q.price,         low: q.price,         close: q.price,         volume: 0 },
      ];
    }
  } catch { /* ignore */ }
  return [];
}
