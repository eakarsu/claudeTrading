/**
 * Auto Paper Trader — monitors live signals and places Alpaca paper orders.
 * State persists to Postgres so restarts don't lose in-progress runs.
 * Safety rails: idempotent orders (client_order_id), daily-loss kill switch,
 * consecutive-loss kill switch, max open positions, max position size.
 *
 * Multi-user: each user owns a distinct AutoTraderState row (unique userId)
 * and its own polling interval. Trade history is scoped by userId too.
 * Note: Alpaca positions/orders are shared at the broker-account level —
 * true per-user broker isolation would require per-user API keys. For paper
 * mode, sharing is acceptable; we just make sure local bookkeeping is clean.
 */

import crypto from 'node:crypto';
import * as alpaca from './alpaca.js';
import { getLatestTradePrices } from './priceCache.js';
import { runStrategy, STRATEGIES } from './strategyEngine.js';
import { computeAll } from './indicators.js';
import { AutoTraderState, AutoTraderTrade } from '../models/index.js';
import { BadRequestError } from '../errors.js';
import { logger } from '../logger.js';
import { Op } from 'sequelize';
import { notifier } from './notifier.js';
import { createNotification } from './notifications.js';
import { dispatch as dispatchWebhook } from './webhookDispatcher.js';
import { isBlackoutDay } from './eventCalendar.js';
import { kellyFractionForUser, correlationMultiplier } from './positionSizing.js';
import { checkProtections } from './protections.js';
import { getEdge, edgeMultiplier } from './edge.js';
import { sendTelegramMessage } from './telegramBot.js';

// Global mode flag — 'paper' is the default. Setting env ALPACA_LIVE_TRADING=true
// flips us to live, which the /start route must ALSO confirm explicitly.
export const TRADING_MODE =
  (process.env.ALPACA_LIVE_TRADING === 'true') ? 'live' : 'paper';

// Tighter cache for intraday ticks — older quotes lead to misfills.
const PRICE_CACHE_TTL_BY_TF = {
  '1Min': 2_000,
  '5Min': 5_000,
  '15Min': 10_000,
  '1H': 30_000,
  '1Day': 60_000,
};

const DEFAULT_CONFIG = {
  maxPositionSize: 5000,
  maxOpenPositions: 5,
  checkIntervalMs: 60000,
  stopLossPct: 0.03,
  takeProfitPct: 0.06,
  dailyLossLimit: 1000,       // kill switch if realized P&L this day < -$1000
  maxConsecutiveLosses: 3,    // kill switch after N consecutive losing sells
  // Exposure / drawdown guardrails — all `null` or `0` means disabled.
  // Evaluated each tick against live broker data (positions + account).
  // These protect against "auto-trader gone wild" scenarios where bugs or
  // strategy misbehavior pile on positions faster than the daily-loss
  // counter catches up.
  maxShortExposureDollars: null,  // sum of abs(market_value) for short positions
  maxTotalExposureDollars: null,  // sum of abs(market_value) across all positions
  stopOnDrawdownPct: null,        // stop if (equity / last_equity - 1) < -X (0.05 = -5%)
  maxShortPositions: null,        // hard cap on number of concurrent short positions
  timeframe: '1Day',
  riskPerTrade: null,         // if set, overrides maxPositionSize sizing
  useBracketOrders: true,     // protect entries with server-side stop/target
  // Session-time guards (minutes from session open/close)
  avoidFirstMin: 0,
  avoidLastMin: 0,
  flattenOnClose: false,
  flattenBeforeCloseMin: 5,
  // Extra kill switches
  maxDailyTrades: null,       // if set, stop opening new buys after N trades today
  // Trailing stop (placed server-side after entry fill)
  useTrailingStop: false,
  trailingStopPct: 0.02,
  // Regime gate — only take signals when ADX >= minAdx (trend strength)
  minAdx: null,
  // Per-symbol config overrides. Each key is a symbol; value is a partial config
  // (stopLossPct/takeProfitPct/riskPerTrade/maxPositionSize/minAdx etc.).
  // Merge order: DEFAULT_CONFIG ← state.config ← perSymbol[symbol].
  perSymbol: {},
  // Session scheduling — only trade inside this window. Null = session default.
  // Values are minutes since session open (0 = open, 390 = close for a normal day).
  tradeStartMin: null,
  tradeEndMin: null,
  // Blackout gates
  skipFomc: false,
  skipCpi: false,
  skipNfp: false,
  skipEarnings: false,
  skipDates: [],              // ['2026-05-15', ...] — hard-block specific days
  // Kelly sizing — when true, sizes buys at fractional-Kelly of maxPositionSize
  // using this user's historical win rate + payoff ratio. Falls back to the
  // risk-per-trade or notional path when history is too thin (< 20 trades).
  useKelly: false,
  kellyFraction: 0.25,         // fraction of full Kelly (0.25 = "quarter Kelly")
  // Correlation-aware sizing — reduces qty when the candidate symbol tracks
  // too closely with positions already open. Threshold is |ρ| on daily returns.
  useCorrelationAdjust: false,
  correlationThreshold: 0.7,
  // Mode confirmation. /start refuses a live run unless this === TRADING_MODE.
  modeAcknowledged: 'paper',
  // Dry run — when true, the bot runs the full strategy loop but never calls
  // alpaca.placeOrder. Lets the operator see what *would* happen without any
  // real (paper or live) fills. Notifications still fire so the feed shows
  // "(dry)" entries for validation.
  dryRun: false,
};

// Default poll interval per timeframe — caller can still override via config.
const TIMEFRAME_INTERVALS = {
  '1Min': 15_000,
  '5Min': 30_000,
  '15Min': 60_000,
  '1H': 120_000,
  '4H': 240_000,
  '1Day': 300_000,
};

function resolveCheckInterval(config) {
  if (config.checkIntervalMs) return config.checkIntervalMs;
  return TIMEFRAME_INTERVALS[config.timeframe] || 60_000;
}

// Per-user polling infrastructure. Each user gets their own interval and
// reentrancy mutex; a slow tick for one user does not block another user's tick.
// Keys are normalized userIds — we use `__anon__` for legacy rows with NULL userId
// so the map never contains undefined keys.
const ANON_KEY = '__anon__';
const timers = new Map();       // userKey -> interval handle
const tickRunning = new Map();  // userKey -> bool

function keyOf(userId) {
  return userId == null ? ANON_KEY : String(userId);
}

async function loadState(userId) {
  // userId may be null for legacy single-user rows. When a userId IS given we
  // bind the state to that user; findOrCreate with userId as the lookup means
  // each user gets their own row (enforced by the unique index on userId).
  const where = userId == null ? { userId: null } : { userId };
  const [state] = await AutoTraderState.findOrCreate({
    where,
    defaults: { userId: userId ?? null, running: false, config: DEFAULT_CONFIG },
  });
  return state;
}

// Kept for backward compatibility with a couple of callers.
export async function fetchBars(symbol, timeframe = '1Day', limit = 200) {
  try {
    return await alpaca.getBars(symbol, timeframe, limit);
  } catch (err) {
    logger.warn({ err, symbol }, 'fetchBars failed');
    return [];
  }
}

async function countTradesToday(userId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  try {
    return await AutoTraderTrade.count({
      where: { userId: userId ?? null, createdAt: { [Op.gte]: start } },
    });
  } catch {
    return 0;
  }
}

async function killSwitchTriggered(state) {
  if (state.dailyPnl <= -Math.abs(state.config.dailyLossLimit ?? DEFAULT_CONFIG.dailyLossLimit)) {
    return `Daily loss limit exceeded: $${state.dailyPnl.toFixed(2)}`;
  }
  if (state.consecutiveLosses >= (state.config.maxConsecutiveLosses ?? DEFAULT_CONFIG.maxConsecutiveLosses)) {
    return `Consecutive losses: ${state.consecutiveLosses}`;
  }
  return null;
}

/**
 * Live-exposure kill switch — evaluated AFTER positions/account are
 * fetched each tick, so we can react to book state that the state-machine
 * counters alone don't see (e.g. a strategy that opens dozens of shorts
 * faster than the dailyPnl updater can catch up).
 *
 * `account` is the Alpaca GET /v2/account response; `positions` the
 * GET /v2/positions array. Either can be null/empty — we treat missing
 * data as "can't evaluate", NOT "trip the switch". That keeps a transient
 * Alpaca outage from auto-stopping a trader whose guardrails are fine.
 */
export function exposureKillSwitch(cfg, account, positions) {
  if (!Array.isArray(positions)) return null;

  const shortPositions = positions.filter((p) => Number(p.qty) < 0);
  const shortExposure = shortPositions.reduce(
    (s, p) => s + Math.abs(Number(p.market_value) || 0),
    0,
  );
  const totalExposure = positions.reduce(
    (s, p) => s + Math.abs(Number(p.market_value) || 0),
    0,
  );

  if (cfg.maxShortExposureDollars && shortExposure > cfg.maxShortExposureDollars) {
    return `Short exposure $${shortExposure.toFixed(0)} exceeds cap $${cfg.maxShortExposureDollars}`;
  }
  if (cfg.maxTotalExposureDollars && totalExposure > cfg.maxTotalExposureDollars) {
    return `Total exposure $${totalExposure.toFixed(0)} exceeds cap $${cfg.maxTotalExposureDollars}`;
  }
  if (cfg.maxShortPositions != null && shortPositions.length > cfg.maxShortPositions) {
    return `Short positions (${shortPositions.length}) exceed cap ${cfg.maxShortPositions}`;
  }

  if (cfg.stopOnDrawdownPct && account?.equity && account?.last_equity) {
    const eq = Number(account.equity);
    const base = Number(account.last_equity);
    if (base > 0 && Number.isFinite(eq)) {
      const dd = eq / base - 1; // negative when down
      if (dd < -Math.abs(cfg.stopOnDrawdownPct)) {
        return `Drawdown ${(dd * 100).toFixed(2)}% exceeds ${(cfg.stopOnDrawdownPct * 100).toFixed(2)}% cap`;
      }
    }
  }

  return null;
}

/**
 * Fire the kill-switch side-effects once a reason has been decided.
 * Extracted because we now have two check points (pre-clock and post-
 * positions) and both need to do the same thing when triggered.
 */
async function fireKillSwitch(state, userId, reason) {
  logger.warn({ userId, reason }, 'Auto-trader kill switch triggered');
  await state.update({ running: false, killedReason: reason });
  const key = keyOf(userId);
  const t = timers.get(key);
  if (t) { clearInterval(t); timers.delete(key); }
  notifier.killSwitchTriggered({
    reason,
    dailyPnl: Math.round((state.dailyPnl || 0) * 100) / 100,
    consecutiveLosses: state.consecutiveLosses || 0,
  }).catch(() => {});
  if (userId) {
    createNotification({
      userId, type: 'security',
      title: 'Auto-trader kill switch triggered',
      body: `Reason: ${reason}. Daily P&L $${(state.dailyPnl || 0).toFixed(2)}.`,
      link: '/alpaca-trading',
      externalFanout: false,
    }).catch(() => {});
  }
}

/**
 * Returns minutes until session close, or null if clock data is missing.
 * Alpaca clock gives next_close as an ISO timestamp.
 */
function minutesUntilClose(clockData) {
  if (!clockData?.next_close) return null;
  const ms = new Date(clockData.next_close).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 60_000));
}
function minutesSinceOpen(clockData) {
  if (!clockData?.timestamp) return null;
  if (!clockData.next_close) return null;
  const closeMs = new Date(clockData.next_close).getTime();
  const openMs = closeMs - 6.5 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((Date.now() - openMs) / 60_000));
}

/**
 * Flatten every open position at market. Called when EOD close-out fires.
 * Cancels open orders first so bracket legs don't conflict with the market exit.
 * NOTE: At broker level this flattens ALL open positions on the shared paper
 * account — not just this user's entries. In a paper context that's acceptable
 * because concurrent multi-user live-trading on one account is not supported.
 */
async function flattenAll(state, positions, reason = 'EOD flatten') {
  try { await alpaca.cancelAllOrders(); } catch (err) { logger.warn({ err }, 'cancelAllOrders failed'); }
  for (const pos of positions) {
    try {
      const closed = await alpaca.closePosition(pos.symbol);
      const qty = Math.abs(Number.parseInt(pos.qty, 10)) || 0;
      const price = Number.parseFloat(pos.current_price);
      await AutoTraderTrade.create({
        userId: state.userId ?? null,
        symbol: pos.symbol,
        action: 'sell',
        qty,
        price: Number.isFinite(price) ? price : 0,
        pnl: Number.parseFloat(pos.unrealized_pl) || 0,
        reason,
        orderId: closed?.id || null,
        strategy: state.activeStrategy,
      }).catch((err) => logger.warn({ err, symbol: pos.symbol }, 'flattenAll: trade log failed'));

      if (state.userId) {
        dispatchWebhook(state.userId, 'order.flatten', {
          symbol: pos.symbol,
          qty,
          price: Number.isFinite(price) ? price : 0,
          pnl: Number.parseFloat(pos.unrealized_pl) || 0,
          reason,
          strategy: state.activeStrategy,
        });
      }
    } catch (err) {
      logger.warn({ err, symbol: pos.symbol }, 'flatten failed');
    }
  }
}

/**
 * For every open position without an active trailing_stop order, place one.
 * Lets the broker track the high-water mark and exit when price pulls back
 * by trailingStopPct.
 */
async function reconcileTrailingStops(cfg, positions) {
  if (!cfg.useTrailingStop) return;
  let openOrders = [];
  try {
    openOrders = await alpaca.getOrders('open', 100);
  } catch (err) {
    logger.warn({ err }, 'reconcileTrailingStops: getOrders failed');
    return;
  }
  const trailBySymbol = new Set(
    openOrders.filter((o) => o.type === 'trailing_stop').map((o) => o.symbol),
  );
  for (const pos of positions) {
    if (trailBySymbol.has(pos.symbol)) continue;
    const qty = Math.abs(Number.parseInt(pos.qty, 10)) || 0;
    if (qty <= 0) continue;
    const trailPct = (cfg.trailingStopPct || 0.02) * 100;
    try {
      await alpaca.placeTrailingStop({
        symbol: pos.symbol,
        qty,
        side: 'sell',
        trailPercent: trailPct,
        client_order_id: crypto.createHash('sha1')
          .update(`${pos.symbol}:trail:${new Date().toISOString().slice(0, 10)}`)
          .digest('hex').slice(0, 32),
      });
      logger.info({ symbol: pos.symbol, trailPct }, 'Placed trailing stop');
    } catch (err) {
      logger.warn({ err, symbol: pos.symbol }, 'placeTrailingStop failed');
    }
  }
}

/**
 * Reconcile bracket-order fills that happened broker-side (stop/target hit).
 * Scoped to this user's open buys — a sibling user's bracket fill must not
 * be recorded against this user's P&L counters.
 */
async function reconcileBracketFills(state, positions) {
  const userId = state.userId ?? null;
  const openSymbols = new Set(positions.map((p) => p.symbol));
  const openBuys = await AutoTraderTrade.findAll({
    where: { userId, action: 'buy' },
    order: [['createdAt', 'DESC']],
    limit: 50,
  }).catch((err) => {
    logger.warn({ err }, 'reconcileBracketFills: openBuys query failed');
    return [];
  });

  const candidates = openBuys.filter((b) => !openSymbols.has(b.symbol));
  if (!candidates.length) return;

  const candidateSymbols = [...new Set(candidates.map((b) => b.symbol))];
  const laterSells = await AutoTraderTrade.findAll({
    where: { userId, symbol: { [Op.in]: candidateSymbols }, action: 'sell' },
    order: [['createdAt', 'DESC']],
  }).catch((err) => {
    logger.warn({ err }, 'reconcileBracketFills: laterSells query failed');
    return [];
  });
  const lastSellBySymbol = new Map();
  for (const s of laterSells) {
    if (!lastSellBySymbol.has(s.symbol)) lastSellBySymbol.set(s.symbol, s);
  }

  let closedOrders = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      closedOrders = await alpaca.getOrders('closed', 100);
      break;
    } catch (err) {
      if (attempt === 1) {
        logger.warn({ err }, 'reconcileBracketFills: getOrders failed after retry');
        return;
      }
    }
  }
  if (!closedOrders) return;

  const fillsBySymbol = new Map();
  for (const o of closedOrders) {
    if (o.side !== 'sell' || o.status !== 'filled') continue;
    const list = fillsBySymbol.get(o.symbol) || [];
    list.push(o);
    fillsBySymbol.set(o.symbol, list);
  }

  for (const buy of candidates) {
    const laterSell = lastSellBySymbol.get(buy.symbol);
    if (laterSell && new Date(laterSell.createdAt) > new Date(buy.createdAt)) continue;

    const candidateFills = fillsBySymbol.get(buy.symbol) || [];
    const filledSell = candidateFills.find(
      (o) => !laterSell || new Date(o.filled_at) > new Date(laterSell.createdAt),
    );
    if (!filledSell) continue;

    const exitPrice = Number.parseFloat(filledSell.filled_avg_price);
    const qty = Math.abs(Number.parseInt(filledSell.filled_qty, 10)) || 0;
    if (!Number.isFinite(exitPrice) || qty <= 0) continue;
    const pnl = (exitPrice - buy.price) * qty;

    await AutoTraderTrade.create({
      userId,
      symbol: buy.symbol,
      action: 'sell',
      qty,
      price: exitPrice,
      pnl,
      reason: `Bracket fill (${filledSell.order_class || 'bracket'})`,
      orderId: filledSell.id,
      strategy: buy.strategy,
    }).catch((err) =>
      logger.warn({ err, symbol: buy.symbol }, 'reconcileBracketFills: trade log failed'),
    );

    if (userId) {
      // Bracket exit = stop or take-profit hit at the broker. Classify by sign
      // of P&L so webhook consumers can distinguish good vs bad exits.
      dispatchWebhook(userId, 'order.stopped', {
        symbol: buy.symbol, side: 'sell', qty, price: exitPrice, pnl,
        strategy: buy.strategy,
        orderId: filledSell.id,
        orderClass: filledSell.order_class || 'bracket',
      });
    }

    const dailyPnl = (state.dailyPnl || 0) + pnl;
    const consecutive = pnl < 0 ? (state.consecutiveLosses || 0) + 1 : 0;
    await state.update({ dailyPnl, consecutiveLosses: consecutive });
    logger.info({ userId, symbol: buy.symbol, pnl }, 'Reconciled bracket fill');
  }
}

async function tick(userId) {
  const key = keyOf(userId);
  // Per-user mutex — slow tick must not be re-entered by the interval timer.
  if (tickRunning.get(key)) {
    logger.debug({ userId }, 'tick() already running for user, skipping');
    return;
  }
  tickRunning.set(key, true);
  try {
    await tickInner(userId);
  } finally {
    tickRunning.set(key, false);
  }
}

async function tickInner(userId) {
  const state = await loadState(userId);
  if (!state.running || !state.activeStrategy || !state.symbols?.length) return;

  const reason = await killSwitchTriggered(state);
  if (reason) {
    await fireKillSwitch(state, userId, reason);
    return;
  }

  let clockData;
  try {
    clockData = await alpaca.getClock();
  } catch (err) {
    logger.warn({ err }, 'tick: getClock failed');
    return;
  }
  const cfg = { ...DEFAULT_CONFIG, ...state.config };

  if (!clockData?.is_open) {
    // Auto-shutdown at market close: clear this user's interval.
    const key = keyOf(userId);
    const t = timers.get(key);
    if (t) { clearInterval(t); timers.delete(key); }
    logger.info({ userId }, 'Market closed — auto-trader idle until next session');
    return;
  }

  let positions = [];
  try {
    positions = await alpaca.getPositions();
  } catch (err) {
    logger.warn({ err }, 'tick: getPositions failed');
    positions = [];
  }
  const positionSymbols = positions.map((p) => p.symbol);

  // Live exposure / drawdown guardrails. Runs every tick on fresh broker
  // data so a strategy that opens positions faster than dailyPnl updates
  // still hits the brakes. Account fetch is best-effort — drawdown check
  // is skipped if unavailable, but exposure caps still apply.
  let account = null;
  try { account = await alpaca.getAccount(); } catch (_) { /* degrade, don't trip */ }
  const exposureReason = exposureKillSwitch(cfg, account, positions);
  if (exposureReason) {
    await fireKillSwitch(state, userId, exposureReason);
    return;
  }

  if (cfg.useBracketOrders !== false) {
    await reconcileBracketFills(state, positions).catch((err) =>
      logger.warn({ err }, 'Bracket reconcile error'),
    );
  }

  const minsToClose = minutesUntilClose(clockData);
  if (cfg.flattenOnClose && minsToClose != null && minsToClose <= (cfg.flattenBeforeCloseMin || 5)) {
    if (positions.length) {
      logger.info({ userId, minsToClose, count: positions.length }, 'EOD flatten triggered');
      await flattenAll(state, positions, `EOD flatten (${minsToClose}m to close)`);
    }
    return;
  }

  const minsSinceOpen = minutesSinceOpen(clockData);
  const inAvoidOpen = cfg.avoidFirstMin > 0 && minsSinceOpen != null && minsSinceOpen < cfg.avoidFirstMin;
  const inAvoidClose = cfg.avoidLastMin > 0 && minsToClose != null && minsToClose < cfg.avoidLastMin;

  const outsideSchedule = (() => {
    if (minsSinceOpen == null) return false;
    if (cfg.tradeStartMin != null && minsSinceOpen < cfg.tradeStartMin) return true;
    if (cfg.tradeEndMin   != null && minsSinceOpen > cfg.tradeEndMin)   return true;
    return false;
  })();

  const today = new Date().toISOString().slice(0, 10);
  const inSkipDate = Array.isArray(cfg.skipDates) && cfg.skipDates.includes(today);

  await reconcileTrailingStops(cfg, positions).catch((err) =>
    logger.warn({ err }, 'Trailing stop reconcile error'),
  );

  const tradesToday = cfg.maxDailyTrades ? await countTradesToday(userId) : 0;
  const dailyCapReached = cfg.maxDailyTrades && tradesToday >= cfg.maxDailyTrades;

  const timeframe = cfg.timeframe || '1Day';
  for (const symbol of state.symbols) {
    try {
      const scfg = { ...cfg, ...(cfg.perSymbol?.[symbol] || {}) };

      const blackoutKinds = [
        scfg.skipFomc && 'fomc',
        scfg.skipCpi  && 'cpi',
        scfg.skipNfp  && 'nfp',
        scfg.skipEarnings && 'earnings',
      ].filter(Boolean);
      if (blackoutKinds.length) {
        const check = await isBlackoutDay(new Date(), { symbol, kinds: blackoutKinds });
        if (check.blackout) {
          logger.info({ userId, symbol, event: check.event }, 'Skipping — blackout day');
          continue;
        }
      }

      const bars = await alpaca.getBars(symbol, timeframe, 200);
      if (bars.length < 50) continue;

      const signals = runStrategy(state.activeStrategy, bars);
      if (!signals.length) continue;

      const lastSignal = signals[signals.length - 1];
      const lastBar = bars[bars.length - 1];
      if (lastSignal.time !== lastBar.time) {
        if (signals.length < 2 || lastSignal.time !== bars[bars.length - 2].time) continue;
      }

      const hasPosition = positionSymbols.includes(symbol);

      let indicatorSnapshot = null;
      if (lastSignal.action === 'buy') {
        const ind = computeAll(bars);
        const n = bars.length - 1;
        indicatorSnapshot = {
          rsi: ind.rsi?.[n],
          adx: ind.adx?.[n],
          sma20: ind.sma20?.[n],
          sma50: ind.sma50?.[n],
          sma200: ind.sma200?.[n],
          macd: ind.macd?.[n],
          close: bars[n].close,
        };
      }

      if (lastSignal.action === 'buy' && scfg.minAdx) {
        const adxNow = indicatorSnapshot?.adx;
        if (adxNow == null || adxNow < scfg.minAdx) continue;
      }

      if (lastSignal.action === 'buy' && !hasPosition) {
        if (positions.length >= scfg.maxOpenPositions) continue;
        if (inAvoidOpen || inAvoidClose) continue;
        if (outsideSchedule || inSkipDate) continue;
        if (dailyCapReached) continue;

        // Protections gate — evaluates stoplossGuard / cooldown / maxDrawdown /
        // lowProfitPairs against recent closed trades. Any failing check blocks
        // the entry; we log the reason for diagnostics.
        if (scfg.protections) {
          const prot = await checkProtections({ userId, symbol, config: scfg }).catch((err) => {
            logger.warn({ err, userId, symbol }, 'protections check failed');
            return { allowed: true };
          });
          if (!prot.allowed) {
            logger.info({ userId, symbol, protection: prot.protection, reason: prot.reason }, 'Skipping — protection blocked entry');
            continue;
          }
        }

        const cacheTtl = PRICE_CACHE_TTL_BY_TF[timeframe] ?? 5_000;
        const latest = await getLatestTradePrices([symbol], { maxAgeMs: cacheTtl }).catch(() => ({}));
        const price = latest?.[symbol]?.p ?? lastBar.close;

        const stopPct = scfg.stopLossPct ?? DEFAULT_CONFIG.stopLossPct;
        const targetPct = scfg.takeProfitPct ?? DEFAULT_CONFIG.takeProfitPct;
        const stopPrice = +(price * (1 - stopPct)).toFixed(2);
        const targetPrice = +(price * (1 + targetPct)).toFixed(2);

        let qty;
        if (scfg.useKelly) {
          // Kelly sizing: allocate kellyFraction * f* of maxPositionSize.
          // Falls through to the risk/notional path if history is too thin.
          const frac = await kellyFractionForUser(userId, {
            kellyFraction: scfg.kellyFraction ?? DEFAULT_CONFIG.kellyFraction,
          }).catch(() => null);
          if (frac != null && frac > 0) {
            const notional = scfg.maxPositionSize * frac;
            qty = Math.max(1, Math.floor(notional / price));
          }
        }
        if (qty == null) {
          if (scfg.riskPerTrade && price > stopPrice) {
            qty = Math.max(1, Math.floor(scfg.riskPerTrade / (price - stopPrice)));
            const maxByNotional = Math.max(1, Math.floor(scfg.maxPositionSize / price));
            qty = Math.min(qty, maxByNotional);
          } else {
            qty = Math.max(1, Math.floor(scfg.maxPositionSize / price));
          }
        }

        // Edge-based sizing — multiplier ∈ [0, 1] derived from recent win-rate
        // and expectancy on this symbol. 0 = skip (negative edge), 1 = full
        // size, values between linearly scale down. Gated by scfg.useEdge so
        // it only fires for users who opt in.
        if (scfg.useEdge) {
          const edge = await getEdge(userId, symbol, {
            lookbackDays: scfg.edgeLookbackDays,
            minTrades: scfg.edgeMinTrades,
          }).catch(() => null);
          const mult = edgeMultiplier(edge, { floor: scfg.edgeFloor ?? 0.5 });
          if (mult === 0) {
            logger.info({ userId, symbol, edge }, 'Skipping — negative edge');
            continue;
          }
          if (mult < 1) qty = Math.max(1, Math.floor(qty * mult));
        }

        // Correlation-aware scale-down — one broker hit per existing position.
        if (scfg.useCorrelationAdjust && positions.length) {
          const mult = await correlationMultiplier(symbol, positions, {
            timeframe,
            threshold: scfg.correlationThreshold ?? DEFAULT_CONFIG.correlationThreshold,
          }).catch(() => 1);
          if (mult === 0) {
            logger.info({ userId, symbol }, 'Skipping — too correlated with open positions');
            continue;
          }
          qty = Math.max(1, Math.floor(qty * mult));
        }

        // Idempotency key includes userId so two users on the same symbol/bar
        // don't collide on client_order_id.
        const clientOrderId = crypto
          .createHash('sha1')
          .update(`${userId ?? 'anon'}:${symbol}:${lastSignal.time}:buy:${state.activeStrategy}`)
          .digest('hex')
          .slice(0, 32);

        const useBracket = scfg.useBracketOrders !== false;
        const orderParams = useBracket
          ? {
              symbol, qty, side: 'buy', type: 'market',
              time_in_force: 'gtc',
              order_class: 'bracket',
              take_profit: { limit_price: targetPrice },
              stop_loss: { stop_price: stopPrice },
              client_order_id: clientOrderId,
            }
          : {
              symbol, qty, side: 'buy', type: 'market', time_in_force: 'day',
              client_order_id: clientOrderId,
            };

        // Dry-run: synthesize a fake order so the trade journal + notifier show
        // what *would* have fired, but never contact Alpaca. orderId is prefixed
        // with "dry-" so downstream consumers can filter these out.
        const dryRun = !!scfg.dryRun;
        let order;
        if (dryRun) {
          order = { id: `dry-${clientOrderId}` };
        } else {
          try {
            order = await alpaca.placeOrder(orderParams);
          } catch (err) {
            logger.warn({ err, userId, symbol, useBracket }, 'Auto-trader buy order failed');
            continue;
          }
        }

        await AutoTraderTrade.create({
          userId: userId ?? null,
          symbol, action: 'buy', qty, price,
          reason: (useBracket
            ? `${lastSignal.reason} | bracket: stop $${stopPrice}, target $${targetPrice}`
            : lastSignal.reason) + (dryRun ? ' | DRY RUN' : ''),
          orderId: order.id, strategy: state.activeStrategy,
          entryContext: indicatorSnapshot,
        }).catch((err) => {
          if (err?.name === 'SequelizeUniqueConstraintError') {
            logger.debug({ userId, symbol, orderId: order.id }, 'Buy trade log: duplicate suppressed');
          } else {
            logger.warn({ err, userId, symbol, orderId: order.id }, 'Buy trade log failed');
          }
        });
        notifier.orderFilled({
          symbol, side: 'buy', qty, price,
          strategy: state.activeStrategy,
          orderClass: useBracket ? 'bracket' : 'market',
        }).catch(() => {});
        if (userId) {
          dispatchWebhook(userId, 'order.filled', {
            symbol, side: 'buy', qty, price,
            strategy: state.activeStrategy,
            orderClass: useBracket ? 'bracket' : 'market',
            orderId: order.id,
            dryRun,
            reason: lastSignal.reason,
          });
          sendTelegramMessage(userId, `${dryRun ? '🧪 [DRY] ' : '🟢 '}*BUY* \`${symbol}\` ${qty}@$${price}`).catch(() => {});
        }
        if (userId) {
          createNotification({
            userId, type: 'auto-trader',
            title: `${dryRun ? '[DRY] ' : ''}BUY ${qty} ${symbol} @ $${price}`,
            body: `${state.activeStrategy} — ${useBracket ? 'bracket' : 'market'}`,
            link: '/auto-trader',
            externalFanout: false, // notifier.orderFilled already fanned out
          }).catch(() => {});
        }
      } else if (lastSignal.action === 'sell' && hasPosition) {
        const pos = positions.find((p) => p.symbol === symbol);
        if (!pos) continue;
        const qty = Math.abs(Number.parseInt(pos.qty, 10)) || 0;
        const price = Number.parseFloat(pos.current_price);
        const pnl = Number.parseFloat(pos.unrealized_pl) || 0;
        if (qty <= 0 || !Number.isFinite(price)) {
          logger.warn({ userId, symbol, pos }, 'sell skipped: invalid position data');
          continue;
        }

        const clientOrderId = crypto
          .createHash('sha1')
          .update(`${userId ?? 'anon'}:${symbol}:${lastSignal.time}:sell:${state.activeStrategy}`)
          .digest('hex')
          .slice(0, 32);

        const dryRunSell = !!scfg.dryRun;
        let order;
        if (dryRunSell) {
          order = { id: `dry-${clientOrderId}` };
        } else {
          try {
            order = await alpaca.placeOrder({
              symbol, qty, side: 'sell', type: 'market', time_in_force: 'day',
              client_order_id: clientOrderId,
            });
          } catch (err) {
            logger.warn({ err, userId, symbol }, 'Auto-trader sell order failed');
            continue;
          }
        }

        await AutoTraderTrade.create({
          userId: userId ?? null,
          symbol, action: 'sell', qty, price, pnl,
          reason: lastSignal.reason + (dryRunSell ? ' | DRY RUN' : ''),
          orderId: order.id, strategy: state.activeStrategy,
        }).catch((err) => {
          if (err?.name === 'SequelizeUniqueConstraintError') {
            logger.debug({ userId, symbol, orderId: order.id }, 'Sell trade log: duplicate suppressed');
          } else {
            logger.warn({ err, userId, symbol, orderId: order.id }, 'Sell trade log failed');
          }
        });
        notifier.orderFilled({
          symbol, side: 'sell', qty, price,
          strategy: state.activeStrategy,
        }).catch(() => {});
        if (userId) {
          dispatchWebhook(userId, 'order.filled', {
            symbol, side: 'sell', qty, price, pnl,
            strategy: state.activeStrategy,
            orderId: order.id,
            dryRun: dryRunSell,
            reason: lastSignal.reason,
          });
          const sign = (pnl ?? 0) >= 0 ? '+' : '';
          sendTelegramMessage(userId, `${dryRunSell ? '🧪 [DRY] ' : '🔴 '}*SELL* \`${symbol}\` ${qty}@$${price} (${sign}$${Number(pnl ?? 0).toFixed(2)})`).catch(() => {});
        }
        if (userId) {
          createNotification({
            userId, type: 'auto-trader',
            title: `${dryRunSell ? '[DRY] ' : ''}SELL ${qty} ${symbol} @ $${price}`,
            body: `${state.activeStrategy} — P&L $${pnl.toFixed(2)}`,
            link: '/auto-trader',
            externalFanout: false,
          }).catch(() => {});
        }

        // Dry-run sells are simulated and must not trip the kill-switches
        // (dailyPnl / consecutiveLosses) that halt the live strategy.
        if (!dryRunSell) {
          const dailyPnl = (state.dailyPnl || 0) + pnl;
          const consecutive = pnl < 0 ? (state.consecutiveLosses || 0) + 1 : 0;
          await state.update({ dailyPnl, consecutiveLosses: consecutive });
        }
      }
    } catch (err) {
      logger.error({ err, userId, symbol }, 'Auto-trader tick error');
    }
  }
}

// ── Public API ──

export async function startAutoTrader(userId, strategyKey, symbols, config = {}) {
  if (!STRATEGIES[strategyKey]) throw new BadRequestError(`Unknown strategy: ${strategyKey}`);

  const state = await loadState(userId);
  const mergedConfig = { ...DEFAULT_CONFIG, ...state.config, ...config };

  if (TRADING_MODE === 'live' && mergedConfig.modeAcknowledged !== 'live') {
    throw new BadRequestError(
      'Server is in LIVE trading mode. Re-send config.modeAcknowledged=\'live\' to confirm.',
    );
  }
  if (TRADING_MODE === 'paper' && mergedConfig.modeAcknowledged === 'live') {
    throw new BadRequestError('Server is paper-only. Set ALPACA_LIVE_TRADING=true to enable live.');
  }
  await state.update({
    running: true,
    activeStrategy: strategyKey,
    symbols,
    config: mergedConfig,
    startedAt: new Date(),
    consecutiveLosses: 0,
    dailyPnl: 0,
    killedReason: null,
  });

  const key = keyOf(userId);
  const prev = timers.get(key);
  if (prev) clearInterval(prev);

  try {
    await tick(userId);
  } catch (err) {
    logger.error({ err, userId, strategyKey, symbols }, 'Initial tick failed during startAutoTrader');
    throw err;
  }
  const pollMs = resolveCheckInterval(mergedConfig);
  const handle = setInterval(() => {
    tick(userId).catch((err) => logger.error({ err, userId }, 'Scheduled tick failed'));
  }, pollMs);
  timers.set(key, handle);

  notifier.started({ strategy: strategyKey, symbols, mode: TRADING_MODE }).catch(() => {});
  if (userId) {
    dispatchWebhook(userId, 'auto-trader.started', {
      strategy: strategyKey,
      strategyName: STRATEGIES[strategyKey].name,
      symbols,
      mode: TRADING_MODE,
      timeframe: mergedConfig.timeframe,
    });
  }
  return {
    status: 'started',
    mode: TRADING_MODE,
    strategy: STRATEGIES[strategyKey].name,
    symbols,
    timeframe: mergedConfig.timeframe,
    pollMs,
  };
}

export async function stopAutoTrader(userId, reason = 'manual') {
  const key = keyOf(userId);
  const t = timers.get(key);
  if (t) { clearInterval(t); timers.delete(key); }
  const state = await loadState(userId);
  await state.update({ running: false });
  notifier.stopped({ reason }).catch(() => {});
  if (userId) {
    dispatchWebhook(userId, 'auto-trader.stopped', { reason });
  }
  return { status: 'stopped' };
}

export async function getAutoTraderStatus(userId) {
  const state = await loadState(userId);
  const scopedUserId = userId ?? null;

  const trades = await AutoTraderTrade.findAll({
    where: { userId: scopedUserId },
    order: [['createdAt', 'DESC']],
    limit: 50,
  });

  const sells = await AutoTraderTrade.findAll({
    where: { userId: scopedUserId, action: 'sell' },
    attributes: ['pnl', 'symbol', 'createdAt'],
  }).catch(() => []);

  const realizedPnl = sells.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
  const wins = sells.filter((t) => (parseFloat(t.pnl) || 0) > 0);
  const losses = sells.filter((t) => (parseFloat(t.pnl) || 0) <= 0);
  const winRate = sells.length ? (wins.length / sells.length) * 100 : 0;
  const bestTrade = sells.length
    ? sells.reduce((a, b) => ((parseFloat(a.pnl) || 0) > (parseFloat(b.pnl) || 0) ? a : b))
    : null;
  const worstTrade = sells.length
    ? sells.reduce((a, b) => ((parseFloat(a.pnl) || 0) < (parseFloat(b.pnl) || 0) ? a : b))
    : null;

  const bySymbol = {};
  for (const t of sells) {
    const pnl = parseFloat(t.pnl) || 0;
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { symbol: t.symbol, trades: 0, pnl: 0, wins: 0 };
    bySymbol[t.symbol].trades++;
    bySymbol[t.symbol].pnl += pnl;
    if (pnl > 0) bySymbol[t.symbol].wins++;
  }
  const perSymbol = Object.values(bySymbol)
    .map((s) => ({ ...s, pnl: Math.round(s.pnl * 100) / 100, winRate: Math.round((s.wins / s.trades) * 10000) / 100 }))
    .sort((a, b) => b.pnl - a.pnl);

  let unrealizedPnl = 0;
  let positionsCount = 0;
  try {
    const positions = await alpaca.getPositions();
    positionsCount = positions.length;
    unrealizedPnl = positions.reduce((s, p) => s + (parseFloat(p.unrealized_pl) || 0), 0);
  } catch (_) { /* account not configured */ }

  return {
    running: state.running,
    mode: TRADING_MODE,
    activeStrategy: state.activeStrategy,
    strategyName: STRATEGIES[state.activeStrategy]?.name || null,
    symbols: state.symbols,
    startedAt: state.startedAt,
    killedReason: state.killedReason,
    dailyPnl: state.dailyPnl,
    consecutiveLosses: state.consecutiveLosses,
    config: state.config,
    trades: trades.map((t) => t.toJSON()),
    summary: {
      realizedPnl: Math.round(realizedPnl * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      totalPnl: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
      totalTrades: sells.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Math.round(winRate * 100) / 100,
      bestTrade: bestTrade ? { symbol: bestTrade.symbol, pnl: Math.round((parseFloat(bestTrade.pnl) || 0) * 100) / 100 } : null,
      worstTrade: worstTrade ? { symbol: worstTrade.symbol, pnl: Math.round((parseFloat(worstTrade.pnl) || 0) * 100) / 100 } : null,
      openPositions: positionsCount,
      perSymbol,
    },
  };
}

/**
 * Call from server startup to resume every user whose state row is still marked
 * running. Each user gets their own interval.
 */
export async function resumeAutoTraderIfRunning() {
  const runningStates = await AutoTraderState.findAll({ where: { running: true } }).catch(() => []);
  for (const state of runningStates) {
    const userId = state.userId;
    logger.info({ userId, strategy: state.activeStrategy, symbols: state.symbols }, 'Resuming auto-trader');
    const key = keyOf(userId);
    const prev = timers.get(key);
    if (prev) clearInterval(prev);
    tick(userId).catch((err) => logger.error({ err, userId }, 'Resume: initial tick failed'));
    const pollMs = resolveCheckInterval({ ...DEFAULT_CONFIG, ...state.config });
    const handle = setInterval(() => {
      tick(userId).catch((err) => logger.error({ err, userId }, 'Scheduled tick failed'));
    }, pollMs);
    timers.set(key, handle);
  }
}

/** Stop every user's interval. Used on graceful shutdown. */
export async function stopAllAutoTraders() {
  for (const [key, handle] of timers.entries()) {
    clearInterval(handle);
    timers.delete(key);
  }
}

// Test-only hook — resets module state between unit tests.
export function _resetForTests() {
  for (const handle of timers.values()) clearInterval(handle);
  timers.clear();
  tickRunning.clear();
}
