import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { getAdapter, listExchanges } from '../services/exchanges/registry.js';
import { BadRequestError } from '../errors.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json({ exchanges: await listExchanges() });
}));

router.get('/:id/bars', asyncHandler(async (req, res) => {
  const { symbol, timeframe = '1Day', limit = 200 } = req.query;
  if (!symbol) throw new BadRequestError('symbol required');
  const a = await getAdapter(req.params.id);
  const bars = await a.getBars(String(symbol).toUpperCase(), timeframe, Math.min(1000, Number(limit)));
  res.json({ exchange: a.id, symbol, bars });
}));

router.get('/:id/quote', asyncHandler(async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) throw new BadRequestError('symbol required');
  const a = await getAdapter(req.params.id);
  const q = await a.getLatestQuote(String(symbol).toUpperCase());
  res.json({ exchange: a.id, symbol, quote: q });
}));

router.get('/:id/positions', asyncHandler(async (req, res) => {
  const a = await getAdapter(req.params.id);
  res.json({ exchange: a.id, positions: await a.getPositions() });
}));

export default router;
