import React, { useState } from 'react';
import { FiGitBranch, FiPlay, FiAlertTriangle, FiCheck, FiCopy } from 'react-icons/fi';
import { migrateStrategyV2ToV3 } from '../api';

/**
 * Strategy Migrator — freqtrade V2 → V3 source rewriter.
 *
 * Paste a V2 IStrategy, click Migrate, get the rewritten V3 source plus a
 * list of warnings for spots that need manual review (things the regex
 * migrator can't safely rewrite: inherited IStrategy classes, protections=
 * attribute layouts, deprecated ticker_interval, etc.).
 */

const V2_EXAMPLE = `class MyStrategy(IStrategy):
    INTERFACE_VERSION = 2
    ticker_interval = '5m'

    def populate_buy_trend(self, dataframe, metadata):
        dataframe.loc[dataframe['rsi'] < 30, 'buy'] = 1
        return dataframe

    def populate_sell_trend(self, dataframe, metadata):
        dataframe.loc[dataframe['rsi'] > 70, 'sell'] = 1
        return dataframe
`;

export default function StrategyMigrator() {
  const [source, setSource]   = useState(V2_EXAMPLE);
  const [result, setResult]   = useState(null);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  const handleMigrate = async () => {
    setErr(''); setResult(null); setBusy(true);
    try { setResult(await migrateStrategyV2ToV3(source)); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const handleCopy = () => {
    if (!result?.output) return;
    navigator.clipboard.writeText(result.output).catch(() => {});
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiGitBranch /> Strategy Migrator</h1>
        <p className="page-subtitle">
          Rewrites freqtrade V2 strategy source into V3 conventions
          (<code>populate_buy_trend</code> → <code>populate_entry_trend</code>,{' '}
          <code>'buy'</code>/<code>'sell'</code> columns → <code>'enter_long'</code>/<code>'exit_long'</code>,{' '}
          <code>custom_sell</code> → <code>custom_exit</code>, etc.). Warnings flag lines the
          regex rewriter can't safely handle — review those manually.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <section className="card">
        <div className="card-header-row">
          <h2>V2 source</h2>
          <button className="btn btn-primary" onClick={handleMigrate} disabled={busy || !source.trim()}>
            <FiPlay size={14} /> {busy ? 'Migrating…' : 'Migrate to V3'}
          </button>
        </div>
        <div className="form-row" style={{ maxWidth: '100%' }}>
          <textarea
            rows={14}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
          />
        </div>
      </section>

      {result && (
        <>
          <section className="card">
            <div className="card-header-row">
              <h2>V3 output</h2>
              <button className="btn btn-secondary btn-small" onClick={handleCopy}>
                <FiCopy size={12} /> Copy
              </button>
            </div>
            <div className="audit-verdict ok" style={{ marginBottom: 10 }}>
              <FiCheck size={16} /> {result.replacements ?? 0} replacement{result.replacements === 1 ? '' : 's'} applied.
            </div>
            <pre className="code-block">{result.output}</pre>
          </section>

          <section className="card">
            <h2>Warnings ({result.warnings?.length || 0})</h2>
            {!result.warnings?.length ? (
              <div className="empty-state">No manual-review items flagged.</div>
            ) : (
              <ul style={{ paddingLeft: 20, margin: 0 }}>
                {result.warnings.map((w, i) => (
                  <li key={i} style={{ marginBottom: 8, color: '#fcd34d', fontSize: 13 }}>
                    <FiAlertTriangle size={12} style={{ marginRight: 6 }} />
                    {typeof w === 'string' ? w : <>
                      <strong>Line {w.line}:</strong> {w.message} — <code>{w.text}</code>
                    </>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
