import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  CandlestickSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import { FiBarChart2 } from 'react-icons/fi';
import * as api from '../api';
import { getResourceConfig } from './chart/resourceOverlays';

// ── Caches ─────────────────────────────────────────────────────────────────
// Intraday entries expire after 5 minutes so new candles appear over time.
// Daily candles are deterministic per seed → cached indefinitely.
const INTRADAY_TTL_MS = 5 * 60 * 1000;
const MARKET_OPEN_TTL_MS = 60 * 1000;

const candleCache = new Map();        // key → { candles, interval, at }
let marketOpen = { value: null, at: 0 };

async function checkMarketOpen() {
  if (marketOpen.value !== null && Date.now() - marketOpen.at < MARKET_OPEN_TTL_MS) {
    return marketOpen.value;
  }
  try {
    const data = await api.alpacaClock();
    marketOpen = { value: data.is_open === true, at: Date.now() };
    return marketOpen.value;
  } catch {
    return false;
  }
}

// Legacy labels kept for backwards compat with callers that still pass
// 'intraday' / 'daily'. Map them to canonical Alpaca-style tokens.
const INTERVAL_ALIAS = {
  intraday: '5Min',
  daily:    '1Day',
};
const INTERVAL_LABELS = {
  '1Min': '1 Min',
  '5Min': '5 Min',
  '15Min': '15 Min',
  '1H': '1 Hour',
  '4H': '4 Hour',
  '1Day': 'Daily',
};
const INTRADAY_TIMEFRAMES = new Set(['1Min', '5Min', '15Min']);

function canonicalInterval(v) {
  return INTERVAL_ALIAS[v] || v || '1Day';
}

async function fetchCandles(symbol, seedKey, requestedInterval) {
  const tf = canonicalInterval(requestedInterval);
  const key = `${seedKey || symbol}-${tf}`;
  const cached = candleCache.get(key);
  if (cached) {
    const fresh = !INTRADAY_TIMEFRAMES.has(tf) || Date.now() - cached.at < INTRADAY_TTL_MS;
    if (fresh) return cached;
    candleCache.delete(key);
  }

  try {
    const data = await api.getChartBars(symbol, { timeframe: tf, seed: seedKey || symbol });
    if (data.candles?.length) {
      const entry = { candles: data.candles, interval: tf, at: Date.now() };
      candleCache.set(key, entry);
      return entry;
    }
  } catch {
    // fall through to daily fallback
  }

  const data = await api.getChart(symbol, { days: 90, seed: seedKey || symbol });
  if (!data.candles?.length) throw new Error('No candle data returned');
  const entry = { candles: data.candles, interval: '1Day', at: Date.now() };
  candleCache.set(key, entry);
  return entry;
}

// ── Chart theme (pulled out so the component body stays focused on logic) ──
const CHART_THEME = {
  layout: {
    background: { type: ColorType.Solid, color: '#1a1d27' },
    textColor: '#9ca3af',
    fontSize: 12,
  },
  grid: {
    vertLines: { color: '#2a2d3a' },
    horzLines: { color: '#2a2d3a' },
  },
  rightPriceScale: {
    borderColor: '#2a2d3a',
    scaleMargins: { top: 0.1, bottom: 0.1 },
  },
};

const CROSSHAIR = {
  mode: 0,
  vertLine: { color: '#6366f1', width: 1, style: LineStyle.Dashed },
  horzLine: { color: '#6366f1', width: 1, style: LineStyle.Dashed },
};

const CANDLE_COLORS = {
  upColor: '#10b981',
  downColor: '#ef4444',
  borderUpColor: '#10b981',
  borderDownColor: '#ef4444',
  wickUpColor: '#10b981',
  wickDownColor: '#ef4444',
};

// ── Component ──────────────────────────────────────────────────────────────

function TradingChartInner({ symbol, params = {}, height = 350, chartKey = '', resource = '', forceInterval = '' }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const resizeHandlerRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [interval, setInterval] = useState('1Day');
  const [isMarketOpen, setIsMarketOpen] = useState(false);
  const [selectedInterval, setSelectedInterval] = useState(canonicalInterval(forceInterval));
  const [refreshTick, setRefreshTick] = useState(0);

  const config = getResourceConfig(resource);

  // Decide interval on mount: respect forceInterval, otherwise check market.
  useEffect(() => {
    if (forceInterval) {
      const tf = canonicalInterval(forceInterval);
      setSelectedInterval(tf);
      setIsMarketOpen(INTRADAY_TIMEFRAMES.has(tf));
      return;
    }
    checkMarketOpen().then((open) => {
      setIsMarketOpen(open);
      if (open) setSelectedInterval('5Min');
    });
  }, [forceInterval]);

  // Main chart lifecycle.
  useEffect(() => {
    if (!symbol || !containerRef.current) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { candles, interval: resolvedInterval } = await fetchCandles(
          symbol,
          chartKey || symbol,
          selectedInterval,
        );
        if (cancelled) return;

        setInterval(resolvedInterval);
        const isIntraday = INTRADAY_TIMEFRAMES.has(resolvedInterval);
        const { markers, priceLines } = config.overlays(candles, params);

        // Tear down any previous instance.
        destroyChart(chartRef, resizeHandlerRef);

        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height,
          ...CHART_THEME,
          crosshair: CROSSHAIR,
          timeScale: { borderColor: '#2a2d3a', timeVisible: isIntraday, secondsVisible: false },
        });
        chartRef.current = chart;

        const series = chart.addSeries(CandlestickSeries, CANDLE_COLORS);
        series.setData(candles);

        if (markers.length) {
          const sorted = [...markers].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
          createSeriesMarkers(series, sorted);
        }

        for (const pl of priceLines) {
          series.createPriceLine({
            price: pl.price,
            color: pl.color,
            lineWidth: 2,
            lineStyle: pl.lineStyle,
            axisLabelVisible: true,
            title: pl.title,
          });
        }

        chart.timeScale().fitContent();

        const onResize = () => {
          if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
        };
        window.addEventListener('resize', onResize);
        resizeHandlerRef.current = onResize;
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      destroyChart(chartRef, resizeHandlerRef);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, JSON.stringify(params), height, chartKey, resource, selectedInterval, forceInterval, refreshTick]);

  // Auto-refresh intraday every 5 minutes so new candles appear.
  useEffect(() => {
    if (!INTRADAY_TIMEFRAMES.has(selectedInterval)) return;
    const timer = window.setInterval(() => {
      candleCache.delete(`${chartKey || symbol}-${selectedInterval}`);
      setRefreshTick((t) => t + 1);
    }, INTRADAY_TTL_MS);
    return () => window.clearInterval(timer);
  }, [selectedInterval, symbol, chartKey]);

  const subtitle = config.subtitle(params);

  return (
    <div className="trading-chart">
      <div className="chart-header">
        <FiBarChart2 size={16} />
        <span>{symbol} Price Chart</span>
        {config.label && <span className="chart-resource-badge">{config.label}</span>}
        {forceInterval ? (
          <span className="chart-interval-badge">{INTERVAL_LABELS[interval] || interval}</span>
        ) : (
          <select
            className="chart-interval-select"
            value={selectedInterval}
            onChange={(e) => setSelectedInterval(e.target.value)}
          >
            <option value="1Min">1 Min</option>
            <option value="5Min">5 Min</option>
            <option value="15Min">15 Min</option>
            <option value="1H">1 Hour</option>
            <option value="4H">4 Hour</option>
            <option value="1Day">Daily</option>
          </select>
        )}
        <div className="chart-legend">
          {config.legend.map(({ color, label }) => (
            <span key={label} className="legend-item">
              <span className="legend-dot" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>
      {subtitle && <div className="chart-subtitle">{subtitle}</div>}
      {loading && <div className="chart-loading">Loading chart...</div>}
      {error && <div className="chart-error">Chart error: {error}</div>}
      <div ref={containerRef} className="chart-container" />
    </div>
  );
}

function destroyChart(chartRef, resizeHandlerRef) {
  if (resizeHandlerRef.current) {
    window.removeEventListener('resize', resizeHandlerRef.current);
    resizeHandlerRef.current = null;
  }
  if (chartRef.current) {
    chartRef.current.remove();
    chartRef.current = null;
  }
}

// Memo prevents re-render when parent state (e.g. livePrices) changes but our
// props haven't. Stringifying params is cheap vs. destroying/rebuilding the chart.
const TradingChart = React.memo(TradingChartInner, (prev, next) => (
  prev.symbol === next.symbol
  && prev.chartKey === next.chartKey
  && prev.height === next.height
  && prev.resource === next.resource
  && prev.forceInterval === next.forceInterval
  && JSON.stringify(prev.params) === JSON.stringify(next.params)
));

export default TradingChart;
