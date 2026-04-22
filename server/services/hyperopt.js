import * as alpaca from './alpaca.js';
import { backtest } from './backtester.js';
import { barsPerYearForTimeframe } from './comboBacktester.js';
import { HyperoptRun } from '../models/index.js';
import { logger } from '../logger.js';

/**
 * Hyperopt-lite — async parameter grid-search on top of the existing backtest
 * engine. One `HyperoptRun` row per job; the job lives in-process (no job
 * queue) and writes progress back to the row so the UI can poll.
 *
 * Scope note: we currently grid-search over execution params (stopLossPct,
 * takeProfitPct, slippagePct) rather than strategy-internal params (RSI period,
 * MA length, etc.) because individual strategies don't expose those as inputs
 * yet. Plumbing strategy params through is a follow-up.
 */

const DEFAULT_GRID = {
  stopLossPct:   [0.02, 0.03, 0.05, 0.08],
  takeProfitPct: [0.04, 0.06, 0.10, 0.15],
  slippagePct:   [0, 0.0005],
};

function cartesian(keys, grid) {
  return keys.reduce((acc, k) => {
    const out = [];
    for (const prev of acc) for (const v of grid[k]) out.push({ ...prev, [k]: v });
    return out;
  }, [{}]);
}

function round(n) { return Math.round(n * 100) / 100; }

/**
 * Start a hyperopt job. Returns the persisted row immediately; execution runs
 * in the background and updates the row as it progresses.
 *
 * @param {object} opts
 * @param {number} opts.userId
 * @param {string} opts.strategyKey
 * @param {string} opts.symbol
 * @param {number} [opts.days=365]
 * @param {string} [opts.timeframe='1Day']
 * @param {object} [opts.grid]      Partial grid override; merged over DEFAULT_GRID
 * @param {number} [opts.oosRatio=0.3]
 * @param {number} [opts.topN=10]
 * @returns {Promise<HyperoptRun>}
 */
export async function startHyperopt({
  userId,
  strategyKey,
  symbol,
  days = 365,
  timeframe = '1Day',
  grid: gridOverride = {},
  oosRatio = 0.3,
  topN = 10,
}) {
  const grid = { ...DEFAULT_GRID, ...gridOverride };
  const row = await HyperoptRun.create({
    userId, strategyKey, symbol, days, timeframe, grid,
    status: 'pending',
    progress: { completed: 0, total: 0 },
  });

  // Kick off background execution — don't await so the API returns fast.
  runJob(row.id, { oosRatio, topN }).catch((err) => {
    logger.warn({ err, runId: row.id }, 'hyperopt job failed unexpectedly');
  });

  return row;
}

async function runJob(runId, { oosRatio, topN }) {
  const row = await HyperoptRun.findByPk(runId);
  if (!row) return;

  try {
    await row.update({ status: 'running', startedAt: new Date() });

    const bars = await alpaca.getBars(row.symbol, row.timeframe, row.days);
    if (!bars.length) {
      await row.update({
        status: 'failed',
        finishedAt: new Date(),
        error: `No historical data for ${row.symbol}`,
      });
      return;
    }
    if (bars.length < 100) {
      await row.update({
        status: 'failed',
        finishedAt: new Date(),
        error: `Need ≥100 bars for optimization; got ${bars.length}`,
      });
      return;
    }

    const grid = row.grid || DEFAULT_GRID;
    const keys = Object.keys(grid);
    const combos = cartesian(keys, grid);
    const bpy = barsPerYearForTimeframe(row.timeframe);

    const total = combos.length;
    await row.update({ progress: { completed: 0, total } });

    const results = [];
    // Persist progress every N combos so a long run doesn't thrash the DB.
    const FLUSH_EVERY = Math.max(1, Math.floor(total / 20));

    for (let i = 0; i < combos.length; i++) {
      const params = combos[i];
      try {
        const r = backtest(row.strategyKey, bars, {
          ...params, oosRatio, barsPerYear: bpy,
        });
        if (r.oosReport) {
          const isPnl    = r.oosReport.inSample.totalPnl;
          const oosPnl   = r.oosReport.outSample.totalPnl;
          const isTrades  = Math.max(1, r.oosReport.inSample.trades);
          const oosTrades = Math.max(1, r.oosReport.outSample.trades);
          const isPerTrade  = isPnl / isTrades;
          const oosPerTrade = oosPnl / oosTrades;
          const degradation = isPerTrade > 0
            ? (isPerTrade - oosPerTrade) / isPerTrade
            : 0;
          const score = oosPnl - Math.max(0, degradation) * Math.abs(isPnl);
          results.push({
            params,
            totalPnl:    round(r.totalPnl),
            totalTrades: r.totalTrades,
            winRate:     round(r.winRate),
            sharpe:      round(r.sharpe),
            maxDrawdown: round(r.maxDrawdown),
            isPnl:       round(isPnl),
            oosPnl:      round(oosPnl),
            degradation: round(degradation * 100),
            score:       round(score),
          });
        }
      } catch (_) { /* skip failing combo */ }

      if ((i + 1) % FLUSH_EVERY === 0 || i === combos.length - 1) {
        await row.update({ progress: { completed: i + 1, total } });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const leaderboard = results.slice(0, topN);

    await row.update({
      status: 'done',
      finishedAt: new Date(),
      leaderboard,
      bestParams: leaderboard[0]?.params || null,
      progress: { completed: total, total },
    });
  } catch (err) {
    logger.error({ err, runId }, 'hyperopt job crashed');
    await row.update({
      status: 'failed',
      finishedAt: new Date(),
      error: err.message || String(err),
    });
  }
}
