import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { validate } from '../middleware/validate.js';
import { tradeLimiter } from '../middleware/rateLimit.js';
import { audit } from '../middleware/audit.js';
import { autoTraderStartSchema, autoTraderTagsSchema, idParam, symbolSchema } from '../schemas.js';
import { z } from 'zod';
import {
  startAutoTrader,
  stopAutoTrader,
  getAutoTraderStatus,
} from '../services/autoTrader.js';
import { AutoTraderTrade, TradeJournal } from '../models/index.js';
import { NotFoundError } from '../errors.js';
import { toCsv } from '../services/csv.js';
import { Op } from 'sequelize';

const router = Router();

// Every auto-trader mutation is scoped to req.userId — each user controls only
// their own state row. Legacy rows with NULL userId are visible via the `Op.or`
// pattern used elsewhere; once touched they get stamped with the current user.
const scopedTradeWhere = (req) => ({ userId: { [Op.or]: [req.userId, null] } });

router.post(
  '/start',
  tradeLimiter,
  validate({ body: autoTraderStartSchema }),
  audit('auto-trader.start', 'auto-trader', { captureBody: true }),
  asyncHandler(async (req, res) => {
    const { strategy, symbols, config } = req.body;
    res.json(await startAutoTrader(req.userId, strategy, symbols, config));
  }),
);

router.post(
  '/stop',
  audit('auto-trader.stop', 'auto-trader'),
  asyncHandler(async (req, res) => {
    res.json(await stopAutoTrader(req.userId));
  }),
);

router.get('/status', asyncHandler(async (req, res) => {
  res.json(await getAutoTraderStatus(req.userId));
}));

/**
 * PATCH /api/auto-trader/trades/:id/tags
 * Updates the trade tags array. Tags are freeform labels (≤32 chars, max 10).
 * Useful for post-hoc categorization ("scalp", "news-driven", "mistake").
 */
router.patch(
  '/trades/:id/tags',
  validate({ params: idParam, body: autoTraderTagsSchema }),
  asyncHandler(async (req, res) => {
    const trade = await AutoTraderTrade.findOne({
      where: { id: req.params.id, ...scopedTradeWhere(req) },
    });
    if (!trade) throw new NotFoundError('Auto trade');
    trade.tags = req.body.tags;
    if (trade.userId == null) trade.userId = req.userId;
    await trade.save();
    res.json(trade.toJSON());
  }),
);

/**
 * POST /api/auto-trader/trades/:id/journal
 * Copies an auto-trader trade into the user's TradeJournal. Used when a trade
 * is notable enough to review / annotate later. We carry over tags + strategy
 * into the journal note so it stays searchable.
 */
router.post(
  '/trades/:id/journal',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const trade = await AutoTraderTrade.findOne({
      where: { id: req.params.id, ...scopedTradeWhere(req) },
    });
    if (!trade) throw new NotFoundError('Auto trade');
    const notes = [
      trade.reason || '',
      (trade.tags || []).map((t) => `#${t}`).join(' '),
      `Strategy: ${trade.strategy || '—'}`,
    ].filter(Boolean).join('\n');
    const entry = await TradeJournal.create({
      userId: req.userId,
      symbol: trade.symbol,
      action: trade.action,
      qty: Math.round(parseFloat(trade.qty) || 0),
      entryPrice: trade.action === 'buy' ? trade.price : null,
      exitPrice:  trade.action === 'sell' ? trade.price : null,
      tradeDate: (trade.createdAt || new Date()).toISOString().slice(0, 10),
      pnl: trade.pnl ?? null,
      notes,
      strategy: trade.strategy,
    });
    res.status(201).json(entry.toJSON());
  }),
);

/**
 * GET /api/auto-trader/trades
 * Paginated list of this user's auto-trader trades. Filter by symbol /
 * strategy / tag for the replay UI. Returns { items, total } with the same
 * shape as the CRUD routes for consistency.
 */
router.get(
  '/trades',
  validate({
    query: z.object({
      symbol:   symbolSchema.optional(),
      strategy: z.string().max(64).optional(),
      tag:      z.string().max(32).optional(),
      limit:    z.coerce.number().int().positive().max(500).default(100),
      offset:   z.coerce.number().int().nonnegative().default(0),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { symbol, strategy, tag, limit, offset } = req.query;
    const where = { ...scopedTradeWhere(req) };
    if (symbol)   where.symbol = symbol;
    if (strategy) where.strategy = strategy;
    const { rows, count } = await AutoTraderTrade.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit, offset,
    });
    // Tag filtering in JS so we stay dialect-portable (JSON containment syntax
    // differs between Postgres and SQLite and the set is small here).
    let items = rows.map((r) => r.toJSON());
    if (tag) items = items.filter((r) => Array.isArray(r.tags) && r.tags.includes(tag));
    res.json({ items, total: count, limit, offset });
  }),
);

/**
 * GET /api/auto-trader/trades/export.csv
 * Exports this user's auto-trader trade history as CSV. Useful for tax prep
 * and external analytics. We cap at 5000 rows so a runaway request doesn't
 * stream an unbounded response.
 *
 * NOTE: declared before /trades/:id so Express matches the literal path
 * before falling through to the parameterized route.
 */
router.get('/trades/export.csv', asyncHandler(async (req, res) => {
  const trades = await AutoTraderTrade.findAll({
    where: scopedTradeWhere(req),
    order: [['createdAt', 'DESC']],
    limit: 5000,
  });
  const csv = toCsv(
    trades.map((t) => t.toJSON()),
    ['id', 'createdAt', 'symbol', 'action', 'qty', 'price', 'pnl', 'strategy', 'reason', 'orderId', 'tags'],
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="trades-${Date.now()}.csv"`);
  res.send(csv);
}));

/**
 * GET /api/auto-trader/trades/:id
 * Full trade detail — includes entryContext (indicator snapshot at entry
 * time) for the replay UI to render overlays.
 */
router.get(
  '/trades/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const trade = await AutoTraderTrade.findOne({
      where: { id: req.params.id, ...scopedTradeWhere(req) },
    });
    if (!trade) throw new NotFoundError('Auto trade');
    res.json(trade.toJSON());
  }),
);

export default router;
