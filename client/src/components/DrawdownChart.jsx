import React, { useEffect, useMemo, useRef } from 'react';
import { createChart, ColorType, AreaSeries } from 'lightweight-charts';

/**
 * Renders the underwater drawdown curve derived from an equity curve. At any
 * point the drawdown is (equity - peakSoFar) / peakSoFar, plotted as a
 * negative-valued area in red. Peaks sit on the zero line; long, deep valleys
 * jump out visually as the feature the trader should actually worry about.
 */
export default function DrawdownChart({ data = [], height = 180, title }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  // Build drawdown series once per equity curve.
  const ddRows = useMemo(() => {
    let peak = -Infinity;
    const rows = [];
    for (const p of data) {
      const e = Number(p.equity);
      if (!Number.isFinite(e)) continue;
      if (e > peak) peak = e;
      const dd = peak > 0 ? (e - peak) / peak : 0;
      let t = p.time;
      if (typeof t === 'string' && t.length > 10) {
        t = Math.floor(new Date(t).getTime() / 1000);
      }
      rows.push({ time: t, value: dd * 100 }); // percentage, always ≤ 0
    }
    return rows;
  }, [data]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#cbd5e1',
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.1)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.1)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false },
      height,
      autoSize: true,
    });
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor:      '#f87171',
      topColor:       'rgba(248, 113, 113, 0.4)',
      bottomColor:    'rgba(248, 113, 113, 0.05)',
      lineWidth:      2,
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat:    { type: 'custom', formatter: (v) => `${v.toFixed(2)}%` },
    });
    seriesRef.current = series;

    const ro = new ResizeObserver(() => chart.applyOptions({ height }));
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || !ddRows.length) return;
    seriesRef.current.setData(ddRows);
    chartRef.current?.timeScale().fitContent();
  }, [ddRows]);

  return (
    <div className="w-full">
      {title && <div className="text-xs text-slate-400 mb-1">{title}</div>}
      <div ref={containerRef} style={{ width: '100%', height }} />
    </div>
  );
}
