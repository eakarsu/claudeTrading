import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, AreaSeries, CrosshairMode } from 'lightweight-charts';

/**
 * Compact area chart used on the dashboard index strip. Expects:
 *   bars: [{ time, open, high, low, close, volume }, ...]
 *
 * The chart is intentionally minimal — no price-scale border, thin axis — but
 * interactive: hovering (or touching) any point reveals a tooltip with the
 * date and the close price at that x-position, so users can read the value
 * at any historical date.
 */
export default function IndexMiniChart({ bars = [], height = 90 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  // Hovered point. `null` means no crosshair (mouse left the chart).
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      // Right scale shown but narrow so the value axis is readable without
      // dominating a small tile.
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        scaleMargins: { top: 0.15, bottom: 0.1 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        visible: true,
        borderVisible: false,
        timeVisible: false,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      // Magnet crosshair snaps the vertical line + marker to the nearest
      // data point, which makes reading daily values precise on touch too.
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: '#475569', width: 1, style: 3 /* dashed */, labelVisible: false },
        horzLine: { color: '#475569', width: 1, style: 3, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
      height,
      autoSize: true,
    });
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });
    seriesRef.current = series;

    // Hover tooltip — pull date + close from the series at the crosshair x.
    const onMove = (param) => {
      if (!param?.time || !param?.point || param.point.x < 0 || param.point.y < 0) {
        setHover(null);
        return;
      }
      const priceData = param.seriesData?.get(series);
      const value = priceData?.value ?? priceData?.close;
      if (!Number.isFinite(value)) { setHover(null); return; }
      // `param.time` is either 'YYYY-MM-DD' (daily) or unix seconds (intraday).
      let dateLabel;
      if (typeof param.time === 'string') dateLabel = param.time;
      else if (typeof param.time === 'number') dateLabel = new Date(param.time * 1000).toISOString().slice(0, 10);
      else dateLabel = '';
      setHover({ date: dateLabel, value });
    };
    chart.subscribeCrosshairMove(onMove);

    const ro = new ResizeObserver(() => chart.applyOptions({ height }));
    ro.observe(containerRef.current);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || !bars?.length) return;
    // Auto-detect daily vs. intraday by looking at the average gap. For daily
    // data lightweight-charts expects 'YYYY-MM-DD' strings (business-days
    // timescale). For intraday we keep unix-seconds so the axis stays continuous.
    const timesNumeric = bars
      .map((b) => (typeof b.time === 'number'
        ? b.time
        : Math.floor(new Date(b.time).getTime() / 1000)))
      .filter(Number.isFinite);
    const avgGap = timesNumeric.length > 1
      ? (timesNumeric[timesNumeric.length - 1] - timesNumeric[0]) / (timesNumeric.length - 1)
      : 0;
    const isDaily = avgGap >= 3600 * 12; // 12h+ average gap ⇒ treat as daily

    const seen = new Set();
    const rows = [];
    for (const b of bars) {
      let t = b.time;
      if (typeof t === 'number') {
        t = isDaily ? new Date(t * 1000).toISOString().slice(0, 10) : t;
      } else if (typeof t === 'string' && t.length > 10) {
        t = isDaily ? t.slice(0, 10) : Math.floor(new Date(t).getTime() / 1000);
      }
      if (seen.has(t)) continue;
      seen.add(t);
      const v = Number(b.close);
      if (!Number.isFinite(v)) continue;
      rows.push({ time: t, value: v });
    }
    rows.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

    const first = rows[0]?.value;
    const last = rows[rows.length - 1]?.value;
    const up = Number.isFinite(first) && Number.isFinite(last) && last >= first;
    const stroke = up ? '#10b981' : '#ef4444';
    const fillTop = up ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)';
    const fillBottom = up ? 'rgba(16, 185, 129, 0.0)' : 'rgba(239, 68, 68, 0.0)';

    seriesRef.current.applyOptions({
      lineColor: stroke,
      topColor: fillTop,
      bottomColor: fillBottom,
    });
    seriesRef.current.setData(rows);
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Floating hover tag — shows date + value at the crosshair. Positioned
          top-left so it doesn't overlap the last-bar value on the right. */}
      {hover && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: 6,
            padding: '2px 6px',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid #334155',
            borderRadius: 4,
            color: '#e2e8f0',
            fontSize: 11,
            lineHeight: 1.3,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: '#94a3b8' }}>{hover.date}</span>
          {' · '}
          <strong>
            {hover.value >= 1000
              ? hover.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : hover.value.toFixed(2)}
          </strong>
        </div>
      )}
    </div>
  );
}
