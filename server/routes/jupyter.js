import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { SavedBacktest, AutoTraderTrade } from '../models/index.js';
import * as alpaca from '../services/alpaca.js';
import {
  tradesCsv, equityCsv, barsCsv, analysisNotebook,
} from '../services/jupyterExport.js';
import { BadRequestError, NotFoundError } from '../errors.js';

/**
 * Jupyter export endpoints — emit CSV + .ipynb files so users can drop a
 * backtest result into their own notebook for deeper analysis.
 *
 *   GET /saved/:id/trades.csv
 *   GET /saved/:id/equity.csv
 *   GET /saved/:id/notebook.ipynb
 *   GET /live/trades.csv              — exports live auto-trader trades
 *   GET /bars.csv?symbol=SPY&days=365&timeframe=1Day
 */

const router = Router();

function attach(res, filename, mime = 'text/csv; charset=utf-8') {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

router.get('/saved/:id/trades.csv', asyncHandler(async (req, res) => {
  const row = await SavedBacktest.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Saved backtest not found');
  attach(res, `trades-${row.id}.csv`);
  res.send(tradesCsv(row.result?.trades || []));
}));

router.get('/saved/:id/equity.csv', asyncHandler(async (req, res) => {
  const row = await SavedBacktest.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Saved backtest not found');
  attach(res, `equity-${row.id}.csv`);
  res.send(equityCsv(row.result?.equityCurve || []));
}));

router.get('/saved/:id/notebook.ipynb', asyncHandler(async (req, res) => {
  const row = await SavedBacktest.findOne({ where: { id: req.params.id, userId: req.userId } });
  if (!row) throw new NotFoundError('Saved backtest not found');
  attach(res, `analysis-${row.id}.ipynb`, 'application/x-ipynb+json');
  res.send(JSON.stringify(analysisNotebook({ name: row.name || `backtest-${row.id}` }), null, 2));
}));

router.get('/live/trades.csv', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 5000, 20_000);
  const rows = await AutoTraderTrade.findAll({
    where: { userId: req.userId },
    order: [['createdAt', 'ASC']],
    limit,
  });
  // AutoTraderTrade rows are order-level, not closed-trade-level. Emit them
  // as-is so the user can pair/reduce in pandas themselves.
  const trades = rows.map((r) => ({
    symbol: r.symbol,
    entryTime: r.createdAt,
    exitTime:  null,
    entry:     r.action === 'BUY' ? r.price : null,
    exit:      r.action === 'SELL' ? r.price : null,
    pnl:       r.pnl,
    pnlPct:    null,
    strategy:  r.strategy,
    reason:    r.reason,
    leverage:  r.leverage,
  }));
  attach(res, 'live-trades.csv');
  res.send(tradesCsv(trades));
}));

router.get('/bars.csv', asyncHandler(async (req, res) => {
  const { symbol, timeframe = '1Day', days = 365 } = req.query;
  if (!symbol) throw new BadRequestError('symbol query param required');
  const d = Math.min(Number(days) || 365, 3650);
  const bars = await alpaca.getBars(symbol.toUpperCase(), timeframe, d);
  attach(res, `bars-${symbol.toUpperCase()}-${timeframe}.csv`);
  res.send(barsCsv(bars));
}));

export default router;
