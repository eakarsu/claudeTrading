/**
 * Advanced hyperopt — built-in + custom loss functions, plus ROI,
 * trailing-stop, and indicator spaces (freqtrade parity for the
 * hyperopt.md surface).
 *
 * Built-in losses (match freqtrade names):
 *   ShortTradeDurHyperOptLoss — minimize avg trade duration
 *   OnlyProfitHyperOptLoss    — maximize totalPnl (flip sign)
 *   SharpeHyperOptLoss        — -sharpe
 *   SortinoHyperOptLoss       — -sortino (downside-only std)
 *   SharpeHyperOptLossDaily   — -sharpe computed on daily resamples
 *   MaxDrawDownHyperOptLoss   — maxDrawdown + -totalPnl penalty
 *   CalmarHyperOptLoss        — -(totalPnl / maxDrawdown)
 *   ProfitDrawDownHyperOptLoss — maxDrawdown - totalPnl
 *
 * Custom loss: the caller supplies a JS function body that returns a number.
 * Input ctx: { result, trades, equityCurve, params, bars } — lower = better.
 */

import vm from 'vm';

function sortinoRatio(returns, target = 0) {
  if (!returns.length) return 0;
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downside = returns.filter((r) => r < target);
  if (!downside.length) return avg > 0 ? Infinity : 0;
  const d2 = downside.reduce((s, r) => s + (r - target) ** 2, 0) / downside.length;
  const std = Math.sqrt(d2);
  return std > 0 ? avg / std : 0;
}

export const BUILTIN_LOSSES = {
  OnlyProfitHyperOptLoss: (ctx) => -Number(ctx.result.totalPnl || 0),
  ShortTradeDurHyperOptLoss: (ctx) => {
    if (!ctx.trades?.length) return 1e9;
    const avgBars = ctx.trades.reduce((s, t) => s + ((t.exitIdx ?? 0) - (t.entryIdx ?? 0)), 0) / ctx.trades.length;
    // Lower duration is better, but we also want some profit — penalize
    // losing sets so we don't reward instant-exit failures.
    const pnl = Number(ctx.result.totalPnl || 0);
    return avgBars + (pnl < 0 ? -pnl : 0);
  },
  SharpeHyperOptLoss: (ctx) => -Number(ctx.result.sharpe || 0),
  SharpeHyperOptLossDaily: (ctx) => -Number(ctx.result.sharpe || 0),  // our equity curve is already daily
  SortinoHyperOptLoss: (ctx) => {
    const c = ctx.equityCurve || [];
    if (c.length < 2) return 0;
    const rets = [];
    for (let i = 1; i < c.length; i++) rets.push((c[i].equity - c[i - 1].equity) / c[i - 1].equity);
    return -sortinoRatio(rets);
  },
  MaxDrawDownHyperOptLoss: (ctx) => Number(ctx.result.maxDrawdown || 0) - Number(ctx.result.totalPnl || 0) / 10000,
  CalmarHyperOptLoss: (ctx) => {
    const dd = Number(ctx.result.maxDrawdown || 0);
    const pnl = Number(ctx.result.totalPnl || 0);
    if (dd <= 0) return pnl > 0 ? -Infinity : 0;
    return -(pnl / dd);
  },
  ProfitDrawDownHyperOptLoss: (ctx) =>
    Number(ctx.result.maxDrawdown || 0) - Number(ctx.result.totalPnl || 0),
};

/**
 * Compile a custom loss function body. The body should be a single
 * expression OR a function-body that returns a number given `ctx`.
 * Examples:
 *    `return -ctx.result.sharpe;`
 *    `return ctx.result.maxDrawdown - ctx.result.totalPnl;`
 */
export function compileCustomLoss(body, timeoutMs = 200) {
  if (!body || typeof body !== 'string') throw new Error('loss body required');
  if (body.length > 4096) throw new Error('loss body too large');
  for (const tok of ['require(', 'import(', 'process.', 'Function(', 'eval(', 'globalThis']) {
    if (body.includes(tok)) throw new Error(`Forbidden token in loss body: ${tok}`);
  }

  // Wrap in a function so `return` works at top level.
  const wrapped = `(function(ctx){ ${body} })(__ctx)`;
  const script = new vm.Script(wrapped, { filename: 'hyperopt-loss.js' });
  return (ctx) => {
    const sandbox = { __ctx: ctx, Math, Number };
    const context = vm.createContext(sandbox);
    const out = script.runInContext(context, { timeout: timeoutMs, breakOnSigint: true });
    if (typeof out !== 'number' || !Number.isFinite(out)) {
      throw new Error(`Loss fn must return a finite number (got ${typeof out}: ${out})`);
    }
    return out;
  };
}

export function resolveLoss({ name = 'SharpeHyperOptLoss', customBody = null } = {}) {
  if (customBody) return compileCustomLoss(customBody);
  const fn = BUILTIN_LOSSES[name];
  if (!fn) throw new Error(`Unknown loss fn: ${name}. Known: ${Object.keys(BUILTIN_LOSSES).join(', ')}`);
  return fn;
}

// ───── Spaces ─────

/**
 * ROI table space — freqtrade's minimal_roi is { "minutes_open": target_pct }.
 * We sample N candidate tables from a declarative spec:
 *   {
 *     timesteps: [0, 30, 60, 120],
 *     targets:   { min: 0.005, max: 0.08, steps: 5 }
 *   }
 * Each sample picks a target per timestep that monotonically decreases.
 */
export function sampleRoiTable({ timesteps, targets }, n = 1, rng = Math.random) {
  const tables = [];
  for (let i = 0; i < n; i++) {
    const t = {};
    let prev = targets.max;
    const step = (targets.max - targets.min) / Math.max(1, (targets.steps - 1));
    for (let k = 0; k < timesteps.length; k++) {
      const j = Math.floor(rng() * targets.steps);
      const val = Math.max(targets.min, prev - j * step);
      t[String(timesteps[k])] = round4(val);
      prev = val;
    }
    tables.push(t);
  }
  return tables;
}

/**
 * Trailing-stop space — samples candidate (stop, positive offset, enabled)
 * triplets.
 */
export function sampleTrailingStop(space, n = 1, rng = Math.random) {
  const out = [];
  const { stop = { min: 0.01, max: 0.10 }, offset = { min: 0, max: 0.05 }, offsetIsEnabled = [false, true] } = space;
  for (let i = 0; i < n; i++) {
    out.push({
      trailing_stop: true,
      trailing_stop_positive: round4(rng() * (stop.max - stop.min) + stop.min),
      trailing_stop_positive_offset: round4(rng() * (offset.max - offset.min) + offset.min),
      trailing_only_offset_is_reached: offsetIsEnabled[Math.floor(rng() * offsetIsEnabled.length)],
    });
  }
  return out;
}

/**
 * Indicator space — samples (key → value) from a {min,max,steps,type} spec,
 * identical to the one Bayesian hyperopt uses. Kept here so callers can mix
 * indicator space with ROI / trailing-stop space.
 */
export function sampleIndicators(space, n = 1, rng = Math.random) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const pick = {};
    for (const [k, spec] of Object.entries(space)) {
      const { min, max, type = 'float', steps } = spec;
      if (type === 'int') {
        pick[k] = Math.floor(rng() * (max - min + 1)) + min;
      } else if (type === 'categorical' && Array.isArray(spec.values)) {
        pick[k] = spec.values[Math.floor(rng() * spec.values.length)];
      } else {
        if (steps && steps > 1) {
          const j = Math.floor(rng() * steps);
          pick[k] = round4(min + j * ((max - min) / (steps - 1)));
        } else {
          pick[k] = round4(rng() * (max - min) + min);
        }
      }
    }
    out.push(pick);
  }
  return out;
}

function round4(n) { return Math.round(n * 10000) / 10000; }
