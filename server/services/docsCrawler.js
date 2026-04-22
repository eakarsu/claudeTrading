import crypto from 'crypto';
import TurndownService from 'turndown';
import { DocsPage } from '../models/index.js';
import { logger } from '../logger.js';
import { getSource } from './docsRegistry.js';

/**
 * External docs crawler.
 *
 * Fetches pages from the registered sources, extracts the main article HTML,
 * converts to markdown, and upserts into `docs_pages`. The extraction is
 * MkDocs-aware (freqtrade's renderer) but falls back to <main> / <body> for
 * generic sites.
 *
 * Design notes:
 *   - Paced with FETCH_DELAY_MS between requests so we don't hammer the
 *     upstream CDN even on a fresh install.
 *   - Uses an SHA-1 of the extracted HTML as a change token. Unchanged pages
 *     skip the DB write so refresh runs are ~free when nothing moved.
 *   - Single-flight: concurrent refresh() calls share the same promise so a
 *     user clicking "refresh" while the scheduler is mid-run doesn't double up.
 */

const FETCH_DELAY_MS = parseInt(process.env.DOCS_FETCH_DELAY_MS || '300', 10);
const FETCH_TIMEOUT_MS = parseInt(process.env.DOCS_FETCH_TIMEOUT_MS || '15000', 10);
const USER_AGENT = 'ClaudeTradingDocsCrawler/1.0 (+https://github.com/anthropics/claude-code)';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
// Keep <pre> blocks readable — MkDocs wraps code in highlighted spans that
// turndown otherwise turns into noisy inline text.
turndown.addRule('keepCodeBlocks', {
  filter: ['pre'],
  replacement(_content, node) {
    const text = node.textContent || '';
    return `\n\`\`\`\n${text.replace(/\n+$/, '')}\n\`\`\`\n`;
  },
});

function sha1(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

/**
 * Pull the article body out of the MkDocs page. We tried multiple selectors
 * because MkDocs Material themes differ between versions.
 */
function extractArticleHtml(fullHtml) {
  // MkDocs Material wraps the page in <article class="md-content__inner">...
  const patterns = [
    /<article[^>]*class="[^"]*md-content__inner[^"]*"[^>]*>([\s\S]*?)<\/article>/i,
    /<article[\s\S]*?>([\s\S]*?)<\/article>/i,
    /<div[^>]*role="main"[^>]*>([\s\S]*?)<\/div>\s*<\/main>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];
  for (const re of patterns) {
    const m = fullHtml.match(re);
    if (m && m[1]) return m[1];
  }
  // Last-resort: strip head/script/style and hand the body to turndown.
  return fullHtml
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '');
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function crawlOne(sourceName, page) {
  const html = await fetchPage(page.url);
  const articleHtml = extractArticleHtml(html);
  const hash = sha1(articleHtml);

  const existing = await DocsPage.findOne({
    where: { source: sourceName, slug: page.slug },
  });
  if (existing && existing.htmlHash === hash) {
    // Bump fetchedAt so the operator can see crawl freshness even when the
    // content was cached unchanged. Doesn't rewrite the markdown column.
    await existing.update({ fetchedAt: new Date() });
    return { slug: page.slug, status: 'unchanged' };
  }

  const markdown = turndown.turndown(articleHtml).trim();
  const payload = {
    source: sourceName,
    slug: page.slug,
    title: page.title,
    section: page.section,
    order: page.order,
    url: page.url,
    markdown,
    htmlHash: hash,
    fetchedAt: new Date(),
  };
  if (existing) {
    await existing.update(payload);
    return { slug: page.slug, status: 'updated' };
  }
  await DocsPage.create(payload);
  return { slug: page.slug, status: 'created' };
}

let inflight = null;

export async function refreshSource(sourceName = 'freqtrade', { force = false } = {}) {
  // Single-flight: reuse an in-progress refresh rather than starting a second.
  if (inflight) return inflight;

  const source = getSource(sourceName);
  if (!source) throw new Error(`Unknown docs source: ${sourceName}`);

  inflight = (async () => {
    const results = { created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };
    const started = Date.now();
    logger.info({ source: sourceName, pages: source.pages.length }, 'Docs crawl starting');

    for (const page of source.pages) {
      try {
        // If `force`, nuke the stored hash so the update branch fires.
        if (force) {
          await DocsPage.update(
            { htmlHash: null },
            { where: { source: sourceName, slug: page.slug } },
          ).catch(() => {});
        }
        const r = await crawlOne(sourceName, page);
        results[r.status] = (results[r.status] || 0) + 1;
      } catch (err) {
        results.failed += 1;
        results.errors.push({ slug: page.slug, message: err.message });
        logger.warn({ err, slug: page.slug, source: sourceName }, 'Docs crawl page failed');
      }
      // Pace requests so we don't spike the upstream CDN on a first-run
      // crawl of 40+ pages. Skip the final sleep.
      if (page !== source.pages[source.pages.length - 1]) {
        await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
      }
    }

    const elapsedMs = Date.now() - started;
    logger.info({ source: sourceName, ...results, elapsedMs }, 'Docs crawl complete');
    return { source: sourceName, elapsedMs, ...results };
  })().finally(() => { inflight = null; });

  return inflight;
}

export function isCrawlInflight() {
  return inflight != null;
}
