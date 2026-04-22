import React, { useEffect, useState } from 'react';
import { FiCpu, FiPlay, FiSave, FiTrash2, FiRefreshCw } from 'react-icons/fi';
import {
  listRlTables, trainRlTable, evaluateRlTable, deleteRlTable, getRlBuckets,
} from '../api';

/**
 * RL-lite — train + eval a tabular Q-table over bucketed market state.
 *
 * The policy is deliberately tiny: 45 states (RSI×ADX×trend) × 3 actions.
 * Useful as an interpretable baseline next to the logreg model and the
 * hand-written strategies.
 */

export default function RlLite() {
  const [form, setForm] = useState({
    symbol: 'SPY', timeframe: '1Day', days: 730, oosSplit: 0.2,
    episodes: 30, alpha: 0.1, gamma: 0.95, epsilonStart: 0.3, epsilonEnd: 0.02,
    commission: 0.0005, save: false, name: '',
  });
  const [buckets, setBuckets]     = useState(null);
  const [tables, setTables]       = useState([]);
  const [training, setTraining]   = useState(false);
  const [result, setResult]       = useState(null);
  const [err, setErr]             = useState('');
  const [evalBusy, setEvalBusy]   = useState(null);

  const refresh = () => {
    listRlTables().then((r) => setTables(r.items || [])).catch(() => {});
  };

  useEffect(() => {
    getRlBuckets().then(setBuckets).catch(() => {});
    refresh();
  }, []);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked
            : e.target.type === 'number'   ? Number(e.target.value)
            : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const train = async () => {
    setErr(''); setResult(null); setTraining(true);
    try {
      const { symbol, timeframe, days, oosSplit, save, name, ...rest } = form;
      const r = await trainRlTable({
        symbol, timeframe, days, oosSplit,
        save, name: save ? name : null,
        params: rest,
      });
      setResult(r);
      if (save) refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setTraining(false);
    }
  };

  const onEvaluate = async (id) => {
    setEvalBusy(id); setErr('');
    try {
      const r = await evaluateRlTable(id, { days: form.days });
      setResult({ ...r, fromSaved: id });
    } catch (e) { setErr(e.message); }
    finally { setEvalBusy(null); }
  };

  const onDelete = async (id) => {
    if (!confirm('Delete this Q-table?')) return;
    await deleteRlTable(id).catch((e) => setErr(e.message));
    refresh();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiCpu /> RL-lite — Tabular Q-learning</h1>
        <p className="page-subtitle">
          Discretize RSI·ADX·trend into buckets and learn Q(s,a) over three
          actions — hold, enter long, exit. Interpretable alternative to the
          logreg FreqAI model; dump the table and read the policy by hand.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>Train</h2>
        <div className="form-grid">
          <div className="form-row"><label>Symbol</label>
            <input value={form.symbol} onChange={set('symbol')} maxLength={10} />
          </div>
          <div className="form-row"><label>Timeframe</label>
            <select value={form.timeframe} onChange={set('timeframe')}>
              {['1Min','5Min','15Min','30Min','1Hour','4Hour','1Day','1Week'].map((t) =>
                <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Days</label>
            <input type="number" value={form.days} onChange={set('days')} min={60} max={3650} />
          </div>
          <div className="form-row"><label>OOS split (0-0.5)</label>
            <input type="number" step="0.05" value={form.oosSplit} onChange={set('oosSplit')} min={0} max={0.5} />
          </div>
          <div className="form-row"><label>Episodes</label>
            <input type="number" value={form.episodes} onChange={set('episodes')} min={1} max={200} />
          </div>
          <div className="form-row"><label>α (learning rate)</label>
            <input type="number" step="0.01" value={form.alpha} onChange={set('alpha')} />
          </div>
          <div className="form-row"><label>γ (discount)</label>
            <input type="number" step="0.01" value={form.gamma} onChange={set('gamma')} />
          </div>
          <div className="form-row"><label>ε start</label>
            <input type="number" step="0.05" value={form.epsilonStart} onChange={set('epsilonStart')} />
          </div>
          <div className="form-row"><label>ε end</label>
            <input type="number" step="0.01" value={form.epsilonEnd} onChange={set('epsilonEnd')} />
          </div>
          <div className="form-row"><label>Commission</label>
            <input type="number" step="0.0001" value={form.commission} onChange={set('commission')} />
          </div>
          <div className="form-row"><label>Save result</label>
            <input type="checkbox" checked={form.save} onChange={set('save')} />
          </div>
          {form.save && (
            <div className="form-row"><label>Save name</label>
              <input value={form.name} onChange={set('name')} placeholder="e.g. SPY-daily-v1" />
            </div>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={train} disabled={training}>
            {training ? <><FiRefreshCw size={14} className="spin" /> Training…</>
                     : <><FiPlay size={14} /> Train</>}
          </button>
        </div>
      </section>

      {buckets && (
        <section className="card">
          <h2>Discretization</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {buckets.nStates} discrete states × {buckets.nActions} actions.
            RSI edges: [{buckets.rsi.join(', ')}]. ADX edges: [{buckets.adx.join(', ')}].
            Trend bucket = (close − SMA20)/SMA20 split at ±2%.
          </p>
        </section>
      )}

      {result && (
        <section className="card">
          <h2>Result — {result.symbol || '?'}</h2>
          <div className="hyperopt-grid">
            <Metric label="In-sample trades"    value={result.stats?.inSample?.totalTrades ?? result.totalTrades ?? '—'} />
            <Metric label="In-sample win rate"  value={pct(result.stats?.inSample?.winRate ?? result.winRate)} />
            <Metric label="In-sample return %"  value={fmt(result.stats?.inSample?.totalReturnPct ?? result.totalReturnPct)} />
            <Metric label="OOS trades"          value={result.stats?.oos?.totalTrades ?? '—'} />
            <Metric label="OOS win rate"        value={pct(result.stats?.oos?.winRate)} />
            <Metric label="OOS return %"        value={fmt(result.stats?.oos?.totalReturnPct)} />
            <Metric label="States visited"      value={result.stats?.statesVisited ?? result.statesVisited ?? '—'} />
            <Metric label="Saved"               value={result.savedId ? `#${result.savedId}` : 'no'} />
          </div>
          {result.stats?.episodes?.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary>Episode log ({result.stats.episodes.length})</summary>
              <table className="data-table"><thead>
                <tr><th>#</th><th>ε</th><th>Return</th><th>Trades</th></tr>
              </thead><tbody>
                {result.stats.episodes.map((e) => (
                  <tr key={e.episode}>
                    <td>{e.episode}</td><td>{e.epsilon}</td>
                    <td>{fmt(e.return * 100)}</td><td>{e.trades}</td>
                  </tr>
                ))}
              </tbody></table>
            </details>
          )}
        </section>
      )}

      <section className="card">
        <h2>Saved Q-tables ({tables.length})</h2>
        {tables.length === 0 ? (
          <div className="empty-state">Train with "Save result" checked to persist.</div>
        ) : (
          <table className="data-table">
            <thead><tr>
              <th>Name</th><th>Symbol</th><th>TF</th>
              <th>OOS trades</th><th>OOS %</th><th>Trained</th><th></th>
            </tr></thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.symbol}</td>
                  <td>{t.timeframe}</td>
                  <td>{t.stats?.oos?.totalTrades ?? '—'}</td>
                  <td>{fmt(t.stats?.oos?.totalReturnPct)}</td>
                  <td>{t.trainedAt ? new Date(t.trainedAt).toLocaleString() : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => onEvaluate(t.id)} disabled={evalBusy === t.id}>
                      {evalBusy === t.id ? '…' : 'Eval'}
                    </button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => onDelete(t.id)}>
                      <FiTrash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function fmt(v) {
  return v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(2);
}
function pct(v) {
  return v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(1)}%`;
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
