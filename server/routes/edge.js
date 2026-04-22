import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { getEdges } from '../services/edge.js';
import { AutoTraderTrade } from '../models/index.js';
import { BadRequestError } from '../errors.js';
import { Op } from 'sequelize';

/**
 * Edge positioning diagnostic — returns per-symbol win-rate, expectancy,
 * and edge ratio derived from the caller's recent closed trades.
 */

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const raw = (req.query.symbols || '').toString().trim();
  if (!raw) throw new BadRequestError('symbols query param required (comma-separated)');
  const symbols = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 50);
  const lookbackDays = Math.max(1, Math.min(365, Number(req.query.lookbackDays) || 30));
  const minTrades = Math.max(1, Math.min(100, Number(req.query.minTrades) || 5));
  const items = await getEdges(req.userId, symbols, { lookbackDays, minTrades });
  res.json({ lookbackDays, minTrades, items });
}));

// /all — compute edge across every symbol the user has closed trades on.
// Equivalent to freqtrade's `edge` CLI command. Self-scoping to traded
// symbols so we don't waste cycles on stuff the user has never touched.
router.get('/all', asyncHandler(async (req, res) => {
  const lookbackDays = Math.max(1, Math.min(365, Number(req.query.lookbackDays) || 30));
  const minTrades = Math.max(1, Math.min(100, Number(req.query.minTrades) || 5));
  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  const rows = await AutoTraderTrade.findAll({
    where: {
      userId: req.userId ?? null,
      action: 'sell',
      pnl: { [Op.ne]: null },
      createdAt: { [Op.gte]: since },
    },
    attributes: ['symbol'],
    group: ['symbol'],
    raw: true,
  });
  const symbols = rows.map((r) => r.symbol);
  if (!symbols.length) return res.json({ lookbackDays, minTrades, items: [] });
  const items = await getEdges(req.userId, symbols, { lookbackDays, minTrades });
  // Sort by expectancy desc so the strongest pairs float to the top.
  items.sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
  res.json({ lookbackDays, minTrades, items });
}));

export default router;
