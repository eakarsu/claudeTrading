import React, { useEffect, useState } from 'react';
import { FiPieChart, FiFilter, FiRefreshCw } from 'react-icons/fi';
import { analyzeTrades, analyzeSavedBacktest, listSavedBacktests } from '../api';

/**
 * Backtesting Analysis — freqtrade's `--analysis-groups 0..5` tabulator.
 *
 * Source: either live AutoTraderTrade rows or a previously-saved backtest.
 * Filters accept CSV lists of enter_tag / exit_reason values.
 */

const GROUPS = [
  { id: 0, label: '0 — by pair' },
  { id: 1, label: '1 — by enter_tag' },
  { id: 2, label: '2 — by exit_reason' },
  { id: 3, label: '3 — pair × enter_tag' },
  { id: 4, label: '4 — pair × exit_reason' },
  { id: 5, label: '5 — pair × enter_tag × exit_reason' },
];

export default function BacktestAnalysis() {
  const [source, setSource] = useState('live');         // 'live' | 'saved'
  const [savedId, setSavedId] = useState('');
  const [saved, setSaved] = useState([]);
  const [group, setGroup] = useState(0);
  const [enterReasons, setEnterReasons] = useState('');
  const [exitReasons, setExitReasons] = useState('');
  const [report, setReport] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listSavedBacktests()
      .then((r) => {
        const items = r.items || [];
        setSaved(items);
        if (!savedId && items[0]) setSavedId(items[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    setErr(''); setReport(null); setBusy(true);
    try {
      const opts = { group, enterReasons: enterReasons || undefined, exitReasons: exitReasons || undefined };
      const r = source === 'saved'
        ? await analyzeSavedBacktest(savedId, opts)
        : await analyzeTrades(opts);
      setReport(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiPieChart /> Backtesting Analysis</h1>
        <p className="page-subtitle">
          Group trades by pair, enter_tag, exit_reason, or any combination. Mirrors
          freqtrade's <code>backtesting-analysis --analysis-groups 0..5</code> with
          <code>--enter-reason-list</code> / <code>--exit-reason-list</code> filters.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>Parameters</h2>
        <div className="form-row">
          <label>Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="live">Live AutoTrader trades</option>
            <option value="saved">Saved backtest</option>
          </select>
        </div>

        {source === 'saved' && (
          <div className="form-row">
            <label>Saved backtest</label>
            <select value={savedId} onChange={(e) => setSavedId(e.target.value)}>
              {saved.length === 0 ? <option value="">(none saved)</option> : saved.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.symbol} / {s.strategyKey}</option>
              ))}
            </select>
          </div>
        )}

        <div className="form-row">
          <label>Group</label>
          <select value={group} onChange={(e) => setGroup(Number(e.target.value))}>
            {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>Enter reasons (CSV, optional)</label>
          <input value={enterReasons} onChange={(e) => setEnterReasons(e.target.value)} placeholder="macd_crossover,rsi_oversold" />
        </div>
        <div className="form-row">
          <label>Exit reasons (CSV, optional)</label>
          <input value={exitReasons} onChange={(e) => setExitReasons(e.target.value)} placeholder="Stop loss hit,Target hit" />
        </div>
        <div className="form-row">
          <button className="btn btn-primary" onClick={run} disabled={busy || (source === 'saved' && !savedId)}>
            {busy ? <><FiRefreshCw size={14} /> Running…</> : <><FiFilter size={14} /> Analyze</>}
          </button>
        </div>
      </section>

      {report && (
        <>
          <section className="card">
            <h2>Overall</h2>
            <div className="hyperopt-grid">
              <Metric label="Trades"     value={report.overall.trades} />
              <Metric label="Win rate"   value={`${report.overall.winRate}%`} />
              <Metric label="Total P&L"  value={`$${report.overall.totalPnl}`} />
              <Metric label="Avg P&L"    value={`$${report.overall.avgPnl}`} />
              <Metric label="Best"       value={`$${report.overall.bestPnl}`} />
              <Metric label="Worst"      value={`$${report.overall.worstPnl}`} />
            </div>
          </section>

          <section className="card">
            <h2>Groups ({report.groups.length})</h2>
            {report.groups.length === 0 ? (
              <div className="empty-state">No trades matched the current filters.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Trades</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Win %</th>
                    <th>Total P&L</th>
                    <th>Avg P&L</th>
                    <th>Best</th>
                    <th>Worst</th>
                  </tr>
                </thead>
                <tbody>
                  {report.groups.map((g) => (
                    <tr key={g.key}>
                      <td><code>{g.key}</code></td>
                      <td>{g.trades}</td>
                      <td>{g.wins}</td>
                      <td>{g.losses}</td>
                      <td>{g.winRate}%</td>
                      <td style={{ color: g.totalPnl >= 0 ? 'var(--positive, #3ecf8e)' : 'var(--negative, #e55353)' }}>
                        ${g.totalPnl}
                      </td>
                      <td>${g.avgPnl}</td>
                      <td>${g.bestPnl}</td>
                      <td>${g.worstPnl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
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
