import React, { useEffect, useState } from 'react';
import { FiTrendingUp, FiPlay } from 'react-icons/fi';
import { calcLeverage, listLeverageTrades } from '../api';

/**
 * Leverage / Margin — one-off liquidation calculator + leveraged-trade audit.
 *
 * Covers freqtrade's leverage/margin_mode/liquidation_price/funding_fees fields
 * without attempting to be a real margin engine. Formulas live in
 * services/leverage.js (isolated-margin approximation, 0.5% maintenance).
 */

export default function Leverage() {
  const [entry, setEntry] = useState(100);
  const [qty, setQty] = useState(10);
  const [leverage, setLeverage] = useState(5);
  const [side, setSide] = useState('long');
  const [marginMode, setMarginMode] = useState('isolated');
  const [current, setCurrent] = useState('');
  const [result, setResult] = useState(null);
  const [trades, setTrades] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listLeverageTrades().then((r) => setTrades(r.items || [])).catch(() => {});
  }, []);

  const calc = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = { entry: Number(entry), qty: Number(qty), leverage: Number(leverage), side, marginMode };
      if (current !== '') body.current = Number(current);
      const r = await calcLeverage(body);
      setResult(r);
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiTrendingUp /> Leverage & Margin</h1>
        <p className="page-subtitle">
          Liquidation-price calculator and a view of past leveraged trades. Uses
          the isolated-margin approximation with a 0.5% maintenance-margin
          default — not a substitute for the exchange's real margin engine.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>Calculator</h2>
        <form onSubmit={calc}>
          <div className="form-row">
            <label>Entry price</label>
            <input type="number" step="0.01" value={entry} onChange={(e) => setEntry(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Quantity</label>
            <input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Leverage</label>
            <input type="number" min="1" max="125" step="0.5" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Side</label>
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="long">long</option>
              <option value="short">short</option>
            </select>
          </div>
          <div className="form-row">
            <label>Margin mode</label>
            <select value={marginMode} onChange={(e) => setMarginMode(e.target.value)}>
              <option value="spot">spot (cash)</option>
              <option value="isolated">isolated</option>
              <option value="cross">cross</option>
            </select>
          </div>
          <div className="form-row">
            <label>Current price (optional)</label>
            <input type="number" step="0.01" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="form-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              <FiPlay size={14} /> {busy ? 'Calculating…' : 'Calculate'}
            </button>
          </div>
        </form>

        {result && (
          <div className="hyperopt-grid" style={{ marginTop: 12 }}>
            <Metric label="Liquidation price" value={fmt(result.liquidationPrice, '$')} />
            <Metric label="Margin required"   value={fmt(result.marginRequired, '$')} />
            <Metric label="Unrealized P&L %"
              value={result.unrealizedPnlPct != null ? `${(result.unrealizedPnlPct * 100).toFixed(2)}%` : '—'} />
            <Metric label="Liquidated?"
              value={result.liquidated == null ? '—' : result.liquidated ? 'YES' : 'no'}
              highlight={result.liquidated === true} />
          </div>
        )}
      </section>

      <section className="card">
        <h2>Leveraged trades ({trades.filter((t) => t.leverage > 1).length})</h2>
        {trades.length === 0 ? (
          <div className="empty-state">No auto-trader trades recorded.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Entry</th>
                <th>Qty</th>
                <th>Lev</th>
                <th>Margin</th>
                <th>Liq</th>
                <th>Mode</th>
                <th>Funding</th>
                <th>P&L</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 100).map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.symbol}</strong></td>
                  <td>
                    <span className={`pill ${t.action === 'buy' ? 'pill-ok' : 'pill-error'}`}>{t.action}</span>
                  </td>
                  <td>{fmt(t.price, '$')}</td>
                  <td>{t.qty}</td>
                  <td>{t.leverage}x</td>
                  <td>{fmt(t.marginRequired, '$')}</td>
                  <td>{fmt(t.liquidationPrice, '$')}</td>
                  <td>{t.marginMode || '—'}</td>
                  <td>{fmt(t.fundingFees, '$')}</td>
                  <td>{fmt(t.pnl, '$')}</td>
                  <td>{t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function fmt(v, prefix = '') {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${prefix}${Number(v).toFixed(2)}`;
}

function Metric({ label, value, highlight }) {
  return (
    <div style={{
      padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)',
      background: highlight ? 'rgba(229, 83, 83, 0.12)' : 'var(--bg-secondary, transparent)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}
