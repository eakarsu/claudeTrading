/**
 * Options chain live data feed via Tradier sandbox API.
 *
 * Tradier's free sandbox provides realistic options chain data including
 * Greeks (delta, gamma, theta, vega, rho) at no cost. Production accounts
 * use the same endpoint at https://api.tradier.com.
 *
 * Env vars:
 *   TRADIER_TOKEN     — required, obtain at https://developer.tradier.com
 *   TRADIER_BASE_URL  — optional, defaults to sandbox endpoint
 */

import { OptionsChain } from '../models/index.js';
import { logger } from '../logger.js';
import { UpstreamError } from '../errors.js';

const TRADIER_BASE_URL = process.env.TRADIER_BASE_URL || 'https://sandbox.tradier.com';
const TRADIER_TOKEN = process.env.TRADIER_TOKEN;

function hasTradier() {
  return !!TRADIER_TOKEN && TRADIER_TOKEN !== 'your_tradier_token_here';
}

/**
 * Fetch the options chain for a symbol + expiration from Tradier.
 * Returns the raw normalised rows ready for DB upsert.
 *
 * @param {string} symbol      e.g. 'AAPL'
 * @param {string} expiration  ISO date string 'YYYY-MM-DD'
 * @returns {Promise<Array>}   Array of normalised option objects
 */
export async function fetchOptionsChain(symbol, expiration) {
  if (!hasTradier()) {
    throw new UpstreamError(
      'TRADIER_TOKEN not configured. Set it in your .env to enable live options data.',
      { code: 'TRADIER_NOT_CONFIGURED' },
    );
  }

  const url = new URL('/v1/markets/options/chains', TRADIER_BASE_URL);
  url.searchParams.set('symbol', symbol.toUpperCase());
  url.searchParams.set('expiration', expiration);
  url.searchParams.set('greeks', 'true');

  let response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${TRADIER_TOKEN}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    logger.error({ err, symbol, expiration }, 'optionsData: network error calling Tradier');
    throw new UpstreamError(`Tradier network error: ${err.message}`, { cause: err });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.warn({ status: response.status, body, symbol }, 'optionsData: Tradier returned error');
    throw new UpstreamError(`Tradier API error ${response.status}: ${body}`, { code: 'TRADIER_ERROR' });
  }

  const data = await response.json().catch(() => ({}));

  // Tradier wraps the option list under options.option (can be object if single row)
  const raw = data?.options?.option;
  if (!raw) {
    logger.info({ symbol, expiration }, 'optionsData: Tradier returned empty chain');
    return [];
  }

  const options = Array.isArray(raw) ? raw : [raw];

  // Normalise to match our OptionsChain model schema
  return options.map((o) => ({
    symbol: symbol.toUpperCase(),
    optionType: o.option_type, // 'call' | 'put'
    strike: Number(o.strike) || null,
    expiration: o.expiration_date || expiration,
    // Use mid of bid/ask as a reasonable premium estimate; fall back to last
    premium: o.ask != null && o.bid != null
      ? Math.round(((Number(o.ask) + Number(o.bid)) / 2) * 10000) / 10000
      : (Number(o.last) || null),
    iv: o.greeks?.smv_vol != null ? Number(o.greeks.smv_vol) : null,
    delta: o.greeks?.delta != null ? Number(o.greeks.delta) : null,
    openInterest: o.open_interest != null ? Number(o.open_interest) : null,
    // Extra Greeks stored in aiAnalysis as JSON so callers can surface them
    // without a schema migration.
    aiAnalysis: o.greeks
      ? JSON.stringify({
          gamma: o.greeks.gamma,
          theta: o.greeks.theta,
          vega: o.greeks.vega,
          rho: o.greeks.rho,
          bid: o.bid,
          ask: o.ask,
          volume: o.volume,
          last: o.last,
          description: o.description,
        })
      : null,
  }));
}

/**
 * Upsert options rows into the OptionsChain table.
 * Matches on (symbol, strike, expiration, optionType) — the natural key for
 * an options contract. userId is intentionally null for market-wide data so
 * all users see the same chain via the AI options-strategy endpoint.
 *
 * @param {Array}  rows    Normalised option objects from fetchOptionsChain()
 * @returns {{ upserted: number }}
 */
export async function upsertOptionsChain(rows) {
  if (!rows.length) return { upserted: 0 };

  let upserted = 0;
  for (const row of rows) {
    const where = {
      symbol: row.symbol,
      strike: row.strike,
      expiration: row.expiration,
      optionType: row.optionType,
    };
    const [record, created] = await OptionsChain.findOrCreate({
      where,
      defaults: { ...row, userId: null },
    });
    if (!created) {
      await record.update({
        premium: row.premium,
        iv: row.iv,
        delta: row.delta,
        openInterest: row.openInterest,
        aiAnalysis: row.aiAnalysis,
      });
    }
    upserted += 1;
  }
  return { upserted };
}

/**
 * Convenience: fetch + upsert in one call.
 * Returns { upserted, rows } so the HTTP handler can report counts.
 */
export async function syncOptionsChain(symbol, expiration) {
  const rows = await fetchOptionsChain(symbol, expiration);
  const result = await upsertOptionsChain(rows);
  logger.info({ symbol, expiration, ...result }, 'optionsData: sync complete');
  return { ...result, rows };
}
