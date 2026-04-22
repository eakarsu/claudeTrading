import * as alpaca from './alpaca.js';
import { backtest } from './backtester.js';
import { barsPerYearForTimeframe } from './comboBacktester.js';
import { HyperoptRun } from '../models/index.js';
import { logger } from '../logger.js';

/**
 * Bayesian hyperopt — samples continuous parameter spaces using a
 * Tree-structured Parzen Estimator (TPE)–lite scheme:
 *
 *  1. Warmup: sample N points uniformly at random, score each.
 *  2. Exploitation: split scored history into "good" (top 25%) and "rest".
 *     Sample new candidates by drawing around random good points with a
 *     shrinking Gaussian. This is the core TPE idea — bias toward regions
 *     that have performed well, without building a full GP surrogate.
 *  3. Repeat until budget exhausted.
 *
 * Scope note: this is a pragmatic lite version — proper TPE uses per-param
 * Parzen kernel density estimates for good/rest and maximizes l(x)/g(x). We
 * use Gaussian perturbation around good points, which is cheaper to implement
 * and still beats grid search on smooth surfaces.
 */

const DEFAULT_SPACE = {
  stopLossPct:   { min: 0.01, max: 0.10, type: 'float' },
  takeProfitPct: { min: 0.02, max: 0.20, type: 'float' },
  slippagePct:   { min: 0,    max: 0.002, type: 'float' },
};

function sampleUniform(space) {
  const out = {};
  for (const [k, d] of Object.entries(space)) {
    out[k] = d.min + Math.random() * (d.max - d.min);
    if (d.type === 'int') out[k] = Math.round(out[k]);
  }
  return out;
}

function sampleAround(point, space, sigmaFrac) {
  const out = {};
  for (const [k, d] of Object.entries(space)) {
    const range = d.max - d.min;
    // Box–Muller Gaussian perturbation, then clamp to [min, max].
    const u1 = Math.max(Math.random(), 1e-12);
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    let v = (point[k] ?? (d.min + range / 2)) + z * range * sigmaFrac;
    v = Math.max(d.min, Math.min(d.max, v));
    if (d.type === 'int') v = Math.round(v);
    out[k] = v;
  }
  return out;
}

/**
 * Start a Bayesian hyperopt run. Same HyperoptRun model as the grid variant,
 * just records `kind: 'bayesian'` in the grid field so the UI can tell them
 * apart.
 */
export async function startBayesianHyperopt({
  userId,
  strategyKey,
  symbol,
  days = 365,
  timeframe = '1Day',
  space: spaceOverride = {},
  oosRatio = 0.3,
  topN = 10,
  budget = 40,
}) {
  const space = { ...DEFAULT_SPACE, ...spaceOverride };
  const row = await HyperoptRun.create({
    userId, strategyKey, symbol, days, timeframe,
    grid: { kind: 'bayesian', space, budget },
    status: 'pending',
    progress: { completed: 0, total: budget },
  });

  runJob(row.id, { oosRatio, topN, budget, space }).catch((err) => {
    logger.warn({ err, runId: row.id }, 'bayesian hyperopt crashed');
  });
  return row;
}

async function runJob(runId, { oosRatio, topN, budget, space }) {
  const row = await HyperoptRun.findByPk(runId);
  if (!row) return;
  try {
    await row.update({ status: 'running', startedAt: new Date() });

    const bars = await alpaca.getBars(row.symbol, row.timeframe, row.days);
    if (bars.length < 100) {
      await row.update({ status: 'failed', finishedAt: new Date(), error: `Need ≥100 bars; got ${bars.length}` });
      return;
    }
    const bpy = barsPerYearForTimeframe(row.timeframe);
    const warmup = Math.max(5, Math.floor(budget * 0.2));
    const results = [];
    const FLUSH_EVERY = Math.max(1, Math.floor(budget / 20));

    for (let i = 0; i < budget; i++) {
      let params;
      if (i < warmup || results.length < 5) {
        params = sampleUniform(space);
      } else {
        // Sort by score descending; top 25% = good pool.
        const sorted = [...results].sort((a, b) => b.score - a.score);
        const goodCount = Math.max(1, Math.floor(sorted.length * 0.25));
        const pool = sorted.slice(0, goodCount);
        const seed = pool[Math.floor(Math.random() * pool.length)];
        // Shrink sigma as the budget is consumed — wide exploration early,
        // tight refinement late.
        const progress = i / budget;
        const sigma = 0.25 * (1 - progress) + 0.05;
        params = sampleAround(seed.params, space, sigma);
      }

      try {
        const r = backtest(row.strategyKey, bars, {
          ...params, oosRatio, barsPerYear: bpy,
        });
        if (r.oosReport) {
          const isPnl = r.oosReport.inSample.totalPnl;
          const oosPnl = r.oosReport.outSample.totalPnl;
          const isTrades = Math.max(1, r.oosReport.inSample.trades);
          const oosTrades = Math.max(1, r.oosReport.outSample.trades);
          const degr = isPnl > 0
            ? ((isPnl / isTrades) - (oosPnl / oosTrades)) / (isPnl / isTrades)
            : 0;
          const score = oosPnl - Math.max(0, degr) * Math.abs(isPnl);
          results.push({
            params: roundParams(params),
            totalPnl: round2(r.totalPnl),
            totalTrades: r.totalTrades,
            winRate: round2(r.winRate),
            sharpe: round2(r.sharpe),
            maxDrawdown: round2(r.maxDrawdown),
            isPnl: round2(isPnl),
            oosPnl: round2(oosPnl),
            degradation: round2(degr * 100),
            score: round2(score),
          });
        }
      } catch (_) { /* skip bad combo */ }

      if ((i + 1) % FLUSH_EVERY === 0 || i === budget - 1) {
        await row.update({ progress: { completed: i + 1, total: budget } });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const leaderboard = results.slice(0, topN);
    await row.update({
      status: 'done',
      finishedAt: new Date(),
      leaderboard,
      bestParams: leaderboard[0]?.params || null,
      progress: { completed: budget, total: budget },
    });
  } catch (err) {
    logger.error({ err, runId }, 'bayesian job crashed');
    await row.update({ status: 'failed', finishedAt: new Date(), error: err.message });
  }
}

function round2(n) { return Math.round(n * 100) / 100; }
function roundParams(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) out[k] = Math.round(v * 10000) / 10000;
  return out;
}
