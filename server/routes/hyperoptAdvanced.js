import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import * as alpaca from '../services/alpaca.js';
import { backtest } from '../services/backtester.js';
import { barsPerYearForTimeframe } from '../services/comboBacktester.js';
import {
  BUILTIN_LOSSES, resolveLoss,
  sampleRoiTable, sampleTrailingStop, sampleIndicators,
} from '../services/hyperoptAdvanced.js';
import { STRATEGIES } from '../services/strategyEngine.js';
import { BadRequestError } from '../errors.js';

/**
 * Advanced hyperopt — single synchronous endpoint that runs `budget` random
 * samples over the supplied spaces, scores each with the selected loss
 * function, and returns the sorted leaderboard.
 *
 *   GET  /losses                list built-in loss fn names
 *   POST /validate-loss         compile a custom JS loss fn body
 *   POST /run                   { strategyKey, symbol, days, timeframe, budget,
 *                                 lossName? | customLossBody?,
 *                                 roiSpace?, trailingSpace?, indicatorSpace?,
 *                                 execSpace? }
 *
 * The advanced runner is *synchronous* to keep the implementation simple —
 * for long budgets use the existing background /api/hyperopt route instead.
 */

const router = Router();

router.get('/losses', (_req, res) => {
  res.json({ names: Object.keys(BUILTIN_LOSSES) });
});

router.post('/validate-loss', asyncHandler(async (req, res) => {
  const { body } = req.body || {};
  try {
    resolveLoss({ customBody: body });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
}));

router.post('/run', asyncHandler(async (req, res) => {
  const {
    strategyKey, symbol, days = 365, timeframe = '1Day',
    budget = 20,
    lossName, customLossBody,
    roiSpace, trailingSpace, indicatorSpace, execSpace,
  } = req.body || {};

  if (!strategyKey || !STRATEGIES[strategyKey]) throw new BadRequestError('unknown strategyKey');
  if (!symbol) throw new BadRequestError('symbol required');
  const d = Number(days);
  if (!Number.isFinite(d) || d < 30 || d > 3650) throw new BadRequestError('days must be 30..3650');
  const N = Math.max(1, Math.min(500, Number(budget) || 20));

  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, d);
  if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);

  const loss = resolveLoss({ name: lossName, customBody: customLossBody });
  const bpy = barsPerYearForTimeframe(timeframe);

  // Generate N candidates by sampling from each enabled space. The execSpace
  // (stopLossPct/takeProfitPct/slippagePct/commissionPerTrade) is the only
  // one the current backtester consumes directly — ROI/trailing/indicator
  // spaces are recorded on each result for downstream tooling and for the
  // strategy-sandbox path to consume. This gives us the freqtrade UX shape
  // (all four spaces) without requiring every built-in strategy to rewire.
  const samples = [];
  for (let i = 0; i < N; i++) {
    const candidate = {};
    if (execSpace)       Object.assign(candidate, sampleIndicators(execSpace, 1)[0]);
    if (roiSpace)        candidate.roi = sampleRoiTable(roiSpace, 1)[0];
    if (trailingSpace)   candidate.trailing = sampleTrailingStop(trailingSpace, 1)[0];
    if (indicatorSpace)  candidate.indicators = sampleIndicators(indicatorSpace, 1)[0];
    samples.push(candidate);
  }

  const leaderboard = [];
  for (const params of samples) {
    try {
      const execArgs = {};
      for (const k of ['stopLossPct', 'takeProfitPct', 'slippagePct', 'commissionPerTrade', 'positionPct']) {
        if (params[k] !== undefined) execArgs[k] = params[k];
      }
      const r = backtest(strategyKey, bars, { ...execArgs, barsPerYear: bpy });
      const ctx = { result: r, trades: r.trades, equityCurve: r.equityCurve, params, bars };
      const score = loss(ctx);
      leaderboard.push({
        params,
        score: Math.round(score * 10000) / 10000,
        totalPnl: r.totalPnl,
        sharpe: r.sharpe,
        maxDrawdown: r.maxDrawdown,
        trades: r.totalTrades,
        winRate: r.winRate,
      });
    } catch (e) {
      leaderboard.push({ params, error: e.message });
    }
  }
  leaderboard.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity)); // lower = better
  res.json({
    strategyKey, symbol: symbol.toUpperCase(), days: d, timeframe,
    budget: N,
    loss: customLossBody ? 'custom' : (lossName || 'SharpeHyperOptLoss'),
    leaderboard: leaderboard.slice(0, 20),
    total: leaderboard.length,
  });
}));

export default router;
