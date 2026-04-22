import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import * as alpaca from '../services/alpaca.js';
import { getLatestTradePrices } from '../services/priceCache.js';
import { TradeSignal } from '../models/index.js';

const router = Router();

function round2(n) { return Math.round(n * 100) / 100; }

router.get('/live', asyncHandler(async (req, res) => {
  const signals = await TradeSignal.findAll({ order: [['confidence', 'DESC']] });
  if (!signals.length) return res.json({ signals: [], live: false });

  let marketOpen = false;
  try {
    const clock = await alpaca.getClock();
    marketOpen = clock?.is_open === true;
  } catch {
    return res.json({ signals, live: false, market: 'unknown' });
  }

  if (!marketOpen) return res.json({ signals, live: false, market: 'closed' });

  const symbols = [...new Set(signals.map((s) => s.symbol))];
  let livePrices = {};
  try {
    livePrices = await getLatestTradePrices(symbols);
  } catch (err) {
    return res.json({ signals, live: false, market: 'open', priceError: err.message });
  }

  const liveSignals = signals.map((s) => {
    const plain = s.toJSON();
    const livePrice = livePrices[s.symbol]?.p ?? null;
    if (!livePrice) return { ...plain, livePrice: null };

    const distFromEntry = ((livePrice - plain.entryPrice) / plain.entryPrice) * 100;
    const distToTarget = ((plain.targetPrice - livePrice) / plain.targetPrice) * 100;
    const distToStop = ((livePrice - plain.stopPrice) / plain.stopPrice) * 100;

    let liveAction =
      plain.signalType === 'bullish' ? 'buy'
      : plain.signalType === 'bearish' ? 'sell'
      : 'hold';

    if (plain.signalType === 'bullish') {
      if (livePrice <= plain.entryPrice * 1.01) liveAction = 'strong_buy';
      else if (livePrice >= plain.targetPrice * 0.95) liveAction = 'take_profit';
      else if (livePrice <= plain.stopPrice) liveAction = 'stopped_out';
      else liveAction = 'hold_long';
    } else if (plain.signalType === 'bearish') {
      if (livePrice >= plain.entryPrice * 0.99) liveAction = 'strong_sell';
      else if (livePrice <= plain.targetPrice * 1.05) liveAction = 'take_profit';
      else if (livePrice >= plain.stopPrice) liveAction = 'stopped_out';
      else liveAction = 'hold_short';
    }

    return {
      ...plain,
      livePrice: round2(livePrice),
      liveAction,
      distFromEntry: round2(distFromEntry),
      distToTarget: round2(distToTarget),
      distToStop: round2(distToStop),
    };
  });

  res.json({ signals: liveSignals, live: true, market: 'open' });
}));

export default router;
