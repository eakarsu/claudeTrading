import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import * as alpaca from '../services/alpaca.js';
import { backtest, backtestAll } from '../services/backtester.js';
import { findBestCombos, findBestCombosMulti, barsPerYearForTimeframe } from '../services/comboBacktester.js';
import {
  monteCarloTrades,
  optimizeParams,
  regimeTaggedStats,
  portfolioBacktest,
  benchmarkBuyAndHold,
} from '../services/backtestAdvanced.js';
import {
  backtestParams,
  backtestQuery,
  backtestAllParams,
  backtestAllQuery,
  backtestMultiSchema,
  comboSchema,
  comboMultiSchema,
  monteCarloSchema,
  optimizerSchema,
  regimeSchema,
  portfolioSchema,
  benchmarkSchema,
} from '../schemas.js';
import { BadRequestError } from '../errors.js';

const router = Router();

// Register /all/:symbol BEFORE /:strategy/:symbol so the literal "all" segment
// matches the specific route instead of being captured as a strategy name.
router.get(
  '/all/:symbol',
  validate({ params: backtestAllParams, query: backtestAllQuery }),
  asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    const { days, strategies: strategyFilter, timeframe = '1Day', slippagePct, commissionPerTrade, oosRatio } = req.query;
    const bars = await alpaca.getBars(symbol, timeframe, days);
    if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);
    let results = backtestAll(bars, {
      barsPerYear: barsPerYearForTimeframe(timeframe),
      slippagePct, commissionPerTrade, oosRatio,
    });
    if (strategyFilter) {
      const keys = strategyFilter.split(',');
      results = results.filter((r) => keys.includes(r.strategyKey));
    }
    res.json({ symbol, days, barsCount: bars.length, strategies: results });
  }),
);

router.get(
  '/:strategy/:symbol',
  validate({ params: backtestParams, query: backtestQuery }),
  asyncHandler(async (req, res) => {
    const { strategy, symbol } = req.params;
    const { days, timeframe = '1Day', slippagePct, commissionPerTrade, oosRatio } = req.query;
    const bars = await alpaca.getBars(symbol, timeframe, days);
    if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);
    res.json(backtest(strategy, bars, {
      barsPerYear: barsPerYearForTimeframe(timeframe),
      slippagePct, commissionPerTrade, oosRatio,
    }));
  }),
);

router.post(
  '/multi',
  validate({ body: backtestMultiSchema }),
  asyncHandler(async (req, res) => {
    const { symbols, days, strategies: strategyFilter, timeframe = '1Day', slippagePct, commissionPerTrade, oosRatio } = req.body;
    const filterKeys = strategyFilter ? strategyFilter.split(',') : null;
    const allResults = {};
    const strategyTotals = {};

    const bpy = barsPerYearForTimeframe(timeframe);
    for (const symbol of symbols) {
      const bars = await alpaca.getBars(symbol, timeframe, days);
      if (!bars.length) continue;
      let results = backtestAll(bars, { barsPerYear: bpy, slippagePct, commissionPerTrade, oosRatio });
      if (filterKeys) results = results.filter((r) => filterKeys.includes(r.strategyKey));
      allResults[symbol] = results;

      for (const r of results) {
        if (r.error) continue;
        if (!strategyTotals[r.strategyKey]) {
          strategyTotals[r.strategyKey] = {
            name: r.strategy,
            totalPnl: 0,
            totalTrades: 0,
            wins: 0,
            losses: 0,
            symbols: 0,
          };
        }
        strategyTotals[r.strategyKey].totalPnl += r.totalPnl;
        strategyTotals[r.strategyKey].totalTrades += r.totalTrades;
        strategyTotals[r.strategyKey].wins += r.wins;
        strategyTotals[r.strategyKey].losses += r.losses;
        strategyTotals[r.strategyKey].symbols++;
      }
    }

    const ranking = Object.entries(strategyTotals)
      .map(([key, data]) => ({
        strategyKey: key,
        ...data,
        winRate:
          data.totalTrades > 0
            ? Math.round((data.wins / data.totalTrades) * 10000) / 100
            : 0,
      }))
      .sort((a, b) => b.totalPnl - a.totalPnl);

    res.json({ symbols, days, ranking, details: allResults });
  }),
);

router.post(
  '/combo',
  validate({ body: comboSchema }),
  asyncHandler(async (req, res) => {
    const { symbol, strategies: selectedKeys, days, timeframe = '1Day', slippagePct, commissionPerTrade, oosRatio, minAdx } = req.body;
    const bars = await alpaca.getBars(symbol, timeframe, days);
    if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);
    const result = findBestCombos(bars, selectedKeys || null, {
      barsPerYear: barsPerYearForTimeframe(timeframe),
      slippagePct, commissionPerTrade, oosRatio, minAdx,
    });
    res.json({ symbol, barsCount: bars.length, days, ...result });
  }),
);

router.post(
  '/combo-multi',
  validate({ body: comboMultiSchema }),
  asyncHandler(async (req, res) => {
    const { symbols, strategies: selectedKeys, days, timeframe = '1Day', slippagePct, commissionPerTrade, oosRatio, minAdx } = req.body;
    const symbolBarsMap = {};
    for (const sym of symbols) {
      const bars = await alpaca.getBars(sym, timeframe, days);
      if (bars.length) symbolBarsMap[sym] = bars;
    }
    if (!Object.keys(symbolBarsMap).length) {
      throw new BadRequestError('No data for any symbol');
    }
    const result = await findBestCombosMulti(symbolBarsMap, selectedKeys || null, {
      barsPerYear: barsPerYearForTimeframe(timeframe),
      slippagePct, commissionPerTrade, oosRatio, minAdx,
    });
    res.json({ symbols, days, ...result });
  }),
);

// ─── Advanced backtesting ───────────────────────────────────────────────

// POST /backtest/monte-carlo — shuffle realized trades N times; returns P5/P50/P95.
router.post(
  '/monte-carlo',
  validate({ body: monteCarloSchema }),
  asyncHandler(async (req, res) => {
    const { strategy, symbol, days, timeframe = '1Day', runs, ...opts } = req.body;
    const bars = await alpaca.getBars(symbol, timeframe, days);
    if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);
    const base = backtest(strategy, bars, { barsPerYear: barsPerYearForTimeframe(timeframe), ...opts });
    const mc = monteCarloTrades(base.trades, { runs });
    res.json({ symbol, strategy, base: {
      totalPnl: base.totalPnl, winRate: base.winRate, totalTrades: base.totalTrades,
    }, monteCarlo: mc });
  }),
);

// POST /backtest/optimize — grid search; each point is a full IS/OOS backtest.
// Heavy endpoint; upstream should apply stricter rate limiting.
router.post(
  '/optimize',
  validate({ body: optimizerSchema }),
  asyncHandler(async (req, res) => {
    const { strategy, symbol, days, timeframe = '1Day', grid, oosRatio, topN } = req.body;
    const bars = await alpaca.getBars(symbol, timeframe, days);
    if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);
    const result = optimizeParams(strategy, bars, { grid, oosRatio, topN });
    res.json({ symbol, strategy, ...result });
  }),
);

// POST /backtest/regime — same backtest, but trades bucketed bull/bear/chop.
router.post(
  '/regime',
  validate({ body: regimeSchema }),
  asyncHandler(async (req, res) => {
    const { strategy, symbol, days, timeframe = '1Day', ...opts } = req.body;
    const bars = await alpaca.getBars(symbol, timeframe, days);
    if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);
    const result = regimeTaggedStats(strategy, bars, { barsPerYear: barsPerYearForTimeframe(timeframe), ...opts });
    res.json({ symbol, strategy, ...result });
  }),
);

// POST /backtest/portfolio — N legs against shared capital with concurrency cap.
router.post(
  '/portfolio',
  validate({ body: portfolioSchema }),
  asyncHandler(async (req, res) => {
    const { legs, days, timeframe = '1Day', initialCapital, maxConcurrent, positionPct, ...opts } = req.body;
    const barsBySymbol = {};
    const uniqueSymbols = [...new Set(legs.map((l) => l.symbol))];
    for (const sym of uniqueSymbols) {
      const bars = await alpaca.getBars(sym, timeframe, days);
      if (bars.length) barsBySymbol[sym] = bars;
    }
    if (!Object.keys(barsBySymbol).length) {
      throw new BadRequestError('No data for any symbol');
    }
    const result = portfolioBacktest(legs, barsBySymbol, {
      initialCapital, maxConcurrent, positionPct, barsPerYear: barsPerYearForTimeframe(timeframe), ...opts,
    });
    res.json(result);
  }),
);

// GET /backtest/benchmark/:symbol — buy-and-hold equity curve (default SPY).
router.get(
  '/benchmark/:symbol',
  validate({ params: backtestAllParams, query: benchmarkSchema.partial() }),
  asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    const days = Number.parseInt(req.query.days || 365, 10);
    const timeframe = req.query.timeframe || '1Day';
    const initialCapital = Number.parseFloat(req.query.initialCapital || 100000);
    const bars = await alpaca.getBars(symbol, timeframe, days);
    if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);
    res.json({ symbol, ...benchmarkBuyAndHold(bars, { initialCapital }) });
  }),
);

export default router;
