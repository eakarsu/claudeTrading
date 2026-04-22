import React, { useEffect, useRef, useState } from 'react';
import { FiCode, FiPlay, FiSave, FiTrash2, FiCheckCircle, FiAlertTriangle, FiFilePlus } from 'react-icons/fi';
import {
  listUserStrategies,
  getUserStrategy,
  getUserStrategyExample,
  createUserStrategy,
  updateUserStrategy,
  deleteUserStrategy,
  validateUserStrategy,
  backtestUserStrategy,
  inlineBacktestUserStrategy,
} from '../api';

/**
 * Strategy Editor — author a custom JS strategy, validate, backtest.
 *
 * The source is executed server-side in a `vm` sandbox (see
 * services/strategySandbox.js). Hooks the user can define:
 *   populate_entry_trend, populate_exit_trend, custom_stoploss, custom_exit,
 *   custom_entry_price, confirm_trade_entry, confirm_trade_exit,
 *   adjust_trade_position, check_entry_timeout, check_exit_timeout,
 *   order_filled, leverage.
 *
 * Each strategy row gets a deterministic `user:<id>` key.
 */

export default function StrategyEditor() {
  const [list, setList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [sourceJs, setSourceJs] = useState('');
  const [paramsJson, setParamsJson] = useState('{}');
  const [validation, setValidation] = useState(null);
  const [backtest, setBacktest] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Backtest form
  const [symbol, setSymbol] = useState('SPY');
  const [days, setDays] = useState(365);
  const [timeframe, setTimeframe] = useState('1Day');

  const didLoadExample = useRef(false);

  const refreshList = async () => {
    try { const r = await listUserStrategies(); setList(r.items || []); }
    catch (e) { setErr(e.message); }
  };

  useEffect(() => { refreshList(); }, []);

  // On first mount, if there are no strategies yet, prefill the editor with
  // the canonical example so the user sees the hook shape without digging.
  useEffect(() => {
    if (didLoadExample.current) return;
    didLoadExample.current = true;
    if (!sourceJs) {
      getUserStrategyExample().then((r) => { if (!sourceJs) setSourceJs(r.sourceJs); }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectStrategy = async (id) => {
    setErr(''); setValidation(null); setBacktest(null);
    try {
      const row = await getUserStrategy(id);
      setSelectedId(row.id);
      setName(row.name);
      setNotes(row.notes || '');
      setSourceJs(row.sourceJs);
      setParamsJson(JSON.stringify(row.params || {}, null, 2));
    } catch (e) { setErr(e.message); }
  };

  const newStrategy = () => {
    setSelectedId(null);
    setName('');
    setNotes('');
    setParamsJson('{}');
    setValidation(null); setBacktest(null); setErr('');
    getUserStrategyExample().then((r) => setSourceJs(r.sourceJs)).catch(() => setSourceJs(''));
  };

  const parseParams = () => {
    try { return JSON.parse(paramsJson || '{}'); }
    catch { throw new Error('Params JSON is not valid JSON'); }
  };

  const onValidate = async () => {
    setErr(''); setValidation(null); setBusy(true);
    try {
      const params = parseParams();
      const r = await validateUserStrategy({ sourceJs, params });
      setValidation(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onSave = async () => {
    setErr(''); setBusy(true);
    try {
      const params = parseParams();
      if (selectedId) {
        const row = await updateUserStrategy(selectedId, { name, sourceJs, params, notes });
        setSelectedId(row.id);
      } else {
        const row = await createUserStrategy({ name, sourceJs, params, notes });
        setSelectedId(row.id);
      }
      await refreshList();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    setBusy(true); setErr('');
    try {
      await deleteUserStrategy(selectedId);
      setSelectedId(null);
      newStrategy();
      await refreshList();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onBacktest = async () => {
    setErr(''); setBacktest(null); setBusy(true);
    try {
      const params = parseParams();
      const body = { symbol, days: Number(days), timeframe };
      const r = selectedId
        ? await backtestUserStrategy(selectedId, body)
        : await inlineBacktestUserStrategy({ sourceJs, params, ...body });
      setBacktest(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiCode /> Strategy Editor</h1>
        <p className="page-subtitle">
          Write a custom JavaScript strategy. The source runs server-side in a
          sandboxed <code>vm</code> context. Define any subset of the hooks
          (<code>populate_entry_trend</code>, <code>populate_exit_trend</code>,{' '}
          <code>custom_stoploss</code>, <code>custom_exit</code>,{' '}
          <code>confirm_trade_entry</code>, <code>leverage</code>, …) and call{' '}
          <code>defineStrategy(&#123; … &#125;)</code>.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <div className="card-header-row">
          <h2>My strategies ({list.length})</h2>
          <button className="btn btn-small btn-primary" onClick={newStrategy}>
            <FiFilePlus size={12} /> New
          </button>
        </div>
        {list.length === 0 ? (
          <div className="empty-state">No saved strategies yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Notes</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={s.id === selectedId ? 'row-selected' : ''}>
                  <td><strong>{s.name}</strong></td>
                  <td>{s.notes || '—'}</td>
                  <td>{s.updatedAt ? new Date(s.updatedAt).toLocaleString() : '—'}</td>
                  <td><button className="btn btn-small" onClick={() => selectStrategy(s.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>{selectedId ? `Editing: ${name || '(untitled)'}` : 'New strategy'}</h2>
        <div className="form-row">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="My strategy" />
        </div>
        <div className="form-row">
          <label>Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What this strategy does" />
        </div>
        <div className="form-row">
          <label>Params JSON</label>
          <textarea
            value={paramsJson}
            onChange={(e) => setParamsJson(e.target.value)}
            rows={3}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12 }}
          />
        </div>
        <div className="form-row">
          <label>Strategy source (JavaScript)</label>
          <textarea
            value={sourceJs}
            onChange={(e) => setSourceJs(e.target.value)}
            rows={24}
            spellCheck={false}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, whiteSpace: 'pre' }}
          />
        </div>
        <div className="form-row" style={{ flexDirection: 'row', gap: 8 }}>
          <button className="btn" onClick={onValidate} disabled={busy || !sourceJs}>
            <FiCheckCircle size={14} /> Validate
          </button>
          <button className="btn btn-primary" onClick={onSave} disabled={busy || !sourceJs || !name}>
            <FiSave size={14} /> {selectedId ? 'Update' : 'Save'}
          </button>
          {selectedId && (
            <button className="btn btn-danger" onClick={onDelete} disabled={busy}>
              <FiTrash2 size={14} /> Delete
            </button>
          )}
        </div>

        {validation && (
          <div className={`alert ${validation.ok ? 'alert-info' : 'alert-error'}`} style={{ marginTop: 12 }}>
            {validation.ok ? (
              <>
                <FiCheckCircle /> Compiled OK. Hooks: <code>{validation.hooks.join(', ')}</code>
                {validation.warnings?.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <strong>Warnings:</strong>
                    <ul>{validation.warnings.map((w, i) => <li key={i}><code>{w}</code></li>)}</ul>
                  </div>
                )}
              </>
            ) : (
              <><FiAlertTriangle /> {validation.error}</>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Backtest</h2>
        <div className="form-row">
          <label>Symbol</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={10} />
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
        <div className="form-row">
          <button className="btn btn-primary" onClick={onBacktest} disabled={busy || !sourceJs || !symbol}>
            <FiPlay size={14} /> {busy ? 'Running…' : 'Run backtest'}
          </button>
        </div>

        {backtest && (
          <>
            <div className="hyperopt-grid" style={{ marginTop: 12 }}>
              <Metric label="Total P&L"     value={`$${backtest.totalPnl}`} />
              <Metric label="Return"        value={`${backtest.totalReturn}%`} />
              <Metric label="Trades"        value={backtest.totalTrades} />
              <Metric label="Win rate"      value={`${backtest.winRate}%`} />
              <Metric label="Profit factor" value={backtest.profitFactor} />
              <Metric label="Max DD"        value={`${backtest.maxDrawdown}%`} />
              <Metric label="Sharpe"        value={backtest.sharpe} />
              <Metric label="Final equity"  value={`$${backtest.finalEquity}`} />
            </div>

            {backtest.errors?.length > 0 && (
              <div className="alert alert-error" style={{ marginTop: 12 }}>
                <strong>{backtest.errors.length} hook errors during run.</strong>
                <ul>
                  {backtest.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>bar {e.bar} <code>{e.hook}</code>: {e.error}</li>
                  ))}
                </ul>
                {backtest.errors.length > 5 && <p className="hint">Showing first 5 of {backtest.errors.length}.</p>}
              </div>
            )}

            {backtest.logs?.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary>Console output ({backtest.logs.length} lines)</summary>
                <pre className="code-block">{backtest.logs.join('\n')}</pre>
              </details>
            )}

            {backtest.trades?.length > 0 && (
              <table className="data-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Shares</th>
                    <th>P&L</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {backtest.trades.slice(0, 100).map((t, i) => (
                    <tr key={i}>
                      <td>{new Date(t.entryTime).toLocaleDateString()} @ {Number(t.entryPrice).toFixed(2)}</td>
                      <td>{new Date(t.exitTime).toLocaleDateString()} @ {Number(t.exitPrice).toFixed(2)}</td>
                      <td>{t.shares}</td>
                      <td style={{ color: t.pnl > 0 ? 'var(--positive, #3ecf8e)' : 'var(--negative, #e55353)' }}>
                        {t.pnl > 0 ? '+' : ''}{t.pnl.toFixed(2)}
                      </td>
                      <td>{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {backtest.trades?.length > 100 && (
              <p className="hint">Showing first 100 of {backtest.trades.length} trades.</p>
            )}
          </>
        )}
      </section>
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
