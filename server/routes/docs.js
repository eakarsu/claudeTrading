import express from 'express';
import { Op } from 'sequelize';
import { DocsPage, User } from '../models/index.js';
import { listSources, getSource } from '../services/docsRegistry.js';
import { refreshSource, isCrawlInflight } from '../services/docsCrawler.js';
import { importFromFile } from '../services/docsImporter.js';
import { logger } from '../logger.js';

const router = express.Router();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'trader@claude.ai';

async function requireAdmin(req, res, next) {
  try {
    const user = await User.findByPk(req.userId);
    if (!user || user.email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  } catch (err) {
    logger.warn({ err }, 'docs admin check failed');
    res.status(500).json({ error: 'Admin check failed' });
  }
}

function toc(pages) {
  // Group into sections, preserving registry order within each section.
  const bySection = new Map();
  for (const p of pages) {
    const key = p.section || 'Other';
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push({ slug: p.slug, title: p.title, order: p.order });
  }
  return Array.from(bySection.entries()).map(([section, items]) => ({ section, items }));
}

// List available sources (freqtrade today, extensible).
router.get('/sources', async (_req, res, next) => {
  try {
    res.json({ sources: listSources() });
  } catch (err) { next(err); }
});

// Table of contents for a source — sections + page titles, no body.
router.get('/:source/toc', async (req, res, next) => {
  try {
    const { source } = req.params;
    if (!getSource(source)) return res.status(404).json({ error: 'Unknown source' });
    const rows = await DocsPage.findAll({
      where: { source },
      attributes: ['slug', 'title', 'section', 'order', 'fetchedAt'],
      order: [['order', 'ASC']],
    });
    const src = getSource(source);
    res.json({
      source,
      label: src.label,
      attribution: src.attribution,
      homepage: src.homepage,
      sections: toc(rows),
      fetchedAt: rows[0]?.fetchedAt || null,
      totalPages: rows.length,
    });
  } catch (err) { next(err); }
});

// Full-text search within a source. Uses ILIKE (Postgres) — good enough for
// 46 pages of content. Can swap to tsvector later without changing the API.
router.get('/:source/search', async (req, res, next) => {
  try {
    const { source } = req.params;
    const q = String(req.query.q || '').trim();
    if (!getSource(source)) return res.status(404).json({ error: 'Unknown source' });
    if (q.length < 2) return res.json({ results: [] });

    const rows = await DocsPage.findAll({
      where: {
        source,
        [Op.or]: [
          { title:    { [Op.iLike]: `%${q}%` } },
          { markdown: { [Op.iLike]: `%${q}%` } },
        ],
      },
      attributes: ['slug', 'title', 'section', 'markdown'],
      limit: 20,
    });

    const lowerQ = q.toLowerCase();
    const results = rows.map((r) => {
      const md = r.markdown || '';
      const idx = md.toLowerCase().indexOf(lowerQ);
      const start = Math.max(0, idx - 80);
      const end = Math.min(md.length, idx + 120);
      const excerpt = idx >= 0
        ? `${start > 0 ? '…' : ''}${md.slice(start, end)}${end < md.length ? '…' : ''}`
        : (md.slice(0, 160) + (md.length > 160 ? '…' : ''));
      return { slug: r.slug, title: r.title, section: r.section, excerpt };
    });
    res.json({ query: q, results });
  } catch (err) { next(err); }
});

// Lightweight excerpt for tooltips/hints. Returns title + section + url + a
// short body excerpt (first ~600 chars, stripped of markdown fences) without
// shipping the whole page.
router.get('/:source/excerpt/:slug?', async (req, res, next) => {
  try {
    const { source } = req.params;
    const slug = req.params.slug || '';
    if (!getSource(source)) return res.status(404).json({ error: 'Unknown source' });
    const row = await DocsPage.findOne({
      where: { source, slug },
      attributes: ['slug', 'title', 'section', 'url', 'markdown'],
    });
    if (!row) return res.status(404).json({ error: 'Page not found' });

    // Strip H1 (already in `title`), trim leading whitespace, cut at 600 chars.
    const body = (row.markdown || '')
      .replace(/^# .+\n?/, '')
      .replace(/```[\s\S]*?```/g, '') // drop fenced code — noisy for a tooltip
      .trim();
    const excerpt = body.length > 600 ? `${body.slice(0, 600).trimEnd()}…` : body;

    res.json({
      source,
      slug: row.slug,
      title: row.title,
      section: row.section,
      url: row.url,
      excerpt,
    });
  } catch (err) { next(err); }
});

// Fetch a single page. Empty slug ('') is the index — route with an optional
// slug segment to keep this tidy.
router.get('/:source/page/:slug?', async (req, res, next) => {
  try {
    const { source } = req.params;
    const slug = req.params.slug || '';
    if (!getSource(source)) return res.status(404).json({ error: 'Unknown source' });
    const row = await DocsPage.findOne({ where: { source, slug } });
    if (!row) return res.status(404).json({ error: 'Page not found' });
    const src = getSource(source);
    res.json({
      source,
      slug: row.slug,
      title: row.title,
      section: row.section,
      url: row.url,
      markdown: row.markdown,
      fetchedAt: row.fetchedAt,
      attribution: src.attribution,
    });
  } catch (err) { next(err); }
});

// Manual refresh. Two modes:
//   - default: fetch from upstream (network crawl), single-flight via crawler
//   - ?mode=import: re-import from the local pre-crawled file (fast, offline)
// We 409 network refreshes that overlap with an in-flight crawl so the UI can
// show "already running" rather than spinning.
router.post('/:source/refresh', requireAdmin, async (req, res, next) => {
  try {
    const { source } = req.params;
    if (!getSource(source)) return res.status(404).json({ error: 'Unknown source' });

    const mode = req.query.mode === 'import' || req.body?.mode === 'import' ? 'import' : 'upstream';

    if (mode === 'import') {
      importFromFile(source).catch((err) =>
        logger.warn({ err, source }, 'Docs import (background) failed'),
      );
      return res.status(202).json({ ok: true, status: 'importing' });
    }

    if (isCrawlInflight()) return res.status(409).json({ error: 'Refresh already running' });
    const force = req.query.force === '1' || req.body?.force === true;
    // Kick off in the background; respond immediately so the UI doesn't sit
    // on a 30-second request.
    refreshSource(source, { force }).catch((err) =>
      logger.warn({ err, source }, 'Docs refresh (background) failed'),
    );
    res.status(202).json({ ok: true, status: 'started' });
  } catch (err) { next(err); }
});

export default router;
