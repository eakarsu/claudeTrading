import React, { useEffect, useState } from 'react';
import {
  listStrategyAbRuns,
  createStrategyAbRun,
  getStrategyAbRun,
  listStrategyAbTrades,
  startStrategyAbRun,
  stopStrategyAbRun,
  critiqueStrategyAbRun,
  deleteStrategyAbRun,
} from '../api';

const STRATEGY_OPTIONS = [
  ['macd_crossover', 'MACD Crossover'],
  ['rsi_oversold', 'RSI Oversold/Overbought'],
  ['golden_cross', 'Golden/Death Cross'],
  ['ema_bounce', 'EMA Bounce'],
  ['bollinger_bounce', 'Bollinger Bounce'],
  ['bollinger_squeeze', 'Bollinger Squeeze'],
  ['stochastic_crossover', 'Stochastic Crossover'],
];

/**
 * Strategy A/B Harness — pages list, create form, detail panel.
 * Pure shadow mode: no real orders. Useful for "should I switch strategies"
 * decisions without exposing capital.
 */
export default function StrategyAb() {
  const [runs, setRuns] = useState([]);
  const [pageInfo, setPageInfo] = useState({ total: 0, limit: 50, offset: 0 });
  const [selected, setSelected] = useState(null);
  const [trades, setTrades] = useState([]);
  const [critique, setCritique] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    strategyA: 'macd_crossover',
    strategyB: 'rsi_oversold',
    symbols: 'SPY,QQQ',
    timeframe: '1Day',
    intervalMs: 60000,
    notional: 1000,
  });
  const [err, setErr] = useState('');

  async function refresh() {
    try {
      const res = await listStrategyAbRuns({ limit: pageInfo.limit, offset: pageInfo.offset });
      setRuns(res.items || []);
      setPageInfo({ total: res.total ?? 0, limit: res.limit, offset: res.offset });
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [pageInfo.offset]);

  async function loadDetail(id) {
    setSelected(null);
    setTrades([]);
    setCritique('');
    try {
      const run = await getStrategyAbRun(id);
      setSelected(run);
      setCritique(run?.aiResults?.critique || '');
      const t = await listStrategyAbTrades(id, { limit: 100, offset: 0 });
      setTrades(t.items || []);
    } catch (e) { setErr(e.message); }
  }

  async function onCreate(e) {
    e.preventDefault();
    setErr('');
    try {
      const symbols = form.symbols.split(',').map((s) => s.trim()).filter(Boolean);
      await createStrategyAbRun({
        name: form.name,
        strategyA: form.strategyA,
        strategyB: form.strategyB,
        symbols,
        config: {
          timeframe: form.timeframe,
          intervalMs: Number(form.intervalMs),
          notional: Number(form.notional),
        },
      });
      setForm({ ...form, name: '' });
      refresh();
    } catch (e) { setErr(e.message); }
  }

  async function act(fn, id) {
    setBusy(true); setErr('');
    try { await fn(id); await refresh(); if (selected?.id === id) await loadDetail(id); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const totalPages = Math.max(1, Math.ceil(pageInfo.total / pageInfo.limit));
  const currentPage = Math.floor(pageInfo.offset / pageInfo.limit) + 1;

  return (
    <div style={{ padding: 20 }}>
      <h2>Strategy A/B Harness</h2>
      <p style={{ color: '#888' }}>
        Run two strategies in shadow mode against the same symbols. No real orders are placed —
        the harness simulates entries/exits at the latest trade price and persists them so
        realized P&L can be compared.
      </p>

      {err && <div style={{ color: '#c33', padding: 10, border: '1px solid #c33', borderRadius: 4, marginBottom: 12 }}>{err}</div>}

      <form onSubmit={onCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: 12, border: '1px solid #333', borderRadius: 6, marginBottom: 16 }}>
        <input placeholder="Run name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <select value={form.strategyA} onChange={(e) => setForm({ ...form, strategyA: e.target.value })}>
          {STRATEGY_OPTIONS.map(([k, n]) => <option key={k} value={k}>A: {n}</option>)}
        </select>
        <select value={form.strategyB} onChange={(e) => setForm({ ...form, strategyB: e.target.value })}>
          {STRATEGY_OPTIONS.map(([k, n]) => <option key={k} value={k}>B: {n}</option>)}
        </select>
        <input placeholder="Symbols (comma)" value={form.symbols} onChange={(e) => setForm({ ...form, symbols: e.target.value })} />
        <select value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value })}>
          {['1Min', '5Min', '15Min', '1H', '1Day'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="number" min={5000} step={1000} value={form.intervalMs} onChange={(e) => setForm({ ...form, intervalMs: e.target.value })} title="poll interval (ms)" />
        <input type="number" min={1} step={100} value={form.notional} onChange={(e) => setForm({ ...form, notional: e.target.value })} title="notional per trade" />
        <button type="submit" disabled={busy}>Create Run</button>
      </form>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <h3>Runs</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th>Name</th><th>A vs B</th><th>Symbols</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ background: selected?.id === r.id ? '#222' : 'transparent', cursor: 'pointer' }} onClick={() => loadDetail(r.id)}>
                  <td>{r.name}</td>
                  <td>{r.strategyA} vs {r.strategyB}</td>
                  <td>{(r.symbols || []).join(', ')}</td>
                  <td>{r.status}</td>
                  <td>
                    {r.status !== 'running' && <button disabled={busy} onClick={(e) => { e.stopPropagation(); act(startStrategyAbRun, r.id); }}>Start</button>}
                    {r.status === 'running' && <button disabled={busy} onClick={(e) => { e.stopPropagation(); act(stopStrategyAbRun, r.id); }}>Stop</button>}
                    <button disabled={busy} onClick={(e) => { e.stopPropagation(); act(deleteStrategyAbRun, r.id); }}>Delete</button>
                  </td>
                </tr>
              ))}
              {!runs.length && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16 }}>No runs yet.</td></tr>}
            </tbody>
          </table>
          {/* Pagination — page X of Y, prev/next. */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button disabled={pageInfo.offset === 0} onClick={() => setPageInfo({ ...pageInfo, offset: Math.max(0, pageInfo.offset - pageInfo.limit) })}>Prev</button>
            <span>Page {currentPage} of {totalPages}</span>
            <button disabled={pageInfo.offset + pageInfo.limit >= pageInfo.total} onClick={() => setPageInfo({ ...pageInfo, offset: pageInfo.offset + pageInfo.limit })}>Next</button>
          </div>
        </div>

        <div>
          <h3>Detail</h3>
          {!selected && <p style={{ color: '#888' }}>Pick a run to view trades + critique.</p>}
          {selected && (
            <div>
              <div style={{ marginBottom: 12 }}>
                <strong>{selected.name}</strong> — {selected.status}
                {selected.results?.A && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                    {['A', 'B'].map((s) => (
                      <div key={s} style={{ border: '1px solid #444', padding: 8, borderRadius: 4 }}>
                        <div><strong>Side {s}</strong> — {s === 'A' ? selected.strategyA : selected.strategyB}</div>
                        <div>Trades: {selected.results[s].trades}</div>
                        <div>P&L: ${selected.results[s].pnl}</div>
                        <div>Win rate: {selected.results[s].winRate}%</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button disabled={busy} onClick={() => act(critiqueStrategyAbRun, selected.id)}>AI Critique</button>
              {critique && (
                <pre style={{ marginTop: 12, padding: 10, background: '#111', whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>{critique}</pre>
              )}
              <h4 style={{ marginTop: 16 }}>Recent Trades</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr><th>Side</th><th>Symbol</th><th>Action</th><th>Qty</th><th>Price</th><th>P&L</th><th>At</th></tr></thead>
                <tbody>
                  {trades.slice(0, 50).map((t) => (
                    <tr key={t.id}>
                      <td>{t.side}</td>
                      <td>{t.symbol}</td>
                      <td>{t.action}</td>
                      <td>{t.qty}</td>
                      <td>${Number(t.price).toFixed(2)}</td>
                      <td style={{ color: t.pnl > 0 ? '#3c3' : t.pnl < 0 ? '#c33' : '#888' }}>${Number(t.pnl).toFixed(2)}</td>
                      <td>{new Date(t.tradeAt).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
