import React, { useEffect, useState } from 'react';
import { FiCheck, FiX, FiRefreshCw, FiShield } from 'react-icons/fi';
import { getProtections } from '../api';

/**
 * Protections — configure safety gates and see per-symbol block state.
 *
 * The page hits /api/protections to fetch the current user's AutoTraderState
 * config + evaluate each configured symbol against the rules. Users configure
 * protections elsewhere (auto-trader config); this page is primarily
 * diagnostic.
 */

export default function Protections() {
  const [data, setData] = useState(null);
  const [err, setErr]   = useState('');
  const [busy, setBusy] = useState(false);
  const [extraSymbols, setExtraSymbols] = useState('');

  const refresh = async () => {
    setBusy(true); setErr('');
    try {
      setData(await getProtections(extraSymbols.trim() || undefined));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiShield /> Protections</h1>
        <p className="page-subtitle">
          Runtime safety gates: stoploss-guard halts trading after repeated losses,
          cooldown prevents re-entry whipsaws, max-drawdown pauses the whole bot
          after a bad run, and low-profit-pairs filters out losing symbols.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <div className="card-header-row">
          <h2>Per-symbol status</h2>
          <button className="btn btn-secondary btn-small" onClick={refresh} disabled={busy}>
            <FiRefreshCw size={12} /> {busy ? 'Checking…' : 'Refresh'}
          </button>
        </div>
        <div className="form-row">
          <label>Extra symbols (comma-separated)</label>
          <input
            placeholder="AAPL,TSLA (optional — otherwise uses auto-trader config)"
            value={extraSymbols}
            onChange={(e) => setExtraSymbols(e.target.value)}
            onBlur={refresh}
          />
        </div>

        {!data ? (
          <div className="page-loading">Loading…</div>
        ) : !data.configured ? (
          <div className="alert alert-info">
            No protections configured. Add a <code>protections</code> block to your
            auto-trader config with any of: <code>stoplossGuard</code>,{' '}
            <code>cooldownPeriod</code>, <code>maxDrawdown</code>, <code>lowProfitPairs</code>.
          </div>
        ) : data.symbols.length === 0 ? (
          <div className="empty-state">No symbols to check — set a symbol universe in the auto-trader.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Symbol</th><th>Status</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {data.symbols.map((s) => (
                <tr key={s.symbol}>
                  <td><strong>{s.symbol}</strong></td>
                  <td>
                    {s.allowed
                      ? <span className="pill pill-ok"><FiCheck size={12} /> allowed</span>
                      : <span className="pill pill-error"><FiX size={12} /> blocked by {s.protection}</span>}
                  </td>
                  <td>{s.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Config reference</h2>
        <p>Add one of these to your auto-trader config's <code>protections</code> object:</p>
        <pre className="code-block">{`{
  "protections": {
    "stoplossGuard":  { "lookbackMinutes": 120, "tradeLimit": 3, "onlyPerPair": true },
    "cooldownPeriod": { "cooldownMinutes": 30 },
    "maxDrawdown":    { "maxDrawdownPct": 0.05, "lookbackMinutes": 1440, "tradeLimit": 10 },
    "lowProfitPairs": { "lookbackMinutes": 1440, "minTrades": 4, "requiredProfit": 0 }
  }
}`}</pre>
      </section>
    </div>
  );
}
