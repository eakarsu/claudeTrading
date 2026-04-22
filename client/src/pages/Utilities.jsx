import React, { useState } from 'react';
import { FiTool, FiPlay } from 'react-icons/fi';
import {
  utilListStrategies, utilListTimeframes, utilListMarkets, utilListPairs,
  utilListData, utilShowTrades, utilTestPairlist,
  utilHyperoptList, utilHyperoptShow,
} from '../api';

/**
 * Utilities — freqtrade-parity sub-commands, consolidated.
 *
 * Each tab invokes a single /api/util/* endpoint and renders the result as
 * a table/pre-block. This is deliberately low-ceremony — the value here is
 * a predictable entry point, not a dashboard.
 */

const TABS = [
  { id: 'list-strategies', label: 'list-strategies' },
  { id: 'list-timeframes', label: 'list-timeframes' },
  { id: 'list-markets',    label: 'list-markets' },
  { id: 'list-pairs',      label: 'list-pairs' },
  { id: 'list-data',       label: 'list-data' },
  { id: 'show-trades',     label: 'show-trades' },
  { id: 'test-pairlist',   label: 'test-pairlist' },
  { id: 'hyperopt-list',   label: 'hyperopt-list' },
  { id: 'hyperopt-show',   label: 'hyperopt-show' },
];

export default function Utilities() {
  const [tab, setTab] = useState('list-strategies');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  // per-tab form state
  const [ldSymbol, setLdSymbol] = useState('SPY');
  const [ldTimeframe, setLdTimeframe] = useState('1Day');
  const [ldDays, setLdDays] = useState(30);
  const [stLimit, setStLimit] = useState(50);
  const [tpSymbols, setTpSymbols] = useState('SPY, QQQ, INVALID!, msft');
  const [hsId, setHsId] = useState('');

  const run = async () => {
    setErr(''); setResult(null); setBusy(true);
    try {
      let r;
      switch (tab) {
        case 'list-strategies': r = await utilListStrategies(); break;
        case 'list-timeframes': r = await utilListTimeframes(); break;
        case 'list-markets':    r = await utilListMarkets(); break;
        case 'list-pairs':      r = await utilListPairs(); break;
        case 'list-data':       r = await utilListData(ldSymbol, { timeframe: ldTimeframe, days: Number(ldDays) }); break;
        case 'show-trades':     r = await utilShowTrades(Number(stLimit)); break;
        case 'test-pairlist':   r = await utilTestPairlist(tpSymbols.split(',').map((s) => s.trim()).filter(Boolean)); break;
        case 'hyperopt-list':   r = await utilHyperoptList(); break;
        case 'hyperopt-show':   r = await utilHyperoptShow(hsId); break;
        default: throw new Error('Unknown tab');
      }
      setResult(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiTool /> Utilities</h1>
        <p className="page-subtitle">
          Consolidated access to freqtrade-style sub-commands —{' '}
          <code>list-strategies</code>, <code>list-timeframes</code>,{' '}
          <code>list-markets</code>, <code>list-pairs</code>,{' '}
          <code>list-data</code>, <code>show-trades</code>,{' '}
          <code>test-pairlist</code>, <code>hyperopt-list</code>,{' '}
          <code>hyperopt-show</code>.
        </p>
      </div>

      <section className="card">
        <div className="card-header-row">
          <h2>Sub-command</h2>
          <select value={tab} onChange={(e) => { setTab(e.target.value); setResult(null); }}>
            {TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>

        {tab === 'list-data' && (
          <>
            <div className="form-row"><label>Symbol</label>
              <input value={ldSymbol} onChange={(e) => setLdSymbol(e.target.value.toUpperCase())} maxLength={10} />
            </div>
            <div className="form-row"><label>Timeframe</label>
              <select value={ldTimeframe} onChange={(e) => setLdTimeframe(e.target.value)}>
                <option>1Day</option><option>1Hour</option><option>15Min</option><option>5Min</option>
              </select>
            </div>
            <div className="form-row"><label>Days</label>
              <input type="number" min={1} max={365} value={ldDays} onChange={(e) => setLdDays(e.target.value)} />
            </div>
          </>
        )}

        {tab === 'show-trades' && (
          <div className="form-row"><label>Limit</label>
            <input type="number" min={1} max={500} value={stLimit} onChange={(e) => setStLimit(e.target.value)} />
          </div>
        )}

        {tab === 'test-pairlist' && (
          <div className="form-row"><label>Symbols (CSV)</label>
            <input value={tpSymbols} onChange={(e) => setTpSymbols(e.target.value)} />
          </div>
        )}

        {tab === 'hyperopt-show' && (
          <div className="form-row"><label>Run ID</label>
            <input value={hsId} onChange={(e) => setHsId(e.target.value)} />
          </div>
        )}

        <div className="form-row">
          <button className="btn btn-primary" onClick={run} disabled={busy}>
            <FiPlay size={14} /> {busy ? 'Running…' : 'Run'}
          </button>
        </div>
      </section>

      {err && <div className="alert alert-error">{err}</div>}

      {result && (
        <section className="card">
          <h2>Result</h2>
          {renderResult(tab, result)}
          <details style={{ marginTop: 12 }}>
            <summary>Raw JSON</summary>
            <pre className="code-block">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </section>
      )}
    </div>
  );
}

function renderResult(tab, r) {
  switch (tab) {
    case 'list-strategies':
      return (
        <table className="data-table">
          <thead><tr><th>Key</th><th>Name</th><th>Source</th><th>Intraday</th></tr></thead>
          <tbody>{(r.items || []).map((s) => (
            <tr key={s.key}>
              <td><code>{s.key}</code></td>
              <td>{s.name}</td>
              <td><span className={`pill ${s.source === 'user' ? 'pill-running' : 'pill-ok'}`}>{s.source}</span></td>
              <td>{s.intraday ? 'yes' : ''}</td>
            </tr>
          ))}</tbody>
        </table>
      );
    case 'list-timeframes':
      return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {(r.items || []).map((t) => <span key={t} className="pill">{t}</span>)}
      </div>;
    case 'list-markets':
      return (
        <table className="data-table">
          <thead><tr><th>ID</th><th>Name</th><th>Kind</th></tr></thead>
          <tbody>{(r.items || []).map((x) => (
            <tr key={x.id}><td><code>{x.id}</code></td><td>{x.name}</td><td>{x.kind}</td></tr>
          ))}</tbody>
        </table>
      );
    case 'list-pairs':
      return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {(r.items || []).map((s) => <span key={s} className="pill">{s}</span>)}
      </div>;
    case 'list-data':
      return <div className="hyperopt-grid">
        <Metric label="Symbol" value={r.symbol} />
        <Metric label="Timeframe" value={r.timeframe} />
        <Metric label="Bars" value={r.bars} />
        <Metric label="First" value={r.first ? new Date(r.first).toLocaleString() : '—'} />
        <Metric label="Last"  value={r.last  ? new Date(r.last).toLocaleString()  : '—'} />
        <Metric label="Last close" value={r.lastClose != null ? `$${r.lastClose}` : '—'} />
      </div>;
    case 'show-trades':
      return (
        <table className="data-table">
          <thead><tr><th>ID</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Strategy</th><th>P&L</th><th>Opened</th></tr></thead>
          <tbody>{(r.items || []).map((t) => (
            <tr key={t.id}>
              <td>{t.id}</td>
              <td><strong>{t.symbol}</strong></td>
              <td><span className={`pill ${t.action === 'buy' ? 'pill-ok' : 'pill-error'}`}>{t.action}</span></td>
              <td>{t.qty}</td>
              <td>${t.price}</td>
              <td><code>{t.strategy || '—'}</code></td>
              <td>{t.pnl != null ? `$${t.pnl}` : '—'}</td>
              <td>{t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      );
    case 'test-pairlist':
      return <>
        <h3>Accepted ({(r.accepted || []).length})</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{(r.accepted || []).map((s) => <span key={s} className="pill pill-ok">{s}</span>)}</div>
        <h3 style={{ marginTop: 12 }}>Rejected ({(r.rejected || []).length})</h3>
        {(r.rejected || []).length ? (
          <table className="data-table">
            <thead><tr><th>Symbol</th><th>Reason</th></tr></thead>
            <tbody>{r.rejected.map((x, i) => <tr key={i}><td><code>{String(x.symbol)}</code></td><td>{x.reason}</td></tr>)}</tbody>
          </table>
        ) : <div className="empty-state">none</div>}
      </>;
    case 'hyperopt-list':
      return (
        <table className="data-table">
          <thead><tr><th>ID</th><th>Status</th><th>Strategy</th><th>Symbol</th><th>Best loss</th><th>Started</th></tr></thead>
          <tbody>{(r.items || []).map((h) => (
            <tr key={h.id}>
              <td>{h.id}</td>
              <td><span className={`pill ${h.status === 'completed' ? 'pill-done' : h.status === 'running' ? 'pill-running' : 'pill-error'}`}>{h.status}</span></td>
              <td><code>{h.strategyKey}</code></td>
              <td>{h.symbol}</td>
              <td>{h.bestLoss ?? '—'}</td>
              <td>{h.createdAt ? new Date(h.createdAt).toLocaleString() : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      );
    case 'hyperopt-show':
      return <pre className="code-block">{JSON.stringify(r, null, 2)}</pre>;
    default:
      return <pre className="code-block">{JSON.stringify(r, null, 2)}</pre>;
  }
}

function Metric({ label, value }) {
  return (
    <div style={{
      padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)',
      background: 'var(--bg-secondary, transparent)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}
