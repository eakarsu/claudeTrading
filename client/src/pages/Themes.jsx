import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FiCpu, FiPlus, FiTrash2, FiBell, FiEdit2, FiSave, FiX } from 'react-icons/fi';
import * as api from '../api';

/**
 * AI Investment Themes page.
 *
 * Renders the 5 seeded structural themes from the April-2026 manifesto with:
 *   - thesis text (markdown-ish, rendered as a pre-wrapped block)
 *   - live constituent quotes (equal-weight basket day-change)
 *   - per-theme AI manifesto scoring for any ticker
 *   - admin CRUD (add/remove constituents, edit thesis) gated server-side
 *   - per-user basket alerts (create / list / delete)
 *   - "import into Watchlist" one-click action
 *
 * The server decides whether the current user can mutate; we call the admin
 * endpoints optimistically and surface 403s as a small "admin-only" notice.
 */
export default function Themes() {
  const qc = useQueryClient();
  const { data: themesResp, isLoading, error } = useQuery({
    queryKey: ['themes'],
    queryFn: api.listThemes,
    refetchInterval: 30_000,   // refresh live quotes every 30s
  });
  const themes = themesResp?.items || [];
  const [activeSlug, setActiveSlug] = useState(null);

  useEffect(() => {
    if (!activeSlug && themes.length) setActiveSlug(themes[0].slug);
  }, [themes, activeSlug]);

  const activeTheme = useMemo(
    () => themes.find((t) => t.slug === activeSlug),
    [themes, activeSlug],
  );

  if (isLoading) {
    return <div className="page"><h1>AI Investment Themes</h1><div className="muted">Loading…</div></div>;
  }
  if (error) {
    return <div className="page"><h1>AI Investment Themes</h1><div className="error">Failed to load: {error.message}</div></div>;
  }
  if (!themes.length) {
    return (
      <div className="page">
        <h1>AI Investment Themes</h1>
        <div className="muted">
          No themes seeded. Run <code>node server/seed.js --reset</code> to populate the manifesto.
        </div>
      </div>
    );
  }

  return (
    <div className="page themes-page">
      <header className="page-header">
        <h1>AI Investment Themes</h1>
        <p className="muted">Five structural AI themes — thesis, constituents, and basket performance.</p>
      </header>

      <div className="disclaimer-banner">
        <strong>Not investment advice.</strong> These themes reflect one investor's thesis from April 2026.
        Scores, rationales, and ticker lists will decay. Do your own research.
      </div>

      <div className="themes-layout">
        {/* Left rail: themes list + basket perf chip */}
        <aside className="themes-rail">
          {themes.map((t) => (
            <ThemeChip
              key={t.slug}
              theme={t}
              active={t.slug === activeSlug}
              onClick={() => setActiveSlug(t.slug)}
            />
          ))}
        </aside>

        {/* Right panel: detail of the selected theme */}
        <section className="themes-detail">
          {activeTheme && <ThemeDetail theme={activeTheme} qc={qc} />}
        </section>
      </div>
    </div>
  );
}

// ─── Left rail chip — name + tagline + aggregate basket change % ────────────
function ThemeChip({ theme, active, onClick }) {
  const basketChange = averageChangePct(theme.constituents);
  return (
    <button
      className={`theme-chip ${active ? 'active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <div className="theme-chip-name">{theme.name}</div>
      <div className="theme-chip-tagline">{theme.tagline}</div>
      <div className={`theme-chip-change ${basketChange >= 0 ? 'positive' : 'negative'}`}>
        {basketChange == null ? '—' : `${basketChange >= 0 ? '+' : ''}${basketChange.toFixed(2)}%`}
      </div>
    </button>
  );
}

// ─── Detail panel ──────────────────────────────────────────────────────────
function ThemeDetail({ theme, qc }) {
  const [scoreSymbol, setScoreSymbol] = useState('');
  const [scoreResult, setScoreResult] = useState(null);

  const scoreMut = useMutation({
    mutationFn: (symbol) => api.aiManifestoScore(symbol),
    onSuccess: setScoreResult,
    onError: (err) => alert(`Score failed: ${err.message}`),
  });

  const importToWatchlistMut = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        theme.constituents.map((c) =>
          api.create('watchlist', {
            symbol: c.symbol,
            companyName: c.symbol,
            price: c.quote?.p ?? c.quote?.price ?? 0,
            changePct: 0,
            sector: theme.name,
            notes: c.rationale || '',
          }),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      return { ok, total: results.length };
    },
    onSuccess: ({ ok, total }) => alert(`Imported ${ok}/${total} into Watchlist.`),
    onError: (err) => alert(err.message),
  });

  const basketChange = averageChangePct(theme.constituents);

  return (
    <div className="theme-detail">
      <div className="theme-detail-header">
        <div>
          <h2>{theme.name}</h2>
          <p className="muted">{theme.tagline}</p>
        </div>
        <div className={`theme-basket-chip ${basketChange >= 0 ? 'positive' : 'negative'}`}>
          <div className="label">Basket (avg day)</div>
          <div className="value">
            {basketChange == null ? '—' : `${basketChange >= 0 ? '+' : ''}${basketChange.toFixed(2)}%`}
          </div>
        </div>
      </div>

      {/* Thesis — rendered as plain text; model has already sanitized/formatted */}
      <pre className="theme-thesis">{theme.thesisMd}</pre>

      {/* Constituents table */}
      <ConstituentsTable theme={theme} qc={qc} />

      {/* Actions row */}
      <div className="theme-actions">
        <button
          className="btn"
          type="button"
          onClick={() => importToWatchlistMut.mutate()}
          disabled={importToWatchlistMut.isPending}
        >
          <FiPlus /> Import {theme.constituents.length} into Watchlist
        </button>
      </div>

      {/* AI Manifesto Scorer */}
      <div className="theme-scorer">
        <h3><FiCpu /> Score a ticker against the manifesto</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!scoreSymbol.trim()) return;
            scoreMut.mutate(scoreSymbol.trim().toUpperCase());
          }}
        >
          <input
            placeholder="e.g. NVDA"
            value={scoreSymbol}
            onChange={(e) => setScoreSymbol(e.target.value)}
          />
          <button type="submit" disabled={scoreMut.isPending}>
            {scoreMut.isPending ? 'Scoring…' : 'Score'}
          </button>
        </form>
        {scoreResult && <ManifestoScoreOutput result={scoreResult} themes={theme} />}
      </div>

      {/* Theme-basket alerts */}
      <ThemeAlertsPanel theme={theme} />
    </div>
  );
}

// ─── Constituents table with optional admin controls ───────────────────────
function ConstituentsTable({ theme, qc }) {
  const [adding, setAdding] = useState(false);
  const [newSym, setNewSym] = useState('');
  const [newRationale, setNewRationale] = useState('');

  const addMut = useMutation({
    mutationFn: (body) => api.addThemeConstituent(theme.slug, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['themes'] });
      setAdding(false); setNewSym(''); setNewRationale('');
    },
    onError: (err) => {
      if (err.status === 403) alert('Admin only — constituents can\'t be changed from this account.');
      else alert(err.message);
    },
  });
  const removeMut = useMutation({
    mutationFn: (symbol) => api.removeThemeConstituent(theme.slug, symbol),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['themes'] }),
    onError: (err) => {
      if (err.status === 403) alert('Admin only.');
      else alert(err.message);
    },
  });

  return (
    <div className="constituents">
      <div className="constituents-header">
        <h3>Constituents ({theme.constituents.length})</h3>
        {!adding && (
          <button className="btn-small" type="button" onClick={() => setAdding(true)}>
            <FiPlus /> Add
          </button>
        )}
      </div>
      <table className="constituents-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Price</th>
            <th>Rationale</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {theme.constituents.map((c) => (
            <tr key={c.symbol}>
              <td className="symbol">{c.symbol}</td>
              <td>{formatPrice(c.quote)}</td>
              <td className="rationale">{c.rationale}</td>
              <td>
                <button
                  className="btn-icon danger"
                  type="button"
                  title="Remove (admin)"
                  onClick={() => {
                    if (confirm(`Remove ${c.symbol} from ${theme.name}?`)) removeMut.mutate(c.symbol);
                  }}
                >
                  <FiTrash2 />
                </button>
              </td>
            </tr>
          ))}
          {adding && (
            <tr className="adding">
              <td><input placeholder="TICK" value={newSym} onChange={(e) => setNewSym(e.target.value.toUpperCase())} /></td>
              <td>—</td>
              <td><input placeholder="Why does this ticker fit the theme?" value={newRationale} onChange={(e) => setNewRationale(e.target.value)} /></td>
              <td>
                <button className="btn-icon" type="button" onClick={() => addMut.mutate({ symbol: newSym, rationale: newRationale })}><FiSave /></button>
                <button className="btn-icon" type="button" onClick={() => { setAdding(false); setNewSym(''); setNewRationale(''); }}><FiX /></button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── AI score output — renders the structured JSON as a bar chart grid ────
function ManifestoScoreOutput({ result }) {
  if (!result || !Array.isArray(result.scores)) return null;
  return (
    <div className="manifesto-scores">
      <div className="overall">
        Overall fit: <strong>{result.overall?.toFixed?.(1) ?? result.overall}/10</strong>
        {result.isConstituentOf?.length > 0 && (
          <span className="constituent-of">
            {' '}— already a constituent of: {result.isConstituentOf.join(', ')}
          </span>
        )}
      </div>
      <p className="summary">{result.summary}</p>
      <div className="scores-grid">
        {result.scores.map((s) => (
          <div key={s.slug} className="score-row">
            <div className="score-head">
              <span className="slug">{s.slug}</span>
              <span className="score">{Number(s.score).toFixed(1)}</span>
            </div>
            <div className="score-bar">
              <div className="score-bar-fill" style={{ width: `${Math.max(0, Math.min(10, Number(s.score))) * 10}%` }} />
            </div>
            <div className="rationale">{s.rationale}</div>
          </div>
        ))}
      </div>
      <div className="disclaimer-banner small">
        {result.disclaimer || 'AI-generated score. Not investment advice.'}
      </div>
    </div>
  );
}

// ─── Theme-basket alerts panel ─────────────────────────────────────────────
function ThemeAlertsPanel({ theme }) {
  const qc = useQueryClient();
  const { data: alertsResp } = useQuery({
    queryKey: ['theme-alerts', theme.slug],
    queryFn: () => api.listThemeAlerts(theme.slug),
  });
  const alerts = alertsResp?.items || [];
  const [kind, setKind] = useState('basket-change-pct');
  const [threshold, setThreshold] = useState('5');
  const [notes, setNotes] = useState('');

  const createMut = useMutation({
    mutationFn: (body) => api.createThemeAlert(theme.slug, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['theme-alerts', theme.slug] });
      setNotes('');
    },
    onError: (err) => alert(err.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => api.deleteThemeAlert(theme.slug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['theme-alerts', theme.slug] }),
  });

  return (
    <div className="theme-alerts">
      <h3><FiBell /> Basket alerts</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const th = Number(threshold);
          if (!Number.isFinite(th)) { alert('threshold must be a number'); return; }
          createMut.mutate({ kind, threshold: th, notes });
        }}
        className="alert-form"
      >
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="basket-change-pct">Basket change %</option>
          <option value="any-member-above">Any member above $</option>
          <option value="any-member-below">Any member below $</option>
        </select>
        <input
          placeholder={kind === 'basket-change-pct' ? '±% from baseline' : 'price'}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
        <input placeholder="notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button type="submit" disabled={createMut.isPending}>
          <FiPlus /> Create alert
        </button>
      </form>
      {alerts.length === 0
        ? <div className="muted">No alerts yet.</div>
        : (
          <ul className="alerts-list">
            {alerts.map((a) => (
              <li key={a.id}>
                <span><strong>{a.kind}</strong> @ {a.threshold}{a.kind === 'basket-change-pct' ? '%' : ''}</span>
                {a.notes && <span className="muted"> — {a.notes}</span>}
                <span className={`alert-status ${a.status}`}>{a.status}</span>
                <button className="btn-icon danger" onClick={() => deleteMut.mutate(a.id)}><FiTrash2 /></button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function averageChangePct(constituents) {
  const cps = (constituents || [])
    .map((c) => c.quote?.changePct ?? c.quote?.cp)
    .filter((p) => typeof p === 'number' && Number.isFinite(p));
  if (!cps.length) return null;
  return cps.reduce((a, b) => a + b, 0) / cps.length;
}

function formatPrice(quote) {
  const p = quote?.p ?? quote?.price;
  return typeof p === 'number' ? `$${p.toFixed(2)}` : '—';
}
