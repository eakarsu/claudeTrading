import React, { useEffect, useState } from 'react';
import { FiDatabase, FiPlus, FiTrash2, FiRefreshCw, FiEye, FiDownload } from 'react-icons/fi';
import {
  listSavedBacktests,
  getSavedBacktest,
  createSavedBacktest,
  deleteSavedBacktest,
  getStrategies,
  downloadSavedBacktestTrades,
  downloadSavedBacktestEquity,
  downloadSavedBacktestNotebook,
} from '../api';

/**
 * Saved Backtests — persist and browse backtest runs instead of re-computing.
 *
 * The POST endpoint runs the backtest server-side and stores the full result
 * blob; the list endpoint omits `result` for speed, so we fetch the detail
 * row on demand when the user opens one.
 */

export default function SavedBacktests() {
  const [strategies, setStrategies] = useState([]);
  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState('');

  // create form
  const [name, setName]             = useState('');
  const [strategyKey, setStrategyKey] = useState('');
  const [symbol, setSymbol]         = useState('SPY');
  const [days, setDays]             = useState(365);
  const [timeframe, setTimeframe]   = useState('1Day');
  const [tags, setTags]             = useState('');
  const [saving, setSaving]         = useState(false);

  // detail
  const [selected, setSelected]     = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try { const r = await listSavedBacktests(); setItems(r.items || []); setErr(''); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    getStrategies()
      .then((r) => {
        const list = r.strategies || r.items || r || [];
        setStrategies(list);
        if (list.length && !strategyKey) setStrategyKey(list[0].key || list[0]);
      })
      .catch(() => {});
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim() || !strategyKey || !symbol.trim()) return;
    setSaving(true); setErr('');
    try {
      await createSavedBacktest({
        name: name.trim(),
        strategyKey,
        symbol: symbol.toUpperCase(),
        days: Number(days),
        timeframe,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setName(''); setTags('');
      refresh();
    } catch (e2) { setErr(e2.message); }
    finally { setSaving(false); }
  };

  const handleView = async (id) => {
    setLoadingDetail(true);
    try { setSelected(await getSavedBacktest(id)); }
    catch (e) { setErr(e.message); }
    finally { setLoadingDetail(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this saved backtest?')) return;
    try {
      await deleteSavedBacktest(id);
      if (selected?.id === id) setSelected(null);
      refresh();
    } catch (e) { alert(`Delete failed: ${e.message}`); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiDatabase /> Saved Backtests</h1>
        <p className="page-subtitle">
          Persist backtest runs so you can compare strategies + parameter choices across
          sessions without re-computing. Each row stores the full result blob.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>New run</h2>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="SPY MACD — Q1 2026" maxLength={120} required />
          </div>
          <div className="form-row">
            <label>Strategy</label>
            <select value={strategyKey} onChange={(e) => setStrategyKey(e.target.value)} required>
              {strategies.map((s) => {
                const k = s.key || s;
                return <option key={k} value={k}>{s.name ? `${s.name} (${k})` : k}</option>;
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
          <div className="form-row">
            <label>Tags (comma-separated, optional)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="baseline,q1-2026" />
          </div>
          <div className="form-row">
            <button type="submit" className="btn btn-primary" disabled={saving || !strategyKey}>
              <FiPlus size={14} /> {saving ? 'Running…' : 'Run + save'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Saved ({items.length})</h2>
          <button className="btn btn-secondary btn-small" onClick={refresh} disabled={loading}>
            <FiRefreshCw size={12} /> Refresh
          </button>
        </div>
        {loading ? (
          <div className="page-loading">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">No saved backtests yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Strategy</th>
                <th>Symbol</th>
                <th>Timeframe</th>
                <th>Days</th>
                <th>Tags</th>
                <th>Saved</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td><strong>{it.name}</strong></td>
                  <td><code>{it.strategyKey}</code></td>
                  <td>{it.symbol}</td>
                  <td>{it.timeframe}</td>
                  <td>{it.days}</td>
                  <td>{(it.tags || []).join(', ') || '—'}</td>
                  <td>{it.createdAt ? new Date(it.createdAt).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn btn-secondary btn-small" onClick={() => handleView(it.id)}>
                      <FiEye size={12} /> View
                    </button>{' '}
                    <button className="btn btn-danger btn-small" onClick={() => handleDelete(it.id)}>
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
          <div className="card-header-row">
            <h2>{selected.name}</h2>
            <button className="btn btn-secondary btn-small" onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="form-row" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-small" onClick={() => downloadSavedBacktestTrades(selected.id).catch((e) => setErr(e.message))}>
              <FiDownload size={12} /> trades.csv
            </button>
            <button className="btn btn-secondary btn-small" onClick={() => downloadSavedBacktestEquity(selected.id).catch((e) => setErr(e.message))}>
              <FiDownload size={12} /> equity.csv
            </button>
            <button className="btn btn-secondary btn-small" onClick={() => downloadSavedBacktestNotebook(selected.id).catch((e) => setErr(e.message))}>
              <FiDownload size={12} /> analysis.ipynb
            </button>
          </div>
          {loadingDetail ? (
            <div className="page-loading">Loading…</div>
          ) : (
            <pre className="code-block">{JSON.stringify(selected.result, null, 2)}</pre>
          )}
        </section>
      )}
    </div>
  );
}
