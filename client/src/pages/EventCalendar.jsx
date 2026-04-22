import React, { useEffect, useState, useCallback } from 'react';
import { getEventCalendar, addEventCalendar, deleteEventCalendar } from '../api';
import { FiCalendar, FiPlus, FiTrash2, FiAlertTriangle } from 'react-icons/fi';

// Default window: today through +90 days. Past events get hidden because they
// have no bearing on upcoming auto-trader blackouts.
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function inDaysIso(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const KIND_LABELS = {
  fomc: 'FOMC', cpi: 'CPI', nfp: 'NFP', pce: 'PCE',
  earnings: 'Earnings', custom: 'Custom',
};
const KIND_COLORS = {
  fomc: '#f59e0b', cpi: '#8b5cf6', nfp: '#3b82f6',
  pce: '#ec4899', earnings: '#10b981', custom: '#64748b',
};

export default function EventCalendarPage() {
  const [start, setStart] = useState(todayIso());
  const [end, setEnd]     = useState(inDaysIso(90));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form state for adding a user event (typically earnings).
  const [fDate, setFDate]   = useState(inDaysIso(7));
  const [fKind, setFKind]   = useState('earnings');
  const [fSymbol, setFSymbol] = useState('');
  const [fNote, setFNote]     = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await getEventCalendar({ start, end });
      setEvents(rows);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [start, end]);

  useEffect(() => { refresh(); }, [refresh]);

  const onAdd = async (e) => {
    e.preventDefault();
    setError('');
    const symbol = fSymbol.trim().toUpperCase();
    const note = fNote.trim();
    // Earnings rows are useless without a symbol; custom rows need at least
    // a symbol or a note. Catch these before hitting the server.
    if (fKind === 'earnings' && !symbol) {
      setError('Symbol is required for earnings events.');
      return;
    }
    if (fKind === 'custom' && !symbol && !note) {
      setError('Custom events need a symbol or a note.');
      return;
    }
    try {
      await addEventCalendar({
        date: fDate,
        kind: fKind,
        symbol: symbol || undefined,
        note: note || undefined,
      });
      setFSymbol(''); setFNote('');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const onDelete = async (id) => {
    if (!id) return; // static events have no id and can't be removed
    try {
      await deleteEventCalendar(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  // Group events by date for a readable list.
  const byDate = events.reduce((acc, e) => {
    (acc[e.date] ||= []).push(e);
    return acc;
  }, {});
  const sortedDates = Object.keys(byDate).sort();

  return (
    <div className="page-content">
      <div className="page-header">
        <h1><FiCalendar size={24} /> Event Calendar</h1>
        <p>Macro events (FOMC/CPI/NFP) and per-symbol earnings dates used by the auto-trader blackout gates.</p>
      </div>

      {error && <div className="error-msg"><FiAlertTriangle /> {error}</div>}

      <div className="lab-controls" style={{ marginBottom: 16 }}>
        <div className="lab-field">
          <label>From</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="lab-field">
          <label>To</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <button className="btn" onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <form onSubmit={onAdd} className="lab-controls" style={{ marginBottom: 16 }}>
        <div className="lab-field">
          <label>Date</label>
          <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} required />
        </div>
        <div className="lab-field">
          <label>Kind</label>
          <select value={fKind} onChange={(e) => setFKind(e.target.value)}>
            <option value="earnings">Earnings</option>
            <option value="fomc">FOMC</option>
            <option value="cpi">CPI</option>
            <option value="nfp">NFP</option>
            <option value="pce">PCE</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="lab-field">
          <label>Symbol{fKind === 'earnings' ? ' *' : ' (optional)'}</label>
          <input
            type="text"
            placeholder="AAPL"
            value={fSymbol}
            onChange={(e) => setFSymbol(e.target.value)}
            required={fKind === 'earnings'}
          />
        </div>
        <div className="lab-field" style={{ flex: 2 }}>
          <label>Note</label>
          <input type="text" placeholder="optional" value={fNote} onChange={(e) => setFNote(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary">
          <FiPlus size={14} /> Add event
        </button>
      </form>

      {sortedDates.length === 0 ? (
        <p className="muted">No events in this window.</p>
      ) : (
        <div>
          {sortedDates.map((date) => (
            <div key={date} style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 8, color: '#cbd5e1', fontSize: 14 }}>{date}</h3>
              {byDate[date].map((e, i) => (
                <div key={`${date}-${i}`} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 12px', marginBottom: 4,
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(148, 163, 184, 0.15)',
                  borderRadius: 6,
                }}>
                  <span style={{
                    background: KIND_COLORS[e.kind] || '#64748b',
                    color: '#fff',
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                    minWidth: 72, textAlign: 'center',
                  }}>{KIND_LABELS[e.kind] || e.kind}</span>
                  {e.symbol && <strong style={{ color: '#a5b4fc' }}>{e.symbol}</strong>}
                  <span style={{ color: '#94a3b8', flex: 1 }}>{e.note || ''}</span>
                  <span style={{ color: '#64748b', fontSize: 12 }}>{e.source}</span>
                  {e.source === 'db' && e.id && (
                    <button
                      className="btn-link"
                      onClick={() => onDelete(e.id)}
                      title="Delete user-added event"
                      style={{ color: '#f87171' }}
                    >
                      <FiTrash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
