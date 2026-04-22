import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import * as alpaca from '../services/alpaca.js';
import { trainAndScore, predictLast } from '../services/freqaiLite.js';
import { saveModel, listModels, deleteModel, walkForward, trainByType } from '../services/freqaiFull.js';
import { BadRequestError } from '../errors.js';

/**
 * FreqAI-lite endpoints — train a logistic-regression next-bar-direction
 * classifier on a symbol and return the model summary + current prediction.
 */

const router = Router();

router.post('/train', asyncHandler(async (req, res) => {
  const { symbol, days = 730, timeframe = '1Day', oosRatio = 0.3 } = req.body || {};
  if (!symbol || typeof symbol !== 'string') throw new BadRequestError('symbol required');
  const d = Number(days);
  if (!Number.isFinite(d) || d < 120 || d > 3650) throw new BadRequestError('days must be 120..3650');
  const oos = Number(oosRatio);
  if (!Number.isFinite(oos) || oos < 0.1 || oos > 0.5) throw new BadRequestError('oosRatio must be 0.1..0.5');

  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, d);
  if (bars.length < 200) throw new BadRequestError(`Need ≥200 bars; got ${bars.length}`);

  const splitIdx = Math.floor(bars.length * (1 - oos));
  const trainBars = bars.slice(0, splitIdx);
  const scoreBars = bars.slice(splitIdx - 50);  // 50-bar overlap so the first scored bar has warmup

  const { model, oosSamples, oosAccuracy } = trainAndScore(trainBars, scoreBars);
  const upProbNow = predictLast(model, bars);

  res.json({
    symbol: symbol.toUpperCase(),
    days: d, timeframe,
    trainBars: trainBars.length,
    trainSamples: model.trainSamples,
    trainAccuracy: round4(model.trainAccuracy),
    oosSamples, oosAccuracy: round4(oosAccuracy),
    featureNames: model.featureNames,
    weights: model.weights.map(round4),
    bias: round4(model.bias),
    upProbabilityNow: upProbNow != null ? round4(upProbNow) : null,
  });
}));

function round4(n) { return Math.round(n * 10000) / 10000; }

// ─── Full FreqAI: persistence + walk-forward ───
router.post('/save', asyncHandler(async (req, res) => {
  const { symbol, timeframe = '1Day', modelType = 'logreg', days = 730, oosRatio = 0.3 } = req.body || {};
  if (!symbol) throw new BadRequestError('symbol required');
  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, Number(days));
  if (bars.length < 200) throw new BadRequestError(`Need ≥200 bars; got ${bars.length}`);
  const splitIdx = Math.floor(bars.length * (1 - Number(oosRatio)));
  const trainBars = bars.slice(0, splitIdx);
  const scoreBars = bars.slice(splitIdx - 50);
  const model = trainByType(modelType, trainBars);
  // Score by direction accuracy on held-out slice (reuse trainAndScore path).
  const { oosSamples, oosAccuracy } = trainAndScore(trainBars, scoreBars);
  const saved = await saveModel({
    userId: req.userId, symbol: symbol.toUpperCase(), timeframe, modelType,
    model, oosSamples, oosAccuracy,
    trainWindowEnd: new Date(trainBars[trainBars.length - 1].time),
  });
  res.status(201).json(saved);
}));

router.get('/models', asyncHandler(async (req, res) => {
  const items = await listModels(req.userId, { symbol: req.query.symbol?.toString().toUpperCase() });
  res.json({ items });
}));

router.delete('/models/:id', asyncHandler(async (req, res) => {
  const ok = await deleteModel(req.userId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Model not found' });
  res.json({ ok: true });
}));

router.post('/walk-forward', asyncHandler(async (req, res) => {
  const { symbol, days = 730, timeframe = '1Day', trainSize = 250, testSize = 50, modelType = 'logreg' } = req.body || {};
  if (!symbol) throw new BadRequestError('symbol required');
  const result = await walkForward(symbol, {
    days: Number(days), timeframe,
    trainSize: Math.max(50, Math.min(2000, Number(trainSize))),
    testSize:  Math.max(10, Math.min(500, Number(testSize))),
    modelType,
  });
  res.json(result);
}));

export default router;
