import React, { useEffect, useState } from 'react';
import { FiAlertTriangle, FiCheck, FiPlay } from 'react-icons/fi';
import { analyzeLookahead, analyzeRecursive, getStrategies } from '../api';

/**
 * Strategy Audit — data-leakage sanity checks for strategies.
 *
 * Lookahead:   does the strategy "see the future"? (signals must not change
 *              when more future bars are appended to the history)
 * Recursive:   is the latest-bar signal stable across different amounts of
 *              preceding history? (sufficient startup candles)
 *
 * Both analyses re-run the strategy over sliced subsets of the historical
 * bars; they are CPU-bound but bounded (one API call each, ~1–3s typical).
 */

export default function StrategyAudit() {
  const [strategies, setStrategies] = useState([]);
  const [strategyKey, setStrategyKey] = useState('');
  const [symbol, setSymbol]   = useState('SPY');
  const [days, setDays]       = useState(365);
  const [timeframe, setTimeframe] = useState('1Day');
  const [lookahead, setLookahead] = useState(null);
  const [recursive, setRecursive] = useState(null);
  const [busy, setBusy] = useState(null); // 'lookahead' | 'recursive' | null
  const [err, setErr]  = useState('');

  useEffect(() => {
    getStrategies()
      .then((r) => {
        const items = r.strategies || r.items || r || [];
        setStrategies(items);
        if (items.length && !strategyKey) setStrategyKey(items[0].key || items[0]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = () => ({
    strategyKey, symbol: symbol.toUpperCase(), days: Number(days), timeframe,
  });

  const runLookahead = async () => {
    setErr(''); setLookahead(null); setBusy('lookahead');
    try { setLookahead(await analyzeLookahead(body())); }
    catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  const runRecursive = async () => {
    setErr(''); setRecursive(null); setBusy('recursive');
    try { setRecursive(await analyzeRecursive(body())); }
    catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Strategy Audit</h1>
        <p className="page-subtitle">
          Data-leakage and stability checks. Run these before deploying a strategy to
          auto-trader: a strategy that peeks into the future, or whose signals flip when
          given more history, will underperform live.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>Configuration</h2>
        <div className="form-row">
          <label>Strategy</label>
          <select value={strategyKey} onChange={(e) => setStrategyKey(e.target.value)}>
            {strategies.map((s) => {
              const k = s.key || s;
              return <option key={k} value={k}>{s.name ? `${s.name} (${k})` : k}</option>;
            })}
          </select>
        </div>
        <div className="form-row">
          <label>Symbol</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={10} />
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
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Lookahead analysis</h2>
          <button className="btn btn-primary" onClick={runLookahead} disabled={busy !== null || !strategyKey}>
            <FiPlay size={14} /> {busy === 'lookahead' ? 'Running…' : 'Run'}
          </button>
        </div>
        <p className="hint">
          Compares signals produced on truncated bar windows with those produced on the full
          history. Any mismatch at the same timestamp indicates the strategy peeked forward.
        </p>
        {lookahead && (
          <div>
            <div className={`audit-verdict ${lookahead.clean ? 'ok' : 'bad'}`}>
              {lookahead.clean
                ? <><FiCheck size={18} /> Clean — no lookahead bias detected.</>
                : <><FiAlertTriangle size={18} /> {lookahead.mismatchCount} mismatch{lookahead.mismatchCount === 1 ? '' : 'es'} detected.</>}
            </div>
            <p>
              Checked <strong>{lookahead.checkedSlices}</strong> truncated slices,
              <strong> {lookahead.checkedSignals}</strong> signals across
              <strong> {lookahead.barsAnalyzed}</strong> bars (stride {lookahead.stride}).
            </p>
            {lookahead.mismatches?.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr><th>Time</th><th>Cutoff</th><th>Kind</th><th>Sliced</th><th>Baseline</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {lookahead.mismatches.map((m, i) => (
                    <tr key={i}>
                      <td>{new Date(m.time).toLocaleString()}</td>
                      <td>{m.cutoff}</td>
                      <td><code>{m.kind}</code></td>
                      <td>{m.sliced || '—'}</td>
                      <td>{m.baseline || '—'}</td>
                      <td>{m.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Recursive analysis</h2>
          <button className="btn btn-primary" onClick={runRecursive} disabled={busy !== null || !strategyKey}>
            <FiPlay size={14} /> {busy === 'recursive' ? 'Running…' : 'Run'}
          </button>
        </div>
        <p className="hint">
          Re-runs the strategy on progressively longer tails of history and compares the
          last-bar signal. If the signal flips depending on how much history precedes it,
          you need more startup candles — live trading will not match the backtest.
        </p>
        {recursive && (
          <div>
            <div className={`audit-verdict ${recursive.stable ? 'ok' : 'bad'}`}>
              {recursive.stable
                ? <><FiCheck size={18} /> Stable — last-bar signal is consistent across window sizes.</>
                : <><FiAlertTriangle size={18} /> Unstable — actions observed: {recursive.distinctActions.join(', ')}</>}
            </div>
            <table className="data-table">
              <thead>
                <tr><th>Bars used</th><th>Signal @ last bar</th><th>Metrics</th></tr>
              </thead>
              <tbody>
                {recursive.windows.map((w, i) => (
                  <tr key={i}>
                    <td>{w.barsUsed}</td>
                    <td><code>{w.signalAtLastBar}</code></td>
                    <td>
                      {w.metrics
                        ? <code>{Object.entries(w.metrics).map(([k, v]) => `${k}=${Number(v).toFixed(4)}`).join(' · ')}</code>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {Object.keys(recursive.lastStepDrift || {}).length > 0 && (
              <p className="hint">
                Relative drift in the final window step (smaller = more converged):{' '}
                <code>
                  {Object.entries(recursive.lastStepDrift)
                    .map(([k, v]) => `${k}=${(v * 100).toFixed(3)}%`)
                    .join(' · ')}
                </code>
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
