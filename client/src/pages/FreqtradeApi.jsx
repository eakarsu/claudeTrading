import React, { useState } from 'react';
import { FiServer, FiCopy, FiCheck } from 'react-icons/fi';

/**
 * Freqtrade API — reference for the /api/v1/* compat surface.
 *
 * This is an informational page for users wanting to point existing freqtrade
 * tooling (freqUI, ft-client, custom scripts) at this server. The endpoints
 * are a best-effort mirror of freqtrade's REST schema, translated from our
 * own AutoTrader models.
 */

const ENDPOINTS = [
  { method: 'GET',  path: '/api/v1/ping',        desc: 'Health check — returns {"status":"pong"}.' },
  { method: 'GET',  path: '/api/v1/show_config', desc: 'Current dry-run flag, active strategy, timeframe, max open trades.' },
  { method: 'GET',  path: '/api/v1/status',      desc: 'Open trades (mapped from Alpaca positions) in freqtrade-trade shape.' },
  { method: 'GET',  path: '/api/v1/balance',     desc: 'Account equity + buying power + cash.' },
  { method: 'GET',  path: '/api/v1/trades',      desc: 'Closed trades, paginated. Query: ?limit=50&offset=0' },
  { method: 'GET',  path: '/api/v1/trade/:id',   desc: 'Single trade by id.' },
  { method: 'GET',  path: '/api/v1/profit',      desc: 'All-time realized P&L + win rate + trade count.' },
  { method: 'GET',  path: '/api/v1/performance', desc: 'Per-symbol P&L (pair, profit_abs, count).' },
  { method: 'GET',  path: '/api/v1/count',       desc: 'Open trades / max_open_trades.' },
  { method: 'GET',  path: '/api/v1/daily',       desc: 'Daily buckets for the last 30 days.' },
  { method: 'GET',  path: '/api/v1/weekly',      desc: 'Weekly buckets for the last 180 days.' },
  { method: 'GET',  path: '/api/v1/monthly',     desc: 'Monthly buckets for the last 365 days.' },
  { method: 'GET',  path: '/api/v1/stats',       desc: 'Wins/losses averages, profit factor, best/worst trade.' },
  { method: 'POST', path: '/api/v1/forcebuy',    desc: 'Force-open a position. Body: { pair, price?, stake_amount? }' },
  { method: 'POST', path: '/api/v1/forcesell',   desc: 'Force-close a position. Body: { tradeid }' },
  { method: 'POST', path: '/api/v1/start',       desc: 'Start the auto-trader.' },
  { method: 'POST', path: '/api/v1/stop',        desc: 'Stop the auto-trader.' },
  { method: 'GET',  path: '/api/v1/logs',        desc: 'Recent audit-log entries in freqtrade log-row shape.' },
];

function methodPill(m) {
  const cls =
    m === 'GET'    ? 'pill pill-ok' :
    m === 'POST'   ? 'pill pill-running' :
    m === 'DELETE' ? 'pill pill-error' : 'pill';
  return <span className={cls} style={{ minWidth: 52, justifyContent: 'center' }}>{m}</span>;
}

function CopyCell({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
    >
      {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
    </button>
  );
}

export default function FreqtradeApi() {
  const host = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
  const curlExample =
`# Export your bearer token (from account settings)
export TOKEN="<your_jwt_token>"

# Ping
curl -H "Authorization: Bearer $TOKEN" ${host}/api/v1/ping

# Show config
curl -H "Authorization: Bearer $TOKEN" ${host}/api/v1/show_config

# Today's P&L + open trade count
curl -H "Authorization: Bearer $TOKEN" ${host}/api/v1/profit
curl -H "Authorization: Bearer $TOKEN" ${host}/api/v1/count

# Force-sell trade #42
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"tradeid":42}' ${host}/api/v1/forcesell`;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><FiServer /> Freqtrade API</h1>
        <p className="page-subtitle">
          Compat shim exposing freqtrade-shaped endpoints under <code>/api/v1/*</code>. Point existing
          freqtrade tooling (freqUI, <code>ft-client</code>, custom scripts) at this server without
          changes. Endpoints translate from the internal AutoTrader models to freqtrade's schema
          on the way out.
        </p>
      </div>

      <section className="card">
        <h2>Authentication</h2>
        <p className="hint">
          All <code>/api/v1/*</code> endpoints require a bearer JWT. Generate one from the
          Account Settings page and pass it in the <code>Authorization: Bearer &lt;token&gt;</code> header.
        </p>
      </section>

      <section className="card">
        <h2>Endpoints ({ENDPOINTS.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Method</th>
              <th>Path</th>
              <th>Description</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.method + e.path}>
                <td>{methodPill(e.method)}</td>
                <td><code>{e.path}</code></td>
                <td>{e.desc}</td>
                <td><CopyCell text={`${host}${e.path}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Curl examples</h2>
        <pre className="code-block">{curlExample}</pre>
      </section>

      <section className="card">
        <h2>Schema notes</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
          <li><code>pair</code> on trade rows is our <code>symbol</code> verbatim — no quote-currency suffix.</li>
          <li><code>exit_reason</code> uses freqtrade conventions (<code>roi</code>, <code>stoploss</code>, <code>exit_signal</code>,{' '}
            <code>force_exit</code>) mapped from our internal reasons.</li>
          <li>Locks / leverage / funding fees are not modelled — those fields are omitted or stubbed.</li>
          <li><code>/api/v1/logs</code> returns recent <code>AuditLog</code> rows, not raw freqtrade log lines.</li>
        </ul>
      </section>
    </div>
  );
}
