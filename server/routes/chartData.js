import { Router } from 'express';

const router = Router();

/**
 * Generate realistic OHLC candlestick data around a base price.
 * Also returns markers for buy/sell/stop/target levels.
 */
// Intraday (day trading) chart - 5-minute candles for the current day
router.get('/:symbol/intraday', (req, res) => {
  const { symbol } = req.params;
  const { seed } = req.query;
  const candles = generateIntradayCandles(seed || symbol);
  res.json({ candles, symbol, interval: 'intraday' });
});

// Unified bars endpoint — serves any of the supported auto-trader timeframes.
// The /intraday and /:symbol routes remain for backwards compatibility; new
// callers should prefer this one with an explicit ?timeframe=<tf>.
router.get('/:symbol/bars', (req, res) => {
  const { symbol } = req.params;
  const { timeframe = '1Day', seed } = req.query;
  const seedKey = seed || symbol;
  let candles;
  switch (timeframe) {
    case '1Min':  candles = generateIntervalCandles(seedKey, 1,  390); break;
    case '5Min':  candles = generateIntervalCandles(seedKey, 5,  78);  break;
    case '15Min': candles = generateIntervalCandles(seedKey, 15, 26);  break;
    case '1H':    candles = generateIntervalCandles(seedKey, 60, 7);   break;
    case '4H':    candles = generateIntervalCandles(seedKey, 240, 14); break;
    case '1Day':
    default:      candles = generateCandles(seedKey, getSymbolPrice(extractSymbol(seedKey)), 90); break;
  }
  res.json({ candles, symbol, timeframe });
});

// Daily chart
router.get('/:symbol', (req, res) => {
  const { symbol } = req.params;
  const {
    days = 90,
    basePrice = 100,
    seed,
    entryPrice,
    exitPrice,
    stopPrice,
    targetPrice,
    floorPrice,
    strikePrice,
    action,       // buy, sell
    tradeDate,
  } = req.query;

  const price = parseFloat(basePrice);
  const numDays = parseInt(days);
  const candles = generateCandles(seed || symbol, price, numDays);
  const markers = generateMarkers(candles, {
    entryPrice: entryPrice ? parseFloat(entryPrice) : null,
    exitPrice: exitPrice ? parseFloat(exitPrice) : null,
    stopPrice: stopPrice ? parseFloat(stopPrice) : null,
    targetPrice: targetPrice ? parseFloat(targetPrice) : null,
    floorPrice: floorPrice ? parseFloat(floorPrice) : null,
    strikePrice: strikePrice ? parseFloat(strikePrice) : null,
    action,
    tradeDate,
  });

  const priceLines = generatePriceLines({
    entryPrice: entryPrice ? parseFloat(entryPrice) : null,
    exitPrice: exitPrice ? parseFloat(exitPrice) : null,
    stopPrice: stopPrice ? parseFloat(stopPrice) : null,
    targetPrice: targetPrice ? parseFloat(targetPrice) : null,
    floorPrice: floorPrice ? parseFloat(floorPrice) : null,
    strikePrice: strikePrice ? parseFloat(strikePrice) : null,
  });

  res.json({ candles, markers, priceLines, symbol });
});

// Fixed reference prices per symbol so every feature shows the same chart
const SYMBOL_PRICES = {
  TSLA: 262, NVDA: 149, AAPL: 196, AMZN: 192, MSFT: 429,
  GOOG: 169, META: 529, AMD: 155, NFLX: 726, CRM: 268,
  PLTR: 29, COIN: 249, SQ: 72, SHOP: 75, SOFI: 11, SMCI: 43, SPY: 520,
};

function getSymbolPrice(symbol) {
  return SYMBOL_PRICES[symbol.toUpperCase()] || 100;
}

// Seeded PRNG so the same symbol always produces the same chart
function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) {
    s = ((s << 5) - s + seed.charCodeAt(i)) | 0;
  }
  return function () {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 4294967296);
  };
}

function extractSymbol(seedKey) {
  const m = seedKey.match(/[A-Z]{1,5}/);
  return m ? m[0] : seedKey;
}

// Parameterised intraday candle generator — covers 1/5/15/60-minute bars.
// maxCandles caps full-day output; for 60-minute we pass 7 to span a week.
function generateIntervalCandles(seedKey, intervalMinutes, maxCandles) {
  const fixedPrice = getSymbolPrice(extractSymbol(seedKey));
  const rand = seededRandom(`${seedKey}-${intervalMinutes}m`);

  const candles = [];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  // Day-scoped (intraday): limit to candles that fit before the current ET time.
  // Multi-day (1H over a week): just emit the full span.
  const isIntraday = intervalMinutes < 60;
  let candlesToEmit = maxCandles;
  if (isIntraday) {
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
    const minutesIntoSession = currentMinutes - (9 * 60 + 30);
    candlesToEmit = Math.min(maxCandles, Math.max(1, Math.floor(minutesIntoSession / intervalMinutes) + 1));
  }

  let price = fixedPrice * (0.98 + rand() * 0.04);
  // Per-candle volatility scales with interval length (rough sqrt-time heuristic).
  const volScale = Math.sqrt(intervalMinutes / 5) * 0.003;

  for (let i = 0; i < candlesToEmit; i++) {
    let timestamp;
    if (isIntraday) {
      const minutesSinceOpen = i * intervalMinutes;
      const hour = Math.floor((minutesSinceOpen + 570) / 60);
      const minute = (minutesSinceOpen + 570) % 60;
      timestamp = Math.floor(Date.UTC(year, month, day, hour, minute, 0) / 1000);
    } else {
      // Hourly / multi-hour bars: walk back `candlesToEmit` intervals from now, skipping weekends.
      const d = new Date(now.getTime() - (candlesToEmit - 1 - i) * intervalMinutes * 60 * 1000);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      timestamp = Math.floor(d.getTime() / 1000);
    }

    const volatility = fixedPrice * volScale;
    const timeMultiplier = (isIntraday && (i < 6 || i > candlesToEmit - 6)) ? 1.8 : 1.0;
    const change = (rand() - 0.48) * volatility * timeMultiplier;

    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + rand() * volatility * 0.4;
    const low = Math.min(open, close) - rand() * volatility * 0.4;

    candles.push({
      time: timestamp,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
    });

    price = close;
  }

  return candles;
}

function generateIntradayCandles(seedKey) {
  const fixedPrice = getSymbolPrice(extractSymbol(seedKey));
  const rand = seededRandom(seedKey + '-intraday');

  const candles = [];
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();

  // Get current time in ET to limit candles to "now"
  const nowET = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentMinutesSinceMidnight = nowET.getHours() * 60 + nowET.getMinutes();
  const marketOpenMinute = 9 * 60 + 30; // 9:30 AM ET
  const minutesIntoSession = currentMinutesSinceMidnight - marketOpenMinute;

  let price = fixedPrice * (0.98 + rand() * 0.04); // open near fixed price

  // Market hours: 9:30 AM to 4:00 PM ET = 390 minutes
  // Generate 5-minute candles, but only up to the current time
  const intervalMinutes = 5;
  const maxCandles = 78; // full day
  const candlesUpToNow = Math.min(maxCandles, Math.max(1, Math.floor(minutesIntoSession / intervalMinutes) + 1));

  for (let i = 0; i < candlesUpToNow; i++) {
    const minutesSinceOpen = i * intervalMinutes;
    const hour = Math.floor((minutesSinceOpen + 570) / 60); // 570 = 9*60+30
    const minute = (minutesSinceOpen + 570) % 60;

    const volatility = fixedPrice * 0.003; // 0.3% per 5min
    // Higher volatility at open and close
    const timeMultiplier = (i < 6 || i > 72) ? 1.8 : 1.0;
    const change = (rand() - 0.48) * volatility * timeMultiplier;

    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + rand() * volatility * 0.4;
    const low = Math.min(open, close) - rand() * volatility * 0.4;

    // Use Date.UTC so lightweight-charts (which displays as UTC) shows correct ET market hours
    const timestamp = Math.floor(Date.UTC(year, month, day, hour, minute, 0) / 1000);

    candles.push({
      time: timestamp,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
    });

    price = close;
  }

  return candles;
}

function generateCandles(seedKey, _basePrice, numDays) {
  // Extract symbol from seed key (e.g. "trailing-stop-TSLA-3" -> TSLA)
  const symbolMatch = seedKey.match(/[A-Z]{1,5}/);
  const fixedPrice = getSymbolPrice(symbolMatch ? symbolMatch[0] : seedKey);
  const rand = seededRandom(seedKey);
  const candles = [];
  const now = new Date();
  let price = fixedPrice * (0.85 + rand() * 0.15); // start 85-100% of fixed

  for (let i = numDays; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);

    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const volatility = fixedPrice * 0.02; // 2% daily volatility
    const drift = (fixedPrice - price) * 0.01; // mean reversion toward fixed
    const change = drift + (rand() - 0.48) * volatility;

    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + rand() * volatility * 0.5;
    const low = Math.min(open, close) - rand() * volatility * 0.5;

    candles.push({
      time: date.toISOString().split('T')[0],
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
    });

    price = close;
  }

  return candles;
}

function generateMarkers(candles, opts) {
  const markers = [];
  if (!candles.length) return markers;

  const { entryPrice, exitPrice, stopPrice, targetPrice, floorPrice, strikePrice, action, tradeDate } = opts;

  // Find best candle for trade date or ~60% through the data
  let entryIdx = Math.floor(candles.length * 0.4);
  if (tradeDate) {
    const idx = candles.findIndex(c => c.time >= tradeDate);
    if (idx >= 0) entryIdx = idx;
  }

  // Entry marker
  if (entryPrice || action) {
    markers.push({
      time: candles[entryIdx].time,
      position: 'belowBar',
      color: '#10b981',
      shape: 'arrowUp',
      text: `BUY${entryPrice ? ' @ $' + entryPrice.toFixed(2) : ''}`,
    });
  }

  // Exit / Sell marker
  if (exitPrice) {
    const exitIdx = Math.min(entryIdx + Math.floor(candles.length * 0.25), candles.length - 3);
    markers.push({
      time: candles[exitIdx].time,
      position: 'aboveBar',
      color: exitPrice > (entryPrice || 0) ? '#10b981' : '#ef4444',
      shape: 'arrowDown',
      text: `SELL @ $${exitPrice.toFixed(2)}`,
    });
  }

  // Stop loss marker
  if (stopPrice) {
    const stopIdx = Math.min(entryIdx + 5, candles.length - 1);
    markers.push({
      time: candles[stopIdx].time,
      position: 'belowBar',
      color: '#ef4444',
      shape: 'circle',
      text: `STOP $${stopPrice.toFixed(2)}`,
    });
  }

  // Target marker
  if (targetPrice) {
    const targetIdx = Math.min(entryIdx + 15, candles.length - 1);
    markers.push({
      time: candles[targetIdx].time,
      position: 'aboveBar',
      color: '#10b981',
      shape: 'circle',
      text: `TARGET $${targetPrice.toFixed(2)}`,
    });
  }

  // Floor marker (trailing stop)
  if (floorPrice) {
    const floorIdx = Math.max(candles.length - 5, 0);
    markers.push({
      time: candles[floorIdx].time,
      position: 'belowBar',
      color: '#f59e0b',
      shape: 'square',
      text: `FLOOR $${floorPrice.toFixed(2)}`,
    });
  }

  // Strike marker (options)
  if (strikePrice) {
    const strikeIdx = Math.floor(candles.length * 0.6);
    markers.push({
      time: candles[strikeIdx].time,
      position: 'aboveBar',
      color: '#8b5cf6',
      shape: 'square',
      text: `STRIKE $${strikePrice.toFixed(2)}`,
    });
  }

  return markers;
}

function generatePriceLines(opts) {
  const lines = [];
  const { entryPrice, exitPrice, stopPrice, targetPrice, floorPrice, strikePrice } = opts;

  if (entryPrice) lines.push({ price: entryPrice, color: '#3b82f6', title: 'Entry', lineWidth: 2, lineStyle: 0 });
  if (exitPrice) lines.push({ price: exitPrice, color: '#8b5cf6', title: 'Exit', lineWidth: 1, lineStyle: 2 });
  if (stopPrice) lines.push({ price: stopPrice, color: '#ef4444', title: 'Stop Loss', lineWidth: 2, lineStyle: 2 });
  if (targetPrice) lines.push({ price: targetPrice, color: '#10b981', title: 'Target', lineWidth: 2, lineStyle: 2 });
  if (floorPrice) lines.push({ price: floorPrice, color: '#f59e0b', title: 'Floor', lineWidth: 2, lineStyle: 1 });
  if (strikePrice) lines.push({ price: strikePrice, color: '#8b5cf6', title: 'Strike', lineWidth: 2, lineStyle: 1 });

  return lines;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export default router;
