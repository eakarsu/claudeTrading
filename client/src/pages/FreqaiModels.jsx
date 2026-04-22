import React, { useEffect, useState } from 'react';
import { FiCpu, FiPlay, FiTrash2, FiRefreshCw, FiSave } from 'react-icons/fi';
import { listAiModels, saveAiModel, deleteAiModel, walkForwardAiModel } from '../api';

/**
 * FreqAI Models — train + persist next-bar-direction classifiers, browse
 * saved models, and run walk-forward retraining over history.
 *
 * "Lite" because the backend uses pure-JS logistic regression / perceptron;
 * there's no XGBoost/PyTorch backend here. Good enough to validate the
 * pipeline; swap the trainer if you want heavier models.
 */

export default function FreqaiModels() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // train form
  const [symbol, setSymbol]       = useState('SPY');
  const [days, setDays]           = useState(730);
  const [timeframe, setTimeframe] = useState('1Day');
  const [modelType, setModelType] = useState('logreg');
  const [oosRatio, setOosRatio]   = useState(0.3);
  const [saving, setSaving]       = useState(false);

  // walk-forward
  const [wfSymbol, setWfSymbol]     = useState('SPY');
  const [wfDays, setWfDays]         = useState(730);
  const [trainSize, setTrainSize]   = useState(250);
  const [testSize, setTestSize]     = useState(50);
  const [wfBusy, setWfBusy]         = useState(false);
  const [wfResult, setWfResult]     = useState(null);

  const refresh = async () => {
    setLoading(true);
    try { const r = await listAiModels(); setItems(r.items || []); setErr(''); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const handleTrain = async (e) => {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await saveAiModel({
        symbol: symbol.toUpperCase(),
        days: Number(days),
        timeframe,
        modelType,
        oosRatio: Number(oosRatio),
      });
      refresh();
    } catch (e2) { setErr(e2.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this saved model?')) return;
    try { await deleteAiModel(id); refresh(); }
    catch (e) { alert(`Delete failed: ${e.message}`); }
  };

  const handleWalkForward = async (e) => {
    e.preventDefault();
    setWfBusy(true); setWfResult(null); setErr('');
    try {
      setWfResult(await walkForwardAiModel({
        symbol: wfSymbol.toUpperCase(),
        days: Number(wfDays),
        timeframe,
        trainSize: Number(trainSize),
        testSize: Number(testSize),
        modelType,
      }));
    } catch (e2) { setErr(e2.message); }
    finally { setWfBusy(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiCpu /> FreqAI Models</h1>
        <p className="page-subtitle">
          Train + persist next-bar direction classifiers (logistic regression, perceptron)
          and retrain them walk-forward over history. Pure-JS trainer — not freqtrade's
          XGBoost backend, but the same pipeline shape.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>Train + save a model</h2>
        <form onSubmit={handleTrain}>
          <div className="form-row">
            <label>Symbol</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={10} required />
          </div>
          <div className="form-row">
            <label>Days of history</label>
            <input type="number" min={120} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Timeframe</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              <option value="1Day">1 day</option>
              <option value="1Hour">1 hour</option>
            </select>
          </div>
          <div className="form-row">
            <label>Model type</label>
            <select value={modelType} onChange={(e) => setModelType(e.target.value)}>
              <option value="logreg">Logistic regression</option>
              <option value="perceptron">Perceptron</option>
            </select>
          </div>
          <div className="form-row">
            <label>OOS ratio (held-out fraction)</label>
            <input type="number" step="0.05" min={0.1} max={0.5} value={oosRatio} onChange={(e) => setOosRatio(e.target.value)} />
          </div>
          <div className="form-row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <FiSave size={14} /> {saving ? 'Training…' : 'Train + save'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Saved models ({items.length})</h2>
          <button className="btn btn-secondary btn-small" onClick={refresh} disabled={loading}>
            <FiRefreshCw size={12} /> Refresh
          </button>
        </div>
        {loading ? (
          <div className="page-loading">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">No saved models yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Timeframe</th>
                <th>Type</th>
                <th>Train samples</th>
                <th>Train acc</th>
                <th>OOS samples</th>
                <th>OOS acc</th>
                <th>Trained</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.symbol}</strong></td>
                  <td>{m.timeframe}</td>
                  <td><code>{m.modelType}</code></td>
                  <td>{m.trainSamples ?? '—'}</td>
                  <td>{m.trainAccuracy != null ? `${(m.trainAccuracy * 100).toFixed(1)}%` : '—'}</td>
                  <td>{m.oosSamples ?? '—'}</td>
                  <td>{m.oosAccuracy != null ? `${(m.oosAccuracy * 100).toFixed(1)}%` : '—'}</td>
                  <td>{m.trainedAt ? new Date(m.trainedAt).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn btn-danger btn-small" onClick={() => handleDelete(m.id)}>
                      <FiTrash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Walk-forward retraining</h2>
        <p className="hint">
          Slides a training window forward through history, retraining at each step and
          evaluating on the next <code>testSize</code> bars. Returns per-window OOS accuracy
          so you can see if the model's edge holds up across regimes.
        </p>
        <form onSubmit={handleWalkForward}>
          <div className="form-row">
            <label>Symbol</label>
            <input value={wfSymbol} onChange={(e) => setWfSymbol(e.target.value)} maxLength={10} required />
          </div>
          <div className="form-row">
            <label>Days of history</label>
            <input type="number" min={120} max={3650} value={wfDays} onChange={(e) => setWfDays(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Train window (bars)</label>
            <input type="number" min={50} max={2000} value={trainSize} onChange={(e) => setTrainSize(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Test window (bars)</label>
            <input type="number" min={10} max={500} value={testSize} onChange={(e) => setTestSize(e.target.value)} />
          </div>
          <div className="form-row">
            <button type="submit" className="btn btn-primary" disabled={wfBusy}>
              <FiPlay size={14} /> {wfBusy ? 'Running…' : 'Run walk-forward'}
            </button>
          </div>
        </form>

        {wfResult && (
          <>
            <p style={{ marginTop: 14 }}>
              <strong>Mean OOS accuracy:</strong>{' '}
              {wfResult.meanOosAccuracy != null
                ? `${(wfResult.meanOosAccuracy * 100).toFixed(2)}%`
                : '—'}
              {' '}·{' '}
              <strong>Windows:</strong> {wfResult.windows?.length || 0}
            </p>
            {wfResult.windows?.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Train start</th>
                    <th>Train end</th>
                    <th>Test end</th>
                    <th>Train acc</th>
                    <th>OOS acc</th>
                    <th>OOS samples</th>
                  </tr>
                </thead>
                <tbody>
                  {wfResult.windows.map((w, i) => (
                    <tr key={i}>
                      <td>{w.start ? new Date(w.start).toLocaleDateString() : '—'}</td>
                      <td>{w.trainEnd ? new Date(w.trainEnd).toLocaleDateString() : '—'}</td>
                      <td>{w.testEnd ? new Date(w.testEnd).toLocaleDateString() : '—'}</td>
                      <td>{w.trainAccuracy != null ? `${(w.trainAccuracy * 100).toFixed(1)}%` : '—'}</td>
                      <td>{w.oosAccuracy != null ? `${(w.oosAccuracy * 100).toFixed(1)}%` : '—'}</td>
                      <td>{w.oosSamples ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </div>
  );
}
