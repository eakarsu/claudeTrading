import React, { useCallback, useEffect, useState } from 'react';
import { FiInbox, FiRefreshCw, FiCheckCircle, FiTrash2, FiBell, FiZap, FiShield, FiInfo } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import {
  listNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification,
} from '../api';

const PAGE_SIZE = 50;

// Icon + color per notification type. Keep in sync with the server-side
// VALID_TYPES set in services/notifications.js.
const TYPE_META = {
  'price-alert': { icon: FiBell, color: '#f59e0b', label: 'Price alert' },
  'auto-trader': { icon: FiZap, color: '#22c55e', label: 'Auto-trader' },
  'security':    { icon: FiShield, color: '#ef4444', label: 'Security' },
  'info':        { icon: FiInfo, color: '#64748b', label: 'Info' },
};

export default function NotificationsPage() {
  const [items, setItems]   = useState([]);
  const [total, setTotal]   = useState(0);
  const [offset, setOffset] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await listNotifications({ unread: onlyUnread, limit: PAGE_SIZE, offset });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (err) { setError(err.message); }
    setLoading(false);
  }, [onlyUnread, offset]);

  useEffect(() => { refresh(); }, [refresh]);

  const onRead = async (id) => {
    await markNotificationRead(id).catch(() => null);
    refresh();
  };
  const onDelete = async (id) => {
    if (!window.confirm('Delete this notification?')) return;
    await deleteNotification(id).catch(() => null);
    refresh();
  };
  const onReadAll = async () => {
    await markAllNotificationsRead().catch(() => null);
    refresh();
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1><FiInbox size={24} /> Notifications</h1>
        <p>In-app feed for price alerts, auto-trader fills, and security events.</p>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="lab-controls" style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={onlyUnread}
            onChange={(e) => { setOffset(0); setOnlyUnread(e.target.checked); }} />
          Unread only
        </label>
        <button className="btn" onClick={refresh} disabled={loading}>
          <FiRefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button className="btn btn-secondary" onClick={onReadAll}>
          <FiCheckCircle size={14} /> Mark all read
        </button>
      </div>

      <div style={{ marginBottom: 8, fontSize: 12, color: '#94a3b8' }}>
        Showing {items.length ? offset + 1 : 0}–{offset + items.length} of {total}
      </div>

      {!loading && items.length === 0 && (
        <div style={{ padding: 24, color: '#94a3b8' }}>No notifications.</div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((n) => {
          const meta = TYPE_META[n.type] || TYPE_META.info;
          const Icon = meta.icon;
          return (
            <div key={n.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12,
                border: '1px solid #1f2937', borderRadius: 8,
                background: n.read ? '#0b1220' : '#0f1a2e',
              }}>
              <Icon size={18} color={meta.color} style={{ marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ color: '#e5e7eb' }}>{n.title}</strong>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{meta.label}</span>
                  {!n.read && <span style={{ fontSize: 10, color: meta.color }}>● NEW</span>}
                </div>
                {n.body && <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 2 }}>{n.body}</div>}
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                  {new Date(n.createdAt).toLocaleString()}
                  {n.link && <> · <Link to={n.link} style={{ color: '#60a5fa' }}>Open</Link></>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {!n.read && (
                  <button className="btn btn-icon" title="Mark read" onClick={() => onRead(n.id)}>
                    <FiCheckCircle size={14} />
                  </button>
                )}
                <button className="btn btn-icon" title="Delete" onClick={() => onDelete(n.id)}>
                  <FiTrash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
        <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          Previous
        </button>
        <button className="btn" disabled={offset + items.length >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Next
        </button>
      </div>
    </div>
  );
}
