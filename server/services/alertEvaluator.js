/**
 * Alert evaluator — periodically checks every active PriceAlert against the
 * latest trade price and fires a notification when the target is crossed.
 *
 * Design notes:
 *   - Polls every ALERT_POLL_INTERVAL_MS (default 30s). This is coarse enough
 *     to avoid burning the Alpaca quota and fine enough that a user sees a
 *     sub-minute notification.
 *   - Fetches ALL symbols in one getLatestTradePrices batch per tick, so N
 *     alerts costs one upstream request.
 *   - On trigger: status flips to "triggered", currentPrice is updated, and
 *     notifier.raw is fired (Slack + email). We never re-fire a triggered
 *     alert — the user must reset it to re-arm.
 *   - Also expires stale TradeSignals: anything marked "active" older than
 *     TRADE_SIGNAL_TTL_HOURS is flipped to "expired". Prevents the UI from
 *     showing week-old signals as live.
 */

import { Op } from 'sequelize';
import { PriceAlert, TradeSignal, ThemeAlert, Theme, ThemeConstituent } from '../models/index.js';
import { getLatestTradePrices } from './priceCache.js';
import { notifier } from './notifier.js';
import { createNotification } from './notifications.js';
import { logger } from '../logger.js';
import { setGauge, incCounter } from './metrics.js';

const POLL_INTERVAL_MS = Number.parseInt(process.env.ALERT_POLL_INTERVAL_MS || '30000', 10);
const TRADE_SIGNAL_TTL_HOURS = Number.parseInt(process.env.TRADE_SIGNAL_TTL_HOURS || '72', 10);

let timer = null;
let running = false; // mutex — a slow tick must not be re-entered

async function evaluateAlerts() {
  const active = await PriceAlert.findAll({
    where: { status: 'active' },
  }).catch((err) => {
    logger.warn({ err }, 'alertEvaluator: query failed');
    return [];
  });
  setGauge('price_alerts_active', active.length);
  if (!active.length) return;

  const symbols = [...new Set(active.map((a) => a.symbol))];
  let prices = {};
  try {
    prices = await getLatestTradePrices(symbols, { maxAgeMs: 10_000 });
  } catch (err) {
    logger.warn({ err }, 'alertEvaluator: price fetch failed');
    return;
  }

  for (const alert of active) {
    const entry = prices[alert.symbol];
    const price = entry?.p;
    if (price == null || !Number.isFinite(price)) continue;

    // Direction convention:
    //   'above' → fire when price >= targetPrice
    //   'below' → fire when price <= targetPrice
    const triggered = alert.direction === 'below'
      ? price <= alert.targetPrice
      : price >= alert.targetPrice;

    if (!triggered) {
      // Keep the displayed current price fresh even when not triggered — the
      // UI can show "45.02 vs target 50" without a separate polling loop.
      await alert.update({ currentPrice: price }).catch(() => {});
      continue;
    }

    await alert.update({ status: 'triggered', currentPrice: price }).catch(() => {});
    incCounter('price_alerts_triggered_total', { direction: alert.direction });

    const msg = `Price alert: ${alert.symbol} ${alert.direction} $${alert.targetPrice} — now $${price.toFixed(2)}`;
    // External fanout (Slack / Discord / email) — best-effort.
    notifier.raw(`🔔 ${msg}`).catch(() => {});
    // In-app feed — write a per-user notification so the sidebar bell updates.
    // Skip if alert has no owner (legacy NULL userId rows from pre-0002).
    if (alert.userId) {
      createNotification({
        userId: alert.userId,
        type: 'price-alert',
        title: `${alert.symbol} ${alert.direction} $${alert.targetPrice}`,
        body: `Current price $${price.toFixed(2)}. ${alert.notes || ''}`.trim(),
        link: '/price-alerts',
        externalFanout: false, // already fanned out above; don't double-send
      }).catch(() => {});
    }
  }
}

/**
 * Evaluate theme-basket alerts. Fires when:
 *   - kind='basket-change-pct': equal-weight basket moved ±threshold% vs the
 *     baseline stamped on create. If baseline was null (quote fetch failed
 *     at create-time), this tick stamps it and does not fire.
 *   - kind='any-member-above' / 'any-member-below': at least one member's
 *     price crosses threshold.
 * One upstream quote batch per tick across all themes referenced by active
 * alerts — cheap even with many alerts per theme.
 */
async function evaluateThemeAlerts() {
  const active = await ThemeAlert.findAll({ where: { status: 'active' } })
    .catch((err) => { logger.warn({ err }, 'themeAlertEvaluator: query failed'); return []; });
  setGauge('theme_alerts_active', active.length);
  if (!active.length) return;

  // Group alerts by theme so we load constituents once per theme.
  const byTheme = new Map(); // themeId -> ThemeAlert[]
  for (const a of active) {
    if (!byTheme.has(a.themeId)) byTheme.set(a.themeId, []);
    byTheme.get(a.themeId).push(a);
  }

  const themeIds = [...byTheme.keys()];
  const themes = await Theme.findAll({ where: { id: themeIds } });
  const themeById = new Map(themes.map((t) => [t.id, t]));
  const constituents = await ThemeConstituent.findAll({ where: { themeId: themeIds } });
  const csByTheme = new Map();
  for (const c of constituents) {
    if (!csByTheme.has(c.themeId)) csByTheme.set(c.themeId, []);
    csByTheme.get(c.themeId).push(c);
  }

  const allSymbols = [...new Set(constituents.map((c) => c.symbol))];
  let prices = {};
  try {
    prices = await getLatestTradePrices(allSymbols, { maxAgeMs: 10_000 });
  } catch (err) {
    logger.warn({ err }, 'themeAlertEvaluator: price fetch failed');
    return;
  }

  for (const [themeId, alerts] of byTheme) {
    const theme = themeById.get(themeId);
    const members = csByTheme.get(themeId) || [];
    if (!theme || !members.length) continue;

    const memberPrices = members
      .map((m) => prices[m.symbol]?.p)
      .filter((p) => typeof p === 'number' && Number.isFinite(p));
    if (!memberPrices.length) continue;
    const basketAvg = memberPrices.reduce((a, b) => a + b, 0) / memberPrices.length;

    for (const alert of alerts) {
      let triggered = false;
      let detail = '';

      if (alert.kind === 'basket-change-pct') {
        // Stamp the baseline if it was null at creation time; don't fire this tick.
        if (alert.baseline == null) {
          await alert.update({ baseline: basketAvg }).catch(() => {});
          continue;
        }
        const changePct = ((basketAvg - alert.baseline) / alert.baseline) * 100;
        if (Math.abs(changePct) >= Math.abs(alert.threshold)) {
          triggered = true;
          detail = `basket moved ${changePct.toFixed(2)}% (baseline $${alert.baseline.toFixed(2)} → $${basketAvg.toFixed(2)})`;
        }
      } else if (alert.kind === 'any-member-above') {
        const hit = members.find((m) => {
          const p = prices[m.symbol]?.p;
          return Number.isFinite(p) && p >= alert.threshold;
        });
        if (hit) { triggered = true; detail = `${hit.symbol} above $${alert.threshold} @ $${prices[hit.symbol].p.toFixed(2)}`; }
      } else if (alert.kind === 'any-member-below') {
        const hit = members.find((m) => {
          const p = prices[m.symbol]?.p;
          return Number.isFinite(p) && p <= alert.threshold;
        });
        if (hit) { triggered = true; detail = `${hit.symbol} below $${alert.threshold} @ $${prices[hit.symbol].p.toFixed(2)}`; }
      }

      if (!triggered) continue;

      await alert.update({ status: 'triggered' }).catch(() => {});
      incCounter('theme_alerts_triggered_total', { kind: alert.kind });
      const title = `Theme alert: ${theme.name} — ${alert.kind}`;
      const body = detail + (alert.notes ? ` • ${alert.notes}` : '');
      notifier.raw(`🔔 ${title} — ${body}`).catch(() => {});
      if (alert.userId) {
        createNotification({
          userId: alert.userId,
          type: 'price-alert',
          title,
          body,
          link: `/themes`,
          externalFanout: false,
        }).catch(() => {});
      }
    }
  }
}

async function expireStaleSignals() {
  const cutoff = new Date(Date.now() - TRADE_SIGNAL_TTL_HOURS * 60 * 60 * 1000);
  const [count] = await TradeSignal.update(
    { status: 'expired' },
    { where: { status: 'active', createdAt: { [Op.lt]: cutoff } } },
  ).catch(() => [0]);
  if (count > 0) {
    logger.info({ count, ttlHours: TRADE_SIGNAL_TTL_HOURS }, 'Expired stale trade signals');
    incCounter('trade_signals_expired_total', {}, count);
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await Promise.all([
      evaluateAlerts().catch((err) => logger.error({ err }, 'alertEvaluator tick error')),
      evaluateThemeAlerts().catch((err) => logger.error({ err }, 'themeAlertEvaluator tick error')),
      expireStaleSignals().catch((err) => logger.error({ err }, 'expireStaleSignals error')),
    ]);
  } finally {
    running = false;
  }
}

export function startAlertEvaluator() {
  if (timer) return;
  // Opt-out: ALERT_POLL_INTERVAL_MS=0 disables the evaluator entirely. Useful
  // when a developer is offline / behind a firewall that blocks Alpaca and
  // doesn't want the 30s ECONNRESET log spam.
  if (!Number.isFinite(POLL_INTERVAL_MS) || POLL_INTERVAL_MS <= 0) {
    logger.info('Alert evaluator disabled (ALERT_POLL_INTERVAL_MS=0)');
    return;
  }
  // Fire once on boot so the gauge/metric surface is non-empty immediately.
  tick().catch(() => {});
  timer = setInterval(() => tick().catch(() => {}), POLL_INTERVAL_MS);
  timer.unref?.();
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Alert evaluator started');
}

export function stopAlertEvaluator() {
  if (timer) { clearInterval(timer); timer = null; }
}
