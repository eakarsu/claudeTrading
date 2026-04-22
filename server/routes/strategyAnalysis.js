import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import * as alpaca from '../services/alpaca.js';
import { STRATEGIES } from '../services/strategyEngine.js';
import { lookaheadAnalysis } from '../services/analyses/lookahead.js';
import { recursiveAnalysis } from '../services/analyses/recursive.js';
import { BadRequestError } from '../errors.js';

/**
 * Strategy-quality analyses on top of a strategy's signal output.
 *
 * - /lookahead: verifies the strategy's historical signals don't change when
 *   more future bars become available (no peeking into the future).
 * - /recursive: verifies the latest bar's signal is stable across different
 *   amounts of preceding history (sufficient startup candles).
 */

const router = Router();

function parseBody(body) {
  if (!body || typeof body !== 'object') throw new BadRequestError('Body required');
  const { strategyKey, symbol, days = 365, timeframe = '1Day' } = body;
  if (!strategyKey || !STRATEGIES[strategyKey]) {
    throw new BadRequestError(`unknown strategyKey: ${strategyKey}`);
  }
  if (!symbol || typeof symbol !== 'string') throw new BadRequestError('symbol required');
  const d = Number(days);
  if (!Number.isFinite(d) || d < 30 || d > 3650) throw new BadRequestError('days must be 30..3650');
  return { strategyKey, symbol: symbol.toUpperCase(), days: d, timeframe };
}

router.post('/lookahead', asyncHandler(async (req, res) => {
  const { strategyKey, symbol, days, timeframe } = parseBody(req.body);
  const stride = Math.max(1, Math.min(200, Number(req.body.stride) || 25));
  const minBars = Math.max(50, Math.min(500, Number(req.body.minBars) || 100));

  const bars = await alpaca.getBars(symbol, timeframe, days);
  if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);

  const result = lookaheadAnalysis(strategyKey, bars, { stride, minBars });
  res.json({ symbol, days, timeframe, ...result });
}));

router.post('/recursive', asyncHandler(async (req, res) => {
  const { strategyKey, symbol, days, timeframe } = parseBody(req.body);
  const startupCandles = Math.max(10, Math.min(500, Number(req.body.startupCandles) || 50));
  const stride = Math.max(10, Math.min(500, Number(req.body.stride) || 50));
  const maxWindows = Math.max(3, Math.min(30, Number(req.body.maxWindows) || 12));

  const bars = await alpaca.getBars(symbol, timeframe, days);
  if (!bars.length) throw new BadRequestError(`No historical data for ${symbol}`);

  const result = recursiveAnalysis(strategyKey, bars, { startupCandles, stride, maxWindows });
  res.json({ symbol, days, timeframe, ...result });
}));

export default router;
