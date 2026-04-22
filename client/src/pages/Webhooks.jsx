import React, { useEffect, useState } from 'react';
import { FiTrash2, FiPlus, FiSend, FiRefreshCw, FiCheckCircle, FiXCircle, FiPauseCircle } from 'react-icons/fi';
import {
  listOutboundWebhooks,
  createOutboundWebhook,
  deleteOutboundWebhook,
  testOutboundWebhook,
  rotateOutboundWebhookSecret,
} from '../api';

/**
 * Outbound Webhooks — user-configured HTTP callbacks fired when the auto-trader
 * produces events (order.filled, order.stopped, order.flatten, auto-trader.*).
 *
 * Secret handling: on create and on rotate, the server returns the raw HMAC
 * secret once. We stash it in `newSecret` and show a one-time banner — the
 * user must copy it immediately; subsequent GETs only return a preview.
 */

const EVENT_OPTIONS = [
  { value: 'order.filled',         label: 'Order filled (buy/sell)' },
  { value: 'order.stopped',        label: 'Order stopped (bracket exit)' },
  { value: 'order.flatten',        label: 'Order flatten (EOD / kill-switch)' },
  { value: 'auto-trader.started',  label: 'Auto-trader started' },
  { value: 'auto-trader.stopped',  label: 'Auto-trader stopped' },
  { value: '*',                    label: 'All events (*)' },
];

function StatusPill({ status, active }) {
  if (!active) return <span className="webhook-pill pill-disabled"><FiPauseCircle size={12} /> disabled</span>;
  if (status === 'ok') return <span className="webhook-pill pill-ok"><FiCheckCircle size={12} /> ok</span>;
  if (status === 'error' || status === 'disabled') return <span className="webhook-pill pill-error"><FiXCircle size={12} /> {status}</span>;
  return <span className="webhook-pill">idle</span>;
}

export default function Webhooks() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // New-config form state.
  const [name, setName]     = useState('');
  const [url, setUrl]       = useState('');
  const [events, setEvents] = useState(['order.filled']);
  const [saving, setSaving] = useState(false);

  // Revealed-once secret after create or rotate.
  const [newSecret, setNewSecret] = useState(null); // { configId, secret }

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await listOutboundWebhooks();
      setItems(r.items || []);
      setErr('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const toggleEvent = (evt) => {
    setEvents((prev) => prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim() || !url.trim() || !events.length) return;
    setSaving(true);
    try {
      const created = await createOutboundWebhook({ name: name.trim(), url: url.trim(), events });
      setNewSecret({ configId: created.id, secret: created.secret });
      setName(''); setUrl(''); setEvents(['order.filled']);
      refresh();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (id) => {
    try {
      const r = await testOutboundWebhook(id);
      alert(r.ok ? `Delivered (${r.attempts} attempt${r.attempts === 1 ? '' : 's'})` : `Failed: ${r.error}`);
      refresh();
    } catch (e) { alert(`Test failed: ${e.message}`); }
  };

  const handleRotate = async (id) => {
    if (!confirm('Rotate the HMAC secret? The old one will stop working immediately.')) return;
    try {
      const r = await rotateOutboundWebhookSecret(id);
      setNewSecret({ configId: id, secret: r.secret });
      refresh();
    } catch (e) { alert(`Rotate failed: ${e.message}`); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this webhook?')) return;
    try { await deleteOutboundWebhook(id); refresh(); }
    catch (e) { alert(`Delete failed: ${e.message}`); }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Outbound Webhooks</h1>
        <p className="page-subtitle">
          Receive signed HTTP callbacks when the auto-trader fills, stops out, or flattens positions.
          Payloads are HMAC-SHA256 signed — verify the <code>X-Signature</code> header with your config secret.
        </p>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {newSecret && (
        <div className="alert alert-info webhook-secret-banner">
          <div>
            <strong>Copy this secret now — it will not be shown again.</strong>
            <div style={{ marginTop: 6 }}>
              <code className="webhook-secret-code">{newSecret.secret}</code>
            </div>
          </div>
          <button className="btn btn-secondary btn-small" onClick={() => setNewSecret(null)}>Dismiss</button>
        </div>
      )}

      <section className="card">
        <h2>Add webhook</h2>
        <form className="webhook-form" onSubmit={handleCreate}>
          <div className="form-row">
            <label>Name</label>
            <input
              type="text"
              placeholder="Slack notifier"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
            />
          </div>
          <div className="form-row">
            <label>URL</label>
            <input
              type="url"
              placeholder="https://hooks.example.com/path"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>
          <div className="form-row">
            <label>Events</label>
            <div className="webhook-event-grid">
              {EVENT_OPTIONS.map((o) => (
                <label key={o.value} className="webhook-event-option">
                  <input
                    type="checkbox"
                    checked={events.includes(o.value)}
                    onChange={() => toggleEvent(o.value)}
                  />
                  <span>{o.label}</span>
                  <code>{o.value}</code>
                </label>
              ))}
            </div>
          </div>
          <div className="form-row">
            <button type="submit" className="btn btn-primary" disabled={saving || !name.trim() || !url.trim() || !events.length}>
              <FiPlus size={14} /> {saving ? 'Creating…' : 'Create webhook'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Configured webhooks ({items.length})</h2>
        {loading ? (
          <div className="page-loading">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">No webhooks yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Events</th>
                <th>Status</th>
                <th>Last delivery</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id}>
                  <td><strong>{w.name}</strong></td>
                  <td><code className="webhook-url">{w.url}</code></td>
                  <td>
                    {(w.events || []).map((e) => (
                      <code key={e} className="webhook-event-chip">{e}</code>
                    ))}
                  </td>
                  <td>
                    <StatusPill status={w.lastStatus} active={w.active} />
                    {w.failCount > 0 && <span className="webhook-failcount"> ({w.failCount} fails)</span>}
                    {w.lastError && <div className="webhook-lasterror" title={w.lastError}>{w.lastError.slice(0, 80)}</div>}
                  </td>
                  <td>{w.lastDeliveryAt ? new Date(w.lastDeliveryAt).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn btn-secondary btn-small" onClick={() => handleTest(w.id)} title="Send a ping event">
                      <FiSend size={12} /> Test
                    </button>
                    {' '}
                    <button className="btn btn-secondary btn-small" onClick={() => handleRotate(w.id)} title="Rotate HMAC secret">
                      <FiRefreshCw size={12} /> Rotate
                    </button>
                    {' '}
                    <button className="btn btn-danger btn-small" onClick={() => handleDelete(w.id)}>
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
        <h2>Verifying signatures</h2>
        <p>On your receiver, verify each request before acting on it:</p>
        <pre className="code-block">{`// Node.js
const crypto = require('crypto');
const expected = 'sha256=' + crypto
  .createHmac('sha256', YOUR_WEBHOOK_SECRET)
  .update(rawBody)  // NOT the parsed JSON — the exact bytes we sent
  .digest('hex');
if (!crypto.timingSafeEqual(
  Buffer.from(req.headers['x-signature']),
  Buffer.from(expected),
)) return res.status(401).end();`}</pre>
      </section>
    </div>
  );
}
