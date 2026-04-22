import React, { useEffect, useState, useCallback } from 'react';
import { getAuditLog } from '../api';
import { FiShield, FiRefreshCw } from 'react-icons/fi';

// Audit rows are append-only on the server, so this view is read-only too.
// Filters hit the server (indexed on action/resource/userId), so even a big
// log stays responsive.
const PAGE_SIZE = 100;

export default function AuditLogPage() {
  const [rows, setRows]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [offset, setOffset]     = useState(0);
  const [action, setAction]     = useState('');
  const [resource, setResource] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getAuditLog({ action: action || undefined, resource: resource || undefined, limit: PAGE_SIZE, offset });
      setRows(res.items || []);
      setTotal(res.total || 0);
    } catch (err) { setError(err.message); }
    setLoading(false);
  }, [action, resource, offset]);

  useEffect(() => { refresh(); }, [refresh]);

  const fmtTime = (t) => t ? new Date(t).toLocaleString() : '';

  return (
    <div className="page-content">
      <div className="page-header">
        <h1><FiShield size={24} /> Audit Log</h1>
        <p>Append-only record of sensitive actions (auto-trader start/stop, order placement, cancellation).</p>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="lab-controls" style={{ marginBottom: 16 }}>
        <div className="lab-field">
          <label>Action</label>
          <input type="text" placeholder="e.g. auto-trader.start"
            value={action} onChange={(e) => { setOffset(0); setAction(e.target.value); }} />
        </div>
        <div className="lab-field">
          <label>Resource</label>
          <input type="text" placeholder="e.g. auto-trader"
            value={resource} onChange={(e) => { setOffset(0); setResource(e.target.value); }} />
        </div>
        <button className="btn" onClick={refresh} disabled={loading}>
          <FiRefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div style={{ marginBottom: 8, fontSize: 12, color: '#94a3b8' }}>
        Showing {rows.length ? offset + 1 : 0}–{offset + rows.length} of {total}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#a5b4fc', borderBottom: '1px solid rgba(148, 163, 184, 0.2)' }}>
              <th style={{ padding: 6 }}>When</th>
              <th style={{ padding: 6 }}>User</th>
              <th style={{ padding: 6 }}>Action</th>
              <th style={{ padding: 6 }}>Resource</th>
              <th style={{ padding: 6 }}>Status</th>
              <th style={{ padding: 6 }}>IP</th>
              <th style={{ padding: 6 }}>Meta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)' }}>
                <td style={{ padding: 6, color: '#cbd5e1' }}>{fmtTime(r.createdAt)}</td>
                <td style={{ padding: 6 }}>{r.userId ?? '—'}</td>
                <td style={{ padding: 6, fontFamily: 'ui-monospace, monospace' }}>{r.action}</td>
                <td style={{ padding: 6 }}>{r.resource || '—'}{r.resourceId ? `#${r.resourceId}` : ''}</td>
                <td style={{ padding: 6 }}>
                  {r.meta?.status != null ? (
                    <span style={{
                      color: r.meta.status >= 400 ? '#f87171' : '#34d399',
                    }}>{r.meta.status}</span>
                  ) : '—'}
                </td>
                <td style={{ padding: 6, color: '#94a3b8' }}>{r.ip || '—'}</td>
                <td style={{ padding: 6, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#94a3b8' }}>
                  {r.meta?.body ? JSON.stringify(r.meta.body).slice(0, 120) : ''}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No audit entries.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" disabled={offset === 0 || loading}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
        <button className="btn" disabled={offset + PAGE_SIZE >= total || loading}
          onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
      </div>
    </div>
  );
}
