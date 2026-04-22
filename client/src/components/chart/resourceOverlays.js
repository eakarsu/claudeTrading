import { LineStyle } from 'lightweight-charts';

/**
 * Per-resource chart configuration.
 *
 * Each entry unifies three things that used to live in three parallel `if`
 * chains in TradingChart.jsx:
 *   - label:    what to call this resource in the header badge
 *   - legend:   color/label pairs to render in the chart header
 *   - overlays: function(candles, params) → { markers, priceLines }
 *   - subtitle: function(params) → string shown under the header
 *
 * To support a new resource, add one entry here — no TradingChart changes.
 */

const COLORS = {
  entry: '#3b82f6',
  target: '#10b981',
  stop: '#ef4444',
  floor: '#f59e0b',
  strike: '#8b5cf6',
  exit: '#8b5cf6',
  profit: '#10b981',
  loss: '#ef4444',
  current: '#f59e0b',
};

const num = (v) => (v == null || v === '' ? null : Number(v));
const fmt = (v) => `$${num(v).toFixed(2)}`;
const marker = (time, { above = false, color, shape, text }) => ({
  time,
  position: above ? 'aboveBar' : 'belowBar',
  color,
  shape,
  text,
});
const line = (price, color, title, lineStyle = LineStyle.Solid) => ({ price, color, title, lineStyle });

function joinParts(...parts) {
  return parts.filter(Boolean).join(' · ');
}

function entryIdx(candles) {
  return Math.floor(candles.length * 0.4);
}

// Normalize a candle-time or user-supplied timestamp to UNIX seconds.
// Intraday candles use numeric seconds; daily candles use 'YYYY-MM-DD'.
// User params may be ISO strings, Date objects, unix ms, or unix seconds.
function toUnixSeconds(t) {
  if (t == null || t === '') return null;
  if (typeof t === 'number') return t > 1e12 ? Math.floor(t / 1000) : t;
  if (t instanceof Date) return Math.floor(t.getTime() / 1000);
  if (typeof t === 'string') {
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}

// Map a real-world timestamp to the nearest candle index. Falls back to
// `fallbackIdx` (typically the legacy 40%-of-series position) when the input
// can't be parsed or candles[] has no usable times — keeps overlays working
// for resources that don't carry a timestamp.
function timeToIdx(candles, timeInput, fallbackIdx) {
  const target = toUnixSeconds(timeInput);
  if (target == null || !candles.length) return fallbackIdx;
  let bestIdx = fallbackIdx;
  let bestDist = Infinity;
  for (let i = 0; i < candles.length; i++) {
    const t = toUnixSeconds(candles[i].time);
    if (t == null) continue;
    const d = Math.abs(t - target);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

// ── Per-resource configs ───────────────────────────────────────────────────

export const resourceConfigs = {
  'trailing-stops': {
    label: 'Trailing Stop',
    legend: [
      { color: COLORS.entry,  label: 'Entry' },
      { color: COLORS.floor,  label: 'Trailing Floor' },
      { color: COLORS.stop,   label: 'Stop Loss' },
    ],
    overlays(candles, { entryPrice, stopPrice, floorPrice, entryAt }) {
      const markers = [];
      const priceLines = [];
      const idx = timeToIdx(candles, entryAt, entryIdx(candles));
      if (entryPrice != null) {
        markers.push(marker(candles[idx].time, { color: COLORS.target, shape: 'arrowUp', text: `BOUGHT @ ${fmt(entryPrice)}` }));
        priceLines.push(line(num(entryPrice), COLORS.entry, 'Entry'));
      }
      if (floorPrice != null) {
        markers.push(marker(candles[Math.max(candles.length - 8, 0)].time, { color: COLORS.floor, shape: 'square', text: `FLOOR ${fmt(floorPrice)}` }));
        priceLines.push(line(num(floorPrice), COLORS.floor, 'Trailing Floor', LineStyle.Dotted));
      }
      if (stopPrice != null && stopPrice !== floorPrice) {
        priceLines.push(line(num(stopPrice), COLORS.stop, 'Stop Loss', LineStyle.Dashed));
      }
      return { markers, priceLines };
    },
    subtitle({ entryPrice, floorPrice, stopPrice }) {
      return joinParts(
        entryPrice != null && `Entry ${fmt(entryPrice)}`,
        floorPrice != null && `Floor ${fmt(floorPrice)}`,
        stopPrice != null && `Stop ${stopPrice}%`,
      );
    },
  },

  'copy-trades': {
    label: 'Copy Trade',
    legend: [{ color: COLORS.strike, label: 'Politician Trade' }],
    overlays(candles, { entryPrice, action, entryAt, tradeDate }) {
      const markers = [];
      const priceLines = [];
      const isBuy = !action || action === 'buy' || action === 'purchase';
      if (entryPrice != null) {
        const idx = timeToIdx(candles, entryAt || tradeDate, entryIdx(candles));
        markers.push(marker(candles[idx].time, {
          above: !isBuy,
          color: isBuy ? COLORS.target : COLORS.stop,
          shape: isBuy ? 'arrowUp' : 'arrowDown',
          text: `${isBuy ? 'COPIED BUY' : 'COPIED SELL'} @ ${fmt(entryPrice)}`,
        }));
        priceLines.push(line(num(entryPrice), COLORS.strike, `Politician ${isBuy ? 'Buy' : 'Sell'}`));
      }
      return { markers, priceLines };
    },
    subtitle({ action, entryPrice }) {
      const side = action === 'buy' || action === 'purchase' ? 'BUY' : 'SELL';
      return joinParts(side, entryPrice != null && `@ ${fmt(entryPrice)}`);
    },
  },

  'wheel-strategies': {
    label: 'Wheel Strategy',
    legend: [
      { color: COLORS.strike, label: 'Strike' },
      { color: COLORS.entry,  label: 'Cost Basis' },
    ],
    overlays(candles, { strikePrice, entryPrice }) {
      const markers = [];
      const priceLines = [];
      if (strikePrice != null) {
        markers.push(marker(candles[Math.floor(candles.length * 0.5)].time, {
          above: true, color: COLORS.strike, shape: 'square', text: `STRIKE ${fmt(strikePrice)}`,
        }));
        priceLines.push(line(num(strikePrice), COLORS.strike, 'Strike Price'));
      }
      if (entryPrice != null && entryPrice !== strikePrice) {
        priceLines.push(line(num(entryPrice), COLORS.entry, 'Cost Basis', LineStyle.Dashed));
      }
      return { markers, priceLines };
    },
    subtitle({ strikePrice, entryPrice }) {
      return joinParts(
        strikePrice != null && `Strike ${fmt(strikePrice)}`,
        entryPrice != null && `Cost Basis ${fmt(entryPrice)}`,
      );
    },
  },

  'trade-signals': {
    label: 'Trade Signal',
    legend: [
      { color: COLORS.entry,  label: 'Entry' },
      { color: COLORS.target, label: 'Target' },
      { color: COLORS.stop,   label: 'Stop Loss' },
    ],
    overlays(candles, { entryPrice, targetPrice, stopPrice, entryAt }) {
      const markers = [];
      const priceLines = [];
      const idx = timeToIdx(candles, entryAt, entryIdx(candles));
      if (entryPrice != null) {
        markers.push(marker(candles[idx].time, { color: COLORS.entry, shape: 'arrowUp', text: `ENTRY ${fmt(entryPrice)}` }));
        priceLines.push(line(num(entryPrice), COLORS.entry, 'Entry'));
      }
      if (targetPrice != null) {
        markers.push(marker(candles[Math.min(idx + 20, candles.length - 1)].time, {
          above: true, color: COLORS.target, shape: 'circle', text: `TARGET ${fmt(targetPrice)}`,
        }));
        priceLines.push(line(num(targetPrice), COLORS.target, 'Target', LineStyle.Dashed));
      }
      if (stopPrice != null) {
        markers.push(marker(candles[Math.min(idx + 3, candles.length - 1)].time, {
          color: COLORS.stop, shape: 'circle', text: `STOP ${fmt(stopPrice)}`,
        }));
        priceLines.push(line(num(stopPrice), COLORS.stop, 'Stop Loss', LineStyle.Dashed));
      }
      return { markers, priceLines };
    },
    subtitle({ action, entryPrice, targetPrice, stopPrice }) {
      const type = action === 'buy' ? 'BULLISH' : action === 'sell' ? 'BEARISH' : '';
      return joinParts(
        type,
        entryPrice != null && `Entry ${fmt(entryPrice)}`,
        targetPrice != null && `Target ${fmt(targetPrice)}`,
        stopPrice != null && `Stop ${fmt(stopPrice)}`,
      );
    },
  },

  'trade-journal': {
    label: 'Trade Journal',
    legend: [
      { color: COLORS.entry,  label: 'Entry' },
      { color: COLORS.profit, label: 'Exit (profit)' },
      { color: COLORS.loss,   label: 'Exit (loss)' },
    ],
    overlays(candles, { entryPrice, exitPrice, action, entryAt, exitAt, tradeDate }) {
      const markers = [];
      const priceLines = [];
      const idx = timeToIdx(candles, entryAt || tradeDate, entryIdx(candles));
      const isBuy = !action || action === 'buy';
      if (entryPrice != null) {
        markers.push(marker(candles[idx].time, { color: COLORS.entry, shape: 'arrowUp', text: `${isBuy ? 'BOUGHT' : 'SHORTED'} ${fmt(entryPrice)}` }));
        priceLines.push(line(num(entryPrice), COLORS.entry, 'Entry'));
      }
      if (exitPrice != null) {
        const fallbackExit = Math.min(idx + Math.floor(candles.length * 0.25), candles.length - 3);
        const exitIdx = timeToIdx(candles, exitAt, fallbackExit);
        const profit = num(exitPrice) > num(entryPrice ?? 0);
        markers.push(marker(candles[exitIdx].time, {
          above: true,
          color: profit ? COLORS.profit : COLORS.loss,
          shape: 'arrowDown',
          text: `SOLD ${fmt(exitPrice)} (${profit ? 'profit' : 'loss'})`,
        }));
        priceLines.push(line(num(exitPrice), profit ? COLORS.profit : COLORS.loss, 'Exit', LineStyle.Dashed));
      }
      return { markers, priceLines };
    },
    subtitle({ action, entryPrice, exitPrice }) {
      return joinParts(
        action === 'buy' ? 'LONG' : 'SHORT',
        entryPrice != null && `Entry ${fmt(entryPrice)}`,
        exitPrice != null && `Exit ${fmt(exitPrice)}`,
      );
    },
  },

  'portfolio': {
    label: 'Portfolio',
    legend: [
      { color: COLORS.entry,  label: 'Avg Cost' },
      { color: COLORS.target, label: 'Current Price' },
    ],
    overlays(candles, { entryPrice, currentPrice, entryAt }) {
      const markers = [];
      const priceLines = [];
      if (entryPrice != null) {
        const idx = timeToIdx(candles, entryAt, entryIdx(candles));
        markers.push(marker(candles[idx].time, { color: COLORS.entry, shape: 'arrowUp', text: `AVG COST ${fmt(entryPrice)}` }));
        priceLines.push(line(num(entryPrice), COLORS.entry, 'Avg Cost'));
      }
      if (currentPrice != null) {
        const up = num(currentPrice) >= num(entryPrice ?? 0);
        priceLines.push(line(num(currentPrice), up ? COLORS.profit : COLORS.loss, 'Current Price', LineStyle.Dotted));
      }
      return { markers, priceLines };
    },
    subtitle({ entryPrice, currentPrice }) {
      return joinParts(
        entryPrice != null && `Avg Cost ${fmt(entryPrice)}`,
        currentPrice != null && `Current ${fmt(currentPrice)}`,
      );
    },
  },

  'options-chain': {
    label: 'Options Chain',
    legend: [
      { color: COLORS.strike,  label: 'Strike' },
      { color: COLORS.current, label: 'Current Price' },
    ],
    overlays(candles, { strikePrice, currentPrice }) {
      const markers = [];
      const priceLines = [];
      if (strikePrice != null) {
        markers.push(marker(candles[Math.floor(candles.length * 0.6)].time, {
          above: true, color: COLORS.strike, shape: 'square', text: `STRIKE ${fmt(strikePrice)}`,
        }));
        priceLines.push(line(num(strikePrice), COLORS.strike, 'Strike'));
      }
      if (currentPrice != null) {
        priceLines.push(line(num(currentPrice), COLORS.current, 'Current Price', LineStyle.Dotted));
      }
      return { markers, priceLines };
    },
    subtitle({ strikePrice, currentPrice }) {
      return joinParts(
        strikePrice != null && `Strike ${fmt(strikePrice)}`,
        currentPrice != null && `Current ${fmt(currentPrice)}`,
      );
    },
  },
};

// Fallback used when `resource` doesn't match any key above.
export const defaultConfig = {
  label: '',
  legend: [
    { color: COLORS.entry,  label: 'Entry' },
    { color: COLORS.target, label: 'Target' },
    { color: COLORS.stop,   label: 'Stop' },
  ],
  overlays(candles, p) {
    const markers = [];
    const priceLines = [];
    const idx = timeToIdx(candles, p.entryAt || p.tradeDate, entryIdx(candles));
    if (p.entryPrice != null) {
      markers.push(marker(candles[idx].time, { color: COLORS.target, shape: 'arrowUp', text: `BUY ${fmt(p.entryPrice)}` }));
      priceLines.push(line(num(p.entryPrice), COLORS.entry, 'Entry'));
    }
    if (p.exitPrice != null)   priceLines.push(line(num(p.exitPrice),   COLORS.exit,   'Exit',   LineStyle.Dashed));
    if (p.stopPrice != null)   priceLines.push(line(num(p.stopPrice),   COLORS.stop,   'Stop',   LineStyle.Dashed));
    if (p.targetPrice != null) priceLines.push(line(num(p.targetPrice), COLORS.target, 'Target', LineStyle.Dashed));
    if (p.floorPrice != null)  priceLines.push(line(num(p.floorPrice),  COLORS.floor,  'Floor',  LineStyle.Dotted));
    if (p.strikePrice != null) priceLines.push(line(num(p.strikePrice), COLORS.strike, 'Strike', LineStyle.Dotted));
    return { markers, priceLines };
  },
  subtitle: () => '',
};

export function getResourceConfig(resource) {
  return resourceConfigs[resource] || defaultConfig;
}
