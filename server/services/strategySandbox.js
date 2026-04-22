/**
 * Strategy sandbox — runs user-authored JS strategies inside a Node `vm`.
 *
 * The sandbox is deliberately minimal: the script body is executed once to
 * define callbacks (populate_entry_trend, populate_exit_trend, custom_stoploss,
 * etc.), then each callback is invoked per-bar with bar + indicator context.
 *
 * Security model — this is *lightly* sandboxed, not adversarially sandboxed.
 *   • No `require` / `import` — the context only exposes pure-data globals.
 *   • No access to `process`, `fetch`, filesystem, or `this` globals.
 *   • Per-call `timeout` (vm.runInContext option) bounds loops.
 *   • We treat user scripts as *trusted within the same account* — a malicious
 *     user cannot escape to another user's data because routes scope by
 *     req.userId, but they CAN stall their own process with a CPU loop up to
 *     the timeout. This is acceptable for a single-tenant self-hosted deploy;
 *     multi-tenant hosts should run this service in a separate worker.
 *
 * API exposed to the user script:
 *   defineStrategy({
 *     populate_entry_trend(ctx) -> boolean   // true = enter long on this bar
 *     populate_exit_trend(ctx)  -> boolean   // true = exit open long
 *     custom_stoploss(ctx)      -> number    // absolute stop price (optional)
 *     custom_exit(ctx)          -> string|null // return a reason to force-exit
 *     custom_entry_price(ctx)   -> number    // override fill price (optional)
 *     confirm_trade_entry(ctx)  -> boolean   // veto an entry signal (default true)
 *     confirm_trade_exit(ctx)   -> boolean   // veto an exit signal  (default true)
 *     adjust_trade_position(ctx)-> number    // +/- shares (optional, default 0)
 *     check_entry_timeout(ctx)  -> boolean   // cancel pending entry
 *     check_exit_timeout(ctx)   -> boolean   // cancel pending exit
 *     order_filled(ctx)         -> void      // event hook
 *     leverage(ctx)             -> number    // >=1, default 1
 *   })
 *
 * ctx (per-bar): {
 *   bar: { time, open, high, low, close, volume },
 *   i:   number,
 *   bars, closes, highs, lows, volumes,
 *   indicators: { rsi, macd, sma20, sma50, sma200, ema9, ema21, bollinger, stochastic, vwap },
 *   position: { side, shares, entryPrice, entryTime } | null,
 *   params: object,   // user-supplied params at load
 * }
 */

import vm from 'vm';
import { computeAll } from './indicators.js';

const DEFAULT_TIMEOUT_MS = 1500;
const LOAD_TIMEOUT_MS    = 500;

const HOOK_NAMES = [
  'populate_entry_trend',
  'populate_exit_trend',
  'custom_stoploss',
  'custom_exit',
  'custom_entry_price',
  'confirm_trade_entry',
  'confirm_trade_exit',
  'adjust_trade_position',
  'check_entry_timeout',
  'check_exit_timeout',
  'order_filled',
  'leverage',
];

function makeContext(params = {}) {
  const hooks = {};
  const sandbox = {
    // --- user-facing API ---
    defineStrategy(def) {
      if (!def || typeof def !== 'object') throw new Error('defineStrategy(def) requires an object');
      for (const key of Object.keys(def)) {
        if (!HOOK_NAMES.includes(key)) throw new Error(`Unknown hook: ${key}`);
        if (typeof def[key] !== 'function') throw new Error(`Hook ${key} must be a function`);
        hooks[key] = def[key];
      }
    },
    params,
    // Safe math / primitives the user is likely to want.
    Math,
    Number, String, Array, Object, Boolean, JSON, Date,
    // Deliberately shadow risky globals to `undefined` so a script can't
    // feel around for them.
    process: undefined,
    require:  undefined,
    global:   undefined,
    console: {
      // Capture logs into an in-context buffer the caller can read.
      log:  (...args) => { sandbox.__logs.push(args.map(fmt).join(' ')); },
      warn: (...args) => { sandbox.__logs.push('[warn] ' + args.map(fmt).join(' ')); },
      error:(...args) => { sandbox.__logs.push('[error] ' + args.map(fmt).join(' ')); },
    },
    __logs: [],
  };
  const ctx = vm.createContext(sandbox, { name: 'user-strategy' });
  return { ctx, sandbox, hooks };
}

function fmt(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

/**
 * Compile a user script. Returns { hooks, logs, context } where hooks is a
 * map of callback name -> { fn, runInVm(ctxObj, timeoutMs) }.
 *
 * Throws a plain Error on compile failure; the message is safe to surface.
 */
export function compileStrategy(sourceJs, { params = {}, loadTimeoutMs = LOAD_TIMEOUT_MS } = {}) {
  if (typeof sourceJs !== 'string') throw new Error('sourceJs must be a string');
  if (sourceJs.length > 64 * 1024) throw new Error('strategy source too large (64KB limit)');

  // Cheap static guard against the obvious escape hatches. It's not
  // watertight — the vm context is the real boundary — but catching these
  // up front gives the user a clearer error than a runtime ReferenceError.
  const forbidden = ['require(', 'import(', 'process.', 'Function(', 'eval(', 'globalThis'];
  for (const tok of forbidden) {
    if (sourceJs.includes(tok)) throw new Error(`Forbidden token in strategy source: ${tok}`);
  }

  const { ctx, sandbox, hooks } = makeContext(params);
  const script = new vm.Script(sourceJs, { filename: 'user-strategy.js' });
  script.runInContext(ctx, { timeout: loadTimeoutMs, breakOnSigint: true });

  if (!Object.keys(hooks).length) {
    throw new Error('Strategy must call defineStrategy({ ... }) with at least one hook');
  }

  return {
    hooks,
    logs: sandbox.__logs,
    sandbox,
    /** Invoke a hook with a per-bar ctx object, time-bounded. */
    call(name, barCtx, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const fn = hooks[name];
      if (!fn) return undefined;
      // We route the call through runInContext so vm's timeout applies. We
      // stash the args on the context under a scoped name and eval a tiny
      // caller expression, then read the result back.
      sandbox.__args = barCtx;
      sandbox.__hook = fn;
      sandbox.__result = undefined;
      sandbox.__err = undefined;
      const caller = `try { __result = __hook(__args); } catch (e) { __err = String(e && e.message || e); }`;
      vm.runInContext(caller, ctx, { timeout: timeoutMs, breakOnSigint: true });
      if (sandbox.__err) throw new Error(sandbox.__err);
      return sandbox.__result;
    },
  };
}

/**
 * Validate a strategy source — compiles it and runs each hook once against a
 * synthetic ctx so we can surface type errors before the user tries to
 * backtest. Returns { ok, hooks, warnings, error }.
 */
export function validateStrategy(sourceJs, params = {}) {
  try {
    const compiled = compileStrategy(sourceJs, { params });
    const warnings = [];
    // Build a synthetic ctx. Minimal — the hook should be resilient to
    // missing fields; we're only checking that it doesn't throw on call.
    const syntheticBar = { time: new Date().toISOString(), open: 100, high: 101, low: 99, close: 100, volume: 1000 };
    const syntheticCtx = {
      bar: syntheticBar, i: 20,
      bars: Array.from({ length: 30 }, () => ({ ...syntheticBar })),
      closes: Array(30).fill(100), highs: Array(30).fill(101), lows: Array(30).fill(99), volumes: Array(30).fill(1000),
      indicators: {
        rsi: Array(30).fill(50),
        macd: { macd: Array(30).fill(0), signal: Array(30).fill(0), histogram: Array(30).fill(0) },
        sma20: Array(30).fill(100), sma50: Array(30).fill(100), sma200: Array(30).fill(100),
        ema9: Array(30).fill(100), ema21: Array(30).fill(100),
        bollinger: { upper: Array(30).fill(102), middle: Array(30).fill(100), lower: Array(30).fill(98) },
        stochastic: { k: Array(30).fill(50), d: Array(30).fill(50) },
        vwap: Array(30).fill(100),
      },
      position: null,
      params,
    };
    for (const name of Object.keys(compiled.hooks)) {
      try { compiled.call(name, syntheticCtx); }
      catch (e) { warnings.push(`${name}: ${e.message}`); }
    }
    return { ok: true, hooks: Object.keys(compiled.hooks), warnings, logs: compiled.logs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Backtest a user strategy. Same shape as services/backtester.js output so
 * the existing frontend/table renderers keep working.
 *
 * Behavior:
 *   • On each bar, call populate_exit_trend (if in a position). If true
 *     AND confirm_trade_exit returns !false, close the position.
 *   • Otherwise if custom_exit returns a truthy string reason, close.
 *   • Otherwise check custom_stoploss → if bar.low crossed, close.
 *   • Then call populate_entry_trend (if flat). If true AND
 *     confirm_trade_entry returns !false, open a long at close (or
 *     custom_entry_price if provided).
 *   • leverage() gates sizing.
 */
export function backtestUserStrategy(sourceJs, bars, options = {}) {
  const {
    capital = 100_000,
    positionPct = 0.10,
    stopLossPct = 0.03,
    takeProfitPct = 0.06,
    slippagePct = 0,
    commissionPerTrade = 0,
    barsPerYear = 252,
    params = {},
    hookTimeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const indicators = computeAll(bars);
  const compiled = compileStrategy(sourceJs, { params });

  const trades = [];
  let cash = capital;
  let position = null; // { side:'buy', shares, entryPrice, entryTime, entryIdx, stopPrice, targetPrice }
  let peakEquity = capital;
  let maxDrawdown = 0;
  const equityCurve = [];
  const errors = [];

  const closes = bars.map((b) => b.close);
  const highs  = bars.map((b) => b.high);
  const lows   = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);

  const buildCtx = (i) => ({
    bar: bars[i],
    i,
    bars, closes, highs, lows, volumes,
    indicators,
    position: position ? { ...position } : null,
    params,
  });

  const safeCall = (name, ctx, fallback = undefined) => {
    if (!compiled.hooks[name]) return fallback;
    try { return compiled.call(name, ctx, hookTimeoutMs); }
    catch (e) { errors.push({ bar: ctx.i, hook: name, error: e.message }); return fallback; }
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const equity = cash + (position ? position.shares * bar.close : 0);
    equityCurve.push({ time: bar.time, equity: Math.round(equity * 100) / 100 });
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // ---- Exit checks (only if we're long) ----
    if (position) {
      const ctx = buildCtx(i);

      // 1) Dynamic stop from custom_stoploss (absolute price)
      const dynStop = safeCall('custom_stoploss', ctx);
      if (typeof dynStop === 'number' && Number.isFinite(dynStop)) {
        position.stopPrice = dynStop;
      }

      if (bar.low <= position.stopPrice) {
        const fill = position.stopPrice * (1 - slippagePct);
        const pnl = (fill - position.entryPrice) * position.shares - commissionPerTrade;
        cash += position.shares * fill - commissionPerTrade;
        trades.push({
          entryTime: position.entryTime, exitTime: bar.time,
          entryPrice: position.entryPrice, exitPrice: fill,
          shares: position.shares, side: 'buy', pnl, reason: 'Stop loss hit',
          entryIdx: position.entryIdx, exitIdx: i,
        });
        safeCall('order_filled', { ...ctx, event: 'exit', reason: 'stoploss' });
        position = null;
        continue;
      }
      if (bar.high >= position.targetPrice) {
        const fill = position.targetPrice * (1 - slippagePct);
        const pnl = (fill - position.entryPrice) * position.shares - commissionPerTrade;
        cash += position.shares * fill - commissionPerTrade;
        trades.push({
          entryTime: position.entryTime, exitTime: bar.time,
          entryPrice: position.entryPrice, exitPrice: fill,
          shares: position.shares, side: 'buy', pnl, reason: 'Target hit',
          entryIdx: position.entryIdx, exitIdx: i,
        });
        safeCall('order_filled', { ...ctx, event: 'exit', reason: 'target' });
        position = null;
        continue;
      }

      // 2) custom_exit — string reason forces close
      const customReason = safeCall('custom_exit', ctx);
      if (typeof customReason === 'string' && customReason) {
        const fill = bar.close * (1 - slippagePct);
        const pnl = (fill - position.entryPrice) * position.shares - commissionPerTrade;
        cash += position.shares * fill - commissionPerTrade;
        trades.push({
          entryTime: position.entryTime, exitTime: bar.time,
          entryPrice: position.entryPrice, exitPrice: fill,
          shares: position.shares, side: 'buy', pnl, reason: `custom_exit: ${customReason}`,
          entryIdx: position.entryIdx, exitIdx: i,
        });
        safeCall('order_filled', { ...ctx, event: 'exit', reason: 'custom_exit' });
        position = null;
        continue;
      }

      // 3) populate_exit_trend — standard exit signal
      const wantExit = !!safeCall('populate_exit_trend', ctx, false);
      if (wantExit) {
        const confirm = safeCall('confirm_trade_exit', ctx, true);
        if (confirm !== false) {
          const fill = bar.close * (1 - slippagePct);
          const pnl = (fill - position.entryPrice) * position.shares - commissionPerTrade;
          cash += position.shares * fill - commissionPerTrade;
          trades.push({
            entryTime: position.entryTime, exitTime: bar.time,
            entryPrice: position.entryPrice, exitPrice: fill,
            shares: position.shares, side: 'buy', pnl, reason: 'populate_exit_trend',
            entryIdx: position.entryIdx, exitIdx: i,
          });
          safeCall('order_filled', { ...ctx, event: 'exit', reason: 'exit_signal' });
          position = null;
          continue;
        }
      }
    }

    // ---- Entry checks (only if flat) ----
    if (!position) {
      const ctx = buildCtx(i);
      const wantEntry = !!safeCall('populate_entry_trend', ctx, false);
      if (wantEntry) {
        const confirm = safeCall('confirm_trade_entry', ctx, true);
        if (confirm === false) continue;

        // Entry price override
        const customEntry = safeCall('custom_entry_price', ctx);
        const basePrice = (typeof customEntry === 'number' && Number.isFinite(customEntry) && customEntry > 0)
          ? customEntry : bar.close;
        const entry = basePrice * (1 + slippagePct);

        // Leverage multiplier — we model it as buying power expansion, not a
        // liquidation-aware margin account. Safe for a simple sim.
        const lev = Math.max(1, Number(safeCall('leverage', ctx, 1)) || 1);
        const maxSpend = cash * positionPct * lev;
        const shares = Math.floor(maxSpend / entry);
        if (shares <= 0) continue;

        cash -= shares * entry + commissionPerTrade;
        position = {
          shares,
          entryPrice: entry,
          entryTime: bar.time,
          entryIdx: i,
          side: 'buy',
          stopPrice: Math.round(entry * (1 - stopLossPct) * 100) / 100,
          targetPrice: Math.round(entry * (1 + takeProfitPct) * 100) / 100,
          leverage: lev,
        };
        safeCall('order_filled', { ...ctx, event: 'entry', reason: 'entry_signal' });
      }
    }
  }

  // Close any still-open position at last bar.
  if (position && bars.length > 0) {
    const lastBar = bars[bars.length - 1];
    const exit = lastBar.close * (1 - slippagePct);
    const pnl = (exit - position.entryPrice) * position.shares - commissionPerTrade;
    cash += position.shares * exit - commissionPerTrade;
    trades.push({
      entryTime: position.entryTime, exitTime: lastBar.time,
      entryPrice: position.entryPrice, exitPrice: exit,
      shares: position.shares, side: 'buy', pnl, reason: 'End of period',
      entryIdx: position.entryIdx, exitIdx: bars.length - 1,
    });
    position = null;
  }

  const finalEquity = cash;
  const totalPnl = finalEquity - capital;
  const totalReturn = totalPnl / capital;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winRate = trades.length ? wins.length / trades.length : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : avgWin > 0 ? Infinity : 0;

  let sharpe = 0;
  if (equityCurve.length > 1) {
    const returns = [];
    for (let i = 1; i < equityCurve.length; i++) {
      returns.push((equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity);
    }
    const avgRet = returns.reduce((s, r) => s + r, 0) / returns.length;
    const stdRet = Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / returns.length);
    sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(barsPerYear) : 0;
  }

  return {
    strategy: 'user:inline',
    strategyKey: 'user:inline',
    initialCapital: capital,
    finalEquity: Math.round(finalEquity * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalReturn: Math.round(totalReturn * 10000) / 100,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Math.round(winRate * 10000) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    trades,
    equityCurve,
    errors,
    logs: compiled.logs,
  };
}

export const EXAMPLE_STRATEGY = `// Example: RSI mean-reversion with dynamic trailing stop.
// Any of these hooks is optional — only defineStrategy itself is required.
defineStrategy({
  populate_entry_trend(ctx) {
    const rsi = ctx.indicators.rsi[ctx.i];
    return rsi !== null && rsi < 30;
  },
  populate_exit_trend(ctx) {
    const rsi = ctx.indicators.rsi[ctx.i];
    return rsi !== null && rsi > 70;
  },
  // Trail the stop to 3% below the best close since entry.
  custom_stoploss(ctx) {
    if (!ctx.position) return undefined;
    const entryIdx = ctx.position.entryIdx ?? ctx.i;
    let best = ctx.position.entryPrice;
    for (let j = entryIdx; j <= ctx.i; j++) best = Math.max(best, ctx.closes[j]);
    return best * 0.97;
  },
  confirm_trade_entry(ctx) {
    // Require decent volume before entering.
    return ctx.bar.volume > 0;
  },
  leverage() { return 1; },
});
`;
