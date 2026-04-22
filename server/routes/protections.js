import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { AutoTraderState } from '../models/index.js';
import { summarizeProtections } from '../services/protections.js';

/**
 * Protections diagnostic endpoint — returns whether each configured symbol is
 * currently blocked by a protection rule, and why. The user's active
 * AutoTraderState.config supplies the protection config; if the user has no
 * state row, protections aren't configured.
 */

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const state = await AutoTraderState.findOne({ where: { userId: req.userId } });
  if (!state) {
    return res.json({ configured: false, symbols: [] });
  }
  const config = state.config || {};
  const symbols = Array.isArray(config.symbols) && config.symbols.length
    ? config.symbols
    : (req.query.symbols ? String(req.query.symbols).split(',') : []);
  const result = await summarizeProtections({
    userId: req.userId, config, symbols: symbols.map((s) => s.toUpperCase()),
  });
  res.json({ configured: !!config.protections, ...result });
}));

export default router;
