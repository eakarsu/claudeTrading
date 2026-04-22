/**
 * Earnings + economic event calendar.
 *
 * Two sources:
 *   1. Static seed (this file) — baseline for FOMC/CPI/NFP so the gate works
 *      even without an external provider. Developer updates these quarterly.
 *   2. DB-backed overrides (EventCalendar model) — add/remove via CRUD so the
 *      UI can layer in earnings dates without a redeploy.
 *
 * All date comparisons are done in UTC to avoid "skipped an event because of
 * a local-time offset" bugs. Callers pass wall-clock Date objects and we
 * match against YYYY-MM-DD keys.
 */

import { EventCalendar } from '../models/index.js';

// Seed: known US-market macro events (FOMC, CPI, NFP, PCE). Dates through
// the end of 2026 — refresh when the Fed publishes next year's calendar.
// Using UTC date keys since that's what Alpaca's clock returns.
//
// `timeUtc` narrows the blackout to the ±windowHours tick around that exact
// moment instead of the whole day. FOMC statements drop at 2:00 PM ET
// (18:00 UTC during DST, 19:00 UTC during EST). CPI/NFP are 8:30 AM ET
// (12:30/13:30 UTC) — we still block the day for those because the volatility
// aftershock typically lasts until open + 90 min.
const FOMC_WINDOW_HOURS = 2;
const STATIC_EVENTS = [
  // Q2 2026 FOMC meetings
  { date: '2026-04-29', kind: 'fomc', timeUtc: '18:00', windowHours: FOMC_WINDOW_HOURS, note: 'FOMC decision' },
  { date: '2026-06-17', kind: 'fomc', timeUtc: '18:00', windowHours: FOMC_WINDOW_HOURS, note: 'FOMC decision + SEP' },
  { date: '2026-07-29', kind: 'fomc', timeUtc: '18:00', windowHours: FOMC_WINDOW_HOURS, note: 'FOMC decision' },
  { date: '2026-09-16', kind: 'fomc', timeUtc: '18:00', windowHours: FOMC_WINDOW_HOURS, note: 'FOMC decision + SEP' },
  { date: '2026-10-28', kind: 'fomc', timeUtc: '18:00', windowHours: FOMC_WINDOW_HOURS, note: 'FOMC decision' },
  { date: '2026-12-16', kind: 'fomc', timeUtc: '19:00', windowHours: FOMC_WINDOW_HOURS, note: 'FOMC decision + SEP' },
  // Illustrative CPI / NFP pattern (second Wed / first Fri of month).
  // In production, replace with a proper BLS feed.
  { date: '2026-05-08', kind: 'nfp',   note: 'April jobs report' },
  { date: '2026-05-13', kind: 'cpi',   note: 'April CPI' },
  { date: '2026-06-05', kind: 'nfp',   note: 'May jobs report' },
  { date: '2026-06-10', kind: 'cpi',   note: 'May CPI' },
];

function toUtcKey(input) {
  const d = input instanceof Date ? input : new Date(input);
  return d.toISOString().slice(0, 10);
}

/** Merge static + DB events into a Map<YYYY-MM-DD, Event[]>. */
async function loadAll() {
  const map = new Map();
  for (const e of STATIC_EVENTS) {
    const list = map.get(e.date) || [];
    list.push({ ...e, source: 'static' });
    map.set(e.date, list);
  }
  try {
    const rows = await EventCalendar.findAll();
    for (const r of rows) {
      const list = map.get(r.date) || [];
      list.push({ id: r.id, date: r.date, kind: r.kind, symbol: r.symbol, note: r.note, source: 'db' });
      map.set(r.date, list);
    }
  } catch (_) { /* table may not exist yet — ignore */ }
  return map;
}

/**
 * Does the event's blackout window cover the caller's clock time?
 * When `timeUtc` + `windowHours` are set (e.g. FOMC), the blackout is a
 * ±windowHours window around that moment; otherwise it's whole-day.
 */
function eventCoversInstant(event, now) {
  if (!event.timeUtc || !event.windowHours) return true; // whole-day default
  const [hh, mm] = event.timeUtc.split(':').map(Number);
  const center = new Date(`${event.date}T00:00:00Z`);
  center.setUTCHours(hh, mm || 0, 0, 0);
  const halfMs = event.windowHours * 60 * 60 * 1000;
  const instant = now.getTime();
  return Math.abs(instant - center.getTime()) <= halfMs;
}

/**
 * Is today (or a specific date) a macro-event day for the given symbol?
 * Symbol-bound events (earnings) only match when symbol is supplied.
 * Time-windowed events (FOMC) only match when `date` is inside the window.
 */
export async function isBlackoutDay(date, { symbol = null, kinds = ['fomc', 'cpi', 'nfp', 'pce', 'earnings'] } = {}) {
  const when = date instanceof Date ? date : new Date(date);
  const key = toUtcKey(when);
  const map = await loadAll();
  const events = map.get(key) || [];
  const hit = events.find((e) =>
    kinds.includes(e.kind)
    && (!e.symbol || e.symbol === symbol)
    && eventCoversInstant(e, when),
  );
  return hit ? { blackout: true, event: hit } : { blackout: false };
}

/** Return all events in [start, end]. Used by the UI calendar view. */
export async function listEvents({ start, end, symbol = null } = {}) {
  const map = await loadAll();
  const startKey = start ? toUtcKey(start) : null;
  const endKey   = end   ? toUtcKey(end)   : null;
  const out = [];
  for (const [date, events] of map) {
    if (startKey && date < startKey) continue;
    if (endKey   && date > endKey) continue;
    for (const e of events) {
      if (symbol && e.symbol && e.symbol !== symbol) continue;
      out.push(e);
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/** Persist an earnings event (or any ad-hoc calendar entry). */
export async function addEvent({ date, kind, symbol, note }) {
  const row = await EventCalendar.create({
    date: toUtcKey(date), kind, symbol: symbol || null, note: note || null,
  });
  return row.toJSON();
}
