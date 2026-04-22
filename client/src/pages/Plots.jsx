import React, { useEffect, useState } from 'react';
import { FiBarChart2, FiPlay } from 'react-icons/fi';
import EquityCurveChart from '../components/EquityCurveChart';
import DrawdownChart from '../components/DrawdownChart';
import { getPlotEquity, getPlotTrades, getStrategies } from '../api';

/**
 * Plots — renders backtest-derived chart series (equity curve, drawdown,
 * trade markers) using the existing EquityCurveChart / DrawdownChart
 * components. Freqtrade's `plot-dataframe` / `plot-profit` equivalents.
 *
 * DrawdownChart derives drawdown from the equity curve itself, so we only
 * fetch /plots/equity for the two curves. Trade markers come from /plots/trades.
 */

export default function Plots() {
  const [strategies, setStrategies] = useState([]);
  const [strategyKey, setStrategyKey] = useState('');
  const [symbol, setSymbol] = useState('SPY');
  const [days, setDays] = useState(365);
  const [timeframe, setTimeframe] = useState('1Day');
  const [equity, setEquity] = useState(null);
  const [trades, setTrades] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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

  const run = async (e) => {
    e.preventDefault();
    if (!strategyKey || !symbol) return;
    setBusy(true); setErr(''); setEquity(null); setTrades(null);
    try {
      const params = { strategyKey, symbol: symbol.toUpperCase(), days: Number(days), timeframe };
      const [eq, tr] = await Promise.all([
        getPlotEquity(params),
        getPlotTrades(params),
      ]);
      setEquity(eq.curve || []);
      setTrades(tr);
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiBarChart2 /> Plots</h1>
        <p className="page-subtitle">
          Chart-ready views derived from a backtest: equity curve, underwater drawdown,
          and trade markers. Freqtrade's <code>plot-dataframe</code> / <code>plot-profit</code> equivalents.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>Parameters</h2>
        <form onSubmit={run}>
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
            <button type="submit" className="btn btn-primary" disabled={busy || !strategyKey}>
              <FiPlay size={14} /> {busy ? 'Running…' : 'Plot'}
            </button>
          </div>
        </form>
      </section>

      {equity && equity.length > 0 && (
        <>
          <section className="card">
            <h2>Equity curve</h2>
            <EquityCurveChart data={equity} height={260} />
          </section>
          <section className="card">
            <h2>Drawdown (underwater)</h2>
            <DrawdownChart data={equity} height={200} />
          </section>
        </>
      )}

      {trades?.markers?.length > 0 && (
        <section className="card">
          <h2>Trade markers ({Math.floor(trades.markers.length / 2)} trades)</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Side</th>
                <th>Price</th>
                <th>P&amp;L</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {trades.markers.slice(0, 200).map((m, i) => (
                <tr key={i}>
                  <td>{m.time ? new Date(m.time).toLocaleString() : '—'}</td>
                  <td>
                    <span className={`pill ${m.side === 'buy' ? 'pill-ok' : 'pill-error'}`}>
                      {m.side}
                    </span>
                  </td>
                  <td>{Number(m.price).toFixed(2)}</td>
                  <td>{m.pnl != null ? Number(m.pnl).toFixed(2) : '—'}</td>
                  <td>{m.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {trades.markers.length > 200 && (
            <p className="hint">Showing first 200 markers of {trades.markers.length}.</p>
          )}
        </section>
      )}
    </div>
  );
}
