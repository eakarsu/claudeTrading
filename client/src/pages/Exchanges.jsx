import React, { useEffect, useState } from 'react';
import { FiGlobe, FiRefreshCw, FiCheck, FiX } from 'react-icons/fi';
import { listExchanges } from '../api';

/**
 * Exchanges — read-only registry of adapters configured on the server.
 *
 * Alpaca is always present; CCXT-backed adapters (binance/coinbase/kraken)
 * show up only when their API-key env vars are set. Writes + order routing
 * aren't exposed in the UI yet — this page is for visibility.
 */

const flagKeys = ['bars', 'quote', 'positions', 'placeOrder', 'cancelOrder'];

function Flag({ on }) {
  return on
    ? <span className="pill pill-ok"><FiCheck size={10} /> yes</span>
    : <span className="pill pill-error"><FiX size={10} /> no</span>;
}

export default function Exchanges() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const refresh = async () => {
    setLoading(true);
    try { const r = await listExchanges(); setItems(r.exchanges || r.items || []); setErr(''); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiGlobe /> Exchanges</h1>
        <p className="page-subtitle">
          Registered exchange adapters. Alpaca is the stock broker; CCXT-backed
          crypto venues appear when their <code>${'{ID}'}_API_KEY</code> /
          <code>${'{ID}'}_SECRET</code> env vars are configured on the server.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <div className="card-header-row">
          <h2>Registered adapters ({items.length})</h2>
          <button className="btn btn-secondary btn-small" onClick={refresh} disabled={loading}>
            <FiRefreshCw size={12} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="page-loading">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">No adapters registered.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Kind</th>
                {flagKeys.map((k) => <th key={k}>{k}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td><code>{e.id}</code></td>
                  <td><strong>{e.name}</strong></td>
                  <td>{e.kind || '—'}</td>
                  {flagKeys.map((k) => (
                    <td key={k}><Flag on={!!e.supports?.[k]} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
