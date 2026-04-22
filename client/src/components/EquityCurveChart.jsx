import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';

/**
 * Renders a backtest equity curve as a line series. Expects:
 *   data: [{ time: 'YYYY-MM-DD' | unix-seconds | ISO, equity: number }, ...]
 */
export default function EquityCurveChart({ data = [], height = 240, title }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

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

    const series = chart.addSeries(LineSeries, {
      color: '#34d399',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
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
    if (!seriesRef.current || !data?.length) return;
    // Normalize `time` to what lightweight-charts accepts: daily strings pass
    // through; intraday ISO → unix seconds.
    const rows = data
      .map((p) => {
        let t = p.time;
        if (typeof t === 'string' && t.length > 10) {
          t = Math.floor(new Date(t).getTime() / 1000);
        }
        return { time: t, value: Number(p.equity) };
      })
      .filter((r) => Number.isFinite(r.value));
    seriesRef.current.setData(rows);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return (
    <div className="w-full">
      {title && <div className="text-xs text-slate-400 mb-1">{title}</div>}
      <div ref={containerRef} style={{ width: '100%', height }} />
    </div>
  );
}
