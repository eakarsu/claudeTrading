import React, { useEffect, useMemo, useState } from 'react';
import { FiRefreshCw, FiExternalLink, FiSearch, FiBookOpen, FiMessageSquare, FiCornerDownLeft } from 'react-icons/fi';
import { getDocsToc, getDocsPage, searchDocs, refreshDocs, aiChat } from '../api';

/**
 * Docs browser — sidebar TOC + content pane + search.
 *
 * Data flow:
 *   1. Mount → fetch TOC for the active source. First section/first page is
 *      auto-selected so the view is never empty after crawl.
 *   2. Click a TOC entry → fetch its page.
 *   3. Type in search → debounced call to /docs/:source/search.
 *
 * The page renders markdown with a tiny local formatter (no runtime deps) —
 * enough for the MkDocs-sourced output we mirror: headings, paragraphs,
 * fenced code blocks, lists, inline code, links.
 */

const SOURCE = 'freqtrade';

function mdToHtml(md) {
  if (!md) return '';
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let listBuf = [];
  const flushList = () => {
    if (listBuf.length) {
      out.push(`<ul>${listBuf.map((i) => `<li>${i}</li>`).join('')}</ul>`);
      listBuf = [];
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      if (inCode) {
        out.push(`<pre><code>${escape(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { flushList(); out.push(`<h${h[1].length}>${formatInline(escape(h[2]))}</h${h[1].length}>`); continue; }
    const li = line.match(/^\s*[-*]\s+(.+)$/);
    if (li) { listBuf.push(formatInline(escape(li[1]))); continue; }
    if (!line.trim()) { flushList(); out.push(''); continue; }
    flushList();
    out.push(`<p>${formatInline(escape(line))}</p>`);
  }
  flushList();
  if (inCode) out.push(`<pre><code>${escape(codeBuf.join('\n'))}</code></pre>`);
  return out.join('\n');
}

function formatInline(s) {
  // Inline code, bold, italics, links. Applied after HTML escape so injection
  // is already neutralized; we're just re-introducing safe tags.
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export default function Docs() {
  const [toc, setToc]         = useState(null);
  const [active, setActive]   = useState(''); // slug
  const [page, setPage]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // "Ask AI" grounded chat — uses /ai/chat with feature='docs' so the server
  // retrieves relevant docs pages and injects them into the prompt.
  const [askPrompt, setAskPrompt]   = useState('');
  const [asking, setAsking]         = useState(false);
  const [answer, setAnswer]         = useState(null); // { text, citations: [{slug,title,...}] }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Honor a ?slug=... deep-link (used by <DocsHint>'s "Open in Docs") so
    // hopping from a hint lands on the right page without an extra click.
    const params = new URLSearchParams(window.location.search);
    const deepSlug = params.get('slug');
    getDocsToc(SOURCE)
      .then((t) => {
        if (cancelled) return;
        setToc(t);
        const allSlugs = t.sections?.flatMap((s) => s.items.map((i) => i.slug)) ?? [];
        const firstSlug = t.sections?.[0]?.items?.[0]?.slug ?? '';
        const start = deepSlug != null && allSlugs.includes(deepSlug) ? deepSlug : firstSlug;
        setActive(start);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (active == null || !toc) return;
    let cancelled = false;
    getDocsPage(SOURCE, active)
      .then((p) => { if (!cancelled) setPage(p); })
      .catch((e) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [active, toc]);

  // Debounced search — wait 200ms after the last keystroke so we don't hammer
  // the endpoint on every character. Empty query clears the overlay.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    const t = setTimeout(() => {
      searchDocs(SOURCE, q).then((r) => setResults(r.results)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const handleAsk = async (e) => {
    e?.preventDefault?.();
    const q = askPrompt.trim();
    if (!q || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      const r = await aiChat(q, 'docs', { groundWithDocs: true });
      setAnswer({ text: r.analysis || '', citations: r.citations || [] });
    } catch (e2) {
      setAnswer({ text: `Error: ${e2.message}`, citations: [] });
    } finally {
      setAsking(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshDocs(SOURCE);
      // Refresh runs async — poll TOC every 3s until fetchedAt moves.
      const before = toc?.fetchedAt;
      const start = Date.now();
      const poll = async () => {
        const t = await getDocsToc(SOURCE).catch(() => null);
        if (t && t.fetchedAt && t.fetchedAt !== before) {
          setToc(t);
          setRefreshing(false);
          return;
        }
        if (Date.now() - start > 60_000) { setRefreshing(false); return; }
        setTimeout(poll, 3000);
      };
      poll();
    } catch (e) {
      setErr(e.message);
      setRefreshing(false);
    }
  };

  const bodyHtml = useMemo(() => mdToHtml(page?.markdown), [page?.markdown]);

  if (loading) return <div className="page-loading">Loading docs…</div>;
  if (err) return <div className="page-error">Failed to load docs: {err}</div>;
  if (!toc) return null;

  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <div className="docs-source-header">
          <FiBookOpen size={16} />
          <strong>{toc.label}</strong>
          <button
            className="btn-icon"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh from upstream"
          >
            <FiRefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
        </div>

        <div className="docs-search">
          <FiSearch size={14} />
          <input
            placeholder="Search docs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {results ? (
          <div className="docs-search-results">
            <div className="docs-section-label">Search: “{query}”</div>
            {results.length === 0 && <div className="docs-empty">No matches.</div>}
            {results.map((r) => (
              <button
                key={r.slug}
                className={`docs-nav-item ${active === r.slug ? 'active' : ''}`}
                onClick={() => { setActive(r.slug); setQuery(''); setResults(null); }}
              >
                <div className="docs-nav-title">{r.title}</div>
                <div className="docs-nav-excerpt">{r.excerpt}</div>
              </button>
            ))}
          </div>
        ) : (
          <nav className="docs-nav">
            {toc.sections.map(({ section, items }) => (
              <div key={section} className="docs-section">
                <div className="docs-section-label">{section}</div>
                {items.map((i) => (
                  <button
                    key={i.slug}
                    className={`docs-nav-item ${active === i.slug ? 'active' : ''}`}
                    onClick={() => setActive(i.slug)}
                  >
                    {i.title}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        )}

        <div className="docs-attribution">{toc.attribution}</div>
      </aside>

      <article className="docs-content">
        <section className="docs-ask">
          <form className="docs-ask-form" onSubmit={handleAsk}>
            <FiMessageSquare size={14} />
            <input
              placeholder="Ask about these docs… (e.g. “how does trailing stoploss work?”)"
              value={askPrompt}
              onChange={(e) => setAskPrompt(e.target.value)}
              disabled={asking}
            />
            <button type="submit" className="btn btn-primary btn-small" disabled={asking || !askPrompt.trim()}>
              {asking ? 'Asking…' : (<><FiCornerDownLeft size={13} /> Ask AI</>)}
            </button>
          </form>
          {answer && (
            <div className="docs-ask-answer">
              <div className="docs-ask-text">{answer.text}</div>
              {answer.citations?.length > 0 && (
                <div className="docs-ask-citations">
                  <span className="docs-section-label">Cited pages</span>
                  {answer.citations.map((c) => (
                    <button
                      key={c.slug}
                      className="docs-ask-citation"
                      onClick={() => setActive(c.slug)}
                      title={c.section || ''}
                    >
                      {c.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {page ? (
          <>
            <header className="docs-content-header">
              <h1>{page.title}</h1>
              <a
                href={page.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-small"
              >
                <FiExternalLink size={14} /> View upstream
              </a>
            </header>
            {page.markdown ? (
              <div className="docs-markdown" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            ) : (
              <div className="docs-empty">
                This page hasn't been fetched yet. Click the refresh button in the sidebar.
              </div>
            )}
            {page.fetchedAt && (
              <footer className="docs-content-footer">
                Mirrored {new Date(page.fetchedAt).toLocaleString()} ·{' '}
                <a href={page.url} target="_blank" rel="noopener noreferrer">{page.url}</a>
              </footer>
            )}
          </>
        ) : (
          <div className="docs-empty">Select a page from the sidebar.</div>
        )}
      </article>
    </div>
  );
}
