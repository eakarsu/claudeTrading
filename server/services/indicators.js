/**
 * Technical indicator calculations from OHLCV price data.
 * All functions expect an array of { time, open, high, low, close, volume } objects sorted by time ascending.
 */

// Simple Moving Average
export function SMA(closes, period) {
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    result.push(sum / period);
  }
  return result;
}

// Exponential Moving Average
export function EMA(closes, period) {
  const result = [];
  const k = 2 / (period + 1);
  let ema = null;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (ema === null) {
      // Seed with SMA
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      ema = sum / period;
    } else {
      ema = closes[i] * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

// Relative Strength Index
export function RSI(closes, period = 14) {
  const result = [];
  if (closes.length < period + 1) return closes.map(() => null);

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = 0; i < period; i++) result.push(null);

  // When there are no losses, RSI is undefined in the textbook formula
  // (avgGain/0 → ∞). Convention is to return 100 directly rather than using
  // a sentinel rs that produces 99.01. Symmetric treatment for no gains → 0.
  const firstRsi = avgLoss === 0
    ? (avgGain === 0 ? 50 : 100)
    : 100 - 100 / (1 + avgGain / avgLoss);
  result.push(firstRsi);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0
      ? (avgGain === 0 ? 50 : 100)
      : 100 - 100 / (1 + avgGain / avgLoss);
    result.push(rsi);
  }
  return result;
}

// MACD (returns { macd, signal, histogram } arrays)
export function MACD(closes, fast = 12, slow = 26, sig = 9) {
  const emaFast = EMA(closes, fast);
  const emaSlow = EMA(closes, slow);

  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] === null || emaSlow[i] === null) { macdLine.push(null); continue; }
    macdLine.push(emaFast[i] - emaSlow[i]);
  }

  // Signal line = EMA of MACD values (skip nulls)
  const validMacd = macdLine.filter(v => v !== null);
  const signalVals = EMA(validMacd, sig);

  const signal = [];
  const histogram = [];
  let vi = 0;
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] === null) {
      signal.push(null);
      histogram.push(null);
    } else {
      signal.push(signalVals[vi] || null);
      histogram.push(signalVals[vi] !== null ? macdLine[i] - signalVals[vi] : null);
      vi++;
    }
  }

  return { macd: macdLine, signal, histogram };
}

// Bollinger Bands (returns { upper, middle, lower } arrays)
export function BollingerBands(closes, period = 20, stdDevMultiplier = 2) {
  const middle = SMA(closes, period);
  const upper = [];
  const lower = [];

  for (let i = 0; i < closes.length; i++) {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - middle[i]) ** 2;
    }
    const stdDev = Math.sqrt(sumSq / period);
    upper.push(middle[i] + stdDevMultiplier * stdDev);
    lower.push(middle[i] - stdDevMultiplier * stdDev);
  }

  return { upper, middle, lower };
}

// Stochastic Oscillator (returns { k, d } arrays)
export function Stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const kValues = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) { kValues.push(null); continue; }
    let highestHigh = -Infinity, lowestLow = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > highestHigh) highestHigh = highs[j];
      if (lows[j] < lowestLow) lowestLow = lows[j];
    }
    const range = highestHigh - lowestLow;
    kValues.push(range === 0 ? 50 : ((closes[i] - lowestLow) / range) * 100);
  }

  const validK = kValues.filter(v => v !== null);
  const dSma = SMA(validK, dPeriod);
  const dValues = [];
  let vi = 0;
  for (let i = 0; i < closes.length; i++) {
    if (kValues[i] === null) { dValues.push(null); }
    else { dValues.push(dSma[vi] || null); vi++; }
  }

  return { k: kValues, d: dValues };
}

// Average True Range
export function ATR(highs, lows, closes, period = 14) {
  const tr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { tr.push(highs[i] - lows[i]); continue; }
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  // Smoothed ATR
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += tr[j];
      result.push(sum / period);
      continue;
    }
    result.push((result[result.length - 1] * (period - 1) + tr[i]) / period);
  }
  return result;
}

// ADX (Average Directional Index) — trend strength (0-100, >25 = trending)
export function ADX(highs, lows, closes, period = 14) {
  const n = closes.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }
  // Wilder smoothing
  const smooth = (arr) => {
    const out = new Array(n).fill(null);
    if (n <= period) return out;
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += arr[i];
    out[period] = sum;
    for (let i = period + 1; i < n; i++) {
      out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    }
    return out;
  };
  const sTR = smooth(tr);
  const sPlus = smooth(plusDM);
  const sMinus = smooth(minusDM);
  const dx = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (sTR[i] == null || sTR[i] === 0) continue;
    const plusDI = (sPlus[i] / sTR[i]) * 100;
    const minusDI = (sMinus[i] / sTR[i]) * 100;
    const sum = plusDI + minusDI;
    dx[i] = sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100;
  }
  const adx = new Array(n).fill(null);
  // ADX is SMA of DX across 'period' bars then Wilder smoothed
  const firstIdx = period * 2;
  if (n > firstIdx) {
    let sum = 0;
    for (let i = period + 1; i <= firstIdx; i++) sum += dx[i] || 0;
    adx[firstIdx] = sum / period;
    for (let i = firstIdx + 1; i < n; i++) {
      adx[i] = (adx[i - 1] * (period - 1) + (dx[i] || 0)) / period;
    }
  }
  return adx;
}

// VWAP (Volume Weighted Average Price) - for intraday
export function VWAP(highs, lows, closes, volumes) {
  const result = [];
  let cumVol = 0, cumTP = 0;
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumVol += volumes[i] || 1;
    cumTP += tp * (volumes[i] || 1);
    result.push(cumTP / cumVol);
  }
  return result;
}

// Compute all indicators for a set of bars
export function computeAll(bars) {
  const closes = bars.map(b => b.close);
  const opens = bars.map(b => b.open);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume || 0);
  const times = bars.map(b => b.time);

  return {
    sma20: SMA(closes, 20),
    sma50: SMA(closes, 50),
    sma200: SMA(closes, 200),
    ema9: EMA(closes, 9),
    ema21: EMA(closes, 21),
    rsi: RSI(closes, 14),
    macd: MACD(closes),
    bollinger: BollingerBands(closes),
    stochastic: Stochastic(highs, lows, closes),
    atr: ATR(highs, lows, closes),
    adx: ADX(highs, lows, closes),
    vwap: VWAP(highs, lows, closes, volumes),
    closes,
    opens,
    highs,
    lows,
    volumes,
    times,
  };
}
