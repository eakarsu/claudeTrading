/**
 * Strategy A/B Harness — run two strategies in shadow mode against the same
 * live signal stream and compare realized vs theoretical P&L. The harness
 * never sends orders to the broker; both sides simulate fills against latest
 * trade prices and persist trades to StrategyAbTrade for the UI to chart.
 *
 * Endpoints:
 *   GET  /api/strategy-ab            — paginated list of runs
 *   POST /api/strategy-ab            — create a run config
 *   GET  /api/strategy-ab/:id        — run detail with results summary
 *   GET  /api/strategy-ab/:id/trades — paginated per-side trade history
 *   POST /api/strategy-ab/:id/start  — begin polling + simulation
 *   POST /api/strategy-ab/:id/stop   — halt the loop, finalize stats
 *   POST /api/strategy-ab/:id/critique — AI critique of the comparison
 *   DELETE /api/strategy-ab/:id      — remove a run (and its trades)
 */
import { Router } from 'express';
import { Op } from 'sequelize';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { idParam, paginationQuery } from '../schemas.js';
import { NotFoundError, BadRequestError } from '../errors.js';
import { StrategyAbRun, StrategyAbTrade } from '../models/index.js';
import { askAI } from '../services/openrouter.js';
import { wrapUserContent } from '../services/promptSafety.js';
import { runStrategy, STRATEGIES } from '../services/strategyEngine.js';
import * as alpaca from '../services/alpaca.js';
import { getLatestTradePrices } from '../services/priceCache.js';
import { logger } from '../logger.js';

const router = Router();

// In-memory tick loops keyed by runId. Survives across requests, lost on
// restart — caller should re-start runs after a deploy.
const loops = new Map();

const createSchema = z.object({
  name: z.string().min(1).max(80),
  strategyA: z.string(),
  strategyB: z.string(),
  symbols: z.array(z.string().min(1).max(10)).min(1).max(20),
  config: z.object({
    timeframe: z.string().default('1Day'),
    intervalMs: z.number().int().min(5000).max(900000).default(60000),
    notional: z.number().positive().default(1000),
  }).default({}),
});

router.get('/', validate({ query: paginationQuery }), asyncHandler(async (req, res) => {
  const { limit, offset } = req.query;
  const { rows, count } = await StrategyAbRun.findAndCountAll({
    where: { userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit, offset,
  });
  res.json({ items: rows, total: count, limit, offset });
}));

router.post('/', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  const { name, strategyA, strategyB, symbols, config } = req.body;
  if (!STRATEGIES[strategyA]) throw new BadRequestError(`Unknown strategy: ${strategyA}`);
  if (!STRATEGIES[strategyB]) throw new BadRequestError(`Unknown strategy: ${strategyB}`);
  const run = await StrategyAbRun.create({
    userId: req.userId,
    name, strategyA, strategyB,
    symbols: symbols.map((s) => s.toUpperCase()),
    config,
    status: 'idle',
  });
  res.status(201).json(run);
}));

router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const run = await StrategyAbRun.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!run) throw new NotFoundError('A/B run not found');
  // Refresh stats from trades.
  const stats = await computeStats(run.id);
  await run.update({ results: stats });
  res.json(run);
}));

router.get('/:id/trades', validate({ params: idParam, query: paginationQuery }), asyncHandler(async (req, res) => {
  const run = await StrategyAbRun.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!run) throw new NotFoundError('A/B run not found');
  const { limit, offset } = req.query;
  const { rows, count } = await StrategyAbTrade.findAndCountAll({
    where: { runId: run.id },
    order: [['tradeAt', 'DESC']],
    limit, offset,
  });
  res.json({ items: rows, total: count, limit, offset });
}));

router.post('/:id/start', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const run = await StrategyAbRun.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!run) throw new NotFoundError('A/B run not found');
  if (loops.has(run.id)) throw new BadRequestError('Run already started');
  await run.update({ status: 'running', startedAt: new Date(), stoppedAt: null });
  scheduleLoop(run);
  res.json({ ok: true, status: 'running' });
}));

router.post('/:id/stop', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const run = await StrategyAbRun.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!run) throw new NotFoundError('A/B run not found');
  cancelLoop(run.id);
  const stats = await computeStats(run.id);
  await run.update({ status: 'stopped', stoppedAt: new Date(), results: stats });
  res.json({ ok: true, status: 'stopped', results: stats });
}));

router.post('/:id/critique', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const run = await StrategyAbRun.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!run) throw new NotFoundError('A/B run not found');
  const stats = await computeStats(run.id);
  const prompt = wrapUserContent(
    `Strategy A/B comparison for run "${run.name}".\n` +
    `Side A (${run.strategyA}) — ${JSON.stringify(stats.A)}\n` +
    `Side B (${run.strategyB}) — ${JSON.stringify(stats.B)}\n` +
    `Symbols: ${run.symbols.join(', ')}.\n\n` +
    'Compare the two sides. Identify which performed better in trade frequency, ' +
    'win rate, average P&L per trade, and overall return. Suggest one specific ' +
    'parameter or guardrail change that would have helped the loser.'
  );
  const result = await askAI(prompt, '', { userId: req.userId });
  await run.update({
    aiResults: {
      critique: result.content,
      model: result.model,
      usage: result.usage,
      generatedAt: new Date().toISOString(),
    },
    results: stats,
  });
  res.json({ analysis: result.content, model: result.model, usage: result.usage, results: stats });
}));

router.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const run = await StrategyAbRun.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!run) throw new NotFoundError('A/B run not found');
  cancelLoop(run.id);
  await StrategyAbTrade.destroy({ where: { runId: run.id } });
  await run.destroy();
  res.json({ success: true });
}));

// ─── Loop machinery ───
function scheduleLoop(run) {
  const intervalMs = run.config?.intervalMs || 60000;
  // Track open positions per side per symbol so simulated trades pair entries
  // with exits to compute realized P&L.
  const state = { A: {}, B: {} };
  const tick = async () => {
    try {
      await runTick(run, state);
    } catch (err) {
      logger.warn({ err, runId: run.id }, 'A/B harness tick failed');
    }
  };
  // Fire immediately, then on interval. Save handle so /stop can cancel it.
  tick();
  const handle = setInterval(tick, intervalMs);
  loops.set(run.id, handle);
}

function cancelLoop(runId) {
  const h = loops.get(runId);
  if (h) {
    clearInterval(h);
    loops.delete(runId);
  }
}

async function runTick(run, state) {
  const tf = run.config?.timeframe || '1Day';
  const notional = run.config?.notional || 1000;
  const symbols = run.symbols || [];
  if (!symbols.length) return;
  // Fetch enough bars for indicators (200 covers SMA200).
  const barsBySymbol = await Promise.all(symbols.map(async (s) => ({
    symbol: s,
    bars: await alpaca.getBars(s, tf, 220).catch(() => []),
  })));
  const latest = await getLatestTradePrices(symbols, { maxAgeMs: 60_000 }).catch(() => ({}));

  for (const { symbol, bars } of barsBySymbol) {
    if (!bars.length) continue;
    for (const side of ['A', 'B']) {
      const strategyKey = side === 'A' ? run.strategyA : run.strategyB;
      let sigs;
      try {
        sigs = runStrategy(strategyKey, bars) || [];
      } catch (err) {
        logger.warn({ err, strategyKey }, 'A/B harness: strategy run failed');
        continue;
      }
      // Take only the LAST signal — we're shadowing live, not replaying history.
      const last = sigs.length ? sigs[sigs.length - 1] : null;
      if (!last || last.index !== bars.length - 1) continue;
      const px = latest[symbol]?.p ?? bars[bars.length - 1].c;
      const open = state[side][symbol];
      if (last.action === 'buy' && !open) {
        const qty = +(notional / px).toFixed(4);
        await StrategyAbTrade.create({
          runId: run.id, side, symbol, action: 'buy', qty, price: px, pnl: 0,
        });
        state[side][symbol] = { qty, entry: px };
      } else if (last.action === 'sell' && open) {
        const pnl = +((px - open.entry) * open.qty).toFixed(2);
        await StrategyAbTrade.create({
          runId: run.id, side, symbol, action: 'sell', qty: open.qty, price: px, pnl,
        });
        delete state[side][symbol];
      }
    }
  }
}

async function computeStats(runId) {
  const trades = await StrategyAbTrade.findAll({ where: { runId } });
  const sides = { A: { trades: 0, pnl: 0, wins: 0, losses: 0 }, B: { trades: 0, pnl: 0, wins: 0, losses: 0 } };
  for (const t of trades) {
    const s = sides[t.side];
    if (!s) continue;
    if (t.action === 'sell') {
      s.trades++;
      s.pnl += Number(t.pnl) || 0;
      if (Number(t.pnl) > 0) s.wins++;
      else if (Number(t.pnl) < 0) s.losses++;
    }
  }
  for (const k of ['A', 'B']) {
    const s = sides[k];
    s.winRate = s.trades ? +(s.wins / s.trades * 100).toFixed(1) : 0;
    s.pnl = +s.pnl.toFixed(2);
  }
  return sides;
}

export default router;
