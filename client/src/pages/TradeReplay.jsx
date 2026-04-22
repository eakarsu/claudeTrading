import React, { useEffect, useMemo, useState } from 'react';
import {
  listAutoTraderTrades, getAutoTraderTrade, getChartBars,
  updateAutoTraderTradeTags, journalAutoTraderTrade,
} from '../api';

const TIMEFRAMES = [
  { value: '1Min',  label: '1 Min'  },
  { value: '5Min',  label: '5 Min'  },
  { value: '15Min', label: '15 Min' },
  { value: '1H',    label: '1 Hour' },
  { value: '4H',    label: '4 Hour' },
  { value: '1Day',  label: 'Daily'  },
];

/**
 * Trade Replay
 *
 * Two-pane layout: filterable list of past auto-trader trades on the left,
 * detail + price chart on the right. Selecting a trade fetches the full row
 * (including entryContext — the indicator snapshot captured at entry) and a
 * ~60-day OHLC window so we can draw a price line with the trade marker
 * positioned on its createdAt date.
 *
 * We render the chart as an inline SVG rather than pulling in a charting lib
 * — the shape is simple and doing it by hand keeps the JS bundle small for
 * a page most users will only open occasionally.
 */
export default function TradeReplay() {
  const [items, setItems]       = useState([]);
  const [filters, setFilters]   = useState({ symbol: '', strategy: '', tag: '' });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail]     = useState(null);
  const [chart, setChart]       = useState(null);
  const [timeframe, setTimeframe] = useState('1Day');
  const [err, setErr]           = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { items } = await listAutoTraderTrades({
          symbol:   filters.symbol   || undefined,
          strategy: filters.strategy || undefined,
          tag:      filters.tag      || undefined,
          limit: 200,
        });
        if (!cancelled) setItems(items);
      } catch (e) { if (!cancelled) setErr(e.message); }
    })();
    return () => { cancelled = true; };
  }, [filters.symbol, filters.strategy, filters.tag]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setChart(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const d = await getAutoTraderTrade(selectedId);
        if (cancelled) return;
        setDetail(d);
        // Fetch 60d of prices bracketing the trade date. The backend generates
        // synthetic OHLC keyed on `seed=<createdAt ms>` so replaying the same
        // trade always shows the same chart — a pure-function replay.
        const seed = String(new Date(d.createdAt).getTime());
        const c = await getChartBars(d.symbol, { timeframe, seed });
        if (!cancelled) setChart(c);
      } catch (e) { if (!cancelled) setErr(e.message); }
    })();
    return () => { cancelled = true; };
  }, [selectedId, timeframe]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, padding: 16 }}>
      <TradeList
        items={items}
        filters={filters}
        onFilters={setFilters}
        selectedId={selectedId}
        onSelect={setSelectedId}
        error={err}
      />
      <TradeDetail
        detail={detail}
        chart={chart}
        timeframe={timeframe}
        onTimeframe={setTimeframe}
        onReload={() => setSelectedId(selectedId)}
      />
    </div>
  );
}

// ─── List pane ────────────────────────────────────────────────────────────
function TradeList({ items, filters, onFilters, selectedId, onSelect, error }) {
  return (
    <div style={{ borderRight: '1px solid #222', paddingRight: 12 }}>
      <h3 style={{ marginTop: 0 }}>Trades</h3>
      <div style={{ display: 'grid', gap: 6 }}>
        <input placeholder="Symbol"   value={filters.symbol}
               onChange={(e) => onFilters({ ...filters, symbol: e.target.value.toUpperCase() })} style={inp} />
        <input placeholder="Strategy" value={filters.strategy}
               onChange={(e) => onFilters({ ...filters, strategy: e.target.value })} style={inp} />
        <input placeholder="Tag"      value={filters.tag}
               onChange={(e) => onFilters({ ...filters, tag: e.target.value })} style={inp} />
      </div>
      {error && <div style={{ color: '#f88', marginTop: 8 }}>{error}</div>}
      <div style={{ marginTop: 12, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
        {items.length === 0 && <div style={{ color: '#888' }}>No trades found.</div>}
        {items.map((t) => {
          const active = t.id === selectedId;
          const pnlColor = t.pnl == null ? '#888' : t.pnl >= 0 ? '#6d6' : '#e66';
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: 8,
                margin: '4px 0', borderRadius: 4,
                background: active ? '#1c2a3a' : '#111',
                border: active ? '1px solid #49c' : '1px solid #222',
                color: '#ddd', cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{t.symbol}</strong>
                <span style={{ color: t.action === 'buy' ? '#6d6' : '#e66' }}>{t.action}</span>
              </div>
              <div style={{ color: '#999', fontSize: 12 }}>
                {new Date(t.createdAt).toLocaleString()} · {t.strategy || '—'}
              </div>
              <div style={{ color: pnlColor, fontSize: 13 }}>
                {t.qty} @ ${Number(t.price).toFixed(2)}
                {t.pnl != null && <> · P&L ${Number(t.pnl).toFixed(2)}</>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Detail pane ──────────────────────────────────────────────────────────
function TradeDetail({ detail, chart, timeframe, onTimeframe, onReload }) {
  if (!detail) {
    return <div style={{ color: '#888' }}>Select a trade to replay.</div>;
  }
  const entryCtx = detail.entryContext && typeof detail.entryContext === 'object'
    ? detail.entryContext
    : {};

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>
        {detail.symbol} · <span style={{ color: detail.action === 'buy' ? '#6d6' : '#e66' }}>{detail.action}</span>
      </h3>
      <div style={{ color: '#aaa', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span>{new Date(detail.createdAt).toLocaleString()} · {detail.strategy || 'manual'}</span>
        <select
          value={timeframe}
          onChange={(e) => onTimeframe(e.target.value)}
          style={{ ...inp, padding: '4px 6px' }}
        >
          {TIMEFRAMES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <PriceChart chart={chart} markerPrice={Number(detail.price)} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <Card title="Trade">
          <Row k="Quantity"  v={detail.qty} />
          <Row k="Fill price" v={`$${Number(detail.price).toFixed(2)}`} />
          <Row k="P&L"       v={detail.pnl == null ? '—' : `$${Number(detail.pnl).toFixed(2)}`} />
          <Row k="Order ID"  v={detail.orderId || '—'} />
          <Row k="Reason"    v={detail.reason || '—'} />
        </Card>
        <Card title="Entry context">
          {Object.keys(entryCtx).length === 0 && <div style={{ color: '#888' }}>No snapshot recorded.</div>}
          {Object.entries(entryCtx).map(([k, v]) => (
            <Row key={k} k={k} v={formatCtx(v)} />
          ))}
        </Card>
      </div>

      <TagsEditor trade={detail} onSaved={onReload} />
      <JournalButton tradeId={detail.id} />
    </div>
  );
}

function formatCtx(v) {
  if (v == null)                  return '—';
  if (typeof v === 'number')      return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (typeof v === 'object')      return JSON.stringify(v);
  return String(v);
}

// ─── Simple inline SVG chart ─────────────────────────────────────────────
function PriceChart({ chart, markerPrice }) {
  // Server returns `candles` under /chart and /chart/:symbol/bars; keep `data`
  // as a belt-and-braces fallback for any legacy response shape.
  const data = chart?.candles || chart?.data || [];
  const dims = { w: 720, h: 260, pad: 32 };

  const { path, markerY, yMin, yMax } = useMemo(() => {
    if (!data.length) return { path: '', markerY: null, yMin: 0, yMax: 0 };
    const closes = data.map((d) => d.close);
    const yMin = Math.min(...closes);
    const yMax = Math.max(...closes);
    const yRange = Math.max(yMax - yMin, 1e-6);
    const xStep = (dims.w - dims.pad * 2) / Math.max(data.length - 1, 1);
    const sx = (i) => dims.pad + i * xStep;
    const sy = (y) => dims.h - dims.pad - ((y - yMin) / yRange) * (dims.h - dims.pad * 2);
    const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${sx(i)} ${sy(d.close)}`).join(' ');
    const markerY = markerPrice != null && !Number.isNaN(markerPrice) ? sy(markerPrice) : null;
    return { path, markerY, yMin, yMax };
    // Regenerate only when inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, markerPrice]);

  if (!data.length) return <div style={{ color: '#888' }}>Loading chart…</div>;

  return (
    <svg width={dims.w} height={dims.h} style={{ background: '#0a0a0a', borderRadius: 4 }}>
      <path d={path} stroke="#4af" strokeWidth={1.5} fill="none" />
      {markerY != null && (
        <g>
          <line x1={dims.pad} x2={dims.w - dims.pad} y1={markerY} y2={markerY}
                stroke="#fc4" strokeDasharray="4,4" opacity="0.6" />
          <text x={dims.w - dims.pad} y={markerY - 4} fill="#fc4" fontSize="11" textAnchor="end">
            entry ${markerPrice?.toFixed(2)}
          </text>
        </g>
      )}
      <text x={dims.pad} y={dims.pad - 8} fill="#888" fontSize="11">${yMax.toFixed(2)}</text>
      <text x={dims.pad} y={dims.h - 8}  fill="#888" fontSize="11">${yMin.toFixed(2)}</text>
    </svg>
  );
}

// ─── Cards + sub-components ──────────────────────────────────────────────
function Card({ title, children }) {
  return (
    <div style={{ background: '#151515', padding: 12, borderRadius: 6, border: '1px solid #333' }}>
      <div style={{ color: '#aaa', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ k, v }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 13 }}>
      <div style={{ width: 110, color: '#888' }}>{k}</div>
      <div style={{ color: '#ddd', wordBreak: 'break-all' }}>{v}</div>
    </div>
  );
}

function TagsEditor({ trade, onSaved }) {
  const [value, setValue] = useState((trade.tags || []).join(', '));
  const [saving, setSaving] = useState(false);
  async function save() {
    const tags = value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
    setSaving(true);
    try { await updateAutoTraderTradeTags(trade.id, tags); onSaved?.(); }
    finally { setSaving(false); }
  }
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ color: '#aaa', marginBottom: 4 }}>Tags (comma-separated, ≤10, ≤32 chars each)</div>
      <input value={value} onChange={(e) => setValue(e.target.value)} style={{ ...inp, width: 400 }} />
      <button onClick={save} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Save tags'}</button>
    </div>
  );
}
function JournalButton({ tradeId }) {
  const [state, setState] = useState('idle');
  async function go() {
    setState('busy');
    try { await journalAutoTraderTrade(tradeId); setState('done'); }
    catch { setState('error'); }
  }
  return (
    <button onClick={go} disabled={state === 'busy'} style={{ ...btn, marginTop: 8 }}>
      {state === 'done' ? 'Copied to Trade Journal ✓' : state === 'error' ? 'Failed — retry' : 'Copy to Trade Journal'}
    </button>
  );
}

// ─── Inline styles ───────────────────────────────────────────────────────
const inp = {
  padding: 6, background: '#0c0c0c', color: '#eee',
  border: '1px solid #333', borderRadius: 4,
};
const btn = {
  marginLeft: 8, padding: '6px 12px', background: '#264',
  color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
};
