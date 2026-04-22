import './env.js';
import sequelize from './db.js';
import bcryptjs from 'bcryptjs';
import {
  User, TrailingStop, CopyTrade, WheelStrategy, WatchlistItem,
  TradeJournal, PriceAlert, TradeSignal, StockScreener,
  RiskAssessment, PortfolioItem, Sentiment, OptionsChain, MarketNews,
  AutoTraderTrade, Notification,
  Theme, ThemeConstituent,
} from './models/index.js';
import { seedAiManifesto } from './data/aiManifesto.js';

async function seed() {
  const reset = process.argv.includes('--reset');
  try {
    if (reset) {
      await sequelize.sync({ force: true });
      console.log('  Database reset (force: true).');
    } else {
      await sequelize.sync();
      console.log('  Database synced (non-destructive). Pass --reset to drop tables.');
    }

    // When not resetting, skip re-seeding if data already exists.
    if (!reset) {
      const existing = await User.count();
      if (existing > 0) {
        console.log('  Existing data detected — skipping seed. Pass --reset to repopulate.');
        process.exit(0);
      }
    }

    // ─── User ───
    const hashedPw = await bcryptjs.hash('trading123', 10);
    await User.create({ email: 'trader@claude.ai', password: hashedPw, name: 'Demo Trader' });

    // ─── Trailing Stops (15) ───
    await TrailingStop.bulkCreate([
      { symbol: 'TSLA', qty: 10, entryPrice: 248.50, currentPrice: 262.30, stopLossPct: 10, trailPct: 5, floorPrice: 249.18, highestPrice: 262.30, status: 'active' },
      { symbol: 'NVDA', qty: 15, entryPrice: 135.20, currentPrice: 148.90, stopLossPct: 8, trailPct: 4, floorPrice: 142.94, highestPrice: 148.90, status: 'active' },
      { symbol: 'AAPL', qty: 20, entryPrice: 189.50, currentPrice: 195.80, stopLossPct: 7, trailPct: 3, floorPrice: 189.93, highestPrice: 195.80, status: 'active' },
      { symbol: 'AMZN', qty: 8, entryPrice: 185.00, currentPrice: 192.40, stopLossPct: 10, trailPct: 5, floorPrice: 182.78, highestPrice: 192.40, status: 'active' },
      { symbol: 'MSFT', qty: 12, entryPrice: 415.30, currentPrice: 428.70, stopLossPct: 8, trailPct: 4, floorPrice: 411.55, highestPrice: 428.70, status: 'active' },
      { symbol: 'GOOG', qty: 10, entryPrice: 175.60, currentPrice: 169.20, stopLossPct: 10, trailPct: 5, floorPrice: 158.04, highestPrice: 178.90, status: 'active' },
      { symbol: 'META', qty: 8, entryPrice: 505.20, currentPrice: 528.60, stopLossPct: 9, trailPct: 5, floorPrice: 502.17, highestPrice: 528.60, status: 'active' },
      { symbol: 'AMD', qty: 25, entryPrice: 162.80, currentPrice: 155.40, stopLossPct: 12, trailPct: 6, floorPrice: 143.26, highestPrice: 168.50, status: 'active' },
      { symbol: 'NFLX', qty: 5, entryPrice: 690.00, currentPrice: 725.50, stopLossPct: 8, trailPct: 4, floorPrice: 696.48, highestPrice: 725.50, status: 'active' },
      { symbol: 'CRM', qty: 10, entryPrice: 275.40, currentPrice: 268.10, stopLossPct: 10, trailPct: 5, floorPrice: 247.86, highestPrice: 282.30, status: 'stopped' },
      { symbol: 'PLTR', qty: 50, entryPrice: 24.80, currentPrice: 28.90, stopLossPct: 15, trailPct: 7, floorPrice: 26.88, highestPrice: 28.90, status: 'active' },
      { symbol: 'COIN', qty: 10, entryPrice: 225.00, currentPrice: 248.60, stopLossPct: 12, trailPct: 6, floorPrice: 233.68, highestPrice: 248.60, status: 'active' },
      { symbol: 'SQ', qty: 15, entryPrice: 78.50, currentPrice: 72.30, stopLossPct: 10, trailPct: 5, floorPrice: 70.65, highestPrice: 82.10, status: 'stopped' },
      { symbol: 'SHOP', qty: 12, entryPrice: 68.90, currentPrice: 75.20, stopLossPct: 10, trailPct: 5, floorPrice: 71.44, highestPrice: 75.20, status: 'active' },
      { symbol: 'SOFI', qty: 100, entryPrice: 9.50, currentPrice: 11.20, stopLossPct: 15, trailPct: 8, floorPrice: 10.30, highestPrice: 11.20, status: 'active' },
    ]);

    // ─── Copy Trades (15) ───
    await CopyTrade.bulkCreate([
      { politician: 'Michael McCaul', symbol: 'NVDA', action: 'buy', tradeDate: '2026-03-15', qty: 50, price: 132.40, totalValue: 6620, status: 'executed' },
      { politician: 'Michael McCaul', symbol: 'MSFT', action: 'buy', tradeDate: '2026-03-10', qty: 25, price: 410.20, totalValue: 10255, status: 'executed' },
      { politician: 'Nancy Pelosi', symbol: 'AAPL', action: 'buy', tradeDate: '2026-03-08', qty: 100, price: 188.50, totalValue: 18850, status: 'executed' },
      { politician: 'Nancy Pelosi', symbol: 'GOOG', action: 'buy', tradeDate: '2026-02-28', qty: 75, price: 170.30, totalValue: 12772, status: 'executed' },
      { politician: 'Dan Crenshaw', symbol: 'TSLA', action: 'buy', tradeDate: '2026-03-20', qty: 30, price: 245.80, totalValue: 7374, status: 'executed' },
      { politician: 'Tommy Tuberville', symbol: 'PLTR', action: 'buy', tradeDate: '2026-03-18', qty: 200, price: 23.50, totalValue: 4700, status: 'executed' },
      { politician: 'Michael McCaul', symbol: 'META', action: 'buy', tradeDate: '2026-03-05', qty: 20, price: 498.30, totalValue: 9966, status: 'executed' },
      { politician: 'Nancy Pelosi', symbol: 'CRM', action: 'sell', tradeDate: '2026-03-12', qty: 50, price: 278.90, totalValue: 13945, status: 'executed' },
      { politician: 'Dan Crenshaw', symbol: 'AMD', action: 'buy', tradeDate: '2026-03-01', qty: 60, price: 158.40, totalValue: 9504, status: 'executed' },
      { politician: 'Tommy Tuberville', symbol: 'AMZN', action: 'buy', tradeDate: '2026-02-25', qty: 40, price: 182.60, totalValue: 7304, status: 'executed' },
      { politician: 'Michael McCaul', symbol: 'NFLX', action: 'buy', tradeDate: '2026-02-20', qty: 10, price: 680.00, totalValue: 6800, status: 'pending' },
      { politician: 'Nancy Pelosi', symbol: 'COIN', action: 'buy', tradeDate: '2026-03-22', qty: 30, price: 220.50, totalValue: 6615, status: 'pending' },
      { politician: 'Dan Crenshaw', symbol: 'SQ', action: 'sell', tradeDate: '2026-03-19', qty: 40, price: 80.20, totalValue: 3208, status: 'executed' },
      { politician: 'Tommy Tuberville', symbol: 'SOFI', action: 'buy', tradeDate: '2026-03-14', qty: 500, price: 9.20, totalValue: 4600, status: 'executed' },
      { politician: 'Michael McCaul', symbol: 'SHOP', action: 'buy', tradeDate: '2026-03-25', qty: 45, price: 67.80, totalValue: 3051, status: 'pending' },
    ]);

    // ─── Wheel Strategy (15) ───
    await WheelStrategy.bulkCreate([
      { symbol: 'TSLA', stage: 'selling_puts', strikePrice: 225.00, expiration: '2026-04-25', premium: 5.20, costBasis: 0, contracts: 1, status: 'active' },
      { symbol: 'AAPL', stage: 'selling_calls', strikePrice: 210.00, expiration: '2026-04-18', premium: 3.80, costBasis: 192.50, contracts: 1, status: 'active' },
      { symbol: 'NVDA', stage: 'selling_puts', strikePrice: 120.00, expiration: '2026-05-02', premium: 4.50, costBasis: 0, contracts: 2, status: 'active' },
      { symbol: 'AMD', stage: 'selling_calls', strikePrice: 180.00, expiration: '2026-04-25', premium: 3.20, costBasis: 165.30, contracts: 1, status: 'active' },
      { symbol: 'MSFT', stage: 'selling_puts', strikePrice: 390.00, expiration: '2026-05-09', premium: 6.80, costBasis: 0, contracts: 1, status: 'active' },
      { symbol: 'AMZN', stage: 'selling_puts', strikePrice: 170.00, expiration: '2026-04-18', premium: 4.10, costBasis: 0, contracts: 1, status: 'active' },
      { symbol: 'GOOG', stage: 'selling_calls', strikePrice: 190.00, expiration: '2026-05-02', premium: 3.50, costBasis: 172.80, contracts: 1, status: 'active' },
      { symbol: 'META', stage: 'selling_puts', strikePrice: 460.00, expiration: '2026-04-25', premium: 8.20, costBasis: 0, contracts: 1, status: 'active' },
      { symbol: 'NFLX', stage: 'selling_calls', strikePrice: 750.00, expiration: '2026-05-09', premium: 12.50, costBasis: 695.00, contracts: 1, status: 'active' },
      { symbol: 'CRM', stage: 'selling_puts', strikePrice: 250.00, expiration: '2026-04-18', premium: 5.60, costBasis: 0, contracts: 1, status: 'expired' },
      { symbol: 'PLTR', stage: 'selling_puts', strikePrice: 22.00, expiration: '2026-05-02', premium: 1.20, costBasis: 0, contracts: 3, status: 'active' },
      { symbol: 'COIN', stage: 'selling_calls', strikePrice: 270.00, expiration: '2026-04-25', premium: 9.80, costBasis: 230.50, contracts: 1, status: 'active' },
      { symbol: 'SQ', stage: 'selling_puts', strikePrice: 70.00, expiration: '2026-05-09', premium: 2.80, costBasis: 0, contracts: 2, status: 'active' },
      { symbol: 'SHOP', stage: 'selling_puts', strikePrice: 62.00, expiration: '2026-04-18', premium: 2.10, costBasis: 0, contracts: 2, status: 'active' },
      { symbol: 'SOFI', stage: 'selling_calls', strikePrice: 12.50, expiration: '2026-04-25', premium: 0.60, costBasis: 9.80, contracts: 5, status: 'active' },
    ]);

    // ─── Watchlist (15) ───
    await WatchlistItem.bulkCreate([
      { symbol: 'TSLA', companyName: 'Tesla Inc', price: 262.30, changePct: 2.45, volume: '82M', sector: 'Automotive', notes: 'Watching for breakout above 270' },
      { symbol: 'NVDA', companyName: 'NVIDIA Corp', price: 148.90, changePct: 3.12, volume: '145M', sector: 'Semiconductors', notes: 'AI boom leader' },
      { symbol: 'AAPL', companyName: 'Apple Inc', price: 195.80, changePct: -0.32, volume: '55M', sector: 'Technology', notes: 'iPhone cycle analysis' },
      { symbol: 'AMZN', companyName: 'Amazon.com', price: 192.40, changePct: 1.85, volume: '48M', sector: 'E-Commerce', notes: 'AWS growth catalyst' },
      { symbol: 'MSFT', companyName: 'Microsoft Corp', price: 428.70, changePct: 0.95, volume: '22M', sector: 'Technology', notes: 'Copilot revenue impact' },
      { symbol: 'GOOG', companyName: 'Alphabet Inc', price: 169.20, changePct: -1.20, volume: '28M', sector: 'Technology', notes: 'Gemini AI competition' },
      { symbol: 'META', companyName: 'Meta Platforms', price: 528.60, changePct: 1.55, volume: '18M', sector: 'Social Media', notes: 'Metaverse spending concerns' },
      { symbol: 'AMD', companyName: 'Advanced Micro', price: 155.40, changePct: -2.10, volume: '65M', sector: 'Semiconductors', notes: 'MI300 demand tracking' },
      { symbol: 'NFLX', companyName: 'Netflix Inc', price: 725.50, changePct: 0.78, volume: '8M', sector: 'Entertainment', notes: 'Subscriber growth' },
      { symbol: 'PLTR', companyName: 'Palantir Tech', price: 28.90, changePct: 4.20, volume: '95M', sector: 'Software', notes: 'Government contracts pipeline' },
      { symbol: 'COIN', companyName: 'Coinbase', price: 248.60, changePct: 5.30, volume: '12M', sector: 'Fintech', notes: 'Crypto cycle correlation' },
      { symbol: 'SQ', companyName: 'Block Inc', price: 72.30, changePct: -1.45, volume: '10M', sector: 'Fintech', notes: 'Cash App growth' },
      { symbol: 'SHOP', companyName: 'Shopify Inc', price: 75.20, changePct: 2.80, volume: '14M', sector: 'E-Commerce', notes: 'Merchant growth metrics' },
      { symbol: 'SOFI', companyName: 'SoFi Technologies', price: 11.20, changePct: 3.70, volume: '38M', sector: 'Fintech', notes: 'Bank charter momentum' },
      { symbol: 'SMCI', companyName: 'Super Micro', price: 42.80, changePct: -4.50, volume: '52M', sector: 'Hardware', notes: 'AI server demand' },
    ]);

    // ─── Trade Journal (15) ───
    await TradeJournal.bulkCreate([
      { symbol: 'TSLA', action: 'buy', qty: 10, entryPrice: 235.00, exitPrice: 262.30, tradeDate: '2026-03-01', pnl: 273.00, notes: 'Trailing stop strategy', strategy: 'Trailing Stop' },
      { symbol: 'NVDA', action: 'buy', qty: 20, entryPrice: 125.00, exitPrice: 148.90, tradeDate: '2026-02-15', pnl: 478.00, notes: 'AI sector momentum', strategy: 'Momentum' },
      { symbol: 'AAPL', action: 'sell', qty: 15, entryPrice: 195.80, exitPrice: 189.50, tradeDate: '2026-03-10', pnl: -94.50, notes: 'Cut loss on weakness', strategy: 'Stop Loss' },
      { symbol: 'META', action: 'buy', qty: 5, entryPrice: 480.00, exitPrice: 528.60, tradeDate: '2026-02-20', pnl: 243.00, notes: 'Earnings play', strategy: 'Swing' },
      { symbol: 'AMD', action: 'buy', qty: 30, entryPrice: 150.20, exitPrice: 162.80, tradeDate: '2026-03-05', pnl: 378.00, notes: 'Chip sector rotation', strategy: 'Sector Rotation' },
      { symbol: 'AMZN', action: 'buy', qty: 10, entryPrice: 178.50, exitPrice: 192.40, tradeDate: '2026-02-28', pnl: 139.00, notes: 'Cloud earnings beat', strategy: 'Earnings' },
      { symbol: 'PLTR', action: 'buy', qty: 100, entryPrice: 20.50, exitPrice: 28.90, tradeDate: '2026-01-15', pnl: 840.00, notes: 'Government contract win', strategy: 'News Catalyst' },
      { symbol: 'NFLX', action: 'sell', qty: 3, entryPrice: 710.00, exitPrice: 725.50, tradeDate: '2026-03-20', pnl: 46.50, notes: 'Quick scalp on momentum', strategy: 'Scalp' },
      { symbol: 'GOOG', action: 'buy', qty: 12, entryPrice: 168.30, exitPrice: 175.60, tradeDate: '2026-03-12', pnl: 87.60, notes: 'Gemini 2.0 announcement', strategy: 'News Catalyst' },
      { symbol: 'CRM', action: 'sell', qty: 8, entryPrice: 282.30, exitPrice: 268.10, tradeDate: '2026-03-18', pnl: -113.60, notes: 'Missed earnings', strategy: 'Earnings' },
      { symbol: 'COIN', action: 'buy', qty: 15, entryPrice: 210.00, exitPrice: 248.60, tradeDate: '2026-02-10', pnl: 579.00, notes: 'Bitcoin rally correlation', strategy: 'Crypto Corr' },
      { symbol: 'MSFT', action: 'buy', qty: 6, entryPrice: 405.00, exitPrice: 428.70, tradeDate: '2026-03-01', pnl: 142.20, notes: 'Copilot revenue growth', strategy: 'Fundamental' },
      { symbol: 'SQ', action: 'sell', qty: 20, entryPrice: 82.10, exitPrice: 72.30, tradeDate: '2026-03-15', pnl: -196.00, notes: 'Stop loss triggered', strategy: 'Stop Loss' },
      { symbol: 'SHOP', action: 'buy', qty: 18, entryPrice: 62.50, exitPrice: 75.20, tradeDate: '2026-02-22', pnl: 228.60, notes: 'Small cap breakout', strategy: 'Breakout' },
      { symbol: 'SOFI', action: 'buy', qty: 200, entryPrice: 8.80, exitPrice: 11.20, tradeDate: '2026-01-20', pnl: 480.00, notes: 'Bank charter momentum', strategy: 'Momentum' },
    ]);

    // ─── Price Alerts (15) ───
    await PriceAlert.bulkCreate([
      { symbol: 'TSLA', targetPrice: 280.00, direction: 'above', currentPrice: 262.30, status: 'active', notes: 'Breakout confirmation' },
      { symbol: 'TSLA', targetPrice: 230.00, direction: 'below', currentPrice: 262.30, status: 'active', notes: 'Support level break' },
      { symbol: 'NVDA', targetPrice: 160.00, direction: 'above', currentPrice: 148.90, status: 'active', notes: 'New ATH watch' },
      { symbol: 'AAPL', targetPrice: 200.00, direction: 'above', currentPrice: 195.80, status: 'active', notes: 'Round number resistance' },
      { symbol: 'AAPL', targetPrice: 180.00, direction: 'below', currentPrice: 195.80, status: 'active', notes: 'Key support level' },
      { symbol: 'AMZN', targetPrice: 200.00, direction: 'above', currentPrice: 192.40, status: 'active', notes: 'Breakout target' },
      { symbol: 'META', targetPrice: 550.00, direction: 'above', currentPrice: 528.60, status: 'active', notes: 'Channel breakout' },
      { symbol: 'AMD', targetPrice: 140.00, direction: 'below', currentPrice: 155.40, status: 'active', notes: 'Downtrend continuation' },
      { symbol: 'PLTR', targetPrice: 35.00, direction: 'above', currentPrice: 28.90, status: 'active', notes: 'Institutional target' },
      { symbol: 'COIN', targetPrice: 200.00, direction: 'below', currentPrice: 248.60, status: 'active', notes: 'Crypto winter signal' },
      { symbol: 'NFLX', targetPrice: 750.00, direction: 'above', currentPrice: 725.50, status: 'active', notes: 'Earnings momentum' },
      { symbol: 'MSFT', targetPrice: 450.00, direction: 'above', currentPrice: 428.70, status: 'active', notes: 'All time high' },
      { symbol: 'GOOG', targetPrice: 160.00, direction: 'below', currentPrice: 169.20, status: 'active', notes: 'Support break' },
      { symbol: 'SQ', targetPrice: 85.00, direction: 'above', currentPrice: 72.30, status: 'active', notes: 'Recovery target' },
      { symbol: 'SOFI', targetPrice: 15.00, direction: 'above', currentPrice: 11.20, status: 'active', notes: 'Bull target' },
    ]);

    // ─── Trade Signals (25) ───
    await TradeSignal.bulkCreate([
      // MACD Signals
      { symbol: 'TSLA', signalType: 'bullish', strategy: 'MACD Crossover', confidence: 0.85, entryPrice: 260.00, targetPrice: 295.00, stopPrice: 245.00, timeframe: '2 weeks', status: 'active' },
      { symbol: 'COIN', signalType: 'bullish', strategy: 'MACD Crossover', confidence: 0.82, entryPrice: 245.00, targetPrice: 290.00, stopPrice: 220.00, timeframe: '1 month', status: 'active' },
      // Moving Average Signals
      { symbol: 'NVDA', signalType: 'bullish', strategy: 'Golden Cross', confidence: 0.92, entryPrice: 148.00, targetPrice: 175.00, stopPrice: 135.00, timeframe: '1 month', status: 'active' },
      { symbol: 'AMD', signalType: 'bearish', strategy: 'Death Cross', confidence: 0.72, entryPrice: 155.00, targetPrice: 135.00, stopPrice: 168.00, timeframe: '3 weeks', status: 'active' },
      { symbol: 'SHOP', signalType: 'bullish', strategy: 'EMA Bounce', confidence: 0.80, entryPrice: 74.00, targetPrice: 88.00, stopPrice: 66.00, timeframe: '1 month', status: 'active' },
      // RSI Signals
      { symbol: 'META', signalType: 'bullish', strategy: 'RSI Oversold Bounce', confidence: 0.88, entryPrice: 525.00, targetPrice: 580.00, stopPrice: 500.00, timeframe: '1 month', status: 'active' },
      { symbol: 'GOOG', signalType: 'bearish', strategy: 'RSI Overbought', confidence: 0.65, entryPrice: 170.00, targetPrice: 155.00, stopPrice: 180.00, timeframe: '2 weeks', status: 'active' },
      // Bollinger Band Signals
      { symbol: 'AAPL', signalType: 'neutral', strategy: 'Bollinger Squeeze', confidence: 0.60, entryPrice: 195.00, targetPrice: 205.00, stopPrice: 185.00, timeframe: '2 weeks', status: 'active' },
      { symbol: 'MSFT', signalType: 'bullish', strategy: 'Bollinger Band Bounce', confidence: 0.74, entryPrice: 425.00, targetPrice: 455.00, stopPrice: 410.00, timeframe: '2 weeks', status: 'active' },
      // Support / Resistance
      { symbol: 'AMZN', signalType: 'bullish', strategy: 'Support Bounce', confidence: 0.78, entryPrice: 190.00, targetPrice: 215.00, stopPrice: 180.00, timeframe: '3 weeks', status: 'active' },
      { symbol: 'CRM', signalType: 'bearish', strategy: 'Resistance Rejection', confidence: 0.70, entryPrice: 268.00, targetPrice: 245.00, stopPrice: 285.00, timeframe: '3 weeks', status: 'active' },
      // Breakout / Breakdown
      { symbol: 'PLTR', signalType: 'bullish', strategy: 'Breakout', confidence: 0.90, entryPrice: 28.00, targetPrice: 38.00, stopPrice: 24.00, timeframe: '2 months', status: 'active' },
      { symbol: 'SQ', signalType: 'bearish', strategy: 'Breakdown', confidence: 0.68, entryPrice: 72.00, targetPrice: 62.00, stopPrice: 80.00, timeframe: '2 weeks', status: 'active' },
      { symbol: 'SOFI', signalType: 'bullish', strategy: 'Volume Breakout', confidence: 0.86, entryPrice: 11.00, targetPrice: 15.00, stopPrice: 9.50, timeframe: '2 months', status: 'active' },
      // Chart Patterns
      { symbol: 'NFLX', signalType: 'bullish', strategy: 'Cup & Handle', confidence: 0.75, entryPrice: 720.00, targetPrice: 780.00, stopPrice: 690.00, timeframe: '3 weeks', status: 'active' },
      { symbol: 'SMCI', signalType: 'bearish', strategy: 'Head & Shoulders', confidence: 0.71, entryPrice: 43.00, targetPrice: 35.00, stopPrice: 48.00, timeframe: '3 weeks', status: 'active' },
      { symbol: 'TSLA', signalType: 'bullish', strategy: 'Double Bottom', confidence: 0.79, entryPrice: 255.00, targetPrice: 290.00, stopPrice: 240.00, timeframe: '1 month', status: 'active' },
      { symbol: 'AMD', signalType: 'bearish', strategy: 'Double Top', confidence: 0.67, entryPrice: 158.00, targetPrice: 140.00, stopPrice: 166.00, timeframe: '2 weeks', status: 'active' },
      { symbol: 'NVDA', signalType: 'bullish', strategy: 'Bull Flag', confidence: 0.83, entryPrice: 150.00, targetPrice: 172.00, stopPrice: 142.00, timeframe: '2 weeks', status: 'active' },
      { symbol: 'GOOG', signalType: 'bearish', strategy: 'Bear Flag', confidence: 0.66, entryPrice: 168.00, targetPrice: 152.00, stopPrice: 176.00, timeframe: '2 weeks', status: 'active' },
      { symbol: 'META', signalType: 'bullish', strategy: 'Ascending Triangle', confidence: 0.81, entryPrice: 530.00, targetPrice: 575.00, stopPrice: 510.00, timeframe: '3 weeks', status: 'active' },
      // Fibonacci
      { symbol: 'AMZN', signalType: 'bullish', strategy: 'Fibonacci Retracement', confidence: 0.77, entryPrice: 188.00, targetPrice: 210.00, stopPrice: 178.00, timeframe: '3 weeks', status: 'active' },
      // VWAP
      { symbol: 'AAPL', signalType: 'bullish', strategy: 'VWAP Bounce', confidence: 0.73, entryPrice: 194.00, targetPrice: 208.00, stopPrice: 188.00, timeframe: '1 week', status: 'active' },
      // Stochastic
      { symbol: 'PLTR', signalType: 'bullish', strategy: 'Stochastic Crossover', confidence: 0.76, entryPrice: 27.50, targetPrice: 34.00, stopPrice: 24.50, timeframe: '2 weeks', status: 'active' },
      // Ichimoku
      { symbol: 'MSFT', signalType: 'neutral', strategy: 'Ichimoku Cloud', confidence: 0.58, entryPrice: 428.00, targetPrice: 450.00, stopPrice: 415.00, timeframe: '1 month', status: 'active' },
    ]);

    // ─── Stock Screener (15) ───
    await StockScreener.bulkCreate([
      { symbol: 'TSLA', companyName: 'Tesla Inc', sector: 'Automotive', marketCap: '835B', peRatio: 72.5, dividendYield: 0, aiScore: 8.5 },
      { symbol: 'NVDA', companyName: 'NVIDIA Corp', sector: 'Semiconductors', marketCap: '3.6T', peRatio: 65.2, dividendYield: 0.03, aiScore: 9.2 },
      { symbol: 'AAPL', companyName: 'Apple Inc', sector: 'Technology', marketCap: '3.0T', peRatio: 30.8, dividendYield: 0.52, aiScore: 7.8 },
      { symbol: 'AMZN', companyName: 'Amazon.com', sector: 'E-Commerce', marketCap: '2.0T', peRatio: 58.4, dividendYield: 0, aiScore: 8.1 },
      { symbol: 'MSFT', companyName: 'Microsoft', sector: 'Technology', marketCap: '3.2T', peRatio: 35.6, dividendYield: 0.72, aiScore: 8.8 },
      { symbol: 'GOOG', companyName: 'Alphabet', sector: 'Technology', marketCap: '2.1T', peRatio: 24.3, dividendYield: 0.45, aiScore: 7.5 },
      { symbol: 'META', companyName: 'Meta Platforms', sector: 'Social Media', marketCap: '1.35T', peRatio: 28.9, dividendYield: 0.36, aiScore: 8.3 },
      { symbol: 'AMD', companyName: 'Advanced Micro', sector: 'Semiconductors', marketCap: '252B', peRatio: 45.1, dividendYield: 0, aiScore: 7.2 },
      { symbol: 'NFLX', companyName: 'Netflix', sector: 'Entertainment', marketCap: '315B', peRatio: 42.8, dividendYield: 0, aiScore: 7.9 },
      { symbol: 'PLTR', companyName: 'Palantir', sector: 'Software', marketCap: '68B', peRatio: 185.0, dividendYield: 0, aiScore: 8.0 },
      { symbol: 'COIN', companyName: 'Coinbase', sector: 'Fintech', marketCap: '62B', peRatio: 32.5, dividendYield: 0, aiScore: 7.6 },
      { symbol: 'SQ', companyName: 'Block Inc', sector: 'Fintech', marketCap: '43B', peRatio: 55.2, dividendYield: 0, aiScore: 6.8 },
      { symbol: 'SHOP', companyName: 'Shopify', sector: 'E-Commerce', marketCap: '97B', peRatio: 68.3, dividendYield: 0, aiScore: 7.4 },
      { symbol: 'SOFI', companyName: 'SoFi Tech', sector: 'Fintech', marketCap: '12B', peRatio: 95.0, dividendYield: 0, aiScore: 7.1 },
      { symbol: 'SMCI', companyName: 'Super Micro', sector: 'Hardware', marketCap: '25B', peRatio: 18.5, dividendYield: 0, aiScore: 6.5 },
    ]);

    // ─── Risk Assessments (15) ───
    await RiskAssessment.bulkCreate([
      { symbol: 'TSLA', positionSize: 5000, riskLevel: 'high', maxLoss: 750, riskRewardRatio: 2.5, volatility: 48.2, notes: 'High beta stock' },
      { symbol: 'NVDA', positionSize: 8000, riskLevel: 'high', maxLoss: 1200, riskRewardRatio: 3.0, volatility: 52.1, notes: 'AI momentum play' },
      { symbol: 'AAPL', positionSize: 6000, riskLevel: 'low', maxLoss: 420, riskRewardRatio: 2.0, volatility: 22.5, notes: 'Blue chip stability' },
      { symbol: 'AMZN', positionSize: 4500, riskLevel: 'medium', maxLoss: 540, riskRewardRatio: 2.2, volatility: 32.8, notes: 'Cloud growth risk' },
      { symbol: 'MSFT', positionSize: 7000, riskLevel: 'low', maxLoss: 490, riskRewardRatio: 1.8, volatility: 20.1, notes: 'Defensive tech' },
      { symbol: 'META', positionSize: 5500, riskLevel: 'medium', maxLoss: 660, riskRewardRatio: 2.4, volatility: 35.5, notes: 'Ad spend sensitivity' },
      { symbol: 'AMD', positionSize: 4000, riskLevel: 'high', maxLoss: 720, riskRewardRatio: 2.8, volatility: 50.3, notes: 'Competitive pressure' },
      { symbol: 'GOOG', positionSize: 5000, riskLevel: 'medium', maxLoss: 500, riskRewardRatio: 2.0, volatility: 28.7, notes: 'Regulatory risk' },
      { symbol: 'NFLX', positionSize: 3500, riskLevel: 'medium', maxLoss: 385, riskRewardRatio: 2.1, volatility: 38.2, notes: 'Subscriber churn risk' },
      { symbol: 'PLTR', positionSize: 2500, riskLevel: 'high', maxLoss: 500, riskRewardRatio: 3.5, volatility: 58.4, notes: 'Government contract dependent' },
      { symbol: 'COIN', positionSize: 3000, riskLevel: 'very high', maxLoss: 900, riskRewardRatio: 4.0, volatility: 72.1, notes: 'Crypto correlation' },
      { symbol: 'SQ', positionSize: 2000, riskLevel: 'medium', maxLoss: 280, riskRewardRatio: 1.9, volatility: 42.5, notes: 'Fintech competition' },
      { symbol: 'SHOP', positionSize: 2500, riskLevel: 'medium', maxLoss: 325, riskRewardRatio: 2.3, volatility: 44.8, notes: 'E-commerce cycle' },
      { symbol: 'SOFI', positionSize: 1500, riskLevel: 'high', maxLoss: 300, riskRewardRatio: 3.2, volatility: 55.0, notes: 'Rate sensitivity' },
      { symbol: 'SMCI', positionSize: 2000, riskLevel: 'very high', maxLoss: 600, riskRewardRatio: 3.8, volatility: 82.3, notes: 'Accounting concerns' },
    ]);

    // ─── Portfolio Items (15) ───
    await PortfolioItem.bulkCreate([
      { symbol: 'TSLA', companyName: 'Tesla Inc', qty: 10, avgPrice: 248.50, currentPrice: 262.30, pnl: 138.00, allocation: 8.5 },
      { symbol: 'NVDA', companyName: 'NVIDIA Corp', qty: 15, avgPrice: 135.20, currentPrice: 148.90, pnl: 205.50, allocation: 12.2 },
      { symbol: 'AAPL', companyName: 'Apple Inc', qty: 20, avgPrice: 189.50, currentPrice: 195.80, pnl: 126.00, allocation: 11.5 },
      { symbol: 'AMZN', companyName: 'Amazon.com', qty: 8, avgPrice: 185.00, currentPrice: 192.40, pnl: 59.20, allocation: 7.8 },
      { symbol: 'MSFT', companyName: 'Microsoft', qty: 12, avgPrice: 415.30, currentPrice: 428.70, pnl: 160.80, allocation: 15.2 },
      { symbol: 'META', companyName: 'Meta Platforms', qty: 8, avgPrice: 505.20, currentPrice: 528.60, pnl: 187.20, allocation: 10.8 },
      { symbol: 'GOOG', companyName: 'Alphabet', qty: 10, avgPrice: 175.60, currentPrice: 169.20, pnl: -64.00, allocation: 5.5 },
      { symbol: 'PLTR', companyName: 'Palantir', qty: 50, avgPrice: 24.80, currentPrice: 28.90, pnl: 205.00, allocation: 4.7 },
      { symbol: 'NFLX', companyName: 'Netflix', qty: 5, avgPrice: 690.00, currentPrice: 725.50, pnl: 177.50, allocation: 9.2 },
      { symbol: 'AMD', companyName: 'Advanced Micro', qty: 25, avgPrice: 162.80, currentPrice: 155.40, pnl: -185.00, allocation: 6.1 },
      { symbol: 'COIN', companyName: 'Coinbase', qty: 10, avgPrice: 225.00, currentPrice: 248.60, pnl: 236.00, allocation: 3.2 },
      { symbol: 'SHOP', companyName: 'Shopify', qty: 12, avgPrice: 68.90, currentPrice: 75.20, pnl: 75.60, allocation: 1.8 },
      { symbol: 'SOFI', companyName: 'SoFi Tech', qty: 100, avgPrice: 9.50, currentPrice: 11.20, pnl: 170.00, allocation: 1.5 },
      { symbol: 'CRM', companyName: 'Salesforce', qty: 6, avgPrice: 275.40, currentPrice: 268.10, pnl: -43.80, allocation: 1.5 },
      { symbol: 'SQ', companyName: 'Block Inc', qty: 15, avgPrice: 78.50, currentPrice: 72.30, pnl: -93.00, allocation: 0.5 },
    ]);

    // ─── Sentiment (15) ───
    await Sentiment.bulkCreate([
      { symbol: 'TSLA', sentimentScore: 0.72, source: 'Twitter/X', headline: 'Tesla FSD v13 rollout exceeds expectations', bullishPct: 68, bearishPct: 22 },
      { symbol: 'NVDA', sentimentScore: 0.89, source: 'Reddit', headline: 'NVIDIA Blackwell demand overwhelming supply', bullishPct: 85, bearishPct: 8 },
      { symbol: 'AAPL', sentimentScore: 0.55, source: 'News', headline: 'Apple Vision Pro sales underwhelm analysts', bullishPct: 48, bearishPct: 35 },
      { symbol: 'AMZN', sentimentScore: 0.75, source: 'Analyst', headline: 'AWS growth reaccelerating in Q1 2026', bullishPct: 72, bearishPct: 15 },
      { symbol: 'MSFT', sentimentScore: 0.80, source: 'News', headline: 'Copilot enterprise adoption surging', bullishPct: 76, bearishPct: 12 },
      { symbol: 'META', sentimentScore: 0.68, source: 'Twitter/X', headline: 'Meta AI assistant gains 500M users', bullishPct: 62, bearishPct: 25 },
      { symbol: 'AMD', sentimentScore: 0.42, source: 'Reddit', headline: 'AMD MI300 losing ground to NVIDIA H200', bullishPct: 38, bearishPct: 48 },
      { symbol: 'GOOG', sentimentScore: 0.50, source: 'News', headline: 'DOJ antitrust ruling uncertainty looms', bullishPct: 42, bearishPct: 40 },
      { symbol: 'PLTR', sentimentScore: 0.85, source: 'Reddit', headline: 'Palantir wins $500M Army contract', bullishPct: 80, bearishPct: 10 },
      { symbol: 'NFLX', sentimentScore: 0.65, source: 'Analyst', headline: 'Netflix ad tier growing faster than expected', bullishPct: 58, bearishPct: 28 },
      { symbol: 'COIN', sentimentScore: 0.78, source: 'Twitter/X', headline: 'Bitcoin ETF inflows hit record high', bullishPct: 74, bearishPct: 16 },
      { symbol: 'SQ', sentimentScore: 0.35, source: 'News', headline: 'Block faces increasing fintech competition', bullishPct: 30, bearishPct: 52 },
      { symbol: 'SHOP', sentimentScore: 0.70, source: 'Analyst', headline: 'Shopify AI tools driving merchant growth', bullishPct: 65, bearishPct: 20 },
      { symbol: 'SOFI', sentimentScore: 0.76, source: 'Reddit', headline: 'SoFi member growth accelerating post-charter', bullishPct: 70, bearishPct: 18 },
      { symbol: 'SMCI', sentimentScore: 0.25, source: 'News', headline: 'Super Micro faces delisting concerns', bullishPct: 20, bearishPct: 68 },
    ]);

    // ─── Options Chain (15) ───
    await OptionsChain.bulkCreate([
      { symbol: 'TSLA', optionType: 'call', strike: 280.00, expiration: '2026-04-25', premium: 8.50, iv: 52.3, delta: 0.35, openInterest: 15420 },
      { symbol: 'TSLA', optionType: 'put', strike: 240.00, expiration: '2026-04-25', premium: 6.20, iv: 48.7, delta: -0.30, openInterest: 12850 },
      { symbol: 'NVDA', optionType: 'call', strike: 160.00, expiration: '2026-05-02', premium: 5.80, iv: 55.1, delta: 0.40, openInterest: 28500 },
      { symbol: 'NVDA', optionType: 'put', strike: 130.00, expiration: '2026-05-02', premium: 3.90, iv: 50.8, delta: -0.25, openInterest: 18200 },
      { symbol: 'AAPL', optionType: 'call', strike: 200.00, expiration: '2026-04-18', premium: 4.20, iv: 25.6, delta: 0.42, openInterest: 35600 },
      { symbol: 'AAPL', optionType: 'put', strike: 185.00, expiration: '2026-04-18', premium: 3.10, iv: 24.2, delta: -0.28, openInterest: 22400 },
      { symbol: 'META', optionType: 'call', strike: 550.00, expiration: '2026-04-25', premium: 12.80, iv: 38.5, delta: 0.38, openInterest: 8900 },
      { symbol: 'MSFT', optionType: 'call', strike: 450.00, expiration: '2026-05-09', premium: 9.50, iv: 22.8, delta: 0.32, openInterest: 14200 },
      { symbol: 'AMZN', optionType: 'put', strike: 180.00, expiration: '2026-04-25', premium: 5.40, iv: 35.2, delta: -0.32, openInterest: 11800 },
      { symbol: 'AMD', optionType: 'put', strike: 140.00, expiration: '2026-05-02', premium: 4.80, iv: 52.8, delta: -0.35, openInterest: 19500 },
      { symbol: 'PLTR', optionType: 'call', strike: 35.00, expiration: '2026-04-25', premium: 1.80, iv: 62.4, delta: 0.28, openInterest: 42000 },
      { symbol: 'NFLX', optionType: 'call', strike: 750.00, expiration: '2026-05-09', premium: 18.50, iv: 40.2, delta: 0.38, openInterest: 5200 },
      { symbol: 'COIN', optionType: 'call', strike: 270.00, expiration: '2026-04-18', premium: 11.20, iv: 75.8, delta: 0.35, openInterest: 7800 },
      { symbol: 'GOOG', optionType: 'put', strike: 160.00, expiration: '2026-04-25', premium: 4.50, iv: 30.5, delta: -0.30, openInterest: 16300 },
      { symbol: 'SOFI', optionType: 'call', strike: 14.00, expiration: '2026-05-02', premium: 0.85, iv: 58.9, delta: 0.25, openInterest: 55000 },
    ]);

    // ─── Market News (15) ───
    // Seed rows point at **real, stable pages** — regulator sites, company
    // investor-relations portals, and issuer press-release indexes. These URLs
    // are chosen to stay live long-term; they do NOT deep-link to specific
    // dated articles (those rot within weeks and would 404). To get real
    // dated articles, call `POST /api/market-news/sync` with NEWS_PROVIDER=
    // finnhub + FINNHUB_API_KEY set — the fetcher inserts live articles
    // from Finnhub.
    //
    // Summaries describe *where the link goes* so the user isn't surprised
    // when a "news card" opens a press-release index rather than a specific
    // article.
    await MarketNews.bulkCreate([
      { title: 'Federal Reserve — FOMC statements & minutes',
        summary: 'Primary source for FOMC decisions, dot plot, and policy statement. Check the most recent meeting for rate guidance.',
        source: 'Federal Reserve', symbol: 'SPY', sentiment: 'neutral', publishedAt: '2026-04-11',
        url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' },
      { title: 'NVIDIA — Investor news & press releases',
        summary: 'Official IR hub: earnings releases, product announcements, and SEC filings as they post.',
        source: 'NVIDIA IR', symbol: 'NVDA', sentiment: 'bullish', publishedAt: '2026-04-10',
        url: 'https://investor.nvidia.com/financial-info/financial-reports/default.aspx' },
      { title: 'Tesla — Investor Relations & press',
        summary: 'Tesla IR portal. Vehicle production/delivery numbers, earnings, and regulatory filings.',
        source: 'Tesla IR', symbol: 'TSLA', sentiment: 'neutral', publishedAt: '2026-04-10',
        url: 'https://ir.tesla.com/press' },
      { title: 'Apple — Investor Relations',
        summary: 'Apple IR: quarterly results, SEC filings, dividend announcements, and event replays.',
        source: 'Apple IR', symbol: 'AAPL', sentiment: 'neutral', publishedAt: '2026-04-09',
        url: 'https://investor.apple.com/investor-relations/default.aspx' },
      { title: 'Amazon — Investor news & events',
        summary: 'Amazon IR hub. AWS growth is disclosed here first every quarter.',
        source: 'Amazon IR', symbol: 'AMZN', sentiment: 'neutral', publishedAt: '2026-04-09',
        url: 'https://ir.aboutamazon.com/news-and-events/default.aspx' },
      { title: 'Alphabet — Investor Relations',
        summary: 'Google/Alphabet IR portal: quarterly results, SEC filings, governance documents.',
        source: 'Alphabet IR', symbol: 'GOOG', sentiment: 'neutral', publishedAt: '2026-04-08',
        url: 'https://abc.xyz/investor/' },
      { title: 'Meta — Investor Relations & press releases',
        summary: 'Meta IR: earnings, Reality Labs results, platform metrics, AI initiatives.',
        source: 'Meta IR', symbol: 'META', sentiment: 'neutral', publishedAt: '2026-04-08',
        url: 'https://investor.atmeta.com/press-releases/' },
      { title: 'SEC — EDGAR full-text search',
        summary: 'Search every 8-K, 10-Q, and 10-K as it is filed. Primary source for any material event.',
        source: 'SEC EDGAR', symbol: 'SPY', sentiment: 'neutral', publishedAt: '2026-04-07',
        url: 'https://efts.sec.gov/LATEST/search-index?q=&dateRange=custom&forms=8-K' },
      { title: 'AMD — Investor Relations',
        summary: 'AMD IR portal — press releases, earnings, and investor events.',
        source: 'AMD IR', symbol: 'AMD', sentiment: 'neutral', publishedAt: '2026-04-07',
        url: 'https://ir.amd.com/news-events/press-releases' },
      { title: 'U.S. Treasury — press releases',
        summary: 'Treasury press releases: auctions, tariff actions, sanctions, debt limit updates.',
        source: 'US Treasury', symbol: 'SPY', sentiment: 'neutral', publishedAt: '2026-04-06',
        url: 'https://home.treasury.gov/news/press-releases' },
      { title: 'Microsoft — Investor Relations',
        summary: 'Microsoft IR hub. Azure growth and Copilot revenue commentary drop here each quarter.',
        source: 'Microsoft IR', symbol: 'MSFT', sentiment: 'neutral', publishedAt: '2026-04-06',
        url: 'https://www.microsoft.com/en-us/Investor/default.aspx' },
      { title: 'SoFi Technologies — Investor Relations',
        summary: 'SoFi IR: member growth, bank-segment deposits, quarterly earnings releases.',
        source: 'SoFi IR', symbol: 'SOFI', sentiment: 'neutral', publishedAt: '2026-04-05',
        url: 'https://investors.sofi.com/financials/' },
      { title: 'Palantir — Investor Relations',
        summary: 'Palantir IR portal — commercial vs government revenue mix disclosed every quarter.',
        source: 'Palantir IR', symbol: 'PLTR', sentiment: 'neutral', publishedAt: '2026-04-05',
        url: 'https://investors.palantir.com/' },
      { title: 'Netflix — Investor Relations',
        summary: 'Netflix IR: subscriber adds, ARM, ad-tier metrics, and the quarterly shareholder letter.',
        source: 'Netflix IR', symbol: 'NFLX', sentiment: 'neutral', publishedAt: '2026-04-04',
        url: 'https://ir.netflix.net/ir-overview/Profile/default.aspx' },
      { title: 'Coinbase — Investor Relations',
        summary: 'Coinbase IR: trading volume, subscription & services revenue, custody balances.',
        source: 'Coinbase IR', symbol: 'COIN', sentiment: 'neutral', publishedAt: '2026-04-04',
        url: 'https://investor.coinbase.com/overview/default.aspx' },
    ]);

    // ─── Auto-Trader Trade History (12) ───
    // Seeded so Trade Replay has content out of the box. The bot writes the
    // same shape at runtime (orderId from Alpaca, entryContext = indicator
    // snapshot captured at entry, tags = operator-set labels).
    const demoUserId = 1;
    const now = Date.now();
    const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000);
    await AutoTraderTrade.bulkCreate([
      { userId: demoUserId, symbol: 'TSLA', action: 'buy',  qty: 10, price: 248.50, reason: 'MACD bullish cross',      orderId: 'demo-at-0001', strategy: 'MACD Crossover',         pnl:  138.00, tags: ['momentum'],      entryContext: { rsi: 58, macd: 1.12, vwap: 246.80 }, createdAt: daysAgo(14), updatedAt: daysAgo(14) },
      { userId: demoUserId, symbol: 'NVDA', action: 'buy',  qty: 15, price: 135.20, reason: 'Golden cross + volume',   orderId: 'demo-at-0002', strategy: 'Golden Cross',           pnl:  205.50, tags: ['trend-follow'],  entryContext: { rsi: 62, sma50: 132.4, sma200: 128.7 }, createdAt: daysAgo(12), updatedAt: daysAgo(12) },
      { userId: demoUserId, symbol: 'META', action: 'buy',  qty:  8, price: 505.20, reason: 'RSI oversold bounce',     orderId: 'demo-at-0003', strategy: 'RSI Oversold Bounce',    pnl:  187.20, tags: ['mean-reversion'],entryContext: { rsi: 28, price: 505.2, ema20: 512.3 }, createdAt: daysAgo(11), updatedAt: daysAgo(11) },
      { userId: demoUserId, symbol: 'AAPL', action: 'sell', qty: 20, price: 195.80, reason: 'Trailing stop hit',       orderId: 'demo-at-0004', strategy: 'Trailing Stop',          pnl:   94.00, tags: ['exit'],          entryContext: { stopPrice: 195.0, highestPrice: 205.5 }, createdAt: daysAgo(10), updatedAt: daysAgo(10) },
      { userId: demoUserId, symbol: 'PLTR', action: 'buy',  qty: 50, price:  24.80, reason: 'Breakout on news',        orderId: 'demo-at-0005', strategy: 'Breakout',               pnl:  205.00, tags: ['news-catalyst'], entryContext: { resistance: 24.5, volumeZ: 3.1 }, createdAt: daysAgo(9),  updatedAt: daysAgo(9)  },
      { userId: demoUserId, symbol: 'AMD',  action: 'buy',  qty: 25, price: 162.80, reason: 'Support bounce',          orderId: 'demo-at-0006', strategy: 'Support Bounce',         pnl: -185.00, tags: ['loss'],          entryContext: { support: 162.0, rsi: 38 }, createdAt: daysAgo(8),  updatedAt: daysAgo(8)  },
      { userId: demoUserId, symbol: 'COIN', action: 'buy',  qty: 10, price: 225.00, reason: 'Crypto correlation play', orderId: 'demo-at-0007', strategy: 'Correlation',            pnl:  236.00, tags: ['scalp'],         entryContext: { btcPrice: 118500, corr: 0.82 }, createdAt: daysAgo(7),  updatedAt: daysAgo(7)  },
      { userId: demoUserId, symbol: 'NFLX', action: 'buy',  qty:  5, price: 690.00, reason: 'Cup & handle pattern',    orderId: 'demo-at-0008', strategy: 'Cup & Handle',           pnl:  177.50, tags: ['pattern'],       entryContext: { cupLow: 680, handleHigh: 695 }, createdAt: daysAgo(6),  updatedAt: daysAgo(6)  },
      { userId: demoUserId, symbol: 'SOFI', action: 'buy',  qty:100, price:   9.50, reason: 'Volume breakout',         orderId: 'demo-at-0009', strategy: 'Volume Breakout',        pnl:  170.00, tags: ['momentum'],      entryContext: { volumeZ: 4.2, priceChange: 0.08 }, createdAt: daysAgo(5),  updatedAt: daysAgo(5)  },
      { userId: demoUserId, symbol: 'GOOG', action: 'sell', qty: 10, price: 169.20, reason: 'Death cross',             orderId: 'demo-at-0010', strategy: 'Death Cross',            pnl:  -64.00, tags: ['exit','loss'],   entryContext: { sma50: 171.2, sma200: 172.5 }, createdAt: daysAgo(4),  updatedAt: daysAgo(4)  },
      { userId: demoUserId, symbol: 'SHOP', action: 'buy',  qty: 12, price:  68.90, reason: 'Ascending triangle',      orderId: 'demo-at-0011', strategy: 'Ascending Triangle',     pnl:   75.60, tags: ['pattern'],       entryContext: { resistance: 70.0, higherLow: 65.4 }, createdAt: daysAgo(3),  updatedAt: daysAgo(3)  },
      { userId: demoUserId, symbol: 'MSFT', action: 'buy',  qty: 12, price: 415.30, reason: 'Bollinger bounce',        orderId: 'demo-at-0012', strategy: 'Bollinger Band Bounce',  pnl:  160.80, tags: ['mean-reversion'],entryContext: { bbLower: 414.0, bbMid: 422.5 }, createdAt: daysAgo(2),  updatedAt: daysAgo(2)  },
    ], { individualHooks: false });

    // ─── Notifications (6) ───
    // A couple of sample rows so the /notifications page isn't empty for a
    // fresh demo login. Covers all four `type` values the UI recognises.
    await Notification.bulkCreate([
      { userId: demoUserId, type: 'auto-trader', title: 'BUY 15 NVDA @ $148.90', body: 'Golden Cross — P&L pending',   link: '/auto-trader', read: false, createdAt: daysAgo(6), updatedAt: daysAgo(6) },
      { userId: demoUserId, type: 'auto-trader', title: 'SELL 10 GOOG @ $169.20', body: 'Death Cross — P&L -$64.00',   link: '/auto-trader', read: false, createdAt: daysAgo(4), updatedAt: daysAgo(4) },
      { userId: demoUserId, type: 'price-alert', title: 'TSLA crossed above $260',  body: 'Alert "TSLA > 260" triggered', link: '/price-alerts', read: false, createdAt: daysAgo(3), updatedAt: daysAgo(3) },
      { userId: demoUserId, type: 'security',    title: '2FA enabled on your account', body: 'Backup codes generated. Store them safely.', link: '/account', read: true,  createdAt: daysAgo(2), updatedAt: daysAgo(2) },
      { userId: demoUserId, type: 'info',        title: 'Welcome to claudeTrading', body: 'Browse the sidebar to explore every feature. Start with the Dashboard.', link: '/', read: true, createdAt: daysAgo(1), updatedAt: daysAgo(1) },
      { userId: demoUserId, type: 'auto-trader', title: '[DRY] BUY 20 AAPL @ $195.80', body: 'VWAP Bounce — dry-run fill',  link: '/auto-trader', read: false, createdAt: new Date(), updatedAt: new Date() },
    ], { individualHooks: false });

    // ─── AI Investment Themes ───
    // Seeded from the April-2026 "AI Manifesto" thesis. Global (no userId).
    // Safe to re-run: upsert-by-slug semantics inside seedAiManifesto.
    await seedAiManifesto({ Theme, ThemeConstituent });

    console.log('  Database seeded successfully! (15 items per feature)');
  } catch (err) {
    console.error('  Seed error:', err.message);
    // Try with different connection
    if (err.message.includes('role') || err.message.includes('authentication')) {
      console.error('  Tip: Check your DATABASE_URL in .env');
    }
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

seed();
