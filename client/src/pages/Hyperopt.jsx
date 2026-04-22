import React, { useEffect, useRef, useState } from 'react';
import { FiPlay, FiTrash2, FiRefreshCw } from 'react-icons/fi';
import {
  listHyperoptRuns,
  getHyperoptRun,
  startHyperoptRun,
  startBayesianHyperopt,
  deleteHyperoptRun,
  getStrategies,
} from '../api';

/**
 * Hyperopt — parameter grid-search UI on top of the backtest engine.
 *
 * The server-side job is fire-and-forget: POST /hyperopt returns 202 with a
 * run id, and the row's `progress` + `leaderboard` fields are updated as the
 * job runs. We poll getHyperoptRun(id) every 2s while status is
 * pending|running so the UI reflects live progress.
 */

const DEFAULT_GRID_TEXT = JSON.stringify({
  stopLossPct:   [0.02, 0.03, 0.05, 0.08],
  takeProfitPct: [0.04, 0.06, 0.10, 0.15],
  slippagePct:   [0, 0.0005],
}, null, 2);

const DEFAULT_SPACE_TEXT = JSON.stringify({
  stopLossPct:   { min: 0.01, max: 0.10, type: 'float' },
  takeProfitPct: { min: 0.02, max: 0.20, type: 'float' },
  slippagePct:   { min: 0,    max: 0.002, type: 'float' },
}, null, 2);

export default function Hyperopt() {
  const [strategies, setStrategies] = useState([]);
  const [runs, setRuns]             = useState([]);
  const [strategyKey, setStrategyKey] = useState('');
  const [symbol, setSymbol]         = useState('SPY');
  const [days, setDays]             = useState(365);
  const [timeframe, setTimeframe]   = useState('1Day');
  const [mode, setMode]             = useState('grid'); // 'grid' | 'bayesian'
  const [gridText, setGridText]     = useState(DEFAULT_GRID_TEXT);
  const [spaceText, setSpaceText]   = useState(DEFAULT_SPACE_TEXT);
  const [budget, setBudget]         = useState(40);
  const [starting, setStarting]     = useState(false);
  const [err, setErr]               = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected]     = useState(null);
  const pollTimer = useRef(null);

  const refreshList = async () => {
    try {
      const r = await listHyperoptRuns();
      setRuns(r.items || []);
    } catch (e) { setErr(e.message); }
  };

  useEffect(() => {
    getStrategies()
      .then((r) => {
        const items = r.strategies || r.items || r || [];
        setStrategies(items);
        if (items.length && !strategyKey) setStrategyKey(items[0].key || items[0]);
      })
      .catch(() => {});
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the selected run until it reaches a terminal state.
  useEffect(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    if (!selectedId) { setSelected(null); return; }

    let cancelled = false;
    const tick = async () => {
      try {
        const r = await getHyperoptRun(selectedId);
        if (cancelled) return;
        setSelected(r);
        if (r.status === 'done' || r.status === 'failed') {
          if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
          refreshList();
        }
      } catch (e) { setErr(e.message); }
    };
    tick();
    pollTimer.current = setInterval(tick, 2000);
    return () => { cancelled = true; if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [selectedId]);

  const handleStart = async (e) => {
    e.preventDefault();
    setErr('');
    setStarting(true);
    try {
      let r;
      if (mode === 'bayesian') {
        let space;
        try { space = JSON.parse(spaceText); }
        catch (_) { throw new Error('Space must be valid JSON'); }
        r = await startBayesianHyperopt({
          strategyKey, symbol: symbol.toUpperCase(), days: Number(days), timeframe,
          space, budget: Number(budget),
        });
      } else {
        let grid;
        try { grid = JSON.parse(gridText); }
        catch (_) { throw new Error('Grid must be valid JSON'); }
        r = await startHyperoptRun({
          strategyKey, symbol: symbol.toUpperCase(), days: Number(days), timeframe, grid,
        });
      }
      setSelectedId(r.id);
      refreshList();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setStarting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this hyperopt run?')) return;
    try {
      await deleteHyperoptRun(id);
      if (selectedId === id) { setSelectedId(null); setSelected(null); }
      refreshList();
    } catch (e) { alert(`Delete failed: ${e.message}`); }
  };

  const progressPct = (r) => {
    if (!r?.progress?.total) return 0;
    return Math.round(100 * (r.progress.completed || 0) / r.progress.total);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Hyperopt</h1>
        <p className="page-subtitle">
          Grid-search execution parameters (stop-loss, take-profit, slippage) on top
          of a strategy's backtest. Runs are evaluated with an in-sample / out-of-sample
          split and penalized for OOS degradation to discourage overfitting.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>New run</h2>
        <form className="hyperopt-form" onSubmit={handleStart}>
          <div className="form-row">
            <label>Search mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="grid">Grid — enumerate every combination</option>
              <option value="bayesian">Bayesian (TPE-lite) — sample a continuous space</option>
            </select>
          </div>
          <div className="form-row">
            <label>Strategy</label>
            <select value={strategyKey} onChange={(e) => setStrategyKey(e.target.value)} required>
              {strategies.map((s) => {
                const k = s.key || s;
                const label = s.name ? `${s.name} (${k})` : k;
                return <option key={k} value={k}>{label}</option>;
              })}
            </select>
          </div>
          <div className="form-row">
            <label>Symbol</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={10} required />
          </div>
          <div className="form-row">
            <label>Days</label>
            <input type="number" min={30} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Timeframe</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              <option value="1Day">1 day</option>
              <option value="1Hour">1 hour</option>
              <option value="15Min">15 min</option>
              <option value="5Min">5 min</option>
            </select>
          </div>
          {mode === 'grid' ? (
            <div className="form-row">
              <label>Grid (JSON) — arrays of discrete values</label>
              <textarea
                className="hyperopt-grid"
                rows={8}
                value={gridText}
                onChange={(e) => setGridText(e.target.value)}
                spellCheck={false}
              />
            </div>
          ) : (
            <>
              <div className="form-row">
                <label>Budget (samples)</label>
                <input
                  type="number" min={10} max={500}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label>Space (JSON) — {'{ paramName: { min, max, type: "float" | "int" } }'}</label>
                <textarea
                  className="hyperopt-grid"
                  rows={10}
                  value={spaceText}
                  onChange={(e) => setSpaceText(e.target.value)}
                  spellCheck={false}
                />
              </div>
            </>
          )}
          <div className="form-row">
            <button type="submit" className="btn btn-primary" disabled={starting || !strategyKey}>
              <FiPlay size={14} /> {starting ? 'Starting…' : 'Start hyperopt'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Recent runs ({runs.length})</h2>
          <button className="btn btn-secondary btn-small" onClick={refreshList} title="Refresh">
            <FiRefreshCw size={12} /> Refresh
          </button>
        </div>
        {runs.length === 0 ? (
          <div className="empty-state">No runs yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Symbol</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Best score</th>
                <th>Started</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className={selectedId === r.id ? 'row-selected' : ''}
                  onClick={() => setSelectedId(r.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td><code>{r.strategyKey}</code></td>
                  <td><strong>{r.symbol}</strong></td>
                  <td>
                    <span className={`pill pill-${r.status}`}>{r.status}</span>
                  </td>
                  <td>
                    {r.progress?.total
                      ? `${r.progress.completed || 0}/${r.progress.total} (${progressPct(r)}%)`
                      : '—'}
                  </td>
                  <td>{r.leaderboard?.[0]?.score ?? '—'}</td>
                  <td>{r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}</td>
                  <td>
                    <button
                      className="btn btn-danger btn-small"
                      onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                    >
                      <FiTrash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selected && (
        <section className="card">
          <h2>
            Run {selected.id} — {selected.strategyKey} / {selected.symbol}
            {' '}<span className={`pill pill-${selected.status}`}>{selected.status}</span>
          </h2>
          {selected.status === 'failed' && selected.error && (
            <div className="alert alert-error">{selected.error}</div>
          )}
          {selected.progress?.total > 0 && selected.status !== 'done' && (
            <div className="hyperopt-progress">
              <div className="hyperopt-progress-bar">
                <div
                  className="hyperopt-progress-fill"
                  style={{ width: `${progressPct(selected)}%` }}
                />
              </div>
              <span>{selected.progress.completed}/{selected.progress.total} ({progressPct(selected)}%)</span>
            </div>
          )}
          {selected.leaderboard?.length > 0 && (
            <>
              <h3>Leaderboard (top {selected.leaderboard.length}, ranked by OOS-adjusted score)</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Params</th>
                    <th>Score</th>
                    <th>Total P&amp;L</th>
                    <th>IS P&amp;L</th>
                    <th>OOS P&amp;L</th>
                    <th>Degradation</th>
                    <th>Trades</th>
                    <th>Win rate</th>
                    <th>Sharpe</th>
                    <th>Max DD</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.leaderboard.map((row, idx) => (
                    <tr key={idx}>
                      <td>{idx + 1}</td>
                      <td>
                        <code className="hyperopt-params">
                          {Object.entries(row.params).map(([k, v]) => `${k}=${v}`).join(' · ')}
                        </code>
                      </td>
                      <td><strong>{row.score}</strong></td>
                      <td>{row.totalPnl}</td>
                      <td>{row.isPnl}</td>
                      <td>{row.oosPnl}</td>
                      <td>{row.degradation}%</td>
                      <td>{row.totalTrades}</td>
                      <td>{row.winRate}%</td>
                      <td>{row.sharpe}</td>
                      <td>{row.maxDrawdown}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </div>
  );
}
