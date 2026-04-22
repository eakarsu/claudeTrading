/**
 * Strategy Engine — defines trading strategies and generates buy/sell signals from indicators.
 * Each strategy returns an array of { index, action: 'buy'|'sell', reason } signals.
 */

import { computeAll } from './indicators.js';
import { INTRADAY_STRATEGIES } from './intradayStrategies.js';

// ── Strategy Definitions ──

function macdCrossover(ind) {
  const signals = [];
  const { macd: { macd, signal } } = ind;
  for (let i = 1; i < macd.length; i++) {
    if (macd[i] === null || signal[i] === null || macd[i - 1] === null || signal[i - 1] === null) continue;
    if (macd[i - 1] <= signal[i - 1] && macd[i] > signal[i]) {
      signals.push({ index: i, action: 'buy', reason: 'MACD crossed above signal line' });
    }
    if (macd[i - 1] >= signal[i - 1] && macd[i] < signal[i]) {
      signals.push({ index: i, action: 'sell', reason: 'MACD crossed below signal line' });
    }
  }
  return signals;
}

function rsiOversoldOverbought(ind) {
  const signals = [];
  const { rsi } = ind;
  for (let i = 1; i < rsi.length; i++) {
    if (rsi[i] === null || rsi[i - 1] === null) continue;
    if (rsi[i - 1] < 30 && rsi[i] >= 30) {
      signals.push({ index: i, action: 'buy', reason: `RSI bounced from oversold (${rsi[i].toFixed(1)})` });
    }
    if (rsi[i - 1] > 70 && rsi[i] <= 70) {
      signals.push({ index: i, action: 'sell', reason: `RSI dropped from overbought (${rsi[i].toFixed(1)})` });
    }
  }
  return signals;
}

function goldenDeathCross(ind) {
  const signals = [];
  const { sma50, sma200 } = ind;
  for (let i = 1; i < sma50.length; i++) {
    if (sma50[i] === null || sma200[i] === null || sma50[i - 1] === null || sma200[i - 1] === null) continue;
    if (sma50[i - 1] <= sma200[i - 1] && sma50[i] > sma200[i]) {
      signals.push({ index: i, action: 'buy', reason: 'Golden Cross: SMA50 crossed above SMA200' });
    }
    if (sma50[i - 1] >= sma200[i - 1] && sma50[i] < sma200[i]) {
      signals.push({ index: i, action: 'sell', reason: 'Death Cross: SMA50 crossed below SMA200' });
    }
  }
  return signals;
}

function emaBounce(ind) {
  const signals = [];
  const { ema21, closes } = ind;
  for (let i = 2; i < closes.length; i++) {
    if (ema21[i] === null) continue;
    // Price dips to EMA21 and bounces
    if (closes[i - 1] <= ema21[i - 1] * 1.005 && closes[i - 1] >= ema21[i - 1] * 0.995 && closes[i] > ema21[i]) {
      signals.push({ index: i, action: 'buy', reason: 'Price bounced off EMA21 support' });
    }
    // Price rises to EMA21 and rejects
    if (closes[i - 1] >= ema21[i - 1] * 0.995 && closes[i - 1] <= ema21[i - 1] * 1.005 && closes[i] < ema21[i]) {
      signals.push({ index: i, action: 'sell', reason: 'Price rejected at EMA21 resistance' });
    }
  }
  return signals;
}

function bollingerBounce(ind) {
  const signals = [];
  const { bollinger: { upper, lower }, closes } = ind;
  for (let i = 1; i < closes.length; i++) {
    if (upper[i] === null || lower[i] === null) continue;
    if (closes[i - 1] <= lower[i - 1] && closes[i] > lower[i]) {
      signals.push({ index: i, action: 'buy', reason: 'Price bounced off lower Bollinger Band' });
    }
    if (closes[i - 1] >= upper[i - 1] && closes[i] < upper[i]) {
      signals.push({ index: i, action: 'sell', reason: 'Price rejected at upper Bollinger Band' });
    }
  }
  return signals;
}

function bollingerSqueeze(ind) {
  const signals = [];
  const { bollinger: { upper, lower, middle }, closes } = ind;
  for (let i = 20; i < closes.length; i++) {
    if (upper[i] === null || lower[i] === null) continue;
    const bandwidth = (upper[i] - lower[i]) / middle[i];
    const prevBandwidth = (upper[i - 1] - lower[i - 1]) / middle[i - 1];
    // Squeeze: bandwidth narrows then expands with price breakout
    if (prevBandwidth < 0.04 && bandwidth > 0.04) {
      if (closes[i] > upper[i - 1]) {
        signals.push({ index: i, action: 'buy', reason: 'Bollinger Squeeze breakout to upside' });
      } else if (closes[i] < lower[i - 1]) {
        signals.push({ index: i, action: 'sell', reason: 'Bollinger Squeeze breakout to downside' });
      }
    }
  }
  return signals;
}

function stochasticCrossover(ind) {
  const signals = [];
  const { stochastic: { k, d } } = ind;
  for (let i = 1; i < k.length; i++) {
    if (k[i] === null || d[i] === null || k[i - 1] === null || d[i - 1] === null) continue;
    if (k[i - 1] <= d[i - 1] && k[i] > d[i] && k[i] < 30) {
      signals.push({ index: i, action: 'buy', reason: `Stochastic bullish crossover in oversold zone (K:${k[i].toFixed(0)})` });
    }
    if (k[i - 1] >= d[i - 1] && k[i] < d[i] && k[i] > 70) {
      signals.push({ index: i, action: 'sell', reason: `Stochastic bearish crossover in overbought zone (K:${k[i].toFixed(0)})` });
    }
  }
  return signals;
}

function volumeBreakout(ind) {
  const signals = [];
  const { closes, volumes, sma20 } = ind;
  // Compare volume to 20-period average
  for (let i = 20; i < closes.length; i++) {
    let avgVol = 0;
    for (let j = i - 20; j < i; j++) avgVol += volumes[j];
    avgVol /= 20;
    if (avgVol === 0) continue;

    const volRatio = volumes[i] / avgVol;
    if (volRatio > 2.0 && closes[i] > closes[i - 1] && sma20[i] !== null && closes[i] > sma20[i]) {
      signals.push({ index: i, action: 'buy', reason: `Volume breakout (${volRatio.toFixed(1)}x avg) with price above SMA20` });
    }
    if (volRatio > 2.0 && closes[i] < closes[i - 1] && sma20[i] !== null && closes[i] < sma20[i]) {
      signals.push({ index: i, action: 'sell', reason: `Volume breakdown (${volRatio.toFixed(1)}x avg) with price below SMA20` });
    }
  }
  return signals;
}

function meanReversion(ind) {
  const signals = [];
  const { closes, sma20, rsi } = ind;
  for (let i = 1; i < closes.length; i++) {
    if (sma20[i] === null || rsi[i] === null) continue;
    const deviation = (closes[i] - sma20[i]) / sma20[i];
    // Price far below SMA with oversold RSI → buy
    if (deviation < -0.05 && rsi[i] < 35) {
      signals.push({ index: i, action: 'buy', reason: `Mean reversion: price ${(deviation * 100).toFixed(1)}% below SMA20, RSI ${rsi[i].toFixed(0)}` });
    }
    // Price far above SMA with overbought RSI → sell
    if (deviation > 0.05 && rsi[i] > 65) {
      signals.push({ index: i, action: 'sell', reason: `Mean reversion: price ${(deviation * 100).toFixed(1)}% above SMA20, RSI ${rsi[i].toFixed(0)}` });
    }
  }
  return signals;
}

function trendFollowing(ind) {
  const signals = [];
  const { ema9, ema21, sma50, closes } = ind;
  for (let i = 1; i < closes.length; i++) {
    if (ema9[i] === null || ema21[i] === null || sma50[i] === null) continue;
    // All MAs aligned bullish + EMA9 crosses above EMA21
    if (ema9[i - 1] <= ema21[i - 1] && ema9[i] > ema21[i] && closes[i] > sma50[i]) {
      signals.push({ index: i, action: 'buy', reason: 'Trend following: EMA9 crossed EMA21, price above SMA50' });
    }
    // All MAs aligned bearish
    if (ema9[i - 1] >= ema21[i - 1] && ema9[i] < ema21[i] && closes[i] < sma50[i]) {
      signals.push({ index: i, action: 'sell', reason: 'Trend following: EMA9 crossed below EMA21, price below SMA50' });
    }
  }
  return signals;
}

// Support / Resistance detection using recent swing highs/lows
function supportBounce(ind) {
  const signals = [];
  const { closes, lows, rsi } = ind;
  for (let i = 20; i < closes.length; i++) {
    // Find recent support level (lowest low in last 20 bars)
    let support = Infinity;
    for (let j = i - 20; j < i; j++) support = Math.min(support, lows[j]);
    // Price touches support and bounces with RSI confirmation
    if (lows[i] <= support * 1.005 && closes[i] > support && rsi[i] !== null && rsi[i] < 40) {
      signals.push({ index: i, action: 'buy', reason: `Price bounced off support $${support.toFixed(2)}, RSI ${rsi[i].toFixed(0)}` });
    }
  }
  return signals;
}

function resistanceRejection(ind) {
  const signals = [];
  const { closes, highs, rsi } = ind;
  for (let i = 20; i < closes.length; i++) {
    let resistance = -Infinity;
    for (let j = i - 20; j < i; j++) resistance = Math.max(resistance, highs[j]);
    if (highs[i] >= resistance * 0.995 && closes[i] < resistance && rsi[i] !== null && rsi[i] > 60) {
      signals.push({ index: i, action: 'sell', reason: `Price rejected at resistance $${resistance.toFixed(2)}, RSI ${rsi[i].toFixed(0)}` });
    }
  }
  return signals;
}

function breakout(ind) {
  const signals = [];
  const { closes, highs, volumes } = ind;
  for (let i = 20; i < closes.length; i++) {
    let resistance = -Infinity;
    let avgVol = 0;
    for (let j = i - 20; j < i; j++) {
      resistance = Math.max(resistance, highs[j]);
      avgVol += volumes[j];
    }
    avgVol /= 20;
    // Price breaks above resistance with volume confirmation
    if (closes[i] > resistance && avgVol > 0 && volumes[i] > avgVol * 1.5) {
      signals.push({ index: i, action: 'buy', reason: `Breakout above $${resistance.toFixed(2)} with ${(volumes[i]/avgVol).toFixed(1)}x volume` });
    }
  }
  return signals;
}

function breakdown(ind) {
  const signals = [];
  const { closes, lows, volumes } = ind;
  for (let i = 20; i < closes.length; i++) {
    let support = Infinity;
    let avgVol = 0;
    for (let j = i - 20; j < i; j++) {
      support = Math.min(support, lows[j]);
      avgVol += volumes[j];
    }
    avgVol /= 20;
    if (closes[i] < support && avgVol > 0 && volumes[i] > avgVol * 1.5) {
      signals.push({ index: i, action: 'sell', reason: `Breakdown below $${support.toFixed(2)} with ${(volumes[i]/avgVol).toFixed(1)}x volume` });
    }
  }
  return signals;
}

// Double Bottom: price hits similar low twice, then rallies
function doubleBottom(ind) {
  const signals = [];
  const { closes, lows } = ind;
  for (let i = 40; i < closes.length; i++) {
    // Find two lows within 10-30 bars apart that are within 2% of each other
    for (let gap = 10; gap <= 30 && i - gap >= 10; gap++) {
      const low1 = lows[i - gap];
      const low2 = lows[i];
      if (Math.abs(low1 - low2) / low1 < 0.02 && closes[i] > closes[i - 1] && closes[i] > low2 * 1.02) {
        signals.push({ index: i, action: 'buy', reason: `Double bottom at $${low2.toFixed(2)} (${gap} bars apart)` });
        break;
      }
    }
  }
  return signals;
}

// Double Top: price hits similar high twice, then drops
function doubleTop(ind) {
  const signals = [];
  const { closes, highs } = ind;
  for (let i = 40; i < closes.length; i++) {
    for (let gap = 10; gap <= 30 && i - gap >= 10; gap++) {
      const high1 = highs[i - gap];
      const high2 = highs[i];
      if (Math.abs(high1 - high2) / high1 < 0.02 && closes[i] < closes[i - 1] && closes[i] < high2 * 0.98) {
        signals.push({ index: i, action: 'sell', reason: `Double top at $${high2.toFixed(2)} (${gap} bars apart)` });
        break;
      }
    }
  }
  return signals;
}

// Bull Flag: sharp rally followed by consolidation, then continuation
function bullFlag(ind) {
  const signals = [];
  const { closes, volumes } = ind;
  for (let i = 15; i < closes.length; i++) {
    // Check for pole: 5+ bar rally of 5%+
    const poleStart = closes[i - 15];
    const poleEnd = closes[i - 5];
    const poleGain = (poleEnd - poleStart) / poleStart;
    if (poleGain < 0.05) continue;

    // Check for flag: 5 bars of consolidation (range < 3%)
    let flagHigh = -Infinity, flagLow = Infinity;
    for (let j = i - 5; j < i; j++) {
      flagHigh = Math.max(flagHigh, closes[j]);
      flagLow = Math.min(flagLow, closes[j]);
    }
    const flagRange = (flagHigh - flagLow) / flagLow;
    if (flagRange < 0.03 && closes[i] > flagHigh) {
      signals.push({ index: i, action: 'buy', reason: `Bull flag breakout after ${(poleGain*100).toFixed(1)}% rally` });
    }
  }
  return signals;
}

// Bear Flag: sharp drop followed by consolidation, then continuation down
function bearFlag(ind) {
  const signals = [];
  const { closes } = ind;
  for (let i = 15; i < closes.length; i++) {
    const poleStart = closes[i - 15];
    const poleEnd = closes[i - 5];
    const poleDrop = (poleStart - poleEnd) / poleStart;
    if (poleDrop < 0.05) continue;

    let flagHigh = -Infinity, flagLow = Infinity;
    for (let j = i - 5; j < i; j++) {
      flagHigh = Math.max(flagHigh, closes[j]);
      flagLow = Math.min(flagLow, closes[j]);
    }
    const flagRange = (flagHigh - flagLow) / flagLow;
    if (flagRange < 0.03 && closes[i] < flagLow) {
      signals.push({ index: i, action: 'sell', reason: `Bear flag breakdown after ${(poleDrop*100).toFixed(1)}% drop` });
    }
  }
  return signals;
}

// Ascending Triangle: higher lows converging toward flat resistance
function ascendingTriangle(ind) {
  const signals = [];
  const { closes, highs, lows } = ind;
  for (let i = 30; i < closes.length; i++) {
    // Check flat resistance (highs within 1.5% over last 15 bars)
    let maxHigh = -Infinity, minHigh = Infinity;
    let lowsTrending = true;
    for (let j = i - 15; j < i; j++) {
      maxHigh = Math.max(maxHigh, highs[j]);
      minHigh = Math.min(minHigh, highs[j]);
    }
    if ((maxHigh - minHigh) / minHigh > 0.015) continue;

    // Check higher lows
    const firstLow = Math.min(lows[i - 15], lows[i - 14], lows[i - 13]);
    const lastLow = Math.min(lows[i - 2], lows[i - 1], lows[i]);
    if (lastLow <= firstLow) continue;

    // Breakout above resistance
    if (closes[i] > maxHigh) {
      signals.push({ index: i, action: 'buy', reason: `Ascending triangle breakout above $${maxHigh.toFixed(2)}` });
    }
  }
  return signals;
}

// Fibonacci Retracement: buy at 61.8% retracement of an uptrend
function fibonacciRetracement(ind) {
  const signals = [];
  const { closes, lows, highs } = ind;
  for (let i = 30; i < closes.length; i++) {
    // Find swing high and swing low in last 30 bars
    let swingHigh = -Infinity, swingLow = Infinity;
    for (let j = i - 30; j < i - 5; j++) {
      swingHigh = Math.max(swingHigh, highs[j]);
      swingLow = Math.min(swingLow, lows[j]);
    }
    const range = swingHigh - swingLow;
    if (range <= 0) continue;

    const fib618 = swingHigh - range * 0.618;
    const fib50 = swingHigh - range * 0.5;

    // Price retraces to 61.8% level and bounces
    if (lows[i] <= fib618 * 1.01 && lows[i] >= fib618 * 0.99 && closes[i] > fib618 && closes[i] > closes[i - 1]) {
      signals.push({ index: i, action: 'buy', reason: `Fibonacci 61.8% retracement bounce at $${fib618.toFixed(2)}` });
    }
    // Price retraces to 50% and bounces
    if (lows[i] <= fib50 * 1.01 && lows[i] >= fib50 * 0.99 && closes[i] > fib50 && closes[i] > closes[i - 1]) {
      signals.push({ index: i, action: 'buy', reason: `Fibonacci 50% retracement bounce at $${fib50.toFixed(2)}` });
    }
  }
  return signals;
}

// VWAP Bounce: price touches VWAP and bounces
function vwapBounce(ind) {
  const signals = [];
  const { closes, vwap } = ind;
  for (let i = 1; i < closes.length; i++) {
    if (!vwap[i]) continue;
    // Price dips to VWAP from above and bounces
    if (closes[i - 1] > vwap[i - 1] && closes[i] <= vwap[i] * 1.003 && closes[i] >= vwap[i] * 0.997) {
      if (i + 1 < closes.length && closes[i + 1] > vwap[i + 1]) {
        signals.push({ index: i + 1, action: 'buy', reason: `VWAP bounce at $${vwap[i].toFixed(2)}` });
      }
    }
    // Price rises to VWAP from below and rejects
    if (closes[i - 1] < vwap[i - 1] && closes[i] >= vwap[i] * 0.997 && closes[i] <= vwap[i] * 1.003) {
      if (i + 1 < closes.length && closes[i + 1] < vwap[i + 1]) {
        signals.push({ index: i + 1, action: 'sell', reason: `VWAP rejection at $${vwap[i].toFixed(2)}` });
      }
    }
  }
  return signals;
}

// Ichimoku Cloud: simplified — EMA9 > EMA21 > SMA50 with price above all = bullish
function ichimokuCloud(ind) {
  const signals = [];
  const { ema9, ema21, sma50, closes } = ind;
  for (let i = 1; i < closes.length; i++) {
    if (ema9[i] === null || ema21[i] === null || sma50[i] === null) continue;
    const prev9 = ema9[i - 1], prev21 = ema21[i - 1], prev50 = sma50[i - 1];
    if (prev9 === null || prev21 === null || prev50 === null) continue;

    // Bullish: price crosses above the "cloud" (all MAs aligned up)
    const bullishNow = ema9[i] > ema21[i] && ema21[i] > sma50[i] && closes[i] > ema9[i];
    const bullishPrev = prev9 > prev21 && prev21 > prev50 && closes[i - 1] > prev9;
    if (bullishNow && !bullishPrev) {
      signals.push({ index: i, action: 'buy', reason: 'Ichimoku Cloud: price above aligned MAs (bullish cloud breakout)' });
    }

    // Bearish: all MAs aligned down
    const bearishNow = ema9[i] < ema21[i] && ema21[i] < sma50[i] && closes[i] < ema9[i];
    const bearishPrev = prev9 < prev21 && prev21 < prev50 && closes[i - 1] < prev9;
    if (bearishNow && !bearishPrev) {
      signals.push({ index: i, action: 'sell', reason: 'Ichimoku Cloud: price below aligned MAs (bearish cloud breakdown)' });
    }
  }
  return signals;
}

// Range Bound: buy at bottom of range, sell at top
function rangeBound(ind) {
  const signals = [];
  const { closes, highs, lows, rsi } = ind;
  for (let i = 30; i < closes.length; i++) {
    let rangeHigh = -Infinity, rangeLow = Infinity;
    for (let j = i - 30; j < i; j++) {
      rangeHigh = Math.max(rangeHigh, highs[j]);
      rangeLow = Math.min(rangeLow, lows[j]);
    }
    const rangeSize = (rangeHigh - rangeLow) / rangeLow;
    if (rangeSize > 0.15 || rangeSize < 0.03) continue; // Only in a defined range

    const position = (closes[i] - rangeLow) / (rangeHigh - rangeLow);
    if (position < 0.15 && rsi[i] !== null && rsi[i] < 35) {
      signals.push({ index: i, action: 'buy', reason: `Range bound buy near bottom $${rangeLow.toFixed(2)}` });
    }
    if (position > 0.85 && rsi[i] !== null && rsi[i] > 65) {
      signals.push({ index: i, action: 'sell', reason: `Range bound sell near top $${rangeHigh.toFixed(2)}` });
    }
  }
  return signals;
}

// Cup & Handle: rounded bottom followed by small pullback, then breakout
function cupAndHandle(ind) {
  const signals = [];
  const { closes, highs } = ind;
  for (let i = 40; i < closes.length; i++) {
    // Cup: price drops and recovers over ~30 bars
    const cupStart = closes[i - 35];
    const cupBottom = Math.min(...closes.slice(i - 30, i - 10));
    const cupEnd = closes[i - 5];
    const cupDrop = (cupStart - cupBottom) / cupStart;

    if (cupDrop < 0.05 || cupDrop > 0.30) continue;
    if (Math.abs(cupEnd - cupStart) / cupStart > 0.03) continue; // Cup lip should be roughly even

    // Handle: small pullback in last 5 bars
    const handleHigh = Math.max(...closes.slice(i - 5, i));
    const handleLow = Math.min(...closes.slice(i - 5, i));
    const handleDrop = (handleHigh - handleLow) / handleHigh;

    if (handleDrop > 0.01 && handleDrop < 0.05 && closes[i] > handleHigh) {
      signals.push({ index: i, action: 'buy', reason: `Cup & Handle breakout (cup depth ${(cupDrop*100).toFixed(1)}%)` });
    }
  }
  return signals;
}

// Head & Shoulders: three peaks, middle highest, then breakdown
function headAndShoulders(ind) {
  const signals = [];
  const { closes, highs } = ind;
  for (let i = 40; i < closes.length; i++) {
    // Find three peaks roughly spaced
    const leftShoulder = Math.max(...highs.slice(i - 35, i - 25));
    const head = Math.max(...highs.slice(i - 25, i - 10));
    const rightShoulder = Math.max(...highs.slice(i - 10, i));

    if (head <= leftShoulder || head <= rightShoulder) continue;
    if (Math.abs(leftShoulder - rightShoulder) / leftShoulder > 0.05) continue; // Shoulders roughly equal

    // Neckline break
    const neckline = Math.min(...closes.slice(i - 30, i - 5));
    if (closes[i] < neckline && closes[i - 1] >= neckline) {
      signals.push({ index: i, action: 'sell', reason: `Head & Shoulders: neckline break at $${neckline.toFixed(2)}` });
    }
  }
  return signals;
}

// ── Strategy Registry ──

export const STRATEGIES = {
  macd_crossover: {
    name: 'MACD Crossover',
    description: 'Buy when MACD crosses above signal line, sell when it crosses below',
    fn: macdCrossover,
  },
  rsi_oversold: {
    name: 'RSI Oversold/Overbought',
    description: 'Buy when RSI bounces from below 30, sell when it drops from above 70',
    fn: rsiOversoldOverbought,
  },
  golden_cross: {
    name: 'Golden/Death Cross',
    description: 'Buy on golden cross (SMA50 > SMA200), sell on death cross',
    fn: goldenDeathCross,
  },
  ema_bounce: {
    name: 'EMA Bounce',
    description: 'Buy when price bounces off EMA21 support, sell on rejection',
    fn: emaBounce,
  },
  bollinger_bounce: {
    name: 'Bollinger Band Bounce',
    description: 'Buy at lower band bounce, sell at upper band rejection',
    fn: bollingerBounce,
  },
  bollinger_squeeze: {
    name: 'Bollinger Squeeze',
    description: 'Trade breakouts after Bollinger Band squeeze (low volatility → expansion)',
    fn: bollingerSqueeze,
  },
  stochastic_crossover: {
    name: 'Stochastic Crossover',
    description: 'Buy on bullish K/D crossover in oversold zone, sell in overbought zone',
    fn: stochasticCrossover,
  },
  volume_breakout: {
    name: 'Volume Breakout',
    description: 'Trade when volume spikes 2x+ above average with price direction',
    fn: volumeBreakout,
  },
  mean_reversion: {
    name: 'Mean Reversion',
    description: 'Buy when price is far below SMA20 with low RSI, sell when far above with high RSI',
    fn: meanReversion,
  },
  trend_following: {
    name: 'Trend Following',
    description: 'Trade EMA9/EMA21 crossovers confirmed by SMA50 trend direction',
    fn: trendFollowing,
  },
  support_bounce: {
    name: 'Support Bounce',
    description: 'Buy when price bounces off recent support level with RSI confirmation',
    fn: supportBounce,
  },
  resistance_rejection: {
    name: 'Resistance Rejection',
    description: 'Sell when price is rejected at recent resistance with overbought RSI',
    fn: resistanceRejection,
  },
  breakout: {
    name: 'Breakout',
    description: 'Buy when price breaks above resistance with volume surge',
    fn: breakout,
  },
  breakdown: {
    name: 'Breakdown',
    description: 'Sell when price breaks below support with volume surge',
    fn: breakdown,
  },
  double_bottom: {
    name: 'Double Bottom',
    description: 'Buy when price forms two similar lows and bounces (W pattern)',
    fn: doubleBottom,
  },
  double_top: {
    name: 'Double Top',
    description: 'Sell when price forms two similar highs and drops (M pattern)',
    fn: doubleTop,
  },
  bull_flag: {
    name: 'Bull Flag',
    description: 'Buy on breakout after a sharp rally followed by tight consolidation',
    fn: bullFlag,
  },
  bear_flag: {
    name: 'Bear Flag',
    description: 'Sell on breakdown after a sharp drop followed by tight consolidation',
    fn: bearFlag,
  },
  ascending_triangle: {
    name: 'Ascending Triangle',
    description: 'Buy when higher lows converge toward flat resistance and break out',
    fn: ascendingTriangle,
  },
  fibonacci_retracement: {
    name: 'Fibonacci Retracement',
    description: 'Buy at 50% or 61.8% Fibonacci retracement levels of an uptrend',
    fn: fibonacciRetracement,
  },
  vwap_bounce: {
    name: 'VWAP Bounce',
    description: 'Buy when price bounces off VWAP, sell when price rejects at VWAP',
    fn: vwapBounce,
  },
  ichimoku_cloud: {
    name: 'Ichimoku Cloud',
    description: 'Trade when price breaks above/below aligned MA cloud structure',
    fn: ichimokuCloud,
  },
  range_bound: {
    name: 'Range Bound',
    description: 'Buy at bottom of trading range, sell at top — with RSI confirmation',
    fn: rangeBound,
  },
  cup_and_handle: {
    name: 'Cup & Handle',
    description: 'Buy on breakout from rounded bottom (cup) and small pullback (handle)',
    fn: cupAndHandle,
  },
  head_and_shoulders: {
    name: 'Head & Shoulders',
    description: 'Sell when three-peak pattern (higher middle) breaks its neckline',
    fn: headAndShoulders,
  },
  // Intraday day-trading strategies — gated on intraday bars via their own
  // time-string check. On daily bars they no-op, so they won't pollute daily
  // backtests.
  ...INTRADAY_STRATEGIES,
};

// Run a strategy on bars and return signals with prices/times
export function runStrategy(strategyKey, bars) {
  const strategy = STRATEGIES[strategyKey];
  if (!strategy) throw new Error(`Unknown strategy: ${strategyKey}`);

  const indicators = computeAll(bars);
  const rawSignals = strategy.fn(indicators);

  return rawSignals.map(sig => ({
    ...sig,
    time: bars[sig.index].time,
    price: bars[sig.index].close,
  }));
}

// Run all strategies on bars
export function runAllStrategies(bars) {
  const indicators = computeAll(bars);
  const results = {};

  for (const [key, strategy] of Object.entries(STRATEGIES)) {
    const rawSignals = strategy.fn(indicators);
    results[key] = {
      name: strategy.name,
      description: strategy.description,
      signals: rawSignals.map(sig => ({
        ...sig,
        time: bars[sig.index].time,
        price: bars[sig.index].close,
      })),
    };
  }

  return results;
}
