import React, { useEffect, useState } from 'react';
import { FiCpu, FiPlay, FiRefreshCw, FiTrash2 } from 'react-icons/fi';
import {
  getFreqaiSidecarStatus, listFreqaiSidecarModels,
  trainFreqaiSidecar, predictFreqaiSidecar, deleteFreqaiSidecarModel,
} from '../api';

/**
 * FreqAI Python sidecar — optional external service for heavy models.
 *
 * Renders the sidecar status (configured/not), lets the user trigger train +
 * predict proxies, and lists remote models. When FREQAI_PY_URL isn't set the
 * page shows a "not configured" card instead of errors.
 */

export default function FreqaiSidecar() {
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState(null);
  const [err, setErr]       = useState('');
  const [trainForm, setTrainForm] = useState({ symbol: 'SPY', timeframe: '1Day', days: 365, backend: 'xgboost' });
  const [predictForm, setPredictForm] = useState({ modelId: '', symbol: 'SPY', timeframe: '1Day', days: 30 });
  const [trainResult, setTrainResult] = useState(null);
  const [predictResult, setPredictResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setErr('');
    try {
      const s = await getFreqaiSidecarStatus();
      setStatus(s);
      if (s.configured) setModels(await listFreqaiSidecarModels());
    } catch (e) { setErr(e.message); }
  };

  useEffect(() => { refresh(); }, []);

  const onTrain = async () => {
    setBusy(true); setErr('');
    try { setTrainResult(await trainFreqaiSidecar(trainForm)); refresh(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const onPredict = async () => {
    setBusy(true); setErr('');
    try { setPredictResult(await predictFreqaiSidecar(predictForm)); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const onDelete = async (id) => {
    if (!confirm(`Delete model ${id}?`)) return;
    await deleteFreqaiSidecarModel(id).catch((e) => setErr(e.message));
    refresh();
  };

  const setTF = (k) => (e) => setTrainForm((f) => ({ ...f, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));
  const setPF = (k) => (e) => setPredictForm((f) => ({ ...f, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));

  const configured = status?.configured;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiCpu /> FreqAI Python Sidecar</h1>
        <p className="page-subtitle">
          Protocol stub for an optional external Python service. The native
          FreqAI-lite trainer handles logreg / perceptron in pure JS — this
          page targets heavy backends (XGBoost, LightGBM, PyTorch) running in
          a separate process. Set <code>FREQAI_PY_URL</code> to enable.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <div className="card-header-row">
          <h2>Status</h2>
          <button className="btn btn-secondary btn-small" onClick={refresh}><FiRefreshCw size={12} /> Refresh</button>
        </div>
        {!status ? <div className="page-loading">Loading…</div> : configured ? (
          <pre className="code-block">{JSON.stringify(status, null, 2)}</pre>
        ) : (
          <div className="empty-state">
            <p><strong>Not configured.</strong> {status.reason}</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Start your Python service (it must implement the protocol below), then export
              <code> FREQAI_PY_URL=http://localhost:8765</code> before starting this server.
              Optional: set <code>FREQAI_PY_TOKEN</code> for bearer-token auth.
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Endpoints: <code>GET /health</code> · <code>GET /models</code> · <code>DELETE /models/:id</code> · <code>POST /train</code> · <code>POST /predict</code>.
            </p>
          </div>
        )}
      </section>

      {configured && (
        <>
          <section className="card">
            <h2>Train</h2>
            <div className="form-grid">
              <div className="form-row"><label>Symbol</label>
                <input value={trainForm.symbol} onChange={setTF('symbol')} maxLength={10} />
              </div>
              <div className="form-row"><label>Timeframe</label>
                <select value={trainForm.timeframe} onChange={setTF('timeframe')}>
                  {['1Min','5Min','15Min','30Min','1Hour','4Hour','1Day'].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-row"><label>Days</label>
                <input type="number" value={trainForm.days} onChange={setTF('days')} min={30} max={3650} />
              </div>
              <div className="form-row"><label>Backend</label>
                <select value={trainForm.backend} onChange={setTF('backend')}>
                  {['xgboost','lightgbm','catboost','pytorch'].map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={onTrain} disabled={busy}>
                <FiPlay size={14} /> Train
              </button>
            </div>
            {trainResult && <pre className="code-block">{JSON.stringify(trainResult, null, 2)}</pre>}
          </section>

          <section className="card">
            <h2>Models ({models?.items?.length || 0})</h2>
            {!models?.items?.length ? (
              <div className="empty-state">No remote models yet.</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>ID</th><th>Backend</th><th>Metrics</th><th>Trained</th><th></th></tr></thead>
                <tbody>
                  {models.items.map((m) => (
                    <tr key={m.modelId}>
                      <td><code>{m.modelId}</code></td>
                      <td>{m.backend || '—'}</td>
                      <td>{m.metrics ? JSON.stringify(m.metrics) : '—'}</td>
                      <td>{m.trainedAt || '—'}</td>
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={() => onDelete(m.modelId)}>
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
            <h2>Predict</h2>
            <div className="form-grid">
              <div className="form-row"><label>Model ID</label>
                <input value={predictForm.modelId} onChange={setPF('modelId')} placeholder="from list above" />
              </div>
              <div className="form-row"><label>Symbol</label>
                <input value={predictForm.symbol} onChange={setPF('symbol')} maxLength={10} />
              </div>
              <div className="form-row"><label>Timeframe</label>
                <select value={predictForm.timeframe} onChange={setPF('timeframe')}>
                  {['1Min','5Min','15Min','30Min','1Hour','4Hour','1Day'].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-row"><label>Days</label>
                <input type="number" value={predictForm.days} onChange={setPF('days')} min={7} max={365} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={onPredict} disabled={busy || !predictForm.modelId}>
                <FiPlay size={14} /> Predict
              </button>
            </div>
            {predictResult && <pre className="code-block">{JSON.stringify(predictResult, null, 2)}</pre>}
          </section>
        </>
      )}
    </div>
  );
}
