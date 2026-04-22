import React, { useEffect, useRef, useState } from 'react';
import { FiRadio, FiSend, FiRefreshCw, FiPause, FiPlay } from 'react-icons/fi';
import { publishProducerSignal, pollConsumerSignals } from '../api';

/**
 * Producer / Consumer — published-signal feed viewer.
 *
 * Producers (bot instances) POST to /producer/:id; consumers poll
 * /consumer/:id with `sinceId` to stream forward. This page lets you:
 *   • publish a test signal from the UI (handy for integration tests)
 *   • subscribe to a producer feed and watch signals arrive live
 *
 * Signals have TTL — expired rows are filtered server-side.
 */

export default function ProducerConsumer() {
  // Publish form
  const [pubProducerId, setPubProducerId] = useState('bot-1');
  const [pubSymbol, setPubSymbol]         = useState('SPY');
  const [pubAction, setPubAction]         = useState('buy');
  const [pubPrice, setPubPrice]           = useState('');
  const [pubStrategy, setPubStrategy]     = useState('macd_crossover');
  const [pubTtl, setPubTtl]               = useState(3600);
  const [publishing, setPublishing]       = useState(false);

  // Subscribe
  const [subProducerId, setSubProducerId] = useState('bot-1');
  const [streaming, setStreaming]         = useState(false);
  const [signals, setSignals]             = useState([]);
  const [lastId, setLastId]               = useState(0);
  const [err, setErr]                     = useState('');
  const pollRef = useRef(null);

  const pollOnce = async () => {
    try {
      const r = await pollConsumerSignals(subProducerId, lastId);
      if (r.items?.length) {
        setSignals((prev) => [...r.items, ...prev].slice(0, 500));
      }
      if (r.lastId != null && r.lastId > lastId) setLastId(r.lastId);
      setErr('');
    } catch (e) { setErr(e.message); }
  };

  useEffect(() => {
    if (streaming) {
      pollOnce();
      pollRef.current = setInterval(pollOnce, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, subProducerId]);

  const handlePublish = async (e) => {
    e.preventDefault();
    setPublishing(true); setErr('');
    try {
      await publishProducerSignal(pubProducerId, {
        symbol: pubSymbol.toUpperCase(),
        action: pubAction,
        price: pubPrice === '' ? null : Number(pubPrice),
        strategy: pubStrategy || null,
        ttlSeconds: Number(pubTtl),
      });
    } catch (e2) { setErr(e2.message); }
    finally { setPublishing(false); }
  };

  const resetFeed = () => { setSignals([]); setLastId(0); };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiRadio /> Producer / Consumer</h1>
        <p className="page-subtitle">
          Bot-to-bot signal relay. A producer instance publishes signals under a named
          channel; consumers poll by <code>producerId</code> to stream them forward.
          DB-backed so producers and consumers don't need to share a process.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>Publish a signal</h2>
        <form onSubmit={handlePublish}>
          <div className="form-row">
            <label>Producer ID</label>
            <input value={pubProducerId} onChange={(e) => setPubProducerId(e.target.value)} maxLength={64} required />
          </div>
          <div className="form-row">
            <label>Symbol</label>
            <input value={pubSymbol} onChange={(e) => setPubSymbol(e.target.value)} maxLength={10} required />
          </div>
          <div className="form-row">
            <label>Action</label>
            <select value={pubAction} onChange={(e) => setPubAction(e.target.value)}>
              <option value="buy">buy</option>
              <option value="sell">sell</option>
              <option value="hold">hold</option>
            </select>
          </div>
          <div className="form-row">
            <label>Price (optional)</label>
            <input type="number" step="0.01" value={pubPrice} onChange={(e) => setPubPrice(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Strategy (optional)</label>
            <input value={pubStrategy} onChange={(e) => setPubStrategy(e.target.value)} />
          </div>
          <div className="form-row">
            <label>TTL (seconds)</label>
            <input type="number" min={10} max={86400} value={pubTtl} onChange={(e) => setPubTtl(e.target.value)} />
          </div>
          <div className="form-row">
            <button type="submit" className="btn btn-primary" disabled={publishing}>
              <FiSend size={14} /> {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Subscribe</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn btn-small ${streaming ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => setStreaming((s) => !s)}
            >
              {streaming ? <><FiPause size={12} /> Stop</> : <><FiPlay size={12} /> Start polling</>}
            </button>
            <button className="btn btn-secondary btn-small" onClick={resetFeed}>
              <FiRefreshCw size={12} /> Clear
            </button>
          </div>
        </div>
        <div className="form-row">
          <label>Producer ID to subscribe to</label>
          <input
            value={subProducerId}
            onChange={(e) => { setSubProducerId(e.target.value); resetFeed(); }}
            maxLength={64}
          />
        </div>
        <p className="hint">
          Polls every 3s while streaming is on. Filters by <code>sinceId</code> so each tick
          only fetches new signals. Expired signals (past TTL) are dropped server-side.
        </p>

        {signals.length === 0 ? (
          <div className="empty-state">No signals received yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Symbol</th>
                <th>Action</th>
                <th>Price</th>
                <th>Strategy</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id}>
                  <td><code>{s.id}</code></td>
                  <td>{s.createdAt ? new Date(s.createdAt).toLocaleString() : '—'}</td>
                  <td><strong>{s.symbol}</strong></td>
                  <td>
                    <span className={`pill ${s.action === 'buy' ? 'pill-ok' : s.action === 'sell' ? 'pill-error' : ''}`}>
                      {s.action}
                    </span>
                  </td>
                  <td>{s.price != null ? Number(s.price).toFixed(2) : '—'}</td>
                  <td><code>{s.strategy || '—'}</code></td>
                  <td>{s.expiresAt ? new Date(s.expiresAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
