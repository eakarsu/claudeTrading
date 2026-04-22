import React, { useEffect, useState } from 'react';
import { FiSliders, FiPlay, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import { listHyperoptLosses, validateHyperoptLoss, runAdvancedHyperopt, getStrategies } from '../api';

/**
 * Advanced Hyperopt — ROI table + trailing-stop + indicator-space sampling
 * with a selectable loss function (built-in or custom JS).
 *
 * This is the freqtrade `hyperopt.md` UX: four spaces × N loss functions.
 * The runner itself is synchronous and capped to budget ≤ 500 samples —
 * use the existing /hyperopt (grid / Bayesian background) page for very
 * long optimization runs.
 */

const DEFAULT_EXEC = JSON.stringify({
  stopLossPct:   { min: 0.01, max: 0.10, type: 'float', steps: 10 },
  takeProfitPct: { min: 0.02, max: 0.20, type: 'float', steps: 10 },
}, null, 2);

const DEFAULT_ROI = JSON.stringify({
  timesteps: [0, 30, 60, 120, 240],
  targets:   { min: 0.005, max: 0.08, steps: 8 },
}, null, 2);

const DEFAULT_TRAILING = JSON.stringify({
  stop:            { min: 0.01, max: 0.05 },
  offset:          { min: 0,    max: 0.03 },
  offsetIsEnabled: [false, true],
}, null, 2);

const DEFAULT_INDICATORS = JSON.stringify({
  rsiBuyThreshold:  { min: 20, max: 40, type: 'int' },
  rsiSellThreshold: { min: 60, max: 80, type: 'int' },
}, null, 2);

const DEFAULT_CUSTOM_LOSS = `// Return a number — lower = better. ctx has: result, trades, equityCurve, params.
// Example: prefer high Sharpe but penalize deep drawdowns.
return -(ctx.result.sharpe ?? 0) + (ctx.result.maxDrawdown ?? 0) * 0.1;`;

export default function HyperoptAdvanced() {
  const [strategies, setStrategies] = useState([]);
  const [strategyKey, setStrategyKey] = useState('');
  const [symbol, setSymbol] = useState('SPY');
  const [days, setDays] = useState(365);
  const [timeframe, setTimeframe] = useState('1Day');
  const [budget, setBudget] = useState(40);

  const [lossNames, setLossNames] = useState([]);
  const [lossMode, setLossMode] = useState('builtin');    // 'builtin' | 'custom'
  const [lossName, setLossName] = useState('SharpeHyperOptLoss');
  const [customLoss, setCustomLoss] = useState(DEFAULT_CUSTOM_LOSS);
  const [lossCheck, setLossCheck] = useState(null);

  const [useExec, setUseExec] = useState(true);
  const [useRoi, setUseRoi] = useState(false);
  const [useTrailing, setUseTrailing] = useState(false);
  const [useIndicators, setUseIndicators] = useState(false);
  const [execText, setExecText] = useState(DEFAULT_EXEC);
  const [roiText, setRoiText] = useState(DEFAULT_ROI);
  const [trailingText, setTrailingText] = useState(DEFAULT_TRAILING);
  const [indicatorsText, setIndicatorsText] = useState(DEFAULT_INDICATORS);

  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getStrategies().then((r) => {
      const items = r.strategies || r.items || r || [];
      setStrategies(items);
      if (items.length && !strategyKey) setStrategyKey(items[0].key || items[0]);
    }).catch(() => {});
    listHyperoptLosses().then((r) => setLossNames(r.names || [])).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parse = (text, label) => {
    try { return JSON.parse(text); }
    catch (e) { throw new Error(`${label} is not valid JSON: ${e.message}`); }
  };

  const onValidateLoss = async () => {
    setLossCheck(null);
    try {
      const r = await validateHyperoptLoss(customLoss);
      setLossCheck(r);
    } catch (e) { setLossCheck({ ok: false, error: e.message }); }
  };

  const onRun = async () => {
    setErr(''); setResult(null); setBusy(true);
    try {
      const body = {
        strategyKey, symbol: symbol.toUpperCase(), days: Number(days), timeframe,
        budget: Number(budget),
      };
      if (lossMode === 'builtin') body.lossName = lossName;
      else body.customLossBody = customLoss;

      if (useExec)       body.execSpace       = parse(execText, 'Exec space');
      if (useRoi)        body.roiSpace        = parse(roiText, 'ROI space');
      if (useTrailing)   body.trailingSpace   = parse(trailingText, 'Trailing space');
      if (useIndicators) body.indicatorSpace  = parse(indicatorsText, 'Indicator space');

      const r = await runAdvancedHyperopt(body);
      setResult(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiSliders /> Advanced Hyperopt</h1>
        <p className="page-subtitle">
          Random-sample optimization over ROI table, trailing stop, indicator
          thresholds, and execution params — scored by a built-in or custom
          loss function. Parity with freqtrade's <code>hyperopt.md</code>{' '}
          surface. For long (~1000+ sample) runs use the grid/Bayesian page.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <h2>Strategy & data</h2>
        <div className="form-row">
          <label>Strategy</label>
          <select value={strategyKey} onChange={(e) => setStrategyKey(e.target.value)}>
            {strategies.map((s) => {
              const k = s.key || s;
              return <option key={k} value={k}>{s.name ? `${s.name} (${k})` : k}</option>;
            })}
          </select>
        </div>
        <div className="form-row"><label>Symbol</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={10} />
        </div>
        <div className="form-row"><label>Days</label>
          <input type="number" min={30} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <div className="form-row"><label>Timeframe</label>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            <option>1Day</option><option>1Hour</option><option>15Min</option><option>5Min</option>
          </select>
        </div>
        <div className="form-row"><label>Budget (samples)</label>
          <input type="number" min={1} max={500} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
      </section>

      <section className="card">
        <h2>Loss function</h2>
        <div className="form-row"><label>Mode</label>
          <select value={lossMode} onChange={(e) => setLossMode(e.target.value)}>
            <option value="builtin">Built-in</option>
            <option value="custom">Custom JS</option>
          </select>
        </div>
        {lossMode === 'builtin' ? (
          <div className="form-row"><label>Name</label>
            <select value={lossName} onChange={(e) => setLossName(e.target.value)}>
              {lossNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        ) : (
          <>
            <div className="form-row"><label>Body</label>
              <textarea
                value={customLoss} onChange={(e) => setCustomLoss(e.target.value)}
                rows={6} spellCheck={false}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12 }}
              />
            </div>
            <div className="form-row">
              <button className="btn" onClick={onValidateLoss}><FiCheckCircle size={14} /> Validate</button>
            </div>
            {lossCheck && (
              <div className={`alert ${lossCheck.ok ? 'alert-info' : 'alert-error'}`}>
                {lossCheck.ok
                  ? <><FiCheckCircle /> Loss fn compiles OK</>
                  : <><FiAlertTriangle /> {lossCheck.error}</>}
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Spaces</h2>
        <SpaceBlock
          label="Exec space (stopLoss / takeProfit / slippage)"
          enabled={useExec} onToggle={setUseExec}
          value={execText} onChange={setExecText}
        />
        <SpaceBlock
          label="ROI table space"
          enabled={useRoi} onToggle={setUseRoi}
          value={roiText} onChange={setRoiText}
        />
        <SpaceBlock
          label="Trailing-stop space"
          enabled={useTrailing} onToggle={setUseTrailing}
          value={trailingText} onChange={setTrailingText}
        />
        <SpaceBlock
          label="Indicator space"
          enabled={useIndicators} onToggle={setUseIndicators}
          value={indicatorsText} onChange={setIndicatorsText}
        />
        <div className="form-row">
          <button className="btn btn-primary" onClick={onRun} disabled={busy || !strategyKey}>
            <FiPlay size={14} /> {busy ? 'Running…' : 'Run optimization'}
          </button>
        </div>
      </section>

      {result && (
        <section className="card">
          <h2>Leaderboard ({result.leaderboard.length} shown of {result.total})</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Score</th><th>Total P&L</th><th>Sharpe</th><th>Max DD</th>
                <th>Trades</th><th>Win %</th><th>Params</th>
              </tr>
            </thead>
            <tbody>
              {result.leaderboard.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{r.error ? <span className="pill pill-error">err</span> : r.score}</td>
                  <td>{r.totalPnl != null ? `$${r.totalPnl}` : '—'}</td>
                  <td>{r.sharpe ?? '—'}</td>
                  <td>{r.maxDrawdown ?? '—'}%</td>
                  <td>{r.trades ?? '—'}</td>
                  <td>{r.winRate ?? '—'}%</td>
                  <td>
                    <code style={{ fontSize: 11 }}>{JSON.stringify(r.params)}</code>
                    {r.error && <div style={{ color: 'var(--negative, #e55353)', fontSize: 11 }}>{r.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function SpaceBlock({ label, enabled, onToggle, value, onChange }) {
  return (
    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px dashed var(--border)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 6 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        <strong>{label}</strong>
      </label>
      {enabled && (
        <textarea
          value={value} onChange={(e) => onChange(e.target.value)}
          rows={6} spellCheck={false}
          style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12 }}
        />
      )}
    </div>
  );
}
