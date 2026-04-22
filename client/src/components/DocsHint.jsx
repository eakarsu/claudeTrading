import React, { useEffect, useRef, useState } from 'react';
import { FiHelpCircle, FiExternalLink } from 'react-icons/fi';
import { getDocsExcerpt } from '../api';

/**
 * Inline "ⓘ" hint that reveals a docs excerpt on hover/focus.
 *
 * Usage:
 *   <DocsHint slug="stoploss" />
 *   <DocsHint slug="hyperopt" label="Hyperopt" source="freqtrade" />
 *
 * - Fetches the excerpt lazily on first open; result is cached per (source, slug)
 *   for the lifetime of the page load so repeated hovers don't re-fetch.
 * - "Open in Docs" deep-links to /docs?slug=<slug>, which the Docs page reads
 *   on mount to pre-select the entry.
 * - Pure presentational; no global state, safe to sprinkle liberally in forms.
 */

const excerptCache = new Map(); // key: `${source}|${slug}` -> excerpt payload

export default function DocsHint({ slug, source = 'freqtrade', label }) {
  const [open, setOpen]       = useState(false);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const closeTimer = useRef(null);

  const key = `${source}|${slug}`;

  const ensureLoaded = () => {
    if (data || loading) return;
    const cached = excerptCache.get(key);
    if (cached) { setData(cached); return; }
    setLoading(true);
    getDocsExcerpt(source, slug)
      .then((p) => { excerptCache.set(key, p); setData(p); })
      .catch((e) => setErr(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  const show = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    ensureLoaded();
    setOpen(true);
  };
  // Small delay so moving from trigger to popover doesn't flicker.
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return (
    <span
      className="docs-hint"
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
      onFocus={show}
      onBlur={scheduleClose}
    >
      <button
        type="button"
        className="docs-hint-trigger"
        aria-label={label ? `Docs: ${label}` : 'Docs hint'}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <FiHelpCircle size={13} />
      </button>
      {open && (
        <div className="docs-hint-popover" role="tooltip">
          {loading && <div className="docs-hint-loading">Loading…</div>}
          {err && <div className="docs-hint-error">{err}</div>}
          {data && (
            <>
              <div className="docs-hint-header">
                <strong>{data.title}</strong>
                {data.section && <span className="docs-hint-section">{data.section}</span>}
              </div>
              <div className="docs-hint-excerpt">{data.excerpt || 'No excerpt available.'}</div>
              <div className="docs-hint-footer">
                <a href={`/docs?slug=${encodeURIComponent(data.slug)}`} className="docs-hint-link">
                  Open in Docs
                </a>
                {data.url && (
                  <a
                    href={data.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="docs-hint-link"
                  >
                    Upstream <FiExternalLink size={11} />
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
