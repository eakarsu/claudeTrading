import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { liquidationPrice, marginRequired, unrealizedPnlPct, isLiquidated } from '../services/leverage.js';
import { AutoTraderTrade } from '../models/index.js';
import { BadRequestError } from '../errors.js';

/**
 * Leverage / margin endpoints.
 *
 *   POST /calc           one-off liquidation-price calculator
 *   GET  /trades         AutoTraderTrade rows that were opened with leverage,
 *                        augmented with liq price + unrealized % at current price
 */

const router = Router();

router.post('/calc', asyncHandler(async (req, res) => {
  const { entry, leverage, side = 'long', marginMode = 'isolated', maintenanceMargin, qty, current } = req.body || {};
  if (!Number.isFinite(Number(entry))) throw new BadRequestError('entry (number) required');
  const result = {
    liquidationPrice: liquidationPrice({ entry: Number(entry), leverage, side, marginMode, maintenanceMargin }),
    marginRequired:   qty != null ? marginRequired({ entry: Number(entry), qty: Number(qty), leverage }) : null,
    unrealizedPnlPct: current != null ? unrealizedPnlPct({ entry: Number(entry), current: Number(current), leverage, side }) : null,
    liquidated:       current != null ? isLiquidated({ entry: Number(entry), current: Number(current), leverage, side, marginMode, maintenanceMargin }) : null,
  };
  res.json(result);
}));

router.get('/trades', asyncHandler(async (req, res) => {
  const rows = await AutoTraderTrade.findAll({
    where: { userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit: 200,
  });
  // Augment with derived fields (liq price, margin). Cash trades (leverage<=1)
  // get null fields so the frontend can render a clean "—".
  const augmented = rows.map((r) => {
    const lev = r.leverage || 1;
    const side = r.action === 'sell' ? 'short' : 'long';
    return {
      id: r.id,
      symbol: r.symbol,
      action: r.action,
      qty: r.qty,
      price: r.price,
      leverage: lev,
      marginMode: r.marginMode,
      liquidationPrice: r.liquidationPrice
        ?? liquidationPrice({ entry: r.price, leverage: lev, side, marginMode: r.marginMode }),
      marginRequired: marginRequired({ entry: r.price, qty: r.qty, leverage: lev }),
      fundingFees: r.fundingFees || 0,
      pnl: r.pnl,
      createdAt: r.createdAt,
    };
  });
  res.json({ items: augmented });
}));

export default router;
