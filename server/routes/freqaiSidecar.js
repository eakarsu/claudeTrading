import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import * as alpaca from '../services/alpaca.js';
import * as sidecar from '../services/freqaiSidecar.js';
import { BadRequestError } from '../errors.js';

/**
 * FreqAI sidecar proxy — thin pass-through to an external Python service.
 *
 *   GET  /status                             health + backends
 *   GET  /models                             list sidecar-trained models
 *   DELETE /models/:id
 *   POST /train    { symbol, days?, timeframe?, features?, target? }
 *   POST /predict  { modelId, symbol, days?, timeframe? }
 *
 * When FREQAI_PY_URL isn't set every call returns { configured: false, ... }
 * so the UI can surface a "not configured" state without errors.
 */

const router = Router();

router.get('/status', asyncHandler(async (_req, res) => {
  res.json({ configured: sidecar.isConfigured(), ...(await sidecar.health()) });
}));

router.get('/models', asyncHandler(async (_req, res) => {
  res.json(await sidecar.listModels());
}));

router.delete('/models/:id', asyncHandler(async (req, res) => {
  res.json(await sidecar.deleteModel(req.params.id));
}));

router.post('/train', asyncHandler(async (req, res) => {
  const { symbol, days = 365, timeframe = '1Day', features, target, backend } = req.body || {};
  if (!symbol) throw new BadRequestError('symbol required');
  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, Math.min(Number(days) || 365, 3650));
  res.json(await sidecar.train({ symbol: symbol.toUpperCase(), timeframe, bars, features, target, backend }));
}));

router.post('/predict', asyncHandler(async (req, res) => {
  const { modelId, symbol, days = 30, timeframe = '1Day' } = req.body || {};
  if (!modelId) throw new BadRequestError('modelId required');
  if (!symbol) throw new BadRequestError('symbol required');
  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, Math.min(Number(days) || 30, 3650));
  res.json(await sidecar.predict({ modelId, symbol: symbol.toUpperCase(), timeframe, bars }));
}));

export default router;
