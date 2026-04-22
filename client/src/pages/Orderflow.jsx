import React, { useEffect, useRef, useState } from 'react';
import { FiActivity, FiPlay, FiPause, FiRefreshCw } from 'react-icons/fi';
import { getOrderflowTrades, getOrderflowImbalance } from '../api';

/**
 * Orderflow — recent trade tape + L1-inferred buy/sell imbalance.
 *
 * Alpaca equities doesn't expose L2 depth, so "imbalance" here is derived
 * by classifying each trade against the latest quote:
 *   price ≥ ask → buy · price ≤ bid → sell · in between → mid.
 * Good enough for a pressure proxy, not a real depth reading.
 */

export default function Orderflow() {
  const [symbol, setSymbol] = useState('SPY');
  const [limit, setLimit] = useState(100);
  const [streaming, setStreaming] = useState(false);
  const [trades, setTrades] = useState([]);
  const [meta, setMeta] = useState({ bid: null, ask: null });
  const [imb, setImb] = useState(null);
  const [err, setErr] = useState('');
  const pollRef = useRef(null);

  const refresh = async () => {
    setErr('');
    try {
      const [t, i] = await Promise.all([
        getOrderflowTrades(symbol, limit),
        getOrderflowImbalance(symbol, limit),
      ]);
      setTrades(t.trades || []);
      setMeta({ bid: t.bid, ask: t.ask });
      setImb(i);
    } catch (e) { setErr(e.message); }
  };

  useEffect(() => {
    if (streaming) {
      refresh();
      pollRef.current = setInterval(refresh, 5000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, symbol, limit]);

  const pct = (v) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiActivity /> Orderflow</h1>
        <p className="page-subtitle">
          Recent trade tape with buy/sell side inferred from the latest L1
          quote. Imbalance = (buyVol − sellVol) / totalVol over the last N trades.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>Controls</h2>
        <div className="form-row"><label>Symbol</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={10} />
        </div>
        <div className="form-row"><label>Trades to fetch</label>
          <input type="number" min={10} max={1000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        </div>
        <div className="form-row" style={{ flexDirection: 'row', gap: 8 }}>
          <button className="btn" onClick={refresh}><FiRefreshCw size={14} /> Refresh</button>
          <button className={`btn ${streaming ? 'btn-danger' : 'btn-primary'}`} onClick={() => setStreaming((s) => !s)}>
            {streaming ? <><FiPause size={14} /> Stop</> : <><FiPlay size={14} /> Stream (5s)</>}
          </button>
        </div>
      </section>

      {imb && (
        <section className="card">
          <h2>Imbalance — {imb.bias}</h2>
          <div className="hyperopt-grid">
            <Metric label="Bid"   value={meta.bid != null ? `$${meta.bid}` : '—'} />
            <Metric label="Ask"   value={meta.ask != null ? `$${meta.ask}` : '—'} />
            <Metric label="Buy vol"  value={imb.buyVolume} />
            <Metric label="Sell vol" value={imb.sellVolume} />
            <Metric label="Mid vol"  value={imb.midVolume} />
            <Metric label="Imbalance" value={pct(imb.imbalance)}
              highlight={imb.bias !== 'balanced'} />
          </div>
          <div style={{ marginTop: 12, background: 'var(--bg-secondary, transparent)', border: '1px solid var(--border)', height: 16, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: '50%',
              width: `${Math.min(50, Math.abs(imb.imbalance) * 50)}%`,
              transform: imb.imbalance >= 0 ? 'translateX(0)' : 'translateX(-100%)',
              background: imb.imbalance >= 0 ? 'var(--positive, #3ecf8e)' : 'var(--negative, #e55353)',
            }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'var(--text-muted)' }} />
          </div>
        </section>
      )}

      <section className="card">
        <h2>Tape ({trades.length})</h2>
        {trades.length === 0 ? (
          <div className="empty-state">No trades yet. Hit Refresh or Stream.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Price</th>
                <th>Size</th>
                <th>Side</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 200).map((t, i) => (
                <tr key={`${t.time}-${i}`}>
                  <td>{new Date(t.time).toLocaleTimeString()}</td>
                  <td>${Number(t.price).toFixed(4)}</td>
                  <td>{t.size}</td>
                  <td>
                    <span className={`pill ${t.side === 'buy' ? 'pill-ok' : t.side === 'sell' ? 'pill-error' : ''}`}>
                      {t.side}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {trades.length > 200 && <p className="hint">Showing first 200 of {trades.length}.</p>}
      </section>
    </div>
  );
}

function Metric({ label, value, highlight }) {
  return (
    <div style={{
      padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)',
      background: highlight ? 'rgba(62, 207, 142, 0.08)' : 'var(--bg-secondary, transparent)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}
