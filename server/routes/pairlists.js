import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { applyPairlists, PAIRLIST_HANDLERS } from '../services/pairlists.js';
import { BadRequestError } from '../errors.js';

const router = Router();

router.get('/handlers', (req, res) => {
  res.json({ handlers: PAIRLIST_HANDLERS });
});

router.post('/apply', asyncHandler(async (req, res) => {
  const { symbols, chain } = req.body || {};
  if (!Array.isArray(symbols) || !symbols.length) throw new BadRequestError('symbols[] required');
  if (!Array.isArray(chain)) throw new BadRequestError('chain[] required');
  if (symbols.length > 500) throw new BadRequestError('max 500 symbols');
  const result = await applyPairlists(symbols, chain);
  res.json(result);
}));

export default router;
