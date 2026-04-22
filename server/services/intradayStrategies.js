/**
 * Intraday day-trading strategies.
 *
 * Tuned for 1Min/5Min/15Min bars. They inspect `times` and `opens` to detect
 * session boundaries, gaps, and opening-range behavior — things the
 * daily-bar strategies don't have visibility into. On daily bars these
 * strategies produce no signals (they exit early when `times` aren't ISO).
 */

function getDate(t) {
  if (typeof t !== 'string') return String(t);
  return t.slice(0, 10);
}

function isIntradayTime(t) {
  // Daily bars store "YYYY-MM-DD" (length 10). Intraday bars store full ISO.
  return typeof t === 'string' && t.length > 10;
}

// Group bar indices by session (calendar date).
function sessionSegments(times) {
  const segments = [];
  if (!times.length) return segments;
  let start = 0;
  for (let i = 1; i < times.length; i++) {
    if (getDate(times[i]) !== getDate(times[i - 1])) {
      segments.push({ startIdx: start, endIdx: i - 1, date: getDate(times[i - 1]) });
      start = i;
    }
  }
  segments.push({
    startIdx: start,
    endIdx: times.length - 1,
    date: getDate(times[times.length - 1]),
  });
  return segments;
}

/**
 * Opening Range Breakout (ORB) — break above/below the first ~30m of the session.
 */
function openingRangeBreakout(ind) {
  const signals = [];
  const { closes, highs, lows, volumes, times } = ind;
  if (!times || !isIntradayTime(times[0])) return signals;

  const OR_BARS = 6; // ~30m on 5Min, ~90m on 15Min — coarse but robust
  const segments = sessionSegments(times);

  for (const seg of segments) {
    const orLen = Math.min(OR_BARS, seg.endIdx - seg.startIdx);
    if (orLen < 2) continue;

    let orHigh = -Infinity;
    let orLow = Infinity;
    let orVol = 0;
    for (let j = seg.startIdx; j < seg.startIdx + orLen; j++) {
      orHigh = Math.max(orHigh, highs[j]);
      orLow = Math.min(orLow, lows[j]);
      orVol += volumes[j] || 0;
    }
    const avgOrVol = orVol / orLen;

    // First breakout wins; don't re-fire the same session.
    for (let i = seg.startIdx + orLen; i <= seg.endIdx; i++) {
      if (closes[i] > orHigh && (volumes[i] || 0) > avgOrVol) {
        signals.push({
          index: i,
          action: 'buy',
          reason: `ORB: breakout above opening range high $${orHigh.toFixed(2)}`,
        });
        break;
      }
      if (closes[i] < orLow && (volumes[i] || 0) > avgOrVol) {
        signals.push({
          index: i,
          action: 'sell',
          reason: `ORB: breakdown below opening range low $${orLow.toFixed(2)}`,
        });
        break;
      }
    }
  }
  return signals;
}

/**
 * VWAP Reclaim / Rejection — intraday-tuned, volume-confirmed crossover of VWAP.
 */
function vwapReclaim(ind) {
  const signals = [];
  const { closes, vwap, volumes, times } = ind;
  if (!times || !isIntradayTime(times[0])) return signals;

  for (let i = 21; i < closes.length; i++) {
    if (vwap[i] == null || vwap[i - 1] == null) continue;

    let avgVol = 0;
    for (let j = i - 20; j < i; j++) avgVol += volumes[j] || 0;
    avgVol /= 20;
    const volOk = avgVol > 0 && (volumes[i] || 0) > avgVol;
    if (!volOk) continue;

    if (closes[i - 1] < vwap[i - 1] && closes[i] > vwap[i]) {
      signals.push({ index: i, action: 'buy', reason: `VWAP reclaim at $${vwap[i].toFixed(2)}` });
    } else if (closes[i - 1] > vwap[i - 1] && closes[i] < vwap[i]) {
      signals.push({ index: i, action: 'sell', reason: `VWAP rejection at $${vwap[i].toFixed(2)}` });
    }
  }
  return signals;
}

/**
 * Gap-and-Go — session opens >1% above prior close, holds VWAP for 2 bars,
 * with elevated volume. One of the canonical momentum setups.
 */
function gapAndGo(ind) {
  const signals = [];
  const { closes, opens, vwap, volumes, times } = ind;
  if (!times || !isIntradayTime(times[0]) || !opens) return signals;

  const segments = sessionSegments(times);
  for (let s = 1; s < segments.length; s++) {
    const seg = segments[s];
    const prev = segments[s - 1];
    const priorClose = closes[prev.endIdx];
    const sessionOpen = opens[seg.startIdx];
    const gap = (sessionOpen - priorClose) / priorClose;
    if (gap < 0.01) continue;

    const confirmIdx = seg.startIdx + 2;
    if (confirmIdx > seg.endIdx) continue;
    const holdsVwap =
      vwap[seg.startIdx + 1] != null && closes[seg.startIdx + 1] > vwap[seg.startIdx + 1] &&
      vwap[confirmIdx] != null && closes[confirmIdx] > vwap[confirmIdx];
    if (!holdsVwap) continue;

    // Volume filter: first 3 bars of today vs yesterday's average
    const priorLen = prev.endIdx - prev.startIdx + 1;
    let priorAvg = 0;
    for (let j = prev.startIdx; j <= prev.endIdx; j++) priorAvg += volumes[j] || 0;
    priorAvg /= priorLen || 1;
    const todayAvg =
      ((volumes[seg.startIdx] || 0) +
        (volumes[seg.startIdx + 1] || 0) +
        (volumes[confirmIdx] || 0)) / 3;
    if (priorAvg > 0 && todayAvg < priorAvg * 1.2) continue;

    signals.push({
      index: confirmIdx,
      action: 'buy',
      reason: `Gap-and-Go: ${(gap * 100).toFixed(1)}% gap holding above VWAP`,
    });
  }
  return signals;
}

/**
 * Gap-Fill Fade — gap fails to hold, fade the move back toward prior close.
 */
function gapFillFade(ind) {
  const signals = [];
  const { closes, opens, times } = ind;
  if (!times || !isIntradayTime(times[0]) || !opens) return signals;

  const segments = sessionSegments(times);
  for (let s = 1; s < segments.length; s++) {
    const seg = segments[s];
    const prev = segments[s - 1];
    const priorClose = closes[prev.endIdx];
    const sessionOpen = opens[seg.startIdx];
    const gap = (sessionOpen - priorClose) / priorClose;
    if (Math.abs(gap) < 0.015) continue;

    const last = Math.min(seg.startIdx + 6, seg.endIdx);
    for (let i = seg.startIdx + 1; i <= last; i++) {
      if (gap > 0 && closes[i] < priorClose && closes[i - 1] >= priorClose) {
        signals.push({
          index: i,
          action: 'sell',
          reason: `Gap-fill fade: gap up ${(gap * 100).toFixed(1)}% failed`,
        });
        break;
      }
      if (gap < 0 && closes[i] > priorClose && closes[i - 1] <= priorClose) {
        signals.push({
          index: i,
          action: 'buy',
          reason: `Gap-fill fade: gap down ${(gap * 100).toFixed(1)}% reversed`,
        });
        break;
      }
    }
  }
  return signals;
}

/**
 * Momentum Burst — 3 consecutive green bars above VWAP with 1.5x volume.
 */
function momentumBurst(ind) {
  const signals = [];
  const { closes, opens, vwap, volumes, times } = ind;
  if (!times || !isIntradayTime(times[0]) || !opens) return signals;

  for (let i = 22; i < closes.length; i++) {
    // Require all three bars to be in the same session.
    if (getDate(times[i]) !== getDate(times[i - 2])) continue;

    let avgVol = 0;
    for (let j = i - 20; j < i; j++) avgVol += volumes[j] || 0;
    avgVol /= 20;
    if (avgVol <= 0) continue;

    const green = (k) => closes[k] > opens[k];
    const aboveVwap = (k) => vwap[k] != null && closes[k] > vwap[k];
    const hotVol = (k) => (volumes[k] || 0) > avgVol * 1.5;

    if (
      green(i) && green(i - 1) && green(i - 2) &&
      aboveVwap(i) && aboveVwap(i - 1) && aboveVwap(i - 2) &&
      hotVol(i) && hotVol(i - 1)
    ) {
      signals.push({
        index: i,
        action: 'buy',
        reason: `Momentum burst: 3 green bars above VWAP, ${((volumes[i] || 0) / avgVol).toFixed(1)}x vol`,
      });
    }
  }
  return signals;
}

/**
 * 5-min RSI Divergence — within a session, price extremes diverge from RSI.
 */
function rsiDivergence(ind) {
  const signals = [];
  const { closes, lows, highs, rsi, times } = ind;
  if (!times || !isIntradayTime(times[0])) return signals;

  const LOOK = 10;
  for (let i = LOOK + 2; i < closes.length; i++) {
    if (rsi[i] == null || rsi[i - LOOK] == null) continue;
    // Divergence must be within the same session.
    if (getDate(times[i]) !== getDate(times[i - LOOK])) continue;

    if (lows[i] < lows[i - LOOK] && rsi[i] > rsi[i - LOOK] && rsi[i] < 40) {
      signals.push({
        index: i,
        action: 'buy',
        reason: `Bullish RSI divergence: RSI ${rsi[i - LOOK].toFixed(0)}→${rsi[i].toFixed(0)}`,
      });
    }
    if (highs[i] > highs[i - LOOK] && rsi[i] < rsi[i - LOOK] && rsi[i] > 60) {
      signals.push({
        index: i,
        action: 'sell',
        reason: `Bearish RSI divergence: RSI ${rsi[i - LOOK].toFixed(0)}→${rsi[i].toFixed(0)}`,
      });
    }
  }
  return signals;
}

export const INTRADAY_STRATEGIES = {
  opening_range_breakout: {
    name: 'Opening Range Breakout',
    description: 'Break above/below the first 30 min of session range (intraday only)',
    fn: openingRangeBreakout,
  },
  vwap_reclaim: {
    name: 'VWAP Reclaim/Reject',
    description: 'Buy when price reclaims VWAP from below, sell on VWAP loss (intraday)',
    fn: vwapReclaim,
  },
  gap_and_go: {
    name: 'Gap-and-Go',
    description: 'Buy on session gap-up that holds VWAP with volume (intraday)',
    fn: gapAndGo,
  },
  gap_fill_fade: {
    name: 'Gap-Fill Fade',
    description: 'Fade session open gaps that fail to hold (intraday)',
    fn: gapFillFade,
  },
  momentum_burst: {
    name: 'Momentum Burst',
    description: '3 consecutive green bars above VWAP with 1.5x volume (intraday)',
    fn: momentumBurst,
  },
  rsi_divergence_5m: {
    name: 'RSI Divergence (intraday)',
    description: 'Price/RSI divergence within a single session',
    fn: rsiDivergence,
  },
};
