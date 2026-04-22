import React, { useEffect, useState } from 'react';
import { FiTarget, FiRefreshCw } from 'react-icons/fi';
import { getEdgesAll } from '../api';

/**
 * Edge — per-symbol win-rate / expectancy / edge-ratio diagnostic.
 *
 * Pulls from the caller's own closed AutoTraderTrade history; symbols with
 * fewer than `minTrades` closed trades are filtered out server-side. Sorted
 * by expectancy desc so the strongest pairs surface first.
 */

export default function Edge() {
  const [lookbackDays, setLookbackDays] = useState(30);
  const [minTrades, setMinTrades]       = useState(5);
  const [data, setData] = useState(null);
  const [err, setErr]   = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true); setErr('');
    try { setData(await getEdgesAll({ lookbackDays, minTrades })); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const fmtPct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
  const fmtNum = (x, d = 2) => (x == null ? '—' : Number(x).toFixed(d));

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiTarget /> Edge</h1>
        <p className="page-subtitle">
          Per-symbol win-rate, expectancy, and edge-ratio derived from your closed trades.
          Equivalent to freqtrade's <code>edge</code> CLI. Symbols below the min-trades
          threshold are excluded — small samples are noise.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <div className="card-header-row">
          <h2>Parameters</h2>
          <button className="btn btn-secondary btn-small" onClick={refresh} disabled={busy}>
            <FiRefreshCw size={12} /> {busy ? 'Computing…' : 'Recompute'}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Lookback (days)</label>
            <input
              type="number" min={1} max={365}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value) || 30)}
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Min trades per symbol</label>
            <input
              type="number" min={1} max={100}
              value={minTrades}
              onChange={(e) => setMinTrades(Number(e.target.value) || 5)}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Results {data?.items?.length ? `(${data.items.length})` : ''}</h2>
        {!data ? (
          <div className="page-loading">Loading…</div>
        ) : data.items.length === 0 ? (
          <div className="empty-state">
            No symbols meet the threshold. Either you have no closed trades in the window,
            or every symbol has fewer than {minTrades} trades.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Trades</th>
                <th>Win rate</th>
                <th>Expectancy</th>
                <th>Avg win</th>
                <th>Avg loss</th>
                <th>Edge ratio</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.symbol}>
                  <td><strong>{it.symbol}</strong></td>
                  <td>{it.totalTrades ?? it.trades ?? '—'}</td>
                  <td>{fmtPct(it.winRate)}</td>
                  <td>{fmtNum(it.expectancy, 4)}</td>
                  <td>{fmtNum(it.avgWin)}</td>
                  <td>{fmtNum(it.avgLoss)}</td>
                  <td>{fmtNum(it.edgeRatio, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
