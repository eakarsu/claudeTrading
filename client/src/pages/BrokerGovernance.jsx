import React, { useEffect, useState } from 'react';
import { FiRefreshCw, FiShield, FiAlertOctagon } from 'react-icons/fi';
import * as api from '../api';

const initialForm = { environment: 'paper', accountId: '', apiKey: '', apiSecret: '', brokerLimitsVerified: false };

export default function BrokerGovernance() {
  const [connections, setConnections] = useState([]);
  const [orders, setOrders] = useState([]);
  const [disclosure, setDisclosure] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    setBusy(true);
    try {
      const [nextConnections, nextOrders, nextDisclosure] = await Promise.all([
        api.listBrokerConnections(), api.listGovernedOrders(), api.getLiveTradingDisclosure(),
      ]);
      setConnections(nextConnections);
      setOrders(nextOrders);
      setDisclosure(nextDisclosure);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const configure = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api.configureBrokerConnection({
        ...form,
        accountId: form.accountId || undefined,
        brokerLimitsVerified: form.environment === 'live' ? form.brokerLimitsVerified : undefined,
      });
      setForm(initialForm);
      setMessage('Connection verified and credentials encrypted. Secret values are not returned to this browser.');
      await refresh();
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  };

  const reconcile = async (connection) => {
    setBusy(true);
    try {
      const run = await api.reconcileBrokerConnection(connection.id);
      setMessage(`Reconciliation ${run.status}: ${run.changedOrderCount} updated, ${run.orphanOrderCount} orphaned.`);
      await refresh();
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  };

  const drill = async (connection) => {
    if (!window.confirm('Run the kill-switch contract drill? The connection will remain stopped until reconciliation and re-authentication.')) return;
    setBusy(true);
    try {
      const result = await api.runKillSwitchDrill(connection.id, 'Operator-initiated quarterly control drill');
      setMessage(`Drill recorded: cancel=${result.cancelSucceeded}, flatten=${result.flattenSucceeded}.`);
      await refresh();
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  };

  return (
    <div className="feature-page">
      <div className="page-header">
        <div>
          <h1><FiShield /> Broker Governance</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>Account isolation, durable reconciliation, and live-trading controls</p>
        </div>
        <button className="btn btn-secondary" onClick={refresh} disabled={busy}><FiRefreshCw /> Refresh</button>
      </div>

      <div className="alpaca-section" style={{ borderColor: 'var(--yellow)' }}>
        <h3><FiAlertOctagon /> Live execution is disabled by default</h3>
        <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>{disclosure?.text || 'Loading the current risk disclosure…'}</p>
        <p style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 13 }}>
          Live use additionally requires current 2FA re-authentication, passed strategy evidence, separate operator and compliance approvals, recent reconciliation, and deployment-level enablement.
        </p>
      </div>

      <div className="alpaca-order-form">
        <h3>Configure isolated connection</h3>
        <form onSubmit={configure} className="order-form-grid">
          <div className="form-field">
            <label>Environment</label>
            <select value={form.environment} onChange={(event) => setForm({ ...form, environment: event.target.value })}>
              <option value="paper">Paper</option><option value="live">Live</option>
            </select>
          </div>
          <div className="form-field"><label>Expected account ID</label><input value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })} placeholder="Optional verification" /></div>
          <div className="form-field"><label>API key</label><input value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} autoComplete="off" required /></div>
          <div className="form-field"><label>API secret</label><input type="password" value={form.apiSecret} onChange={(event) => setForm({ ...form, apiSecret: event.target.value })} autoComplete="new-password" required /></div>
          {form.environment === 'live' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={form.brokerLimitsVerified} onChange={(event) => setForm({ ...form, brokerLimitsVerified: event.target.checked })} required />
              Broker-side limits independently verified
            </label>
          )}
          <button className="btn btn-primary" disabled={busy}>Verify and encrypt</button>
        </form>
        {message && <div className="order-result" style={{ marginTop: 12 }}>{message}</div>}
      </div>

      <div className="alpaca-section">
        <h3>Connections</h3>
        {connections.length === 0 ? <div className="empty-state">No isolated broker connection configured</div> : connections.map((connection) => (
          <div key={connection.id} className="table-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 2fr' }}>
            <span><strong>{connection.environment.toUpperCase()}</strong><br /><small>{connection.accountId}</small></span>
            <span>{connection.status}<br /><small>{connection.killSwitchActive ? `STOPPED: ${connection.killSwitchReason}` : 'kill switch clear'}</small></span>
            <span><small>Last reconciled</small><br />{connection.lastReconciledAt ? new Date(connection.lastReconciledAt).toLocaleString() : 'Never'}</span>
            <span style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => reconcile(connection)} disabled={busy}>Reconcile</button>
              <button className="btn btn-delete" onClick={() => drill(connection)} disabled={busy}>Kill-switch drill</button>
            </span>
          </div>
        ))}
      </div>

      <div className="alpaca-section">
        <h3>Durable order ledger</h3>
        {orders.length === 0 ? <div className="empty-state">No governed orders</div> : (
          <div className="alpaca-table">
            <div className="table-header"><span>Symbol</span><span>Side</span><span>Qty</span><span>Environment</span><span>Status</span><span>Filled</span><span>Client ID</span></div>
            {orders.slice(0, 100).map((order) => (
              <div className="table-row" key={order.id}>
                <span className="row-symbol">{order.symbol}</span><span>{order.side}</span><span>{order.qty}</span>
                <span>{order.environment}</span><span>{order.status}</span><span>{order.filledQty}</span><span title={order.clientOrderId}>{order.clientOrderId.slice(0, 12)}…</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
